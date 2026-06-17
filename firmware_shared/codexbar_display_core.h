#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <cstring>

#include "theme_registry.h"

#ifndef CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
#define CODEXBAR_DISPLAY_THEME_SPEC_RENDERER 0
#endif

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
#include "theme_spec_renderer_core.h"
#endif

namespace codexbar_display {
namespace core {

constexpr size_t kFrameLineBufferBytes = 2048;

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
  String activity;
  String timeText;
  String dateText;
  bool hasTheme = false;
  String theme;
  bool clearThemeSpec = false;
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
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  String cachedThemeSpecRaw;
#endif
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
  bool themeSpecPartialRender = false;
  uint32_t themeSpecChangedFields = 0;
};

inline bool KeepLastThemeSpecFrameAfterPartialRenderFailure(const Frame& current, const SerialConsumeEvent& event) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  return event.visualChanged &&
         event.themeSpecPartialRender &&
         current.hasThemeSpec &&
         !current.hasError &&
         !event.themeChanged &&
         !event.themeSpecChanged;
#else
  (void)current;
  (void)event;
  return false;
#endif
}

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

inline bool IsSafeActivityName(const String& value) {
  const size_t len = value.length();
  if (len == 0 || len > 31) {
    return false;
  }
  for (size_t i = 0; i < len; ++i) {
    const char c = value[i];
    const bool valid = (c >= 'a' && c <= 'z') ||
                       (c >= '0' && c <= '9') ||
                       c == '_' ||
                       c == '-';
    if (!valid) {
      return false;
    }
  }
  return true;
}

inline bool UsageProgressChanged(const Frame& previous, const Frame& next) {
  return previous.session != next.session ||
         previous.weekly != next.weekly ||
         previous.sessionTokens != next.sessionTokens ||
         previous.weekTokens != next.weekTokens ||
         previous.totalTokens != next.totalTokens;
}

inline bool ThemeSpecUsesBinding(const String& raw, const char* fullName, const char* compactName) {
  if (fullName != nullptr && raw.indexOf(fullName) >= 0) {
    return true;
  }
  if (compactName == nullptr) {
    return false;
  }
  String compactNeedle = "\"";
  compactNeedle += compactName;
  compactNeedle += "\"";
  return raw.indexOf(compactNeedle.c_str()) >= 0;
}

inline bool ThemeSpecUsesActivity(const String& raw) {
  return ThemeSpecUsesBinding(raw, "activity", "act") ||
         raw.indexOf("stateAssets") >= 0 ||
         raw.indexOf("\"sa\"") >= 0;
}

inline bool ThemeSpecUsesTokenFields(const String& raw) {
  return ThemeSpecUsesBinding(raw, "sessionTokens", "st") ||
         ThemeSpecUsesBinding(raw, "weekTokens", "wt") ||
         ThemeSpecUsesBinding(raw, "totalTokens", "tt");
}

inline bool ThemeSpecRawLooksRenderable(const String& raw) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  return raw.indexOf("primitives") >= 0 || raw.indexOf("\"p\"") >= 0;
#else
  (void)raw;
  return false;
#endif
}

inline const String& EmptyThemeSpecRaw() {
  static const String empty;
  return empty;
}

inline const String& ThemeSpecRawForFrame(const RuntimeState& runtimeState, const Frame& frame) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  if (ThemeSpecRawLooksRenderable(frame.themeSpecRaw)) {
    return frame.themeSpecRaw;
  }
  if (frame.hasThemeSpec &&
      runtimeState.cachedThemeRev > 0 &&
      runtimeState.cachedThemeId == frame.themeSpecId &&
      runtimeState.cachedThemeRev == frame.themeSpecRev &&
      ThemeSpecRawLooksRenderable(runtimeState.cachedThemeSpecRaw)) {
    return runtimeState.cachedThemeSpecRaw;
  }
#else
  (void)runtimeState;
  (void)frame;
#endif
  return EmptyThemeSpecRaw();
}

inline bool FrameTokenStatsVisualChanged(const Frame& previous, const Frame& next, const String& raw) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  if (!next.hasThemeSpec || !ThemeSpecUsesTokenFields(raw)) {
    return false;
  }
  return previous.sessionTokens != next.sessionTokens ||
         previous.weekTokens != next.weekTokens ||
         previous.totalTokens != next.totalTokens;
