package daemon

import (
	"context"
	"fmt"
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
	hasLastGood := false

	for {
		if err := runCycle(ctx, opts.Port, &lastGood, &hasLastGood); err != nil {
			fmt.Printf("cycle error: %v\n", err)
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

func runCycle(ctx context.Context, requestedPort string, lastGood *protocol.Frame, hasLastGood *bool) error {
	port, err := usb.ResolvePort(requestedPort)
	if err != nil {
		return fmt.Errorf("detect serial device: %w", err)
	}

	frame, err := codexbar.FetchFirstFrame(ctx)
	if err != nil {
		if hasLastGood != nil && *hasLastGood && lastGood != nil {
			frame = *lastGood
		} else {
			frame = protocol.ErrorFrame(err.Error())
		}
	} else if hasLastGood != nil && lastGood != nil {
		*lastGood = frame
		*hasLastGood = true
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
	return nil
}
