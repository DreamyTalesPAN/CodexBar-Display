#pragma once

#include <ArduinoJson.h>

#include <cstdint>
#include <cstdio>
#include <cstring>

namespace codexbar_display {
namespace themespec {

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

class Sink {
 public:
  virtual ~Sink() = default;

  virtual void PrimeBackground(uint16_t color) { (void)color; }
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

inline bool RenderThemeSpec(const char* themeSpecRaw, const FrameData& frame, Sink& sink) {
  if (themeSpecRaw == nullptr || themeSpecRaw[0] == '\0') {
    return false;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, themeSpecRaw);
  if (err) {
    return false;
  }

  JsonArrayConst primitives = JsonArrayFor(doc.as<JsonObjectConst>(), "primitives", "p");
  if (primitives.isNull()) {
    return false;
  }
  if (primitives.size() == 0) {
    return false;
  }

  sink.FillScreen(ParseColor(JsonStringFor(doc.as<JsonObjectConst>(), "bgColor", "bg"), 0x0000));
  for (JsonObjectConst primitive : primitives) {
    (void)DrawPrimitive(primitive, frame, sink);
    RenderYield();
  }
  return true;
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

  bool rendered = false;
  JsonArrayConst primitives = JsonArrayFor(doc.as<JsonObjectConst>(), "primitives", "p");
  if (primitives.isNull()) {
    return false;
  }
  sink.PrimeBackground(ParseColor(JsonStringFor(doc.as<JsonObjectConst>(), "bgColor", "bg"), 0x0000));
  for (JsonObjectConst primitive : primitives) {
    if (PrimitiveTypeIs(primitive, "gif", "g") ||
        PrimitiveTypeIs(primitive, "sprite", "sp") ||
        PrimitiveTypeIs(primitive, "image", "img")) {
      rendered = DrawPrimitive(primitive, frame, sink) || rendered;
    }
  }
  return rendered;
}

}  // namespace themespec
}  // namespace codexbar_display
