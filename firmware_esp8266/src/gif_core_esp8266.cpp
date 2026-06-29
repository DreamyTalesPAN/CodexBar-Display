#include "gif_core_esp8266.h"

#if !defined(CODEXBAR_DISPLAY_PROBE_ONLY) && CODEXBAR_DISPLAY_GIF_CORE

#include "renderer_esp8266_display_state.h"

#include <cstdio>
#include <cstring>

namespace codexbar_display {
namespace esp8266 {

namespace {

constexpr int kLayoutMargin = 8;
constexpr int kLayoutLowerOffset = 35;

}  // namespace

GifCoreESP8266* GifCoreESP8266::activeInstance_ = nullptr;

void GifCoreESP8266::Setup(const char* preloadAssetPath) {
  activeInstance_ = this;
  if (!fsMounted_) {
    fsMounted_ = LittleFS.begin();
  }
  if (!EnsureDecoder()) {
    lastErrorPath_ = preloadAssetPath != nullptr ? preloadAssetPath : "";
    lastErrorStage_ = "decoder_alloc";
    lastErrorFailures_ = 1;
    lastFailureAtMs_ = millis();
  } else if (lastErrorStage_ == "decoder_alloc") {
    lastErrorPath_ = "";
    lastErrorStage_ = "";
    lastErrorFailures_ = 0;
    lastFailureAtMs_ = 0;
  }
  if (fsMounted_ && preloadAssetPath != nullptr && preloadAssetPath[0] != '\0') {
    filePresent_ = LittleFS.exists(preloadAssetPath);
    if (filePresent_) {
      assetPath_ = preloadAssetPath;
      layoutMode_ = GifLayoutMode::BottomRightMini;
      gifWidth_ = 0;
      gifHeight_ = 0;
    }
  }
}

void GifCoreESP8266::Stop() {
  if (decoderOpen_ && decoder_ != nullptr) {
    decoder_->close();
  }
  if (file_) {
    file_.close();
  }
  decoderOpen_ = false;
  suppressDraw_ = false;
  nextFrameAtMs_ = 0;
  gifWidth_ = 0;
  gifHeight_ = 0;
  drawWidth_ = 0;
  drawHeight_ = 0;
  hasBackgroundColor_ = false;
  backgroundColor_ = 0x0000;
}

void GifCoreESP8266::ReleaseMemory() {
  Stop();
  ReleaseDecoder();
}

bool GifCoreESP8266::EnsureDecoder() {
  if (decoder_ != nullptr) {
    return true;
  }
  decoder_ = new (std::nothrow) AnimatedGIF();
  return decoder_ != nullptr;
}

void GifCoreESP8266::ReleaseDecoder() {
  if (decoder_ == nullptr) {
    return;
  }
  delete decoder_;
  decoder_ = nullptr;
}

void GifCoreESP8266::ResetFrameSchedule() {
  nextFrameAtMs_ = 0;
}

void GifCoreESP8266::ResetForAssetUpdate() {
  Stop();
  fsMounted_ = false;
  filePresent_ = false;
  assetPath_ = "";
  lastErrorPath_ = "";
  lastErrorStage_ = "";
  lastErrorFailures_ = 0;
  lastFailureAtMs_ = 0;
  for (uint8_t i = 0; i < kFailureGuardSlots; ++i) {
    guards_[i] = GifFailureGuard();
  }
}

GifCoreESP8266::GifFailureGuard& GifCoreESP8266::GuardForSlot(GifFailureSlot slot) {
  uint8_t idx = static_cast<uint8_t>(slot);
  if (idx >= kFailureGuardSlots) {
    idx = 0;
  }
  return guards_[idx];
}

void GifCoreESP8266::NoteFailure(GifFailureSlot slot, const char* path, const char* stage) {
  if (path == nullptr || path[0] == '\0') {
    return;
  }

  GifFailureGuard& guard = GuardForSlot(slot);
  const uint8_t failuresBefore = guard.consecutiveFailures;
  const bool enteredBackoff = GifCorePolicy::RecordFailure(guard, millis());
  const unsigned int reportedFailures = enteredBackoff
                                            ? static_cast<unsigned int>(
                                                  failuresBefore + (failuresBefore < 255 ? 1 : 0))
                                            : static_cast<unsigned int>(guard.consecutiveFailures);
  lastErrorPath_ = path;
  lastErrorStage_ = stage != nullptr ? stage : "unknown";
  lastErrorFailures_ = reportedFailures;
  lastFailureAtMs_ = millis();

  Serial.printf(
      "gif_playback_failure path=%s stage=%s failures=%u\n",
      path,
      stage != nullptr ? stage : "unknown",
      reportedFailures);

  if (!enteredBackoff) {
    return;
  }

  Serial.printf("gif_playback_backoff path=%s retry_in_ms=%lu\n", path, GifCorePolicy::kFailureBackoffMs);
}

void GifCoreESP8266::NoteSuccess(GifFailureSlot slot, const char* path) {
  if (path == nullptr || path[0] == '\0') {
    return;
  }
  GifFailureGuard& guard = GuardForSlot(slot);
  GifCorePolicy::RecordSuccess(guard);
  lastErrorPath_ = "";
  lastErrorStage_ = "";
  lastErrorFailures_ = 0;
  lastFailureAtMs_ = 0;
}

bool GifCoreESP8266::IsBlocked(GifFailureSlot slot, const char* path) {
  if (path == nullptr || path[0] == '\0') {
    return true;
  }

  GifFailureGuard& guard = GuardForSlot(slot);
  return GifCorePolicy::IsBlocked(guard, millis());
}

bool GifCoreESP8266::ReadGifDimensions(const char* path, int& width, int& height) {
  width = 0;
  height = 0;
  if (!fsMounted_ || path == nullptr || path[0] == '\0' || !LittleFS.exists(path)) {
    return false;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    return false;
  }

  uint8_t header[10] = {0};
  const size_t bytesRead = file.read(header, sizeof(header));
  file.close();
  if (bytesRead < sizeof(header)) {
    return false;
  }

  const bool gifHeader = (memcmp(header, "GIF87a", 6) == 0) || (memcmp(header, "GIF89a", 6) == 0);
  if (!gifHeader) {
    return false;
  }

  width = static_cast<int>(header[6] | (static_cast<uint16_t>(header[7]) << 8));
  height = static_cast<int>(header[8] | (static_cast<uint16_t>(header[9]) << 8));
  return width > 0 && height > 0;
}

bool GifCoreESP8266::EnsureStorage(const char* path) {
  if (fsMounted_) {
    filePresent_ = path != nullptr && path[0] != '\0' && LittleFS.exists(path);
    return true;
  }

  fsMounted_ = LittleFS.begin();
  filePresent_ = fsMounted_ && path != nullptr && path[0] != '\0' && LittleFS.exists(path);
  return fsMounted_;
}

void GifCoreESP8266::ConfigureDrawRect(TFT_eSPI& tft, const GifPlaybackRequest& request) {
  drawWidth_ = gifWidth_;
  drawHeight_ = gifHeight_;

  if (request.layoutMode == GifLayoutMode::Explicit) {
    const int boxWidth = request.width > 0 ? request.width : gifWidth_;
    const int boxHeight = request.height > 0 ? request.height : gifHeight_;
    const GifDrawRect rect = GifCorePolicy::FitContain(request.x, request.y, boxWidth, boxHeight, gifWidth_, gifHeight_);
    drawX_ = rect.x;
    drawY_ = rect.y;
    drawWidth_ = rect.width;
    drawHeight_ = rect.height;
  } else if (request.layoutMode == GifLayoutMode::BottomRightMini) {
    drawX_ = tft.width() - gifWidth_ - kLayoutMargin;
    drawY_ = tft.height() - gifHeight_ - kLayoutMargin;
  } else if (request.layoutMode == GifLayoutMode::FullscreenCenter) {
    drawX_ = (tft.width() - gifWidth_) / 2;
    drawY_ = (tft.height() - gifHeight_) / 2;
  } else if (request.layoutMode == GifLayoutMode::FullscreenCenterLower) {
    drawX_ = (tft.width() - gifWidth_) / 2;
    drawY_ = ((tft.height() - gifHeight_) / 2) + kLayoutLowerOffset;
  } else {
    drawX_ = tft.width() - gifWidth_ - kLayoutMargin;
    drawY_ = kLayoutMargin;
  }

  if (drawX_ < 0) {
    drawX_ = 0;
  }
  if (drawY_ < 0) {
    drawY_ = 0;
  }
  if (drawWidth_ <= 0) {
    drawWidth_ = gifWidth_;
  }
  if (drawHeight_ <= 0) {
    drawHeight_ = gifHeight_;
  }
}

void GifCoreESP8266::ClearDrawRect(TFT_eSPI& tft) {
  if (!hasBackgroundColor_ || drawWidth_ <= 0 || drawHeight_ <= 0) {
    return;
  }
  const int x = max(0, drawX_);
  const int y = max(0, drawY_);
  const int right = min(static_cast<int>(tft.width()), drawX_ + drawWidth_);
  const int bottom = min(static_cast<int>(tft.height()), drawY_ + drawHeight_);
  if (right <= x || bottom <= y) {
    return;
  }
  display::DisplayTransaction transaction;
  tft.fillRect(x, y, right - x, bottom - y, backgroundColor_);
}

bool GifCoreESP8266::EnsurePlayback(TFT_eSPI& tft, const GifPlaybackRequest& request) {
  if (request.assetPath == nullptr || request.assetPath[0] == '\0') {
    Stop();
    return false;
  }

  if (IsBlocked(request.failureSlot, request.assetPath)) {
    Stop();
    return false;
  }

  tft_ = &tft;
  hasBackgroundColor_ = request.hasBackgroundColor;
  backgroundColor_ = request.backgroundColor;

  const String requestPath(request.assetPath);
  if (GifCorePolicy::RequestChanged(
          assetPath_.c_str(),
          static_cast<uint8_t>(layoutMode_),
          static_cast<uint8_t>(failureSlot_),
          requestPath.c_str(),
          static_cast<uint8_t>(request.layoutMode),
          static_cast<uint8_t>(request.failureSlot))) {
    Stop();
    assetPath_ = requestPath;
    layoutMode_ = request.layoutMode;
    failureSlot_ = request.failureSlot;
  }

  if (!EnsureStorage(request.assetPath)) {
    NoteFailure(request.failureSlot, request.assetPath, "fs_mount");
    Stop();
    return false;
  }

  if (!filePresent_) {
    NoteFailure(request.failureSlot, request.assetPath, "missing_file");
    Stop();
    return false;
  }

  if (decoderOpen_) {
    ConfigureDrawRect(tft, request);
    return true;
  }

  int width = 0;
  int height = 0;
  if (!ReadGifDimensions(request.assetPath, width, height)) {
    NoteFailure(request.failureSlot, request.assetPath, "invalid_header");
    Stop();
    return false;
  }

  Stop();
  gifWidth_ = width;
  gifHeight_ = height;
  ConfigureDrawRect(tft, request);

  if (!EnsureDecoder()) {
    NoteFailure(request.failureSlot, request.assetPath, "decoder_alloc");
    Stop();
    return false;
  }

  decoder_->begin(BIG_ENDIAN_PIXELS);
  if (!decoder_->open(
          request.assetPath,
          OpenCallback,
          CloseCallback,
          ReadCallback,
          SeekCallback,
          DrawCallback)) {
    NoteFailure(request.failureSlot, request.assetPath, "decoder_open");
    Stop();
    return false;
  }

  decoderOpen_ = true;
  nextFrameAtMs_ = 0;
  ClearDrawRect(tft);
  return true;
}

bool GifCoreESP8266::PlayFrame(TFT_eSPI& tft, bool forceFrame) {
  const unsigned long now = millis();
  if (!forceFrame && nextFrameAtMs_ != 0 && static_cast<long>(now - nextFrameAtMs_) < 0) {
    return true;
  }

  tft_ = &tft;
  const unsigned long frameStartMs = now;
  int delayMs = 0;

  bool played = false;
  {
    display::DisplayTransaction transaction;
    played = decoder_ != nullptr && decoder_->playFrame(false, &delayMs, nullptr);
  }

  if (!played) {
    if (decoder_ == nullptr) {
      NoteFailure(failureSlot_, assetPath_.c_str(), "decoder_missing");
      Stop();
      return false;
    }
    decoder_->reset();
    ClearDrawRect(tft);
    {
      display::DisplayTransaction transaction;
      played = decoder_->playFrame(false, &delayMs, nullptr);
    }
    if (!played) {
      NoteFailure(failureSlot_, assetPath_.c_str(), "frame_decode");
      Stop();
      return false;
    }
  }

  if (delayMs < 0) {
    delayMs = 0;
  }

  nextFrameAtMs_ = frameStartMs + static_cast<unsigned long>(delayMs);
  NoteSuccess(failureSlot_, assetPath_.c_str());
  return true;
}

bool GifCoreESP8266::EnsureReady(TFT_eSPI& tft, const GifPlaybackRequest& request) {
  return EnsurePlayback(tft, request);
}

bool GifCoreESP8266::Tick(TFT_eSPI& tft, const GifPlaybackRequest& request, bool forceFrame) {
  if (!EnsurePlayback(tft, request)) {
    return false;
  }
  return PlayFrame(tft, forceFrame);
}

int GifCoreESP8266::ReservedWidthFor(const char* assetPath, int fallbackWidth) const {
  if (assetPath == nullptr || assetPath_[0] == '\0' || assetPath_ != assetPath) {
    return fallbackWidth;
  }
  if (decoderOpen_ && gifWidth_ > 0) {
    return gifWidth_;
  }
  if (filePresent_ && gifWidth_ > 0) {
    return gifWidth_;
  }
  return fallbackWidth;
}

bool GifCoreESP8266::IsCurrentAssetPresent(const char* assetPath) const {
  if (assetPath == nullptr || assetPath[0] == '\0' || assetPath_ != assetPath) {
    return false;
  }
  return filePresent_;
}

GifCoreStatusSnapshot GifCoreESP8266::StatusSnapshot() const {
  GifCoreStatusSnapshot snapshot;
  snapshot.activePath = assetPath_;
  snapshot.fsMounted = fsMounted_;
  snapshot.filePresent = filePresent_;
  snapshot.fileOpen = static_cast<bool>(file_);
  snapshot.decoderAllocated = decoder_ != nullptr;
  snapshot.decoderOpen = decoderOpen_;
  snapshot.lastErrorPath = lastErrorPath_;
  snapshot.lastErrorStage = lastErrorStage_;
  snapshot.lastErrorFailures = lastErrorFailures_;

  const unsigned long now = millis();
  const GifFailureGuard& guard = guards_[static_cast<uint8_t>(failureSlot_) < kFailureGuardSlots
                                             ? static_cast<uint8_t>(failureSlot_)
                                             : 0];
  snapshot.consecutiveFailures = guard.consecutiveFailures;
  if (guard.backoffUntilMs != 0 && static_cast<long>(now - guard.backoffUntilMs) < 0) {
    snapshot.blocked = true;
    snapshot.backoffRemainingMs = guard.backoffUntilMs - now;
  }
  if (lastFailureAtMs_ != 0) {
    snapshot.lastErrorAgeMs = now - lastFailureAtMs_;
  }
  return snapshot;
}

void* GifCoreESP8266::OpenCallback(const char* filename, int32_t* fileSize) {
  if (activeInstance_ == nullptr || !activeInstance_->fsMounted_ || filename == nullptr || fileSize == nullptr) {
    return nullptr;
  }

  if (activeInstance_->file_) {
    activeInstance_->file_.close();
  }

  activeInstance_->file_ = LittleFS.open(filename, "r");
  if (!activeInstance_->file_) {
    return nullptr;
  }

  *fileSize = static_cast<int32_t>(activeInstance_->file_.size());
  return static_cast<void*>(&activeInstance_->file_);
}

void GifCoreESP8266::CloseCallback(void* handle) {
  File* file = static_cast<File*>(handle);
  if (file != nullptr && *file) {
    file->close();
  }
}

int32_t GifCoreESP8266::ReadCallback(GIFFILE* file, uint8_t* buf, int32_t len) {
  if (file == nullptr || file->fHandle == nullptr || buf == nullptr || len <= 0) {
    return 0;
  }

  File* stream = static_cast<File*>(file->fHandle);
  int32_t bytesToRead = len;
  const int32_t remaining = file->iSize - file->iPos;
  if (remaining < bytesToRead) {
    bytesToRead = remaining;
  }
  if (bytesToRead <= 0) {
    return 0;
  }

  const int32_t bytesRead = static_cast<int32_t>(stream->read(buf, static_cast<size_t>(bytesToRead)));
  file->iPos = static_cast<int32_t>(stream->position());
  return bytesRead;
}

int32_t GifCoreESP8266::SeekCallback(GIFFILE* file, int32_t position) {
  if (file == nullptr || file->fHandle == nullptr || position < 0) {
    return -1;
  }

  File* stream = static_cast<File*>(file->fHandle);
  if (!stream->seek(static_cast<size_t>(position), SeekSet)) {
    return -1;
  }

  file->iPos = static_cast<int32_t>(stream->position());
  return file->iPos;
}

void GifCoreESP8266::DrawCallback(GIFDRAW* draw) {
  if (activeInstance_ == nullptr) {
    return;
  }
  activeInstance_->DrawCallbackImpl(draw);
}

void GifCoreESP8266::DrawCallbackImpl(GIFDRAW* draw) {
  if (draw == nullptr || suppressDraw_ || tft_ == nullptr) {
    return;
  }
  if (drawWidth_ > 0 && drawHeight_ > 0 && gifWidth_ > 0 && gifHeight_ > 0 &&
      (drawWidth_ != gifWidth_ || drawHeight_ != gifHeight_)) {
    DrawScaledCallbackImpl(draw);
    return;
  }

  int lineWidth = draw->iWidth;
  if (lineWidth <= 0) {
    return;
  }
  if (lineWidth > kMaxLinePixels) {
    lineWidth = kMaxLinePixels;
  }

  int outX = drawX_ + draw->iX;
  int outY = drawY_ + draw->iY + draw->y;
  if (outY < 0 || outY >= tft_->height() || outX >= tft_->width()) {
    return;
  }

  int srcOffset = 0;
  if (outX < 0) {
    srcOffset = -outX;
    outX = 0;
  }
  if (srcOffset >= lineWidth) {
    return;
  }

  lineWidth -= srcOffset;
  if (outX + lineWidth > tft_->width()) {
    lineWidth = tft_->width() - outX;
  }
  if (lineWidth <= 0) {
    return;
  }

  uint8_t* src = draw->pPixels + srcOffset;
  uint16_t* palette = draw->pPalette;
  if (src == nullptr || palette == nullptr) {
    return;
  }

  const bool restoreTransparentToBackground =
      draw->ucHasTransparency && draw->ucDisposalMethod == 2 && hasBackgroundColor_;

  if (restoreTransparentToBackground) {
    const uint8_t transparent = draw->ucTransparent;
    for (int i = 0; i < lineWidth; ++i) {
      lineBuffer_[i] = src[i] == transparent ? backgroundColor_ : palette[src[i]];
    }
    tft_->setAddrWindow(outX, outY, lineWidth, 1);
    tft_->pushPixels(lineBuffer_, lineWidth);
    return;
  }

  if (draw->ucHasTransparency) {
    const uint8_t transparent = draw->ucTransparent;
    uint8_t* cursor = src;
    uint8_t* end = src + lineWidth;
    int offset = 0;

    while (offset < lineWidth) {
      int count = 0;
      uint16_t* out = lineBuffer_;
      while (cursor < end && count < kMaxLinePixels) {
        const uint8_t index = *cursor;
        if (index == transparent) {
          break;
        }
        *out++ = palette[index];
        ++cursor;
        ++count;
      }

      if (count > 0) {
        tft_->setAddrWindow(outX + offset, outY, count, 1);
        tft_->pushPixels(lineBuffer_, count);
        offset += count;
      }

      while (cursor < end && *cursor == transparent) {
        ++cursor;
        ++offset;
      }
    }
    return;
  }

  for (int i = 0; i < lineWidth; ++i) {
    lineBuffer_[i] = palette[src[i]];
  }
  tft_->setAddrWindow(outX, outY, lineWidth, 1);
  tft_->pushPixels(lineBuffer_, lineWidth);
}

void GifCoreESP8266::DrawScaledCallbackImpl(GIFDRAW* draw) {
  int sourceWidth = draw->iWidth;
  if (sourceWidth <= 0 || drawWidth_ <= 0 || drawHeight_ <= 0 || gifWidth_ <= 0 || gifHeight_ <= 0) {
    return;
  }
  if (sourceWidth > kMaxLinePixels) {
    sourceWidth = kMaxLinePixels;
  }

  uint8_t* src = draw->pPixels;
  uint16_t* palette = draw->pPalette;
  if (src == nullptr || palette == nullptr) {
    return;
  }

  const int sourceY = draw->iY + draw->y;
  int outYStart = drawY_ + ((sourceY * drawHeight_) / gifHeight_);
  int outYEnd = drawY_ + (((sourceY + 1) * drawHeight_ + gifHeight_ - 1) / gifHeight_);
  if (outYEnd <= outYStart) {
    outYEnd = outYStart + 1;
  }

  const bool transparent = draw->ucHasTransparency != 0;
  const uint8_t transparentIndex = draw->ucTransparent;
  const bool restoreTransparentToBackground = transparent && draw->ucDisposalMethod == 2 && hasBackgroundColor_;

  for (int outY = outYStart; outY < outYEnd; ++outY) {
    if (outY < 0 || outY >= tft_->height()) {
      continue;
    }

    int runStartX = 0;
    int runLength = 0;
    for (int outRelX = 0; outRelX < drawWidth_; ++outRelX) {
      const int outX = drawX_ + outRelX;
      const int sourceX = (outRelX * gifWidth_) / drawWidth_;
      const int sourceOffset = sourceX - draw->iX;
      const bool sourceInside = sourceOffset >= 0 && sourceOffset < sourceWidth;
      const bool sourceTransparent = sourceInside && transparent && src[sourceOffset] == transparentIndex;
      const bool visible =
          outX >= 0 &&
          outX < tft_->width() &&
          sourceInside &&
          (!sourceTransparent || restoreTransparentToBackground);

      if (!visible) {
        if (runLength > 0) {
          tft_->setAddrWindow(runStartX, outY, runLength, 1);
          tft_->pushPixels(lineBuffer_, runLength);
          runLength = 0;
        }
        continue;
      }

      if (runLength == 0) {
        runStartX = outX;
      }
      lineBuffer_[runLength++] = sourceTransparent ? backgroundColor_ : palette[src[sourceOffset]];
      if (runLength == kMaxLinePixels) {
        tft_->setAddrWindow(runStartX, outY, runLength, 1);
        tft_->pushPixels(lineBuffer_, runLength);
        runLength = 0;
      }
    }

    if (runLength > 0) {
      tft_->setAddrWindow(runStartX, outY, runLength, 1);
      tft_->pushPixels(lineBuffer_, runLength);
    }
  }
}

}  // namespace esp8266
}  // namespace codexbar_display

#endif
