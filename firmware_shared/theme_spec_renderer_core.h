#pragma once

#include <ArduinoJson.h>

#include <cstdint>
#include <cstdio>
#include <cstring>

namespace codexbar_display {
namespace themespec {

struct FrameData {
  const char* provider = "";
  const char* label = "";
  int session = 0;
  int weekly = 0;
  int64_t resetSecs = 0;
  const char* usageMode = "";
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
  uint16_t fg = 0xFFFF;
  uint16_t bg = 0x0000;
  bool hasBg = false;
  bool wrap = false;
};

struct ProgressCommand {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  int percent = 0;
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
};

class Sink {
 public:
  virtual ~Sink() = default;

  virtual void FillScreen(uint16_t color) = 0;
  virtual void FillRect(const RectCommand& cmd) = 0;
  virtual void DrawText(const TextCommand& cmd) = 0;
  virtual void DrawProgress(const ProgressCommand& cmd) = 0;
  virtual void DrawGif(const GifCommand& cmd) = 0;
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

inline uint8_t HexNibble(char c) {
  if (c >= '0' && c <= '9') {
    return static_cast<uint8_t>(c - '0');
  }
  if (c >= 'a' && c <= 'f') {
    return static_cast<uint8_t>(c - 'a' + 10);
  }
  if (c >= 'A' && c <= 'F') {
    return static_cast<uint8_t>(c - 'A' + 10);
  }
  return 0;
}

inline uint8_t HexByte(const char* value) {
  return static_cast<uint8_t>((HexNibble(value[0]) << 4) | HexNibble(value[1]));
}

inline uint16_t ParseColor(const char* value, uint16_t fallback) {
  if (value == nullptr || value[0] != '#') {
    return fallback;
  }
  for (int i = 1; i < 7; ++i) {
    const char c = value[i];
    const bool valid = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    if (!valid) {
      return fallback;
    }
  }
  if (value[7] != '\0') {
    return fallback;
  }
  return RGB565(HexByte(value + 1), HexByte(value + 3), HexByte(value + 5));
}

inline const char* JsonStringOrNull(JsonVariantConst value) {
  return value.is<const char*>() ? value.as<const char*>() : nullptr;
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

  if (std::strcmp(key, "label") == 0 || std::strcmp(key, "providerLabel") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.label));
    return;
  }
  if (std::strcmp(key, "provider") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.provider));
    return;
  }
  if (std::strcmp(key, "session") == 0 || std::strcmp(key, "sessionPercent") == 0) {
    std::snprintf(out, outSize, "%d", ClampPct(frame.session));
    return;
  }
  if (std::strcmp(key, "weekly") == 0 || std::strcmp(key, "weeklyPercent") == 0) {
    std::snprintf(out, outSize, "%d", ClampPct(frame.weekly));
    return;
  }
  if (std::strcmp(key, "reset") == 0 || std::strcmp(key, "resetCountdown") == 0) {
    FormatDuration(frame.resetSecs, out, outSize);
    return;
  }
  if (std::strcmp(key, "usageMode") == 0) {
    std::snprintf(out, outSize, "%s", SafeText(frame.usageMode));
    return;
  }
  if (std::strcmp(key, "sessionTokens") == 0) {
    std::snprintf(out, outSize, "%lld", static_cast<long long>(frame.sessionTokens));
    return;
  }
  if (std::strcmp(key, "weekTokens") == 0) {
    std::snprintf(out, outSize, "%lld", static_cast<long long>(frame.weekTokens));
    return;
  }
  if (std::strcmp(key, "totalTokens") == 0) {
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
  const char* binding = primitive["binding"] | "session";
  if (std::strcmp(binding, "weekly") == 0 || std::strcmp(binding, "weeklyPercent") == 0) {
    return ClampPct(frame.weekly);
  }
  return ClampPct(frame.session);
}