#else
  (void)previous;
  (void)next;
  return false;
#endif
}

inline bool FrameThemeSpecDataVisualChanged(const Frame& previous, const Frame& next, const String& raw) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  const bool usesLabel = ThemeSpecUsesBinding(raw, "label", "l");
  return (ThemeSpecUsesBinding(raw, "provider", "pr") && previous.provider != next.provider) ||
         (usesLabel && (previous.label != next.label || previous.updateAvailable != next.updateAvailable)) ||
         (ThemeSpecUsesBinding(raw, "session", "s") && previous.session != next.session) ||
         (ThemeSpecUsesBinding(raw, "weekly", "w") && previous.weekly != next.weekly) ||
         (ThemeSpecUsesBinding(raw, "reset", "r") && previous.resetSecs != next.resetSecs) ||
         (ThemeSpecUsesBinding(raw, "usageMode", "u") &&
          (previous.hasUsageMode != next.hasUsageMode || previous.usageMode != next.usageMode)) ||
         (ThemeSpecUsesActivity(raw) && previous.activity != next.activity) ||
         (ThemeSpecUsesBinding(raw, "time", "tm") && previous.timeText != next.timeText) ||
         (ThemeSpecUsesBinding(raw, "date", "dt") && previous.dateText != next.dateText) ||
         FrameTokenStatsVisualChanged(previous, next, raw);
#else
  (void)previous;
  (void)next;
  (void)raw;
  return false;
#endif
}

inline uint32_t ThemeSpecLiveChangedFields(const Frame& previous, const Frame& next) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  uint32_t fields = 0;
  if (previous.provider != next.provider) {
    fields |= themespec::kThemeSpecFieldProvider;
  }
  if (previous.label != next.label) {
    fields |= themespec::kThemeSpecFieldLabel;
  }
  if (previous.updateAvailable != next.updateAvailable) {
    fields |= themespec::kThemeSpecFieldLabel;
  }
  if (previous.session != next.session) {
    fields |= themespec::kThemeSpecFieldSession;
  }
  if (previous.weekly != next.weekly) {
    fields |= themespec::kThemeSpecFieldWeekly;
  }
  if (previous.resetSecs != next.resetSecs) {
    fields |= themespec::kThemeSpecFieldReset;
  }
  if (previous.hasUsageMode != next.hasUsageMode || previous.usageMode != next.usageMode) {
    fields |= themespec::kThemeSpecFieldUsageMode;
  }
  if (previous.activity != next.activity) {
    fields |= themespec::kThemeSpecFieldActivity;
  }
  if (previous.timeText != next.timeText) {
    fields |= themespec::kThemeSpecFieldTime;
  }
  if (previous.dateText != next.dateText) {
    fields |= themespec::kThemeSpecFieldDate;
  }
  if (previous.sessionTokens != next.sessionTokens) {
    fields |= themespec::kThemeSpecFieldSessionTokens;
  }
  if (previous.weekTokens != next.weekTokens) {
    fields |= themespec::kThemeSpecFieldWeekTokens;
  }
  if (previous.totalTokens != next.totalTokens) {
    fields |= themespec::kThemeSpecFieldTotalTokens;
  }
  return fields;
#else
  (void)previous;
  (void)next;
  return 0;
#endif
}

inline bool ThemeSpecCanUsePartialRender(
    const Frame& previous,
    const Frame& next,
    const String& themeSpecRaw,
    bool hadFrame,
    bool visualChanged,
    bool themeChanged,
    bool themeSpecChanged) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  if (!hadFrame || !visualChanged || themeChanged || themeSpecChanged || previous.hasError || next.hasError) {
    return false;
  }
  if (!previous.hasThemeSpec || !next.hasThemeSpec || next.clearThemeSpec) {
    return false;
  }
  if (previous.themeSpecId != next.themeSpecId ||
      previous.themeSpecRev != next.themeSpecRev ||
      !ThemeSpecRawLooksRenderable(themeSpecRaw)) {
    return false;
  }
  if (previous.clearThemeSpec != next.clearThemeSpec) {
    return false;
  }
  return ThemeSpecLiveChangedFields(previous, next) != 0;
