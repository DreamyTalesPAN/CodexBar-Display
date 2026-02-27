#pragma once

#include <Arduino.h>

namespace vibeblock {
namespace theme {

enum class ThemeId : uint8_t {
  Classic = 0,
  CRT = 1,
};

struct ThemeDefinition {
  ThemeId id;
  const char* protocolName;
  const char* compileDefaultMacro;
};

constexpr const char* kThemeNameClassic = "classic";
constexpr const char* kThemeNameCRT = "crt";

constexpr ThemeDefinition kRegistry[] = {
    {ThemeId::Classic, kThemeNameClassic, "VIBEBLOCK_THEME_CLASSIC"},
    {ThemeId::CRT, kThemeNameCRT, "VIBEBLOCK_THEME_CRT"},
};
constexpr size_t kRegistryCount = sizeof(kRegistry) / sizeof(kRegistry[0]);

inline bool NormalizeThemeName(const String& raw, String& normalizedOut) {
  String normalized = raw;
  normalized.trim();
  normalized.toLowerCase();

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
#if defined(VIBEBLOCK_THEME_CRT)
  return kThemeNameCRT;
#else
  return kThemeNameClassic;
#endif
}

}  // namespace theme
}  // namespace vibeblock

