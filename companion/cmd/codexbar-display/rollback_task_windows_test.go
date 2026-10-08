package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsRollbackRestartsAfterStopOrCopyFailure(t *testing.T) {
	for _, phase := range []string{"stop", "copy", "restart"} {
		t.Run(phase, func(t *testing.T) {
			home, installed := installedBinaryFixture(t)
			source := filepath.Join(home, "known-good")
			if err := os.WriteFile(source, []byte("known-good"), 0600); err != nil {
				t.Fatal(err)
			}
			previousLoad, previousStop, previousRestart := loadReleaseStateFn, rollbackStopTaskFn, rollbackRestartLaunchAgentFn
			t.Cleanup(func() {
				loadReleaseStateFn = previousLoad
				rollbackStopTaskFn = previousStop
				rollbackRestartLaunchAgentFn = previousRestart
			})
			loadReleaseStateFn = func(string) (releaseState, error) {
				return releaseState{LastKnownGood: lastKnownGoodState{CompanionBinary: source}}, nil
			}
			stops, restarts := 0, 0
			stopErr, restartErr := errors.New("partial stop failure"), errors.New("restart failure")
			rollbackStopTaskFn = func(string) error {
				stops++
				if phase == "stop" {
					return stopErr
				}
				// Only the fixture target is changed to force atomic replacement failure.
				if err := os.Remove(installed); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(installed, 0700); err != nil {
					t.Fatal(err)
				}
				return nil
			}
			rollbackRestartLaunchAgentFn = func(string) error {
				restarts++
				if phase == "restart" {
					return restartErr
				}
				return nil
			}
			err := runRollback([]string{"--skip-firmware"})
			if err == nil || stops != 1 || restarts != 1 {
				t.Fatalf("stops=%d restarts=%d err=%v", stops, restarts, err)
			}
			if phase == "stop" && !errors.Is(err, stopErr) {
				t.Fatalf("lost stop error: %v", err)
			}
			if phase == "restart" && !errors.Is(err, restartErr) {
				t.Fatalf("lost restart error: %v", err)
			}
		})
	}
}