#else
  (void)previous;
  (void)next;
  (void)themeSpecRaw;
  (void)hadFrame;
  (void)visualChanged;
  (void)themeChanged;
  (void)themeSpecChanged;
  return false;
#endif
}

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
inline bool ExtractJsonObjectRaw(const char* json, const char* key, String& out) {
  out = "";
  if (json == nullptr || key == nullptr) {
    return false;
  }

  const char* keyPos = std::strstr(json, key);
  if (keyPos == nullptr) {
    return false;
  }
  const char* cursor = keyPos + std::strlen(key);
  while (*cursor == ' ' || *cursor == '\t' || *cursor == '\r' || *cursor == '\n') {
    ++cursor;
  }
  if (*cursor != ':') {
    return false;
  }
  ++cursor;
  while (*cursor == ' ' || *cursor == '\t' || *cursor == '\r' || *cursor == '\n') {
    ++cursor;
  }
  if (*cursor != '{') {
    return false;
  }

  const char* start = cursor;
  int depth = 0;
  bool inString = false;
  bool escaped = false;
  for (; *cursor != '\0'; ++cursor) {
    const char c = *cursor;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c == '\\') {
        escaped = true;
      } else if (c == '"') {
        inString = false;
      }
      continue;
    }

    if (c == '"') {
      inString = true;
    } else if (c == '{') {
      ++depth;
    } else if (c == '}') {
      --depth;
      if (depth == 0) {
        for (const char* p = start; p <= cursor; ++p) {
          out += *p;
        }
        return true;
      }
    }
  }
  out = "";
  return false;
}
#endif

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
  bool clearThemeSpec = false;
  const bool confirmClearThemeSpec = doc["confirmClearThemeSpec"].is<bool>() &&
                                     doc["confirmClearThemeSpec"].as<bool>();
  String themeSpecId;
  int themeSpecRev = 0;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  String themeSpecRaw;
