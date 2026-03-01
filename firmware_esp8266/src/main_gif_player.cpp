#ifdef VIBEBLOCK_GIF_PLAYER

#include <Arduino.h>
#include <LittleFS.h>
#include <TFT_eSPI.h>

#include <AnimatedGIF.h>

namespace {

constexpr const char* kBoardID = "esp8266-smalltv-st7789-gif-player";
constexpr const char* kFirmwareVersion = "1.0.0-gif-player";
constexpr const char* kGifPath = "/loop.gif";
constexpr const char* kTempGifPath = "/loop.tmp";
constexpr unsigned long kSerialBaudRate = 115200UL;
constexpr size_t kMaxGIFBytes = 3145728;
constexpr size_t kFSReserveBytes = 8192;
constexpr unsigned long kUploadIdleTimeoutMs = 20000UL;
constexpr int kMinGIFFrameDelayMs = 0;
constexpr int kGIFLineBufferPixels = 240;
constexpr size_t kCommandBufferBytes = 128;
constexpr uint8_t kDisplayRotation = 0;
constexpr int kInitialEstimatedFrameDelayMs = 33;
constexpr int kMaxCatchupDropsPerTick = 8;

struct FrameWindow {
  bool active = false;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;

  void reset() {
    active = false;
    x = 0;
    y = 0;
    width = 0;
    height = 0;
  }
};

struct PlaybackMetrics {
  uint32_t renderedFrames = 0;
  uint32_t droppedFrames = 0;
  uint16_t lastRenderMs = 0;
  uint16_t avgRenderMs = 0;
  int estimatedDelayMs = kInitialEstimatedFrameDelayMs;

  void reset() {
    renderedFrames = 0;
    droppedFrames = 0;
    lastRenderMs = 0;
    avgRenderMs = 0;
    estimatedDelayMs = kInitialEstimatedFrameDelayMs;
  }

  void noteDelaySample(int sampleMs) {
    if (sampleMs < 1) {
      sampleMs = 1;
    }
    estimatedDelayMs = ((estimatedDelayMs * 7) + sampleMs) / 8;
    if (estimatedDelayMs < 1) {
      estimatedDelayMs = 1;
    }
  }

  void noteRenderedFrame(unsigned long renderMs) {
    ++renderedFrames;
    if (renderMs > 65535UL) {
      renderMs = 65535UL;
    }
    lastRenderMs = static_cast<uint16_t>(renderMs);
    if (avgRenderMs == 0) {
      avgRenderMs = lastRenderMs;
      return;
    }
    avgRenderMs = static_cast<uint16_t>((static_cast<uint32_t>(avgRenderMs) * 7U + lastRenderMs) / 8U);
  }
};

struct AppState {
  bool fsReady = false;
  bool playbackEnabled = true;
  bool gifOpen = false;
  bool screenNeedsMessage = true;
  bool suppressDraw = false;
  unsigned long nextFrameAtMs = 0;

  int gifWidth = 0;
  int gifHeight = 0;
  int gifOffsetX = 0;
  int gifOffsetY = 0;

  FrameWindow frameWindow;
  PlaybackMetrics metrics;

  void resetPlaybackCounters() {
    metrics.reset();
  }

