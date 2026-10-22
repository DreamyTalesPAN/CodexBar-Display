#pragma once

#include <ArduinoJson.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <new>

#include "usage_window_contract.h"

namespace codexbar_display {
namespace themespec {

using usage_window_contract::ClampPct;
using usage_window_contract::kPaceTickOverhang;

constexpr uint32_t kThemeSpecFieldProvider = 1UL << 0;
constexpr uint32_t kThemeSpecFieldLabel = 1UL << 1;
constexpr uint32_t kThemeSpecFieldSession = 1UL << 2;
constexpr uint32_t kThemeSpecFieldWeekly = 1UL << 3;
constexpr uint32_t kThemeSpecFieldReset = 1UL << 4;
constexpr uint32_t kThemeSpecFieldUsageMode = 1UL << 5;
constexpr uint32_t kThemeSpecFieldActivity = 1UL << 6;
constexpr uint32_t kThemeSpecFieldTime = 1UL << 7;
constexpr uint32_t kThemeSpecFieldDate = 1UL << 8;
constexpr uint32_t kThemeSpecFieldSessionTokens = 1UL << 9;
constexpr uint32_t kThemeSpecFieldWeekTokens = 1UL << 10;
constexpr uint32_t kThemeSpecFieldTotalTokens = 1UL << 11;
constexpr size_t kMaxThemeSpecUsageWindows = usage_window_contract::kMaxWindows;
constexpr uint32_t kThemeSpecFieldUsageWindows = 1UL << 12;
constexpr uint32_t kThemeSpecFieldUsageSlot1 = kThemeSpecFieldUsageWindows;
constexpr uint32_t kThemeSpecFieldUsageSlot2 = kThemeSpecFieldUsageWindows;
constexpr uint32_t kThemeSpecFieldProviderSlots = 1UL << 13;
// A ticking reset must not invalidate slot-owned labels, sprites, or progress bars.
constexpr uint32_t kThemeSpecFieldUsageWindowReset = 1UL << 14;
// CodexBar's pace for a usage window; unlike its countdown it does not tick.
constexpr uint32_t kThemeSpecFieldUsageWindowPace = 1UL << 15;
// usageProviderName: the provider's label without the notice. Not the Label field,
// which marks a primitive that shows the update notice itself.
constexpr uint32_t kThemeSpecFieldProviderName = 1UL << 16;
constexpr size_t kMaxThemeSpecProviderSlots = 2;
constexpr int kThemeSpecCanvasSize = 240;
constexpr size_t kMaxThemeSpecGifAssets = 1;
constexpr size_t kMaxThemeSpecGifAssetBytes = 24 * 1024;
constexpr int kMaxThemeSpecGifWidth = 80;
constexpr int kMaxThemeSpecGifHeight = 80;
constexpr int kMaxThemeSpecGifPixels = kMaxThemeSpecGifWidth * kMaxThemeSpecGifHeight;

inline void RenderYield() {
#if defined(ARDUINO_ARCH_ESP8266)
  if (can_yield()) {
    yield();
  }
#elif defined(ARDUINO)
  yield();
#endif
}

// An idle window is measured, current and simply has no deadline because
// nothing has been used yet. It is not an error: the renderer says "No active
// session" for it instead of the stale/offline "Reset unavailable".
//
// The state rides in resetSecs as a negative sentinel rather than in a
// separate flag. The ESP8266 image sits at its flash ceiling, and a flag on
// every window plus its legacy-slot copies cost more than this build can
// spend. Every reader already branches on "resetSecs <= 0" before formatting a
// duration, so the sentinel lands on paths that are checked anyway. A basis
// the device cannot stand behind never carries it, so the trust path keeps its
// own wording.
//
// This is the same value the countdown helpers in codexbar_display_core.h
// return (kRemainingSecsIdle); the frame carries it straight through. It is
// restated here because this header is the lower of the two and cannot
// include that one.
constexpr int64_t kResetSecsIdle = -1;

inline bool ResetSecsAreIdle(int64_t resetSecs) {
  return resetSecs < 0;
}

struct UsageWindowData {
  const char* label = "";
  int percent = 0;
  int64_t resetSecs = 0;
  bool available = false;
  usage_window_contract::Pace pace;
  const char* id = "";
};

struct FrameData {
  const char* footerWindow = "";
  const char* provider = "";
  const char* label = "";
  bool updateAvailable = false;
  bool showUpdateNotice = false;
  const char* updateNotice = "";
  int session = 0;
  int weekly = 0;
  int64_t resetSecs = 0;
  bool usageUnavailable = false;
  UsageWindowData usageWindows[kMaxThemeSpecUsageWindows];
  const char* usageSlot1Label = "";
  int usageSlot1Percent = 0;
  int64_t usageSlot1ResetSecs = 0;
  bool usageSlot1Available = false;
  const char* usageSlot2Label = "";
  int usageSlot2Percent = 0;
  int64_t usageSlot2ResetSecs = 0;
  bool usageSlot2Available = false;
  // Cross-provider reset rows: every configured provider with its soonest
  // window reset, independent of which provider owns this frame.
  UsageWindowData providerSlots[kMaxThemeSpecProviderSlots];
  bool sessionUnavailable = false;
  bool weeklyUnavailable = false;
  const char* usageMode = "";
  const char* activity = "idle";
  const char* time = "";
  const char* date = "";
  int64_t sessionTokens = 0;
  int64_t weekTokens = 0;
  int64_t totalTokens = 0;
  // Token totals absent from the frame render as "--", never as a made-up 0.
  bool hasTokenTotals = false;
};

struct RectCommand {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  int borderRadius = 0;
  uint16_t color = 0x0000;
};

struct TextCommand {
  const char* text = "";
  int x = 0;
  int y = 0;
  int font = 1;
  int size = 1;
  int maxWidth = 0;
  uint16_t fg = 0xFFFF;
  uint16_t bg = 0x0000;
  bool hasBg = false;
  bool fitShrink = false;
  int align = 0;
  int valign = 0;
  int height = 0;
  bool wrap = false;
};

struct ProgressCommand {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  int percent = 0;
  int style = 0;
  int segments = 0;
  int segmentGap = 1;
  int borderRadius = 0;
  uint16_t fillColor = 0xFFFF;
  uint16_t borderColor = 0x7BEF;
  uint16_t bgColor = 0x0000;
  // CodexBar's pace on a bar bound to usageSlotNPace: `percent` is the filled
  // part up to the smaller of use and plan, the piece up to `pieceTo` the
  // reserve or (hatched) deficit, and a 2 px tick stands at `planAt`.
  // pieceTo <= percent: no piece. planAt < 0: no tick.
  int pieceTo = 0;
  int planAt = -1;
  bool hatched = false;
  uint16_t pieceColor = 0xFFFF;
  uint16_t hatchGapColor = 0x0000;
};

struct GifCommand {
  const char* assetPath = "";
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  uint16_t bg = 0x0000;
  bool hasBg = false;
};

struct SpriteCommand {
  const char* assetPath = "";
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  uint16_t bg = 0x0000;
  bool hasBg = false;
};

struct PixelsCommand {
  const char* data = "";
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  uint16_t color = 0xFFFF;
};

constexpr size_t kMaxCompiledThemeSpecPrimitives = 32;
constexpr size_t kMaxCompiledThemeSpecStringBytes = 1024;
constexpr size_t kMaxCompiledProviderAssets = 16;
constexpr size_t kMaxCompiledColorStops = 4;
constexpr int kProgressStyleArc = 2;

struct CompiledProviderAsset {
  const char* key = nullptr;
  const char* path = nullptr;
};

struct CompiledColorStop {
  int16_t gte = 0;
  uint16_t color = 0xFFFF;
};

enum class PrimitiveKind : uint8_t {
  Unknown = 0,
  Rect,
  Text,
  Progress,
  Gif,
  Sprite,
  Pixels,
};

struct CompiledPrimitive {
  PrimitiveKind kind = PrimitiveKind::Unknown;
  uint32_t liveFields = 0;
  uint8_t usageSlot = 0;
  uint8_t providerSlot = 0;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  int font = 1;
  int size = 1;
  int maxWidth = 0;
  int align = 0;
  int valign = 0;
  int style = 0;
  int segments = 0;
  int segmentGap = 1;
  int borderRadius = 0;
  uint16_t color = 0xFFFF;
  uint16_t bg = 0x0000;
  uint16_t border = 0x7BEF;
  uint16_t reserveColor = 0x07E0;  // pace bar: the piece of a reserve
  uint16_t deficitColor = 0xF800;  // pace bar: the hatch of a deficit
  bool hasBg = false;
  bool fitShrink = false;
  uint8_t colorStopCount = 0;
  CompiledColorStop colorStops[kMaxCompiledColorStops];
  const char* text = "";
  const char* binding = nullptr;
  const char* assetPath = "";
  const char* idleAssetPath = nullptr;
  const char* codingAssetPath = nullptr;
  uint8_t providerAssetStart = 0;
  uint8_t providerAssetCount = 0;
  const char* data = "";
  JsonArrayConst palette;
  JsonArrayConst rows;
};

struct CompiledThemeSpec {
  uint16_t bgColor = 0x0000;
  CompiledPrimitive* primitives = nullptr;
  size_t primitiveCapacity = 0;
  size_t primitiveCount = 0;
  bool hasAnimatedAssets = false;
  bool requiresJsonDocument = false;
  bool ownsMemory = false;
  char* stringPool = nullptr;
  size_t stringPoolCapacity = 0;
  size_t stringPoolUsed = 0;
  CompiledProviderAsset* providerAssets = nullptr;
  size_t providerAssetCapacity = 0;
  size_t providerAssetCount = 0;
};

inline bool CompiledThemeSpecHasGifAssets(const CompiledThemeSpec& scene) {
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    if (scene.primitives[i].kind == PrimitiveKind::Gif) {
      return true;
    }
  }
  return false;
}

inline bool CompiledThemeSpecReferencesAsset(
    const CompiledThemeSpec& scene,
    const char* assetPath) {
  if (assetPath == nullptr || assetPath[0] == '\0') {
    return false;
  }
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    const CompiledPrimitive& primitive = scene.primitives[i];
    if (std::strcmp(primitive.assetPath, assetPath) == 0 ||
        (primitive.idleAssetPath != nullptr &&
         std::strcmp(primitive.idleAssetPath, assetPath) == 0) ||
        (primitive.codingAssetPath != nullptr &&
         std::strcmp(primitive.codingAssetPath, assetPath) == 0)) {
      return true;
    }
    for (uint8_t j = 0; j < primitive.providerAssetCount; ++j) {
      const CompiledProviderAsset& entry = scene.providerAssets[primitive.providerAssetStart + j];
      if (entry.path != nullptr && std::strcmp(entry.path, assetPath) == 0) {
        return true;
      }
    }
  }
  return false;
}

struct CompiledThemeSpecStoragePlan {
  size_t primitiveCapacity = 0;
  size_t stringPoolCapacity = 0;
  size_t providerAssetCapacity = 0;
};

class Sink {
 public:
  virtual ~Sink() = default;

  virtual void PrimeBackground(uint16_t color) { (void)color; }
  virtual void BeginClip(int x, int y, int width, int height) {
    (void)x;
    (void)y;
    (void)width;
    (void)height;
  }
  virtual void EndClip() {}
  virtual void FillScreen(uint16_t color) = 0;
  virtual void FillRect(const RectCommand& cmd) = 0;
  virtual int MeasureText(const char* text, int font, int size) = 0;
  virtual void DrawText(const TextCommand& cmd) = 0;
  virtual void DrawProgress(const ProgressCommand& cmd) = 0;
  virtual void DrawGif(const GifCommand& cmd) = 0;
  virtual void DrawSprite(const SpriteCommand& cmd) = 0;
  virtual void DrawPixels(const PixelsCommand& cmd) = 0;
};

inline uint16_t RGB565(uint8_t r, uint8_t g, uint8_t b) {
  return static_cast<uint16_t>(((r & 0xF8U) << 8) | ((g & 0xFCU) << 3) | (b >> 3));
}

