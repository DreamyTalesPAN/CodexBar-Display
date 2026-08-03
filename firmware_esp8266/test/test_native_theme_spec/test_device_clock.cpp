#include "../../../firmware_shared/device_clock.h"

#include <unity.h>

namespace {

using codexbar_display::deviceclock::DeviceClock;
using codexbar_display::deviceclock::EncodeUtcOffset;
using codexbar_display::deviceclock::EncodeUtcOffsetTransition;
using codexbar_display::deviceclock::DecodeUtcOffset;
using codexbar_display::deviceclock::DecodeUtcOffsetTransition;
using codexbar_display::deviceclock::ClearUtcOffsetTransition;
using codexbar_display::deviceclock::LocalClockUsable;
using codexbar_display::deviceclock::ApplyDueUtcOffsetTransition;
using codexbar_display::deviceclock::ObserveCompanionClock;
using codexbar_display::deviceclock::ObserveUtcOffsetTransition;
using codexbar_display::deviceclock::ObserveSystemEpoch;
using codexbar_display::deviceclock::ResolveDateText;
using codexbar_display::deviceclock::ResolveTimeText;
using codexbar_display::deviceclock::RestoreUtcOffset;
using codexbar_display::deviceclock::RestoreUtcOffsetTransition;
using codexbar_display::deviceclock::Source;
using codexbar_display::deviceclock::kDateTextSize;
using codexbar_display::deviceclock::kTimeTextSize;
using codexbar_display::deviceclock::kUtcOffsetRecordBytes;
using codexbar_display::deviceclock::kUtcOffsetTransitionRecordBytes;

// 2026-07-28T12:34:00Z
constexpr int64_t kNtpEpoch = 1785242040;

struct ClockText {
  char time[kTimeTextSize] = {};
  char date[kDateTextSize] = {};
  Source timeSource = Source::Unknown;
  Source dateSource = Source::Unknown;
};

ClockText resolve(const DeviceClock& clock, unsigned long nowMs, const char* companionTime, const char* companionDate) {
  ClockText out;
  out.timeSource = ResolveTimeText(clock, nowMs, companionTime, out.time, sizeof(out.time));
  out.dateSource = ResolveDateText(clock, nowMs, companionDate, out.date, sizeof(out.date));
  return out;
}

// Fresh boot: the system clock still holds its boot value until SNTP answers,
// and the first plausible epoch plus the learned offset gives local wall time.
void testFreshBootWithNtpEstablishesLocalClock() {
  DeviceClock clock;
  TEST_ASSERT_FALSE(ObserveSystemEpoch(clock, 3, 1000));
  TEST_ASSERT_FALSE(clock.synced);

  TEST_ASSERT_TRUE(ObserveSystemEpoch(clock, kNtpEpoch, 4000));
  TEST_ASSERT_TRUE(clock.synced);
  // UTC alone is not a wall clock: without the offset the device stays honest.
  TEST_ASSERT_FALSE(LocalClockUsable(clock));

  TEST_ASSERT_TRUE(ObserveCompanionClock(clock, "14:34", true, 120, 4200));
  TEST_ASSERT_EQUAL_INT(120, clock.utcOffsetMinutes);

  const ClockText texts = resolve(clock, 4200, "14:34", "28.07.2026");
  TEST_ASSERT_EQUAL_STRING("14:34", texts.time);
  TEST_ASSERT_EQUAL_STRING("28.07.2026", texts.date);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Source::Device), static_cast<int>(texts.timeSource));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Source::Device), static_cast<int>(texts.dateSource));
}

// The device clock keeps running while the Mac is off; the Companion string does not.
void testDeviceClockAdvancesWithoutFrames() {
  DeviceClock clock;
  ObserveSystemEpoch(clock, kNtpEpoch, 10000);
  ObserveCompanionClock(clock, "14:34", true, 120, 10000);

  const unsigned long threeHoursLater = 10000UL + 3UL * 3600UL * 1000UL;
  const ClockText texts = resolve(clock, threeHoursLater, "14:34", "28.07.2026");
  TEST_ASSERT_EQUAL_STRING("17:34", texts.time);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Source::Device), static_cast<int>(texts.timeSource));
}

