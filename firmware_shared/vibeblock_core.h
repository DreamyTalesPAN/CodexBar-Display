#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "theme_registry.h"

namespace vibeblock {
namespace core {

constexpr size_t kFrameLineBufferBytes = 512;

struct Frame {
  String provider;
  String label;
  int session = 0;
  int weekly = 0;
  int64_t resetSecs = 0;
  bool hasTheme = false;
  String theme;
  bool hasError = false;
  String error;
};

struct RuntimeState {
  Frame current;
  bool hasFrame = false;
  unsigned long resetBaseMillis = 0;
  int64_t resetBaseSecs = 0;
};

struct LineReaderState {
  char buffer[kFrameLineBufferBytes];
  size_t len = 0;
  bool overflowed = false;
};

struct SerialConsumeEvent {
  bool frameAccepted = false;
  bool hadFrame = false;
  bool visualChanged = false;
  bool themeChanged = false;
};

inline int ClampPct(int value) {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

inline int64_t CurrentRemainingSecs(const RuntimeState& state, unsigned long nowMillis) {
  if (!state.hasFrame) {
    return 0;
  }
  const unsigned long elapsedMillis = nowMillis - state.resetBaseMillis;
  const int64_t elapsedSecs = static_cast<int64_t>(elapsedMillis / 1000UL);
  const int64_t remain = state.resetBaseSecs - elapsedSecs;
  if (remain < 0) {
    return 0;
  }
  return remain;
}

inline String FormatDuration(int64_t secs) {
  const int64_t hours = secs / 3600;
  const int64_t minutes = (secs % 3600) / 60;
  if (hours > 0) {
    return String(hours) + "h " + String(minutes) + "m";
  }
  return String(minutes) + "m";
}

inline bool ParseFrameLine(const char* line, bool allowTheme, Frame& out) {
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, line);
  if (err) {
    out = {};
    out.hasError = true;
    out.error = String("bad json: ") + err.c_str();
    return true;
  }

  bool hasTheme = false;
  String themeName;
  if (allowTheme && doc["theme"].is<const char*>()) {
    hasTheme = theme::NormalizeThemeName(String(doc["theme"].as<const char*>()), themeName);
  }

  if (doc["error"].is<const char*>()) {
    out = {};
    out.hasTheme = hasTheme;
    out.theme = themeName;
    out.hasError = true;
    out.error = String(doc["error"].as<const char*>());
    return true;
  }

  out = {};
  out.provider = String(doc["provider"] | "");
  out.label = String(doc["label"] | "Provider");
  out.session = ClampPct(doc["session"] | 0);
  out.weekly = ClampPct(doc["weekly"] | 0);
  out.resetSecs = static_cast<int64_t>(doc["resetSecs"] | 0);
  out.hasTheme = hasTheme;
  out.theme = themeName;
  out.hasError = false;
  out.error = "";
  return true;
}

inline bool FrameVisualChanged(const Frame& previous, const Frame& next) {
  if (previous.hasError != next.hasError) {
    return true;
  }
  if (next.hasError) {
    return previous.error != next.error;
  }
  return previous.provider != next.provider ||
         previous.label != next.label ||
         previous.session != next.session ||
         previous.weekly != next.weekly;
}

inline bool FrameThemeChanged(const Frame& previous, const Frame& next) {
  if (!next.hasTheme) {
    return false;
  }
  if (!previous.hasTheme) {
    return true;
  }
  return previous.theme != next.theme;
}

inline bool ConsumeSerialByte(
    LineReaderState& lineState,
    RuntimeState& runtimeState,
    char c,
    unsigned long nowMillis,
    bool allowTheme,
    SerialConsumeEvent& outEvent) {
  outEvent = {};

  if (c == '\r') {
    return false;
  }

  if (c != '\n') {
    if (!lineState.overflowed && lineState.len + 1 < sizeof(lineState.buffer)) {
      lineState.buffer[lineState.len++] = c;
    } else {
      lineState.overflowed = true;
    }
    return false;
  }

  lineState.buffer[lineState.len] = '\0';
  if (!lineState.overflowed && lineState.len > 0) {
    Frame next;
    if (ParseFrameLine(lineState.buffer, allowTheme, next)) {
      const Frame previous = runtimeState.current;
      outEvent.hadFrame = runtimeState.hasFrame;
      outEvent.visualChanged = !outEvent.hadFrame || FrameVisualChanged(previous, next);
      outEvent.themeChanged = outEvent.hadFrame && FrameThemeChanged(previous, next);

      runtimeState.current = next;
      runtimeState.hasFrame = true;
      runtimeState.resetBaseSecs = runtimeState.current.resetSecs;
      runtimeState.resetBaseMillis = nowMillis;
      outEvent.frameAccepted = true;
    }
  }

  lineState.len = 0;
  lineState.overflowed = false;
  return outEvent.frameAccepted;
}

}  // namespace core
}  // namespace vibeblock
