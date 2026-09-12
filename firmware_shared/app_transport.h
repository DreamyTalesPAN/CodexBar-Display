#pragma once

#include <Arduino.h>
#include <cstdio>

#include "app_runtime.h"

namespace codexbar_display {
namespace app {

constexpr int kDefaultMaxFrameBytes = 512;

struct TransportConfig {
  const char* boardId = "unknown";
  const char* firmwareVersion = "dev";
  const char* deviceId = "";
  const char* networkMode = "";
  const char* featuresJSON = "[]";
  const char* supportedProtocolVersionsJSON = "[2,1]";
  int preferredProtocolVersion = 2;
  int maxFrameBytes = kDefaultMaxFrameBytes;
  const char* capabilitiesJSON = "{}";
};

inline bool ReadSerialLine(RuntimeContext& ctx, String& outLine) {
  outLine = "";
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    const char* completed = nullptr;
    if (core::ConsumeLineByte(ctx.lineReader, c, completed)) {
      outLine = completed;
      return true;
    }
  }
  return false;
}

inline bool ConsumeSerial(
    RuntimeContext& ctx,
    unsigned long nowMillis,
    core::SerialConsumeEvent& outEvent) {
  outEvent = {};

  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    core::SerialConsumeEvent event;
    if (core::ConsumeSerialByte(
            ctx.lineReader,
            ctx.runtime,
            c,
            nowMillis,
            event)) {
      outEvent = event;
      return true;
    }
  }

  return false;
}

inline String BuildDeviceHelloJSON(const TransportConfig& config) {
  const char* boardId = config.boardId == nullptr ? "unknown" : config.boardId;
  const char* firmware = config.firmwareVersion == nullptr ? "dev" : config.firmwareVersion;
  const char* features = config.featuresJSON == nullptr ? "[]" : config.featuresJSON;
  const char* supportedProtocols =
      config.supportedProtocolVersionsJSON == nullptr ? "[2,1]" : config.supportedProtocolVersionsJSON;
  const int preferredProtocol = config.preferredProtocolVersion > 0 ? config.preferredProtocolVersion : 1;
  const int maxFrameBytes = config.maxFrameBytes > 0 ? config.maxFrameBytes : kDefaultMaxFrameBytes;
  const char* capabilities = config.capabilitiesJSON == nullptr ? "{}" : config.capabilitiesJSON;
  const char* deviceId = config.deviceId == nullptr ? "" : config.deviceId;
  const char* networkMode = config.networkMode == nullptr ? "" : config.networkMode;

  String out;
  out.reserve(384);
  out += "{\"kind\":\"hello\",\"protocolVersion\":";
  out += String(preferredProtocol);
  out += ",\"supportedProtocolVersions\":";
  out += supportedProtocols;
  out += ",\"preferredProtocolVersion\":";
  out += String(preferredProtocol);
  out += ",\"board\":\"";
  out += boardId;
  out += "\",\"firmware\":\"";
  out += firmware;
  if (deviceId[0] != '\0') {
    out += "\",\"deviceId\":\"";
    out += deviceId;
  }
  if (networkMode[0] != '\0') {
    out += "\",\"networkMode\":\"";
    out += networkMode;
  }
  out += "\",\"features\":";
  out += features;
  out += ",\"maxFrameBytes\":";
  out += String(maxFrameBytes);
  out += ",\"capabilities\":";
  out += capabilities;
  out += "}";
  return out;
}

inline void EmitDeviceHello(const TransportConfig& config) {
  Serial.println(BuildDeviceHelloJSON(config));
}

}  // namespace app
}  // namespace codexbar_display
