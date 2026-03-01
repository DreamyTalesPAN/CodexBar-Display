#pragma once

#include <Arduino.h>

enum class Theme : uint8_t {
  Classic = 0,
  CRT = 1,
  Mini = 2,
};

Theme defaultTheme();
bool themeFromName(const String& themeName, Theme& out);
