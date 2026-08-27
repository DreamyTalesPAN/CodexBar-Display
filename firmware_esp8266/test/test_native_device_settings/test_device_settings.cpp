#include <unity.h>

#include "../../src/device_settings.h"

namespace {

using namespace codexbar_display::esp8266::device_settings;

void test_factory_default_brightness_is_twenty_percent() {
  TEST_ASSERT_EQUAL_UINT8(20, kDefaultBrightnessPercent);
}

void test_missing_settings_fall_back_to_the_default() {
  // A failed read reports -1, an empty settings file reports 0.
  TEST_ASSERT_EQUAL_UINT8(kDefaultBrightnessPercent, BrightnessFromPersistedByte(-1));
  TEST_ASSERT_EQUAL_UINT8(kDefaultBrightnessPercent, BrightnessFromPersistedByte(0));
}

void test_valid_persisted_brightness_survives_unchanged() {
  TEST_ASSERT_EQUAL_UINT8(100, BrightnessFromPersistedByte(100));
  TEST_ASSERT_EQUAL_UINT8(65, BrightnessFromPersistedByte(65));
  TEST_ASSERT_EQUAL_UINT8(20, BrightnessFromPersistedByte(20));
  TEST_ASSERT_EQUAL_UINT8(7, BrightnessFromPersistedByte(7));
  TEST_ASSERT_EQUAL_UINT8(1, BrightnessFromPersistedByte(1));
}

void test_supported_range_covers_one_to_hundred_percent() {
  TEST_ASSERT_EQUAL_UINT8(1, kMinBrightnessPercent);
  TEST_ASSERT_EQUAL_UINT8(100, kMaxBrightnessPercent);
  TEST_ASSERT_EQUAL_UINT8(1, ClampBrightnessPercent(1));
  TEST_ASSERT_EQUAL_UINT8(7, ClampBrightnessPercent(7));
  TEST_ASSERT_EQUAL_UINT8(100, ClampBrightnessPercent(100));
}

void test_out_of_range_requests_clamp_to_the_range() {
  TEST_ASSERT_EQUAL_UINT8(kMinBrightnessPercent, ClampBrightnessPercent(0));
  TEST_ASSERT_EQUAL_UINT8(kMinBrightnessPercent, ClampBrightnessPercent(-40));
  TEST_ASSERT_EQUAL_UINT8(kMaxBrightnessPercent, ClampBrightnessPercent(101));
  TEST_ASSERT_EQUAL_UINT8(kMaxBrightnessPercent, ClampBrightnessPercent(4000));
  TEST_ASSERT_EQUAL_UINT8(kMaxBrightnessPercent, BrightnessFromPersistedByte(255));
}

void test_connection_mode_bytes_decode_without_guessing() {
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kCable),
      static_cast<int>(DecodeConnectionMode(1)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kWifi),
      static_cast<int>(DecodeConnectionMode(2)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kLegacyWifiOnly),
      static_cast<int>(DecodeConnectionMode(3)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kUnspecified),
      static_cast<int>(DecodeConnectionMode(0)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kUnspecified),
      static_cast<int>(DecodeConnectionMode(255)));
}

void test_cutover_migrates_legacy_state_once() {
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kLegacyWifiOnly),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kUnspecified, true)));
  TEST_ASSERT_FALSE(SupportsCable(ConnectionMode::kLegacyWifiOnly));
  TEST_ASSERT_TRUE(UsesWifi(ConnectionMode::kLegacyWifiOnly));
}

void test_factory_fresh_cutover_device_starts_in_cable() {
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kCable),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kUnspecified, false)));
  TEST_ASSERT_TRUE(SupportsCable(ConnectionMode::kCable));
  TEST_ASSERT_FALSE(UsesWifi(ConnectionMode::kCable));
}

void test_sdk_wifi_import_is_only_for_unmigrated_credentials() {
  TEST_ASSERT_TRUE(ShouldImportLegacySdkWifi(
      ConnectionMode::kUnspecified, false));
  TEST_ASSERT_FALSE(ShouldImportLegacySdkWifi(
      ConnectionMode::kUnspecified, true));
  TEST_ASSERT_FALSE(ShouldImportLegacySdkWifi(
      ConnectionMode::kCable, false));
  TEST_ASSERT_FALSE(ShouldImportLegacySdkWifi(
      ConnectionMode::kWifi, false));
  TEST_ASSERT_FALSE(ShouldImportLegacySdkWifi(
      ConnectionMode::kLegacyWifiOnly, false));
}

