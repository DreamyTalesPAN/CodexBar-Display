#include <unity.h>

#include <string.h>

#include "../../src/asset_path_policy.h"
#include "../../src/standby_settings.h"

namespace {

using namespace codexbar_display::esp8266::standby;
using codexbar_display::esp8266::AssetPathPolicy;

Settings withPath(const char* path) {
  Settings settings;
  SetScreensaverPath(settings, path, strlen(path));
  return settings;
}

void test_factory_defaults_are_off_ten_minutes_and_twenty_percent() {
  const Settings settings;
  TEST_ASSERT_FALSE(settings.enabled);
  TEST_ASSERT_EQUAL_UINT8(10, settings.timeoutMinutes);
  TEST_ASSERT_EQUAL_UINT8(20, settings.brightnessPercent);
  TEST_ASSERT_FALSE(HasScreensaver(settings));
}

void test_timeout_clamps_to_the_supported_range() {
  TEST_ASSERT_EQUAL_UINT8(kMinTimeoutMinutes, ClampTimeoutMinutes(0));
  TEST_ASSERT_EQUAL_UINT8(kMinTimeoutMinutes, ClampTimeoutMinutes(-5));
  TEST_ASSERT_EQUAL_UINT8(kMaxTimeoutMinutes, ClampTimeoutMinutes(9999));
  TEST_ASSERT_EQUAL_UINT8(10, ClampTimeoutMinutes(10));
  TEST_ASSERT_EQUAL_UINT8(240, ClampTimeoutMinutes(240));
}

void test_standby_brightness_uses_the_shared_display_range() {
  TEST_ASSERT_EQUAL_UINT8(1, ClampBrightnessPercent(0));
  TEST_ASSERT_EQUAL_UINT8(100, ClampBrightnessPercent(255));
  TEST_ASSERT_EQUAL_UINT8(20, ClampBrightnessPercent(20));
}

void test_only_screensaver_slot_paths_are_accepted() {
  TEST_ASSERT_TRUE(ScreensaverPathValid("/themes/s/clock.json", strlen("/themes/s/clock.json")));
  TEST_ASSERT_FALSE(ScreensaverPathValid("/themes/u/clock.json", strlen("/themes/u/clock.json")));
  TEST_ASSERT_FALSE(ScreensaverPathValid("/themes/clock.json", strlen("/themes/clock.json")));
  TEST_ASSERT_FALSE(ScreensaverPathValid("/assets/clock.json", 18));
  TEST_ASSERT_FALSE(ScreensaverPathValid("/themes/s/", strlen("/themes/s/")));
  TEST_ASSERT_FALSE(ScreensaverPathValid("", 0));
  TEST_ASSERT_FALSE(ScreensaverPathValid(nullptr, 0));
}

void test_live_slot_paths_exclude_the_screensaver_directory() {
  TEST_ASSERT_TRUE(AssetPathPolicy::IsLiveThemeSpecPath(
      "/themes/u/clock.json", strlen("/themes/u/clock.json")));
  TEST_ASSERT_TRUE(AssetPathPolicy::IsLiveThemeSpecPath(
      "/themes/legacy.json", strlen("/themes/legacy.json")));
  TEST_ASSERT_FALSE(AssetPathPolicy::IsLiveThemeSpecPath(
      "/themes/s/clock.json", strlen("/themes/s/clock.json")));
  TEST_ASSERT_FALSE(AssetPathPolicy::IsLiveThemeSpecPath(
      "/themes/u/../s/clock.json", strlen("/themes/u/../s/clock.json")));
}

void test_traversal_and_unprintable_paths_are_rejected() {
  const char traversal[] = "/themes/s/../s";
  TEST_ASSERT_FALSE(ScreensaverPathValid(traversal, sizeof(traversal) - 1));
  const char control[] = "/themes/s/a\nb.json";
  TEST_ASSERT_FALSE(ScreensaverPathValid(control, sizeof(control) - 1));
}

void test_overlong_paths_are_rejected() {
  char path[kScreensaverPathSize + 8];
  memset(path, 'a', sizeof(path));
  memcpy(path, kScreensaverPathPrefix, kScreensaverPathPrefixLen);
  TEST_ASSERT_TRUE(ScreensaverPathValid(path, kMaxScreensaverPathLen));
  TEST_ASSERT_FALSE(ScreensaverPathValid(path, kMaxScreensaverPathLen + 1));
}

void test_setting_a_path_stores_it_and_an_empty_path_clears_it() {
  Settings settings = withPath("/themes/s/clock.json");
  TEST_ASSERT_TRUE(HasScreensaver(settings));
  TEST_ASSERT_EQUAL_STRING("/themes/s/clock.json", settings.screensaverPath);

  TEST_ASSERT_TRUE(SetScreensaverPath(settings, "", 0));
  TEST_ASSERT_FALSE(HasScreensaver(settings));
}

void test_an_invalid_path_leaves_the_previous_selection_untouched() {
  Settings settings = withPath("/themes/s/clock.json");
  TEST_ASSERT_FALSE(SetScreensaverPath(settings, "/etc/passwd", 11));
  TEST_ASSERT_EQUAL_STRING("/themes/s/clock.json", settings.screensaverPath);
}

void test_a_shorter_path_does_not_keep_bytes_of_the_longer_one() {
  Settings settings = withPath("/themes/s/a-very-long-screensaver-name.json");
  TEST_ASSERT_TRUE(SetScreensaverPath(settings, "/themes/s/c.json", strlen("/themes/s/c.json")));
  TEST_ASSERT_EQUAL_STRING("/themes/s/c.json", settings.screensaverPath);
}

void test_settings_survive_an_encode_decode_round_trip() {
  Settings settings = withPath("/themes/s/countdown.json");
  settings.enabled = true;
  settings.timeoutMinutes = 30;
  settings.brightnessPercent = 45;

  uint8_t record[kRecordBytes] = {};
  Encode(settings, record);

  Settings restored;
  TEST_ASSERT_TRUE(Decode(record, sizeof(record), restored));
  TEST_ASSERT_TRUE(restored.enabled);
  TEST_ASSERT_EQUAL_UINT8(30, restored.timeoutMinutes);
  TEST_ASSERT_EQUAL_UINT8(45, restored.brightnessPercent);
  TEST_ASSERT_EQUAL_STRING("/themes/s/countdown.json", restored.screensaverPath);
}

void test_an_empty_selection_survives_the_round_trip() {
  Settings settings;
  settings.enabled = true;

  uint8_t record[kRecordBytes] = {};
  Encode(settings, record);

  Settings restored = withPath("/themes/s/stale.json");
  TEST_ASSERT_TRUE(Decode(record, sizeof(record), restored));
  TEST_ASSERT_TRUE(restored.enabled);
  TEST_ASSERT_FALSE(HasScreensaver(restored));
}

void test_a_missing_or_foreign_record_keeps_factory_defaults() {
  Settings restored;
  uint8_t record[kRecordBytes] = {};

  TEST_ASSERT_FALSE(Decode(nullptr, kRecordBytes, restored));
  // A settings file written before standby existed has no marker byte.
  TEST_ASSERT_FALSE(Decode(record, sizeof(record), restored));
  // A truncated record must not be read as a valid one.
  record[0] = kRecordMarker;
  TEST_ASSERT_FALSE(Decode(record, kRecordBytes - 1, restored));

  TEST_ASSERT_FALSE(restored.enabled);
  TEST_ASSERT_EQUAL_UINT8(kDefaultTimeoutMinutes, restored.timeoutMinutes);
  TEST_ASSERT_EQUAL_UINT8(kDefaultBrightnessPercent, restored.brightnessPercent);
}

void test_out_of_range_persisted_values_are_clamped_on_read() {
  uint8_t record[kRecordBytes] = {};
  record[0] = kRecordMarker;
  record[1] = 1;
  record[2] = 255;
  record[3] = 0;

  Settings restored;
  TEST_ASSERT_TRUE(Decode(record, sizeof(record), restored));
  TEST_ASSERT_EQUAL_UINT8(kMaxTimeoutMinutes, restored.timeoutMinutes);
  TEST_ASSERT_EQUAL_UINT8(1, restored.brightnessPercent);
}

void test_a_corrupt_stored_path_drops_only_the_selection() {
  Settings settings = withPath("/themes/s/clock.json");
  settings.enabled = true;
  settings.timeoutMinutes = 15;

  uint8_t record[kRecordBytes] = {};
  Encode(settings, record);
  // Rewrite the stored path into one the device must never activate.
  memcpy(record + 5, "/etc/pw", 7);
  record[4] = 7;

  Settings restored;
  TEST_ASSERT_TRUE(Decode(record, sizeof(record), restored));
  TEST_ASSERT_FALSE(HasScreensaver(restored));
  TEST_ASSERT_TRUE(restored.enabled);
  TEST_ASSERT_EQUAL_UINT8(15, restored.timeoutMinutes);
}

}  // namespace

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_factory_defaults_are_off_ten_minutes_and_twenty_percent);
  RUN_TEST(test_timeout_clamps_to_the_supported_range);
  RUN_TEST(test_standby_brightness_uses_the_shared_display_range);
  RUN_TEST(test_only_screensaver_slot_paths_are_accepted);
  RUN_TEST(test_live_slot_paths_exclude_the_screensaver_directory);
  RUN_TEST(test_traversal_and_unprintable_paths_are_rejected);
  RUN_TEST(test_overlong_paths_are_rejected);
  RUN_TEST(test_setting_a_path_stores_it_and_an_empty_path_clears_it);
  RUN_TEST(test_an_invalid_path_leaves_the_previous_selection_untouched);
  RUN_TEST(test_a_shorter_path_does_not_keep_bytes_of_the_longer_one);
  RUN_TEST(test_settings_survive_an_encode_decode_round_trip);
  RUN_TEST(test_an_empty_selection_survives_the_round_trip);
  RUN_TEST(test_a_missing_or_foreign_record_keeps_factory_defaults);
  RUN_TEST(test_out_of_range_persisted_values_are_clamped_on_read);
  RUN_TEST(test_a_corrupt_stored_path_drops_only_the_selection);
  return UNITY_END();
}
