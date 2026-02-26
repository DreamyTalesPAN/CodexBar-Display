#pragma once

#include <Arduino.h>

enum class Theme : uint8_t {
  Classic = 0,
  CRT = 1,
};

Theme defaultTheme();
bool themeFromName(const String& themeName, Theme& out);