inline int HexNibble(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

inline uint8_t HexByte(const char* value) {
  return static_cast<uint8_t>((HexNibble(value[0]) << 4) | HexNibble(value[1]));
}

inline bool IsHexColor(const char* value) {
  if (value == nullptr || value[0] != '#') {
    return false;
  }
  for (int i = 1; i < 7; ++i) {
    const char c = value[i];
    const bool valid = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    if (!valid) {
      return false;
    }
  }
  return value[7] == '\0';
}

inline uint16_t ParseColor(const char* value, uint16_t fallback) {
  if (!IsHexColor(value)) {
    return fallback;
  }
  return RGB565(HexByte(value + 1), HexByte(value + 3), HexByte(value + 5));
}

inline const char* JsonStringOrNull(JsonVariantConst value) {
  return value.is<const char*>() ? value.as<const char*>() : nullptr;
}

inline const char* JsonStringFor(JsonObjectConst object, const char* longKey, const char* shortKey) {
  const char* longValue = JsonStringOrNull(object[longKey]);
  if (longValue != nullptr) {
    return longValue;
  }
  return JsonStringOrNull(object[shortKey]);
}

inline JsonObjectConst JsonObjectFor(JsonObjectConst object, const char* longKey, const char* shortKey) {
  if (object[longKey].is<JsonObjectConst>()) {
    return object[longKey].as<JsonObjectConst>();
  }
  return object[shortKey].as<JsonObjectConst>();
}


inline int JsonIntFor(JsonObjectConst object, const char* longKey, const char* shortKey, int fallback) {
  if (object[longKey].is<int>()) {
    return object[longKey].as<int>();
  }
  return object[shortKey] | fallback;
}

inline JsonArrayConst JsonArrayFor(JsonObjectConst object, const char* longKey, const char* shortKey) {
  if (object[longKey].is<JsonArrayConst>()) {
    return object[longKey].as<JsonArrayConst>();
  }
  return object[shortKey].as<JsonArrayConst>();
}

inline const char* PrimitiveTypeFor(JsonObjectConst primitive) {
  return JsonStringFor(primitive, "type", "t");
}

inline bool PrimitiveTypeIs(JsonObjectConst primitive, const char* longType, const char* shortType) {
  const char* type = PrimitiveTypeFor(primitive);
  return type != nullptr && (std::strcmp(type, longType) == 0 || std::strcmp(type, shortType) == 0);
}

inline bool HasHexBitmapBits(const char* data, int width, int height) {
  if (data == nullptr || width <= 0 || height <= 0) {
    return false;
  }
  const int bits = width * height;
  const int hexChars = ((bits + 7) / 8) * 2;
  for (int i = 0; i < hexChars; ++i) {
    if (HexNibble(data[i]) < 0) {
      return false;
    }
  }
  return true;
}

inline bool BitmapBitSet(const char* data, int bitIndex) {
  if (data == nullptr || bitIndex < 0) {
    return false;
  }
  const int byteIndex = bitIndex / 8;
  const int high = HexNibble(data[byteIndex * 2]);
  const int low = HexNibble(data[byteIndex * 2 + 1]);
  if (high < 0 || low < 0) {
    return false;
  }
  const uint8_t value = static_cast<uint8_t>((high << 4) | low);
  return (value & (0x80 >> (bitIndex % 8))) != 0;
}

inline bool ParseColorPalette(JsonArrayConst rawPalette, uint16_t* palette, int& paletteSize) {
  paletteSize = 0;
  if (palette == nullptr || rawPalette.size() == 0 || rawPalette.size() > 26) {
    return false;
  }

  for (JsonVariantConst rawColor : rawPalette) {
    const char* color = JsonStringOrNull(rawColor);
    if (!IsHexColor(color)) {
      return false;
    }
    palette[paletteSize++] = ParseColor(color, 0x0000);
  }
  return true;
}

inline bool RenderRlePixelRows(JsonArrayConst rows, const uint16_t* palette, int paletteSize, int x, int y, int width, int height, Sink* sink) {
  if (palette == nullptr || paletteSize <= 0 || width <= 0 || height <= 0 || rows.size() != static_cast<size_t>(height)) {
    return false;
  }

  int rowIndex = 0;
  for (JsonVariantConst rawRow : rows) {
    const char* row = JsonStringOrNull(rawRow);
    if (row == nullptr) {
      return false;
    }

    int offset = 0;
    for (int i = 0; row[i] != '\0';) {
      int runLength = 0;
      bool hasRunLength = false;
      while (row[i] >= '0' && row[i] <= '9') {
        hasRunLength = true;
        runLength = (runLength * 10) + (row[i] - '0');
        if (runLength > width) {
          return false;
        }
        ++i;
      }
      if (!hasRunLength) {
        runLength = 1;
      } else if (runLength <= 0) {
        return false;
      }

      const char token = row[i++];
      if (token == '\0' || offset + runLength > width) {
        return false;
      }
      if (token == '.') {
        offset += runLength;
        continue;
      }
      if (token < 'a' || token > 'z') {
        return false;
      }

      const int colorIndex = token - 'a';
      if (colorIndex >= paletteSize) {
        return false;
      }
      if (sink != nullptr) {
        RectCommand cmd;
        cmd.x = x + offset;
        cmd.y = y + rowIndex;
        cmd.width = runLength;
        cmd.height = 1;
        cmd.color = palette[colorIndex];
        sink->FillRect(cmd);
      }
      offset += runLength;
    }

    if (offset != width) {
      return false;
    }
    ++rowIndex;
  }

  return rowIndex == height;
}

inline void FormatDuration(int64_t secs, char* out, size_t outSize) {
  if (out == nullptr || outSize == 0) {
    return;
  }
  if (secs < 0) {
    secs = 0;
  }
  const int64_t totalMinutes = secs / 60;
  const int64_t days = totalMinutes / (24 * 60);
  const int64_t hours = (totalMinutes % (24 * 60)) / 60;
  const int64_t minutes = totalMinutes % 60;
  if (days > 0) {
    std::snprintf(out, outSize, "%lldd %lldh", static_cast<long long>(days), static_cast<long long>(hours));
    return;
  }
  if (hours > 0) {
    std::snprintf(out, outSize, "%lldh %lldm", static_cast<long long>(hours), static_cast<long long>(minutes));
    return;
  }
  std::snprintf(out, outSize, "%lldm", static_cast<long long>(minutes));
}

inline const char* SafeText(const char* value) {
  return value == nullptr ? "" : value;
}

// Two at once carries provider names in its limit labels, leaving the header
// free for the selected percentage basis. Notices still take precedence.
inline const char* UsageHeaderText(const FrameData& frame) {
  return std::strchr(SafeText(frame.provider), '+') != nullptr
      ? SafeText(frame.usageMode) : SafeText(frame.label);
}

inline const char* LabelText(const FrameData& frame) {
  if (frame.updateAvailable && frame.showUpdateNotice && SafeText(frame.updateNotice)[0] != '\0') {
    return SafeText(frame.updateNotice);
  }
  return UsageHeaderText(frame);
}

inline int ParseDecimal(const char* value, size_t& consumed) {
  consumed = 0;
  if (value == nullptr || value[0] < '0' || value[0] > '9') {
    return -1;
  }
  int out = 0;
  while (value[consumed] >= '0' && value[consumed] <= '9') {
    out = (out * 10) + (value[consumed] - '0');
    ++consumed;
    if (out > 999) {
      return -1;
    }
  }
  return out;
}

inline int UsageWindowBindingIndex(const char* key) {
  key = SafeText(key);
  if (std::strncmp(key, "usage.", 6) == 0) {
    size_t consumed = 0;
    const int index = ParseDecimal(key + 6, consumed);
    if (index >= 0 && key[6 + consumed] == '.') {
      return index;
    }
  }
  if (std::strncmp(key, "usageSlot", 9) == 0 && key[9] >= '1' && key[9] <= '2') {
    return key[9] - '1';
  }
  if (std::strncmp(key, "us", 2) == 0 && key[2] >= '1' && key[2] <= '2') {
    return key[2] - '1';
  }
  return -1;
}

inline int ProviderSlotBindingIndex(const char* key) {
  key = SafeText(key);
  if (std::strncmp(key, "providerSlot", 12) == 0 && key[12] >= '1' && key[12] <= '2') {
    return key[12] - '1';
  }
  if (std::strncmp(key, "pv", 2) == 0 && key[2] >= '1' && key[2] <= '2') {
    return key[2] - '1';
  }
  return -1;
}

inline const char* UsageWindowField(const char* key) {
  key = SafeText(key);
  if (std::strncmp(key, "usage.", 6) == 0) {
    size_t consumed = 0;
    const int index = ParseDecimal(key + 6, consumed);
    if (index >= 0 && key[6 + consumed] == '.') {
      return key + 6 + consumed + 1;
    }
  }
  if (const char* pace = std::strstr(key, "Pace")) {
    return pace;
  }
  if (std::strstr(key, "Available") != nullptr) {
    return "available";
  }
  if (std::strstr(key, "Label") != nullptr) {
    return "label";
  }
  if (std::strstr(key, "Reset") != nullptr) {
    return "reset";
  }
  return "percent";
}

// A countdown repaints whenever it moves. Compact countdowns: us1r/us2r,
// pv1r/pv2r.
inline bool UsageWindowKeyFollowsReset(const char* key) {
  key = SafeText(key);
  return std::strcmp(UsageWindowField(key), "reset") == 0 || std::strcmp(UsageWindowField(key), "PaceFooter") == 0 ||
         (std::strlen(key) == 4 && key[3] == 'r');
}

// CodexBar's pace repaints only when the pace itself changes or its window's
// countdown runs out, not with every tick of that countdown.
inline bool UsageWindowKeyShowsPace(const char* key) {
  return std::strncmp(UsageWindowField(key), "Pace", 4) == 0;
}

inline bool UsageWindowIndexSupported(int index) {
  return index >= 0 && static_cast<size_t>(index) < kMaxThemeSpecUsageWindows;
}

inline const UsageWindowData& UsageWindowFor(const FrameData& frame, int index) {
  static const UsageWindowData empty;
  if (!UsageWindowIndexSupported(index)) {
    return empty;
  }
  return frame.usageWindows[index];
}

inline bool LegacyUsageSlotAvailableFor(const FrameData& frame, int slotIndex) {
  switch (slotIndex) {
    case 0: return frame.usageSlot1Available;
    case 1: return frame.usageSlot2Available;
    default: return false;
  }
}

inline UsageWindowData LegacyUsageSlotFor(const FrameData& frame, int slotIndex) {
  UsageWindowData out;
  switch (slotIndex) {
    case 0:
      out.label = frame.usageSlot1Label;
      out.percent = frame.usageSlot1Percent;
      out.resetSecs = frame.usageSlot1ResetSecs;
      out.available = frame.usageSlot1Available;
      break;
    case 1:
      out.label = frame.usageSlot2Label;
      out.percent = frame.usageSlot2Percent;
      out.resetSecs = frame.usageSlot2ResetSecs;
      out.available = frame.usageSlot2Available;
      break;
    default:
      break;
  }
  return out;
}

inline UsageWindowData BoundUsageWindowFor(const FrameData& frame, const char* key, int index) {
  if (std::strncmp(SafeText(key), "usage.", 6) == 0) {
    return UsageWindowFor(frame, index);
  }
  return LegacyUsageSlotFor(frame, index);
}

inline bool UsageWindowOwnerAvailableFor(const FrameData& frame, int index) {
  const UsageWindowData& window = UsageWindowFor(frame, index);
  if (window.available) {
    return true;
  }
  return LegacyUsageSlotAvailableFor(frame, index);
}

// Token totals render compactly (1.4M, 384M, 1.07B) so every row of a token
// theme fits its lane at the same font size. Pure integer math: the Mac
// preview mirrors this digit for digit, so both sides must truncate — never
// round — the hundredths.
inline void FormatTokenCount(int64_t value, char* out, size_t outSize) {
  if (out == nullptr || outSize == 0) {
    return;
  }
  if (value < 0) {
    value = 0;
  }
  if (value < 1000) {
    std::snprintf(out, outSize, "%lld", static_cast<long long>(value));
    return;
  }
  const char* unit = "K";
  int64_t divisor = 1000;
  if (value >= 1000000000) {
    unit = "B";
    divisor = 1000000000;
  } else if (value >= 1000000) {
    unit = "M";
    divisor = 1000000;
  }
  const int64_t hundredths = value * 100 / divisor;
  const long long whole = static_cast<long long>(hundredths / 100);
  // Three significant digits keep every value at most five glyphs wide, so
  // stacked token rows share one font size instead of shrinking per row.
  int frac = static_cast<int>(hundredths % 100);
  if (whole >= 100) {
    frac = 0;
  } else if (whole >= 10) {
    frac -= frac % 10;
  }
  if (frac == 0) {
    std::snprintf(out, outSize, "%lld%s", whole, unit);
  } else if (frac % 10 == 0) {
    std::snprintf(out, outSize, "%lld.%d%s", whole, frac / 10, unit);
  } else {
    std::snprintf(out, outSize, "%lld.%02d%s", whole, frac, unit);
  }
}

// A countdown the device cannot stand behind reads "Reset unavailable": the
// basis went stale or offline and the number would be a guess. A window that
// is measured and current but simply has no deadline is a different state --
// nothing has been used, so nothing is scheduled to reset. Saying "Reset
// unavailable" there reported a fault for a perfectly healthy account.
constexpr const char* kResetUnavailableText = "Reset unavailable";
constexpr const char* kResetIdleText = "No active session";

inline const char* ResetTextFor(bool idle) {
  return idle ? kResetIdleText : kResetUnavailableText;
}

// Only a countdown that fits is a fixed-width reset footer; the idle and
// unavailable wordings, and a countdown that fits no variant, keep the theme's
// shrink-fit like any other label.
inline bool IsResetCountdownText(const char* text) {
  return std::strcmp(text, kResetIdleText) != 0 &&
         std::strcmp(text, kResetUnavailableText) != 0;
}

// The root {reset} token carries no window of its own. It is idle only when
// every window the frame does carry is idle, so a genuinely stale basis (which
// leaves no idle window behind) keeps the unavailable wording.
inline bool RootResetIsIdle(const FrameData& frame) {
  if (frame.usageUnavailable) {
    return false;
  }
  bool sawWindow = false;
  for (size_t i = 0; i < kMaxThemeSpecUsageWindows; ++i) {
    if (!frame.usageWindows[i].available) {
      continue;
    }
    if (!ResetSecsAreIdle(frame.usageWindows[i].resetSecs)) {
      return false;
    }
    sawWindow = true;
  }
  return sawWindow;
}

inline const char* RootResetUnavailableText(const FrameData& frame) {
  return ResetTextFor(RootResetIsIdle(frame));
}

// The pace texts behind usageSlotN<suffix>. Text: "6% reserve", "On pace",
// "14% deficit"; Short: "6% reserve", "on pace", "14% deficit"; Lasts:
// "lasts until reset" or "runs out" (LastsSep: the same followed by " - ");
// RunsOut: "runs out" only. Each is empty
// without a pace, for a window whose countdown is gone, and for a suffix it
// does not know (the bar's own key is a plain "Pace").
inline void FormatBoundPace(
    const usage_window_contract::Pace& pace,
    bool running,
    const char* suffix,
    char* out,
    size_t outSize) {
  out[0] = '\0';
  if (pace.state == 0 || !running) {
    return;
  }
  // Whole suffixes only: a misspelled one (PaceState, PaceRuns) stays empty.
  const bool lastsSep = std::strcmp(suffix, "LastsSep") == 0;
  const bool shortForm = std::strcmp(suffix, "Short") == 0;
  if (shortForm || std::strcmp(suffix, "Text") == 0) {
    const int amount = pace.delta < 0 ? -pace.delta : pace.delta;
    if (pace.state == usage_window_contract::kPaceOnPace) {
      std::snprintf(out, outSize, "%s", shortForm ? "on pace" : "On pace");
    } else {
      std::snprintf(out, outSize, "%d%% %s", ClampPct(amount),
                    usage_window_contract::PaceState(pace.state));
    }
  } else if ((lastsSep || std::strcmp(suffix, "Lasts") == 0) && pace.lasts != 0) {
    // LastsSep ends in " - " so "{usageSlot1PaceLastsSep}resets {usageSlot1Reset}" reads
    // "lasts until reset - resets 3h 34m", and plain "resets 3h 34m" without a pace.
    std::snprintf(out, outSize, pace.lasts == usage_window_contract::kPaceRunsOut ? "runs out%s" : "lasts until reset%s",
                  lastsSep ? " - " : "");
  } else if (std::strcmp(suffix, "RunsOut") == 0 && pace.lasts == usage_window_contract::kPaceRunsOut) {
    std::snprintf(out, outSize, "runs out");
  }
}

// usageSlotNPaceFooter: the line under a pace theme's ring. While VibeTV shows a
// notice ("Update available") the line is the notice; else the reset sentence:
// "lasts until reset - resets 3h 34m" with a running pace, "resets 3h 34m" without
// one, and the idle or unavailable text when there is no countdown.
inline void FormatPaceFooter(
    const FrameData& frame,
    const UsageWindowData& window,
    const usage_window_contract::Pace& pace,
    char* out,
    size_t outSize) {
  if (frame.updateAvailable && frame.showUpdateNotice && SafeText(frame.updateNotice)[0] != '\0') {
    std::snprintf(out, outSize, "%s", frame.updateNotice);
    return;
  }
  if (!window.available) {
    out[0] = '\0';
    return;
  }
  if (window.resetSecs <= 0) {
    std::snprintf(out, outSize, "%s", ResetTextFor(ResetSecsAreIdle(window.resetSecs)));
    return;
  }
  char lead[24] = {0};
  FormatBoundPace(pace, true, "LastsSep", lead, sizeof(lead));
  char countdown[32] = {0};
  FormatDuration(window.resetSecs, countdown, sizeof(countdown));
  std::snprintf(out, outSize, "%sresets %s", lead, countdown);
}

inline void BoundValue(const char* key, const FrameData& frame, char* out, size_t outSize) {
  if (out == nullptr || outSize == 0) {
    return;
  }
  out[0] = '\0';
  key = SafeText(key);

  if (std::strcmp(key, "label") == 0 || std::strcmp(key, "providerLabel") == 0 || std::strcmp(key, "l") == 0) {
    std::snprintf(out, outSize, "%s", LabelText(frame));
    return;
  }
  if (std::strcmp(key, "provider") == 0 || std::strcmp(key, "pr") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.provider));
    return;
  }
  if (std::strcmp(key, "usageProviderName") == 0) {
    // The provider's name as the label binding shows it, but never the notice.
    std::snprintf(out, outSize, "%s", UsageHeaderText(frame));
    return;
  }
  if (std::strcmp(key, "session") == 0 || std::strcmp(key, "sessionPercent") == 0 || std::strcmp(key, "s") == 0) {
    if (frame.usageUnavailable || frame.sessionUnavailable) {
      std::snprintf(out, outSize, "??");
    } else {
      std::snprintf(out, outSize, "%d", ClampPct(frame.session));
    }
    return;
  }
  if (std::strcmp(key, "weekly") == 0 || std::strcmp(key, "weeklyPercent") == 0 || std::strcmp(key, "w") == 0) {
    if (frame.usageUnavailable || frame.weeklyUnavailable) {
      std::snprintf(out, outSize, "??");
    } else {
      std::snprintf(out, outSize, "%d", ClampPct(frame.weekly));
    }
    return;
  }
  if (std::strcmp(key, "reset") == 0 || std::strcmp(key, "resetCountdown") == 0 || std::strcmp(key, "r") == 0) {
    if (frame.usageUnavailable || frame.resetSecs <= 0) {
      std::snprintf(out, outSize, "%s", RootResetUnavailableText(frame));
    } else {
      FormatDuration(frame.resetSecs, out, outSize);
    }
    return;
  }

  const int providerSlotIndex = ProviderSlotBindingIndex(key);
  if (providerSlotIndex >= 0) {
    const UsageWindowData& slot = frame.providerSlots[providerSlotIndex];
    const bool available = slot.available;
    const char* availableShort = providerSlotIndex == 0 ? "pv1a" : "pv2a";
    const char* labelShort = providerSlotIndex == 0 ? "pv1l" : "pv2l";
    const char* resetShort = providerSlotIndex == 0 ? "pv1r" : "pv2r";
    const char* field = UsageWindowField(key);
    if (std::strcmp(field, "available") == 0 || std::strcmp(key, availableShort) == 0) {
      std::snprintf(out, outSize, "%s", available ? "true" : "false");
    } else if (!available) {
      out[0] = '\0';
    } else if (std::strcmp(field, "label") == 0 || std::strcmp(key, labelShort) == 0) {
      std::snprintf(out, outSize, "%s", SafeText(slot.label));
    } else if (std::strcmp(field, "reset") == 0 || std::strcmp(key, resetShort) == 0) {
      if (slot.resetSecs <= 0) {
        // A provider slot is only sent with a deadline, so it is never idle.
        std::snprintf(out, outSize, "%s", kResetUnavailableText);
      } else {
        FormatDuration(slot.resetSecs, out, outSize);
      }
    } else {
      std::snprintf(out, outSize, "%d", ClampPct(slot.percent));
    }
    return;
  }

  const int slotIndex = UsageWindowBindingIndex(key);
  if (slotIndex >= 0) {
    const UsageWindowData window = BoundUsageWindowFor(frame, key, slotIndex);
    const bool available = window.available;
    const char* availableShort = slotIndex == 0 ? "us1a" : "us2a";
    const char* labelShort = slotIndex == 0 ? "us1l" : "us2l";
    const char* resetShort = slotIndex == 0 ? "us1r" : "us2r";
    const char* field = UsageWindowField(key);
    if (std::strcmp(field, "available") == 0 || std::strcmp(key, availableShort) == 0) {
      std::snprintf(out, outSize, "%s", available ? "true" : "false");
    } else if (std::strcmp(field, "PaceFooter") == 0) {
      // The notice shows whether or not a window exists.
      FormatPaceFooter(frame, window, UsageWindowFor(frame, slotIndex).pace, out, outSize);
    } else if (!available) {
      out[0] = '\0';
    } else if (std::strcmp(field, "label") == 0 || std::strcmp(key, labelShort) == 0) {
      std::snprintf(out, outSize, "%s", SafeText(window.label));
    } else if (std::strcmp(field, "reset") == 0 || std::strcmp(key, resetShort) == 0) {
      if (window.resetSecs <= 0) {
        std::snprintf(out, outSize, "%s", ResetTextFor(ResetSecsAreIdle(window.resetSecs)));
      } else {
        FormatDuration(window.resetSecs, out, outSize);
      }
    } else if (std::strncmp(field, "Pace", 4) == 0) {
      // CodexBar computed this pace for the running window; once its
      // countdown expired or lost trust, the pace is unknown again.
      FormatBoundPace(UsageWindowFor(frame, slotIndex).pace, window.resetSecs > 0, field + 4, out, outSize);
    } else {
      std::snprintf(out, outSize, "%d", ClampPct(window.percent));
    }
    return;
  }

  if (std::strcmp(key, "usageMode") == 0 || std::strcmp(key, "u") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.usageMode));
    return;
  }
  if (std::strcmp(key, "usageModeShort") == 0 || std::strcmp(key, "usageModeStandalone") == 0) {
    // In Two at once the basis already occupies the provider header.
    if (std::strchr(SafeText(frame.provider), '+') != nullptr) return;
    // "left" for what remains, else the mode itself ("used"): "Session left".
    std::snprintf(out, outSize, "%s",
                  std::strcmp(key, "usageModeShort") == 0 && std::strcmp(SafeText(frame.usageMode), "remaining") == 0 ? "left" : SafeText(frame.usageMode));
    return;
  }
  if (std::strcmp(key, "activity") == 0 || std::strcmp(key, "act") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.activity));
    return;
  }
  if (std::strcmp(key, "time") == 0 || std::strcmp(key, "tm") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.time));
    return;
  }
  if (std::strcmp(key, "date") == 0 || std::strcmp(key, "dt") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.date));
    return;
  }
  if (std::strcmp(key, "sessionTokens") == 0 || std::strcmp(key, "st") == 0) {
    if (!frame.hasTokenTotals) {
      std::snprintf(out, outSize, "--");
    } else {
      FormatTokenCount(frame.sessionTokens, out, outSize);
    }
    return;
  }
  if (std::strcmp(key, "weekTokens") == 0 || std::strcmp(key, "wt") == 0) {
    if (!frame.hasTokenTotals) {
      std::snprintf(out, outSize, "--");
    } else {
      FormatTokenCount(frame.weekTokens, out, outSize);
    }
    return;
  }
  if (std::strcmp(key, "totalTokens") == 0 || std::strcmp(key, "tt") == 0) {
    if (!frame.hasTokenTotals) {
      std::snprintf(out, outSize, "--");
    } else {
      FormatTokenCount(frame.totalTokens, out, outSize);
    }
    return;
  }
}

