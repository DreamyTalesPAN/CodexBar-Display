#include "gif_core_esp8266.h"

#ifndef VIBEBLOCK_PROBE_ONLY

#include <cstdio>
#include <cstring>

namespace vibeblock {
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
  if (decoderOpen_) {
    decoder_.close();
  }
  if (file_) {
    file_.close();
  }
  decoderOpen_ = false;
  suppressDraw_ = false;
  nextFrameAtMs_ = 0;
  gifWidth_ = 0;
  gifHeight_ = 0;
}

void GifCoreESP8266::ResetFrameSchedule() {
  nextFrameAtMs_ = 0;
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
    return true;
  }

  int width = 0;
  int height = 0;
  if (!ReadGifDimensions(request.assetPath, width, height)) {
    NoteFailure(request.failureSlot, request.assetPath, "invalid_header");
    Stop();
    return false;
  }

  gifWidth_ = width;
  gifHeight_ = height;

  if (request.layoutMode == GifLayoutMode::BottomRightMini) {
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

  Stop();
  decoder_.begin(BIG_ENDIAN_PIXELS);
  if (!decoder_.open(
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

  tft.startWrite();
  bool played = decoder_.playFrame(false, &delayMs, nullptr);
  tft.endWrite();

  if (!played) {
    decoder_.reset();
    tft.startWrite();
    played = decoder_.playFrame(false, &delayMs, nullptr);
    tft.endWrite();
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

  if (draw->ucDisposalMethod == 2) {
    for (int i = 0; i < lineWidth; ++i) {
      if (src[i] == draw->ucTransparent) {
        src[i] = draw->ucBackground;
      }
    }
    draw->ucHasTransparency = 0;
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

}  // namespace esp8266
}  // namespace vibeblock

#endif
