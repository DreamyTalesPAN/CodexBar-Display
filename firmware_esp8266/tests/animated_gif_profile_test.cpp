#include <AnimatedGIF.h>

#include <cstdio>

static_assert(MAX_CODE_SIZE == 11, "VibeTV decoder must use the validated 11-bit LZW profile");
static_assert(sizeof(AnimatedGIF) <= 15U * 1024U, "VibeTV GIF decoder must fit in a 15 KiB heap block");

int main() {
  std::printf("ok: animated_gif_profile_test size=%zu\n", sizeof(AnimatedGIF));
  return 0;
}