  void resetFrameScheduling() {
    nextFrameAtMs = 0;
    frameWindow.reset();
    suppressDraw = false;
  }
};

TFT_eSPI tft = TFT_eSPI();
AnimatedGIF gifDecoder;
File gifFile;

AppState app;

char commandBuffer[kCommandBufferBytes];
size_t commandLen = 0;
uint16_t gifLineBuffer[kGIFLineBufferPixels];
uint8_t* gifTurboBuffer = nullptr;

bool isPastDeadline(unsigned long now, unsigned long deadlineMs) {
  return static_cast<long>(now - deadlineMs) >= 0;
}

bool isGifHeader(const uint8_t* header, size_t bytesRead) {
  if (header == nullptr || bytesRead < 10) {
    return false;
  }
  return (memcmp(header, "GIF87a", 6) == 0) || (memcmp(header, "GIF89a", 6) == 0);
}

bool readGIFDimensions(const char* path, int& width, int& height) {
  width = 0;
  height = 0;
  if (!app.fsReady || path == nullptr) {
    return false;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    return false;
  }

  uint8_t header[10] = {0};
  const size_t bytesRead = file.read(header, sizeof(header));
  file.close();
  if (!isGifHeader(header, bytesRead)) {
    return false;
  }

  width = static_cast<int>(header[6] | (static_cast<uint16_t>(header[7]) << 8));
  height = static_cast<int>(header[8] | (static_cast<uint16_t>(header[9]) << 8));
  return width > 0 && height > 0;
}

size_t fileSizeBytes(const char* path) {
  if (!app.fsReady || path == nullptr || !LittleFS.exists(path)) {
    return 0;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    return 0;
  }

  const size_t bytes = file.size();
  file.close();
  return bytes;
}

size_t freeFSBytes() {
  if (!app.fsReady) {
    return 0;
  }

  FSInfo fsInfo;
  if (!LittleFS.info(fsInfo)) {
    return 0;
  }
  if (fsInfo.totalBytes <= fsInfo.usedBytes) {
    return 0;
  }
  return static_cast<size_t>(fsInfo.totalBytes - fsInfo.usedBytes);
}

size_t writeBudgetBytes() {
  size_t freeBytes = freeFSBytes();
  if (freeBytes <= kFSReserveBytes) {
    return 0;
  }

  freeBytes -= kFSReserveBytes;
  if (freeBytes > kMaxGIFBytes) {
    freeBytes = kMaxGIFBytes;
  }
  return freeBytes;
}

size_t advertisedBudgetBytes() {
  size_t budget = freeFSBytes();
  budget += fileSizeBytes(kGifPath);
  if (budget <= kFSReserveBytes) {
    return 0;
  }

  budget -= kFSReserveBytes;
  if (budget > kMaxGIFBytes) {
    budget = kMaxGIFBytes;
  }
  return budget;
}

void drawStatusScreen(const char* line1, const char* line2 = "") {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextFont(2);
  tft.setTextSize(1);
  tft.setCursor(8, 24);
  tft.println("vibeblock gif player");

  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setCursor(8, 58);
  tft.println(line1 == nullptr ? "" : line1);

  if (line2 != nullptr && line2[0] != '\0') {
    tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    tft.setCursor(8, 84);
    tft.println(line2);
  }
}

void closeGIFPlayback() {
  if (app.gifOpen) {
    gifDecoder.close();
  }
  app.gifOpen = false;
  app.resetFrameScheduling();
}

void resetPlaybackState() {
  closeGIFPlayback();
  app.screenNeedsMessage = true;
}

void resetPlaybackMetrics() {
  app.resetPlaybackCounters();
}

void resetFrameWindowForFrame(const GIFDRAW* draw) {
  app.frameWindow.reset();
  if (draw == nullptr || draw->ucHasTransparency) {
    return;
  }

  const int frameX = app.gifOffsetX + draw->iX;
  const int frameY = app.gifOffsetY + draw->iY;
  if (frameX < 0 || frameY < 0 || draw->iWidth <= 0 || draw->iHeight <= 0) {
    return;
  }
  if (frameX + draw->iWidth > tft.width() || frameY + draw->iHeight > tft.height()) {
    return;
  }

  app.frameWindow.active = true;
  app.frameWindow.x = frameX;
  app.frameWindow.y = frameY;
  app.frameWindow.width = draw->iWidth;
  app.frameWindow.height = draw->iHeight;
  tft.setAddrWindow(app.frameWindow.x, app.frameWindow.y, app.frameWindow.width, app.frameWindow.height);
}

void* GIFOpenFileCallback(const char* filename, int32_t* pFileSize) {
  if (!app.fsReady || filename == nullptr || pFileSize == nullptr) {
    return nullptr;
  }

  if (gifFile) {
    gifFile.close();
  }

  gifFile = LittleFS.open(filename, "r");
  if (!gifFile) {
    return nullptr;
  }

  *pFileSize = static_cast<int32_t>(gifFile.size());
  return static_cast<void*>(&gifFile);
}

void GIFCloseFileCallback(void* pHandle) {
  File* file = static_cast<File*>(pHandle);
  if (file != nullptr && *file) {
    file->close();
  }
}

int32_t GIFReadFileCallback(GIFFILE* pFile, uint8_t* pBuf, int32_t iLen) {
  if (pFile == nullptr || pFile->fHandle == nullptr || pBuf == nullptr || iLen <= 0) {
    return 0;
  }

  File* file = static_cast<File*>(pFile->fHandle);
  int32_t bytesToRead = iLen;
  const int32_t remaining = pFile->iSize - pFile->iPos;
  if (remaining < bytesToRead) {
    bytesToRead = remaining;
  }
  if (bytesToRead <= 0) {
    return 0;
  }

  const int32_t bytesRead = static_cast<int32_t>(file->read(pBuf, static_cast<size_t>(bytesToRead)));
  pFile->iPos = static_cast<int32_t>(file->position());
  return bytesRead;
}

int32_t GIFSeekFileCallback(GIFFILE* pFile, int32_t iPosition) {
  if (pFile == nullptr || pFile->fHandle == nullptr || iPosition < 0) {
    return -1;
  }

  File* file = static_cast<File*>(pFile->fHandle);
  if (!file->seek(static_cast<size_t>(iPosition), SeekSet)) {
    return -1;
  }

  pFile->iPos = static_cast<int32_t>(file->position());
  return pFile->iPos;
}

void drawTransparentSegments(int drawX, int drawY, uint8_t* src, int lineWidth, uint16_t* palette, uint8_t transparent) {
  uint8_t* cursor = src;
  uint8_t* end = src + lineWidth;
  int x = 0;

  while (x < lineWidth) {
    int count = 0;
    uint16_t* out = gifLineBuffer;
    while (cursor < end && count < kGIFLineBufferPixels) {
      const uint8_t index = *cursor;
      if (index == transparent) {
        break;
      }
      *out++ = palette[index];
      ++cursor;
      ++count;
    }

    if (count > 0) {
      tft.setAddrWindow(drawX + x, drawY, count, 1);
      tft.pushPixels(gifLineBuffer, count);
      x += count;
    }

    while (cursor < end && *cursor == transparent) {
      ++cursor;
      ++x;
    }
  }
}

bool canStreamOpaqueLine(int srcOffset, int drawX, int drawY, int lineWidth) {
  if (!app.frameWindow.active) {
    return false;
  }
  if (srcOffset != 0) {
    return false;
  }
  if (drawX != app.frameWindow.x || lineWidth != app.frameWindow.width) {
    return false;
  }
  return drawY >= app.frameWindow.y && drawY < (app.frameWindow.y + app.frameWindow.height);
}

void GIFDrawCallback(GIFDRAW* pDraw) {
  if (pDraw == nullptr || app.suppressDraw) {
    return;
  }

  if (pDraw->y == 0) {
    resetFrameWindowForFrame(pDraw);
  }

  int lineWidth = pDraw->iWidth;
  if (lineWidth <= 0) {
    return;
  }
  if (lineWidth > kGIFLineBufferPixels) {
    lineWidth = kGIFLineBufferPixels;
  }

  int drawX = app.gifOffsetX + pDraw->iX;
  int drawY = app.gifOffsetY + pDraw->iY + pDraw->y;
  if (drawY < 0 || drawY >= tft.height() || drawX >= tft.width()) {
    return;
  }

  int srcOffset = 0;
  if (drawX < 0) {
    srcOffset = -drawX;
    drawX = 0;
  }
  if (srcOffset >= lineWidth) {
    return;
  }

  lineWidth -= srcOffset;
  if (drawX + lineWidth > tft.width()) {
    lineWidth = tft.width() - drawX;
  }
  if (lineWidth <= 0) {
    return;
  }

  uint8_t* src = pDraw->pPixels + srcOffset;
  uint16_t* palette = pDraw->pPalette;
  if (src == nullptr || palette == nullptr) {
    return;
  }

  if (pDraw->ucDisposalMethod == 2) {
    for (int i = 0; i < lineWidth; ++i) {
      if (src[i] == pDraw->ucTransparent) {
        src[i] = pDraw->ucBackground;
      }
    }
    pDraw->ucHasTransparency = 0;
  }

  if (pDraw->ucHasTransparency) {
    app.frameWindow.reset();
    drawTransparentSegments(drawX, drawY, src, lineWidth, palette, pDraw->ucTransparent);
    return;
  }

  for (int i = 0; i < lineWidth; ++i) {
    gifLineBuffer[i] = palette[src[i]];
  }

  if (canStreamOpaqueLine(srcOffset, drawX, drawY, lineWidth)) {
    tft.pushPixels(gifLineBuffer, lineWidth);
    if (drawY == app.frameWindow.y + app.frameWindow.height - 1) {
      app.frameWindow.reset();
    }
    return;
  }

  app.frameWindow.reset();
  tft.setAddrWindow(drawX, drawY, lineWidth, 1);
  tft.pushPixels(gifLineBuffer, lineWidth);
}

bool openGIFPlayback() {
  if (!app.fsReady || !LittleFS.exists(kGifPath)) {
    return false;
  }
  if (app.gifOpen) {
    return true;
  }

  int width = 0;
  int height = 0;
  if (!readGIFDimensions(kGifPath, width, height)) {
    return false;
  }

  closeGIFPlayback();
  if (!gifDecoder.open(
          kGifPath,
          GIFOpenFileCallback,
          GIFCloseFileCallback,
          GIFReadFileCallback,
          GIFSeekFileCallback,
          GIFDrawCallback)) {
    return false;
  }

  app.gifWidth = width;
  app.gifHeight = height;
  app.gifOffsetX = (tft.width() - app.gifWidth) / 2;
  app.gifOffsetY = (tft.height() - app.gifHeight) / 2;
  if (app.gifOffsetX < 0) {
    app.gifOffsetX = 0;
  }
  if (app.gifOffsetY < 0) {
    app.gifOffsetY = 0;
  }

  app.gifOpen = true;
  app.nextFrameAtMs = 0;
  resetPlaybackMetrics();
  return true;
}

bool playGIFFrame(bool drawFrame, int& delayMs, unsigned long* elapsedMs = nullptr) {
  delayMs = 0;
  const unsigned long startedAt = millis();
  app.suppressDraw = !drawFrame;

  if (drawFrame) {
    tft.startWrite();
  }
  bool played = gifDecoder.playFrame(false, &delayMs, nullptr);
  if (drawFrame) {
    tft.endWrite();
  }

  if (!played) {
    gifDecoder.reset();
    if (drawFrame) {
      tft.startWrite();
    }
    played = gifDecoder.playFrame(false, &delayMs, nullptr);
    if (drawFrame) {
      tft.endWrite();
    }
    if (!played) {
      app.suppressDraw = false;
      return false;
    }
  }

  app.suppressDraw = false;
  if (delayMs < kMinGIFFrameDelayMs) {
    delayMs = kMinGIFFrameDelayMs;
  }

  if (elapsedMs != nullptr) {
    *elapsedMs = millis() - startedAt;
  }
  return true;
}

bool catchUpByDroppingFrames() {
  int dropBudget = kMaxCatchupDropsPerTick;
  while (dropBudget > 0) {
    const unsigned long now = millis();
    const long lagMs = static_cast<long>(now - app.nextFrameAtMs);
    if (lagMs < app.metrics.estimatedDelayMs) {
      return true;
    }

    int skippedDelayMs = 0;
    if (!playGIFFrame(false, skippedDelayMs, nullptr)) {
      return false;
    }

    ++app.metrics.droppedFrames;
    app.nextFrameAtMs += static_cast<unsigned long>(skippedDelayMs);
    app.metrics.noteDelaySample(skippedDelayMs);
    --dropBudget;
  }

  return true;
}

bool renderDueFrame() {
  const unsigned long frameStartMs = app.nextFrameAtMs;
  int delayMs = 0;
  unsigned long renderDurationMs = 0;
  if (!playGIFFrame(true, delayMs, &renderDurationMs)) {
    return false;
  }

  app.metrics.noteRenderedFrame(renderDurationMs);
  app.metrics.noteDelaySample(delayMs);
  app.nextFrameAtMs = frameStartMs + static_cast<unsigned long>(delayMs);
  return true;
}

void tickGIFPlayback() {
  if (!app.playbackEnabled) {
    return;
  }

  if (!app.fsReady || !LittleFS.exists(kGifPath)) {
    closeGIFPlayback();
    if (app.screenNeedsMessage) {
      drawStatusScreen("warte auf upload", "vibeblock gif-upload --gif ...");
      app.screenNeedsMessage = false;
    }
    return;
  }

  if (!openGIFPlayback()) {
    closeGIFPlayback();
    if (app.screenNeedsMessage) {
      drawStatusScreen("gif konnte nicht geoeffnet werden");
      app.screenNeedsMessage = false;
    }
    return;
  }

  unsigned long now = millis();
  if (app.nextFrameAtMs == 0) {
    tft.fillScreen(TFT_BLACK);
    app.nextFrameAtMs = now;
  }
  if (!isPastDeadline(now, app.nextFrameAtMs)) {
    return;
  }

  app.screenNeedsMessage = false;

  if (!catchUpByDroppingFrames()) {
    closeGIFPlayback();
    return;
  }

  now = millis();
  if (!isPastDeadline(now, app.nextFrameAtMs)) {
    return;
  }

  if (!renderDueFrame()) {
    closeGIFPlayback();
  }
}

void emitStatus() {
  const size_t bytes = fileSizeBytes(kGifPath);
  const size_t maxBytes = advertisedBudgetBytes();
  Serial.printf(
      "STATUS board=%s fw=%s fs=%d file=%d bytes=%u maxBytes=%u playing=%d rendered=%lu dropped=%lu avgRenderMs=%u estDelayMs=%d\n",
      kBoardID,
      kFirmwareVersion,
      app.fsReady ? 1 : 0,
      (app.fsReady && LittleFS.exists(kGifPath)) ? 1 : 0,
      static_cast<unsigned int>(bytes),
      static_cast<unsigned int>(maxBytes),
      app.playbackEnabled ? 1 : 0,
      static_cast<unsigned long>(app.metrics.renderedFrames),
      static_cast<unsigned long>(app.metrics.droppedFrames),
      static_cast<unsigned int>(app.metrics.avgRenderMs),
      app.metrics.estimatedDelayMs);
}

bool parsePutSize(const String& line, size_t& out) {
  out = 0;
  if (!line.startsWith("PUT ")) {
    return false;
  }

  String part = line.substring(4);
  part.trim();
  if (part.isEmpty()) {
    return false;
  }

  char* end = nullptr;
  const unsigned long value = strtoul(part.c_str(), &end, 10);
  if (end == nullptr || *end != '\0' || value == 0) {
    return false;
  }

  out = static_cast<size_t>(value);
  return true;
}

bool receiveGIFBytes(size_t expectedBytes, String& reason) {
  reason = "";
  if (!app.fsReady) {
    reason = "fs-unavailable";
    return false;
  }
  if (expectedBytes == 0) {
    reason = "invalid-size";
    return false;
  }
  if (expectedBytes > kMaxGIFBytes) {
    reason = "size-too-large";
    return false;
  }

  if (LittleFS.exists(kGifPath)) {
    LittleFS.remove(kGifPath);
  }

  const size_t budget = writeBudgetBytes();
  if (expectedBytes > budget) {
    reason = "size-too-large";
    return false;
  }

  if (LittleFS.exists(kTempGifPath)) {
    LittleFS.remove(kTempGifPath);
  }

  File temp = LittleFS.open(kTempGifPath, "w");
  if (!temp) {
    reason = "temp-open-failed";
    return false;
  }

  uint8_t chunk[256];
  size_t received = 0;
  unsigned long lastDataAt = millis();

  while (received < expectedBytes) {
    const int available = Serial.available();
    if (available <= 0) {
      if (millis() - lastDataAt > kUploadIdleTimeoutMs) {
        temp.close();
        LittleFS.remove(kTempGifPath);
        reason = "upload-timeout";
        return false;
      }
      delay(1);
      yield();
      continue;
    }

    size_t toRead = expectedBytes - received;
    if (toRead > sizeof(chunk)) {
      toRead = sizeof(chunk);
    }
    if (static_cast<int>(toRead) > available) {
      toRead = static_cast<size_t>(available);
    }

    const int readCount = Serial.readBytes(reinterpret_cast<char*>(chunk), toRead);
    if (readCount <= 0) {
      continue;
    }
    lastDataAt = millis();

    const size_t writeCount = temp.write(chunk, static_cast<size_t>(readCount));
    if (writeCount != static_cast<size_t>(readCount)) {
      temp.close();
      LittleFS.remove(kTempGifPath);
      reason = "write-failed";
      return false;
    }

    received += static_cast<size_t>(readCount);
    yield();
  }

  temp.close();

  int width = 0;
  int height = 0;
  if (!readGIFDimensions(kTempGifPath, width, height)) {
    LittleFS.remove(kTempGifPath);
    reason = "invalid-gif";
    return false;
  }

  if (LittleFS.exists(kGifPath)) {
    LittleFS.remove(kGifPath);
  }
  if (!LittleFS.rename(kTempGifPath, kGifPath)) {
    LittleFS.remove(kTempGifPath);
    reason = "rename-failed";
    return false;
  }

  resetPlaybackState();
  return true;
}

void handleCommand(const String& rawLine) {
  String line = rawLine;
  line.trim();
  if (line.isEmpty()) {
    return;
  }

  if (line.equalsIgnoreCase("HELLO")) {
    Serial.printf(
        "GIF_READY board=%s fw=%s maxBytes=%u\n",
        kBoardID,
        kFirmwareVersion,
        static_cast<unsigned int>(advertisedBudgetBytes()));
    return;
  }

  if (line.equalsIgnoreCase("STATUS")) {
    emitStatus();
    return;
  }

  if (line.equalsIgnoreCase("PLAY")) {
    app.playbackEnabled = true;
    resetPlaybackState();
    Serial.println("PLAY_OK");
    return;
  }

  if (line.equalsIgnoreCase("STOP")) {
    app.playbackEnabled = false;
    closeGIFPlayback();
    Serial.println("STOP_OK");
    return;
  }

  if (line.equalsIgnoreCase("DELETE")) {
    closeGIFPlayback();
    bool removed = false;
    if (app.fsReady && LittleFS.exists(kGifPath)) {
      removed = LittleFS.remove(kGifPath);
    }
    app.screenNeedsMessage = true;
    Serial.printf("DELETE_%s\n", removed ? "OK" : "NOFILE");
    return;
  }

  size_t putBytes = 0;
  if (parsePutSize(line, putBytes)) {
    Serial.println("PUT_READY");

    String reason;
    if (!receiveGIFBytes(putBytes, reason)) {
      Serial.printf("PUT_ERR reason=%s\n", reason.c_str());
      return;
    }

    int width = 0;
    int height = 0;
    const bool hasDimensions = readGIFDimensions(kGifPath, width, height);
    Serial.printf(
        "PUT_OK bytes=%u width=%d height=%d\n",
        static_cast<unsigned int>(putBytes),
        hasDimensions ? width : 0,
        hasDimensions ? height : 0);
    return;
  }

  Serial.println("ERR unknown-command");
}

bool pollSerialCommand(String& outLine) {
  while (Serial.available() > 0) {
    const int raw = Serial.read();
    if (raw < 0) {
      return false;
    }

    const char c = static_cast<char>(raw);
    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      if (commandLen == 0) {
        continue;
      }
      commandBuffer[commandLen] = '\0';
      outLine = String(commandBuffer);
      commandLen = 0;
      return true;
    }

    if (commandLen + 1 >= sizeof(commandBuffer)) {
      commandLen = 0;
      continue;
    }

    commandBuffer[commandLen++] = c;
  }

