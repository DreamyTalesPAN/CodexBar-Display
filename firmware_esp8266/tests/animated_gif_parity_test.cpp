#include <AnimatedGIF.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <vector>

namespace {

struct MemoryFile {
  std::vector<uint8_t> bytes;
  size_t position = 0;
};

MemoryFile file;
uint64_t hashValue = 0;
int frameCount = 0;
int lineCount = 0;
long delayTotalMs = 0;

void mix(uint8_t byte) {
  hashValue ^= byte;
  hashValue *= 1099511628211ULL;
}

void* openFile(const char* path, int32_t* size) {
  std::ifstream input(path, std::ios::binary);
  file.bytes.assign(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
  file.position = 0;
  *size = static_cast<int32_t>(file.bytes.size());
  return file.bytes.empty() ? nullptr : &file;
}

void closeFile(void*) {}

int32_t readFile(GIFFILE* gifFile, uint8_t* destination, int32_t length) {
  MemoryFile* memory = static_cast<MemoryFile*>(gifFile->fHandle);
  const size_t available = memory->bytes.size() - memory->position;
  const size_t count = std::min<size_t>(available, length);
  std::copy_n(memory->bytes.data() + memory->position, count, destination);
  memory->position += count;
  gifFile->iPos = static_cast<int32_t>(memory->position);
  return static_cast<int32_t>(count);
}

int32_t seekFile(GIFFILE* gifFile, int32_t position) {
  MemoryFile* memory = static_cast<MemoryFile*>(gifFile->fHandle);
  memory->position = static_cast<size_t>(position);
  gifFile->iPos = position;
  return position;
}

void drawLine(GIFDRAW* draw) {
  if (draw->y == 0) {
    ++frameCount;
  }
  ++lineCount;
  mix(static_cast<uint8_t>(draw->y));
  mix(static_cast<uint8_t>(draw->iWidth));
  mix(static_cast<uint8_t>(draw->iHeight));
  mix(draw->ucHasTransparency);
  mix(draw->ucTransparent);
  for (int x = 0; x < draw->iWidth; ++x) {
    mix(draw->pPixels[x]);
  }
}

bool decodePass(
    AnimatedGIF& decoder,
    int expectedFrames,
    int expectedLines,
    long expectedDelayMs,
    uint64_t expectedHash) {
  hashValue = 1469598103934665603ULL;
  frameCount = 0;
  lineCount = 0;
  delayTotalMs = 0;
  for (int attempt = 0; attempt < 100; ++attempt) {
    int delayMs = 0;
    const int result = decoder.playFrame(false, &delayMs, nullptr);
    delayTotalMs += delayMs;
    if (result <= 0) {
      break;
    }
  }
  if (frameCount == expectedFrames && lineCount == expectedLines &&
      delayTotalMs == expectedDelayMs && hashValue == expectedHash) {
    return true;
  }
  std::fprintf(
      stderr,
      "parity frames=%d lines=%d delay=%ld hash=%016llx\n",
      frameCount,
      lineCount,
      delayTotalMs,
      static_cast<unsigned long long>(hashValue));
  return false;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "FAIL: Mini Classic GIF path is required\n");
    return 1;
  }
  AnimatedGIF decoder;
  decoder.begin(BIG_ENDIAN_PIXELS);
  if (!decoder.open(argv[1], openFile, closeFile, readFile, seekFile, drawLine)) {
    std::fprintf(stderr, "FAIL: decoder open\n");
    return 1;
  }
  if (!decodePass(decoder, 41, 1078, 14000, 0xd85b69612e2a5d5fULL)) {
    std::fprintf(stderr, "FAIL: first decode parity\n");
    return 1;
  }
  decoder.reset();
  if (!decodePass(decoder, 41, 1078, 14000, 0x19404269b7058aefULL)) {
    std::fprintf(stderr, "FAIL: reset decode parity\n");
    return 1;
  }
  decoder.close();
  std::printf("ok: animated_gif_parity_test\n");
  return 0;
}
