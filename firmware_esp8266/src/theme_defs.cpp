#include "theme_defs.h"

#include "../../firmware_shared/theme_registry.h"

Theme defaultTheme() {
  const char* compileDefault = codexbar_display::theme::CompileDefaultThemeName();
  if (String(compileDefault) == codexbar_display::theme::kThemeNameMini) {
    return Theme::Mini;
  }
  if (String(compileDefault) == codexbar_display::theme::kThemeNameCRT) {
    return Theme::CRT;
  }
  return Theme::Classic;
}

bool themeFromName(const String& themeName, Theme& out) {
  String normalized;
  if (!codexbar_display::theme::NormalizeThemeName(themeName, normalized)) {
    return false;
  }
  if (normalized == codexbar_display::theme::kThemeNameClassic) {
    out = Theme::Classic;
    return true;
  }
  if (normalized == codexbar_display::theme::kThemeNameCRT) {
    out = Theme::CRT;
    return true;
  }
  if (normalized == codexbar_display::theme::kThemeNameMini) {
    out = Theme::Mini;
    return true;
  }
  return false;
}
