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
