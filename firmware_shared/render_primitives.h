#pragma once

#include <Arduino.h>

namespace codexbar_display {
namespace primitive {

struct TextCommand {
  const char* text = "";
  int x = 0;
  int y = 0;
  int font = 1;
  int size = 1;
  uint16_t fg = 0xFFFF;
  uint16_t bg = 0x0000;
  bool wrap = false;
};

struct RectCommand {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  uint16_t color = 0x0000;
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

class Sink {
 public:
  virtual ~Sink() = default;

  virtual void FillScreen(uint16_t color) = 0;
  virtual void FillRect(const RectCommand& cmd) = 0;
  virtual void DrawText(const TextCommand& cmd) = 0;
  virtual void DrawProgress(const ProgressCommand& cmd) = 0;
};

}  // namespace primitive
}  // namespace codexbar_display
