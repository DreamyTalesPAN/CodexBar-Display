package daemon

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

type codedResolverError errcode.Code

func (e codedResolverError) Error() string           { return string(e) }
func (e codedResolverError) ErrorCode() errcode.Code { return errcode.Code(e) }

func TestDaemonLogsTheUnderlyingUSBResolverError(t *testing.T) {
	for _, cause := range []errcode.Code{errcode.TransportNoUSBSerialPorts, errcode.TransportSerialOpen} {
		t.Run(string(cause), func(t *testing.T) {
			prepareFastTestEnv(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var log strings.Builder
			err := runDaemonLoop(ctx, Options{Interval: time.Second}, runtimeDeps{
				now:   time.Now,
				after: func(time.Duration) <-chan time.Time { cancel(); return make(chan time.Time) },
				logf:  func(format string, args ...any) { log.WriteString(fmt.Sprintf(format, args...)) },
			}, func(context.Context) error {
				return &RuntimeError{Kind: runtimeErrorSerialResolve, Op: "resolve-target", Err: fmt.Errorf("detect display target: %w", codedResolverError(cause))}
			})
			if !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			if !strings.Contains(log.String(), "cause="+string(cause)) {
				t.Fatalf("underlying resolver error was lost: %s", log.String())
			}
		})
	}
}

// Issue #616: every resolve opens the Cable port, and opening it restarts a
// VibeTV whose firmware predates USB-C. Setup updates that VibeTV and then
// connects it by Cable, which wakes the loop; until then the loop must not
// restart it every two seconds.
func TestDaemonLeavesACableVibeTVWithTooOldFirmwareAloneUntilWoken(t *testing.T) {
	prepareFastTestEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wake := make(chan struct{}, 1)
	var waits []time.Duration
	cycles := 0
	err := runDaemonLoop(ctx, Options{Interval: defaultInterval, Wake: wake}, runtimeDeps{
		now:  time.Now,
		logf: func(string, ...any) {},
		after: func(wait time.Duration) <-chan time.Time {
			waits = append(waits, wait)
			if len(waits) == 1 {
				wake <- struct{}{} // setup connected the updated VibeTV by Cable
			} else {
				cancel()
			}
			return make(chan time.Time)
		},
	}, func(context.Context) error {
		cycles++
		if cycles == 1 {
			return &RuntimeError{
				Kind: runtimeErrorSerialResolve,
				Op:   "resolve-target",
				Err:  fmt.Errorf("detect display target: %w", codedResolverError(errcode.TransportCableFirmwareTooOld)),
			}
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("loop stopped with %v", err)
	}
	if len(waits) == 0 || waits[0] != cableFirmwareTooOldRetryInterval {
		t.Fatalf("a VibeTV with too old firmware was probed again after %v, want %s", waits, cableFirmwareTooOldRetryInterval)
	}
	if cycles != 2 {
		t.Fatalf("waking the loop must end the wait at once: %d cycles", cycles)
	}
}
