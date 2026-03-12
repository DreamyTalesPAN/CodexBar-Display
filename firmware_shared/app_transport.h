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
  const char* featuresJSON = "[]";
  const char* supportedProtocolVersionsJSON = "[2,1]";
  int preferredProtocolVersion = 2;
  int maxFrameBytes = kDefaultMaxFrameBytes;
  const char* capabilitiesJSON = "{}";
};

inline bool ConsumeSerial(
    RuntimeContext& ctx,
    bool allowTheme,
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
            allowTheme,
            event)) {
      outEvent = event;
      return true;
    }
  }

  return false;
}

inline void EmitDeviceHello(const TransportConfig& config) {
  const char* boardId = config.boardId == nullptr ? "unknown" : config.boardId;
  const char* firmware = config.firmwareVersion == nullptr ? "dev" : config.firmwareVersion;
  const char* features = config.featuresJSON == nullptr ? "[]" : config.featuresJSON;
  const char* supportedProtocols =
      config.supportedProtocolVersionsJSON == nullptr ? "[2,1]" : config.supportedProtocolVersionsJSON;
  const int preferredProtocol = config.preferredProtocolVersion > 0 ? config.preferredProtocolVersion : 1;
  const int maxFrameBytes = config.maxFrameBytes > 0 ? config.maxFrameBytes : kDefaultMaxFrameBytes;
  const char* capabilities = config.capabilitiesJSON == nullptr ? "{}" : config.capabilitiesJSON;

  Serial.printf(
      "{\"kind\":\"hello\",\"protocolVersion\":%d,\"supportedProtocolVersions\":%s,"
      "\"preferredProtocolVersion\":%d,\"board\":\"%s\",\"firmware\":\"%s\","
      "\"features\":%s,\"maxFrameBytes\":%d,\"capabilities\":%s}\n",
      preferredProtocol,
      supportedProtocols,
      preferredProtocol,
      boardId,
      firmware,
      features,
      maxFrameBytes,
      capabilities);
}

}  // namespace app
}  // namespace codexbar_display
