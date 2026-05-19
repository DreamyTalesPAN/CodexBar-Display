#pragma once

#include <ArduinoJson.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <new>

namespace codexbar_display {
namespace themespec {

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
constexpr int kThemeSpecCanvasSize = 240;

inline void RenderYield() {
#if defined(ARDUINO)
  yield();
#endif
}

struct FrameData {
  const char* provider = "";
  const char* label = "";
  int session = 0;
  int weekly = 0;
  int64_t resetSecs = 0;
  const char* usageMode = "";
  const char* activity = "idle";
  const char* time = "";
  const char* date = "";
  int64_t sessionTokens = 0;
  int64_t weekTokens = 0;
  int64_t totalTokens = 0;
};

struct RectCommand {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
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
  uint16_t fillColor = 0xFFFF;
  uint16_t borderColor = 0x7BEF;
  uint16_t bgColor = 0x0000;
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
constexpr size_t kMaxCompiledStateAssets = 16;

enum class PrimitiveKind : uint8_t {
  Unknown = 0,
  Rect,
  Text,
  Progress,
  Gif,
  Sprite,
  Pixels,
};

struct CompiledStateAsset {
  const char* state = nullptr;
  const char* path = nullptr;
};

struct CompiledPrimitive {
  PrimitiveKind kind = PrimitiveKind::Unknown;
  uint32_t liveFields = 0;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  int font = 1;
  int size = 1;
  int maxWidth = 0;
  int align = 0;
  int style = 0;
  int segments = 0;
  int segmentGap = 1;
  uint16_t color = 0xFFFF;
  uint16_t bg = 0x0000;
  uint16_t border = 0x7BEF;
  bool hasBg = false;
  bool fitShrink = false;
  const char* text = "";
  const char* binding = nullptr;
  const char* assetPath = "";
  const char* data = "";
  const CompiledStateAsset* stateAssets = nullptr;
  size_t stateAssetCount = 0;
  JsonArrayConst palette;
  JsonArrayConst rows;
};

struct CompiledThemeSpec {
  uint16_t bgColor = 0x0000;
  CompiledPrimitive* primitives = nullptr;
  size_t primitiveCapacity = 0;
  size_t primitiveCount = 0;
  CompiledStateAsset* stateAssets = nullptr;
  size_t stateAssetCapacity = 0;
  size_t stateAssetCount = 0;
  bool hasAnimatedAssets = false;
  bool requiresJsonDocument = false;
  bool ownsMemory = false;
  char* stringPool = nullptr;
  size_t stringPoolCapacity = 0;
  size_t stringPoolUsed = 0;
};

struct CompiledThemeSpecStoragePlan {
  size_t primitiveCapacity = 0;
  size_t stateAssetCapacity = 0;
  size_t stringPoolCapacity = 0;
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
  virtual void DrawText(const TextCommand& cmd) = 0;
  virtual void DrawProgress(const ProgressCommand& cmd) = 0;
  virtual void DrawGif(const GifCommand& cmd) = 0;
  virtual void DrawSprite(const SpriteCommand& cmd) = 0;
  virtual void DrawPixels(const PixelsCommand& cmd) = 0;
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

inline const char* StateAssetPathFor(JsonObjectConst primitive, const FrameData& frame) {
  JsonObjectConst stateAssets = JsonObjectFor(primitive, "stateAssets", "sa");
  if (!stateAssets.isNull()) {
    const char* activity = frame.activity == nullptr ? "" : frame.activity;
    const char* activeAsset = JsonStringOrNull(stateAssets[activity]);
    if (activeAsset != nullptr && activeAsset[0] != '\0') {
      return activeAsset;
    }
    const char* idleAsset = JsonStringOrNull(stateAssets["idle"]);
    if (idleAsset != nullptr && idleAsset[0] != '\0') {
      return idleAsset;
    }
  }
  return JsonStringFor(primitive, "assetPath", "a");
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
  const int64_t hours = secs / 3600;
  const int64_t minutes = (secs % 3600) / 60;
  if (hours > 0) {
    std::snprintf(out, outSize, "%lldh %lldm", static_cast<long long>(hours), static_cast<long long>(minutes));
    return;
  }
  std::snprintf(out, outSize, "%lldm", static_cast<long long>(minutes));
}

inline const char* SafeText(const char* value) {
  return value == nullptr ? "" : value;
}

inline void BoundValue(const char* key, const FrameData& frame, char* out, size_t outSize) {
  if (out == nullptr || outSize == 0) {
    return;
  }
  out[0] = '\0';
  key = SafeText(key);

  if (std::strcmp(key, "label") == 0 || std::strcmp(key, "providerLabel") == 0 || std::strcmp(key, "l") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.label));
    return;
  }
  if (std::strcmp(key, "provider") == 0 || std::strcmp(key, "pr") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.provider));
    return;
  }
  if (std::strcmp(key, "session") == 0 || std::strcmp(key, "sessionPercent") == 0 || std::strcmp(key, "s") == 0) {
    std::snprintf(out, outSize, "%d", ClampPct(frame.session));
    return;
  }
  if (std::strcmp(key, "weekly") == 0 || std::strcmp(key, "weeklyPercent") == 0 || std::strcmp(key, "w") == 0) {
    std::snprintf(out, outSize, "%d", ClampPct(frame.weekly));
    return;
  }
  if (std::strcmp(key, "reset") == 0 || std::strcmp(key, "resetCountdown") == 0 || std::strcmp(key, "r") == 0) {
    FormatDuration(frame.resetSecs, out, outSize);
    return;
  }
  if (std::strcmp(key, "usageMode") == 0 || std::strcmp(key, "u") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.usageMode));
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
    std::snprintf(out, outSize, "%lld", static_cast<long long>(frame.sessionTokens));
    return;
  }
  if (std::strcmp(key, "weekTokens") == 0 || std::strcmp(key, "wt") == 0) {
    std::snprintf(out, outSize, "%lld", static_cast<long long>(frame.weekTokens));
    return;
  }
  if (std::strcmp(key, "totalTokens") == 0 || std::strcmp(key, "tt") == 0) {
    std::snprintf(out, outSize, "%lld", static_cast<long long>(frame.totalTokens));
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

inline void RenderTextTemplate(const char* raw, const FrameData& frame, char* out, size_t outSize) {
  if (out == nullptr || outSize == 0) {
    return;
  }
  out[0] = '\0';
  raw = SafeText(raw);

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

inline int ProgressPercentFor(JsonObjectConst primitive, const FrameData& frame) {
  const char* binding = JsonStringFor(primitive, "binding", "b");
  if (binding != nullptr &&
      (std::strcmp(binding, "weekly") == 0 || std::strcmp(binding, "weeklyPercent") == 0 || std::strcmp(binding, "w") == 0)) {
    return ClampPct(frame.weekly);
  }
  return ClampPct(frame.session);
}

inline bool StringEqualsAny(const char* value, const char* a, const char* b, const char* c = nullptr) {
  value = SafeText(value);
  return (a != nullptr && std::strcmp(value, a) == 0) ||
         (b != nullptr && std::strcmp(value, b) == 0) ||
         (c != nullptr && std::strcmp(value, c) == 0);
}

inline bool TemplateUsesField(const char* raw, const char* a, const char* b, const char* c = nullptr) {
  raw = SafeText(raw);
  for (size_t i = 0; raw[i] != '\0'; ++i) {
    if (raw[i] != '{') {
      continue;
    }
    const char* close = std::strchr(raw + i + 1, '}');
    if (close == nullptr) {
      return false;
    }
    char key[32] = {0};
    const size_t keyLen = static_cast<size_t>(close - (raw + i + 1));
    if (keyLen > 0 && keyLen < sizeof(key)) {
      std::memcpy(key, raw + i + 1, keyLen);
      if (StringEqualsAny(key, a, b, c)) {
        return true;
      }
    }
    i += keyLen + 1;
  }
  return false;
}

inline bool BindingUsesField(const char* binding, uint32_t fields) {
  if ((fields & kThemeSpecFieldProvider) != 0 && StringEqualsAny(binding, "provider", "pr")) {
    return true;
  }
  if ((fields & kThemeSpecFieldLabel) != 0 && StringEqualsAny(binding, "label", "providerLabel", "l")) {
    return true;
  }
  if ((fields & kThemeSpecFieldSession) != 0 && StringEqualsAny(binding, "session", "sessionPercent", "s")) {
    return true;
  }
  if ((fields & kThemeSpecFieldWeekly) != 0 && StringEqualsAny(binding, "weekly", "weeklyPercent", "w")) {
    return true;
  }
  if ((fields & kThemeSpecFieldReset) != 0 && StringEqualsAny(binding, "reset", "resetCountdown", "r")) {
    return true;
  }
  if ((fields & kThemeSpecFieldUsageMode) != 0 && StringEqualsAny(binding, "usageMode", "u")) {
    return true;
  }
  if ((fields & kThemeSpecFieldActivity) != 0 && StringEqualsAny(binding, "activity", "act")) {
    return true;
  }
  if ((fields & kThemeSpecFieldTime) != 0 && StringEqualsAny(binding, "time", "tm")) {
    return true;
  }
  if ((fields & kThemeSpecFieldDate) != 0 && StringEqualsAny(binding, "date", "dt")) {
    return true;
  }
  if ((fields & kThemeSpecFieldSessionTokens) != 0 && StringEqualsAny(binding, "sessionTokens", "st")) {
    return true;
  }
  if ((fields & kThemeSpecFieldWeekTokens) != 0 && StringEqualsAny(binding, "weekTokens", "wt")) {
    return true;
  }
  if ((fields & kThemeSpecFieldTotalTokens) != 0 && StringEqualsAny(binding, "totalTokens", "tt")) {
    return true;
  }
  return false;
}

inline bool TextTemplateUsesField(const char* raw, uint32_t fields) {
  return ((fields & kThemeSpecFieldProvider) != 0 && TemplateUsesField(raw, "provider", "pr")) ||
         ((fields & kThemeSpecFieldLabel) != 0 && TemplateUsesField(raw, "label", "providerLabel", "l")) ||
         ((fields & kThemeSpecFieldSession) != 0 && TemplateUsesField(raw, "session", "sessionPercent", "s")) ||
         ((fields & kThemeSpecFieldWeekly) != 0 && TemplateUsesField(raw, "weekly", "weeklyPercent", "w")) ||
         ((fields & kThemeSpecFieldReset) != 0 && TemplateUsesField(raw, "reset", "resetCountdown", "r")) ||
         ((fields & kThemeSpecFieldUsageMode) != 0 && TemplateUsesField(raw, "usageMode", "u")) ||
         ((fields & kThemeSpecFieldActivity) != 0 && TemplateUsesField(raw, "activity", "act")) ||
         ((fields & kThemeSpecFieldTime) != 0 && TemplateUsesField(raw, "time", "tm")) ||
         ((fields & kThemeSpecFieldDate) != 0 && TemplateUsesField(raw, "date", "dt")) ||
         ((fields & kThemeSpecFieldSessionTokens) != 0 && TemplateUsesField(raw, "sessionTokens", "st")) ||
         ((fields & kThemeSpecFieldWeekTokens) != 0 && TemplateUsesField(raw, "weekTokens", "wt")) ||
         ((fields & kThemeSpecFieldTotalTokens) != 0 && TemplateUsesField(raw, "totalTokens", "tt"));
}

inline bool PrimitiveUsesChangedFields(JsonObjectConst primitive, uint32_t fields) {
  if (fields == 0) {
    return false;
  }
  if (PrimitiveTypeIs(primitive, "text", "tx")) {
    const char* binding = JsonStringFor(primitive, "binding", "b");
    if (binding != nullptr) {
      return BindingUsesField(binding, fields);
    }
    return TextTemplateUsesField(JsonStringFor(primitive, "text", "v"), fields);
  }
  if (PrimitiveTypeIs(primitive, "progress", "p")) {
    const char* binding = JsonStringFor(primitive, "binding", "b");
    if (binding != nullptr &&
        (std::strcmp(binding, "weekly") == 0 || std::strcmp(binding, "weeklyPercent") == 0 || std::strcmp(binding, "w") == 0)) {
      return (fields & kThemeSpecFieldWeekly) != 0;
    }
    return (fields & kThemeSpecFieldSession) != 0;
  }
  if (PrimitiveTypeIs(primitive, "gif", "g") ||
      PrimitiveTypeIs(primitive, "sprite", "sp") ||
      PrimitiveTypeIs(primitive, "image", "img")) {
    return (fields & kThemeSpecFieldActivity) != 0 &&
           !JsonObjectFor(primitive, "stateAssets", "sa").isNull();
  }
  return false;
}

inline uint32_t BindingFieldMask(const char* binding) {
  if (StringEqualsAny(binding, "provider", "pr")) {
    return kThemeSpecFieldProvider;
  }
  if (StringEqualsAny(binding, "label", "providerLabel", "l")) {
    return kThemeSpecFieldLabel;
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
  if (StringEqualsAny(binding, "usageMode", "u")) {
    return kThemeSpecFieldUsageMode;
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

inline uint32_t TextTemplateFieldMask(const char* raw) {
  uint32_t fields = 0;
  if (TemplateUsesField(raw, "provider", "pr")) {
    fields |= kThemeSpecFieldProvider;
  }
  if (TemplateUsesField(raw, "label", "providerLabel", "l")) {
    fields |= kThemeSpecFieldLabel;
  }
  if (TemplateUsesField(raw, "session", "sessionPercent", "s")) {
    fields |= kThemeSpecFieldSession;
  }
  if (TemplateUsesField(raw, "weekly", "weeklyPercent", "w")) {
    fields |= kThemeSpecFieldWeekly;
  }
  if (TemplateUsesField(raw, "reset", "resetCountdown", "r")) {
    fields |= kThemeSpecFieldReset;
  }
  if (TemplateUsesField(raw, "usageMode", "u")) {
    fields |= kThemeSpecFieldUsageMode;
  }
  if (TemplateUsesField(raw, "activity", "act")) {
    fields |= kThemeSpecFieldActivity;
  }
  if (TemplateUsesField(raw, "time", "tm")) {
    fields |= kThemeSpecFieldTime;
  }
  if (TemplateUsesField(raw, "date", "dt")) {
    fields |= kThemeSpecFieldDate;
  }
  if (TemplateUsesField(raw, "sessionTokens", "st")) {
    fields |= kThemeSpecFieldSessionTokens;
  }
  if (TemplateUsesField(raw, "weekTokens", "wt")) {
    fields |= kThemeSpecFieldWeekTokens;
  }
  if (TemplateUsesField(raw, "totalTokens", "tt")) {
    fields |= kThemeSpecFieldTotalTokens;
  }
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

inline bool StateAssetsLookAnimated(JsonObjectConst stateAssets) {
  if (stateAssets.isNull()) {
    return false;
  }
  for (JsonPairConst entry : stateAssets) {
    if (AssetPathLooksAnimated(JsonStringOrNull(entry.value()))) {
      return true;
    }
  }
  return false;
}

inline void ReleaseCompiledThemeSpec(CompiledThemeSpec& scene) {
  if (scene.ownsMemory) {
    delete[] scene.primitives;
    delete[] scene.stateAssets;
    delete[] scene.stringPool;
  }
  scene = CompiledThemeSpec{};
}

inline bool AllocateCompiledThemeSpecStorage(
    CompiledThemeSpec& scene,
    const CompiledThemeSpecStoragePlan& plan) {
  ReleaseCompiledThemeSpec(scene);
  if (plan.primitiveCapacity == 0 || plan.primitiveCapacity > kMaxCompiledThemeSpecPrimitives ||
      plan.stateAssetCapacity > kMaxCompiledStateAssets ||
      plan.stringPoolCapacity > kMaxCompiledThemeSpecStringBytes) {
    return false;
  }

  scene.primitives = new (std::nothrow) CompiledPrimitive[plan.primitiveCapacity];
  scene.stateAssets = plan.stateAssetCapacity == 0 ? nullptr : new (std::nothrow) CompiledStateAsset[plan.stateAssetCapacity];
  scene.stringPool = plan.stringPoolCapacity == 0 ? nullptr : new (std::nothrow) char[plan.stringPoolCapacity];
  if (scene.primitives == nullptr ||
      (plan.stateAssetCapacity > 0 && scene.stateAssets == nullptr) ||
      (plan.stringPoolCapacity > 0 && scene.stringPool == nullptr)) {
    ReleaseCompiledThemeSpec(scene);
    return false;
  }

  scene.ownsMemory = true;
  scene.primitiveCapacity = plan.primitiveCapacity;
  scene.stateAssetCapacity = plan.stateAssetCapacity;
  scene.stringPoolCapacity = plan.stringPoolCapacity;
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
      for (JsonPairConst entry : stateAssets) {
        const char* path = JsonStringOrNull(entry.value());
        if (path == nullptr || path[0] == '\0') {
          continue;
        }
        plan.stateAssetCapacity += 1;
        AddCompiledStringStorage(entry.key().c_str(), plan.stringPoolCapacity);
        AddCompiledStringStorage(path, plan.stringPoolCapacity);
      }
    } else if (PrimitiveTypeIs(primitive, "pixels", "px")) {
      AddCompiledStringStorage(JsonStringFor(primitive, "data", "d"), plan.stringPoolCapacity);
    }
  }

  return plan.stateAssetCapacity <= kMaxCompiledStateAssets &&
         plan.stringPoolCapacity <= kMaxCompiledThemeSpecStringBytes;
}

inline const char* CompiledStateAssetPathFor(const CompiledPrimitive& primitive, const FrameData& frame) {
  const char* activity = frame.activity == nullptr ? "" : frame.activity;
  const char* idleAsset = nullptr;
  for (size_t i = 0; i < primitive.stateAssetCount; ++i) {
    const char* state = primitive.stateAssets == nullptr ? nullptr : primitive.stateAssets[i].state;
    const char* path = primitive.stateAssets == nullptr ? nullptr : primitive.stateAssets[i].path;
    if (state == nullptr || path == nullptr || path[0] == '\0') {
      continue;
    }
    if (std::strcmp(state, activity) == 0) {
      return path;
    }
    if (std::strcmp(state, "idle") == 0) {
      idleAsset = path;
    }
  }
  if (idleAsset != nullptr) {
    return idleAsset;
  }
  return primitive.assetPath;
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
  out.stateAssets = scene.stateAssets == nullptr ? nullptr : scene.stateAssets + scene.stateAssetCount;
  for (JsonPairConst entry : stateAssets) {
    if (scene.stateAssetCount >= scene.stateAssetCapacity) {
      return false;
    }
    const char* path = JsonStringOrNull(entry.value());
    if (path == nullptr || path[0] == '\0') {
      continue;
    }
    const char* state = CopyCompiledString(scene, entry.key().c_str());
    const char* copiedPath = CopyCompiledString(scene, path);
    if (state == nullptr || copiedPath == nullptr) {
      return false;
    }
    scene.stateAssets[scene.stateAssetCount].state = state;
    scene.stateAssets[scene.stateAssetCount].path = copiedPath;
    scene.stateAssetCount += 1;
    out.stateAssetCount += 1;
  }
  if (out.stateAssetCount == 0) {
    out.stateAssets = nullptr;
  }
  return true;
}

inline bool CompilePrimitive(CompiledThemeSpec& scene, JsonObjectConst primitive, CompiledPrimitive& out, bool& hasAnimatedAssets) {
  out = CompiledPrimitive{};
  out.x = primitive["x"] | 0;
  out.y = primitive["y"] | 0;

  if (PrimitiveTypeIs(primitive, "rect", "r")) {
    out.kind = PrimitiveKind::Rect;
    out.width = JsonIntFor(primitive, "width", "w", 0);
    out.height = JsonIntFor(primitive, "height", "h", 0);
    out.color = ParseColor(JsonStringFor(primitive, "color", "c"), 0x0000);
    return out.width > 0 && out.height > 0;
  }

  if (PrimitiveTypeIs(primitive, "text", "tx")) {
    out.kind = PrimitiveKind::Text;
    out.font = JsonIntFor(primitive, "font", "f", 1);
    out.size = JsonIntFor(primitive, "fontSize", "s", 1);
    out.maxWidth = JsonIntFor(primitive, "maxWidth", "mw", 0);
    out.binding = CopyCompiledString(scene, JsonStringFor(primitive, "binding", "b"));
    out.text = CopyCompiledString(scene, JsonStringFor(primitive, "text", "v"));
    if (out.text == nullptr) {
      out.text = "";
    }
    const char* fit = JsonStringFor(primitive, "fit", "ft");
    out.fitShrink = fit != nullptr && std::strcmp(fit, "shrink") == 0;
    const char* align = JsonStringFor(primitive, "align", "al");
    if (align != nullptr && std::strcmp(align, "center") == 0) {
      out.align = 1;
    } else if (align != nullptr && std::strcmp(align, "right") == 0) {
      out.align = 2;
    }
    out.color = ParseColor(JsonStringFor(primitive, "color", "c"), 0xFFFF);
    const char* bgColor = JsonStringFor(primitive, "bgColor", "bg");
    out.hasBg = bgColor != nullptr;
    out.bg = ParseColor(bgColor, 0x0000);
    out.liveFields = out.binding != nullptr ? BindingFieldMask(out.binding) : TextTemplateFieldMask(out.text);
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
    out.segments = JsonIntFor(primitive, "segments", "sg", 0);
    out.segmentGap = JsonIntFor(primitive, "segmentGap", "gg", 1);
    out.color = ParseColor(JsonStringFor(primitive, "color", "c"), 0xFFFF);
    out.bg = ParseColor(JsonStringFor(primitive, "bgColor", "bg"), 0x0000);
    out.border = ParseColor(JsonStringFor(primitive, "borderColor", "bc"), 0x7BEF);
    out.liveFields = BindingUsesField(out.binding, kThemeSpecFieldWeekly) ? kThemeSpecFieldWeekly : kThemeSpecFieldSession;
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
    out.liveFields = out.stateAssetCount == 0 ? 0 : kThemeSpecFieldActivity;
    hasAnimatedAssets = true;
    return out.width > 0 && out.height > 0 && CompiledStateAssetPathFor(out, FrameData{}) != nullptr;
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
    const char* bgColor = JsonStringFor(primitive, "bgColor", "bg");
    out.hasBg = bgColor != nullptr;
    out.bg = ParseColor(bgColor, 0x0000);
    out.liveFields = out.stateAssetCount == 0 ? 0 : kThemeSpecFieldActivity;
    hasAnimatedAssets = hasAnimatedAssets || AssetPathLooksAnimated(out.assetPath) || StateAssetsLookAnimated(stateAssets);
    return CompiledStateAssetPathFor(out, FrameData{}) != nullptr;
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

inline bool CompileThemeSpecObject(JsonObjectConst spec, CompiledThemeSpec& scene) {
  ReleaseCompiledThemeSpec(scene);
  JsonArrayConst primitives = JsonArrayFor(spec, "primitives", "p");
  if (primitives.isNull() || primitives.size() == 0 || primitives.size() > kMaxCompiledThemeSpecPrimitives) {
    return false;
  }
  CompiledThemeSpecStoragePlan storagePlan;
  if (!CountCompiledThemeSpecStorage(spec, storagePlan) ||
      !AllocateCompiledThemeSpecStorage(scene, storagePlan)) {
    return false;
  }

  scene.bgColor = ParseColor(JsonStringFor(spec, "bgColor", "bg"), 0x0000);
  for (JsonObjectConst primitive : primitives) {
    CompiledPrimitive compiled;
    bool primitiveHasAnimatedAssets = false;
    if (CompilePrimitive(scene, primitive, compiled, primitiveHasAnimatedAssets)) {
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

inline bool CompileThemeSpec(const char* themeSpecRaw, JsonDocument& doc, CompiledThemeSpec& scene) {
  if (themeSpecRaw == nullptr || themeSpecRaw[0] == '\0') {
    return false;
  }
  doc.clear();
  const DeserializationError err = deserializeJson(doc, themeSpecRaw);
  if (err) {
    return false;
  }
  return CompileThemeSpecObject(doc.as<JsonObjectConst>(), scene);
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

inline BoundsResult PrimitiveBounds(JsonObjectConst primitive, const FrameData& frame, bool requireStableTextBounds, Bounds& bounds) {
  bounds = Bounds{};
  const int x = primitive["x"] | 0;
  const int y = primitive["y"] | 0;

  if (PrimitiveTypeIs(primitive, "rect", "r") || PrimitiveTypeIs(primitive, "progress", "p") ||
      PrimitiveTypeIs(primitive, "gif", "g") || PrimitiveTypeIs(primitive, "pixels", "px")) {
    bounds.x = x;
    bounds.y = y;
    bounds.width = JsonIntFor(primitive, "width", "w", 0);
    bounds.height = JsonIntFor(primitive, "height", "h", 0);
    if (bounds.width <= 0 || bounds.height <= 0) {
      return BoundsResult{false, false};
    }
    return BoundsResult{true, false};
  }

  if (PrimitiveTypeIs(primitive, "sprite", "sp") || PrimitiveTypeIs(primitive, "image", "img")) {
    if (StateAssetPathFor(primitive, frame) == nullptr || StateAssetPathFor(primitive, frame)[0] == '\0') {
      return BoundsResult{false, false};
    }
    bounds.x = x;
    bounds.y = y;
    bounds.width = JsonIntFor(primitive, "width", "w", 0);
    bounds.height = JsonIntFor(primitive, "height", "h", 0);
    if (bounds.width <= 0 || bounds.height <= 0) {
      return BoundsResult{false, true};
    }
    return BoundsResult{true, false};
  }

  if (PrimitiveTypeIs(primitive, "text", "tx")) {
    const int size = JsonIntFor(primitive, "fontSize", "s", 1);
    if (size <= 0) {
      return BoundsResult{false, false};
    }
    bounds.x = x;
    bounds.y = y;
    bounds.height = 8 * size;
    bounds.width = JsonIntFor(primitive, "maxWidth", "mw", 0);
    if (bounds.width <= 0) {
      if (requireStableTextBounds) {
        bounds.width = kThemeSpecCanvasSize - x;
      }
      if (bounds.width <= 0) {
        char text[128] = {0};
        const char* binding = JsonStringFor(primitive, "binding", "b");
        if (binding != nullptr) {
          BoundValue(binding, frame, text, sizeof(text));
        } else {
          RenderTextTemplate(JsonStringFor(primitive, "text", "v"), frame, text, sizeof(text));
        }
        bounds.width = ApproxTextWidth(text, size);
      }
    }
    if (bounds.width <= 0) {
      return BoundsResult{false, false};
    }
    return BoundsResult{true, false};
  }

  return BoundsResult{false, false};
}

inline bool DrawPrimitive(JsonObjectConst primitive, const FrameData& frame, Sink& sink) {
  const int x = primitive["x"] | 0;
  const int y = primitive["y"] | 0;

  if (PrimitiveTypeIs(primitive, "rect", "r")) {
    RectCommand cmd;
    cmd.x = x;
    cmd.y = y;
    cmd.width = JsonIntFor(primitive, "width", "w", 0);
    cmd.height = JsonIntFor(primitive, "height", "h", 0);
    if (cmd.width <= 0 || cmd.height <= 0) {
      return false;
    }
    cmd.color = ParseColor(JsonStringFor(primitive, "color", "c"), 0x0000);
    sink.FillRect(cmd);
    return true;
  }

  if (PrimitiveTypeIs(primitive, "text", "tx")) {
    TextCommand cmd;
    cmd.x = x;
    cmd.y = y;
    cmd.font = JsonIntFor(primitive, "font", "f", 1);
    cmd.size = JsonIntFor(primitive, "fontSize", "s", 1);
    if (cmd.size <= 0) {
      return false;
    }
    cmd.maxWidth = JsonIntFor(primitive, "maxWidth", "mw", 0);
    const char* fit = JsonStringFor(primitive, "fit", "ft");
    cmd.fitShrink = fit != nullptr && std::strcmp(fit, "shrink") == 0;
    const char* align = JsonStringFor(primitive, "align", "al");
    if (align != nullptr && std::strcmp(align, "center") == 0) {
      cmd.align = 1;
    } else if (align != nullptr && std::strcmp(align, "right") == 0) {
      cmd.align = 2;
    }
    char text[128] = {0};
    const char* binding = JsonStringFor(primitive, "binding", "b");
    if (binding != nullptr) {
      BoundValue(binding, frame, text, sizeof(text));
    } else {
      const char* rawText = JsonStringFor(primitive, "text", "v");
      RenderTextTemplate(rawText == nullptr ? "" : rawText, frame, text, sizeof(text));
    }
    cmd.text = text;
    cmd.fg = ParseColor(JsonStringFor(primitive, "color", "c"), 0xFFFF);
    const char* bgColor = JsonStringFor(primitive, "bgColor", "bg");
    cmd.hasBg = bgColor != nullptr;
    cmd.bg = ParseColor(bgColor, 0x0000);
    sink.DrawText(cmd);
    return true;
  }

  if (PrimitiveTypeIs(primitive, "progress", "p")) {
    ProgressCommand cmd;
    cmd.x = x;
    cmd.y = y;
    cmd.width = JsonIntFor(primitive, "width", "w", 0);
    cmd.height = JsonIntFor(primitive, "height", "h", 0);
    if (cmd.width <= 0 || cmd.height <= 0) {
      return false;
    }
    cmd.percent = ProgressPercentFor(primitive, frame);
    const char* progressStyle = JsonStringFor(primitive, "progressStyle", "ps");
    if (progressStyle != nullptr && (std::strcmp(progressStyle, "segments") == 0 || std::strcmp(progressStyle, "segmented") == 0)) {
      cmd.style = 1;
    }
    cmd.segments = JsonIntFor(primitive, "segments", "sg", 0);
    cmd.segmentGap = JsonIntFor(primitive, "segmentGap", "gg", 1);
    cmd.fillColor = ParseColor(JsonStringFor(primitive, "color", "c"), 0xFFFF);
    cmd.bgColor = ParseColor(JsonStringFor(primitive, "bgColor", "bg"), 0x0000);
    cmd.borderColor = ParseColor(JsonStringFor(primitive, "borderColor", "bc"), 0x7BEF);
    sink.DrawProgress(cmd);
    return true;
  }

  if (PrimitiveTypeIs(primitive, "gif", "g")) {
    GifCommand cmd;
    cmd.x = x;
    cmd.y = y;
    cmd.width = JsonIntFor(primitive, "width", "w", 0);
    cmd.height = JsonIntFor(primitive, "height", "h", 0);
    cmd.assetPath = StateAssetPathFor(primitive, frame);
    if (cmd.assetPath == nullptr || cmd.assetPath[0] == '\0' || cmd.width <= 0 || cmd.height <= 0) {
      return false;
    }
    const char* bgColor = JsonStringFor(primitive, "bgColor", "bg");
    cmd.hasBg = bgColor != nullptr;
    cmd.bg = ParseColor(bgColor, 0x0000);
    sink.DrawGif(cmd);
    return true;
  }

  if (PrimitiveTypeIs(primitive, "sprite", "sp") || PrimitiveTypeIs(primitive, "image", "img")) {
    SpriteCommand cmd;
    cmd.x = x;
    cmd.y = y;
    cmd.width = JsonIntFor(primitive, "width", "w", 0);
    cmd.height = JsonIntFor(primitive, "height", "h", 0);
    cmd.assetPath = StateAssetPathFor(primitive, frame);
    if (cmd.assetPath == nullptr || cmd.assetPath[0] == '\0') {
      return false;
    }
    const char* bgColor = JsonStringFor(primitive, "bgColor", "bg");
    cmd.hasBg = bgColor != nullptr;
    cmd.bg = ParseColor(bgColor, 0x0000);
    sink.DrawSprite(cmd);
    return true;
  }

  if (PrimitiveTypeIs(primitive, "pixels", "px")) {
    PixelsCommand cmd;
    cmd.x = x;
    cmd.y = y;
    cmd.width = JsonIntFor(primitive, "width", "w", 0);
    cmd.height = JsonIntFor(primitive, "height", "h", 0);
    if (primitive["p"].is<JsonArrayConst>() || primitive["r"].is<JsonArrayConst>()) {
      JsonArrayConst rawPalette = primitive["p"].as<JsonArrayConst>();
      JsonArrayConst rows = primitive["r"].as<JsonArrayConst>();
      uint16_t palette[26] = {0};
      int paletteSize = 0;
      if (!ParseColorPalette(rawPalette, palette, paletteSize) ||
          !RenderRlePixelRows(rows, palette, paletteSize, cmd.x, cmd.y, cmd.width, cmd.height, nullptr)) {
        return false;
      }
      return RenderRlePixelRows(rows, palette, paletteSize, cmd.x, cmd.y, cmd.width, cmd.height, &sink);
    }

    cmd.data = JsonStringFor(primitive, "data", "d");
    if (!HasHexBitmapBits(cmd.data, cmd.width, cmd.height)) {
      return false;
    }
    cmd.color = ParseColor(JsonStringFor(primitive, "color", "c"), 0xFFFF);
    sink.DrawPixels(cmd);
    return true;
  }

  return false;
}

inline int CompiledProgressPercentFor(const CompiledPrimitive& primitive, const FrameData& frame) {
  if (StringEqualsAny(primitive.binding, "weekly", "weeklyPercent", "w")) {
    return ClampPct(frame.weekly);
  }
  return ClampPct(frame.session);
}

inline bool CompiledPrimitiveBounds(
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
    return bounds.width > 0 && bounds.height > 0;
  }

  if (primitive.kind == PrimitiveKind::Sprite) {
    const char* assetPath = CompiledStateAssetPathFor(primitive, frame);
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
    bounds.height = 8 * primitive.size;
    bounds.width = primitive.maxWidth;
    if (bounds.width <= 0) {
      if (requireStableTextBounds) {
        bounds.width = kThemeSpecCanvasSize - primitive.x;
      }
      if (bounds.width <= 0) {
        char text[128] = {0};
        if (primitive.binding != nullptr) {
          BoundValue(primitive.binding, frame, text, sizeof(text));
        } else {
          RenderTextTemplate(primitive.text, frame, text, sizeof(text));
        }
        bounds.width = ApproxTextWidth(text, primitive.size);
      }
    }
    return bounds.width > 0;
  }

  return false;
}

inline bool DrawCompiledPrimitive(const CompiledPrimitive& primitive, const FrameData& frame, Sink& sink) {
  if (primitive.kind == PrimitiveKind::Rect) {
    RectCommand cmd;
    cmd.x = primitive.x;
    cmd.y = primitive.y;
    cmd.width = primitive.width;
    cmd.height = primitive.height;
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
    if (cmd.size <= 0) {
      return false;
    }
    char text[128] = {0};
    if (primitive.binding != nullptr) {
      BoundValue(primitive.binding, frame, text, sizeof(text));
    } else {
      RenderTextTemplate(primitive.text, frame, text, sizeof(text));
    }
    cmd.text = text;
    cmd.fg = primitive.color;
    cmd.bg = primitive.bg;
    cmd.hasBg = primitive.hasBg;
    sink.DrawText(cmd);
    return true;
  }

  if (primitive.kind == PrimitiveKind::Progress) {
    ProgressCommand cmd;
    cmd.x = primitive.x;
    cmd.y = primitive.y;
    cmd.width = primitive.width;
    cmd.height = primitive.height;
    cmd.percent = CompiledProgressPercentFor(primitive, frame);
    cmd.style = primitive.style;
    cmd.segments = primitive.segments;
    cmd.segmentGap = primitive.segmentGap;
    cmd.fillColor = primitive.color;
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
    cmd.assetPath = CompiledStateAssetPathFor(primitive, frame);
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
    cmd.assetPath = CompiledStateAssetPathFor(primitive, frame);
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
    (void)DrawCompiledPrimitive(scene.primitives[i], frame, sink);
    RenderYield();
  }
  return true;
}

inline bool RenderCompiledThemeSpecAnimatedPrimitives(const CompiledThemeSpec& scene, const FrameData& frame, Sink& sink) {
  bool rendered = false;
  sink.PrimeBackground(scene.bgColor);
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    const PrimitiveKind kind = scene.primitives[i].kind;
    if (kind == PrimitiveKind::Gif || kind == PrimitiveKind::Sprite) {
      rendered = DrawCompiledPrimitive(scene.primitives[i], frame, sink) || rendered;
    }
  }
  return rendered;
}

inline bool RenderCompiledThemeSpecChangedPrimitives(
    const CompiledThemeSpec& scene,
    const FrameData& frame,
    uint32_t changedFields,
    Sink& sink) {
  if (changedFields == 0 || scene.primitiveCount == 0) {
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
    if (!CompiledPrimitiveBounds(primitive, frame, true, primitiveBounds)) {
      return false;
    }
    ExpandBounds(dirty, primitiveBounds);
  }
  if (!hasAffectedPrimitive || dirty.width <= 0 || dirty.height <= 0) {
    return false;
  }

  sink.PrimeBackground(scene.bgColor);
  sink.BeginClip(dirty.x, dirty.y, dirty.width, dirty.height);
  RectCommand background;
  background.x = dirty.x;
  background.y = dirty.y;
  background.width = dirty.width;
  background.height = dirty.height;
  background.color = scene.bgColor;
  sink.FillRect(background);

  bool rendered = false;
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    Bounds primitiveBounds;
    if (CompiledPrimitiveBounds(scene.primitives[i], frame, false, primitiveBounds) &&
        BoundsOverlap(dirty, primitiveBounds)) {
      rendered = DrawCompiledPrimitive(scene.primitives[i], frame, sink) || rendered;
      RenderYield();
    }
  }
  sink.EndClip();
  return rendered;
}

inline bool RenderThemeSpecObject(JsonObjectConst spec, const FrameData& frame, Sink& sink) {
  JsonArrayConst primitives = JsonArrayFor(spec, "primitives", "p");
  if (primitives.isNull()) {
    return false;
  }
  if (primitives.size() == 0) {
    return false;
  }

  sink.FillScreen(ParseColor(JsonStringFor(spec, "bgColor", "bg"), 0x0000));
  for (JsonObjectConst primitive : primitives) {
    (void)DrawPrimitive(primitive, frame, sink);
    RenderYield();
  }
  return true;
}

inline bool RenderThemeSpec(const char* themeSpecRaw, const FrameData& frame, Sink& sink) {
  if (themeSpecRaw == nullptr || themeSpecRaw[0] == '\0') {
    return false;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, themeSpecRaw);
  if (err) {
    return false;
  }

  return RenderThemeSpecObject(doc.as<JsonObjectConst>(), frame, sink);
}

inline bool RenderThemeSpecAnimatedPrimitivesObject(JsonObjectConst spec, const FrameData& frame, Sink& sink) {
  bool rendered = false;
  JsonArrayConst primitives = JsonArrayFor(spec, "primitives", "p");
  if (primitives.isNull()) {
    return false;
  }
  sink.PrimeBackground(ParseColor(JsonStringFor(spec, "bgColor", "bg"), 0x0000));
  for (JsonObjectConst primitive : primitives) {
    if (PrimitiveTypeIs(primitive, "gif", "g") ||
        PrimitiveTypeIs(primitive, "sprite", "sp") ||
        PrimitiveTypeIs(primitive, "image", "img")) {
      rendered = DrawPrimitive(primitive, frame, sink) || rendered;
    }
  }
  return rendered;
}

inline bool RenderThemeSpecAnimatedPrimitives(const char* themeSpecRaw, const FrameData& frame, Sink& sink) {
  if (themeSpecRaw == nullptr || themeSpecRaw[0] == '\0') {
    return false;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, themeSpecRaw);
  if (err) {
    return false;
  }

  return RenderThemeSpecAnimatedPrimitivesObject(doc.as<JsonObjectConst>(), frame, sink);
}

inline bool RenderThemeSpecChangedPrimitivesObject(JsonObjectConst spec, const FrameData& frame, uint32_t changedFields, Sink& sink) {
  if (changedFields == 0) {
    return false;
  }

  JsonArrayConst primitives = JsonArrayFor(spec, "primitives", "p");
  if (primitives.isNull()) {
    return false;
  }

  bool hasAffectedPrimitive = false;
  Bounds dirty;
  for (JsonObjectConst primitive : primitives) {
    if (!PrimitiveUsesChangedFields(primitive, changedFields)) {
      continue;
    }
    hasAffectedPrimitive = true;
    Bounds primitiveBounds;
    const BoundsResult bounds = PrimitiveBounds(primitive, frame, true, primitiveBounds);
    if (!bounds.valid) {
      return false;
    }
    ExpandBounds(dirty, primitiveBounds);
  }
  if (!hasAffectedPrimitive || dirty.width <= 0 || dirty.height <= 0) {
    return false;
  }

  for (JsonObjectConst primitive : primitives) {
    Bounds primitiveBounds;
    const BoundsResult bounds = PrimitiveBounds(primitive, frame, false, primitiveBounds);
    if (bounds.unknown) {
      return false;
    }
  }

  const uint16_t bgColor = ParseColor(JsonStringFor(spec, "bgColor", "bg"), 0x0000);
  sink.PrimeBackground(bgColor);
  sink.BeginClip(dirty.x, dirty.y, dirty.width, dirty.height);
  RectCommand background;
  background.x = dirty.x;
  background.y = dirty.y;
  background.width = dirty.width;
  background.height = dirty.height;
  background.color = bgColor;
  sink.FillRect(background);

  bool rendered = false;
  for (JsonObjectConst primitive : primitives) {
    Bounds primitiveBounds;
    const BoundsResult bounds = PrimitiveBounds(primitive, frame, false, primitiveBounds);
    if (bounds.valid && BoundsOverlap(dirty, primitiveBounds)) {
      rendered = DrawPrimitive(primitive, frame, sink) || rendered;
      RenderYield();
    }
  }
  sink.EndClip();
  return rendered;
}

inline bool RenderThemeSpecChangedPrimitives(const char* themeSpecRaw, const FrameData& frame, uint32_t changedFields, Sink& sink) {
  if (themeSpecRaw == nullptr || themeSpecRaw[0] == '\0' || changedFields == 0) {
    return false;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, themeSpecRaw);
  if (err) {
    return false;
  }

  return RenderThemeSpecChangedPrimitivesObject(doc.as<JsonObjectConst>(), frame, changedFields, sink);
}

}  // namespace themespec
}  // namespace codexbar_display