#endif
  if (confirmClearThemeSpec &&
      std::strstr(line, "\"themeSpec\"") != nullptr &&
      doc["themeSpec"].isNull()) {
    clearThemeSpec = true;
  }
  if (doc["themeSpec"].is<JsonObjectConst>()) {
    JsonObjectConst spec = doc["themeSpec"].as<JsonObjectConst>();
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    (void)ExtractJsonObjectRaw(line, "\"themeSpec\"", themeSpecRaw);
#endif
    const char* themeId = nullptr;
    if (spec["themeId"].is<const char*>()) {
      themeId = spec["themeId"].as<const char*>();
    } else if (spec["id"].is<const char*>()) {
      themeId = spec["id"].as<const char*>();
    }
    if (themeId != nullptr) {
      themeSpecId = String(themeId);
      themeSpecId.trim();
    }
    themeSpecRev = static_cast<int>(spec["themeRev"] | spec["rev"] | 0);
    hasThemeSpec = (themeSpecId.length() > 0 && themeSpecRev > 0);

    const char* fallback = nullptr;
    if (spec["fallbackTheme"].is<const char*>()) {
      fallback = spec["fallbackTheme"].as<const char*>();
    } else if (spec["fb"].is<const char*>()) {
      fallback = spec["fb"].as<const char*>();
    }
    if (allowTheme && !hasTheme && fallback != nullptr) {
      String fallbackTheme;
      if (theme::NormalizeThemeName(String(fallback), fallbackTheme)) {
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

  String activity;
  if (doc["activity"].is<const char*>()) {
    activity = String(doc["activity"].as<const char*>());
    activity.trim();
    activity.toLowerCase();
    if (!IsSafeActivityName(activity)) {
      activity = "";
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
    out.activity = activity;
    out.timeText = String(doc["time"] | "");
    out.dateText = String(doc["date"] | "");
    out.hasTheme = hasTheme;
    out.theme = themeName;
    out.clearThemeSpec = clearThemeSpec;
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
  out.timeText = String(doc["time"] | "");
  out.dateText = String(doc["date"] | "");
  out.sessionTokens = ClampNonNegativeInt64(static_cast<int64_t>(doc["sessionTokens"] | 0));
  out.weekTokens = ClampNonNegativeInt64(static_cast<int64_t>(doc["weekTokens"] | 0));
  out.totalTokens = ClampNonNegativeInt64(static_cast<int64_t>(doc["totalTokens"] | 0));
  out.hasUsageMode = hasUsageMode;
  out.usageMode = usageMode;
  out.activity = activity;
  out.hasTheme = hasTheme;
  out.theme = themeName;
  out.clearThemeSpec = clearThemeSpec;
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

inline bool FrameVisualChangedWithThemeSpecRaw(const Frame& previous, const Frame& next, const String& themeSpecRaw) {
  if (previous.hasError != next.hasError) {
    return true;
  }
  if (next.hasError) {
    return previous.error != next.error;
  }
  const bool dataChanged = next.hasThemeSpec
                               ? FrameThemeSpecDataVisualChanged(previous, next, themeSpecRaw)
                               : previous.provider != next.provider ||
                                     previous.label != next.label ||
                                     previous.session != next.session ||
                                     previous.weekly != next.weekly ||
                                     previous.sessionTokens != next.sessionTokens ||
                                     previous.weekTokens != next.weekTokens ||
                                     previous.totalTokens != next.totalTokens ||
                                     previous.hasUsageMode != next.hasUsageMode ||
                                     previous.usageMode != next.usageMode ||
                                     previous.activity != next.activity ||
                                     previous.timeText != next.timeText ||
                                     previous.dateText != next.dateText;
  const bool themeIdentityChanged =
         previous.clearThemeSpec != next.clearThemeSpec ||
         previous.hasThemeSpec != next.hasThemeSpec ||
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
         previous.themeSpecId != next.themeSpecId ||
         previous.themeSpecRev != next.themeSpecRev ||
#endif
         false;
  if (next.hasThemeSpec) {
    return dataChanged || themeIdentityChanged;
  }
  return dataChanged ||
         themeIdentityChanged ||
         previous.hasUpdateAvailable != next.hasUpdateAvailable ||
         previous.updateAvailable != next.updateAvailable ||
         previous.updateLatestVersion != next.updateLatestVersion ||
         previous.updateStatus != next.updateStatus ||
         previous.updateLastError != next.updateLastError;
}

inline bool FrameVisualChanged(const Frame& previous, const Frame& next) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  return FrameVisualChangedWithThemeSpecRaw(previous, next, next.themeSpecRaw);
#else
  return FrameVisualChangedWithThemeSpecRaw(previous, next, EmptyThemeSpecRaw());
#endif
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

inline void ApplyThemeSpecCache(RuntimeState& runtimeState, const Frame& previous, Frame& next, SerialConsumeEvent& outEvent) {
  if (next.hasError) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    if (previous.hasThemeSpec) {
      next = previous;
      next.themeSpecRaw = "";
      outEvent.themeSpecCacheHit = true;
    } else if (runtimeState.cachedThemeRev > 0 &&
               ThemeSpecRawLooksRenderable(runtimeState.cachedThemeSpecRaw)) {
      next = previous;
      next.hasError = false;
      next.error = "";
      next.clearThemeSpec = false;
      next.hasThemeSpec = true;
      next.themeSpecId = runtimeState.cachedThemeId;
      next.themeSpecRev = runtimeState.cachedThemeRev;
      next.themeSpecRaw = "";
      outEvent.themeSpecCacheHit = true;
    }
#endif
    return;
  }

  if (next.clearThemeSpec) {
    runtimeState.cachedThemeId = "";
    runtimeState.cachedThemeRev = 0;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    runtimeState.cachedThemeSpecRaw = "";
    next.themeSpecRaw = "";
#endif
    next.hasThemeSpec = false;
    next.themeSpecId = "";
    next.themeSpecRev = 0;
    outEvent.themeSpecChanged = true;
    return;
  }

  if (next.hasThemeSpec) {
    const bool samePreviousTheme = previous.hasThemeSpec &&
                                   previous.themeSpecId == next.themeSpecId &&
                                   previous.themeSpecRev == next.themeSpecRev;
    const bool sameCachedTheme = runtimeState.cachedThemeRev > 0 &&
                                 runtimeState.cachedThemeId == next.themeSpecId &&
                                 runtimeState.cachedThemeRev == next.themeSpecRev;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    const bool nextHasRenderableRaw = ThemeSpecRawLooksRenderable(next.themeSpecRaw);
    if (nextHasRenderableRaw) {
      runtimeState.cachedThemeId = next.themeSpecId;
      runtimeState.cachedThemeRev = next.themeSpecRev;
      runtimeState.cachedThemeSpecRaw = next.themeSpecRaw;
      return;
    }

    if (sameCachedTheme && ThemeSpecRawLooksRenderable(runtimeState.cachedThemeSpecRaw)) {
      next.themeSpecRaw = "";
      outEvent.themeSpecCacheHit = true;
      return;
    }

    if (samePreviousTheme) {
      if (ThemeSpecRawLooksRenderable(previous.themeSpecRaw)) {
        runtimeState.cachedThemeId = previous.themeSpecId;
        runtimeState.cachedThemeRev = previous.themeSpecRev;
        runtimeState.cachedThemeSpecRaw = previous.themeSpecRaw;
      }
      next.themeSpecRaw = "";
      outEvent.themeSpecCacheHit = true;
      return;
    }

    if (runtimeState.cachedThemeRev > 0 && ThemeSpecRawLooksRenderable(runtimeState.cachedThemeSpecRaw)) {
      next.hasThemeSpec = true;
      next.themeSpecId = runtimeState.cachedThemeId;
      next.themeSpecRev = runtimeState.cachedThemeRev;
      next.themeSpecRaw = "";
      outEvent.themeSpecCacheHit = true;
      return;
    }

    if (previous.hasThemeSpec && ThemeSpecRawLooksRenderable(previous.themeSpecRaw)) {
        next.hasThemeSpec = true;
        next.themeSpecId = previous.themeSpecId;
        next.themeSpecRev = previous.themeSpecRev;
        runtimeState.cachedThemeId = previous.themeSpecId;
        runtimeState.cachedThemeRev = previous.themeSpecRev;
        runtimeState.cachedThemeSpecRaw = previous.themeSpecRaw;
        next.themeSpecRaw = "";
        outEvent.themeSpecCacheHit = true;
      return;
    }

    next.hasThemeSpec = false;
    next.themeSpecId = "";
    next.themeSpecRev = 0;
    next.themeSpecRaw = "";
#else
    if (sameCachedTheme || samePreviousTheme) {
      outEvent.themeSpecCacheHit = true;
    } else {
      runtimeState.cachedThemeId = next.themeSpecId;
      runtimeState.cachedThemeRev = next.themeSpecRev;
      outEvent.themeSpecChanged = true;
    }
#endif
    return;
  }

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  if (runtimeState.cachedThemeRev > 0 && ThemeSpecRawLooksRenderable(runtimeState.cachedThemeSpecRaw)) {
    next.hasThemeSpec = true;
    next.themeSpecId = runtimeState.cachedThemeId;
    next.themeSpecRev = runtimeState.cachedThemeRev;
    next.themeSpecRaw = "";
    outEvent.themeSpecCacheHit = true;
  }
#endif
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
  ApplyThemeSpecCache(runtimeState, previous, next, outEvent);
  if (!next.hasError && next.activity.length() == 0) {
    next.activity = runtimeState.hasFrame && UsageProgressChanged(previous, next) ? "coding" : "idle";
  }

  outEvent.hadFrame = runtimeState.hasFrame;
  const String& themeSpecRaw = ThemeSpecRawForFrame(runtimeState, next);
  outEvent.visualChanged = !outEvent.hadFrame || FrameVisualChangedWithThemeSpecRaw(previous, next, themeSpecRaw) || outEvent.themeSpecChanged;
  outEvent.themeChanged = outEvent.hadFrame && FrameThemeChanged(previous, next);
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  outEvent.themeSpecChangedFields = ThemeSpecLiveChangedFields(previous, next);
  outEvent.themeSpecPartialRender = ThemeSpecCanUsePartialRender(
      previous,
      next,
      themeSpecRaw,
      outEvent.hadFrame,
      outEvent.visualChanged,
      outEvent.themeChanged,
      outEvent.themeSpecChanged);
#endif

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
