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
constexpr size_t kMaxProviderSlots = 2;
constexpr size_t kProviderSlotsFrameOverheadBytes = sizeof(",\"providerSlots\":[]") - 1;
static_assert(
    kUsageWindowFrameOverheadWithProviderBytes + (kMaxUsageWindows * kUsageWindowWireBudgetWithCommaBytes) - 1 +
            kProviderSlotsFrameOverheadBytes + (kMaxProviderSlots * kUsageWindowWireBudgetWithCommaBytes) - 1 <=
        kFrameLineBufferBytes,
    "provider slot parser capacity must fit max frame bytes");
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
  UsageWindow providerSlots[kMaxProviderSlots];
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

// What a ThemeSpec actually draws, read from the compiled primitives the
// renderer itself uses. Searching the raw JSON for field names instead took a
// rectangle ("t":"r") for the reset countdown and a width ("w") for weekly
// usage, and repainted the whole screen whenever such a value moved (#253).
struct ThemeSpecLiveUse {
  uint32_t fields = 0;
  uint8_t usageWindows = 0;       // bit i: usage window i
  uint8_t usageWindowResets = 0;  // bit i: usage window i's countdown
  uint8_t providerSlots = 0;
  uint8_t providerSlotResets = 0;

  static ThemeSpecLiveUse All() {
    ThemeSpecLiveUse use;
    use.fields = 0xFFFFFFFFUL;
    use.usageWindows = 0xFF;
    use.usageWindowResets = 0xFF;
    use.providerSlots = 0xFF;
    use.providerSlotResets = 0xFF;
    return use;
  }
  bool Uses(uint32_t field) const { return (fields & field) != 0; }
  bool UsesUsageWindow(size_t i) const { return (usageWindows >> i) & 1U; }
  bool UsesUsageWindowReset(size_t i) const { return (usageWindowResets >> i) & 1U; }
  bool UsesProviderSlot(size_t i) const { return (providerSlots >> i) & 1U; }
  bool UsesProviderSlotReset(size_t i) const { return (providerSlotResets >> i) & 1U; }
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
  ThemeSpecLiveUse cachedThemeLiveUse;
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
  // The frame reports the customer as working. This is the Companion's own
  // activity verdict, carried in the frame, not something the device infers.
  // Standby uses it as its activity clock so that a customer who is coding
  // wakes the device immediately, instead of waiting for a whole usage
  // percent to tick over. Frames that omit `activity` fall back to
  // `usageProgressed` through the same field, because ConsumeFrameLine fills
  // the missing value in before this is computed.
  bool reportsWorking = false;
  uint32_t themeSpecChangedFields = 0;
};