inline void AppendText(char* out, size_t outSize, size_t& outLen, const char* text) {
  if (out == nullptr || outSize == 0 || text == nullptr) {
    return;
  }
  while (*text != '\0' && outLen + 1 < outSize) {
    out[outLen++] = *text++;
    out[outLen] = '\0';
  }
}

// The replacement for a template whose only substitution is a countdown with
// no deadline, or nullptr when the template must substitute in place.
//
// Shipped themes hard-code the prose around the countdown ("Resets in {us1r}",
// "Reset in {usageSlot1Reset}"). Substituting the unavailable text in place
// rendered "Resets in Reset unavailable" on a customer's screen: a doubled,
// self-contradicting line that reads like a defect. The whole template
// collapses to the unavailable text instead, exactly as the root {reset} token
// has always behaved, so the surrounding prose cannot contradict it.
//
// Only the countdown tokens are probed. A template that also substitutes a
// label or a percentage still carries information worth rendering, so it keeps
// its in-place substitution.
//
// An idle window collapses to the idle wording instead. Mixed idle and stale
// countdowns in one template keep the unavailable wording: the line cannot
// claim everything is merely idle while one of its values is untrustworthy.
inline const char* TemplateCountdownOnlyText(const char* raw, const FrameData& frame) {
  raw = SafeText(raw);
  bool sawUnavailableCountdown = false;
  bool allIdle = true;
  for (size_t i = 0; raw[i] != '\0';) {
    if (raw[i] != '{') {
      ++i;
      continue;
    }
    const char* close = std::strchr(raw + i + 1, '}');
    if (close == nullptr) {
      break;
    }
    char key[32] = {0};
    const size_t keyLen = static_cast<size_t>(close - (raw + i + 1));
    if (keyLen == 0 || keyLen >= sizeof(key)) {
      return nullptr;
    }
    std::memcpy(key, raw + i + 1, keyLen);

    const int providerSlotIndex = ProviderSlotBindingIndex(key);
    const int usageSlotIndex = UsageWindowBindingIndex(key);
    // The compact aliases carry no "Reset" substring, so UsageWindowField
    // reads them as "percent". BoundValue matches them by name; this probe
    // has to do the same or {us1r} keeps rendering the doubled sentence on
    // the device while the Control Center preview already collapses it.
    // With a slot index found, a four-character key ending in "r" is one of
    // us1r, us2r, pv1r, pv2r.
    const bool isShortReset = keyLen == 4 && key[3] == 'r';
    // PaceLastsSep leads into the reset sentence ("lasts until reset - resets 3h"),
    // and is empty exactly when the countdown is, so it collapses with it.
    const bool isCountdown =
        ((providerSlotIndex >= 0 || usageSlotIndex >= 0) &&
         (isShortReset || std::strcmp(UsageWindowField(key), "reset") == 0)) ||
        (usageSlotIndex >= 0 && std::strcmp(UsageWindowField(key), "PaceLastsSep") == 0);
    if (!isCountdown) {
      // Any other substitution carries its own information.
      return nullptr;
    }

    int64_t resetSecs = 0;
    bool available = false;
    if (providerSlotIndex >= 0) {
      const UsageWindowData& slot = frame.providerSlots[providerSlotIndex];
      resetSecs = slot.resetSecs;
      available = slot.available;
    } else {
      const UsageWindowData window = BoundUsageWindowFor(frame, key, usageSlotIndex);
      resetSecs = window.resetSecs;
      available = window.available;
    }
    // An unavailable window renders empty, not as the unavailable text, and
    // collapsing the line would hide prose the theme wants standing.
    if (!available) {
      return nullptr;
    }
    if (resetSecs > 0) {
      return nullptr;
    }
    sawUnavailableCountdown = true;
    allIdle = allIdle && ResetSecsAreIdle(resetSecs);
    i += keyLen + 2;
  }
  if (!sawUnavailableCountdown) {
    return nullptr;
  }
  return ResetTextFor(allIdle);
}

