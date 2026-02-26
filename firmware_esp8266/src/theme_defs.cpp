#include "theme_defs.h"

Theme defaultTheme() {
#if defined(VIBEBLOCK_THEME_CRT)
  return Theme::CRT;
#else
  return Theme::Classic;
#endif
}

bool themeFromName(const String& themeName, Theme& out) {
  String normalized = themeName;
  normalized.trim();
  normalized.toLowerCase();
  if (normalized == "classic") {
    out = Theme::Classic;
    return true;
  }
  if (normalized == "crt") {
    out = Theme::CRT;
    return true;
  }
  return false;
}
