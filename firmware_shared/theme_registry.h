#pragma once

#include <Arduino.h>

namespace codexbar_display {
namespace theme {

enum class ThemeId : uint8_t {
  Mini = 0,
};

struct ThemeDefinition {
  ThemeId id;
  const char* protocolName;
  const char* compileDefaultMacro;
};

constexpr const char* kThemeNameMini = "mini";

constexpr ThemeDefinition kRegistry[] = {
    {ThemeId::Mini, kThemeNameMini, "CODEXBAR_DISPLAY_THEME_MINI"},
};
constexpr size_t kRegistryCount = sizeof(kRegistry) / sizeof(kRegistry[0]);

inline bool NormalizeThemeName(const String& raw, String& normalizedOut) {
  String normalized = raw;
  normalized.trim();
  normalized.toLowerCase();
  if (normalized == kThemeNameMini) {
    normalizedOut = kThemeNameMini;
    return true;
  }
  normalizedOut = "";
  return false;
}

inline const char* CompileDefaultThemeName() {
  return kThemeNameMini;
}

}  // namespace theme
}  // namespace codexbar_display