inline void RenderTextTemplate(const char* raw, const FrameData& frame, char* out, size_t outSize) {
  if (out == nullptr || outSize == 0) {
    return;
  }
  out[0] = '\0';
  raw = SafeText(raw);

  if ((frame.usageUnavailable || frame.resetSecs <= 0) &&
      (std::strstr(raw, "{reset}") != nullptr ||
       std::strstr(raw, "{resetCountdown}") != nullptr ||
       std::strstr(raw, "{r}") != nullptr)) {
    std::snprintf(out, outSize, "%s", RootResetUnavailableText(frame));
    return;
  }

  if (const char* countdownOnly = TemplateCountdownOnlyText(raw, frame)) {
    std::snprintf(out, outSize, "%s", countdownOnly);
    return;
  }

  size_t outLen = 0;
  for (size_t i = 0; raw[i] != '\0' && outLen + 1 < outSize;) {
    if (raw[i] == '{') {
      const char* close = std::strchr(raw + i + 1, '}');
      if (close != nullptr) {
        char key[32] = {0};
        const size_t keyLen = static_cast<size_t>(close - (raw + i + 1));
        if (keyLen > 0 && keyLen < sizeof(key)) {
          std::memcpy(key, raw + i + 1, keyLen);
          char value[48] = {0};
          BoundValue(key, frame, value, sizeof(value));
          AppendText(out, outSize, outLen, value);
          i += keyLen + 2;
          continue;
        }
      }
    }

    out[outLen++] = raw[i++];
    out[outLen] = '\0';
  }
}


inline bool StringEqualsAny(const char* value, const char* a, const char* b, const char* c = nullptr) {
  value = SafeText(value);
  return (a != nullptr && std::strcmp(value, a) == 0) ||
         (b != nullptr && std::strcmp(value, b) == 0) ||
         (c != nullptr && std::strcmp(value, c) == 0);
}

// Calls fn(key) for every "{key}" placeholder in a text template.
template <typename Fn>
inline void ForEachTemplateKey(const char* raw, Fn fn) {
  raw = SafeText(raw);
  for (size_t i = 0; raw[i] != '\0'; ++i) {
    if (raw[i] != '{') {
      continue;
    }
    const char* close = std::strchr(raw + i + 1, '}');
    if (close == nullptr) {
      return;
    }
    char key[32] = {0};
    const size_t keyLen = static_cast<size_t>(close - (raw + i + 1));
    // Like RenderTextTemplate: a brace too long to be a key is literal text,
    // so placeholders inside it still draw and must still count.
    if (keyLen > 0 && keyLen < sizeof(key)) {
      std::memcpy(key, raw + i + 1, keyLen);
      fn(static_cast<const char*>(key));
      i += keyLen + 1;
    }
  }
}

inline uint32_t BindingFieldMask(const char* binding) {
  if (StringEqualsAny(binding, "provider", "pr")) {
    return kThemeSpecFieldProvider;
  }
  if (StringEqualsAny(binding, "label", "providerLabel", "l")) {
    return kThemeSpecFieldLabel | kThemeSpecFieldProvider | kThemeSpecFieldUsageMode;
  }
  if (std::strcmp(SafeText(binding), "usageProviderName") == 0) {
    return kThemeSpecFieldProviderName | kThemeSpecFieldProvider | kThemeSpecFieldUsageMode;
  }
  if (StringEqualsAny(binding, "session", "sessionPercent", "s")) {
    return kThemeSpecFieldSession;
  }
  if (StringEqualsAny(binding, "weekly", "weeklyPercent", "w")) {
    return kThemeSpecFieldWeekly;
  }
  if (StringEqualsAny(binding, "reset", "resetCountdown", "r")) {
    return kThemeSpecFieldReset;
  }
  if (ProviderSlotBindingIndex(binding) >= 0) {
    return kThemeSpecFieldProviderSlots;
  }
  if (UsageWindowBindingIndex(binding) >= 0) {
    // A pace bar's plan moves with the usage mode (delta counts used percent), also
    // when the percent itself does not.
    return kThemeSpecFieldUsageWindows |
           (UsageWindowKeyFollowsReset(binding) ? kThemeSpecFieldUsageWindowReset : 0) |
           (UsageWindowKeyShowsPace(binding) ? kThemeSpecFieldUsageWindowPace : 0) |
           (std::strcmp(UsageWindowField(binding), "Pace") == 0 ? kThemeSpecFieldUsageMode : 0) |
           // The footer is the notice while one shows, so it is a label field too.
           (std::strcmp(UsageWindowField(binding), "PaceFooter") == 0 ? kThemeSpecFieldLabel : 0);
  }
  if (StringEqualsAny(binding, "usageMode", "u", "usageModeShort") || std::strcmp(SafeText(binding), "usageModeStandalone") == 0) {
    return kThemeSpecFieldUsageMode | kThemeSpecFieldProvider;
  }
  if (StringEqualsAny(binding, "activity", "act")) {
    return kThemeSpecFieldActivity;
  }
  if (StringEqualsAny(binding, "time", "tm")) {
    return kThemeSpecFieldTime;
  }
  if (StringEqualsAny(binding, "date", "dt")) {
    return kThemeSpecFieldDate;
  }
  if (StringEqualsAny(binding, "sessionTokens", "st")) {
    return kThemeSpecFieldSessionTokens;
  }
  if (StringEqualsAny(binding, "weekTokens", "wt")) {
    return kThemeSpecFieldWeekTokens;
  }
  if (StringEqualsAny(binding, "totalTokens", "tt")) {
    return kThemeSpecFieldTotalTokens;
  }
  return 0;
}

// A placeholder draws exactly what the same key would draw as a binding.
inline uint32_t TextTemplateFieldMask(const char* raw) {
  uint32_t fields = 0;
  ForEachTemplateKey(raw, [&fields](const char* key) { fields |= BindingFieldMask(key); });
  return fields;
}

inline bool AssetPathLooksAnimated(const char* path) {
  if (path == nullptr) {
    return false;
  }
  const size_t len = std::strlen(path);
  return len >= 4 &&
         ((std::strcmp(path + len - 4, ".cba") == 0) ||
          (std::strcmp(path + len - 4, ".gif") == 0));
}

inline bool AssetPathLooksGif(const char* path) {
  if (path == nullptr) {
    return false;
  }
  const size_t len = std::strlen(path);
  return len >= 4 && std::strcmp(path + len - 4, ".gif") == 0;
}

inline void ReleaseCompiledThemeSpec(CompiledThemeSpec& scene) {
  if (scene.ownsMemory) {
    delete[] scene.primitives;
    delete[] scene.stringPool;
    delete[] scene.providerAssets;
  }
  scene = CompiledThemeSpec{};
}

// `outOfMemory` separates a spec that does not fit the heap right now from one
// that can never compile, wherever a caller has to tell the two apart.
inline bool AllocateCompiledThemeSpecStorage(
    CompiledThemeSpec& scene,
    const CompiledThemeSpecStoragePlan& plan,
    bool* outOfMemory = nullptr) {
  ReleaseCompiledThemeSpec(scene);
  if (plan.primitiveCapacity == 0 || plan.primitiveCapacity > kMaxCompiledThemeSpecPrimitives ||
      plan.stringPoolCapacity > kMaxCompiledThemeSpecStringBytes ||
      plan.providerAssetCapacity > kMaxCompiledProviderAssets) {
    return false;
  }

  scene.ownsMemory = true;
  scene.primitives = new (std::nothrow) CompiledPrimitive[plan.primitiveCapacity];
  scene.stringPool = plan.stringPoolCapacity == 0 ? nullptr : new (std::nothrow) char[plan.stringPoolCapacity];
  scene.providerAssets = plan.providerAssetCapacity == 0
                             ? nullptr
                             : new (std::nothrow) CompiledProviderAsset[plan.providerAssetCapacity];
  if (scene.primitives == nullptr ||
      (plan.stringPoolCapacity > 0 && scene.stringPool == nullptr) ||
      (plan.providerAssetCapacity > 0 && scene.providerAssets == nullptr)) {
    ReleaseCompiledThemeSpec(scene);
    if (outOfMemory != nullptr) {
      *outOfMemory = true;
    }
    return false;
  }

  scene.primitiveCapacity = plan.primitiveCapacity;
  scene.stringPoolCapacity = plan.stringPoolCapacity;
  scene.providerAssetCapacity = plan.providerAssetCapacity;
  return true;
}

inline void MoveCompiledThemeSpec(CompiledThemeSpec& target, CompiledThemeSpec& source) {
  if (&target == &source) {
    return;
  }
  ReleaseCompiledThemeSpec(target);
  target = source;
  source = CompiledThemeSpec{};
}

inline void AddCompiledStringStorage(const char* value, size_t& stringBytes) {
  if (value == nullptr || value[0] == '\0') {
    return;
  }
  stringBytes += std::strlen(value) + 1;
}

inline void AddProviderAssetsStorage(
    JsonObjectConst providerAssets,
    size_t& stringBytes,
    size_t& entryCount) {
  if (providerAssets.isNull()) {
    return;
  }
  for (JsonPairConst pair : providerAssets) {
    const char* key = pair.key().c_str();
    const char* path = JsonStringOrNull(pair.value());
    if (key == nullptr || key[0] == '\0' || path == nullptr || path[0] == '\0') {
      continue;
    }
    AddCompiledStringStorage(key, stringBytes);
    AddCompiledStringStorage(path, stringBytes);
    ++entryCount;
  }
}

inline bool CountCompiledThemeSpecStorage(
    JsonObjectConst spec,
    CompiledThemeSpecStoragePlan& plan) {
  plan = CompiledThemeSpecStoragePlan{};
  JsonArrayConst primitives = JsonArrayFor(spec, "primitives", "p");
  if (primitives.isNull() || primitives.size() == 0 || primitives.size() > kMaxCompiledThemeSpecPrimitives) {
    return false;
  }

  plan.primitiveCapacity = primitives.size();
  for (JsonObjectConst primitive : primitives) {
    if (PrimitiveTypeIs(primitive, "text", "tx")) {
      AddCompiledStringStorage(JsonStringFor(primitive, "binding", "b"), plan.stringPoolCapacity);
      AddCompiledStringStorage(JsonStringFor(primitive, "text", "v"), plan.stringPoolCapacity);
    } else if (PrimitiveTypeIs(primitive, "progress", "p")) {
      AddCompiledStringStorage(JsonStringFor(primitive, "binding", "b"), plan.stringPoolCapacity);
    } else if (PrimitiveTypeIs(primitive, "gif", "g") ||
               PrimitiveTypeIs(primitive, "sprite", "sp") ||
               PrimitiveTypeIs(primitive, "image", "img")) {
      AddCompiledStringStorage(JsonStringFor(primitive, "assetPath", "a"), plan.stringPoolCapacity);
      JsonObjectConst stateAssets = JsonObjectFor(primitive, "stateAssets", "sa");
      AddCompiledStringStorage(JsonStringOrNull(stateAssets["idle"]), plan.stringPoolCapacity);
      AddCompiledStringStorage(JsonStringOrNull(stateAssets["coding"]), plan.stringPoolCapacity);
      if (PrimitiveTypeIs(primitive, "sprite", "sp") || PrimitiveTypeIs(primitive, "image", "img")) {
        AddProviderAssetsStorage(
            JsonObjectFor(primitive, "providerAssets", "pa"),
            plan.stringPoolCapacity,
            plan.providerAssetCapacity);
      }
    } else if (PrimitiveTypeIs(primitive, "pixels", "px")) {
      AddCompiledStringStorage(JsonStringFor(primitive, "data", "d"), plan.stringPoolCapacity);
    }
  }

  return plan.stringPoolCapacity <= kMaxCompiledThemeSpecStringBytes &&
         plan.providerAssetCapacity <= kMaxCompiledProviderAssets;
}

inline const char* CompiledStateAssetPathFor(
    const CompiledThemeSpec& scene,
    const CompiledPrimitive& primitive,
    const FrameData& frame) {
  const char* provider = frame.provider == nullptr ? "" : frame.provider;
  if (provider[0] != '\0' && primitive.providerAssetCount > 0) {
    for (uint8_t i = 0; i < primitive.providerAssetCount; ++i) {
      const CompiledProviderAsset& entry = scene.providerAssets[primitive.providerAssetStart + i];
      if (entry.key != nullptr && std::strcmp(entry.key, provider) == 0 &&
          entry.path != nullptr && entry.path[0] != '\0') {
        return entry.path;
      }
    }
  }
  const char* activity = frame.activity == nullptr ? "" : frame.activity;
  if (std::strcmp(activity, "coding") == 0 &&
      primitive.codingAssetPath != nullptr &&
      primitive.codingAssetPath[0] != '\0') {
    return primitive.codingAssetPath;
  }
  if (primitive.idleAssetPath != nullptr && primitive.idleAssetPath[0] != '\0') {
    return primitive.idleAssetPath;
  }
  return primitive.assetPath;
}

inline bool CompiledPrimitiveHasAssetReference(
    const CompiledThemeSpec& scene,
    const CompiledPrimitive& primitive) {
  if (primitive.assetPath != nullptr && primitive.assetPath[0] != '\0') {
    return true;
  }
  if (primitive.idleAssetPath != nullptr && primitive.idleAssetPath[0] != '\0') {
    return true;
  }
  if (primitive.codingAssetPath != nullptr && primitive.codingAssetPath[0] != '\0') {
    return true;
  }
  for (uint8_t i = 0; i < primitive.providerAssetCount; ++i) {
    const char* path = scene.providerAssets[primitive.providerAssetStart + i].path;
    if (path != nullptr && path[0] != '\0') {
      return true;
    }
  }
  return false;
}

inline const char* CopyCompiledString(CompiledThemeSpec& scene, const char* value) {
  if (value == nullptr) {
    return nullptr;
  }
  const size_t len = std::strlen(value);
  if (len == 0) {
    return "";
  }
  if (scene.stringPool == nullptr || scene.stringPoolUsed + len + 1 > scene.stringPoolCapacity) {
    return nullptr;
  }
  char* dest = scene.stringPool + scene.stringPoolUsed;
  std::memcpy(dest, value, len + 1);
  scene.stringPoolUsed += len + 1;
  return dest;
}

