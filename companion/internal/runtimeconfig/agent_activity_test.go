package runtimeconfig

import (
	"testing"
	"time"
)

func TestAgentQuietHoursAndDefaults(t *testing.T) {
	s := Config{}.AgentActivitySettings()
	if s.Enabled || !s.Blink || s.ReminderSeconds() != 300 || !s.Muted(time.Now()) {
		t.Fatal(s)
	}
	s.Enabled = true
	if got := (Config{AgentActivity: &s}).AgentActivitySettings(); !got.Enabled {
		t.Fatal("saved master choice lost")
	}
	for _, tc := range []struct {
		quiet string
		hour  int
		muted bool
	}{{"22", 21, false}, {"22", 22, true}, {"22", 0, true}, {"22", 7, true}, {"22", 8, false}, {"00", 23, false}, {"00", 0, true}, {"00", 6, true}, {"00", 7, false}, {"off", 23, false}} {
		s.Quiet = tc.quiet
		now := time.Date(2026, 9, 21, tc.hour, 0, 0, 0, time.FixedZone("local", 7200))
		if s.Muted(now) != tc.muted {
			t.Fatalf("%+v", tc)
		}
	}
	s.Blink = false
	if !s.Muted(time.Now()) {
		t.Fatal("blink off ignored")
	}
	s.Blink = true
	s.Enabled = false
	if !s.Muted(time.Now()) {
		t.Fatal("master off ignored")
	}
}

func TestDoneDurationDefaultsAndSavedValues(t *testing.T) {
	for _, duration := range []string{"", "invalid", "0", "600"} {
		s := (Config{AgentActivity: &AgentActivitySettings{Enabled: true, DoneDuration: duration}}).AgentActivitySettings()
		if !s.Enabled || s.DoneDuration != "30" || s.DoneSeconds() != 30 {
			t.Fatal(s)
		}
	}
	for _, tc := range []struct {
		value   string
		seconds int
	}{{"10", 10}, {"30", 30}, {"60", 60}, {"120", 120}, {"300", 300}} {
		s := (Config{AgentActivity: &AgentActivitySettings{DoneDuration: tc.value}}).AgentActivitySettings()
		if s.DoneSeconds() != tc.seconds {
			t.Fatal(s)
		}
	}
}
