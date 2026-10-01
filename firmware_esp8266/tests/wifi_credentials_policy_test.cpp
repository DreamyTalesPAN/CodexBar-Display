#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>

// Pins issue #204: a Wi-Fi credential write is confirmed and followed by a
// restart only after EEPROM.commit() reported success. The EEPROM driver
// cannot be faked natively, so the order is checked in the source. Since
// issue #489 credentials are written only over the USB cable.

namespace {

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

std::string functionBody(const std::string& source, const char* signature) {
  const std::size_t start = source.find(signature);
  if (start == std::string::npos) {
    return "";
  }
  const std::size_t end = source.find("\n}\n", start);
  return source.substr(start, end == std::string::npos ? std::string::npos : end - start);
}

bool testSaveConfirmsOnlyAfterVerifiedCommit(const std::string& source) {
  const std::string save = functionBody(source, "bool saveWifiCredentials(");
  const std::size_t configure = source.find("strcmp(op, \"configure-wifi\") == 0");
  const std::size_t check = source.find("!saveWifiCredentials(ssid, password)", configure);
  const std::size_t success = source.find("emitSerialConnectionMode(\"switching\"", check);
  const std::size_t restart = source.find("scheduleReboot(\"wifi_credentials_saved\")", success);
  return expect(save.find("return EEPROM.commit();") != std::string::npos,
                "saveWifiCredentials must return the commit result") &&
         expect(configure != std::string::npos && check != std::string::npos &&
                    success != std::string::npos && restart != std::string::npos,
                "Cable configure-wifi may confirm and restart only after a verified save");
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <path-to-main.cpp>\n", argv[0]);
    return 2;
  }
  const std::string source = readFile(argv[1]);
  if (!expect(!source.empty(), "firmware source must be readable")) {
    return 1;
  }
  bool ok = true;
  ok = testSaveConfirmsOnlyAfterVerifiedCommit(source) && ok;
  if (ok) {
    std::printf("wifi_credentials_policy_test: all checks passed\n");
    return 0;
  }
  return 1;
}
