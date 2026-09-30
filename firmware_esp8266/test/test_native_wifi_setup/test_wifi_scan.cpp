#include <unity.h>

#include "../../src/wifi_scan.h"

namespace {

using namespace codexbar_display::esp8266::wifi_scan;

void test_scan_filters_deduplicates_and_sorts() {
  State state;
  TEST_ASSERT_TRUE(BeginScan(state));
  TEST_ASSERT_FALSE(AddScanResult(state, "FiveGHz", -30, 36));
  TEST_ASSERT_TRUE(AddScanResult(state, "Weak", -82, 1));
  TEST_ASSERT_TRUE(AddScanResult(state, "Home", -67, 6));
  TEST_ASSERT_TRUE(AddScanResult(state, "Strong", -48, 11, false));
  TEST_ASSERT_TRUE(AddScanResult(state, "Home", -55, 1));
  FinishScan(state, 5);

  TEST_ASSERT_EQUAL_UINT8(3, state.networkCount);
  TEST_ASSERT_EQUAL_STRING("Strong", state.networks[0].ssid);
  TEST_ASSERT_FALSE(state.networks[0].encrypted);
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
  for (uint8_t i = 0; i < state.networkCount; ++i) {
    TEST_ASSERT_TRUE(String(state.networks[i].ssid) != "Too weak");
  }
}

void test_scan_runs_one_at_a_time_and_reports_its_outcome() {
  State state;
  TEST_ASSERT_TRUE(BeginScan(state));
  TEST_ASSERT_FALSE(BeginScan(state));
  FinishScan(state, 0);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ScanStatus::Empty), static_cast<int>(state.scanStatus));

  TEST_ASSERT_TRUE(BeginScan(state));
  FinishScan(state, -1);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ScanStatus::Failed), static_cast<int>(state.scanStatus));
}

}  // namespace

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_scan_filters_deduplicates_and_sorts);
  RUN_TEST(test_scan_keeps_only_ten_strongest_networks);
  RUN_TEST(test_scan_runs_one_at_a_time_and_reports_its_outcome);
  return UNITY_END();
}
