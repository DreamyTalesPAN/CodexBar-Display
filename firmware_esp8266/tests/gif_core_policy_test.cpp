#include <cstdint>
#include <cstdio>
#include <fstream>
#include <string>

#include "../src/gif_core_policy.h"
#include "../src/boot_recovery_policy.h"

namespace {

using codexbar_display::esp8266::GifCorePolicy;
using codexbar_display::esp8266::GifFailureGuardState;
using codexbar_display::esp8266::BootRecoveryPolicy;

bool expect(bool cond, const char* message) {
  if (!cond) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    return false;
  }
  return true;
}

bool testBackoffThresholdAndExpiry() {
  GifFailureGuardState guard;

  if (!expect(!GifCorePolicy::IsBlocked(guard, 0), "fresh guard must not be blocked")) {
    return false;
  }

  if (!expect(!GifCorePolicy::RecordFailure(guard, 100), "first failure must not enter backoff")) {
    return false;
  }
  if (!expect(guard.consecutiveFailures == 1, "first failure increments counter")) {
    return false;
  }

  if (!expect(!GifCorePolicy::RecordFailure(guard, 200), "second failure must not enter backoff")) {
    return false;
  }
  if (!expect(guard.consecutiveFailures == 2, "second failure increments counter")) {
    return false;
  }

  if (!expect(GifCorePolicy::RecordFailure(guard, 300), "third failure must enter backoff")) {
    return false;
  }
  if (!expect(guard.consecutiveFailures == 0, "counter resets after entering backoff")) {
    return false;
  }
  if (!expect(
          guard.backoffUntilMs == 300 + GifCorePolicy::kFailureBackoffMs,
          "backoff deadline must be now + fixed backoff")) {
    return false;
  }

  if (!expect(GifCorePolicy::IsBlocked(guard, 301), "guard should remain blocked before deadline")) {
    return false;
  }
  if (!expect(
          !GifCorePolicy::IsBlocked(guard, 300 + GifCorePolicy::kFailureBackoffMs),
          "guard should unblock at deadline")) {
    return false;
  }
  if (!expect(guard.backoffUntilMs == 0, "deadline must clear after unblock")) {
    return false;
  }

  return true;
}

bool testBackoffResetOnSuccess() {
  GifFailureGuardState guard;
  guard.consecutiveFailures = 2;
  guard.backoffUntilMs = 12345;

  GifCorePolicy::RecordSuccess(guard);

  if (!expect(guard.consecutiveFailures == 0, "success clears consecutive failure count")) {
    return false;
  }
  if (!expect(guard.backoffUntilMs == 0, "success clears backoff deadline")) {
    return false;
  }

  return true;
}

bool testRequestSwitching() {
  if (!expect(
          !GifCorePolicy::RequestChanged("/mini.gif", 0, 0, "/mini.gif", 0, 0),
          "identical request should not switch")) {
    return false;
  }

  if (!expect(
          GifCorePolicy::RequestChanged("/mini.gif", 0, 0, "/other.gif", 0, 0),
          "asset path change should switch")) {
    return false;
  }

  if (!expect(
          GifCorePolicy::RequestChanged("/mini.gif", 0, 0, "/mini.gif", 1, 0),
          "layout change should switch")) {
    return false;
  }

  if (!expect(
          GifCorePolicy::RequestChanged("/mini.gif", 0, 0, "/mini.gif", 0, 1),
          "failure slot change should switch")) {
    return false;
  }

  if (!expect(
          !GifCorePolicy::RequestChanged(nullptr, 0, 0, "", 0, 0),
          "null and empty path should be treated as equal")) {
    return false;
  }

  return true;
}

