#include <unity.h>

#include <string.h>

#include "../../src/standby_state.h"

namespace {

using namespace codexbar_display::esp8266::standby;

// Unity compares integers, and a scoped enum does not convert on its own.
#define ASSERT_TRANSITION(expected, actual) \
  TEST_ASSERT_EQUAL_INT(static_cast<int>(expected), static_cast<int>(actual))

constexpr unsigned long kMinute = 60UL * 1000UL;

Settings armedSettings() {
  Settings settings;
  settings.enabled = true;
  SetScreensaverPath(settings, "/themes/s/clock.json", strlen("/themes/s/clock.json"));
  return settings;
}

// The device is always ready in these cases; readiness has its own tests.
Transition tickReady(State& state, const Settings& settings, unsigned long nowMs) {
  return Tick(state, settings, true, nowMs);
}

void test_the_timeout_is_the_configured_minutes() {
  Settings settings;
  settings.timeoutMinutes = 10;
  TEST_ASSERT_EQUAL_UINT32(600000UL, TimeoutMs(settings));
  settings.timeoutMinutes = kMaxTimeoutMinutes;
  TEST_ASSERT_EQUAL_UINT32(14400000UL, TimeoutMs(settings));
}

// The Mac was never there since boot: no frame ever arrives, and the timer
// alone has to bring the screensaver up.
void test_standby_enters_after_the_timeout_without_any_frame() {
  const Settings settings = armedSettings();
  State state;

  ASSERT_TRANSITION(Transition::None, tickReady(state, settings, 9 * kMinute));
  TEST_ASSERT_FALSE(state.active);

  ASSERT_TRANSITION(Transition::Enter, tickReady(state, settings, 10 * kMinute));
  TEST_ASSERT_TRUE(state.active);
  // Entering is reported once, not on every loop.
  ASSERT_TRANSITION(Transition::None, tickReady(state, settings, 11 * kMinute));
}

void test_changed_usage_restarts_the_timer_before_standby() {
  const Settings settings = armedSettings();
  State state;

  NoteUsageActivity(state, 9 * kMinute);
  ASSERT_TRANSITION(Transition::None, tickReady(state, settings, 18 * kMinute));
  ASSERT_TRANSITION(Transition::Enter, tickReady(state, settings, 19 * kMinute));
}

void test_changed_usage_leaves_standby_on_the_next_tick() {
  const Settings settings = armedSettings();
  State state;

  ASSERT_TRANSITION(Transition::Enter, tickReady(state, settings, 10 * kMinute));

  NoteUsageActivity(state, 12 * kMinute);
  ASSERT_TRANSITION(Transition::Exit, tickReady(state, settings, 12 * kMinute));
  TEST_ASSERT_FALSE(state.active);
  ASSERT_TRANSITION(Transition::None, tickReady(state, settings, 12 * kMinute + 1));
}

void test_an_empty_screensaver_slot_never_enters_standby() {
  Settings settings = armedSettings();
  ClearScreensaverPath(settings);
  State state;

  ASSERT_TRANSITION(Transition::None, tickReady(state, settings, 60 * kMinute));
  TEST_ASSERT_FALSE(state.active);
}

void test_disabled_standby_never_enters() {
  Settings settings = armedSettings();
  settings.enabled = false;
  State state;

  ASSERT_TRANSITION(Transition::None, tickReady(state, settings, 60 * kMinute));
  TEST_ASSERT_FALSE(state.active);
}

void test_clearing_the_selection_while_active_leaves_standby() {
  Settings settings = armedSettings();
  State state;
  ASSERT_TRANSITION(Transition::Enter, tickReady(state, settings, 10 * kMinute));

  ClearScreensaverPath(settings);
  ASSERT_TRANSITION(Transition::Exit, tickReady(state, settings, 11 * kMinute));
  TEST_ASSERT_FALSE(state.active);
}

void test_disabling_standby_while_active_leaves_standby() {
  Settings settings = armedSettings();
  State state;
  ASSERT_TRANSITION(Transition::Enter, tickReady(state, settings, 10 * kMinute));

  settings.enabled = false;
  ASSERT_TRANSITION(Transition::Exit, tickReady(state, settings, 11 * kMinute));
  TEST_ASSERT_FALSE(state.active);
}

// A status screen or a missing live theme is a veto: standby must not take a
// screen it cannot hand back, and it gives one up that it already holds.
void test_a_device_that_is_not_ready_stays_out_of_standby() {
  const Settings settings = armedSettings();
  State state;

  ASSERT_TRANSITION(Transition::None, Tick(state, settings, false, 60 * kMinute));
  TEST_ASSERT_FALSE(state.active);

  ASSERT_TRANSITION(Transition::Enter, Tick(state, settings, true, 61 * kMinute));
  ASSERT_TRANSITION(Transition::Exit, Tick(state, settings, false, 62 * kMinute));
  TEST_ASSERT_FALSE(state.active);
}

void test_repeated_cycles_report_one_transition_each() {
  const Settings settings = armedSettings();
  State state;
  unsigned long nowMs = 0;

  for (int cycle = 0; cycle < 20; ++cycle) {
    NoteUsageActivity(state, nowMs);
    ASSERT_TRANSITION(Transition::None, tickReady(state, settings, nowMs));

    nowMs += 10 * kMinute;
    ASSERT_TRANSITION(Transition::Enter, tickReady(state, settings, nowMs));
    TEST_ASSERT_TRUE(state.active);
    // Hours of screensaver in between must not produce a second entry.
    nowMs += 120 * kMinute;
    ASSERT_TRANSITION(Transition::None, tickReady(state, settings, nowMs));

    NoteUsageActivity(state, nowMs);
    ASSERT_TRANSITION(Transition::Exit, tickReady(state, settings, nowMs));
    TEST_ASSERT_FALSE(state.active);
  }
}

// millis() wraps after roughly 49.7 days, which a device showing a screensaver
// for weeks will reach.
void test_the_timer_survives_the_millis_wraparound() {
  const Settings settings = armedSettings();
  State state;
  const unsigned long beforeWrap = 0UL - (2 * kMinute);

  NoteUsageActivity(state, beforeWrap);
  ASSERT_TRANSITION(Transition::None, tickReady(state, settings, 7 * kMinute));
  ASSERT_TRANSITION(Transition::Enter, tickReady(state, settings, 8 * kMinute));
}

}  // namespace

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_the_timeout_is_the_configured_minutes);
  RUN_TEST(test_standby_enters_after_the_timeout_without_any_frame);
  RUN_TEST(test_changed_usage_restarts_the_timer_before_standby);
  RUN_TEST(test_changed_usage_leaves_standby_on_the_next_tick);
  RUN_TEST(test_an_empty_screensaver_slot_never_enters_standby);
  RUN_TEST(test_disabled_standby_never_enters);
  RUN_TEST(test_clearing_the_selection_while_active_leaves_standby);
  RUN_TEST(test_disabling_standby_while_active_leaves_standby);
  RUN_TEST(test_a_device_that_is_not_ready_stays_out_of_standby);
  RUN_TEST(test_repeated_cycles_report_one_transition_each);
  RUN_TEST(test_the_timer_survives_the_millis_wraparound);
  return UNITY_END();
}
