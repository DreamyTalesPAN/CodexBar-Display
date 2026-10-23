#include <algorithm>
#include <cassert>
#include <cstdint>
#include <map>
#include <string>

// Only Arduino's storage boundary is faked. The test script extracts the actual
// validation and persistence functions from main.cpp into this translation unit.
struct String : std::string {
  using std::string::string;
  char charAt(size_t index) const { return at(index); }
};

struct FakeFS;
struct File {
  FakeFS* fs;
  std::string path;
  explicit operator bool() const { return fs != nullptr; }
  size_t write(const uint8_t* bytes, size_t size);
  size_t print(const String& value) {
    return write(reinterpret_cast<const uint8_t*>(value.c_str()), value.length());
  }
  void close() {}
};

struct FakeFS {
  std::map<std::string, std::string> files;
  size_t writeLimit = 64;
  bool openOK = true;
  bool renameOK = true;
  bool begin() { return true; }
  File open(const char* path, const char*) {
    if (!openOK) return {nullptr, path};
    files[path].clear();
    return {this, path};
  }
  bool rename(const char* from, const char* to) {
    if (!renameOK) return false;
    files[to] = files.at(from);
    files.erase(from);
    return true;
  }
  bool remove(const char* path) { return files.erase(path) != 0; }
} LittleFS;

size_t File::write(const uint8_t* bytes, size_t size) {
  const size_t written = std::min(size, fs->writeLimit);
  fs->files[path].append(reinterpret_cast<const char*>(bytes), written);
  return written;
}

constexpr const char* kDeviceAuthTokenPath = "/auth";
String deviceAuthToken;
#include "pairing_storage_functions.inc"

int main() {
  const String key = "00112233445566778899aabbccddeeff";
  for (const String& previous : {String(""), String("legacy-key-kept-on-device")}) {
    for (int failure = 0; failure < 4; ++failure) {
      LittleFS = {};
      deviceAuthToken = previous;
      if (!previous.empty()) LittleFS.files[kDeviceAuthTokenPath] = previous;
      const auto before = LittleFS.files;
      if (failure == 0) LittleFS.writeLimit = 0;
      if (failure == 1) LittleFS.writeLimit = 16;
      if (failure == 2) LittleFS.openOK = false;
      if (failure == 3) LittleFS.renameOK = false;
      assert(!saveDeviceAuthToken(key));
      assert(deviceAuthToken == previous);
      assert(LittleFS.files == before);

      // The same explicit pairing can succeed after storage recovers.
      LittleFS.writeLimit = 64;
      LittleFS.openOK = LittleFS.renameOK = true;
      assert(saveDeviceAuthToken(key));
      assert(deviceAuthToken == key);
      assert(LittleFS.files.size() == 1);
      assert(LittleFS.files.at(kDeviceAuthTokenPath) == key);
    }
  }
}
