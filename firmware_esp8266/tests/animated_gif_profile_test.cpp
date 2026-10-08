#include <AnimatedGIF.h>

#include <cstdio>

static_assert(MAX_CODE_SIZE == 11, "VibeTV decoder must use the validated 11-bit LZW profile");
static_assert(sizeof(AnimatedGIF) <= 1536U, "VibeTV GIF decoder state must stay small between frames");
static_assert(GIF_WORKSPACE_SIZE <= 12U * 1024U, "VibeTV GIF workspace must fit in a 12 KiB heap block");
static_assert(GIF_WS_GIF_TABLE % 4 == 0, "GIF code table must be aligned in the workspace");

int main() {
  std::printf(
      "ok: animated_gif_profile_test size=%zu workspace=%d\n",
      sizeof(AnimatedGIF),
      GIF_WORKSPACE_SIZE);
  return 0;
}
