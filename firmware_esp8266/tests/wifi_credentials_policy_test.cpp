#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>

// Pins issue #204: a Wi-Fi credential write is confirmed and followed by a
// restart only after EEPROM.commit() reported success. The EEPROM driver
// cannot be faked natively, so the order is checked in the source.

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

bool testClearReportsCommitResult(const std::string& source) {
  const std::string clear = functionBody(source, "bool clearWifiCredentials() {");
  return expect(!clear.empty(), "clearWifiCredentials must return bool") &&
         expect(clear.find("if (!EEPROM.commit())") != std::string::npos,
                "clearWifiCredentials must check EEPROM.commit()") &&
         expect(clear.find("return false;") != std::string::npos,
                "clearWifiCredentials must report a failed commit");
}

bool testResetConfirmsOnlyAfterVerifiedClear(const std::string& source) {
  const std::string reset = functionBody(source, "void handleResetWifi() {");
  const std::size_t clear = reset.find("if (!clearWifiCredentials())");
  const std::size_t failure = reset.find("webServer.send(500", clear);
  const std::size_t success = reset.find("webServer.send(200");
  const std::size_t restart = reset.find("ESP.restart()");
  return expect(clear != std::string::npos,
                "handleResetWifi must check the clear result") &&
         expect(failure != std::string::npos && failure < success,
                "a failed clear must answer 500 before any success") &&
         expect(success != std::string::npos && clear < success && success < restart,
                "handleResetWifi may confirm and restart only after a verified clear");
}

bool testSaveConfirmsOnlyAfterVerifiedCommit(const std::string& source) {
  const std::string save = functionBody(source, "bool saveWifiCredentials(");
  const std::string handler = functionBody(source, "void handleSaveWifi() {");
  const std::size_t check = handler.find("if (!saveWifiCredentials(ssid, password))");
  const std::size_t success = handler.find("webServer.send(200");
  const std::size_t restart = handler.find("ESP.restart()");
  return expect(save.find("return EEPROM.commit();") != std::string::npos,
                "saveWifiCredentials must return the commit result") &&
         expect(check != std::string::npos && check < success && success < restart,
                "handleSaveWifi may confirm and restart only after a verified save");
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
  ok = testClearReportsCommitResult(source) && ok;
  ok = testResetConfirmsOnlyAfterVerifiedClear(source) && ok;
  ok = testSaveConfirmsOnlyAfterVerifiedCommit(source) && ok;
  if (ok) {
    std::printf("wifi_credentials_policy_test: all checks passed\n");
    return 0;
  }
  return 1;
}
