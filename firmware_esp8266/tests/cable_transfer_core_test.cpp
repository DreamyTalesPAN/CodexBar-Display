#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "../src/cable_transfer_core.h"

namespace transfer = codexbar_display::esp8266::cable_transfer;

void require(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    std::exit(1);
  }
}

std::string encodeBase64(const uint8_t* data, size_t length) {
  static const char kAlphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  for (size_t i = 0; i < length; i += 3) {
    const uint32_t group = (uint32_t(data[i]) << 16) |
                           (i + 1 < length ? uint32_t(data[i + 1]) << 8 : 0) |
                           (i + 2 < length ? uint32_t(data[i + 2]) : 0);
    out += kAlphabet[(group >> 18) & 63];
    out += kAlphabet[(group >> 12) & 63];
    out += i + 1 < length ? kAlphabet[(group >> 6) & 63] : '=';
    out += i + 2 < length ? kAlphabet[group & 63] : '=';
  }
  return out;
}

void testDecodeChunk() {
  uint8_t source[1024];
  for (size_t i = 0; i < sizeof(source); ++i) {
    source[i] = static_cast<uint8_t>(i * 37 + 11);
  }
  uint8_t out[1024];

  // Every padding shape, and a full v2 chunk, survive the round trip.
  const size_t lengths[] = {1, 2, 3, 4, 5, 1024};
  for (size_t length : lengths) {
    const std::string encoded = encodeBase64(source, length);
    require(transfer::DecodeChunk("", encoded.c_str(), out, sizeof(out)) == length,
            "base64 chunk must decode to its exact length");
    require(std::memcmp(out, source, length) == 0, "base64 chunk must decode to its bytes");
  }
  require(transfer::DecodeChunk("", encodeBase64(source, 1024).c_str(), out, 1023) == 0,
          "a chunk larger than the buffer must be rejected, not truncated");

  // A byte lost or damaged on the wire must never decode to something.
  const std::string good = encodeBase64(source, 6);
  require(transfer::DecodeChunk("", good.substr(1).c_str(), out, sizeof(out)) == 0,
          "base64 with a lost character must be rejected");
  std::string damaged = good;
  damaged[3] = '*';
  require(transfer::DecodeChunk("", damaged.c_str(), out, sizeof(out)) == 0,
          "base64 with a foreign character must be rejected");
  require(transfer::DecodeChunk("", "QQ=A", out, sizeof(out)) == 0,
          "padding must only close the last group");
  require(transfer::DecodeChunk("", "QQ==QUFB", out, sizeof(out)) == 0,
          "padding must not appear before the last group");

  // cable-transfer-v1 hex, which older Mac apps still send.
  require(transfer::DecodeChunk("00ff7A", "", out, sizeof(out)) == 3 &&
              out[0] == 0x00 && out[1] == 0xff && out[2] == 0x7a,
          "hex chunk must decode");
  require(transfer::DecodeChunk("0ff", "", out, sizeof(out)) == 0, "odd hex must be rejected");
  require(transfer::DecodeChunk("0g", "", out, sizeof(out)) == 0, "foreign hex must be rejected");
  require(transfer::DecodeChunk("", "", out, sizeof(out)) == 0, "an empty chunk must be rejected");
  require(transfer::DecodeChunk("0011", "", out, 1) == 0, "hex over capacity must be rejected");
}

int main() {
  testDecodeChunk();

  transfer::State state;
  transfer::Begin(state, 8, 100);

  int sinkWrites = 0;
  const auto corrupted = transfer::CheckChunk(state, 0, 4, 0x11111111, 0x22222222);
  if (corrupted == transfer::ChunkDecision::kAccept) {
    sinkWrites++;
  }
  require(corrupted == transfer::ChunkDecision::kReject, "bad checksum must be rejected");
  require(sinkWrites == 0 && state.receivedBytes == 0, "bad checksum must write zero bytes");

  const auto first = transfer::CheckChunk(state, 0, 4, 0x11111111, 0x11111111);
  require(first == transfer::ChunkDecision::kAccept, "valid first chunk must be accepted");
  sinkWrites++;
  transfer::AcceptChunk(state, 4, 0x11111111, 110);
  require(!transfer::CanFinish(state, true), "truncated transfer must not commit");

  const auto duplicate = transfer::CheckChunk(state, 0, 4, 0x11111111, 0x11111111);
  require(duplicate == transfer::ChunkDecision::kDuplicate, "last acknowledged chunk must be idempotent");
  require(sinkWrites == 1, "duplicate chunk must not write twice");

  const auto second = transfer::CheckChunk(state, 1, 4, 0x33333333, 0x33333333);
  require(second == transfer::ChunkDecision::kAccept, "valid final chunk must be accepted");
  sinkWrites++;
  transfer::AcceptChunk(state, 4, 0x33333333, 120);
  require(!transfer::CanFinish(state, false), "whole-payload hash mismatch must not commit");
  require(transfer::CanFinish(state, true), "complete matching payload must commit");
  require(!transfer::Expired(state, 15119, 15000), "active transfer must stay alive through timeout boundary");
  require(transfer::Expired(state, 15121, 15000), "expired transfer must abort its sink");

  transfer::State idle;
  require(!transfer::CanFinish(idle, true), "aborted transfer must keep old sink active");
  require(!transfer::Expired(idle, 99999, 1), "idle transfer must not abort again");

  std::printf("ok: cable_transfer_core_test\n");
  return 0;
}