  return false;
}

void initDisplay() {
#ifdef TFT_BL
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
#endif

  tft.init();
  tft.setRotation(kDisplayRotation);
  tft.fillScreen(TFT_BLACK);
}

void initGIFDecoder() {
  gifDecoder.begin(BIG_ENDIAN_PIXELS);

  const size_t freeHeap = ESP.getFreeHeap();
  if (freeHeap <= (TURBO_BUFFER_SIZE + 8192)) {
    Serial.printf("GIF_TURBO disabled reason=low-heap freeHeap=%u\n",
                  static_cast<unsigned int>(freeHeap));
    return;
  }

  gifTurboBuffer = static_cast<uint8_t*>(malloc(TURBO_BUFFER_SIZE));
  if (gifTurboBuffer == nullptr) {
    Serial.println("GIF_TURBO disabled reason=alloc-failed");
    return;
  }

  gifDecoder.setTurboBuf(gifTurboBuffer);
  Serial.printf("GIF_TURBO enabled bytes=%u freeHeap=%u\n",
                static_cast<unsigned int>(TURBO_BUFFER_SIZE),
                static_cast<unsigned int>(ESP.getFreeHeap()));
}

}  // namespace

void setup() {
  Serial.begin(kSerialBaudRate);
  Serial.setTimeout(1000);
  delay(250);

  initDisplay();
  drawStatusScreen("starte...", "mount littlefs");

  app.fsReady = LittleFS.begin();
  if (!app.fsReady) {
    drawStatusScreen("littlefs mount fehlgeschlagen");
  } else {
    drawStatusScreen("bereit", "send HELLO / PUT <bytes>");
  }

  initGIFDecoder();
  emitStatus();
  Serial.println("vibeblock_gif_ready");
}

void loop() {
  String line;
  if (pollSerialCommand(line)) {
    handleCommand(line);
  }

  tickGIFPlayback();
  yield();
}

#endif  // VIBEBLOCK_GIF_PLAYER