// No NTP: a fresh Companion string is still fine, a stale one must never be
// presented as the current time.
void testBootWithoutNtpFallsBackAndThenGoesUnknown() {
  DeviceClock clock;
  ObserveCompanionClock(clock, "14:34", true, 120, 5000);
  TEST_ASSERT_FALSE(clock.synced);

  ClockText fresh = resolve(clock, 5000, "14:34", "28.07.2026");
  TEST_ASSERT_EQUAL_STRING("14:34", fresh.time);
  TEST_ASSERT_EQUAL_STRING("28.07.2026", fresh.date);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Source::Companion), static_cast<int>(fresh.timeSource));

  const ClockText stale = resolve(clock, 5000 + 121000UL, "14:34", "28.07.2026");
  TEST_ASSERT_EQUAL_STRING("--:--", stale.time);
  TEST_ASSERT_EQUAL_STRING("--.--.----", stale.date);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Source::Unknown), static_cast<int>(stale.timeSource));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Source::Unknown), static_cast<int>(stale.dateSource));
}

// Never seen a Mac and never seen NTP: nothing to show, and nothing invented.
void testNoSourceAtAllRendersUnknown() {
  DeviceClock clock;
  const ClockText texts = resolve(clock, 1000, "", "");
  TEST_ASSERT_EQUAL_STRING("--:--", texts.time);
  TEST_ASSERT_EQUAL_STRING("--.--.----", texts.date);
}

// Network comes back: the next plausible sample takes over from the fallback
// and a corrected epoch counts as a new sync.
void testClockRecoversWhenNetworkReturns() {
  DeviceClock clock;
  ObserveCompanionClock(clock, "14:34", true, 120, 1000);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Source::Unknown),
                        static_cast<int>(resolve(clock, 200000, "14:34", "28.07.2026").timeSource));

  TEST_ASSERT_TRUE(ObserveSystemEpoch(clock, kNtpEpoch, 200000));
  ObserveCompanionClock(clock, "14:34", true, 120, 200000);
  TEST_ASSERT_EQUAL_STRING("14:34", resolve(clock, 200000, "", "").time);
  TEST_ASSERT_EQUAL_INT(1, static_cast<int>(clock.syncCount));

  // A sample matching the projection is not a resync.
  TEST_ASSERT_FALSE(ObserveSystemEpoch(clock, kNtpEpoch + 60, 260000));
  TEST_ASSERT_EQUAL_INT(1, static_cast<int>(clock.syncCount));

  // A corrected epoch is applied and counted.
  TEST_ASSERT_TRUE(ObserveSystemEpoch(clock, kNtpEpoch + 3600, 260000));
  TEST_ASSERT_EQUAL_INT(2, static_cast<int>(clock.syncCount));
  TEST_ASSERT_EQUAL_STRING("15:34", resolve(clock, 260000, "", "").time);
}

// Reboot while the Mac is off: the persisted offset plus SNTP is enough.
void testPersistedOffsetSurvivesRebootWithoutCompanion() {
  uint8_t record[kUtcOffsetRecordBytes] = {};
  DeviceClock before;
  ObserveSystemEpoch(before, kNtpEpoch, 1000);
  ObserveCompanionClock(before, "13:34", true, 60, 1000);
  TEST_ASSERT_EQUAL_INT(60, before.utcOffsetMinutes);
  EncodeUtcOffset(before, record);

  int restored = 0;
  TEST_ASSERT_TRUE(DecodeUtcOffset(record, sizeof(record), restored));
  TEST_ASSERT_EQUAL_INT(60, restored);

  DeviceClock after;
  TEST_ASSERT_TRUE(RestoreUtcOffset(after, restored));
  ObserveSystemEpoch(after, kNtpEpoch, 500);
  TEST_ASSERT_EQUAL_STRING("13:34", resolve(after, 500, "", "").time);
}

void testUtcOffsetRecordRejectsUnsetAndImplausibleValues() {
  int restored = 42;
  const uint8_t unset[kUtcOffsetRecordBytes] = {0, 0x78, 0x00};
  TEST_ASSERT_FALSE(DecodeUtcOffset(unset, sizeof(unset), restored));

  const uint8_t notQuarterHour[kUtcOffsetRecordBytes] = {1, 0x07, 0x00};
  TEST_ASSERT_FALSE(DecodeUtcOffset(notQuarterHour, sizeof(notQuarterHour), restored));

  const uint8_t outOfRange[kUtcOffsetRecordBytes] = {1, 0x7C, 0xFC};  // -15 hours
  TEST_ASSERT_FALSE(DecodeUtcOffset(outOfRange, sizeof(outOfRange), restored));

  const uint8_t truncated[1] = {1};
  TEST_ASSERT_FALSE(DecodeUtcOffset(truncated, sizeof(truncated), restored));
  TEST_ASSERT_EQUAL_INT(42, restored);
}