bool testFitContainPreservesAspectRatio() {
  const auto wideBox = GifCorePolicy::FitContain(10, 20, 160, 80, 80, 80);
  if (!expect(wideBox.x == 50, "square gif in wide box should be horizontally centered")) {
    return false;
  }
  if (!expect(wideBox.y == 20, "square gif in wide box should keep top edge")) {
    return false;
  }
  if (!expect(wideBox.width == 80 && wideBox.height == 80, "square gif in wide box should stay square")) {
    return false;
  }

  const auto tallBox = GifCorePolicy::FitContain(5, 7, 80, 160, 80, 40);
  if (!expect(tallBox.x == 5, "wide gif in tall box should keep left edge")) {
    return false;
  }
  if (!expect(tallBox.y == 67, "wide gif in tall box should be vertically centered")) {
    return false;
  }
  if (!expect(tallBox.width == 80 && tallBox.height == 40, "wide gif should keep aspect ratio")) {
    return false;
  }

  return true;
}

bool testBootRecoveryOnlyCountsPhysicalResets() {
  if (!expect(BootRecoveryPolicy::CountsAsPhysicalReset(0), "power-on reset must count")) {
    return false;
  }
  if (!expect(BootRecoveryPolicy::CountsAsPhysicalReset(6), "external reset must count")) {
    return false;
  }
  for (uint32_t reason = 1; reason <= 5; ++reason) {
    if (!expect(
            !BootRecoveryPolicy::CountsAsPhysicalReset(reason),
            "watchdog, exception, software and deep-sleep resets must not count")) {
      return false;
    }
  }
  return true;
}

std::string readFile(const char* path) {
  std::ifstream input(path);
  return std::string(
      std::istreambuf_iterator<char>(input),
      std::istreambuf_iterator<char>());
}

bool testDecoderAllocationStaysInsideRealPlayback(
    const char* themeSpecRendererPath,
    const char* gifCorePath) {
  const std::string renderer = readFile(themeSpecRendererPath);
  const std::string gifCore = readFile(gifCorePath);
  if (!expect(!renderer.empty(), "theme renderer source must be readable")) {
    return false;
  }
  if (!expect(!gifCore.empty(), "GIF core source must be readable")) {
    return false;
  }

  const std::size_t cacheStart = renderer.find("bool ensureThemeSpecSceneCached(");
  const std::size_t cacheEnd = renderer.find("bool readSpriteLine(", cacheStart);
  if (!expect(
          cacheStart != std::string::npos && cacheEnd != std::string::npos,
          "theme cache function must remain discoverable")) {
    return false;
  }
  const std::string cacheFunction = renderer.substr(cacheStart, cacheEnd - cacheStart);
  if (!expect(
          cacheFunction.find("PrepareDecoder(") == std::string::npos,
          "theme parsing must never allocate the GIF decoder")) {
    return false;
  }
  if (!expect(
          cacheFunction.find("GifCore().ReleaseMemory()") <
              cacheFunction.find("deserializeJson("),
          "theme changes must release GIF memory before parsing the next theme")) {
    return false;
  }

  const std::size_t headerRead = gifCore.find("ReadGifDimensions(");
  const std::size_t decoderAllocation = gifCore.find("if (!PrepareDecoder())", headerRead);
  if (!expect(
          headerRead != std::string::npos && decoderAllocation != std::string::npos &&
              headerRead < decoderAllocation,
          "decoder allocation must happen only after a valid GIF header is read for playback")) {
    return false;
  }
  if (!expect(
          gifCore.find("if (!PrepareDecoder())", decoderAllocation + 1) == std::string::npos,
          "real GIF playback must be the only decoder allocation call site")) {
    return false;
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (!testBackoffThresholdAndExpiry()) {
    return 1;
  }
  if (!testBackoffResetOnSuccess()) {
    return 1;
  }
  if (!testRequestSwitching()) {
    return 1;
  }
  if (!testFitContainPreservesAspectRatio()) {
    return 1;
  }
  if (!testBootRecoveryOnlyCountsPhysicalResets()) {
    return 1;
  }
  if (!expect(argc == 3, "source paths are required for decoder lifecycle test")) {
    return 1;
  }
  if (!testDecoderAllocationStaysInsideRealPlayback(argv[1], argv[2])) {
    return 1;
  }

  std::printf("ok: gif_core_policy_test\n");
  return 0;
}
