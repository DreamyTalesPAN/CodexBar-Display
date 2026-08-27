package writerlock

import (
	"context"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

// AcquireAtContext waits for a lock until the caller's work is canceled.
func AcquireAtContext(ctx context.Context, path string) (*Lock, error) {
	retry := time.NewTicker(25 * time.Millisecond)
	defer retry.Stop()
	for {
		lock, err := AcquireAt(path)
		if err == nil || errcode.Of(err) != errcode.RuntimeWriterLocked {
			return lock, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-retry.C:
		}
	}
}
