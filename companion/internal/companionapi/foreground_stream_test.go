package companionapi

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestForegroundStreamRequiresCurrentSessionFrameWithLegacyLabel(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "") // The Windows task uses the legacy default.
	server, err := New(Options{Home: t.TempDir(), DisplayStreamRunning: func() bool { return true }})
	if err != nil {
		t.Fatal(err)
	}
	target := "http://192.0.2.10"
	now := time.Now().UTC()
	marker := func(at time.Time) string {
		return fmt.Sprintf("%s runtime event=stream-start label=%q\n", at.Format(time.RFC3339Nano), displayStreamLaunchAgentLabel())
	}
	frame := func(at time.Time) string {
		return at.Format(time.RFC3339Nano) + " sent frame -> " + target + " transport=wifi source=oauth fresh=true provider=codex label=VibeTV session=73 weekly=58 reset=2733s\n"
	}
	oldFrame := frame(now.Add(-time.Second))
	for _, tc := range []struct {
		name    string
		log     string
		healthy bool
	}{
		{"missing marker", oldFrame, false},
		{"previous session frame", marker(now.Add(-2*time.Second)) + oldFrame + marker(now), false},
		{"current session frame", marker(now.Add(-2*time.Second)) + oldFrame + marker(now) + frame(now.Add(time.Millisecond)), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(logPath, []byte(tc.log), 0600); err != nil {
				t.Fatal(err)
			}
			for _, stream := range []displayStreamInfo{
				server.streamStatus(context.Background(), target),
				server.waitForDisplayStreamMode(context.Background(), target, time.Time{}, false, 0),
			} {
				if !stream.Running || stream.Healthy != tc.healthy || (!tc.healthy && stream.LastSentAt != "") {
					t.Fatalf("current session proof mismatch: %+v", stream)
				}
			}
		})
	}
}

func TestForegroundStreamUsesWorkerLifecycleAndFrameProof(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "test.foreground")
	oldPrint := printDisplayStreamService
	t.Cleanup(func() { printDisplayStreamService = oldPrint })
	printDisplayStreamService = func(context.Context, string) ([]byte, error) {
		t.Fatal("foreground worker must not query OS service status")
		return nil, nil
	}
	var running atomic.Bool
	server, err := New(Options{Home: t.TempDir(), DisplayStreamRunning: running.Load})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	target := "http://192.0.2.10"
	check := func(wantRunning, wantHealthy bool) {
		t.Helper()
		status := server.streamStatus(ctx, target)
		if status.Running != wantRunning || status.Healthy != wantHealthy {
			t.Fatalf("stream=%+v", status)
		}
		waited := server.waitForDisplayStreamMode(ctx, target, time.Time{}, false, 0)
		if waited.Running != wantRunning || waited.Healthy != wantHealthy {
			t.Fatalf("wait disagrees: %+v", waited)
		}
	}
	check(false, false)
	running.Store(true)
	check(true, false)
	now := time.Now().UTC()
	write := func(frameTime time.Time, frameTarget string) {
		t.Helper()
		data := now.Add(-5*time.Minute).Format(time.RFC3339Nano) + ` runtime event=stream-start label="test.foreground"` + "\n" + frameTime.Format(time.RFC3339Nano) + " sent frame -> " + frameTarget + " transport=wifi source=oauth fresh=true provider=codex label=VibeTV session=73 weekly=58 reset=2733s\n"
		if err := os.WriteFile(logPath, []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(now, target)
	check(true, true)
	if result := server.waitForDisplayStreamMode(ctx, target, now.Add(time.Second), false, 0); result.Healthy || result.LastSentAt != "" {
		t.Fatalf("ignored notBefore boundary: %+v", result)
	}
	write(now, "http://192.0.2.11")
	check(true, false)
	write(now.Add(-displayStreamReadyAge-time.Second), target)
	check(true, false)
	write(now, target)
	running.Store(false)
	check(false, false)
	if result := server.streamStatus(ctx, target); !strings.Contains(result.Detail, "not running") {
		t.Fatal(result)
	}
}
