#include <unity.h>

#include <cstdio>
#include <cstdlib>

#include "../../src/wifi_setup_portal.cpp"

namespace {

using namespace codexbar_display::esp8266::wifi_setup;

bool contains(const String& haystack, const char* needle) {
  return haystack.find(needle) != String::npos;
}

void test_scan_filters_deduplicates_and_sorts() {
  State state;
  TEST_ASSERT_TRUE(BeginScan(state));
  TEST_ASSERT_FALSE(AddScanResult(state, "FiveGHz", -30, 36));
  TEST_ASSERT_TRUE(AddScanResult(state, "Weak", -82, 1));
  TEST_ASSERT_TRUE(AddScanResult(state, "Home", -67, 6));
  TEST_ASSERT_TRUE(AddScanResult(state, "Strong", -48, 11));
  TEST_ASSERT_TRUE(AddScanResult(state, "Home", -55, 1));
  FinishScan(state, 5);

  TEST_ASSERT_EQUAL_UINT8(3, state.networkCount);
  TEST_ASSERT_EQUAL_STRING("Strong", state.networks[0].ssid);
  TEST_ASSERT_EQUAL_STRING("Home", state.networks[1].ssid);
  TEST_ASSERT_EQUAL_INT(-55, state.networks[1].rssi);
  TEST_ASSERT_EQUAL_STRING("Weak", state.networks[2].ssid);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ScanStatus::Ready), static_cast<int>(state.scanStatus));
}

void test_scan_keeps_only_ten_strongest_networks() {
  State state;
  TEST_ASSERT_TRUE(BeginScan(state));
  for (int i = 0; i < 10; ++i) {
    const String ssid = String("Network-") + String(i);
    TEST_ASSERT_TRUE(AddScanResult(state, ssid, -50 - i, 1 + (i % 11)));
  }
  TEST_ASSERT_FALSE(AddScanResult(state, "Too weak", -95, 6));
  TEST_ASSERT_TRUE(AddScanResult(state, "New strongest", -20, 6));
  FinishScan(state, 12);

  TEST_ASSERT_EQUAL_UINT8(kMaxNetworks, state.networkCount);
  TEST_ASSERT_EQUAL_STRING("New strongest", state.networks[0].ssid);
  TEST_ASSERT_FALSE(contains(BuildNetworkOptionsHTML(state), "Too weak"));
}

void test_signal_labels_use_traffic_lights() {
  TEST_ASSERT_EQUAL_STRING("🟢", SignalLabel(-60));
  TEST_ASSERT_EQUAL_STRING("🟡", SignalLabel(-61));
  TEST_ASSERT_EQUAL_STRING("🟡", SignalLabel(-75));
  TEST_ASSERT_EQUAL_STRING("🔴", SignalLabel(-76));
}

void test_wifi_statuses_map_to_retryable_errors() {
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ConnectionError::WrongPassword),
      static_cast<int>(ConnectionErrorFromWifiStatus(WL_WRONG_PASSWORD)));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ConnectionError::WrongPassword),
      static_cast<int>(ConnectionErrorFromWifiStatus(WL_CONNECT_FAILED)));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ConnectionError::NetworkNotFound),
      static_cast<int>(ConnectionErrorFromWifiStatus(WL_NO_SSID_AVAIL)));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ConnectionError::ConnectionFailed),
      static_cast<int>(ConnectionErrorFromWifiStatus(WL_IDLE_STATUS)));
}

void test_options_escape_ssids_and_stay_inside_budget() {
  State state;
  TEST_ASSERT_TRUE(BeginScan(state));
  TEST_ASSERT_TRUE(AddScanResult(state, "Home<&\"", -40, 6));
  for (int i = 0; i < 9; ++i) {
    const String ssid = String("Long network name ") + String(i);
    TEST_ASSERT_TRUE(AddScanResult(state, ssid, -50 - i, 1));
  }
  FinishScan(state, 10);
  const String html = BuildNetworkOptionsHTML(state);

  TEST_ASSERT_LESS_OR_EQUAL_UINT32(kMaxOptionsHtmlBytes, html.length());
  TEST_ASSERT_TRUE(contains(html, "Home&lt;&amp;&quot;"));
  TEST_ASSERT_FALSE(contains(html, "2.4 GHz compatible"));
  TEST_ASSERT_TRUE(contains(html, "🟢"));
  TEST_ASSERT_FALSE(contains(html, "Strong signal"));
}

