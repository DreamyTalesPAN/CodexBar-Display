#pragma once

#include <Arduino.h>

namespace codexbar_display {
namespace theme {

enum class ThemeId : uint8_t {
  Classic = 0,
  CRT = 1,
  Mini = 2,
};

struct ThemeDefinition {
  ThemeId id;
  const char* protocolName;
  const char* compileDefaultMacro;
};

constexpr const char* kThemeNameClassic = "classic";
constexpr const char* kThemeNameCRT = "crt";
constexpr const char* kThemeNameMini = "mini";

constexpr ThemeDefinition kRegistry[] = {
    {ThemeId::Classic, kThemeNameClassic, "CODEXBAR_DISPLAY_THEME_CLASSIC"},
    {ThemeId::CRT, kThemeNameCRT, "CODEXBAR_DISPLAY_THEME_CRT"},
    {ThemeId::Mini, kThemeNameMini, "CODEXBAR_DISPLAY_THEME_MINI"},
};
constexpr size_t kRegistryCount = sizeof(kRegistry) / sizeof(kRegistry[0]);

inline bool NormalizeThemeName(const String& raw, String& normalizedOut) {
  String normalized = raw;
  normalized.trim();
  normalized.toLowerCase();
  if (normalized == "standard") {
    normalizedOut = kThemeNameClassic;
    return true;
  }

  for (size_t i = 0; i < kRegistryCount; ++i) {
    if (normalized == kRegistry[i].protocolName) {
      normalizedOut = normalized;
      return true;
    }
  }
  normalizedOut = "";
  return false;
}

inline const char* CompileDefaultThemeName() {
#if defined(CODEXBAR_DISPLAY_THEME_MINI)
  return kThemeNameMini;
#elif defined(CODEXBAR_DISPLAY_THEME_CRT)
  return kThemeNameCRT;
#else
  return kThemeNameClassic;
#endif
}

}  // namespace theme
}  // namespace codexbar_display
