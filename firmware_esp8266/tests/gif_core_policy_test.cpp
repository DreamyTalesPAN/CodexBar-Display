#include <cstdint>
#include <cstdio>
#include <fstream>
#include <string>

#include "../src/gif_core_policy.h"
#include "../src/boot_recovery_policy.h"
#include "../src/theme_spec_runtime_policy.h"

namespace {

using codexbar_display::esp8266::GifCorePolicy;
using codexbar_display::esp8266::GifFailureGuardState;
using codexbar_display::esp8266::BootRecoveryPolicy;
using codexbar_display::esp8266::ThemeSpecRuntimePolicy;

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

bool testAnimatedAssetScanYieldsEveryFourRows() {
  for (int row = 1; row <= 32; ++row) {
    const bool expected = (row % 4) == 0;
    if (!expect(
            ThemeSpecRuntimePolicy::ShouldYieldDuringAssetScan(row) == expected,
            "animated asset work must yield after every four rows")) {
      return false;
    }
  }
  return true;
}

std::string readFile(const char* path);

bool testAnimatedFrameOffsetsAreIndexedOneFrameAtATime() {
  if (!expect(
          ThemeSpecRuntimePolicy::InitialAnimatedIndexedFrameCount(8) == 1,
          "animated asset load must expose only the first frame offset")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::AnimatedFrameOffsetAvailable(0, 8, 1) &&
              !ThemeSpecRuntimePolicy::AnimatedFrameOffsetAvailable(1, 8, 1),
          "only frame zero may be available after initial load")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(0, 8, 1) &&
              ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(1, 8, 2),
          "each successful frame may publish at most its direct successor")) {
    return false;
  }
  return expect(
      !ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(0, 8, 2) &&
          !ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(7, 8, 8),
      "cached or final frames must not extend the offset index");
}

bool testRendererUsesLazyAnimatedFrameIndex(const char* themeSpecRendererPath) {
  const std::string renderer = readFile(themeSpecRendererPath);
  const std::size_t loadStart = renderer.find("bool loadAnimatedSpriteCache(");
  const std::size_t drawStart = renderer.find("void drawAnimatedSpriteAsset(", loadStart);
  const std::size_t drawEnd = renderer.find("void drawSpriteAsset(", drawStart);
  if (!expect(
          loadStart != std::string::npos && drawStart != std::string::npos && drawEnd != std::string::npos,
          "animated sprite load and draw functions must remain discoverable")) {
    return false;
  }

  const std::string loadFunction = renderer.substr(loadStart, drawStart - loadStart);
  if (!expect(
          loadFunction.find("InitialAnimatedIndexedFrameCount") != std::string::npos &&
              loadFunction.find("for (int frame") == std::string::npos,
          "initial CBA load must publish frame zero without scanning every frame")) {
    return false;
  }

  const std::string drawFunction = renderer.substr(drawStart, drawEnd - drawStart);
  return expect(
      drawFunction.find("ShouldIndexNextAnimatedFrame") != std::string::npos &&
          drawFunction.find("cache.indexedFrameCount += 1") != std::string::npos,
      "a successful CBA draw must index at most its direct successor");
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

  const std::size_t validation = gifCore.find("ValidateGifAssetFile(");
  const std::size_t decoderAllocation = gifCore.find("if (!PrepareDecoder())", validation);
  if (!expect(
          validation != std::string::npos && decoderAllocation != std::string::npos &&
              validation < decoderAllocation,
          "decoder allocation must happen only after complete GIF profile validation")) {
    return false;
  }
  if (!expect(
          gifCore.find("if (!PrepareDecoder())", decoderAllocation + 1) == std::string::npos,
          "real GIF playback must be the only decoder allocation call site")) {
    return false;
  }
  return true;
}

bool testInternalUploadPathIsRejected(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t pathValidation = mainSource.find("if (!isSafeAssetPath(assetUploadPath))");
  const std::size_t reservedValidation =
      mainSource.find("if (assetUploadPath == kAssetUploadTemporaryPath)", pathValidation);
  const std::size_t temporaryOpen =
      mainSource.find("LittleFS.open(kAssetUploadTemporaryPath, \"w\")", reservedValidation);
  return expect(
      pathValidation != std::string::npos && reservedValidation != std::string::npos &&
          temporaryOpen != std::string::npos && reservedValidation < temporaryOpen,
      "the internal staging path must be rejected before opening an external upload");
}

bool testFirmwareUsesIPDiscoveryInsteadOfMdns(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  return expect(
      mainSource.find("ESP8266mDNS") == std::string::npos &&
          mainSource.find("vibetv.local") == std::string::npos &&
          mainSource.find("MDNS.") == std::string::npos &&
          mainSource.find("WiFi.localIP().toString()") != std::string::npos &&
          mainSource.find("192.168.4.1") != std::string::npos,
      "firmware must expose setup and station endpoints by IP without mDNS");
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
  if (!testAnimatedAssetScanYieldsEveryFourRows()) {
    return 1;
  }
  if (!testAnimatedFrameOffsetsAreIndexedOneFrameAtATime()) {
    return 1;
  }
  if (!expect(argc == 4, "source paths are required for firmware policy tests")) {
    return 1;
  }
  if (!testRendererUsesLazyAnimatedFrameIndex(argv[1])) {
    return 1;
  }
  if (!testDecoderAllocationStaysInsideRealPlayback(argv[1], argv[2])) {
    return 1;
  }
  if (!testInternalUploadPathIsRejected(argv[3])) {
    return 1;
  }
  if (!testFirmwareUsesIPDiscoveryInsteadOfMdns(argv[3])) {
    return 1;
  }

  std::printf("ok: gif_core_policy_test\n");
  return 0;
}
