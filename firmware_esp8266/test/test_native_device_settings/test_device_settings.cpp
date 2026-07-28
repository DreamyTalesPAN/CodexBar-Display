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
  return UNITY_END();
}
