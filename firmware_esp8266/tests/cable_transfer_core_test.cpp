#include <cstdio>
#include <cstdlib>

#include "../src/cable_transfer_core.h"

namespace transfer = codexbar_display::esp8266::cable_transfer;

void require(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    std::exit(1);
  }
}

int main() {
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
