#pragma once

#include <Arduino.h>
#include <cstdio>

#include "app_runtime.h"

namespace vibeblock {
namespace app {

constexpr int kDefaultMaxFrameBytes = 512;

struct TransportConfig {
  const char* boardId = "unknown";
  const char* firmwareVersion = "dev";
  const char* featuresJSON = "[]";
  int maxFrameBytes = kDefaultMaxFrameBytes;
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
  const int maxFrameBytes = config.maxFrameBytes > 0 ? config.maxFrameBytes : kDefaultMaxFrameBytes;

  Serial.printf(
      "{\"kind\":\"hello\",\"protocolVersion\":1,\"board\":\"%s\",\"firmware\":\"%s\","
      "\"features\":%s,\"maxFrameBytes\":%d}\n",
      boardId,
      firmware,
      features,
      maxFrameBytes);
}

}  // namespace app
}  // namespace vibeblock

