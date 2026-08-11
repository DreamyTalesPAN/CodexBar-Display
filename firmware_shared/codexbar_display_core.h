#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <cstdio>
#include <cstring>

#include "usage_window_contract.h"

#ifndef CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
#define CODEXBAR_DISPLAY_THEME_SPEC_RENDERER 0
#endif

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
#include "theme_spec_renderer_core.h"
#endif

#include "device_clock.h"

namespace codexbar_display {
namespace core {

constexpr size_t kFrameLineBufferBytes = 2048;
constexpr size_t kProviderWireBytes = 32;
constexpr size_t kProviderLabelWireBytes = 24;
constexpr size_t kUsageWindowIDWireBytes = 32;
constexpr size_t kUsageWindowLabelWireBytes = 24;
constexpr size_t kUsageWindowPercentWireDigits = 3;
constexpr size_t kUsageWindowResetSecsWireDigits = 19;
constexpr size_t kUsageWindowObjectSyntaxBytes =
    sizeof("{\"id\":\"\",\"label\":\"\",\"percent\":,\"resetSecs\":}") - 1;
constexpr size_t kUsageWindowWireBudgetBytes =
    kUsageWindowObjectSyntaxBytes +
    kUsageWindowIDWireBytes +
    kUsageWindowLabelWireBytes +
    kUsageWindowPercentWireDigits +
    kUsageWindowResetSecsWireDigits;
constexpr size_t kUsageWindowWireBudgetWithCommaBytes = kUsageWindowWireBudgetBytes + 1;
constexpr size_t kUsageWindowJSONStringWorstCaseExpansionBytes = 6;
constexpr size_t kProviderEscapedWireBytes =
    kProviderWireBytes * kUsageWindowJSONStringWorstCaseExpansionBytes;
constexpr size_t kProviderLabelEscapedWireBytes =
    kProviderLabelWireBytes * kUsageWindowJSONStringWorstCaseExpansionBytes;
constexpr size_t kUsageWindowEscapedIDWireBytes =
    kUsageWindowIDWireBytes * kUsageWindowJSONStringWorstCaseExpansionBytes;
constexpr size_t kUsageWindowEscapedLabelWireBytes =
    kUsageWindowLabelWireBytes * kUsageWindowJSONStringWorstCaseExpansionBytes;
constexpr size_t kAdvertisedUsageWindowWireBudgetBytes =
    kUsageWindowObjectSyntaxBytes +
    kUsageWindowEscapedIDWireBytes +
    kUsageWindowEscapedLabelWireBytes +
    kUsageWindowPercentWireDigits +
    kUsageWindowResetSecsWireDigits;
constexpr size_t kAdvertisedUsageWindowWireBudgetWithCommaBytes =
    kAdvertisedUsageWindowWireBudgetBytes + 1;
constexpr size_t kUsageWindowFrameOverheadBytes =
    (sizeof("{\"v\":2,\"provider\":\"\",\"label\":\"\",\"session\":,\"weekly\":,\"resetSecs\":,\"usageMode\":\"remaining\",\"usageWindows\":[]}\n") - 1) +
    kUsageWindowPercentWireDigits +
    kUsageWindowPercentWireDigits +
    kUsageWindowResetSecsWireDigits;
static_assert(kFrameLineBufferBytes > kUsageWindowFrameOverheadBytes, "usage window frame overhead must fit");
constexpr size_t kUsageWindowFrameOverheadWithProviderBytes =
    kUsageWindowFrameOverheadBytes +
    kProviderWireBytes +
    kProviderLabelWireBytes;
static_assert(kFrameLineBufferBytes > kUsageWindowFrameOverheadWithProviderBytes, "usage window frame overhead with provider text must fit");
constexpr size_t kMaxUsageWindows = usage_window_contract::kMaxWindows;
static_assert(
    kUsageWindowFrameOverheadWithProviderBytes + (kMaxUsageWindows * kUsageWindowWireBudgetWithCommaBytes) - 1 <= kFrameLineBufferBytes,
    "normal usage window parser capacity must fit max frame bytes");
constexpr size_t kAdvertisedUsageWindowFrameOverheadBytes =
    kUsageWindowFrameOverheadBytes +
    kProviderEscapedWireBytes +
    kProviderLabelEscapedWireBytes;
constexpr size_t kAdvertisedMaxUsageWindows = usage_window_contract::kMaxWindows;
static_assert(kAdvertisedMaxUsageWindows > 0, "advertised usage window capability must be positive");
static_assert(
    kAdvertisedUsageWindowFrameOverheadBytes + (kAdvertisedMaxUsageWindows * kAdvertisedUsageWindowWireBudgetWithCommaBytes) - 1 <= kFrameLineBufferBytes,
    "advertised usage window capability must fit escaped max frame bytes");

struct UsageWindow {
  String id;
  String label;
  int percent = 0;
  int64_t resetSecs = 0;
  bool available = false;
};

// How long a collected reset deadline stays trustworthy without fresh data.
// Mirrors protocol.ResetTrustHorizon on the host side.
constexpr int64_t kResetTrustHorizonSecs = 5 * 60 * 60;

// A basis older than this is no longer "live", no matter what the host claimed.
// The host is required to send at least every 60 seconds, so this allows two
// missed sends before the device downgrades the state it shows.
constexpr int64_t kResetLiveMaxAgeSecs = 150;

// A self-initiated restart costs boot plus WiFi association time that the
// device cannot measure without a wall clock. Charged to the restored deadline
// so a handover can only ever under-report the remaining time.
constexpr int64_t kResetRestartDowntimeSecs = 30;

// Trust in the reset deadline. The device has no wall clock, so every value is
// a seconds count valid at the instant a frame arrived and ticked down with the
// device's own monotonic clock. The host value is the best case; the device
// re-evaluates it locally and may only downgrade it, never upgrade it.
enum class ResetTrust : uint8_t {
  kUnknown = 0,  // frame predates the trust contract: legacy local countdown
  kLive = 1,
  kOffline = 2,
  kStale = 3,
};

struct Frame {
  String provider;
  String label;
  int session = 0;
  int weekly = 0;
  int64_t resetSecs = 0;
  // Freshness contract fields. `resetAgeSecs` is not parsed: it is exactly
  // `kResetTrustHorizonSecs - resetTrustSecs`, so the device derives it.
  int64_t resetTrustSecs = 0;
  String resetSource;
  ResetTrust resetTrust = ResetTrust::kUnknown;
  // False for frames that say nothing about the deadline (a ThemeSpec-only
  // apply frame, for example). Those must not change the stored trust state.
  bool hasResetFields = false;
  bool usageUnavailable = false;
  UsageWindow usageWindows[kMaxUsageWindows];
  bool sessionUnavailable = false;
  bool weeklyUnavailable = false;
  int64_t sessionTokens = 0;
  int64_t weekTokens = 0;
  int64_t totalTokens = 0;
  // True only when the frame carried token totals on the wire. Absent totals
  // must never render as a fabricated 0.
  bool hasTokenTotals = false;
  bool hasUsageMode = false;
  String usageMode;
  String activity;
  // Pre-formatted Companion clock strings. Fallback only: the device clock
  // (firmware_shared/device_clock.h) owns {time}/{date} once SNTP answered, and
  // these strings are dropped as soon as they stop being current. Repainting
  // the clock is driven by the resolved text, not by these fields changing.
  String timeText;
  String dateText;
  // True when the frame carries a validated current offset. A non-zero
  // transition epoch then carries the optional next two transitions.
  bool hasClockSchedule = false;
  int16_t clockOffsetMinutes = 0;
  int64_t clockTransitionEpoch = 0;
  int16_t clockTransitionOffsetMinutes = 0;
  int64_t clockFollowingTransitionEpoch = 0;
  int16_t clockFollowingTransitionOffsetMinutes = 0;
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

// The deadline the device is willing to stand behind, anchored to the device's
// own monotonic clock. Everything the renderer shows for `reset` is derived
// from this, so a countdown the device cannot justify cannot reach a theme.
struct ResetTrustState {
  bool hasDeadline = false;
  // True once a contract-aware frame was seen: the trust budget is enforced.
  // Legacy frames keep the old unbounded local countdown.
  bool enforced = false;
  bool hostLive = false;
  int64_t deadlineSecs = 0;  // remaining at baseMillis
  int64_t trustSecs = 0;     // remaining budget at baseMillis, if enforced
  unsigned long baseMillis = 0;
  String source;
};

struct RuntimeState {
  Frame current;
  bool hasFrame = false;
  ResetTrustState reset;
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
  bool themeSpecChanged = false;
  bool themeSpecCacheHit = false;
  bool themeSpecPartialRender = false;
  // The frame moved the usage numbers, which is the only signal the device has
  // that someone is coding. Standby uses it as its activity clock.
  bool usageProgressed = false;
  uint32_t themeSpecChangedFields = 0;
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

inline int64_t ResetElapsedSecs(const ResetTrustState& state, unsigned long nowMillis) {
  return static_cast<int64_t>((nowMillis - state.baseMillis) / 1000UL);
}

inline int64_t ResetDeadlineSecs(const ResetTrustState& state, unsigned long nowMillis) {
  if (!state.hasDeadline) {
    return 0;
  }
  const int64_t remain = state.deadlineSecs - ResetElapsedSecs(state, nowMillis);
  return remain > 0 ? remain : 0;
}

inline int64_t ResetTrustBudgetSecs(const ResetTrustState& state, unsigned long nowMillis) {
  if (!state.enforced) {
    return kResetTrustHorizonSecs;
  }
  const int64_t remain = state.trustSecs - ResetElapsedSecs(state, nowMillis);
  return remain > 0 ? remain : 0;
}

inline int64_t ResetBasisAgeSecs(const ResetTrustState& state, unsigned long nowMillis) {
  return kResetTrustHorizonSecs - ResetTrustBudgetSecs(state, nowMillis);
}

inline ResetTrust CurrentResetTrust(const ResetTrustState& state, unsigned long nowMillis) {
  if (!state.hasDeadline ||
      ResetDeadlineSecs(state, nowMillis) <= 0 ||
      ResetTrustBudgetSecs(state, nowMillis) <= 0) {
    return ResetTrust::kStale;
  }
  if (!state.enforced) {
    return ResetTrust::kUnknown;
  }
  if (!state.hostLive || ResetBasisAgeSecs(state, nowMillis) > kResetLiveMaxAgeSecs) {
    return ResetTrust::kOffline;
  }
  return ResetTrust::kLive;
}

inline const char* ResetTrustName(ResetTrust trust) {
  switch (trust) {
    case ResetTrust::kLive:
      return "live";
    case ResetTrust::kOffline:
      return "offline";
    case ResetTrust::kStale:
      return "stale";
    default:
      return "unknown";
  }
}

inline int64_t CurrentRemainingSecs(const RuntimeState& state, unsigned long nowMillis) {
  if (!state.hasFrame || CurrentResetTrust(state.reset, nowMillis) == ResetTrust::kStale) {
    return 0;
  }
  return ResetDeadlineSecs(state.reset, nowMillis);
}

inline int64_t CurrentUsageWindowRemainingSecs(
    const RuntimeState& state,
    size_t slotIndex,
    unsigned long nowMillis) {
  if (!state.hasFrame ||
      CurrentResetTrust(state.reset, nowMillis) == ResetTrust::kStale ||
      slotIndex >= kMaxUsageWindows ||
      !state.current.usageWindows[slotIndex].available) {
    return 0;
  }
  const unsigned long elapsedMillis = nowMillis - state.resetBaseMillis;
  const int64_t elapsedSecs = static_cast<int64_t>(elapsedMillis / 1000UL);
  const int64_t remain = state.current.usageWindows[slotIndex].resetSecs - elapsedSecs;
  return remain < 0 ? 0 : remain;
}

inline bool IsSafeIdentifier(const String& value, bool allowSourceChars) {
  const size_t len = value.length();
  if (len == 0 || len > 31) {
    return false;
  }
  for (size_t i = 0; i < len; ++i) {
    const char c = value[i];
    const bool valid = (c >= 'a' && c <= 'z') ||
                       (c >= '0' && c <= '9') ||
                       c == '_' ||
                       c == '-' ||
                       (allowSourceChars && (c == ':' || c == '.'));
    if (!valid) {
      return false;
    }
  }
  return true;
}

inline bool IsSafeActivityName(const String& value) {
  return IsSafeIdentifier(value, false);
}

inline ResetTrust ParseResetTrustName(const String& value) {
  if (value == "live") {
    return ResetTrust::kLive;
  }
  if (value == "offline") {
    return ResetTrust::kOffline;
  }
  if (value == "stale") {
    return ResetTrust::kStale;
  }
  return ResetTrust::kUnknown;
}

inline void ApplyFrameResetTrust(ResetTrustState& state, const Frame& frame, unsigned long nowMillis) {
  if (frame.hasError || !frame.hasResetFields) {
    return;
  }

  const bool enforced = frame.resetTrust != ResetTrust::kUnknown;
  int64_t deadlineSecs = frame.resetSecs;
  int64_t trustSecs = enforced ? frame.resetTrustSecs : 0;
  if (enforced && frame.resetTrust == ResetTrust::kOffline &&
      state.enforced && state.hasDeadline && state.source == frame.resetSource) {
    const int64_t heldDeadline = ResetDeadlineSecs(state, nowMillis);
    const int64_t heldTrust = ResetTrustBudgetSecs(state, nowMillis);
    if (deadlineSecs > heldDeadline) {
      deadlineSecs = heldDeadline;
    }
    if (trustSecs > heldTrust) {
      trustSecs = heldTrust;
    }
  }

  const bool usable = deadlineSecs > 0 &&
                      frame.resetTrust != ResetTrust::kStale &&
                      (!enforced || (trustSecs > 0 && frame.resetSource.length() > 0));
  state = ResetTrustState{};
  state.enforced = enforced;
  state.baseMillis = nowMillis;
  if (!usable) {
    return;
  }
  state.hasDeadline = true;
  state.hostLive = frame.resetTrust == ResetTrust::kLive;
  state.deadlineSecs = deadlineSecs;
  state.trustSecs = trustSecs;
  state.source = frame.resetSource;
}

inline String EncodeResetTrustRecord(const ResetTrustState& state, unsigned long nowMillis) {
  const int64_t deadlineSecs = ResetDeadlineSecs(state, nowMillis);
  const int64_t trustSecs = ResetTrustBudgetSecs(state, nowMillis);
  if (!state.enforced || !state.hasDeadline || deadlineSecs <= 0 || trustSecs <= 0) {
    return String();
  }
  String out = "1 ";
  out += String(static_cast<long>(deadlineSecs));
  out += " ";
  out += String(static_cast<long>(trustSecs));
  out += " ";
  out += state.source;
  return out;
}

inline bool DecodeResetTrustRecord(
    const String& raw,
    int64_t downtimeSecs,
    unsigned long nowMillis,
    ResetTrustState& out) {
  out = ResetTrustState{};
  const int firstSpace = raw.indexOf(' ');
  const int secondSpace = firstSpace < 0 ? -1 : raw.indexOf(' ', firstSpace + 1);
  const int thirdSpace = secondSpace < 0 ? -1 : raw.indexOf(' ', secondSpace + 1);
  if (thirdSpace < 0 || raw.substring(0, firstSpace) != "1") {
    return false;
  }

  String source = raw.substring(thirdSpace + 1);
  source.trim();
  if (!IsSafeIdentifier(source, true)) {
    return false;
  }
  const int64_t deadlineSecs =
      static_cast<int64_t>(raw.substring(firstSpace + 1, secondSpace).toInt()) - downtimeSecs;
  const int64_t trustSecs =
      static_cast<int64_t>(raw.substring(secondSpace + 1, thirdSpace).toInt()) - downtimeSecs;
  if (deadlineSecs <= 0 || trustSecs <= 0 || trustSecs > kResetTrustHorizonSecs) {
    return false;
  }

  out.hasDeadline = true;
  out.enforced = true;
  out.hostLive = false;
  out.deadlineSecs = deadlineSecs;
  out.trustSecs = trustSecs;
  out.baseMillis = nowMillis;
  out.source = source;
  return true;
}

inline bool UsageWindowChanged(const UsageWindow& previous, const UsageWindow& next) {
  return previous.id != next.id ||
         previous.label != next.label ||
         previous.percent != next.percent ||
         previous.resetSecs != next.resetSecs ||
         previous.available != next.available;
}

inline bool UsagePercentProgressed(
    const Frame& previous,
    const Frame& next,
    int previousPercent,
    int nextPercent) {
  if (previous.hasUsageMode != next.hasUsageMode ||
      previous.usageMode != next.usageMode) {
    return false;
  }
  return next.usageMode == "remaining"
             ? nextPercent < previousPercent
             : nextPercent > previousPercent;
}

inline bool UsageProgressChanged(const Frame& previous, const Frame& next) {
  const bool usageAvailable = !previous.usageUnavailable && !next.usageUnavailable;
  if (!usageAvailable || previous.provider != next.provider) {
    return false;
  }

  bool previousHasWindows = false;
  bool nextHasWindows = false;
  for (size_t i = 0; i < kMaxUsageWindows; ++i) {
    previousHasWindows = previousHasWindows || previous.usageWindows[i].available;
    nextHasWindows = nextHasWindows || next.usageWindows[i].available;
  }
  if (!previousHasWindows && !nextHasWindows &&
      ((!previous.sessionUnavailable && !next.sessionUnavailable &&
        UsagePercentProgressed(previous, next, previous.session, next.session)) ||
       (!previous.weeklyUnavailable && !next.weeklyUnavailable &&
        UsagePercentProgressed(previous, next, previous.weekly, next.weekly)))) {
    return true;
  }

  for (size_t previousIndex = 0; previousIndex < kMaxUsageWindows; ++previousIndex) {
    // Countdown, label and availability changes redraw the theme, but do not
    // mean that the customer used their provider.
    if (!previous.usageWindows[previousIndex].available) {
      continue;
    }
    for (size_t nextIndex = 0; nextIndex < kMaxUsageWindows; ++nextIndex) {
      if (next.usageWindows[nextIndex].available &&
          previous.usageWindows[previousIndex].id == next.usageWindows[nextIndex].id &&
          UsagePercentProgressed(
              previous,
              next,
              previous.usageWindows[previousIndex].percent,
              next.usageWindows[nextIndex].percent)) {
        return true;
      }
    }
  }
  // Token totals come from history scans. Expiry and recovery can change them
  // without any provider consumption, so they must not drive standby activity.
  return false;
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

inline bool ThemeSpecRawCompiles(const String& raw) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  JsonDocument doc;
  themespec::CompiledThemeSpec scene;
  const bool ok = themespec::CompileThemeSpec(raw.c_str(), doc, scene);
  themespec::ReleaseCompiledThemeSpec(scene);
  return ok;
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

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
inline bool ThemeSpecJsonWhitespace(char ch) {
  return ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t';
}

inline bool ThemeSpecRawHasJsonNumber(const String& raw, const char* key, unsigned expected) {
  char quotedKey[24] = {0};
  std::snprintf(quotedKey, sizeof(quotedKey), "\"%s\"", key);

  const char* pos = std::strstr(raw.c_str(), quotedKey);
  while (pos != nullptr) {
    const char* cursor = pos + std::strlen(quotedKey);
    while (ThemeSpecJsonWhitespace(*cursor)) {
      ++cursor;
    }
    if (*cursor == ':') {
      ++cursor;
      while (ThemeSpecJsonWhitespace(*cursor)) {
        ++cursor;
      }

      unsigned value = 0;
      bool hasDigit = false;
      while (*cursor != '\0') {
        if (*cursor < '0' || *cursor > '9') {
          break;
        }
        hasDigit = true;
        value = (value * 10U) + static_cast<unsigned>(*cursor - '0');
        ++cursor;
      }
      if (hasDigit && value == expected) {
        return true;
      }
    }
    pos = std::strstr(pos + 1, quotedKey);
  }
  return false;
}

inline bool ThemeSpecUsesUsageWindowBinding(const String& raw, size_t slotIndex) {
  char longName[16] = {0};
  char indexedName[16] = {0};
  char compactPrefix[8] = {0};
  char compactTemplate[8] = {0};
  std::snprintf(longName, sizeof(longName), "usageSlot%u", static_cast<unsigned>(slotIndex + 1));
  std::snprintf(indexedName, sizeof(indexedName), "usage.%u.", static_cast<unsigned>(slotIndex));
  std::snprintf(compactPrefix, sizeof(compactPrefix), "\"us%u", static_cast<unsigned>(slotIndex + 1));
  std::snprintf(compactTemplate, sizeof(compactTemplate), "{us%u", static_cast<unsigned>(slotIndex + 1));
  return raw.indexOf(longName) >= 0 ||
         raw.indexOf(indexedName) >= 0 ||
         raw.indexOf(compactPrefix) >= 0 ||
         raw.indexOf(compactTemplate) >= 0 ||
         ThemeSpecRawHasJsonNumber(raw, "ui", static_cast<unsigned>(slotIndex)) ||
         ThemeSpecRawHasJsonNumber(raw, "usageIndex", static_cast<unsigned>(slotIndex)) ||
         ThemeSpecRawHasJsonNumber(raw, "sl", static_cast<unsigned>(slotIndex + 1)) ||
         ThemeSpecRawHasJsonNumber(raw, "slot", static_cast<unsigned>(slotIndex + 1));
}

inline bool ThemeSpecUsesUsageWindowResetBinding(const String& raw, size_t slotIndex) {
  char longName[24] = {0};
  char indexedName[24] = {0};
  char compactName[8] = {0};
  std::snprintf(longName, sizeof(longName), "usageSlot%uReset", static_cast<unsigned>(slotIndex + 1));
  std::snprintf(indexedName, sizeof(indexedName), "usage.%u.reset", static_cast<unsigned>(slotIndex));
  std::snprintf(compactName, sizeof(compactName), "us%ur", static_cast<unsigned>(slotIndex + 1));
  return raw.indexOf(longName) >= 0 || raw.indexOf(indexedName) >= 0 || raw.indexOf(compactName) >= 0;
}

inline bool RemainingMinuteBucketChanged(int64_t remainingSecs, int64_t lastRenderedMinuteBucket) {
  return remainingSecs / 60 != lastRenderedMinuteBucket;
}

inline uint32_t ThemeSpecUsageWindowField(size_t slotIndex) {
  (void)slotIndex;
  return themespec::kThemeSpecFieldUsageWindows;
}
#endif

inline bool FrameThemeSpecDataVisualChanged(const Frame& previous, const Frame& next, const String& raw) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  const bool usesLabel = ThemeSpecUsesBinding(raw, "label", "l");
  bool usesUsageWindows = false;
  for (size_t i = 0; i < kMaxUsageWindows; ++i) {
    usesUsageWindows = usesUsageWindows || ThemeSpecUsesUsageWindowBinding(raw, i);
  }
  const bool usesUsage = ThemeSpecUsesBinding(raw, "session", "s") ||
                         ThemeSpecUsesBinding(raw, "weekly", "w") ||
                         ThemeSpecUsesBinding(raw, "reset", "r") ||
                         usesUsageWindows;
  return (ThemeSpecUsesBinding(raw, "provider", "pr") && previous.provider != next.provider) ||
         (usesLabel &&
          (previous.label != next.label || previous.updateAvailable != next.updateAvailable)) ||
         (ThemeSpecUsesBinding(raw, "session", "s") && previous.session != next.session) ||
         (ThemeSpecUsesBinding(raw, "weekly", "w") && previous.weekly != next.weekly) ||
         (ThemeSpecUsesBinding(raw, "reset", "r") && previous.resetSecs != next.resetSecs) ||
         (usesUsageWindows && [&]() {
           for (size_t i = 0; i < kMaxUsageWindows; ++i) {
             if (ThemeSpecUsesUsageWindowBinding(raw, i) && UsageWindowChanged(previous.usageWindows[i], next.usageWindows[i])) {
               return true;
             }
           }
           return false;
         }()) ||
         (usesUsage &&
           (previous.usageUnavailable != next.usageUnavailable ||
            previous.sessionUnavailable != next.sessionUnavailable ||
            previous.weeklyUnavailable != next.weeklyUnavailable)) ||
         (ThemeSpecUsesBinding(raw, "usageMode", "u") &&
          (previous.hasUsageMode != next.hasUsageMode || previous.usageMode != next.usageMode)) ||
         (ThemeSpecUsesActivity(raw) && previous.activity != next.activity) ||
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
  if (previous.label != next.label || previous.updateAvailable != next.updateAvailable) {
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
  for (size_t i = 0; i < kMaxUsageWindows; ++i) {
    if (UsageWindowChanged(previous.usageWindows[i], next.usageWindows[i])) {
      fields |= ThemeSpecUsageWindowField(i);
    }
  }
  if (previous.usageUnavailable != next.usageUnavailable) {
    fields |= themespec::kThemeSpecFieldSession |
              themespec::kThemeSpecFieldWeekly |
              themespec::kThemeSpecFieldReset;
    for (size_t i = 0; i < kMaxUsageWindows; ++i) {
      fields |= ThemeSpecUsageWindowField(i);
    }
  }
  if (previous.sessionUnavailable != next.sessionUnavailable) {
    fields |= themespec::kThemeSpecFieldSession;
  }
  if (previous.weeklyUnavailable != next.weeklyUnavailable) {
    fields |= themespec::kThemeSpecFieldWeekly;
  }
  if (previous.hasUsageMode != next.hasUsageMode || previous.usageMode != next.usageMode) {
    fields |= themespec::kThemeSpecFieldUsageMode;
  }
  if (previous.activity != next.activity) {
    fields |= themespec::kThemeSpecFieldActivity;
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
    bool themeSpecChanged) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  if (!hadFrame || !visualChanged || themeSpecChanged || previous.hasError || next.hasError) {
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
  const int64_t totalMinutes = secs < 0 ? 0 : secs / 60;
  const int64_t days = totalMinutes / (24 * 60);
  const int64_t hours = (totalMinutes % (24 * 60)) / 60;
  const int64_t minutes = totalMinutes % 60;
  if (days > 0) {
    return String(days) + "d " + String(hours) + "h";
  }
  if (hours > 0) {
    return String(hours) + "h " + String(minutes) + "m";
  }
  return String(minutes) + "m";
}

inline bool ParseFrameLine(const char* line, Frame& out) {
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, line);
  if (err) {
    out = {};
    out.hasError = true;
    out.error = String("bad json: ") + err.c_str();
    return true;
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

  // Reset freshness. A frame that carries neither a deadline nor a trust state
  // says nothing about the countdown and must leave the stored basis alone.
  ResetTrust resetTrust = ResetTrust::kUnknown;
  String resetSource;
  if (doc["resetTrust"].is<const char*>()) {
    String raw = String(doc["resetTrust"].as<const char*>());
    raw.trim();
    raw.toLowerCase();
    resetTrust = ParseResetTrustName(raw);
  }
  if (doc["resetSource"].is<const char*>()) {
    resetSource = String(doc["resetSource"].as<const char*>());
    resetSource.trim();
    resetSource.toLowerCase();
    if (!IsSafeIdentifier(resetSource, true)) {
      resetSource = "";
    }
  }
  const bool hasResetFields = resetTrust != ResetTrust::kUnknown || !doc["resetSecs"].isNull();

  String activity;
  if (doc["activity"].is<const char*>()) {
    activity = String(doc["activity"].as<const char*>());
    activity.trim();
    activity.toLowerCase();
    if (!IsSafeActivityName(activity)) {
      activity = "";
    }
  }

  bool hasClockSchedule = false;
  int clockOffsetMinutes = 0;
  int64_t clockTransitionEpoch = 0;
  int clockTransitionOffsetMinutes = 0;
  int64_t clockFollowingTransitionEpoch = 0;
  int clockFollowingTransitionOffsetMinutes = 0;
  if (doc["clockSchedule"].is<JsonObjectConst>()) {
    JsonObjectConst schedule = doc["clockSchedule"].as<JsonObjectConst>();
    if (schedule["currentOffsetMinutes"].is<int>()) {
      clockOffsetMinutes = schedule["currentOffsetMinutes"].as<int>();
      hasClockSchedule = deviceclock::UtcOffsetValid(clockOffsetMinutes);
    }
    clockTransitionEpoch = static_cast<int64_t>(
        schedule["transitionEpoch"] | static_cast<int64_t>(0));
    clockTransitionOffsetMinutes = schedule["offsetMinutes"] | 0;
    clockFollowingTransitionEpoch = static_cast<int64_t>(
        schedule["followingTransitionEpoch"] | static_cast<int64_t>(0));
    clockFollowingTransitionOffsetMinutes = schedule["followingOffsetMinutes"] | 0;
    if (!hasClockSchedule ||
        (clockTransitionEpoch != 0 &&
         (clockTransitionEpoch < deviceclock::kMinPlausibleEpoch ||
          !deviceclock::UtcOffsetValid(clockTransitionOffsetMinutes))) ||
        (clockTransitionEpoch == 0 && clockTransitionOffsetMinutes != 0) ||
        (clockFollowingTransitionEpoch != 0 &&
         (clockFollowingTransitionEpoch <= clockTransitionEpoch ||
          clockFollowingTransitionEpoch < deviceclock::kMinPlausibleEpoch ||
          !deviceclock::UtcOffsetValid(clockFollowingTransitionOffsetMinutes))) ||
        (clockFollowingTransitionEpoch == 0 && clockFollowingTransitionOffsetMinutes != 0)) {
      clockTransitionEpoch = 0;
      clockTransitionOffsetMinutes = 0;
      clockFollowingTransitionEpoch = 0;
      clockFollowingTransitionOffsetMinutes = 0;
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
    out.hasClockSchedule = hasClockSchedule;
    out.clockOffsetMinutes = static_cast<int16_t>(clockOffsetMinutes);
    out.clockTransitionEpoch = clockTransitionEpoch;
    out.clockTransitionOffsetMinutes =
        static_cast<int16_t>(clockTransitionOffsetMinutes);
    out.clockFollowingTransitionEpoch = clockFollowingTransitionEpoch;
    out.clockFollowingTransitionOffsetMinutes =
        static_cast<int16_t>(clockFollowingTransitionOffsetMinutes);
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
  out.resetSecs = ClampNonNegativeInt64(static_cast<int64_t>(doc["resetSecs"] | static_cast<int64_t>(0)));
  out.resetTrustSecs =
      ClampNonNegativeInt64(static_cast<int64_t>(doc["resetTrustSecs"] | static_cast<int64_t>(0)));
  out.resetSource = resetSource;
  out.resetTrust = resetTrust;
  out.hasResetFields = hasResetFields;
  out.usageUnavailable = doc["usageUnavailable"] | false;
  if (doc["usageWindows"].is<JsonArrayConst>() || doc["usageSlots"].is<JsonArrayConst>()) {
    JsonArrayConst slots = doc["usageWindows"].is<JsonArrayConst>()
        ? doc["usageWindows"].as<JsonArrayConst>()
        : doc["usageSlots"].as<JsonArrayConst>();
    int slotIndex = 0;
    for (JsonObjectConst slot : slots) {
      if (slotIndex >= static_cast<int>(kMaxUsageWindows)) {
        break;
      }
      const char* slotLabel = slot["label"] | "";
      const char* slotID = slot["id"] | "";
      if (slotID[0] == '\0' || slotLabel[0] == '\0') {
        continue;
      }
      out.usageWindows[slotIndex].id = String(slotID);
      out.usageWindows[slotIndex].label = String(slotLabel);
      out.usageWindows[slotIndex].percent = ClampPct(slot["percent"] | 0);
      out.usageWindows[slotIndex].resetSecs = ClampNonNegativeInt64(static_cast<int64_t>(slot["resetSecs"] | static_cast<int64_t>(0)));
      out.usageWindows[slotIndex].available = true;
      ++slotIndex;
    }
  }
  out.sessionUnavailable = doc["sessionUnavailable"] | false;
  out.weeklyUnavailable = doc["weeklyUnavailable"] | false;
  out.timeText = String(doc["time"] | "");
  out.dateText = String(doc["date"] | "");
  out.hasClockSchedule = hasClockSchedule;
  out.clockOffsetMinutes = static_cast<int16_t>(clockOffsetMinutes);
  out.clockTransitionEpoch = clockTransitionEpoch;
  out.clockTransitionOffsetMinutes =
      static_cast<int16_t>(clockTransitionOffsetMinutes);
  out.clockFollowingTransitionEpoch = clockFollowingTransitionEpoch;
  out.clockFollowingTransitionOffsetMinutes =
      static_cast<int16_t>(clockFollowingTransitionOffsetMinutes);
  out.sessionTokens = ClampNonNegativeInt64(static_cast<int64_t>(doc["sessionTokens"] | static_cast<int64_t>(0)));
  out.weekTokens = ClampNonNegativeInt64(static_cast<int64_t>(doc["weekTokens"] | static_cast<int64_t>(0)));
  out.totalTokens = ClampNonNegativeInt64(static_cast<int64_t>(doc["totalTokens"] | static_cast<int64_t>(0)));
  out.hasTokenTotals = (doc["tokenTotalsKnown"] | false) ||
                       !doc["sessionTokens"].isNull() ||
                       !doc["weekTokens"].isNull() ||
                       !doc["totalTokens"].isNull();
  out.hasUsageMode = hasUsageMode;
  out.usageMode = usageMode;
  out.activity = activity;
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
                                     previous.usageUnavailable != next.usageUnavailable ||
                                     previous.sessionUnavailable != next.sessionUnavailable ||
                                     previous.weeklyUnavailable != next.weeklyUnavailable ||
                                     previous.sessionTokens != next.sessionTokens ||
                                     previous.weekTokens != next.weekTokens ||
                                     previous.totalTokens != next.totalTokens ||
                                     previous.hasUsageMode != next.hasUsageMode ||
                                     previous.usageMode != next.usageMode ||
                                     previous.activity != next.activity;
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

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
inline bool RestoreStoredThemeSpecFrame(
    RuntimeState& runtimeState,
    const String& themeId,
    int themeRev,
    const String& raw,
    unsigned long nowMillis,
    SerialConsumeEvent& outEvent) {
  outEvent = {};
  if (themeId.length() == 0 || themeRev <= 0 || !ThemeSpecRawCompiles(raw)) {
    return false;
  }

  const bool hadFrame = runtimeState.hasFrame;
  Frame next = hadFrame ? runtimeState.current : Frame{};
  next.hasError = false;
  next.error = "";
  next.clearThemeSpec = false;
  next.hasThemeSpec = true;
  next.themeSpecId = themeId;
  next.themeSpecRev = themeRev;
  next.themeSpecRaw = "";
  runtimeState.cachedThemeId = themeId;
  runtimeState.cachedThemeRev = themeRev;
  runtimeState.cachedThemeSpecRaw = raw;
  runtimeState.current = next;
  runtimeState.hasFrame = true;
  runtimeState.resetBaseSecs = next.resetSecs;
  runtimeState.resetBaseMillis = nowMillis;
  outEvent.frameAccepted = true;
  outEvent.hadFrame = hadFrame;
  outEvent.themeSpecChanged = true;
  outEvent.visualChanged = true;
  return true;
}
#endif

inline void ApplyThemeSpecCache(RuntimeState& runtimeState, const Frame& previous, Frame& next, SerialConsumeEvent& outEvent) {
  if (next.hasError) {
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
    SerialConsumeEvent& outEvent) {
  outEvent = {};
  if (line == nullptr || line[0] == '\0') {
    return false;
  }

  Frame next;
  if (!ParseFrameLine(line, next)) {
    return false;
  }

  const Frame& previous = runtimeState.current;
  ApplyThemeSpecCache(runtimeState, previous, next, outEvent);
  outEvent.usageProgressed =
      !next.hasError && runtimeState.hasFrame && UsageProgressChanged(previous, next);
  if (!next.hasError && next.activity.length() == 0) {
    next.activity = outEvent.usageProgressed ? "coding" : "idle";
  }

  outEvent.hadFrame = runtimeState.hasFrame;
  const String& themeSpecRaw = ThemeSpecRawForFrame(runtimeState, next);
  outEvent.visualChanged = !outEvent.hadFrame || FrameVisualChangedWithThemeSpecRaw(previous, next, themeSpecRaw) || outEvent.themeSpecChanged;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  outEvent.themeSpecChangedFields = ThemeSpecLiveChangedFields(previous, next);
  outEvent.themeSpecPartialRender = ThemeSpecCanUsePartialRender(
      previous,
      next,
      themeSpecRaw,
      outEvent.hadFrame,
      outEvent.visualChanged,
      outEvent.themeSpecChanged);
#endif

  runtimeState.current = next;
  runtimeState.hasFrame = true;
  runtimeState.resetBaseSecs = next.resetSecs;
  runtimeState.resetBaseMillis = nowMillis;
  ApplyFrameResetTrust(runtimeState.reset, next, nowMillis);
  outEvent.frameAccepted = true;
  return true;
}

inline bool ConsumeSerialByte(
    LineReaderState& lineState,
    RuntimeState& runtimeState,
    char c,
    unsigned long nowMillis,
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
    (void)ConsumeFrameLine(runtimeState, lineState.buffer, nowMillis, outEvent);
  }

  lineState.len = 0;
  lineState.overflowed = false;
  return outEvent.frameAccepted;
}

}  // namespace core
}  // namespace codexbar_display
