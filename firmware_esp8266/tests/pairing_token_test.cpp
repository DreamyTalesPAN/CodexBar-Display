#include <cassert>
#include <string>

#include "../src/pairing_token.h"

using codexbar_display::esp8266::PairingTokenResult;
using codexbar_display::esp8266::StoreProvidedPairingToken;

int main() {
  const char* key = "00112233445566778899aabbccddeeff";
  std::string stored;
  int writes = 0;
  const auto save = [&](const char* token) {
    ++writes;
    stored = token;
    return true;
  };
  assert(StoreProvidedPairingToken(key, save) == PairingTokenResult::Stored);
  assert(writes == 1 && stored == key);
  // Authentication after a reload uses exactly the persisted host key.
  const std::string reloaded = stored;
  assert(reloaded == key && reloaded != "ffeeddccbbaa99887766554433221100");

  for (const char* invalid : {"", "short", "00112233445566778899aabbccddeef",
                             "00112233445566778899aabbccddeeff0",
                             "00112233445566778899aabbccddeefg",
                             "00112233445566778899AABBCCDDEEFF"}) {
    assert(StoreProvidedPairingToken(invalid, save) == PairingTokenResult::KeyRequired);
    assert(writes == 1 && stored == key);
  }
  assert(StoreProvidedPairingToken(key, [](const char*) { return false; }) ==
         PairingTokenResult::SaveFailed);
  return 0;
}