inline bool DrawPrimitive(JsonObjectConst primitive, const FrameData& frame, Sink& sink) {
  const char* type = primitive["type"] | "";
  const int x = primitive["x"] | 0;
  const int y = primitive["y"] | 0;

  if (std::strcmp(type, "rect") == 0) {
    RectCommand cmd;
    cmd.x = x;
    cmd.y = y;
    cmd.width = primitive["width"] | 0;
    cmd.height = primitive["height"] | 0;
    if (cmd.width <= 0 || cmd.height <= 0) {
      return false;
    }
    cmd.color = ParseColor(JsonStringOrNull(primitive["color"]), 0x0000);
    sink.FillRect(cmd);
    return true;
  }

  if (std::strcmp(type, "text") == 0) {
    TextCommand cmd;
    cmd.x = x;
    cmd.y = y;
    const int font = primitive["font"] | 1;
    cmd.font = font == 2 ? 2 : 1;
    cmd.size = primitive["fontSize"] | 1;
    if (cmd.size <= 0) {
      return false;
    }
    char text[128] = {0};
    if (primitive["binding"].is<const char*>()) {
      BoundValue(primitive["binding"].as<const char*>(), frame, text, sizeof(text));
    } else {
      RenderTextTemplate(primitive["text"] | "", frame, text, sizeof(text));
    }
    cmd.text = text;
    cmd.fg = ParseColor(JsonStringOrNull(primitive["color"]), 0xFFFF);
    const char* bgColor = JsonStringOrNull(primitive["bgColor"]);
    cmd.hasBg = bgColor != nullptr;
    cmd.bg = ParseColor(bgColor, 0x0000);
    sink.DrawText(cmd);
    return true;
  }

  if (std::strcmp(type, "progress") == 0) {
    ProgressCommand cmd;
    cmd.x = x;
    cmd.y = y;
    cmd.width = primitive["width"] | 0;
    cmd.height = primitive["height"] | 0;
    if (cmd.width <= 0 || cmd.height <= 0) {
      return false;
    }
    cmd.percent = ProgressPercentFor(primitive, frame);
    cmd.fillColor = ParseColor(JsonStringOrNull(primitive["color"]), 0xFFFF);
    cmd.bgColor = ParseColor(JsonStringOrNull(primitive["bgColor"]), 0x0000);
    cmd.borderColor = ParseColor(JsonStringOrNull(primitive["borderColor"]), 0x7BEF);
    sink.DrawProgress(cmd);
    return true;
  }

  if (std::strcmp(type, "gif") == 0) {
    GifCommand cmd;
    cmd.x = x;
    cmd.y = y;
    cmd.width = primitive["width"] | 0;
    cmd.height = primitive["height"] | 0;
    cmd.assetPath = JsonStringOrNull(primitive["assetPath"]);
    if (cmd.assetPath == nullptr || cmd.assetPath[0] == '\0' || cmd.width <= 0 || cmd.height <= 0) {
      return false;
    }
    sink.DrawGif(cmd);
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
  if (err || !doc["primitives"].is<JsonArrayConst>()) {
    return false;
  }

  JsonArrayConst primitives = doc["primitives"].as<JsonArrayConst>();
  if (primitives.size() == 0) {
    return false;
  }

  sink.FillScreen(ParseColor(JsonStringOrNull(doc["bgColor"]), 0x0000));
  for (JsonObjectConst primitive : primitives) {
    (void)DrawPrimitive(primitive, frame, sink);
  }
  return true;
}

inline bool RenderThemeSpecAnimatedPrimitives(const char* themeSpecRaw, const FrameData& frame, Sink& sink) {
  if (themeSpecRaw == nullptr || themeSpecRaw[0] == '\0') {
    return false;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, themeSpecRaw);
  if (err || !doc["primitives"].is<JsonArrayConst>()) {
    return false;
  }

  bool rendered = false;
  JsonArrayConst primitives = doc["primitives"].as<JsonArrayConst>();
  for (JsonObjectConst primitive : primitives) {
    const char* type = primitive["type"] | "";
    if (std::strcmp(type, "gif") == 0) {
      rendered = DrawPrimitive(primitive, frame, sink) || rendered;
    }
  }
  return rendered;
}

}  // namespace themespec
}  // namespace codexbar_display
