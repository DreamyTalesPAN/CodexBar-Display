#include "theme_defs.h"

#include "../../firmware_shared/theme_registry.h"

Theme defaultTheme() {
  return Theme::Mini;
}

bool themeFromName(const String& themeName, Theme& out) {
  String normalized;
  if (!codexbar_display::theme::NormalizeThemeName(themeName, normalized)) {
    return false;
  }
  if (normalized == codexbar_display::theme::kThemeNameMini) {
    out = Theme::Mini;
    return true;
  }
  return false;
}