inline bool CompileStateAssets(CompiledThemeSpec& scene, JsonObjectConst stateAssets, CompiledPrimitive& out) {
  if (stateAssets.isNull()) {
    return true;
  }
  const char* idlePath = JsonStringOrNull(stateAssets["idle"]);
  const char* codingPath = JsonStringOrNull(stateAssets["coding"]);
  if (idlePath != nullptr && idlePath[0] != '\0') {
    out.idleAssetPath = CopyCompiledString(scene, idlePath);
    if (out.idleAssetPath == nullptr) {
      return false;
    }
  }
  if (codingPath != nullptr && codingPath[0] != '\0') {
    out.codingAssetPath = CopyCompiledString(scene, codingPath);
    if (out.codingAssetPath == nullptr) {
      return false;
    }
  }
  return true;
}

inline bool CompileProviderAssets(
    CompiledThemeSpec& scene,
    JsonObjectConst providerAssets,
    CompiledPrimitive& out) {
  if (providerAssets.isNull()) {
    return true;
  }
  out.providerAssetStart = static_cast<uint8_t>(scene.providerAssetCount);
  uint8_t count = 0;
  for (JsonPairConst pair : providerAssets) {
    const char* key = pair.key().c_str();
    const char* path = JsonStringOrNull(pair.value());
    if (key == nullptr || key[0] == '\0' || path == nullptr || path[0] == '\0') {
      continue;
    }
    if (scene.providerAssetCount >= scene.providerAssetCapacity) {
      return false;
    }
    const char* copiedKey = CopyCompiledString(scene, key);
    const char* copiedPath = CopyCompiledString(scene, path);
    if (copiedKey == nullptr || copiedPath == nullptr) {
      return false;
    }
    scene.providerAssets[scene.providerAssetCount++] = {copiedKey, copiedPath};
    ++count;
  }
  out.providerAssetCount = count;
  if (count > 0) {
    out.liveFields |= kThemeSpecFieldProvider;
  }
  return true;
}

inline bool CompileProgressColorStops(JsonObjectConst primitive, CompiledPrimitive& out);

inline bool CompilePrimitive(CompiledThemeSpec& scene, JsonObjectConst primitive, CompiledPrimitive& out, bool& hasAnimatedAssets) {
  out = CompiledPrimitive{};
  out.x = primitive["x"] | 0;
  out.y = primitive["y"] | 0;
  const int usageIndex = JsonIntFor(primitive, "usageIndex", "ui", -1);
  if (usageIndex >= 0) {
    if (static_cast<size_t>(usageIndex) >= kMaxThemeSpecUsageWindows) {
      return false;
    }
    out.usageSlot = static_cast<uint8_t>(usageIndex + 1);
  } else {
    out.usageSlot = static_cast<uint8_t>(JsonIntFor(primitive, "slot", "sl", 0));
  }
  if (out.usageSlot > kMaxThemeSpecUsageWindows) {
    return false;
  }
  if (out.usageSlot > 0) {
    out.liveFields |= kThemeSpecFieldUsageWindows;
  }
  out.providerSlot = static_cast<uint8_t>(JsonIntFor(primitive, "providerSlot", "pl", 0));
  if (out.providerSlot > kMaxThemeSpecProviderSlots) {
    return false;
  }
  if (out.providerSlot > 0) {
    out.liveFields |= kThemeSpecFieldProviderSlots;
  }

  if (PrimitiveTypeIs(primitive, "rect", "r")) {
    out.kind = PrimitiveKind::Rect;
    out.width = JsonIntFor(primitive, "width", "w", 0);
    out.height = JsonIntFor(primitive, "height", "h", 0);
    out.borderRadius = JsonIntFor(primitive, "borderRadius", "br", 0);
    out.color = ParseColor(JsonStringFor(primitive, "color", "c"), 0x0000);
    return out.width > 0 && out.height > 0;
  }

  if (PrimitiveTypeIs(primitive, "text", "tx")) {
    out.kind = PrimitiveKind::Text;
    out.font = JsonIntFor(primitive, "font", "f", 1);
    out.size = JsonIntFor(primitive, "fontSize", "s", 1);
    out.maxWidth = JsonIntFor(primitive, "maxWidth", "mw", JsonIntFor(primitive, "width", "w", 0));
    out.binding = CopyCompiledString(scene, JsonStringFor(primitive, "binding", "b"));
    out.text = CopyCompiledString(scene, JsonStringFor(primitive, "text", "v"));
    if (out.text == nullptr) {
      out.text = "";
    }
    const char* fit = JsonStringFor(primitive, "fit", "ft");
    out.fitShrink = fit != nullptr && std::strcmp(fit, "shrink") == 0;
    out.height = JsonIntFor(primitive, "height", "h", 0);
    const char* align = JsonStringFor(primitive, "align", "al");
    if (align != nullptr && std::strcmp(align, "center") == 0) {
      out.align = 1;
    } else if (align != nullptr && std::strcmp(align, "right") == 0) {
      out.align = 2;
    }
    const char* valign = JsonStringFor(primitive, "valign", "va");
    if (valign != nullptr &&
        (std::strcmp(valign, "middle") == 0 || std::strcmp(valign, "center") == 0)) {
      out.valign = 1;
    } else if (valign != nullptr && std::strcmp(valign, "bottom") == 0) {
      out.valign = 2;
    }
    out.color = ParseColor(JsonStringFor(primitive, "color", "c"), 0xFFFF);
    const char* bgColor = JsonStringFor(primitive, "bgColor", "bg");
    out.hasBg = bgColor != nullptr;
    out.bg = ParseColor(bgColor, 0x0000);
    out.liveFields |= out.binding != nullptr ? BindingFieldMask(out.binding) : TextTemplateFieldMask(out.text);
    // Text bound to a pace key takes its colour from the pace state.
    if (out.binding != nullptr && std::strstr(out.binding, "Pace") != nullptr &&
        !CompileProgressColorStops(primitive, out)) {
      return false;
    }
    return out.size > 0;
  }

  if (PrimitiveTypeIs(primitive, "progress", "p")) {
    out.kind = PrimitiveKind::Progress;
    out.width = JsonIntFor(primitive, "width", "w", 0);
    out.height = JsonIntFor(primitive, "height", "h", 0);
    out.binding = CopyCompiledString(scene, JsonStringFor(primitive, "binding", "b"));
    const char* progressStyle = JsonStringFor(primitive, "progressStyle", "ps");
    if (progressStyle != nullptr && (std::strcmp(progressStyle, "segments") == 0 || std::strcmp(progressStyle, "segmented") == 0)) {
      out.style = 1;
    }
    if (progressStyle != nullptr && std::strcmp(progressStyle, "arc") == 0) {
      // An arc has no segments, gap or corners. Those three fields hold its
      // start angle, sweep and thickness instead, so a compiled primitive
      // stays as small as it is: the device keeps up to 32 of them in RAM.
      out.style = kProgressStyleArc;
      out.segments = JsonIntFor(primitive, "arcStart", "as", 0);
      out.segmentGap = JsonIntFor(primitive, "arcSweep", "aw", 0);
      out.borderRadius = JsonIntFor(primitive, "arcThickness", "at", 0);
      const int diameter = out.width < out.height ? out.width : out.height;
      if (out.segments < 0 || out.segments > 359 ||
          out.segmentGap < 1 || out.segmentGap > 360 ||
          out.borderRadius < 1 || out.borderRadius * 2 > diameter) {
        return false;
      }
    } else {
      out.segments = JsonIntFor(primitive, "segments", "sg", 0);
      out.segmentGap = JsonIntFor(primitive, "segmentGap", "gg", 1);
      out.borderRadius = JsonIntFor(primitive, "borderRadius", "br", 0);
    }
    out.color = ParseColor(JsonStringFor(primitive, "color", "c"), 0xFFFF);
    out.bg = ParseColor(JsonStringFor(primitive, "bgColor", "bg"), 0x0000);
    out.border = ParseColor(JsonStringFor(primitive, "borderColor", "bc"), 0x7BEF);
    out.reserveColor = ParseColor(JsonStringFor(primitive, "reserveColor", "rc"), 0x07E0);
    out.deficitColor = ParseColor(JsonStringFor(primitive, "deficitColor", "dc"), 0xF800);
    if (!CompileProgressColorStops(primitive, out)) {
      return false;
    }
    const uint32_t bindingFields = BindingFieldMask(out.binding);
    if ((bindingFields & kThemeSpecFieldUsageWindows) != 0) {
      out.liveFields |= bindingFields;
    } else {
      out.liveFields |= (bindingFields & kThemeSpecFieldWeekly) != 0 ? kThemeSpecFieldWeekly : kThemeSpecFieldSession;
    }
    return out.width > 0 && out.height > 0;
  }

  if (PrimitiveTypeIs(primitive, "gif", "g")) {
    out.kind = PrimitiveKind::Gif;
    out.width = JsonIntFor(primitive, "width", "w", 0);
    out.height = JsonIntFor(primitive, "height", "h", 0);
    out.assetPath = CopyCompiledString(scene, JsonStringFor(primitive, "assetPath", "a"));
    if (out.assetPath == nullptr) {
      out.assetPath = "";
    }
    if (!CompileStateAssets(scene, JsonObjectFor(primitive, "stateAssets", "sa"), out)) {
      return false;
    }
    const char* bgColor = JsonStringFor(primitive, "bgColor", "bg");
    out.hasBg = bgColor != nullptr;
    out.bg = ParseColor(bgColor, 0x0000);
    out.liveFields |= (out.idleAssetPath == nullptr && out.codingAssetPath == nullptr) ? 0 : kThemeSpecFieldActivity;
    hasAnimatedAssets = true;
    if (out.width <= 0 || out.height <= 0 ||
        out.width > kMaxThemeSpecGifWidth ||
        out.height > kMaxThemeSpecGifHeight ||
        out.width * out.height > kMaxThemeSpecGifPixels) {
      return false;
    }
    const char* initialPath = CompiledStateAssetPathFor(scene, out, FrameData{});
    return initialPath != nullptr &&
           initialPath[0] != '\0' &&
           AssetPathLooksGif(initialPath) &&
           (out.idleAssetPath == nullptr || AssetPathLooksGif(out.idleAssetPath)) &&
           (out.codingAssetPath == nullptr || AssetPathLooksGif(out.codingAssetPath));
  }

  if (PrimitiveTypeIs(primitive, "sprite", "sp") || PrimitiveTypeIs(primitive, "image", "img")) {
    out.kind = PrimitiveKind::Sprite;
    out.width = JsonIntFor(primitive, "width", "w", 0);
    out.height = JsonIntFor(primitive, "height", "h", 0);
    out.assetPath = CopyCompiledString(scene, JsonStringFor(primitive, "assetPath", "a"));
    if (out.assetPath == nullptr) {
      out.assetPath = "";
    }
    JsonObjectConst stateAssets = JsonObjectFor(primitive, "stateAssets", "sa");
    if (!CompileStateAssets(scene, stateAssets, out)) {
      return false;
    }
    if (!CompileProviderAssets(scene, JsonObjectFor(primitive, "providerAssets", "pa"), out)) {
      return false;
    }
    const char* bgColor = JsonStringFor(primitive, "bgColor", "bg");
    out.hasBg = bgColor != nullptr;
    out.bg = ParseColor(bgColor, 0x0000);
    out.liveFields |= (out.idleAssetPath == nullptr && out.codingAssetPath == nullptr) ? 0 : kThemeSpecFieldActivity;
    for (uint8_t i = 0; i < out.providerAssetCount; ++i) {
      const char* path = scene.providerAssets[out.providerAssetStart + i].path;
      if (AssetPathLooksAnimated(path)) {
        hasAnimatedAssets = true;
        break;
      }
    }
    hasAnimatedAssets = hasAnimatedAssets ||
                        AssetPathLooksAnimated(out.assetPath) ||
                        AssetPathLooksAnimated(out.idleAssetPath) ||
                        AssetPathLooksAnimated(out.codingAssetPath);
    return CompiledPrimitiveHasAssetReference(scene, out);
  }

  if (PrimitiveTypeIs(primitive, "pixels", "px")) {
    out.kind = PrimitiveKind::Pixels;
    out.width = JsonIntFor(primitive, "width", "w", 0);
    out.height = JsonIntFor(primitive, "height", "h", 0);
    out.palette = primitive["p"].as<JsonArrayConst>();
    out.rows = primitive["r"].as<JsonArrayConst>();
    if (!out.palette.isNull() || !out.rows.isNull()) {
      scene.requiresJsonDocument = true;
    }
    out.data = CopyCompiledString(scene, JsonStringFor(primitive, "data", "d"));
    out.color = ParseColor(JsonStringFor(primitive, "color", "c"), 0xFFFF);
    return out.width > 0 && out.height > 0;
  }

  return false;
}

