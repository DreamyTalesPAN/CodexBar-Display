#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>

#include "../src/wifi_known_networks.h"

namespace wk = codexbar_display::esp8266::wifi_known;

namespace {

bool expect(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    return false;
  }
  return true;
}

std::string ssids(const wk::List& list) {
  std::string out;
  for (uint8_t i = 0; i < list.count; ++i) {
    out += (i > 0 ? "," : "");
    out += list.items[i].ssid;
  }
  return out;
}

bool testRememberOrdersByRecentUseAndUpdatesInPlace() {
  wk::List list;
  wk::Remember(list, "home", "h1");
  wk::Remember(list, "office", "o1");
  if (!expect(ssids(list) == "office,home", "a new network goes first")) {
    return false;
  }
  // Saving an SSID again updates its password instead of adding a duplicate.
  wk::Remember(list, "home", "h2");
  return expect(ssids(list) == "home,office", "a known SSID moves first, once") &&
         expect(std::strcmp(list.items[0].password, "h2") == 0, "its password is updated");
}

bool testFullListDropsTheLeastRecentlyUsed() {
  wk::List list;
  for (const char* ssid : {"a", "b", "c", "d", "e"}) {
    wk::Remember(list, ssid, "pw");
  }
  return expect(list.count == wk::kMaxNetworks, "the list stays bounded") &&
         expect(ssids(list) == "e,d,c,b", "the oldest network drops out");
}

bool testForgetAndRejectedInput() {
  wk::List list;
  wk::Remember(list, "home", "h");
  wk::Remember(list, "office", "o");
  const std::string tooLong(wk::kSsidBytes, 's');
  return expect(wk::Forget(list, "home") && ssids(list) == "office", "forget removes one network") &&
         expect(!wk::Forget(list, "missing"), "forgetting an unknown SSID changes nothing") &&
         expect(!wk::Remember(list, "", "x") && !wk::Remember(list, tooLong.c_str(), "x"),
                "an empty or oversized SSID is not remembered") &&
         expect(ssids(list) == "office", "rejected input leaves the list alone");
}

bool testEncodingRoundTripsAndRejectsCorruption() {
  wk::List list;
  wk::Remember(list, "home", "secret");
  wk::Remember(list, "office", "");
  uint8_t bytes[wk::kEncodedBytes];
  wk::Encode(list, bytes);
  wk::List decoded;
  if (!expect(wk::Decode(bytes, sizeof(bytes), decoded) && ssids(decoded) == "office,home" &&
                  std::strcmp(decoded.items[1].password, "secret") == 0,
              "an encoded list decodes to the same networks")) {
    return false;
  }
  uint8_t corrupt[wk::kEncodedBytes];
  std::memcpy(corrupt, bytes, sizeof(bytes));
  corrupt[0] ^= 0xFF;
  bool ok = expect(!wk::Decode(corrupt, sizeof(corrupt), decoded) && decoded.count == 0,
                   "a wrong magic decodes to nothing");
  std::memcpy(corrupt, bytes, sizeof(bytes));
  corrupt[4] = wk::kMaxNetworks + 1;
  ok = expect(!wk::Decode(corrupt, sizeof(corrupt), decoded), "an impossible count is rejected") && ok;
  std::memcpy(corrupt, bytes, sizeof(bytes));
  std::memset(corrupt + 5, 'x', wk::kSsidBytes);
  ok = expect(!wk::Decode(corrupt, sizeof(corrupt), decoded), "an unterminated SSID is rejected") && ok;
  return expect(!wk::Decode(bytes, sizeof(bytes) - 1, decoded), "a short record is rejected") && ok;
}

bool testCandidatesAreVisibleNetworksStrongestFirst() {
  wk::List list;
  for (const char* ssid : {"far", "near", "gone", "mid"}) {
    wk::Remember(list, ssid, "pw");
  }
  // list order: mid, gone, near, far
  const int32_t seen[] = {-70, wk::kNotSeen, -40, -85};
  uint8_t order[wk::kMaxNetworks] = {0};
  const uint8_t count = wk::Candidates(list, seen, order);
  return expect(count == 3, "an unseen network is not tried") &&
         expect(std::strcmp(list.items[order[0]].ssid, "near") == 0 &&
                    std::strcmp(list.items[order[1]].ssid, "mid") == 0 &&
                    std::strcmp(list.items[order[2]].ssid, "far") == 0,
                "visible networks are tried strongest first");
}

std::size_t countOf(const std::string& source, const char* needle) {
  std::size_t count = 0;
  for (std::size_t at = source.find(needle); at != std::string::npos; at = source.find(needle, at + 1)) {
    ++count;
  }
  return count;
}

std::string functionBody(const std::string& source, const char* signature) {
  const std::size_t start = source.find(signature);
  if (start == std::string::npos) {
    return "";
  }
  const std::size_t end = source.find("\n}\n", start);
  return source.substr(start, end == std::string::npos ? std::string::npos : end - start);
}

// The EEPROM and LittleFS drivers cannot run natively, so the wiring is
// checked in the source: reset forgets every network (and a half-written
// list), a save keeps the one it replaces, and boot falls back to the
// remembered ones before setup -- only behind a current network and never
// during a switch to new credentials, which keeps its own rollback.
bool testFirmwareWiring(const std::string& source) {
  const std::string clear = functionBody(source, "bool clearWifiCredentials() {");
  const std::string forget = functionBody(source, "bool forgetKnownWifiNetworks() {");
  const std::string save = functionBody(source, "bool saveWifiCredentials(");
  const std::size_t boot = source.find(
      "  if (!wifiConnected && hasSavedWifi) {\n"
      "    wifiConnected = connectToSavedWifi(savedWifiCredentials) ||\n"
      "                    (!connectionTransitionPending && connectToKnownWifi());\n"
      "  }");
  const std::size_t setupAp = source.find("enterWifiSetup();", boot);
  return expect(clear.find("forgetKnownWifiNetworks()") != std::string::npos,
                "Reset WiFi must forget every remembered network") &&
         expect(forget.find("LittleFS.remove(kKnownWifiTemporaryPath)") != std::string::npos,
                "Reset WiFi must also drop a list a power cut left half-written") &&
         expect(save.find("rememberReplacedWifiNetwork(ssid)") < save.find("EEPROM.put(0, kWifiCredsMagic)"),
                "saving a network must first remember the one it replaces") &&
         expect(boot != std::string::npos && setupAp != std::string::npos &&
                    countOf(source, "connectToKnownWifi()") == 2,  // its definition and that one call
                "boot must try remembered networks only after the current one, outside a switch, before setup");
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <path-to-main.cpp>\n", argv[0]);
    return 2;
  }
  std::ifstream input(argv[1]);
  const std::string source((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
  bool ok = true;
  ok = testRememberOrdersByRecentUseAndUpdatesInPlace() && ok;
  ok = testFullListDropsTheLeastRecentlyUsed() && ok;
  ok = testForgetAndRejectedInput() && ok;
  ok = testEncodingRoundTripsAndRejectsCorruption() && ok;
  ok = testCandidatesAreVisibleNetworksStrongestFirst() && ok;
  ok = testFirmwareWiring(source) && ok;
  if (ok) {
    std::printf("wifi_known_networks_test: all checks passed\n");
    return 0;
  }
  return 1;
}
