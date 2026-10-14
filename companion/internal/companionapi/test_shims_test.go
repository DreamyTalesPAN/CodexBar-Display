package companionapi

import (
	"context"
	"time"
)

// Short forms of production functions that only the tests call.

func (s *Server) waitForDisplayRender(ctx context.Context, target, token string, baseline deviceHealth) (deviceHealth, error) {
	return s.waitForDisplayRenderWithStream(ctx, target, token, baseline, displayStreamInfo{})
}

func inspectDisplayStream(ctx context.Context, target string) displayStreamInfo {
	return inspectDisplayStreamAfter(ctx, target, time.Time{})
}

func inspectDisplayStreamAfter(ctx context.Context, target string, notBefore time.Time) displayStreamInfo {
	return inspectDisplayStreamAfterRunning(ctx, target, notBefore, nil)
}

func lastDisplayStreamError(path string) (time.Time, string, bool) {
	boundary, ok := displayStreamLogBoundary(path)
	if !ok {
		return time.Time{}, "", false
	}
	return lastDisplayStreamErrorAfter(path, boundary)
}

func lastDisplayStreamErrorAfter(path string, boundary time.Time) (time.Time, string, bool) {
	when, detail, _, ok := lastDisplayStreamErrorRecordAfter(path, boundary)
	return when, detail, ok
}
