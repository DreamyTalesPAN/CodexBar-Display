package daemon

import (
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

// DO NOT weaken this test. Snapshots persisted by a pre-usage-windows
// companion (release 1.0.52) carry real usage only in the legacy
// session/weekly fields. Served unchanged after an app update, a slot-bound
// theme renders an empty skeleton until the first fresh collection lands —
// observed on device 14799300 right after the 2026-08-09 Sparkle update. The
// loader must project that legacy usage into proper windows so the customer
// keeps a full render across the update.
func TestMigrateLegacySnapshotUsageWindowsProjectsSessionAndWeekly(t *testing.T) {
	collected := time.Date(2026, 8, 9, 13, 40, 0, 0, time.UTC)
	snapshots := map[string]providerSnapshot{
		"claude": {
			Collected: collected,
			Frame: protocol.Frame{
				V:        protocol.ProtocolVersionV2,
				Provider: "claude",
				Label:    "Claude",
				Session:  11,
				Weekly:   17,
				ResetSec: 4693,
			},
		},
	}

	migrated := migrateLegacySnapshotUsageWindows(snapshots)
	frame := migrated["claude"].Frame
	if len(frame.UsageWindows) != 2 {
		t.Fatalf("expected two projected usage windows, got %+v", frame.UsageWindows)
	}
	if frame.UsageWindows[0].ID != "session" || frame.UsageWindows[0].Percent != 11 || frame.UsageWindows[0].ResetSec != 4693 {
		t.Fatalf("session window mismatch: %+v", frame.UsageWindows[0])
	}
	if frame.UsageWindows[1].ID != "weekly" || frame.UsageWindows[1].Percent != 17 {
		t.Fatalf("weekly window mismatch: %+v", frame.UsageWindows[1])
	}
	if frame.Session != 11 || frame.Weekly != 17 {
		t.Fatalf("legacy projection changed the legacy fields: %+v", frame)
	}
}

// Unavailable usage must stay unavailable: the migration only translates known
// values, it never invents windows.
func TestMigrateLegacySnapshotUsageWindowsLeavesUnavailableUsageAlone(t *testing.T) {
	snapshots := map[string]providerSnapshot{
		"gemini": {
			Frame: protocol.Frame{
				V:                  protocol.ProtocolVersionV2,
				Provider:           "gemini",
				Label:              "Gemini",
				UsageUnavailable:   true,
				SessionUnavailable: true,
				WeeklyUnavailable:  true,
			},
		},
	}

	migrated := migrateLegacySnapshotUsageWindows(snapshots)
	if len(migrated["gemini"].Frame.UsageWindows) != 0 {
		t.Fatalf("unavailable usage must not grow windows: %+v", migrated["gemini"].Frame)
	}
}

// Snapshots that already carry windows are current-schema and stay untouched.
func TestMigrateLegacySnapshotUsageWindowsKeepsModernSnapshots(t *testing.T) {
	windows := []protocol.UsageWindow{{ID: "session", Label: "Session", Percent: 42}}
	snapshots := map[string]providerSnapshot{
		"codex": {
			Frame: protocol.Frame{
				V:            protocol.ProtocolVersionV2,
				Provider:     "codex",
				Label:        "Codex",
				UsageWindows: windows,
			},
		},
	}

	migrated := migrateLegacySnapshotUsageWindows(snapshots)
	frame := migrated["codex"].Frame
	if len(frame.UsageWindows) != 1 || frame.UsageWindows[0].Percent != 42 {
		t.Fatalf("modern snapshot must stay untouched: %+v", frame)
	}
}
