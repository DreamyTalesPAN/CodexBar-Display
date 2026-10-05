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

// Firmware before issue #489 never wrote the classification byte. A VibeTV
// that arrives from it with saved WiFi may have no USB data connection, so it
// stays legacy WiFi: no Cable offer, WiFi setup and updates stay available.
void test_unclassified_wifi_device_stays_legacy_wifi() {
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kLegacyWifiOnly),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kUnspecified, true, false)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kLegacyWifiOnly),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kWifi, true, false)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kLegacyWifiOnly),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kLegacyWifiOnly, true, true)));
  // A WiFi reset keeps it legacy, so VibeTV-Setup stays its way back in.
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kLegacyWifiOnly),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kLegacyWifiOnly, false, true)));
  TEST_ASSERT_FALSE(SupportsCable(ConnectionMode::kLegacyWifiOnly));
  TEST_ASSERT_TRUE(UsesWifi(ConnectionMode::kLegacyWifiOnly));
  TEST_ASSERT_FALSE(CanBeginConnectionTransition(
      ConnectionMode::kLegacyWifiOnly, ConnectionMode::kCable));
}

void test_cable_contact_ends_legacy_wifi_for_good() {
  const auto mode = ModeAfterCableContact(ConnectionMode::kLegacyWifiOnly);
  TEST_ASSERT_EQUAL(static_cast<int>(ConnectionMode::kWifi), static_cast<int>(mode));
  TEST_ASSERT_TRUE(SupportsCable(mode));
  TEST_ASSERT_TRUE(CanBeginConnectionTransition(mode, ConnectionMode::kCable));
  // Classified once, saved WiFi never turns it back into legacy WiFi.
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kWifi),
      static_cast<int>(ResolveInitialConnectionMode(mode, true, true)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kCable),
      static_cast<int>(ModeAfterCableContact(ConnectionMode::kCable)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kWifi),
      static_cast<int>(ModeAfterCableContact(ConnectionMode::kWifi)));
}

void test_factory_fresh_device_is_set_up_over_the_cable() {
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kWifi),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kUnspecified, false, false)));
  TEST_ASSERT_TRUE(SupportsCable(ConnectionMode::kWifi));
  TEST_ASSERT_TRUE(UsesWifi(ConnectionMode::kWifi));
}

void test_sdk_wifi_import_retries_until_credentials_are_saved() {
  TEST_ASSERT_TRUE(ShouldImportLegacySdkWifi(
      ConnectionMode::kUnspecified, false));
  TEST_ASSERT_FALSE(ShouldImportLegacySdkWifi(
      ConnectionMode::kUnspecified, true));
  TEST_ASSERT_FALSE(ShouldImportLegacySdkWifi(
      ConnectionMode::kCable, false));
  // A first boot can persist WiFi mode while its router is unavailable.
  const auto nextBootMode =
      ResolveInitialConnectionMode(ConnectionMode::kUnspecified, false, false);
  TEST_ASSERT_TRUE(ShouldImportLegacySdkWifi(nextBootMode, false));
  TEST_ASSERT_FALSE(ShouldImportLegacySdkWifi(nextBootMode, true));
  TEST_ASSERT_TRUE(ShouldImportLegacySdkWifi(
      ConnectionMode::kLegacyWifiOnly, false));
  TEST_ASSERT_FALSE(ShouldImportLegacySdkWifi(
      ConnectionMode::kLegacyWifiOnly, true));
}

void test_factory_fresh_device_forgets_the_wifi_it_was_flashed_on() {
  TEST_ASSERT_TRUE(ShouldForgetFlashingWifi(false, false));
  TEST_ASSERT_FALSE(ShouldForgetFlashingWifi(true, false));
  TEST_ASSERT_FALSE(ShouldForgetFlashingWifi(false, true));
  TEST_ASSERT_FALSE(ShouldForgetFlashingWifi(true, true));
}

void test_stored_mode_is_never_reinterpreted() {
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kCable),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kCable, true, false)));
  TEST_ASSERT_EQUAL(
      static_cast<int>(ConnectionMode::kWifi),
      static_cast<int>(ResolveInitialConnectionMode(ConnectionMode::kWifi, true, true)));
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

void test_cable_wifi_configuration_accepts_only_cable_or_wifi_setup() {
  TEST_ASSERT_TRUE(CanConfigureWifiOverCable(ConnectionMode::kCable, false));
  TEST_ASSERT_TRUE(CanConfigureWifiOverCable(ConnectionMode::kWifi, true));
  TEST_ASSERT_FALSE(CanConfigureWifiOverCable(ConnectionMode::kWifi, false));
  TEST_ASSERT_FALSE(CanConfigureWifiOverCable(
      ConnectionMode::kLegacyWifiOnly, true));
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
  RUN_TEST(test_unclassified_wifi_device_stays_legacy_wifi);
  RUN_TEST(test_cable_contact_ends_legacy_wifi_for_good);
  RUN_TEST(test_factory_fresh_device_is_set_up_over_the_cable);
  RUN_TEST(test_sdk_wifi_import_retries_until_credentials_are_saved);
  RUN_TEST(test_factory_fresh_device_forgets_the_wifi_it_was_flashed_on);
  RUN_TEST(test_stored_mode_is_never_reinterpreted);
  RUN_TEST(test_connection_transition_round_trips_both_directions);
  RUN_TEST(test_connection_transition_rejects_unsafe_modes_and_corruption);
  RUN_TEST(test_cable_wifi_configuration_accepts_only_cable_or_wifi_setup);
  return UNITY_END();
}
