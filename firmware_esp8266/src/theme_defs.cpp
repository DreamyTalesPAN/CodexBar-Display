#include "theme_defs.h"

#include "../../firmware_shared/theme_registry.h"

Theme defaultTheme() {
  const char* compileDefault = vibeblock::theme::CompileDefaultThemeName();
  if (String(compileDefault) == vibeblock::theme::kThemeNameCRT) {
    return Theme::CRT;
  }
  return Theme::Classic;
}

bool themeFromName(const String& themeName, Theme& out) {
  String normalized;
  if (!vibeblock::theme::NormalizeThemeName(themeName, normalized)) {
    return false;
  }
  if (normalized == vibeblock::theme::kThemeNameClassic) {
    out = Theme::Classic;
    return true;
  }
  if (normalized == vibeblock::theme::kThemeNameCRT) {
    out = Theme::CRT;
    return true;
  }
  return false;
}