inline bool CompileThemeSpecObject(
    JsonObjectConst spec, CompiledThemeSpec& scene, bool* outOfMemory = nullptr) {
  ReleaseCompiledThemeSpec(scene);
  JsonArrayConst primitives = JsonArrayFor(spec, "primitives", "p");
  if (primitives.isNull() || primitives.size() == 0 || primitives.size() > kMaxCompiledThemeSpecPrimitives) {
    return false;
  }
  CompiledThemeSpecStoragePlan storagePlan;
  if (!CountCompiledThemeSpecStorage(spec, storagePlan) ||
      !AllocateCompiledThemeSpecStorage(scene, storagePlan, outOfMemory)) {
    return false;
  }

  scene.bgColor = ParseColor(JsonStringFor(spec, "bgColor", "bg"), 0x0000);
  size_t gifPrimitiveCount = 0;
  for (JsonObjectConst primitive : primitives) {
    CompiledPrimitive compiled;
    bool primitiveHasAnimatedAssets = false;
    if (CompilePrimitive(scene, primitive, compiled, primitiveHasAnimatedAssets)) {
      if (compiled.kind == PrimitiveKind::Gif && ++gifPrimitiveCount > kMaxThemeSpecGifAssets) {
        ReleaseCompiledThemeSpec(scene);
        return false;
      }
      if (scene.primitiveCount >= scene.primitiveCapacity) {
        ReleaseCompiledThemeSpec(scene);
        return false;
      }
      scene.primitives[scene.primitiveCount++] = compiled;
      scene.hasAnimatedAssets = scene.hasAnimatedAssets || primitiveHasAnimatedAssets;
    }
  }
  if (scene.primitiveCount == 0) {
    ReleaseCompiledThemeSpec(scene);
    return false;
  }
  return true;
}

inline bool CompileThemeSpec(
    const char* themeSpecRaw,
    JsonDocument& doc,
    CompiledThemeSpec& scene,
    bool* outOfMemory = nullptr) {
  if (themeSpecRaw == nullptr || themeSpecRaw[0] == '\0') {
    return false;
  }
  doc.clear();
  const DeserializationError err = deserializeJson(doc, themeSpecRaw);
  if (err) {
    if (outOfMemory != nullptr) {
      *outOfMemory = err == DeserializationError::NoMemory;
    }
    return false;
  }
  return CompileThemeSpecObject(doc.as<JsonObjectConst>(), scene, outOfMemory);
}

struct Bounds {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
};

struct BoundsResult {
  bool valid = false;
  bool unknown = false;
};

inline bool BoundsOverlap(const Bounds& a, const Bounds& b) {
  return a.width > 0 && a.height > 0 &&
         b.width > 0 && b.height > 0 &&
         a.x < b.x + b.width &&
         b.x < a.x + a.width &&
         a.y < b.y + b.height &&
         b.y < a.y + a.height;
}

inline void ExpandBounds(Bounds& target, const Bounds& next) {
  if (next.width <= 0 || next.height <= 0) {
    return;
  }
  if (target.width <= 0 || target.height <= 0) {
    target = next;
    return;
  }
  const int x1 = target.x < next.x ? target.x : next.x;
  const int y1 = target.y < next.y ? target.y : next.y;
  const int x2 = target.x + target.width > next.x + next.width ? target.x + target.width : next.x + next.width;
  const int y2 = target.y + target.height > next.y + next.height ? target.y + target.height : next.y + next.height;
  target.x = x1;
  target.y = y1;
  target.width = x2 - x1;
  target.height = y2 - y1;
}

inline int ApproxTextWidth(const char* text, int size) {
  if (text == nullptr || size <= 0) {
    return 0;
  }
  return static_cast<int>(std::strlen(text)) * 6 * size;
}

inline int VisualFontHeight(int font, int size) {
  if (size <= 0) {
    return 0;
  }
  int baseHeight = 8;
  switch (font) {
    case 2:
      baseHeight = 16;
      break;
    case 4:
      baseHeight = 26;
      break;
    case 6:
    case 7:
      baseHeight = 48;
      break;
    case 8:
      baseHeight = 75;
      break;
    case 1:
    default:
      baseHeight = 8;
      break;
  }
  return baseHeight * size;
}

inline int ApproxTextHeight(int font, int size) {
  const int visual = VisualFontHeight(font, size);
  if (visual <= 0) {
    return 0;
  }
  return visual + 4;
}

// Vertical box for valign: explicit h/height, else the pre-shrink font lane
// (ApproxTextHeight includes the same +4 pad as textClipH).
inline int TextValignBoxHeight(int explicitHeight, int font, int maxSize) {
  if (explicitHeight > 0) {
    return explicitHeight;
  }
  return ApproxTextHeight(font, maxSize);
}

// valign 0=top (y is glyph top), 1=middle/center, 2=bottom.
// glyphHeight is the visual TFT fontHeight after size is chosen — not clipH.
inline int AlignedTextY(int boxY, int boxHeight, int glyphHeight, int valign) {
  if (valign == 0 || boxHeight <= 0) {
    return boxY;
  }
  const int glyph = glyphHeight > 0 ? glyphHeight : 0;
  if (valign == 1) {
    return boxY + (boxHeight - glyph) / 2;
  }
  if (valign == 2) {
    return boxY + boxHeight - glyph;
  }
  return boxY;
}

// Keep shrink-fit readable at the smallest device font; use a second line
// only when the existing text box has room. Width comes from the actual TFT.
struct FittedText {
  int font;
  int size;
  char first[128];
  char second[128];
};

template <typename Measure>
inline FittedText FitText(const TextCommand& cmd, Measure measure) {
  FittedText result{cmd.font, cmd.size, {0}, {0}};
  std::snprintf(result.first, sizeof(result.first), "%s", SafeText(cmd.text));
  if (!cmd.fitShrink || cmd.maxWidth <= 0) return result;
  while (result.size > 1 && measure(result.first, result.font, result.size) > cmd.maxWidth) --result.size;
  const int height = TextValignBoxHeight(cmd.height, cmd.font, cmd.size);
  for (;;) {
    if (measure(result.first, result.font, result.size) <= cmd.maxWidth) return result;
    if (height >= 2 * VisualFontHeight(result.font, result.size)) {
      // Prefer the last word boundary with both lines fitting.
      const int length = std::strlen(result.first);
      int split = 0;
      for (int i = 1; i < length; ++i) {
        if (result.first[i] != ' ') continue;
        result.first[i] = '\0';
        const bool fits = measure(result.first, result.font, result.size) <= cmd.maxWidth &&
            measure(result.first + i + 1, result.font, result.size) <= cmd.maxWidth;
        result.first[i] = ' ';
        if (fits) split = i;
      }
      if (split > 0) {
        std::snprintf(result.second, sizeof(result.second), "%s", result.first + split + 1);
        result.first[split] = '\0';
        return result;
      }
    }
    if (result.font == 1) return result;
    result.font = 1;
    result.size = 1;
  }
}

inline int CompiledProgressPercentFor(const CompiledPrimitive& primitive, const FrameData& frame) {
  const int slotIndex = UsageWindowBindingIndex(primitive.binding);
  if (slotIndex >= 0) {
    const UsageWindowData window = BoundUsageWindowFor(frame, primitive.binding, slotIndex);
    return window.available ? ClampPct(window.percent) : 0;
  }
  if (StringEqualsAny(primitive.binding, "weekly", "weeklyPercent", "w")) {
    return ClampPct(frame.weekly);
  }
  return ClampPct(frame.session);
}

// colorStops are authored against remaining-style percent (high = healthy).
// Frames in usageMode=used send the inverted number, so match 100-percent.
inline int RemainingStyleProgressPercent(int percent, const char* usageMode) {
  const int clamped = ClampPct(percent);
  if (usageMode != nullptr && std::strcmp(usageMode, "used") == 0) {
    return 100 - clamped;
  }
  return clamped;
}

inline uint16_t ResolveProgressFillColor(
    const CompiledPrimitive& primitive,
    int percent,
    const char* usageMode) {
  const int remainingStyle = RemainingStyleProgressPercent(percent, usageMode);
  for (uint8_t i = 0; i < primitive.colorStopCount; ++i) {
    if (remainingStyle >= primitive.colorStops[i].gte) {
      return primitive.colorStops[i].color;
    }
  }
  return primitive.color;
}

// Whether a binding is a usage window's pace itself (usageSlotNPace), which
// a progress primitive draws, rather than one of its texts (usageSlotNPaceText).
inline bool IsPaceBarBinding(const char* binding) {
  return UsageWindowBindingIndex(binding) >= 0 && std::strcmp(UsageWindowField(binding), "Pace") == 0;
}

// The pace behind a usage window binding while its window still runs, else
// nullptr (CodexBar sent none, or its countdown is gone).
inline const usage_window_contract::Pace* BoundPaceFor(const char* binding, const FrameData& frame) {
  const int slotIndex = UsageWindowBindingIndex(binding);
  if (slotIndex < 0 || std::strncmp(UsageWindowField(binding), "Pace", 4) != 0) {
    return nullptr;
  }
  const UsageWindowData& window = UsageWindowFor(frame, slotIndex);
  return window.pace.state != 0 && window.resetSecs > 0 ? &window.pace : nullptr;
}

// A pace binding matches its colorStops against CodexBar's state instead of the
// quota: reserve 100, on pace 50, deficit 0. Without a pace it keeps `color`.
inline uint16_t ResolvePaceColor(const CompiledPrimitive& primitive, const FrameData& frame) {
  const usage_window_contract::Pace* pace = BoundPaceFor(primitive.binding, frame);
  if (pace != nullptr) {
    const int stateStyle = (usage_window_contract::kPaceDeficit - pace->state) * 50;
    for (uint8_t i = 0; i < primitive.colorStopCount; ++i) {
      if (stateStyle >= primitive.colorStops[i].gte) {
        return primitive.colorStops[i].color;
      }
    }
  }
  return primitive.color;
}

// The hatch's gaps are the track, tinted a little towards the stripe colour.
inline uint16_t PaceHatchGapColor(uint16_t stripe, uint16_t track) {
  const int r = ((track >> 11) & 31) + ((((stripe >> 11) & 31) - ((track >> 11) & 31)) / 12);
  const int g = ((track >> 5) & 63) + ((((stripe >> 5) & 63) - ((track >> 5) & 63)) / 12);
  const int b = (track & 31) + (((stripe & 31) - (track & 31)) / 12);
  return static_cast<uint16_t>((r << 11) | (g << 5) | b);
}

// Where a pace bar stands: filled to the smaller of use and plan, the reserve
// or deficit piece up to the larger, the tick at the plan. Delta is counted in
// used percent, so the plan is `percent` minus it when percent counts use and
// plus it when percent counts what remains. On pace shows the use itself and
// no piece. Without a pace it is a plain bar: no piece, no tick.
struct PaceBar {
  int fillTo = 0;
  int pieceTo = 0;
  int planAt = -1;
  bool hatched = false;
  uint16_t pieceColor = 0xFFFF;
};

inline PaceBar PaceBarFor(const CompiledPrimitive& primitive, const FrameData& frame, int percent) {
  PaceBar bar;
  bar.fillTo = bar.pieceTo = percent;
  const usage_window_contract::Pace* pace =
      IsPaceBarBinding(primitive.binding) ? BoundPaceFor(primitive.binding, frame) : nullptr;
  if (pace == nullptr) {
    return bar;
  }
  const bool used = std::strcmp(SafeText(frame.usageMode), "used") == 0;
  bar.planAt = ClampPct(percent + (used ? -pace->delta : pace->delta));
  bar.pieceColor = pace->state == usage_window_contract::kPaceDeficit ? primitive.deficitColor : primitive.reserveColor;
  bar.hatched = pace->state == usage_window_contract::kPaceDeficit;
  if (pace->state != usage_window_contract::kPaceOnPace) {
    bar.fillTo = percent < bar.planAt ? percent : bar.planAt;
    bar.pieceTo = percent < bar.planAt ? bar.planAt : percent;
  }
  return bar;
}

inline bool CompileProgressColorStops(JsonObjectConst primitive, CompiledPrimitive& out) {
  JsonArrayConst stops = JsonArrayFor(primitive, "colorStops", "cs");
  if (stops.isNull() || stops.size() == 0) {
    return true;
  }
  if (stops.size() > kMaxCompiledColorStops) {
    return false;
  }
  CompiledColorStop compiled[kMaxCompiledColorStops];
  uint8_t count = 0;
  for (JsonVariantConst entry : stops) {
    JsonObjectConst stop = entry.as<JsonObjectConst>();
    if (stop.isNull()) {
      return false;
    }
    const int gte = stop["gte"] | -1;
    const char* color = JsonStringOrNull(stop["color"]);
    if (color == nullptr || color[0] == '\0') {
      color = JsonStringOrNull(stop["c"]);
    }
    if (gte < 0 || gte > 100 || color == nullptr || color[0] == '\0') {
      return false;
    }
    compiled[count].gte = static_cast<int16_t>(gte);
    compiled[count].color = ParseColor(color, 0xFFFF);
    ++count;
  }
  for (uint8_t i = 0; i + 1 < count; ++i) {
    for (uint8_t j = static_cast<uint8_t>(i + 1); j < count; ++j) {
      if (compiled[j].gte > compiled[i].gte) {
        const CompiledColorStop tmp = compiled[i];
        compiled[i] = compiled[j];
        compiled[j] = tmp;
      }
    }
  }
  out.colorStopCount = count;
  for (uint8_t i = 0; i < count; ++i) {
    out.colorStops[i] = compiled[i];
  }
  if (count > 0) {
    out.liveFields |= kThemeSpecFieldUsageMode;
  }
  return true;
}

// sin(degrees) times 4096 by Bhaskara's formula: whole numbers only, no table
// and no float library. It is off by at most 0.1 degree, less than half a
// pixel at the edge of the display.
inline int ArcSin4096(int degrees) {
  const int half = degrees % 180;
  const int k = half * (180 - half);
  const int value = (k << 14) / (40500 - k);
  return degrees % 360 < 180 ? value : -value;
}

// A direction from the arc centre, or a pixel measured from it. Angles run
// clockwise from 12 o'clock; y grows downwards as on the display.
struct ArcVector {
  int x;
  int y;
};

inline ArcVector ArcDirection(int degrees) {
  return {ArcSin4096(degrees), -ArcSin4096(degrees + 90)};
}

// Whether `to` lies at most half a turn clockwise of `from`.
inline bool ArcClockwise(const ArcVector& from, const ArcVector& to) {
  return from.x * to.y - from.y * to.x >= 0;
}

