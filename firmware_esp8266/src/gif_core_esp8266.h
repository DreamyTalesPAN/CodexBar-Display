#pragma once

#include <Arduino.h>

#ifndef CODEXBAR_DISPLAY_GIF_CORE
#define CODEXBAR_DISPLAY_GIF_CORE 1
#endif

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
#if CODEXBAR_DISPLAY_GIF_CORE
#include <AnimatedGIF.h>
#endif
#include <LittleFS.h>
#include <TFT_eSPI.h>
#include <new>
#endif

#include "gif_core_policy.h"

namespace codexbar_display {
namespace esp8266 {

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

struct GifPlaybackRequest {
  const char* assetPath = nullptr;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  bool hasBackgroundColor = false;
  uint16_t backgroundColor = 0x0000;
};

struct GifCoreStatusSnapshot {
  String activePath;
  bool fsMounted = false;
  bool filePresent = false;
  bool fileOpen = false;
  bool decoderAllocated = false;
  bool decoderOpen = false;
  bool blocked = false;
  uint8_t consecutiveFailures = 0;
  unsigned long backoffRemainingMs = 0;
  String lastErrorPath;
  String lastErrorStage;
  unsigned int lastErrorFailures = 0;
  unsigned long lastErrorAgeMs = 0;
};

class GifCoreESP8266 {
 public:
#if !CODEXBAR_DISPLAY_GIF_CORE
  void Setup() {}
  void ReleaseMemory() {}
  void ResetForAssetUpdate() {}

  bool Tick(TFT_eSPI& tft, const GifPlaybackRequest& request, bool forceFrame) {
    (void)tft;
    (void)request;
    (void)forceFrame;
    return false;
  }

  GifCoreStatusSnapshot StatusSnapshot() const {
    GifCoreStatusSnapshot snapshot;
    snapshot.blocked = true;
    snapshot.lastErrorStage = "gif_core_disabled";
    return snapshot;
  }
#else
  void Setup();
  void ReleaseMemory();
  void ResetForAssetUpdate();
  bool Tick(TFT_eSPI& tft, const GifPlaybackRequest& request, bool forceFrame);
  GifCoreStatusSnapshot StatusSnapshot() const;

 private:
  using GifFailureGuard = GifFailureGuardState;

  static constexpr int kMaxLinePixels = 240;
  static GifCoreESP8266* activeInstance_;

  static void* OpenCallback(const char* filename, int32_t* fileSize);
  static void CloseCallback(void* handle);
  static int32_t ReadCallback(GIFFILE* file, uint8_t* buf, int32_t len);
  static int32_t SeekCallback(GIFFILE* file, int32_t position);
  static void DrawCallback(GIFDRAW* draw);

  void DrawCallbackImpl(GIFDRAW* draw);

  void NoteFailure(const char* path, const char* stage);
  void NoteSuccess(const char* path);
  bool IsBlocked(const char* path);

  bool EnsureStorage(const char* path);
  void ConfigureDrawRect(TFT_eSPI& tft, const GifPlaybackRequest& request);
  void ClearDrawRect(TFT_eSPI& tft);
  bool EnsurePlayback(TFT_eSPI& tft, const GifPlaybackRequest& request);
  bool PlayFrame(TFT_eSPI& tft, bool forceFrame);
  void DrawScaledCallbackImpl(GIFDRAW* draw);
  bool EnsureDecoder();
  void ReleaseDecoder();
  void Stop();

  AnimatedGIF* decoder_ = nullptr;
  File file_;
  bool fsMounted_ = false;
  bool filePresent_ = false;
  bool decoderOpen_ = false;
  bool suppressDraw_ = false;
  unsigned long nextFrameAtMs_ = 0;
  unsigned long lastFailureAtMs_ = 0;
  int gifWidth_ = 0;
  int gifHeight_ = 0;
  int drawX_ = 0;
  int drawY_ = 0;
  int drawWidth_ = 0;
  int drawHeight_ = 0;
  bool hasBackgroundColor_ = false;
  bool firstFrameCoversCanvasOpaque_ = false;
  uint16_t backgroundColor_ = 0x0000;
  String assetPath_ = "";
  String lastErrorPath_ = "";
  String lastErrorStage_ = "";
  unsigned int lastErrorFailures_ = 0;
  GifFailureGuard guard_;
  TFT_eSPI* tft_ = nullptr;
  uint16_t lineBuffer_[kMaxLinePixels];
#endif
};

#endif

}  // namespace esp8266
}  // namespace codexbar_display