// What session, weekly and window percents mean. A missing or unknown
// usageMode is normalized away by ParseFrameLine and reads as "used".
inline const char* UsageModeText(const Frame& frame) {
  return frame.hasUsageMode && frame.usageMode == "remaining" ? "remaining" : "used";
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

// Trust is about the freshness of the basis, not about any single countdown.
// The root deadline is only the first window the host projected onto
// `resetSecs`, so letting its expiry mark everything stale would blank a
// still-running weekly window the moment a short session window runs out
// offline. Each countdown clamps itself at zero; only a missing basis or an
// expired freshness budget makes them all untrustworthy.
inline ResetTrust CurrentResetTrust(const ResetTrustState& state, unsigned long nowMillis) {
  if (!state.hasDeadline || ResetTrustBudgetSecs(state, nowMillis) <= 0) {
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

inline int64_t CurrentProviderSlotRemainingSecs(
    const RuntimeState& state,
    size_t slotIndex,
    unsigned long nowMillis) {
  if (!state.hasFrame ||
      CurrentResetTrust(state.reset, nowMillis) == ResetTrust::kStale ||
      slotIndex >= kMaxProviderSlots ||
      !state.current.providerSlots[slotIndex].available) {
    return 0;
  }
  const unsigned long elapsedMillis = nowMillis - state.resetBaseMillis;
  const int64_t elapsedSecs = static_cast<int64_t>(elapsedMillis / 1000UL);
  const int64_t remain = state.current.providerSlots[slotIndex].resetSecs - elapsedSecs;
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

// Trust says whether the basis is fresh enough to keep counting anything down,
// so any carried deadline qualifies. Requiring the legacy root would discard a
// perfectly valid provider-slot countdown just because the selected provider
// happens to have none.
inline bool FrameCarriesResetDeadline(const Frame& frame) {
  if (frame.resetSecs > 0) {
    return true;
  }
  for (size_t i = 0; i < kMaxUsageWindows; ++i) {
    if (frame.usageWindows[i].available && frame.usageWindows[i].resetSecs > 0) {
      return true;
    }
  }
  for (size_t i = 0; i < kMaxProviderSlots; ++i) {
    if (frame.providerSlots[i].available && frame.providerSlots[i].resetSecs > 0) {
      return true;
    }
  }
  return false;
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

  const bool usable = FrameCarriesResetDeadline(frame) &&
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

inline bool UsageWindowChanged(const UsageWindow& previous, const UsageWindow& next, bool includeReset = true) {
  return previous.id != next.id ||
         previous.label != next.label ||
         previous.percent != next.percent ||
         (includeReset && previous.resetSecs != next.resetSecs) ||
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

inline bool ThemeSpecRawLooksRenderable(const String& raw) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  return raw.indexOf("primitives") >= 0 || raw.indexOf("\"p\"") >= 0;
#else
  (void)raw;
  return false;
#endif
}

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
inline bool ThemeSpecSlotKeyIsReset(const char* key) {
  // The compact countdown keys are us1r/us2r and pv1r/pv2r.
  return std::strcmp(themespec::UsageWindowField(key), "reset") == 0 ||
         (std::strlen(key) == 4 && key[3] == 'r');
}

inline void AddThemeSpecSlotKeyUse(const char* key, ThemeSpecLiveUse& use) {
  int index = themespec::ProviderSlotBindingIndex(key);
  if (index >= 0) {
    use.providerSlots |= static_cast<uint8_t>(1U << index);
    if (ThemeSpecSlotKeyIsReset(key)) {
      use.providerSlotResets |= static_cast<uint8_t>(1U << index);
    }
    return;
  }
  index = themespec::UsageWindowBindingIndex(key);
  if (index >= 0 && static_cast<size_t>(index) < kMaxUsageWindows) {
    use.usageWindows |= static_cast<uint8_t>(1U << index);
    if (ThemeSpecSlotKeyIsReset(key)) {
      use.usageWindowResets |= static_cast<uint8_t>(1U << index);
    }
  }
}

inline ThemeSpecLiveUse CompiledThemeSpecLiveUse(const themespec::CompiledThemeSpec& scene) {
  ThemeSpecLiveUse use;
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    const themespec::CompiledPrimitive& primitive = scene.primitives[i];
    use.fields |= primitive.liveFields;
    if (primitive.usageSlot > 0) {
      use.usageWindows |= static_cast<uint8_t>(1U << (primitive.usageSlot - 1));
    }
    if (primitive.providerSlot > 0) {
      use.providerSlots |= static_cast<uint8_t>(1U << (primitive.providerSlot - 1));
    }
    if (primitive.binding != nullptr) {
      AddThemeSpecSlotKeyUse(primitive.binding, use);
    } else if (primitive.kind == themespec::PrimitiveKind::Text) {
      themespec::ForEachTemplateKey(primitive.text, [&use](const char* key) {
        AddThemeSpecSlotKeyUse(key, use);
      });
    }
  }
  return use;
}

// Compiles once per theme, never per frame. A spec that looks renderable but
// cannot be compiled here (e.g. low heap) counts as using everything: an extra
// redraw is harmless, a missed one would leave stale numbers on the screen.
inline bool ThemeSpecLiveUseForRaw(const String& raw, ThemeSpecLiveUse& out) {
  out = ThemeSpecLiveUse{};
  if (!ThemeSpecRawLooksRenderable(raw)) {
    return false;
  }
  JsonDocument doc;
  themespec::CompiledThemeSpec scene;
  const bool ok = themespec::CompileThemeSpec(raw.c_str(), doc, scene);
  out = ok ? CompiledThemeSpecLiveUse(scene) : ThemeSpecLiveUse::All();
  themespec::ReleaseCompiledThemeSpec(scene);
  return ok;
}

inline ThemeSpecLiveUse ThemeSpecLiveUseForRaw(const String& raw) {
  ThemeSpecLiveUse use;
  (void)ThemeSpecLiveUseForRaw(raw, use);
  return use;
}

inline void CacheThemeSpec(RuntimeState& runtimeState, const String& themeId, int themeRev, const String& raw) {
  if (runtimeState.cachedThemeSpecRaw != raw) {
    runtimeState.cachedThemeLiveUse = ThemeSpecLiveUseForRaw(raw);
  }
  runtimeState.cachedThemeId = themeId;
  runtimeState.cachedThemeRev = themeRev;
  runtimeState.cachedThemeSpecRaw = raw;
}
#endif

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

inline const ThemeSpecLiveUse& ThemeSpecLiveUseForFrame(const RuntimeState& runtimeState, const Frame& frame) {
  static const ThemeSpecLiveUse none;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  // Every renderable spec a frame carries is cached first, so the cache
  // describes the spec ThemeSpecRawForFrame returns for this frame.
  if (frame.hasThemeSpec &&
      runtimeState.cachedThemeRev > 0 &&
      runtimeState.cachedThemeId == frame.themeSpecId &&
      runtimeState.cachedThemeRev == frame.themeSpecRev &&
      ThemeSpecRawLooksRenderable(runtimeState.cachedThemeSpecRaw)) {
    return runtimeState.cachedThemeLiveUse;
  }
#else
  (void)runtimeState;
  (void)frame;
#endif
  return none;
}

inline bool FrameTokenStatsVisualChanged(const Frame& previous, const Frame& next, const ThemeSpecLiveUse& use) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  if (!next.hasThemeSpec ||
      !use.Uses(themespec::kThemeSpecFieldSessionTokens |
                themespec::kThemeSpecFieldWeekTokens |
                themespec::kThemeSpecFieldTotalTokens)) {
    return false;
  }
  return previous.hasTokenTotals != next.hasTokenTotals ||
         previous.sessionTokens != next.sessionTokens ||
         previous.weekTokens != next.weekTokens ||
         previous.totalTokens != next.totalTokens;
#else
  (void)previous;
  (void)next;
  (void)use;
  return false;
#endif
}

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
inline bool RemainingMinuteBucketChanged(int64_t remainingSecs, int64_t lastRenderedMinuteBucket) {
  return remainingSecs / 60 != lastRenderedMinuteBucket;
}
#endif

inline bool FrameThemeSpecDataVisualChanged(const Frame& previous, const Frame& next, const ThemeSpecLiveUse& use) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  for (size_t i = 0; i < kMaxProviderSlots; ++i) {
    if (use.UsesProviderSlot(i) &&
        UsageWindowChanged(previous.providerSlots[i], next.providerSlots[i], use.UsesProviderSlotReset(i))) {
      return true;
    }
  }
  for (size_t i = 0; i < kMaxUsageWindows; ++i) {
    if (use.UsesUsageWindow(i) &&
        UsageWindowChanged(previous.usageWindows[i], next.usageWindows[i], use.UsesUsageWindowReset(i))) {
      return true;
    }
  }
  const bool usesUsage = use.usageWindows != 0 ||
                         use.Uses(themespec::kThemeSpecFieldSession |
                                  themespec::kThemeSpecFieldWeekly |
                                  themespec::kThemeSpecFieldReset);
  return (use.Uses(themespec::kThemeSpecFieldProvider) && previous.provider != next.provider) ||
         (use.Uses(themespec::kThemeSpecFieldLabel) &&
          (previous.label != next.label || previous.updateAvailable != next.updateAvailable)) ||
         (use.Uses(themespec::kThemeSpecFieldSession) && previous.session != next.session) ||
         (use.Uses(themespec::kThemeSpecFieldWeekly) && previous.weekly != next.weekly) ||
         (use.Uses(themespec::kThemeSpecFieldReset) && previous.resetSecs != next.resetSecs) ||
         (usesUsage &&
           (previous.usageUnavailable != next.usageUnavailable ||
            previous.sessionUnavailable != next.sessionUnavailable ||
            previous.weeklyUnavailable != next.weeklyUnavailable)) ||
         (use.Uses(themespec::kThemeSpecFieldUsageMode) &&
          (previous.hasUsageMode != next.hasUsageMode || previous.usageMode != next.usageMode)) ||
         (use.Uses(themespec::kThemeSpecFieldActivity) && previous.activity != next.activity) ||
         FrameTokenStatsVisualChanged(previous, next, use);
#else
  (void)previous;
  (void)next;
  (void)use;
  return false;
#endif
}

// The changed fields this spec draws; empty when it draws none of them.
inline uint32_t ThemeSpecLiveChangedFields(
    const Frame& previous,
    const Frame& next,
    const ThemeSpecLiveUse& use) {
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
    if (UsageWindowChanged(previous.usageWindows[i], next.usageWindows[i], false)) {
      fields |= themespec::kThemeSpecFieldUsageWindows;
    }
    if (previous.usageWindows[i].resetSecs != next.usageWindows[i].resetSecs &&
        use.UsesUsageWindowReset(i)) {
      fields |= themespec::kThemeSpecFieldUsageWindowReset;
    }
  }
  for (size_t i = 0; i < kMaxProviderSlots; ++i) {
    if (UsageWindowChanged(
            previous.providerSlots[i],
            next.providerSlots[i],
            use.UsesProviderSlotReset(i))) {
      fields |= themespec::kThemeSpecFieldProviderSlots;
    }
  }
  if (previous.usageUnavailable != next.usageUnavailable) {
    fields |= themespec::kThemeSpecFieldSession |
              themespec::kThemeSpecFieldWeekly |
              themespec::kThemeSpecFieldReset |
              themespec::kThemeSpecFieldUsageWindows;
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
  const bool tokenAvailabilityChanged = previous.hasTokenTotals != next.hasTokenTotals;
  if (tokenAvailabilityChanged || previous.sessionTokens != next.sessionTokens) {
    fields |= themespec::kThemeSpecFieldSessionTokens;
  }
  if (tokenAvailabilityChanged || previous.weekTokens != next.weekTokens) {
    fields |= themespec::kThemeSpecFieldWeekTokens;
  }
  if (tokenAvailabilityChanged || previous.totalTokens != next.totalTokens) {
    fields |= themespec::kThemeSpecFieldTotalTokens;
  }
  return fields & use.fields;
#else
  (void)previous;
  (void)next;
  (void)use;
  return 0;
#endif
}

inline bool ThemeSpecCanUsePartialRender(
    const Frame& previous,
    const Frame& next,
    const ThemeSpecLiveUse& use,
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
      previous.themeSpecRev != next.themeSpecRev) {
    return false;
  }
  if (previous.clearThemeSpec != next.clearThemeSpec) {
    return false;
  }
  return ThemeSpecLiveChangedFields(previous, next, use) != 0;
#else
  (void)previous;
  (void)next;
  (void)use;
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
    return false;
  }

  if (!doc["v"].is<int>()) {
    out = {};
    return false;
  }
  const int protocolVersion = doc["v"].as<int>();
  if (protocolVersion != 1 && protocolVersion != 2) {
    out = {};
    return false;
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
  if (doc["providerSlots"].is<JsonArrayConst>()) {
    int providerSlotIndex = 0;
    for (JsonObjectConst slot : doc["providerSlots"].as<JsonArrayConst>()) {
      if (providerSlotIndex >= static_cast<int>(kMaxProviderSlots)) {
        break;
      }
      const char* slotLabel = slot["label"] | "";
      const char* slotID = slot["id"] | "";
      if (slotID[0] == '\0' || slotLabel[0] == '\0') {
        continue;
      }
      out.providerSlots[providerSlotIndex].id = String(slotID);
      out.providerSlots[providerSlotIndex].label = String(slotLabel);
      out.providerSlots[providerSlotIndex].percent = ClampPct(slot["percent"] | 0);
      out.providerSlots[providerSlotIndex].resetSecs = ClampNonNegativeInt64(static_cast<int64_t>(slot["resetSecs"] | static_cast<int64_t>(0)));
      out.providerSlots[providerSlotIndex].available = true;
      ++providerSlotIndex;
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

inline bool FrameVisualChangedForThemeSpec(const Frame& previous, const Frame& next, const ThemeSpecLiveUse& use) {
  if (previous.hasError != next.hasError) {
    return true;
  }
  if (next.hasError) {
    return previous.error != next.error;
  }
  const bool dataChanged = next.hasThemeSpec
                               ? FrameThemeSpecDataVisualChanged(previous, next, use)
                               : previous.provider != next.provider ||
                                     previous.label != next.label ||
                                     previous.session != next.session ||
                                     previous.weekly != next.weekly ||
                                     previous.usageUnavailable != next.usageUnavailable ||
                                     previous.sessionUnavailable != next.sessionUnavailable ||
                                     previous.weeklyUnavailable != next.weeklyUnavailable ||
                                     previous.hasTokenTotals != next.hasTokenTotals ||
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

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
inline bool RestoreStoredThemeSpecFrame(
    RuntimeState& runtimeState,
    const String& themeId,
    int themeRev,
    const String& raw,
    unsigned long nowMillis,
    SerialConsumeEvent& outEvent) {
  outEvent = {};
  ThemeSpecLiveUse use;
  if (themeId.length() == 0 || themeRev <= 0 || !ThemeSpecLiveUseForRaw(raw, use)) {
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
  runtimeState.cachedThemeLiveUse = use;
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
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    CacheThemeSpec(runtimeState, "", 0, "");
    next.themeSpecRaw = "";
#else
    runtimeState.cachedThemeId = "";
    runtimeState.cachedThemeRev = 0;
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
      CacheThemeSpec(runtimeState, next.themeSpecId, next.themeSpecRev, next.themeSpecRaw);
      return;
    }

    if (sameCachedTheme && ThemeSpecRawLooksRenderable(runtimeState.cachedThemeSpecRaw)) {
      next.themeSpecRaw = "";
      outEvent.themeSpecCacheHit = true;
      return;
    }

    if (samePreviousTheme) {
      if (ThemeSpecRawLooksRenderable(previous.themeSpecRaw)) {
        CacheThemeSpec(runtimeState, previous.themeSpecId, previous.themeSpecRev, previous.themeSpecRaw);
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
        CacheThemeSpec(runtimeState, previous.themeSpecId, previous.themeSpecRev, previous.themeSpecRaw);
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
  // Read the activity verdict after the fallback above, so a frame that
  // carries `activity` is taken at its word and a frame that omits it still
  // resolves to the inferred value. An error frame reports nothing.
  outEvent.reportsWorking = !next.hasError && next.activity == "coding";

  outEvent.hadFrame = runtimeState.hasFrame;
  const ThemeSpecLiveUse& themeSpecUse = ThemeSpecLiveUseForFrame(runtimeState, next);
  outEvent.visualChanged = !outEvent.hadFrame || FrameVisualChangedForThemeSpec(previous, next, themeSpecUse) || outEvent.themeSpecChanged;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  outEvent.themeSpecChangedFields = ThemeSpecLiveChangedFields(previous, next, themeSpecUse);
  outEvent.themeSpecPartialRender = ThemeSpecCanUsePartialRender(
      previous,
      next,
      themeSpecUse,
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

inline bool ConsumeLineByte(
    LineReaderState& lineState,
    char c,
    const char*& outLine) {
  outLine = nullptr;
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
  const bool complete = !lineState.overflowed && lineState.len > 0;
  if (complete) {
    outLine = lineState.buffer;
  }
  lineState.len = 0;
  lineState.overflowed = false;
  return complete;
}

inline bool ConsumeSerialByte(
    LineReaderState& lineState,
    RuntimeState& runtimeState,
    char c,
    unsigned long nowMillis,
    SerialConsumeEvent& outEvent) {
  outEvent = {};
  const char* line = nullptr;
  if (!ConsumeLineByte(lineState, c, line)) {
    return false;
  }
  return ConsumeFrameLine(runtimeState, line, nowMillis, outEvent) &&
         outEvent.frameAccepted;
}

}  // namespace core
}  // namespace codexbar_display