inline bool ArcSweepContains(const ArcVector& start, const ArcVector& end, int sweep, const ArcVector& pixel) {
  const bool afterStart = ArcClockwise(start, pixel);
  const bool beforeEnd = ArcClockwise(pixel, end);
  return sweep >= 360 || (sweep > 180 ? afterStart || beforeEnd : afterStart && beforeEnd);
}

// Draws the ring row by row as FillRect runs: the track over the whole sweep
// and, from the start angle, the filled share of it. 0 % is track only, 100 %
// is filled to the end. A pace bar adds the piece after the filled share, solid
// or hatched (diagonal stripes, as on a bar), and a 2 px tick across the ring
// at the plan, which reaches kPaceTickOverhang beyond it.
inline void DrawProgressArc(const CompiledPrimitive& primitive, const PaceBar& pace, uint16_t fillColor, Sink& sink) {
  const int start = primitive.segments;
  const int sweep = primitive.segmentGap;
  const int filled = sweep * pace.fillTo / 100;
  const int pieceEnd = sweep * pace.pieceTo / 100;
  // Distances are doubled so that a box with an even side has its centre
  // between two pixels.
  const int outer = primitive.width < primitive.height ? primitive.width : primitive.height;
  const int inner = outer - 2 * primitive.borderRadius;
  const ArcVector startEdge = ArcDirection(start);
  const ArcVector filledEdge = ArcDirection(start + filled);
  const ArcVector pieceEdge = ArcDirection(start + pieceEnd);
  const ArcVector endEdge = ArcDirection(start + sweep);
  const bool hasTick = pace.planAt >= 0;
  const ArcVector planEdge = ArcDirection(start + sweep * pace.planAt / 100);
  const int reach = hasTick ? kPaceTickOverhang : 0;
  const uint16_t hatchGap = PaceHatchGapColor(pace.pieceColor, primitive.bg);
  RectCommand run;
  run.height = 1;
  for (int row = -reach; row < primitive.height + reach; ++row) {
    run.y = primitive.y + row;
    int kind = 0;  // 0 outside the arc, 1 track, 2 filled, 3 piece, 4 hatch stripe, 5 hatch gap, 6 tick
    for (int col = -reach; col <= primitive.width + reach; ++col) {
      const ArcVector pixel = {2 * col + 1 - primitive.width, 2 * row + 1 - primitive.height};
      const int distance = pixel.x * pixel.x + pixel.y * pixel.y;
      int next = 0;
      if (col < primitive.width + reach) {
        if (hasTick && distance <= (outer + 2 * reach) * (outer + 2 * reach) &&
            (inner - 2 * reach <= 0 || distance >= (inner - 2 * reach) * (inner - 2 * reach)) &&
            planEdge.x * pixel.x + planEdge.y * pixel.y > 0 &&
            planEdge.x * pixel.y - planEdge.y * pixel.x <= 2 * 4096 &&
            planEdge.y * pixel.x - planEdge.x * pixel.y <= 2 * 4096) {
          next = 6;
        } else if (distance <= outer * outer && distance >= inner * inner) {
          if (filled > 0 && ArcSweepContains(startEdge, filledEdge, filled, pixel)) {
            next = 2;
          } else if (pieceEnd > filled && ArcSweepContains(filledEdge, pieceEdge, pieceEnd - filled, pixel)) {
            next = !pace.hatched ? 3 : ((primitive.x + col + primitive.y + row) & 3) < 2 ? 4 : 5;
          } else if (ArcSweepContains(startEdge, endEdge, sweep, pixel)) {
            next = 1;
          }
        }
      }
      if (next == kind) {
        continue;
      }
      if (kind != 0) {
        run.width = primitive.x + col - run.x;
        run.color = kind == 1   ? primitive.bg
                    : kind == 2 ? fillColor
                    : kind == 5 ? hatchGap
                    : kind == 6 ? 0xFFFF
                                : pace.pieceColor;
        sink.FillRect(run);
      }
      run.x = primitive.x + col;
      kind = next;
    }
  }
}

inline bool CompiledProgressLaneUnavailable(const CompiledPrimitive& primitive, const FrameData& frame) {
  const int slotIndex = UsageWindowBindingIndex(primitive.binding);
  if (slotIndex >= 0) {
    return !BoundUsageWindowFor(frame, primitive.binding, slotIndex).available;
  }
  if (frame.usageUnavailable) {
    return false;
  }
  if (StringEqualsAny(primitive.binding, "weekly", "weeklyPercent", "w")) {
    return frame.weeklyUnavailable;
  }
  return frame.sessionUnavailable;
}

inline bool CompiledPrimitiveIsAnimated(
    const CompiledThemeSpec& scene,
    const CompiledPrimitive& primitive,
    const FrameData& frame) {
  if (primitive.kind == PrimitiveKind::Gif) {
    return true;
  }
  if (primitive.kind == PrimitiveKind::Sprite) {
    return AssetPathLooksAnimated(CompiledStateAssetPathFor(scene, primitive, frame));
  }
  return false;
}

inline bool ResetFooterFits(Sink* sink, const CompiledPrimitive& primitive, const char* text) {
  return sink == nullptr || primitive.maxWidth <= 0 ||
         sink->MeasureText(text, primitive.font, primitive.size) <= primitive.maxWidth;
}

// Mirrors displayedResetFooter in the preview. Only a standalone first-limit
// countdown below the displayed usage rows is a shared footer.
inline bool RenderDisplayedResetFooter(const CompiledThemeSpec& scene,
    const CompiledPrimitive& primitive, const FrameData& frame, char* out, size_t outSize,
    Sink* sink = nullptr) {
  const char* raw = SafeText(primitive.text);
  const char* token = nullptr;
  if (std::strncmp(raw, "Reset in ", 9) == 0) token = raw + 9;
  if (std::strncmp(raw, "Resets in ", 10) == 0) token = raw + 10;
  const bool binding = StringEqualsAny(primitive.binding, "usageSlot1Reset", "us1r", "usage.0.reset");
  if (primitive.binding != nullptr && !binding) return false;
  if (!binding && (token == nullptr ||
      (std::strcmp(token, "{usageSlot1Reset}") != 0 &&
       std::strcmp(token, "{us1r}") != 0 &&
       std::strcmp(token, "{usage.0.reset}") != 0))) return false;
  bool displayed[kMaxThemeSpecUsageWindows] = {};
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    const CompiledPrimitive& row = scene.primitives[i];
    if (&row == &primitive || row.usageSlot == 0 ||
        !UsageWindowOwnerAvailableFor(frame, row.usageSlot - 1)) continue;
    if (row.y >= primitive.y) return false;
    displayed[row.usageSlot - 1] = true;
  }
  size_t displayedCount = 0;
  for (bool slot : displayed) if (slot) ++displayedCount;
  size_t preferred = kMaxThemeSpecUsageWindows;
  if (!frame.usageUnavailable && SafeText(frame.footerWindow)[0] != '\0') {
    for (size_t i = 0; i < kMaxThemeSpecUsageWindows; ++i) {
      const auto& window = frame.usageWindows[i];
      if (displayed[i] && window.available && window.resetSecs > 0 &&
          std::strcmp(SafeText(window.id), frame.footerWindow) == 0) {
        preferred = i;
        break;
      }
    }
  }
  bool sawDisplayed = false;
  bool sawAvailable = false;
  bool allIdle = true;
  for (size_t order = 0; order < kMaxThemeSpecUsageWindows; ++order) {
    const size_t i = preferred < kMaxThemeSpecUsageWindows ? preferred : order;
    if (!displayed[i]) continue;
    sawDisplayed = true;
    UsageWindowData window = UsageWindowFor(frame, static_cast<int>(i));
    if (!window.available) window = LegacyUsageSlotFor(frame, static_cast<int>(i));
    if (!window.available) continue;
    sawAvailable = true;
    allIdle = allIdle && ResetSecsAreIdle(window.resetSecs);
    if (window.resetSecs <= 0 || frame.usageUnavailable) continue;
    char duration[32] = {};
    FormatDuration(window.resetSecs, duration, sizeof(duration));
    // A pair label ("Claude Weekly") is longer than the limit name ("Weekly").
    const char* label = SafeText(window.label);
    const char* limit = std::strchr(frame.provider, '+') != nullptr && std::strchr(label, ' ') != nullptr
        ? std::strchr(label, ' ') + 1 : label;
    const char* formats[] = {"%s resets in %s", "%s %s", "%s %s"};
    const char* names[] = {label, label, limit};
    for (size_t v = 0; v < 3; ++v) {
      std::snprintf(out, outSize, formats[v], names[v], duration);
      if (ResetFooterFits(sink, primitive, out)) break;
    }
    if (displayedCount == 1 && !ResetFooterFits(sink, primitive, out)) {
      std::snprintf(out, outSize, "Resets %s", duration);
    }
    return true;
  }
  if (!sawDisplayed) return false;
  std::snprintf(out, outSize, "%s", ResetTextFor(sawAvailable && allIdle && !frame.usageUnavailable));
  return true;
}

inline bool RenderCompiledText(const CompiledThemeSpec& scene,
    const CompiledPrimitive& primitive, const FrameData& frame, char* out, size_t outSize,
    Sink* sink = nullptr) {
  if (RenderDisplayedResetFooter(scene, primitive, frame, out, outSize, sink)) return true;
  if (primitive.binding != nullptr) BoundValue(primitive.binding, frame, out, outSize);
  else RenderTextTemplate(primitive.text, frame, out, outSize);
  return false;
}

inline bool CompiledPrimitiveBounds(
    const CompiledThemeSpec& scene,
    const CompiledPrimitive& primitive,
    const FrameData& frame,
    bool requireStableTextBounds,
    Bounds& bounds) {
  bounds = Bounds{};
  bounds.x = primitive.x;
  bounds.y = primitive.y;

  if (primitive.kind == PrimitiveKind::Rect ||
      primitive.kind == PrimitiveKind::Progress ||
      primitive.kind == PrimitiveKind::Gif ||
      primitive.kind == PrimitiveKind::Pixels) {
    bounds.width = primitive.width;
    bounds.height = primitive.height;
    if (primitive.kind == PrimitiveKind::Progress && IsPaceBarBinding(primitive.binding) && bounds.width > 0 &&
        bounds.height > 0) {
      // The plan tick reaches beyond the bar; repainting must clear it too.
      const int right = bounds.x + bounds.width + kPaceTickOverhang;
      const int bottom = bounds.y + bounds.height + kPaceTickOverhang;
      bounds.x = bounds.x > kPaceTickOverhang ? bounds.x - kPaceTickOverhang : 0;
      bounds.y = bounds.y > kPaceTickOverhang ? bounds.y - kPaceTickOverhang : 0;
      bounds.width = (right < kThemeSpecCanvasSize ? right : kThemeSpecCanvasSize) - bounds.x;
      bounds.height = (bottom < kThemeSpecCanvasSize ? bottom : kThemeSpecCanvasSize) - bounds.y;
    }
    return bounds.width > 0 && bounds.height > 0;
  }

  if (primitive.kind == PrimitiveKind::Sprite) {
    const char* assetPath = CompiledStateAssetPathFor(scene, primitive, frame);
    if (assetPath == nullptr || assetPath[0] == '\0') {
      return false;
    }
    bounds.width = primitive.width;
    bounds.height = primitive.height;
    return bounds.width > 0 && bounds.height > 0;
  }

  if (primitive.kind == PrimitiveKind::Text) {
    if (primitive.size <= 0) {
      return false;
    }
    const int visualGlyph = VisualFontHeight(primitive.font, primitive.size);
    const int clipH = ApproxTextHeight(primitive.font, primitive.size);
    const int boxH = TextValignBoxHeight(primitive.height, primitive.font, primitive.size);
    const int alignedY = AlignedTextY(primitive.y, boxH, visualGlyph, primitive.valign);
    const int boxBottom = primitive.y + boxH;
    const int glyphBottom = alignedY + clipH;
    bounds.y = alignedY < primitive.y ? alignedY : primitive.y;
    const int bottom = boxBottom > glyphBottom ? boxBottom : glyphBottom;
    bounds.height = bottom - bounds.y;
    bounds.width = primitive.maxWidth;
    if (bounds.width <= 0) {
      if (requireStableTextBounds) {
        bounds.width = kThemeSpecCanvasSize - primitive.x;
      }
      if (bounds.width <= 0) {
        char text[128] = {0};
        RenderCompiledText(scene, primitive, frame, text, sizeof(text));
        bounds.width = ApproxTextWidth(text, primitive.size);
      }
    }
    return bounds.width > 0;
  }

  return false;
}

// A known slot can be temporarily unavailable. Keep its identity visible,
// without drawing a zero percent bar or a stale reset/pace.
inline bool MissingUsageText(const CompiledPrimitive& primitive, const FrameData& frame, char* out, size_t outSize) {
  if (primitive.kind != PrimitiveKind::Text || primitive.usageSlot == 0) return false;
  const auto window = UsageWindowFor(frame, primitive.usageSlot - 1);
  if (window.available || SafeText(window.label)[0] == '\0') return false;
  const char* source = primitive.binding != nullptr ? primitive.binding : SafeText(primitive.text);
  const bool label = std::strstr(source, "Label") != nullptr || std::strstr(source, ".label") != nullptr;
  const bool percent = std::strstr(source, "Percent") != nullptr || std::strstr(source, ".percent") != nullptr;
  if (!label && !percent) return false;
  std::snprintf(out, outSize, "%s%s", label ? window.label : "", percent ? (label ? " --" : "--") : "");
  return true;
}

