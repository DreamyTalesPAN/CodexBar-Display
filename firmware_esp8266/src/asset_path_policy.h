#pragma once

#include <cstddef>

namespace codexbar_display::esp8266 {

struct AssetPathPolicy {
  static constexpr std::size_t kMaxPathBytes = 32;

  static bool IsSafeSyntax(const char* path, std::size_t length) {
    if (path == nullptr || length == 0 || length >= kMaxPathBytes || path[0] != '/' || path[length - 1] == '/') {
      return false;
    }
    for (std::size_t i = 0; i < length; ++i) {
      const char c = path[i];
      if (c == '/' && i + 1 < length && path[i + 1] == '/') {
        return false;
      }
      if (c == '.' && i + 1 < length && path[i + 1] == '.') {
        return false;
      }
      const bool allowed =
          (c >= 'a' && c <= 'z') ||
          (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') ||
          c == '/' || c == '-' || c == '_' || c == '.';
      if (!allowed) {
        return false;
      }
    }
    return true;
  }

  static bool IsMutableThemeAsset(const char* path, std::size_t length) {
    static constexpr char kThemePrefix[] = "/themes/";
    static constexpr std::size_t kThemePrefixLength = sizeof(kThemePrefix) - 1;
    if (!IsSafeSyntax(path, length) || length <= kThemePrefixLength) {
      return false;
    }
    for (std::size_t i = 0; i < kThemePrefixLength; ++i) {
      if (path[i] != kThemePrefix[i]) {
        return false;
      }
    }
    return true;
  }
};

}  // namespace codexbar_display::esp8266
