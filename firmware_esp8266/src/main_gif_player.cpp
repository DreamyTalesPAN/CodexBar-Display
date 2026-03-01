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

TFT_eSPI tft = TFT_eSPI();
AnimatedGIF gifDecoder;
File gifFile;

char commandBuffer[kCommandBufferBytes];
size_t commandLen = 0;

uint16_t gifLineBuffer[kGIFLineBufferPixels];
uint8_t* gifTurboBuffer = nullptr;
bool fsReady = false;
bool playbackEnabled = true;
bool gifOpen = false;
bool screenNeedsMessage = true;
unsigned long nextFrameAtMs = 0;
int gifWidth = 0;
int gifHeight = 0;
int gifOffsetX = 0;
int gifOffsetY = 0;
bool frameStreamActive = false;
int frameStreamX = 0;
int frameStreamY = 0;
int frameStreamWidth = 0;
int frameStreamHeight = 0;

bool readGIFDimensions(const char* path, int& width, int& height) {
  width = 0;
  height = 0;
  if (!fsReady || path == nullptr) {
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

size_t fileSizeBytes(const char* path) {
  if (!fsReady || path == nullptr || !LittleFS.exists(path)) {
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
  if (!fsReady) {
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
  if (gifOpen) {
    gifDecoder.close();
  }
  gifOpen = false;
  frameStreamActive = false;
  nextFrameAtMs = 0;
}

void resetPlaybackState() {
  closeGIFPlayback();
  screenNeedsMessage = true;
}

void* GIFOpenFileCallback(const char* filename, int32_t* pFileSize) {
  if (!fsReady || filename == nullptr || pFileSize == nullptr) {
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

void GIFDrawCallback(GIFDRAW* pDraw) {
  if (pDraw == nullptr) {
    return;
  }
  const int frameX = gifOffsetX + pDraw->iX;
  const int frameY = gifOffsetY + pDraw->iY;
  if (pDraw->y == 0) {
    frameStreamActive = false;
    if (!pDraw->ucHasTransparency && frameX >= 0 && frameY >= 0 &&
        frameX + pDraw->iWidth <= tft.width() &&
        frameY + pDraw->iHeight <= tft.height() &&
        pDraw->iWidth > 0 && pDraw->iHeight > 0) {
      frameStreamActive = true;
      frameStreamX = frameX;
      frameStreamY = frameY;
      frameStreamWidth = pDraw->iWidth;
      frameStreamHeight = pDraw->iHeight;
      tft.setAddrWindow(frameStreamX, frameStreamY, frameStreamWidth, frameStreamHeight);
    }
  }

  int lineWidth = pDraw->iWidth;
  if (lineWidth <= 0) {
    return;
  }
  if (lineWidth > kGIFLineBufferPixels) {
    lineWidth = kGIFLineBufferPixels;
  }
  int drawX = gifOffsetX + pDraw->iX;
  int drawY = gifOffsetY + pDraw->iY + pDraw->y;
  if (drawY < 0 || drawY >= tft.height()) {
    return;
  }
  if (drawX >= tft.width()) {
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
    frameStreamActive = false;
    const uint8_t transparent = pDraw->ucTransparent;
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
    return;
  }

  for (int i = 0; i < lineWidth; ++i) {
    gifLineBuffer[i] = palette[src[i]];
  }
  const bool canStreamLine =
      frameStreamActive &&
      srcOffset == 0 &&
      drawX == frameStreamX &&
      lineWidth == frameStreamWidth &&
      drawY >= frameStreamY &&
      drawY < (frameStreamY + frameStreamHeight);

  if (canStreamLine) {
    tft.pushPixels(gifLineBuffer, lineWidth);
    if (drawY == frameStreamY + frameStreamHeight - 1) {
      frameStreamActive = false;
    }
    return;
  }

  frameStreamActive = false;
  tft.setAddrWindow(drawX, drawY, lineWidth, 1);
  tft.pushPixels(gifLineBuffer, lineWidth);
}

bool openGIFPlayback() {
  if (!fsReady || !LittleFS.exists(kGifPath)) {
    return false;
  }
  if (gifOpen) {
    return true;
  }
  if (!readGIFDimensions(kGifPath, gifWidth, gifHeight)) {
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
  gifOffsetX = (tft.width() - gifWidth) / 2;
  gifOffsetY = (tft.height() - gifHeight) / 2;
  if (gifOffsetX < 0) {
    gifOffsetX = 0;
  }
  if (gifOffsetY < 0) {
    gifOffsetY = 0;
  }
  gifOpen = true;
  nextFrameAtMs = 0;
  return true;
}

void tickGIFPlayback() {
  if (!playbackEnabled) {
    return;
  }
  if (!fsReady || !LittleFS.exists(kGifPath)) {
    closeGIFPlayback();
    if (screenNeedsMessage) {
      drawStatusScreen("warte auf upload", "vibeblock gif-upload --gif ...");
      screenNeedsMessage = false;
    }
    return;
  }
  if (!openGIFPlayback()) {
    closeGIFPlayback();
    if (screenNeedsMessage) {
      drawStatusScreen("gif konnte nicht geoeffnet werden");
      screenNeedsMessage = false;
    }
    return;
  }

  const unsigned long now = millis();
  if (nextFrameAtMs != 0 &&
      static_cast<long>(now - nextFrameAtMs) < 0) {
    return;
  }

  if (nextFrameAtMs == 0) {
    tft.fillScreen(TFT_BLACK);
  }
  screenNeedsMessage = false;

  const unsigned long frameStartMs = now;
  int delayMs = 0;
  tft.startWrite();
  bool played = gifDecoder.playFrame(false, &delayMs, nullptr);
  tft.endWrite();
  if (!played) {
    gifDecoder.reset();
    tft.startWrite();
    played = gifDecoder.playFrame(false, &delayMs, nullptr);
    tft.endWrite();
    if (!played) {
      closeGIFPlayback();
      return;
    }
  }
  if (delayMs < kMinGIFFrameDelayMs) {
    delayMs = kMinGIFFrameDelayMs;
  }
  // Schedule based on frame start time so render cost is not added on top.
  nextFrameAtMs = frameStartMs + static_cast<unsigned long>(delayMs);
}

void emitStatus() {
  const size_t bytes = fileSizeBytes(kGifPath);
  const size_t maxBytes = advertisedBudgetBytes();
  Serial.printf(
      "STATUS board=%s fw=%s fs=%d file=%d bytes=%u maxBytes=%u playing=%d\n",
      kBoardID,
      kFirmwareVersion,
      fsReady ? 1 : 0,
      (fsReady && LittleFS.exists(kGifPath)) ? 1 : 0,
      static_cast<unsigned int>(bytes),
      static_cast<unsigned int>(maxBytes),
      playbackEnabled ? 1 : 0);
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
  if (!fsReady) {
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
    playbackEnabled = true;
    resetPlaybackState();
    Serial.println("PLAY_OK");
    return;
  }
  if (line.equalsIgnoreCase("STOP")) {
    playbackEnabled = false;
    closeGIFPlayback();
    Serial.println("STOP_OK");
    return;
  }
  if (line.equalsIgnoreCase("DELETE")) {
    closeGIFPlayback();
    bool removed = false;
    if (fsReady && LittleFS.exists(kGifPath)) {
      removed = LittleFS.remove(kGifPath);
    }
    screenNeedsMessage = true;
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

}  // namespace

void setup() {
  Serial.begin(kSerialBaudRate);
  Serial.setTimeout(1000);
  delay(250);

  initDisplay();
  drawStatusScreen("starte...", "mount littlefs");

  fsReady = LittleFS.begin();
  if (!fsReady) {
    drawStatusScreen("littlefs mount fehlgeschlagen");
  } else {
    drawStatusScreen("bereit", "send HELLO / PUT <bytes>");
  }

  gifDecoder.begin(BIG_ENDIAN_PIXELS);
  const size_t freeHeap = ESP.getFreeHeap();
  if (freeHeap > (TURBO_BUFFER_SIZE + 8192)) {
    gifTurboBuffer = static_cast<uint8_t*>(malloc(TURBO_BUFFER_SIZE));
    if (gifTurboBuffer != nullptr) {
      gifDecoder.setTurboBuf(gifTurboBuffer);
      Serial.printf("GIF_TURBO enabled bytes=%u freeHeap=%u\n",
                    static_cast<unsigned int>(TURBO_BUFFER_SIZE),
                    static_cast<unsigned int>(ESP.getFreeHeap()));
    } else {
      Serial.println("GIF_TURBO disabled reason=alloc-failed");
    }
  } else {
    Serial.printf("GIF_TURBO disabled reason=low-heap freeHeap=%u\n",
                  static_cast<unsigned int>(freeHeap));
  }
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