inline bool DrawCompiledPrimitive(
    const CompiledThemeSpec& scene,
    const CompiledPrimitive& primitive,
    const FrameData& frame,
    Sink& sink) {
  char text[128] = {0};
  const bool missing = MissingUsageText(primitive, frame, text, sizeof(text));
  if (primitive.usageSlot > 0 && !missing &&
      !UsageWindowOwnerAvailableFor(frame, static_cast<int>(primitive.usageSlot - 1))) {
    return false;
  }
  if (primitive.providerSlot > 0 &&
      !frame.providerSlots[primitive.providerSlot - 1].available) {
    return false;
  }
  if (primitive.kind == PrimitiveKind::Rect) {
    RectCommand cmd;
    cmd.x = primitive.x;
    cmd.y = primitive.y;
    cmd.width = primitive.width;
    cmd.height = primitive.height;
    cmd.borderRadius = primitive.borderRadius;
    cmd.color = primitive.color;
    if (cmd.width <= 0 || cmd.height <= 0) {
      return false;
    }
    sink.FillRect(cmd);
    return true;
  }

  if (primitive.kind == PrimitiveKind::Text) {
    TextCommand cmd;
    cmd.x = primitive.x;
    cmd.y = primitive.y;
    cmd.font = primitive.font;
    cmd.size = primitive.size;
    cmd.maxWidth = primitive.maxWidth;
    cmd.fitShrink = primitive.fitShrink;
    cmd.align = primitive.align;
    cmd.valign = primitive.valign;
    cmd.height = primitive.height;
    if (cmd.size <= 0) {
      return false;
    }
    if (!missing && RenderCompiledText(scene, primitive, frame, text, sizeof(text), &sink) &&
        IsResetCountdownText(text) && ResetFooterFits(&sink, primitive, text)) {
      cmd.fitShrink = false;
    }
    cmd.text = text;
    cmd.fg = primitive.colorStopCount > 0 ? ResolvePaceColor(primitive, frame) : primitive.color;
    cmd.bg = primitive.bg;
    cmd.hasBg = primitive.hasBg;
    sink.DrawText(cmd);
    return true;
  }

  if (primitive.kind == PrimitiveKind::Progress) {
    if (CompiledProgressLaneUnavailable(primitive, frame)) {
      return false;
    }
    const int percent = CompiledProgressPercentFor(primitive, frame);
    const PaceBar pace = PaceBarFor(primitive, frame, percent);
    const uint16_t fillColor = ResolveProgressFillColor(primitive, percent, frame.usageMode);
    if (primitive.style == kProgressStyleArc) {
      DrawProgressArc(primitive, pace, fillColor, sink);
      return true;
    }
    ProgressCommand cmd;
    cmd.x = primitive.x;
    cmd.y = primitive.y;
    cmd.width = primitive.width;
    cmd.height = primitive.height;
    cmd.percent = pace.fillTo;
    cmd.pieceTo = pace.pieceTo;
    cmd.planAt = pace.planAt;
    cmd.hatched = pace.hatched;
    cmd.pieceColor = pace.pieceColor;
    cmd.hatchGapColor = PaceHatchGapColor(pace.pieceColor, primitive.bg);
    cmd.style = primitive.style;
    cmd.segments = primitive.segments;
    cmd.segmentGap = primitive.segmentGap;
    cmd.borderRadius = primitive.borderRadius;
    cmd.fillColor = fillColor;
    cmd.bgColor = primitive.bg;
    cmd.borderColor = primitive.border;
    if (cmd.width <= 0 || cmd.height <= 0) {
      return false;
    }
    sink.DrawProgress(cmd);
    return true;
  }

  if (primitive.kind == PrimitiveKind::Gif) {
    GifCommand cmd;
    cmd.x = primitive.x;
    cmd.y = primitive.y;
    cmd.width = primitive.width;
    cmd.height = primitive.height;
    cmd.assetPath = CompiledStateAssetPathFor(scene, primitive, frame);
    cmd.hasBg = primitive.hasBg;
    cmd.bg = primitive.bg;
    if (cmd.assetPath == nullptr || cmd.assetPath[0] == '\0' || cmd.width <= 0 || cmd.height <= 0) {
      return false;
    }
    sink.DrawGif(cmd);
    return true;
  }

  if (primitive.kind == PrimitiveKind::Sprite) {
    SpriteCommand cmd;
    cmd.x = primitive.x;
    cmd.y = primitive.y;
    cmd.width = primitive.width;
    cmd.height = primitive.height;
    cmd.assetPath = CompiledStateAssetPathFor(scene, primitive, frame);
    cmd.hasBg = primitive.hasBg;
    cmd.bg = primitive.bg;
    if (cmd.assetPath == nullptr || cmd.assetPath[0] == '\0') {
      return false;
    }
    sink.DrawSprite(cmd);
    return true;
  }

  if (primitive.kind == PrimitiveKind::Pixels) {
    PixelsCommand cmd;
    cmd.x = primitive.x;
    cmd.y = primitive.y;
    cmd.width = primitive.width;
    cmd.height = primitive.height;
    if (!primitive.palette.isNull() || !primitive.rows.isNull()) {
      uint16_t palette[26] = {0};
      int paletteSize = 0;
      if (!ParseColorPalette(primitive.palette, palette, paletteSize) ||
          !RenderRlePixelRows(primitive.rows, palette, paletteSize, cmd.x, cmd.y, cmd.width, cmd.height, nullptr)) {
        return false;
      }
      return RenderRlePixelRows(primitive.rows, palette, paletteSize, cmd.x, cmd.y, cmd.width, cmd.height, &sink);
    }

    cmd.data = primitive.data;
    if (!HasHexBitmapBits(cmd.data, cmd.width, cmd.height)) {
      return false;
    }
    cmd.color = primitive.color;
    sink.DrawPixels(cmd);
    return true;
  }

  return false;
}

inline bool RenderCompiledThemeSpec(const CompiledThemeSpec& scene, const FrameData& frame, Sink& sink) {
  if (scene.primitiveCount == 0) {
    return false;
  }
  sink.FillScreen(scene.bgColor);
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    (void)DrawCompiledPrimitive(scene, scene.primitives[i], frame, sink);
    RenderYield();
  }
  return true;
}

inline bool RenderCompiledThemeSpecStaticPrimitives(const CompiledThemeSpec& scene, const FrameData& frame, Sink& sink) {
  if (scene.primitiveCount == 0) {
    return false;
  }
  sink.FillScreen(scene.bgColor);
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    if (!CompiledPrimitiveIsAnimated(scene, scene.primitives[i], frame)) {
      (void)DrawCompiledPrimitive(scene, scene.primitives[i], frame, sink);
      RenderYield();
    }
  }
  return true;
}

inline bool RenderCompiledThemeSpecAnimatedPrimitives(const CompiledThemeSpec& scene, const FrameData& frame, Sink& sink) {
  bool rendered = false;
  sink.PrimeBackground(scene.bgColor);
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    if (CompiledPrimitiveIsAnimated(scene, scene.primitives[i], frame)) {
      rendered = DrawCompiledPrimitive(scene, scene.primitives[i], frame, sink) || rendered;
    }
  }
  return rendered;
}

// An animated sprite replaces its whole rectangle with every frame. Draw again,
// inside that rectangle only, whatever the scene places on top of it, so a
// label or a usage bar over a moving figure stays on the display.
inline void RenderCompiledThemeSpecOverAnimatedPrimitives(const CompiledThemeSpec& scene, const FrameData& frame, Sink& sink) {
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    Bounds animated;
    if (!CompiledPrimitiveIsAnimated(scene, scene.primitives[i], frame) ||
        !CompiledPrimitiveBounds(scene, scene.primitives[i], frame, false, animated)) {
      continue;
    }
    bool clipped = false;
    for (size_t j = i + 1; j < scene.primitiveCount; ++j) {
      Bounds above;
      if (CompiledPrimitiveIsAnimated(scene, scene.primitives[j], frame) ||
          !CompiledPrimitiveBounds(scene, scene.primitives[j], frame, false, above) ||
          !BoundsOverlap(animated, above)) {
        continue;
      }
      if (!clipped) {
        sink.BeginClip(animated.x, animated.y, animated.width, animated.height);
        clipped = true;
      }
      DrawCompiledPrimitive(scene, scene.primitives[j], frame, sink);
    }
    if (clipped) {
      sink.EndClip();
    }
  }
}

inline bool RenderCompiledThemeSpecRegionPrimitives(
    const CompiledThemeSpec& scene,
    const FrameData& frame,
    const Bounds& region,
    Sink& sink,
    const char** error = nullptr,
    bool* skippedAnimatedOverlap = nullptr) {
  if (error != nullptr) {
    *error = "";
  }
  if (skippedAnimatedOverlap != nullptr) {
    *skippedAnimatedOverlap = false;
  }
  if (scene.primitiveCount == 0) {
    if (error != nullptr) {
      *error = "empty_scene";
    }
    return false;
  }
  if (region.width <= 0 || region.height <= 0) {
    if (error != nullptr) {
      *error = "empty_region";
    }
    return false;
  }

  sink.PrimeBackground(scene.bgColor);
  sink.BeginClip(region.x, region.y, region.width, region.height);
  RectCommand background;
  background.x = region.x;
  background.y = region.y;
  background.width = region.width;
  background.height = region.height;
  background.color = scene.bgColor;
  sink.FillRect(background);

  bool rendered = false;
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    Bounds primitiveBounds;
    const CompiledPrimitive& primitive = scene.primitives[i];
    if (CompiledPrimitiveBounds(scene, primitive, frame, false, primitiveBounds) &&
        BoundsOverlap(region, primitiveBounds)) {
      if (CompiledPrimitiveIsAnimated(scene, primitive, frame)) {
        if (skippedAnimatedOverlap != nullptr) {
          *skippedAnimatedOverlap = true;
        }
        rendered = true;
        continue;
      }
      rendered = DrawCompiledPrimitive(scene, primitive, frame, sink) || rendered;
      RenderYield();
    }
  }
  sink.EndClip();
  if (!rendered && error != nullptr) {
    *error = "no_overlap_rendered";
  }
  return rendered;
}

inline bool RenderCompiledThemeSpecChangedPrimitives(
    const CompiledThemeSpec& scene,
    const FrameData& frame,
    uint32_t changedFields,
    Sink& sink,
    const char** error = nullptr,
    bool* skippedAnimatedOverlap = nullptr) {
  if (error != nullptr) {
    *error = "";
  }
  if (skippedAnimatedOverlap != nullptr) {
    *skippedAnimatedOverlap = false;
  }
  if (changedFields == 0) {
    if (error != nullptr) {
      *error = "no_changed_fields";
    }
    return false;
  }
  if (scene.primitiveCount == 0) {
    if (error != nullptr) {
      *error = "empty_scene";
    }
    return false;
  }

  bool hasAffectedPrimitive = false;
  Bounds dirty;
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    const CompiledPrimitive& primitive = scene.primitives[i];
    if ((primitive.liveFields & changedFields) == 0) {
      continue;
    }
    hasAffectedPrimitive = true;
    Bounds primitiveBounds;
    if (!CompiledPrimitiveBounds(scene, primitive, frame, true, primitiveBounds)) {
      if (error != nullptr) {
        *error = "unstable_dirty_bounds";
      }
      return false;
    }
    ExpandBounds(dirty, primitiveBounds);
  }
  if (!hasAffectedPrimitive) {
    if (error != nullptr) {
      *error = "no_affected_primitive";
    }
    return false;
  }
  if (dirty.width <= 0 || dirty.height <= 0) {
    if (error != nullptr) {
      *error = "empty_dirty_bounds";
    }
    return false;
  }

  bool dirtyBridgesUnchangedAnimation = false;
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    const CompiledPrimitive& primitive = scene.primitives[i];
    if (!CompiledPrimitiveIsAnimated(scene, primitive, frame) ||
        (primitive.liveFields & changedFields) != 0) {
      continue;
    }
    Bounds primitiveBounds;
    if (CompiledPrimitiveBounds(scene, primitive, frame, false, primitiveBounds) &&
        BoundsOverlap(dirty, primitiveBounds)) {
      dirtyBridgesUnchangedAnimation = true;
      break;
    }
  }

  if (dirtyBridgesUnchangedAnimation) {
    bool skippedAnimated = false;
    for (size_t i = 0; i < scene.primitiveCount; ++i) {
      const CompiledPrimitive& primitive = scene.primitives[i];
      if ((primitive.liveFields & changedFields) == 0) {
        continue;
      }
      Bounds primitiveBounds;
      if (!CompiledPrimitiveBounds(scene, primitive, frame, true, primitiveBounds)) {
        if (error != nullptr) {
          *error = "unstable_dirty_bounds";
        }
        return false;
      }
      bool regionSkippedAnimated = false;
      if (!RenderCompiledThemeSpecRegionPrimitives(
              scene,
              frame,
              primitiveBounds,
              sink,
              error,
              &regionSkippedAnimated)) {
        return false;
      }
      skippedAnimated = skippedAnimated || regionSkippedAnimated;
    }
    if (skippedAnimatedOverlap != nullptr) {
      *skippedAnimatedOverlap = skippedAnimated;
    }
    return true;
  }

  return RenderCompiledThemeSpecRegionPrimitives(scene, frame, dirty, sink, error, skippedAnimatedOverlap);
}

inline bool AnyAnimatedCompiledPrimitiveOverlaps(
    const CompiledThemeSpec& scene,
    const FrameData& frame,
    const Bounds& region) {
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    const CompiledPrimitive& primitive = scene.primitives[i];
    if (!CompiledPrimitiveIsAnimated(scene, primitive, frame)) {
      continue;
    }
    Bounds primitiveBounds;
    if (CompiledPrimitiveBounds(scene, primitive, frame, false, primitiveBounds) &&
        BoundsOverlap(region, primitiveBounds)) {
      return true;
    }
  }
  return false;
}

}  // namespace themespec
}  // namespace codexbar_display
