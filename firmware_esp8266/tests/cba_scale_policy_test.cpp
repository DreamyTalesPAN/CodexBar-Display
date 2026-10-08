#include <cstdio>
#include <cstdlib>

#include "../src/theme_spec_runtime_policy.h"

using codexbar_display::esp8266::ThemeSpecRuntimePolicy;

namespace {

void require(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    std::exit(1);
  }
}

}  // namespace

int main() {
  // Issue #498: an enlarged sprite is buffered at source size. Claude draws
  // its 52 px sprite at 77 px; in WiFi mode a 1.0.45 VibeTV measured
  // freeHeap=18168 and maxFreeBlock=15144, which refused the 77 px buffer.
  require(
      ThemeSpecRuntimePolicy::CbaBufferExtent(77, 52) == 52 &&
          ThemeSpecRuntimePolicy::CbaBufferExtent(74, 64) == 64 &&
          ThemeSpecRuntimePolicy::CbaBufferExtent(80, 40) == 40 &&
          ThemeSpecRuntimePolicy::CbaBufferExtent(52, 52) == 52 &&
          ThemeSpecRuntimePolicy::CbaBufferExtent(40, 52) == 40 &&
          ThemeSpecRuntimePolicy::CbaBufferExtent(0, 52) == 52,
      "an enlarged CBA must be buffered at source size and a shrunk one at drawn size");

  const uint32_t drawnBytes = ThemeSpecRuntimePolicy::CbaBufferBytes(77, 77);
  const uint32_t sourceBytes = ThemeSpecRuntimePolicy::CbaBufferBytes(
      ThemeSpecRuntimePolicy::CbaBufferExtent(77, 52),
      ThemeSpecRuntimePolicy::CbaBufferExtent(77, 52));
  require(
      sourceBytes == 5408 &&
          !ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(18168, 15144, drawnBytes) &&
          ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(18168, 15144, sourceBytes),
      "Claude must fit the measured WiFi-mode heap once buffered at source size");

  // The push must show exactly the pixels the full-size decode used to write:
  // each source column filled floor(start) to ceil(end), later ones winning.
  const int scalePairs[][2] = {{52, 77}, {64, 74}, {40, 80}, {32, 48}, {32, 64}, {16, 16}, {1, 80}};
  for (const auto& pair : scalePairs) {
    const int source = pair[0];
    const int drawn = pair[1];
    int decoded[ThemeSpecRuntimePolicy::kMaxCbaBufferWidth] = {};
    for (int s = 0; s < source; ++s) {
      const int start = (s * drawn) / source;
      const int end = ((s + 1) * drawn + source - 1) / source;
      for (int px = start; px < end && px < drawn; ++px) {
        decoded[px] = s;
      }
    }
    for (int px = 0; px < drawn; ++px) {
      require(
          ThemeSpecRuntimePolicy::CbaScaledSourceIndex(px, drawn, source) == decoded[px],
          "scaling at push time must match the former full-size decode pixel for pixel");
    }
  }

  std::printf("cba scale policy tests passed\n");
  return 0;
}
