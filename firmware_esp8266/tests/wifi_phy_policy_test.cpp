#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>

// Pins the device-proven WiFi PHY rule from docs/hardware-contract.md:
// the ESP8266 NONOS stack cannot receive 802.11n A-MSDU aggregates, so every
// radio bring-up must force 802.11g before WiFi.begin()/WiFi.softAP().
// Measured 2026-08-08 on device 14799300 against a FRITZ!Box 7530: under 11n
// the AP intermittently aggregates TCP/UDP frames above ~190 bytes payload and
// the device drops them wholesale (OTA stalls, impossible asset uploads);
// under 11g the same probes pass 8/8.

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

bool testInteropHelperForces11g(const std::string& source) {
  const std::size_t helperStart = source.find("void applyWifiInteropPhyMode() {");
  if (!expect(helperStart != std::string::npos,
              "applyWifiInteropPhyMode must remain discoverable")) {
    return false;
  }
  const std::size_t helperEnd = source.find("\n}", helperStart);
  const std::string helper = source.substr(helperStart, helperEnd - helperStart);
  return expect(
      helper.find("WiFi.setPhyMode(WIFI_PHY_MODE_11G)") != std::string::npos,
      "applyWifiInteropPhyMode must force WIFI_PHY_MODE_11G");
}

bool testEveryRadioBringUpAppliesInteropMode(const std::string& source) {
  const std::string call = "applyWifiInteropPhyMode();";
  bool ok = true;
  for (const char* bringUp : {"WiFi.begin(", "WiFi.softAP("}) {
    std::size_t pos = source.find(bringUp);
    while (pos != std::string::npos) {
      const std::size_t windowStart = pos > 400 ? pos - 400 : 0;
      const std::string window = source.substr(windowStart, pos - windowStart);
      if (!expect(window.find(call) != std::string::npos,
                  "every WiFi.begin/WiFi.softAP bring-up must call "
                  "applyWifiInteropPhyMode() immediately before it")) {
        std::fprintf(stderr, "  offending bring-up at byte offset %zu (%s)\n",
                     pos, bringUp);
        ok = false;
      }
      pos = source.find(bringUp, pos + 1);
    }
  }
  return ok;
}

bool testNoOtherPhyModeSneaksIn(const std::string& source) {
  // Reading the mode (e.g. /health reporting) is fine; setting anything but
  // 11g is not.
  std::size_t pos = source.find("WiFi.setPhyMode(");
  bool ok = expect(pos != std::string::npos, "setPhyMode call must exist");
  while (pos != std::string::npos) {
    const std::string args = source.substr(pos, 64);
    if (!expect(args.find("WIFI_PHY_MODE_11G") != std::string::npos,
                "no code path may set a PHY mode other than 802.11g")) {
      ok = false;
    }
    pos = source.find("WiFi.setPhyMode(", pos + 1);
  }
  return ok;
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
  ok = testInteropHelperForces11g(source) && ok;
  ok = testEveryRadioBringUpAppliesInteropMode(source) && ok;
  ok = testNoOtherPhyModeSneaksIn(source) && ok;
  if (ok) {
    std::printf("wifi_phy_policy_test: all checks passed\n");
    return 0;
  }
  return 1;
}
