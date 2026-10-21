#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>

#include "../src/firmware_image_policy.h"

// Issue #652: a legacy WiFi VibeTV took the LilyGO ESP32-S3 release image
// through its WiFi updater and stayed dark. The ESP8266 Updater only checks
// the 0xE9 magic and the flash-size nibble, which the ESP32 image passes.
// The headers below are the first 16 bytes of the real release assets.

namespace {

using codexbar_display::esp8266::IsEsp8266FirmwareImageStart;

// codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.49.bin (unpacked .bin.gz)
const uint8_t kEsp8266Image[] = {
    0xe9, 0x02, 0x02, 0x40, 0x80, 0xf4, 0x10, 0x40,
    0x00, 0xf0, 0x10, 0x40, 0x60, 0x0d, 0x00, 0x00};

// codexbar-display-firmware-lilygo_t_display_s3-v1.0.43.bin (release v1.0.64)
const uint8_t kLilygoEsp32S3Image[] = {
    0xe9, 0x05, 0x02, 0x4f, 0x80, 0x69, 0x37, 0x40,
    0xee, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00};

// Start of a gzip stream (.bin.gz). Its inner header is not visible to the
// upload handler, and the Companion unpacks .bin.gz before a WiFi upload, so
// the WiFi updater refuses it (Codex review on #828).
const uint8_t kGzipImage[] = {0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00};

// Classic ESP32 app image: entry in the ESP32 IRAM at 0x40080000.
const uint8_t kEsp32Image[] = {0xe9, 0x06, 0x02, 0x20, 0x1c, 0x10, 0x08, 0x40};

const uint8_t kNotFirmware[] = {'<', 'h', 't', 'm', 'l', '>', ' ', ' '};

bool expect(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    return false;
  }
  return true;
}

std::string readFile(const char* path) {
  std::ifstream input(path);
  return std::string(
      std::istreambuf_iterator<char>(input),
      std::istreambuf_iterator<char>());
}

bool testImageStarts() {
  bool ok = true;
  ok &= expect(IsEsp8266FirmwareImageStart(kEsp8266Image, sizeof(kEsp8266Image)),
               "the released ESP8266 VibeTV image must be accepted");
  ok &= expect(!IsEsp8266FirmwareImageStart(kGzipImage, sizeof(kGzipImage)),
               "a gzip upload must be rejected: its inner image cannot be checked first");
  ok &= expect(!IsEsp8266FirmwareImageStart(kLilygoEsp32S3Image, sizeof(kLilygoEsp32S3Image)),
               "the LilyGO ESP32-S3 release image must be rejected");
  ok &= expect(!IsEsp8266FirmwareImageStart(kEsp32Image, sizeof(kEsp32Image)),
               "a classic ESP32 image must be rejected");
  ok &= expect(!IsEsp8266FirmwareImageStart(kNotFirmware, sizeof(kNotFirmware)),
               "a file that is no firmware image must be rejected");
  ok &= expect(!IsEsp8266FirmwareImageStart(kEsp8266Image, 7),
               "a raw image too short to show its entry address must be rejected");
  ok &= expect(!IsEsp8266FirmwareImageStart(nullptr, 0),
               "an empty first block must be rejected");
  return ok;
}

// The check must run on the first block, before Update.write() can stage any
// byte, so a rejection keeps Update.end(true) from committing the image.
bool testWifiUploadChecksFirstBlock(const char* mainPath) {
  const std::string source = readFile(mainPath);
  const std::size_t start = source.find("void handleOtaUpload() {");
  if (!expect(start != std::string::npos, "handleOtaUpload must remain discoverable")) {
    return false;
  }
  const std::string upload = source.substr(start, source.find("\n}\n", start) - start);
  const std::size_t writeBranch = upload.find("upload.status == UPLOAD_FILE_WRITE");
  const std::size_t firstBlock = upload.find("upload.totalSize == 0", writeBranch);
  const std::size_t check =
      upload.find("IsEsp8266FirmwareImageStart(upload.buf, upload.currentSize)", writeBranch);
  const std::size_t write = upload.find("Update.write(", writeBranch);
  return expect(
      writeBranch != std::string::npos && firstBlock != std::string::npos &&
          check != std::string::npos && write != std::string::npos &&
          firstBlock < check && check < write,
      "the WiFi updater must check the first block for an ESP8266 image before Update.write");
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <firmware_esp8266/src/main.cpp>\n", argv[0]);
    return 2;
  }
  bool ok = testImageStarts();
  ok &= testWifiUploadChecksFirstBlock(argv[1]);
  if (!ok) {
    return 1;
  }
  std::printf("firmware image policy tests passed\n");
  return 0;
}