void testCompanionOffsetFollowsDstAndNegativeZones() {
  DeviceClock clock;
  ObserveSystemEpoch(clock, kNtpEpoch, 1000);

  // The Companion sends the validated quarter-hour offset directly.
  TEST_ASSERT_TRUE(ObserveCompanionClock(clock, "14:33", true, 120, 1000));
  TEST_ASSERT_EQUAL_INT(120, clock.utcOffsetMinutes);
  // A repeated sample is not a new value to persist.
  TEST_ASSERT_FALSE(ObserveCompanionClock(clock, "14:34", true, 120, 1000));

  // DST ends.
  TEST_ASSERT_TRUE(ObserveCompanionClock(clock, "13:34", true, 60, 1000));
  TEST_ASSERT_EQUAL_INT(60, clock.utcOffsetMinutes);

  // Negative offset across the date line.
  TEST_ASSERT_TRUE(ObserveCompanionClock(clock, "07:34", true, -300, 1000));
  TEST_ASSERT_EQUAL_INT(-300, clock.utcOffsetMinutes);
  TEST_ASSERT_EQUAL_STRING("07:34", resolve(clock, 1000, "", "").time);
  TEST_ASSERT_EQUAL_STRING("28.07.2026", resolve(clock, 1000, "", "").date);

  // Quarter-hour zone.
  TEST_ASSERT_TRUE(ObserveCompanionClock(clock, "18:19", true, 345, 1000));
  TEST_ASSERT_EQUAL_INT(345, clock.utcOffsetMinutes);
}

void testCompanionOffsetKeepsUtcPlus13AndPlus14Date() {
  DeviceClock clock;
  ObserveSystemEpoch(clock, kNtpEpoch, 1000);

  // 2026-07-28T12:34Z is already 2026-07-29 in UTC+13/UTC+14.
  TEST_ASSERT_TRUE(ObserveCompanionClock(clock, "01:34", true, 780, 1000));
  TEST_ASSERT_EQUAL_INT(780, clock.utcOffsetMinutes);
  TEST_ASSERT_TRUE(ObserveCompanionClock(clock, "02:34", true, 840, 1000));
  TEST_ASSERT_EQUAL_INT(840, clock.utcOffsetMinutes);

  const ClockText texts = resolve(clock, 1000, "", "");
  TEST_ASSERT_EQUAL_STRING("02:34", texts.time);
  TEST_ASSERT_EQUAL_STRING("29.07.2026", texts.date);
}

void testMissingCurrentOffsetPreservesFreshCompanionFallback() {
  DeviceClock clock;
  ObserveSystemEpoch(clock, kNtpEpoch, 1000);
  TEST_ASSERT_FALSE(ObserveCompanionClock(clock, "14:34", false, 0, 1000));
  TEST_ASSERT_FALSE(clock.hasUtcOffset);

  const ClockText texts = resolve(clock, 1000, "14:34", "28.07.2026");
  TEST_ASSERT_EQUAL_STRING("14:34", texts.time);
  TEST_ASSERT_EQUAL_STRING("28.07.2026", texts.date);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Source::Companion),
                        static_cast<int>(texts.timeSource));
}