void test_page_uses_inline_band_guidance_and_links_to_public_support() {
  State state;
  TEST_ASSERT_TRUE(BeginScan(state));
  TEST_ASSERT_TRUE(AddScanResult(state, "Home", -45, 6));
  FinishScan(state, 1);
  SetConnectionError(state, ConnectionError::WrongPassword, "Home");

  ESP8266WebServer server;
  SendSetupPage(server, state, kSupportUrl, "192.168.4.1");

  TEST_ASSERT_EQUAL_INT(200, server.status);
  TEST_ASSERT_FALSE(contains(server.output, "Choose a 2.4 GHz Wi-Fi network."));
  TEST_ASSERT_TRUE(contains(server.output, "Only 2.4 GHz networks are shown."));
  TEST_ASSERT_TRUE(contains(server.output, "aria-describedby=\"setup-status wifi-band-help\""));
  TEST_ASSERT_FALSE(contains(server.output, "VibeTV Setup"));
  TEST_ASSERT_TRUE(contains(server.output, "Search again"));
  TEST_ASSERT_TRUE(contains(server.output, "Searching…"));
  TEST_ASSERT_TRUE(server.output.find("Connect</button>") < server.output.find("Search again</button>"));
  TEST_ASSERT_EQUAL_STRING("https://www.vibetv.shop/setup", kSupportUrl);
  TEST_ASSERT_TRUE(contains(server.output, "https://www.vibetv.shop/setup"));
  TEST_ASSERT_TRUE(contains(server.output, "target=\"_blank\" rel=\"noopener noreferrer\""));
  TEST_ASSERT_TRUE(contains(server.output, "Troubleshooting: www.vibetv.shop/setup"));
  TEST_ASSERT_FALSE(contains(server.output, "location.hostname==='captive.apple.com'"));
  TEST_ASSERT_FALSE(contains(server.output, "support-note"));
  TEST_ASSERT_FALSE(contains(server.output, "Close this setup window and disconnect from VibeTV-Setup."));
  TEST_ASSERT_FALSE(contains(server.output, "My Wi-Fi isn't shown"));
  TEST_ASSERT_TRUE(contains(server.output, "Check the password and try again."));
  TEST_ASSERT_FALSE(contains(server.output, "Smart Connect"));
  TEST_ASSERT_FALSE(contains(server.output, "Band Steering"));
  TEST_ASSERT_FALSE(contains(server.output, "5 GHz"));
  TEST_ASSERT_FALSE(contains(server.output, "compatible"));
}

void test_page_publishes_no_placeholder_without_support_url() {
  State state;
  TEST_ASSERT_TRUE(BeginScan(state));
  FinishScan(state, 0);

  ESP8266WebServer server;
  SendSetupPage(server, state, nullptr, "192.168.4.1");

  TEST_ASSERT_TRUE(contains(server.output, "No networks found."));
  TEST_ASSERT_FALSE(contains(server.output, "Troubleshooting:"));
  TEST_ASSERT_FALSE(contains(server.output, "href=\"\""));
}

void test_generic_reconnect_error_does_not_render_an_empty_ssid() {
  State state;
  BeginScan(state);
  FinishScan(state, 0);
  SetConnectionError(state, ConnectionError::ConnectionFailed);

  ESP8266WebServer server;
  SendSetupPage(server, state, nullptr, "192.168.4.1");

  TEST_ASSERT_TRUE(contains(server.output, "Could not reconnect to Wi-Fi."));
  TEST_ASSERT_FALSE(contains(server.output, "<strong></strong>"));
}

}  // namespace

void setUp() {}
void tearDown() {}

int main(int, char**) {
  if (std::getenv("VIBETV_WIFI_SETUP_PREVIEW") != nullptr) {
    State state;
    BeginScan(state);
    AddScanResult(state, "Studio WiFi", -47, 6);
    AddScanResult(state, "Home", -66, 11);
    AddScanResult(state, "Guest", -81, 1);
    FinishScan(state, 3);
    ESP8266WebServer server;
    SendSetupPage(server, state, kSupportUrl, "192.168.4.1");
    std::fwrite(server.output.data(), 1, server.output.size(), stdout);
    return 0;
  }

  UNITY_BEGIN();
  RUN_TEST(test_scan_filters_deduplicates_and_sorts);
  RUN_TEST(test_scan_keeps_only_ten_strongest_networks);
  RUN_TEST(test_signal_labels_use_traffic_lights);
  RUN_TEST(test_wifi_statuses_map_to_retryable_errors);
  RUN_TEST(test_options_escape_ssids_and_stay_inside_budget);
  RUN_TEST(test_page_uses_inline_band_guidance_and_links_to_public_support);
  RUN_TEST(test_page_publishes_no_placeholder_without_support_url);
  RUN_TEST(test_generic_reconnect_error_does_not_render_an_empty_ssid);
  return UNITY_END();
}
