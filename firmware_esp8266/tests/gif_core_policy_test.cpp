#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>

#include "../src/gif_core_policy.h"
#include "../src/boot_recovery_policy.h"
#include "../src/asset_path_policy.h"
#include "../src/theme_spec_runtime_policy.h"

namespace {

using codexbar_display::esp8266::GifCorePolicy;
using codexbar_display::esp8266::GifFailureGuardState;
using codexbar_display::esp8266::BootRecoveryPolicy;
using codexbar_display::esp8266::ThemeSpecRuntimePolicy;
using codexbar_display::esp8266::AssetPathPolicy;

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

bool testAssetWritesStayInsideThemeNamespace() {
  const char* allowed[] = {
      "/themes/u/mini.json",
      "/themes/mini/mini.gif",
  };
  for (const char* path : allowed) {
    if (!expect(
            AssetPathPolicy::IsMutableThemeAsset(path, std::strlen(path)),
            "theme asset path must remain writable")) {
      return false;
    }
  }

  const char* blocked[] = {
      "/auth",
      "/s",
      "/theme-active",
      "/.asset-upload.tmp",
      "/foo",
      "/themes/",
      "/themes//bad.gif",
      "/themes/../auth",
      "/themes/u/bad?.gif",
  };
  for (const char* path : blocked) {
    if (!expect(
            !AssetPathPolicy::IsMutableThemeAsset(path, std::strlen(path)),
            "internal or malformed path must not be writable")) {
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

bool testEsp8266CbaCooperativeAnimationPolicy() {
  if (!expect(
          ThemeSpecRuntimePolicy::CbaWorkDue(false, false, false, 8, 3, 0, 0),
          "a fresh CBA activation must start frame zero")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::CbaWorkDue(false, true, true, 8, 3, 9999, 1),
          "an in-progress CBA frame must resume before its fps deadline")) {
    return false;
  }
  if (!expect(
          !ThemeSpecRuntimePolicy::CbaWorkDue(false, false, true, 8, 3, 1000, 999) &&
              ThemeSpecRuntimePolicy::CbaWorkDue(false, false, true, 8, 3, 1000, 1000),
          "a completed CBA frame must wait for its fps deadline")) {
    return false;
  }

  int row = 0;
  int ticks = 0;
  while (row < 17) {
    const int budget = ThemeSpecRuntimePolicy::CbaRowsForTick(row, 17);
    const int expectedBudget = row < 16 ? 8 : 1;
    if (!expect(budget == expectedBudget, "each CBA resume tick must stay within its row budget")) {
      return false;
    }
    row += budget;
    ticks += 1;
  }
  if (!expect(
          ticks == 3 && ThemeSpecRuntimePolicy::CbaRowsForTick(row, 17) == 0,
          "CBA row progress must resume without repeating completed rows")) {
    return false;
  }

  if (!expect(
          ThemeSpecRuntimePolicy::NextCbaFrameIndex(-1, 3) == 0 &&
              ThemeSpecRuntimePolicy::NextCbaFrameIndex(0, 3) == 1 &&
              ThemeSpecRuntimePolicy::NextCbaFrameIndex(2, 3) == 0,
          "CBA frames must start at zero, advance, and loop")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::CbaFrameDelayMs(4) == 250 &&
              ThemeSpecRuntimePolicy::CbaFrameDelayMs(0) == 0,
          "CBA frame delay must follow the asset fps")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::CbaBufferBytes(74, 74) == 10952 &&
              ThemeSpecRuntimePolicy::CbaBufferBytes(77, 77) == 11858 &&
              ThemeSpecRuntimePolicy::CbaBufferBytes(80, 80) == 12800 &&
              ThemeSpecRuntimePolicy::CbaBufferBytes(81, 1) == 0,
          "CBA buffer policy must cover Clippy and Claude within an 80x80 hard limit")) {
    return false;
  }
  const uint32_t clippyBytes = ThemeSpecRuntimePolicy::CbaBufferBytes(74, 74);
  if (!expect(
          ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(24000, 12000, clippyBytes) &&
              !ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(23000, 12000, clippyBytes) &&
              !ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(30000, 10000, clippyBytes),
          "CBA allocation must preserve heap reserve and require one contiguous block")) {
    return false;
  }
  return expect(
      ThemeSpecRuntimePolicy::CanYieldAtDisplayTransactionDepth(0) &&
          !ThemeSpecRuntimePolicy::CanYieldAtDisplayTransactionDepth(1) &&
          !ThemeSpecRuntimePolicy::CanYieldAtDisplayTransactionDepth(2),
      "yield boundaries must require display transaction depth zero");
}

bool testRendererUsesResumableCbaAnimation(
    const char* themeSpecRendererPath,
    const char* displayRendererPath) {
  const std::string renderer = readFile(themeSpecRendererPath);
  const std::size_t loadStart = renderer.find("bool loadAnimatedSpriteCache(");
  const std::size_t drawStart = renderer.find("bool drawAnimatedSpriteAsset(", loadStart);
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
  if (!expect(
          drawFunction.find("CbaRowsForTick") != std::string::npos &&
              drawFunction.find("decodeSpriteRleRowToBuffer") != std::string::npos &&
              drawFunction.find("drawSpriteRleRow") == std::string::npos &&
              drawFunction.find("cache.nextRowOffset") != std::string::npos &&
              drawFunction.find("cache.frameInProgress") != std::string::npos,
          "ESP8266 CBA frames must resume by row into the offscreen buffer")) {
    return false;
  }
  const std::string spriteFunction = renderer.substr(drawEnd, renderer.find("void resetAnimatedSpriteCaches", drawEnd) - drawEnd);
  if (!expect(
          spriteFunction.find("CbaWorkDue") != std::string::npos &&
              spriteFunction.find("file.close()") < spriteFunction.find("pushCompletedAnimatedSpriteFrame"),
          "CBA dispatch must close storage before its single completed-frame push")) {
    return false;
  }
  if (!expect(
          renderer.find("kThemeSpecAnimatedResumeTickMs") != std::string::npos &&
              renderer.find("changedFields & themespec::kThemeSpecFieldActivity") != std::string::npos,
          "unfinished CBA work must resume quickly and activity switches must restart it")) {
    return false;
  }

  const std::string displayRenderer = readFile(displayRendererPath);
  const std::size_t tickStart = displayRenderer.find("void RendererESP8266::TickActive(");
  const std::size_t tickEnd = displayRenderer.find("void RendererESP8266::DrawError(", tickStart);
  if (!expect(
          tickStart != std::string::npos && tickEnd != std::string::npos &&
              displayRenderer.substr(tickStart, tickEnd - tickStart).find("DisplayTransaction") == std::string::npos,
          "the resumable animation tick must not hold a global display transaction")) {
    return false;
  }
  if (!expect(
          renderer.find("CanYieldAtDisplayTransactionDepth") != std::string::npos,
          "all explicit theme-renderer yields must be guarded by transaction depth")) {
    return false;
  }
  const std::size_t pushImage = renderer.find("Tft().pushImage(");
  const std::size_t pushFunction = renderer.rfind("void pushCompletedAnimatedSpriteFrame(", pushImage);
  if (!expect(
          renderer.find("TFT_eSprite") == std::string::npos &&
              pushImage != std::string::npos &&
              renderer.find("Tft().pushImage(", pushImage + 1) == std::string::npos &&
              renderer.find("new (std::nothrow) uint16_t") != std::string::npos &&
              renderer.find("CanAllocateCbaBuffer") != std::string::npos,
          "CBA must use one guarded raw RGB565 buffer and exactly one atomic push path")) {
    return false;
  }
  if (!expect(
          pushFunction != std::string::npos &&
              renderer.find("ShouldIndexNextAnimatedFrame", pushImage) != std::string::npos &&
              renderer.find("cache.indexedFrameCount += 1", pushImage) != std::string::npos,
          "the next lazy CBA offset must be committed only after the completed frame push")) {
    return false;
  }
  if (!expect(
          renderer.find("const bool previousSwapBytes = Tft().getSwapBytes()") != std::string::npos &&
              renderer.find("Tft().setSwapBytes(true)", pushImage - 256) < pushImage &&
              renderer.find("Tft().setSwapBytes(previousSwapBytes)", pushImage) > pushImage,
          "raw RGB565 pushes must enable byte swapping and restore the previous TFT state")) {
    return false;
  }
  const std::size_t resetEnd = renderer.find("class ThemeSpecSink");
  const std::size_t resetStart = renderer.rfind("void resetAnimatedSpriteCaches(", resetEnd);
  if (!expect(
          resetStart != std::string::npos && resetEnd != std::string::npos &&
              renderer.substr(resetStart, resetEnd - resetStart).find("cbaFrameBufferOwner = nullptr") != std::string::npos &&
              renderer.substr(resetStart, resetEnd - resetStart).find("releaseCbaFrameBuffer") == std::string::npos,
          "activity/cache reset must clear the owner while retaining singleton capacity")) {
    return false;
  }
  return expect(
      renderer.find("cache.frameStartedAtMs + frameDelayMs") != std::string::npos,
      "CBA fps deadlines must be based on frame start rather than render completion");
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
          cacheFunction.find("EnsureDecoder(") == std::string::npos,
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
  const std::size_t decoderAllocation = gifCore.find("if (!EnsureDecoder())", validation);
  if (!expect(
          validation != std::string::npos && decoderAllocation != std::string::npos &&
              validation < decoderAllocation,
          "decoder allocation must happen only after complete GIF profile validation")) {
    return false;
  }
  if (!expect(
          gifCore.find("if (!EnsureDecoder())", decoderAllocation + 1) == std::string::npos,
          "real GIF playback must be the only decoder allocation call site")) {
    return false;
  }
  return true;
}

bool testGifLoopResetStaysAtomic(const char* gifCorePath) {
  const std::string gifCore = readFile(gifCorePath);
  const std::size_t loopReset = gifCore.find("if (!played) {");
  const std::size_t loopResetEnd = gifCore.find("if (delayMs < 0)", loopReset);
  if (!expect(
          loopReset != std::string::npos && loopResetEnd != std::string::npos,
          "GIF loop reset must remain discoverable")) {
    return false;
  }
  const std::string resetBlock = gifCore.substr(loopReset, loopResetEnd - loopReset);
  const std::size_t transaction = resetBlock.find("display::DisplayTransaction transaction;");
  const std::size_t reset = resetBlock.find("decoder_->reset();");
  const std::size_t safeCheck = resetBlock.find("if (!firstFrameCoversCanvasOpaque_)");
  const std::size_t clear = resetBlock.find("ClearDrawRect(tft);");
  const std::size_t firstFrame = resetBlock.find("decoder_->playFrame(false, &delayMs, nullptr);");
  return expect(
      transaction != std::string::npos && reset != std::string::npos && safeCheck != std::string::npos &&
          clear != std::string::npos && firstFrame != std::string::npos &&
          transaction < reset && reset < safeCheck && safeCheck < clear && clear < firstFrame,
      "GIF loop clear must be conditional while reset and first frame stay in one transaction");
}

bool testLegacyMiniThemeUsesLiveUsageMode(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  if (!expect(
      mainSource.find("kLegacyDefaultThemeSpecPath = \"/themes/u/mini-cl-1-410a37.json\"") !=
              std::string::npos &&
          mainSource.find("raw.replace(\"\\\"v\\\":\\\"left\\\"\", \"\\\"v\\\":\\\"{usageMode}\\\"\")") !=
              std::string::npos,
      "legacy factory Mini specs must render the live usage mode after OTA")) {
    return false;
  }

  const std::size_t loadStart = mainSource.find("void loadDefaultStoredThemeSpecCache()");
  const std::size_t loadEnd = mainSource.find("#endif", loadStart);
  if (!expect(
          loadStart != std::string::npos && loadEnd != std::string::npos,
          "default ThemeSpec cache loader must remain discoverable")) {
    return false;
  }
  const std::string loader = mainSource.substr(loadStart, loadEnd - loadStart);
  const std::size_t active = loader.find("readActiveThemeSpecPath(activePath)");
  const std::size_t currentDefault = loader.find("loadStoredThemeSpecCacheFromPath(kDefaultThemeSpecPath)");
  const std::size_t previousDefault = loader.find("loadStoredThemeSpecCacheFromPath(kPreviousDefaultThemeSpecPath)");
  const std::size_t legacyDefault = loader.find("loadStoredThemeSpecCacheFromPath(kLegacyDefaultThemeSpecPath)");
  return expect(
      active != std::string::npos && currentDefault != std::string::npos &&
          previousDefault != std::string::npos && legacyDefault != std::string::npos &&
          active < currentDefault && currentDefault < previousDefault && previousDefault < legacyDefault,
      "OTA filesystems must fall back through current, 1.0.37, then 1.0.36 Mini specs");
}

bool testAssetHandlersUseThemeNamespacePolicy(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t uploadValidation = mainSource.find("if (!isMutableThemeAssetPath(assetUploadPath))");
  const std::size_t temporaryOpen =
      mainSource.find("LittleFS.open(kAssetUploadTemporaryPath, \"w\")", uploadValidation);
  const std::size_t deleteHandler = mainSource.find("void handleAssetDelete()");
  const std::size_t deleteValidation = mainSource.find("if (!isMutableThemeAssetPath(path))", deleteHandler);
  const std::size_t deleteCall = mainSource.find("LittleFS.remove(path)", deleteValidation);
  return expect(
      uploadValidation != std::string::npos && temporaryOpen != std::string::npos &&
          uploadValidation < temporaryOpen && deleteValidation != std::string::npos &&
          deleteCall != std::string::npos && deleteValidation < deleteCall,
      "upload and delete handlers must enforce the theme namespace before filesystem writes");
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
  if (!testFitContainPreservesAspectRatio()) {
    return 1;
  }
  if (!testBootRecoveryOnlyCountsPhysicalResets()) {
    return 1;
  }
  if (!testAssetWritesStayInsideThemeNamespace()) {
    return 1;
  }
  if (!testAnimatedAssetScanYieldsEveryFourRows()) {
    return 1;
  }
  if (!testAnimatedFrameOffsetsAreIndexedOneFrameAtATime()) {
    return 1;
  }
  if (!testEsp8266CbaCooperativeAnimationPolicy()) {
    return 1;
  }
  if (!expect(argc == 5, "source paths are required for firmware policy tests")) {
    return 1;
  }
  if (!testRendererUsesResumableCbaAnimation(argv[1], argv[4])) {
    return 1;
  }
  if (!testDecoderAllocationStaysInsideRealPlayback(argv[1], argv[2])) {
    return 1;
  }
  if (!testGifLoopResetStaysAtomic(argv[2])) {
    return 1;
  }
  if (!testLegacyMiniThemeUsesLiveUsageMode(argv[3])) {
    return 1;
  }
  if (!testAssetHandlersUseThemeNamespacePolicy(argv[3])) {
    return 1;
  }
  if (!testFirmwareUsesIPDiscoveryInsteadOfMdns(argv[3])) {
    return 1;
  }

  std::printf("ok: gif_core_policy_test\n");
  return 0;
}