void testOffsetTransitionPersistsAndAppliesAtItsUtcEpoch() {
  constexpr int64_t kTransitionEpoch = kNtpEpoch + 3600;
  DeviceClock before;
  TEST_ASSERT_TRUE(RestoreUtcOffset(before, 120));
  TEST_ASSERT_TRUE(ObserveUtcOffsetTransition(before, kTransitionEpoch, 60));

  DeviceClock cleared;
  TEST_ASSERT_TRUE(ObserveUtcOffsetTransition(cleared, kTransitionEpoch, 60));
  TEST_ASSERT_TRUE(ClearUtcOffsetTransition(cleared));
  TEST_ASSERT_FALSE(cleared.hasUtcOffsetTransition);

  uint8_t record[kUtcOffsetTransitionRecordBytes] = {};
  EncodeUtcOffsetTransition(before, record);

  int64_t restoredEpoch = 0;
  int restoredOffsetMinutes = 0;
  TEST_ASSERT_TRUE(DecodeUtcOffsetTransition(
      record, sizeof(record), restoredEpoch, restoredOffsetMinutes));
  TEST_ASSERT_EQUAL_INT64(kTransitionEpoch, restoredEpoch);
  TEST_ASSERT_EQUAL_INT(60, restoredOffsetMinutes);

  DeviceClock after;
  TEST_ASSERT_TRUE(RestoreUtcOffset(after, 120));
  TEST_ASSERT_TRUE(RestoreUtcOffsetTransition(
      after, restoredEpoch, restoredOffsetMinutes));
  TEST_ASSERT_FALSE(ApplyDueUtcOffsetTransition(after, kTransitionEpoch - 1));
  TEST_ASSERT_EQUAL_INT(120, after.utcOffsetMinutes);
  TEST_ASSERT_TRUE(ApplyDueUtcOffsetTransition(after, kTransitionEpoch));
  TEST_ASSERT_EQUAL_INT(60, after.utcOffsetMinutes);
  TEST_ASSERT_FALSE(after.hasUtcOffsetTransition);
  TEST_ASSERT_FALSE(ApplyDueUtcOffsetTransition(after, kTransitionEpoch + 1));
}

void testGarbageCompanionClockIsIgnoredForOffsetLearning() {
  DeviceClock clock;
  ObserveSystemEpoch(clock, kNtpEpoch, 1000);
  TEST_ASSERT_FALSE(ObserveCompanionClock(clock, "", true, 120, 1000));
  TEST_ASSERT_FALSE(ObserveCompanionClock(clock, "25:00", true, 120, 1000));
  TEST_ASSERT_FALSE(ObserveCompanionClock(clock, "14:3", true, 120, 1000));
  TEST_ASSERT_FALSE(ObserveCompanionClock(clock, "14:345", true, 120, 1000));
  TEST_ASSERT_FALSE(ObserveCompanionClock(clock, nullptr, true, 120, 1000));
  TEST_ASSERT_FALSE(clock.hasUtcOffset);
  TEST_ASSERT_FALSE(clock.hasCompanionClock);
}

void testLocalDateRollsOverIncludingLeapDay() {
  DeviceClock clock;
  RestoreUtcOffset(clock, 120);

  // 2026-02-28T23:58Z + 2h
  ObserveSystemEpoch(clock, 1772323080, 1000);
  TEST_ASSERT_EQUAL_STRING("01:58", resolve(clock, 1000, "", "").time);
  TEST_ASSERT_EQUAL_STRING("01.03.2026", resolve(clock, 1000, "", "").date);

  // 2028-02-28T23:58Z + 2h lands on the leap day.
  DeviceClock leap;
  RestoreUtcOffset(leap, 120);
  ObserveSystemEpoch(leap, 1835395080, 1000);
  TEST_ASSERT_EQUAL_STRING("29.02.2028", resolve(leap, 1000, "", "").date);
}

}  // namespace

void RunDeviceClockTests() {
  RUN_TEST(testFreshBootWithNtpEstablishesLocalClock);
  RUN_TEST(testDeviceClockAdvancesWithoutFrames);
  RUN_TEST(testBootWithoutNtpFallsBackAndThenGoesUnknown);
  RUN_TEST(testNoSourceAtAllRendersUnknown);
  RUN_TEST(testClockRecoversWhenNetworkReturns);
  RUN_TEST(testPersistedOffsetSurvivesRebootWithoutCompanion);
  RUN_TEST(testUtcOffsetRecordRejectsUnsetAndImplausibleValues);
  RUN_TEST(testCompanionOffsetFollowsDstAndNegativeZones);
  RUN_TEST(testCompanionOffsetKeepsUtcPlus13AndPlus14Date);
  RUN_TEST(testMissingCurrentOffsetPreservesFreshCompanionFallback);
  RUN_TEST(testOffsetTransitionPersistsAndAppliesAtItsUtcEpoch);
  RUN_TEST(testGarbageCompanionClockIsIgnoredForOffsetLearning);
  RUN_TEST(testLocalDateRollsOverIncludingLeapDay);
}
