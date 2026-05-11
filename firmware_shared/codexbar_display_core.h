#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "theme_registry.h"

#ifndef CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
#define CODEXBAR_DISPLAY_THEME_SPEC_RENDERER 0
#endif

namespace codexbar_display {
namespace core {

constexpr size_t kFrameLineBufferBytes = 1024;

struct Frame {
  String provider;
  String label;
  int session = 0;
  int weekly = 0;
  int64_t resetSecs = 0;
  int64_t sessionTokens = 0;
  int64_t weekTokens = 0;
  int64_t totalTokens = 0;
  bool hasUsageMode = false;
  String usageMode;
  bool hasTheme = false;
  String theme;
  bool hasThemeSpec = false;
  String themeSpecId;
  int themeSpecRev = 0;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  String themeSpecRaw;
#endif
  bool hasUpdateAvailable = false;
  bool updateAvailable = false;
  String updateLatestVersion;
  String updateStatus;
  String updateLastError;
  bool hasError = false;
  String error;
};

struct RuntimeState {
  Frame current;
  bool hasFrame = false;
  unsigned long resetBaseMillis = 0;
  int64_t resetBaseSecs = 0;
  String cachedThemeId;
  int cachedThemeRev = 0;
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
  bool themeSpecChanged = false;
  bool themeSpecCacheHit = false;
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

inline int64_t ClampNonNegativeInt64(int64_t value) {
  if (value < 0) {
    return 0;
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

  bool hasThemeSpec = false;
  String themeSpecId;
  int themeSpecRev = 0;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  String themeSpecRaw;
#endif
  if (doc["themeSpec"].is<JsonObjectConst>()) {
    JsonObjectConst spec = doc["themeSpec"].as<JsonObjectConst>();
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    serializeJson(spec, themeSpecRaw);
#endif
    if (spec["themeId"].is<const char*>()) {
      themeSpecId = String(spec["themeId"].as<const char*>());
      themeSpecId.trim();
    }
    themeSpecRev = static_cast<int>(spec["themeRev"] | 0);
    hasThemeSpec = (themeSpecId.length() > 0 && themeSpecRev > 0);

    if (allowTheme && !hasTheme && spec["fallbackTheme"].is<const char*>()) {
      String fallbackTheme;
      if (theme::NormalizeThemeName(String(spec["fallbackTheme"].as<const char*>()), fallbackTheme)) {
        hasTheme = true;
        themeName = fallbackTheme;
      }
    }
  }

  bool hasUsageMode = false;
  String usageMode;
  if (doc["usageMode"].is<const char*>()) {
    usageMode = String(doc["usageMode"].as<const char*>());
    usageMode.trim();
    usageMode.toLowerCase();
    if (usageMode == "used" || usageMode == "remaining") {
      hasUsageMode = true;
    } else {
      usageMode = "";
    }
  }

  bool hasUpdateAvailable = false;
  bool updateAvailable = false;
  String updateLatestVersion;
  String updateStatus;
  String updateLastError;
  if (doc["update"].is<JsonObjectConst>()) {
    JsonObjectConst update = doc["update"].as<JsonObjectConst>();
    if (update["available"].is<bool>()) {
      hasUpdateAvailable = true;
      updateAvailable = update["available"].as<bool>();
    }
    updateLatestVersion = String(update["latestVersion"] | "");
    updateLatestVersion.trim();
    updateStatus = String(update["status"] | "");
    updateStatus.trim();
    updateLastError = String(update["lastError"] | "");
    updateLastError.trim();
  }

  if (doc["error"].is<const char*>()) {
    out = {};
    out.hasUsageMode = hasUsageMode;
    out.usageMode = usageMode;
    out.hasTheme = hasTheme;
    out.theme = themeName;
    out.hasThemeSpec = hasThemeSpec;
    out.themeSpecId = themeSpecId;
    out.themeSpecRev = themeSpecRev;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    out.themeSpecRaw = themeSpecRaw;
#endif
    out.hasUpdateAvailable = hasUpdateAvailable;
    out.updateAvailable = updateAvailable;
    out.updateLatestVersion = updateLatestVersion;
    out.updateStatus = updateStatus;
    out.updateLastError = updateLastError;
    out.hasError = true;
    out.error = String(doc["error"].as<const char*>());
    return true;
  }

  out = {};
  out.provider = String(doc["provider"] | "");
  out.label = String(doc["label"] | "Provider");
  out.session = ClampPct(doc["session"] | 0);
  out.weekly = ClampPct(doc["weekly"] | 0);
  out.resetSecs = ClampNonNegativeInt64(static_cast<int64_t>(doc["resetSecs"] | 0));
  out.sessionTokens = ClampNonNegativeInt64(static_cast<int64_t>(doc["sessionTokens"] | 0));
  out.weekTokens = ClampNonNegativeInt64(static_cast<int64_t>(doc["weekTokens"] | 0));
  out.totalTokens = ClampNonNegativeInt64(static_cast<int64_t>(doc["totalTokens"] | 0));
  out.hasUsageMode = hasUsageMode;
  out.usageMode = usageMode;
  out.hasTheme = hasTheme;
  out.theme = themeName;
  out.hasThemeSpec = hasThemeSpec;
  out.themeSpecId = themeSpecId;
  out.themeSpecRev = themeSpecRev;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  out.themeSpecRaw = themeSpecRaw;
#endif
  out.hasUpdateAvailable = hasUpdateAvailable;
  out.updateAvailable = updateAvailable;
  out.updateLatestVersion = updateLatestVersion;
  out.updateStatus = updateStatus;
  out.updateLastError = updateLastError;
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
         previous.weekly != next.weekly ||
         previous.sessionTokens != next.sessionTokens ||
         previous.weekTokens != next.weekTokens ||
         previous.totalTokens != next.totalTokens ||
         previous.hasUsageMode != next.hasUsageMode ||
         previous.usageMode != next.usageMode ||
         previous.hasThemeSpec != next.hasThemeSpec ||
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
         previous.themeSpecRaw != next.themeSpecRaw ||
#endif
         previous.hasUpdateAvailable != next.hasUpdateAvailable ||
         previous.updateAvailable != next.updateAvailable ||
         previous.updateLatestVersion != next.updateLatestVersion ||
         previous.updateStatus != next.updateStatus ||
         previous.updateLastError != next.updateLastError;
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

inline bool ConsumeFrameLine(
    RuntimeState& runtimeState,
    const char* line,
    unsigned long nowMillis,
    bool allowTheme,
    SerialConsumeEvent& outEvent) {
  outEvent = {};
  if (line == nullptr || line[0] == '\0') {
    return false;
  }

  Frame next;
  if (!ParseFrameLine(line, allowTheme, next)) {
    return false;
  }

  const Frame previous = runtimeState.current;
  outEvent.hadFrame = runtimeState.hasFrame;
  outEvent.visualChanged = !outEvent.hadFrame || FrameVisualChanged(previous, next);
  outEvent.themeChanged = outEvent.hadFrame && FrameThemeChanged(previous, next);

  if (next.hasThemeSpec) {
    if (runtimeState.cachedThemeRev > 0 &&
        runtimeState.cachedThemeId == next.themeSpecId &&
        runtimeState.cachedThemeRev == next.themeSpecRev) {
      outEvent.themeSpecCacheHit = true;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
      if (next.themeSpecRaw.length() == 0) {
        next.themeSpecRaw = previous.themeSpecRaw;
      }
#endif
    } else {
      runtimeState.cachedThemeId = next.themeSpecId;
      runtimeState.cachedThemeRev = next.themeSpecRev;
      outEvent.themeSpecChanged = true;
      outEvent.visualChanged = true;
    }
  }

  runtimeState.current = next;
  runtimeState.hasFrame = true;
  runtimeState.resetBaseSecs = runtimeState.current.resetSecs;
  runtimeState.resetBaseMillis = nowMillis;
  outEvent.frameAccepted = true;
  return true;
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
    (void)ConsumeFrameLine(runtimeState, lineState.buffer, nowMillis, allowTheme, outEvent);
  }

  lineState.len = 0;
  lineState.overflowed = false;
  return outEvent.frameAccepted;
}

}  // namespace core
}  // namespace codexbar_display