void test_stored_mode_is_never_reinterpreted() {
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kCable),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kCable, true)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kWifi),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kWifi, false)));
  TEST_ASSERT_EQUAL_STRING("cable", ConnectionModeName(ConnectionMode::kCable));
  TEST_ASSERT_EQUAL_STRING("wifi", ConnectionModeName(ConnectionMode::kWifi));
  TEST_ASSERT_EQUAL_STRING(
      "legacy-wifi-only",
      ConnectionModeName(ConnectionMode::kLegacyWifiOnly));
}

void test_connection_transition_round_trips_both_directions() {
  uint8_t record[kConnectionTransitionRecordBytes] = {};
  ConnectionTransition decoded;

  EncodeConnectionTransition(
      {ConnectionMode::kCable, ConnectionMode::kWifi}, record);
  TEST_ASSERT_TRUE(DecodeConnectionTransition(record, sizeof(record), decoded));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kCable),
      static_cast<int>(decoded.previous));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kWifi),
      static_cast<int>(decoded.target));

  EncodeConnectionTransition(
      {ConnectionMode::kWifi, ConnectionMode::kCable}, record);
  TEST_ASSERT_TRUE(DecodeConnectionTransition(record, sizeof(record), decoded));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kWifi),
      static_cast<int>(decoded.previous));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kCable),
      static_cast<int>(decoded.target));
}

void test_connection_transition_rejects_unsafe_modes_and_corruption() {
  TEST_ASSERT_FALSE(CanBeginConnectionTransition(
      ConnectionMode::kLegacyWifiOnly, ConnectionMode::kCable));
  TEST_ASSERT_FALSE(CanBeginConnectionTransition(
      ConnectionMode::kCable, ConnectionMode::kCable));

  uint8_t record[kConnectionTransitionRecordBytes] = {};
  ConnectionTransition decoded;
  EncodeConnectionTransition(
      {ConnectionMode::kCable, ConnectionMode::kWifi}, record);
  record[0] = 0;
  TEST_ASSERT_FALSE(DecodeConnectionTransition(record, sizeof(record), decoded));
  TEST_ASSERT_FALSE(DecodeConnectionTransition(record, sizeof(record) - 1, decoded));
}

void test_connection_transition_gives_setup_a_bounded_customer_window() {
  TEST_ASSERT_EQUAL_UINT32(
      kConnectionTransitionConfirmationMs,
      ConnectionTransitionTimeoutMs(false));
  TEST_ASSERT_EQUAL_UINT32(
      kConnectionTransitionSetupMs,
      ConnectionTransitionTimeoutMs(true));
  TEST_ASSERT_TRUE(kConnectionTransitionSetupMs > kConnectionTransitionConfirmationMs);
}

}  // namespace

void setUp() {}

void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_factory_default_brightness_is_twenty_percent);
  RUN_TEST(test_missing_settings_fall_back_to_the_default);
  RUN_TEST(test_valid_persisted_brightness_survives_unchanged);
  RUN_TEST(test_supported_range_covers_one_to_hundred_percent);
  RUN_TEST(test_out_of_range_requests_clamp_to_the_range);
  RUN_TEST(test_connection_mode_bytes_decode_without_guessing);
  RUN_TEST(test_cutover_migrates_legacy_state_once);
  RUN_TEST(test_factory_fresh_cutover_device_starts_in_cable);
  RUN_TEST(test_sdk_wifi_import_is_only_for_unmigrated_credentials);
  RUN_TEST(test_stored_mode_is_never_reinterpreted);
  RUN_TEST(test_connection_transition_round_trips_both_directions);
  RUN_TEST(test_connection_transition_rejects_unsafe_modes_and_corruption);
  RUN_TEST(test_connection_transition_gives_setup_a_bounded_customer_window);
  return UNITY_END();
}
