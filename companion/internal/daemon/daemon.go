package daemon

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

type Options struct {
	Port     string
	Interval time.Duration
	Once     bool
}

func Run(ctx context.Context, opts Options) error {
	if opts.Interval <= 0 {
		opts.Interval = 60 * time.Second
	}

	var lastGood protocol.Frame
	var lastGoodAt time.Time
	hasLastGood := false

	for {
		if err := runCycle(ctx, opts.Port, &lastGood, &lastGoodAt, &hasLastGood); err != nil {
			fmt.Printf("cycle error: %v\n", err)
			if opts.Once {
				return err
			}
		}
		if opts.Once {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(opts.Interval):
		}
	}
}

func runCycle(ctx context.Context, requestedPort string, lastGood *protocol.Frame, lastGoodAt *time.Time, hasLastGood *bool) error {
	port, err := usb.ResolvePort(requestedPort)
	if err != nil {
		return fmt.Errorf("detect serial device: %w", err)
	}

	allProviders, fetchErr := codexbar.FetchAllProviders(ctx)
	var frame protocol.Frame
	usedLastGood := false

	if fetchErr != nil {
		if hasLastGood != nil && *hasLastGood && lastGood != nil && lastGoodAt != nil && isLastGoodFresh(*lastGoodAt) {
			frame = *lastGood
			usedLastGood = true
		} else {
			frame = protocol.ErrorFrame(fetchErr.Error())
		}
	} else {
		frame = selectProvider(allProviders)

		if hasLastGood != nil && lastGood != nil && lastGoodAt != nil {
			*lastGood = frame
			*lastGoodAt = time.Now()
			*hasLastGood = true
		}
	}

	line, err := frame.MarshalLine()
	if err != nil {
		return fmt.Errorf("encode frame: %w", err)
	}

	if err := usb.SendLine(port, line); err != nil {
		return err
	}

	fmt.Printf("sent frame -> %s provider=%s label=%s session=%d weekly=%d reset=%ds error=%q\n",
		port, frame.Provider, frame.Label, frame.Session, frame.Weekly, frame.ResetSec, frame.Error)

	if fetchErr != nil {
		if usedLastGood {
			fmt.Printf("warning: codexbar fetch failed, sent stale frame: %v\n", fetchErr)
			return nil
		}
		return fmt.Errorf("fetch codexbar usage: %w", fetchErr)
	}

	return nil
}

// selectProvider picks the most recently used provider based on codexbar timestamps.
// Preference order: lastActiveAt (derived from reset window), then updatedAt, then first entry.
func selectProvider(all []codexbar.ParsedFrame) protocol.Frame {
	if len(all) == 0 {
		return protocol.ErrorFrame("no providers")
	}

	best := all[0]
	for _, p := range all[1:] {
		if isMoreRecent(p, best) {
			best = p
		}
	}

	return best.Frame
}

func isMoreRecent(candidate, current codexbar.ParsedFrame) bool {
	// Prefer lastActiveAt when available (derived from reset window).
	if candidate.HasLastActiveAt || current.HasLastActiveAt {
		if candidate.HasLastActiveAt && !current.HasLastActiveAt {
			return true
		}
		if !candidate.HasLastActiveAt && current.HasLastActiveAt {
			return false
		}
		return candidate.LastActiveAt.After(current.LastActiveAt)
	}

	// Fallback to updatedAt when lastActiveAt is missing.
	if candidate.HasUpdatedAt && !current.HasUpdatedAt {
		return true
	}
	if candidate.HasUpdatedAt && current.HasUpdatedAt {
		return candidate.UpdatedAt.After(current.UpdatedAt)
	}

	return false
}

func isLastGoodFresh(lastGoodAt time.Time) bool {
	if lastGoodAt.IsZero() {
		return false
	}
	return time.Since(lastGoodAt) <= lastGoodMaxAge()
}

func lastGoodMaxAge() time.Duration {
	// If CodexBar requests fail for a short period, keep rendering the most recent good frame.
	d := 10 * time.Minute
	raw := os.Getenv("VIBEBLOCK_LAST_GOOD_MAX_AGE")
	if raw == "" {
		return d
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return d
	}
	return parsed
}
