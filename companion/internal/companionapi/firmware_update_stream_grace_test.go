package companionapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// Issue #826, Windows bench, public 1.0.65: the Cable update succeeded at
// 07:36:54Z, the runtime held its writes for the whole update, and its next
// frame landed at 07:37:25. The 30 s look at the stream ended just before it,
// so setup reported "Firmware is current, but the display stream still needs
// attention." although every frame after 07:37:25 arrived normally.
//
// frameAfter is how long after the stream restart the first frame shows up
// (negative: never). The normal wait is shortened to 700 ms and the update's
// grace period to 4 s, so a frame at 1.5 s is "late for the normal wait, inside
// the grace period".
func runCableFirmwareUpdateWithFrameAfter(t *testing.T, frameAfter time.Duration) firmwareUpdateJob {
	t.Helper()
	prevWait, prevGrace := displayStreamWaitTime, firmwareStreamVerifyTime
	displayStreamWaitTime, firmwareStreamVerifyTime = 700*time.Millisecond, 4*time.Second
	t.Cleanup(func() { displayStreamWaitTime, firmwareStreamVerifyTime = prevWait, prevGrace })

	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "test.firmware-grace")
	marker := fmt.Sprintf("%s runtime event=stream-start label=%q\n", time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano), displayStreamLaunchAgentLabel())
	if err := os.WriteFile(logPath, []byte(marker), 0o600); err != nil {
		t.Fatal(err)
	}

	const missing = `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"active":false,"path":"","hash":""}}}`
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("Cable update must not use HTTP: %s", r.URL.Path)
	}))
	defer device.Close()
	server := newTestServer(t, runtimeconfig.Config{ConnectionMode: "cable", DeviceTarget: device.URL, DeviceID: "setup-device", DeviceToken: "pair-token"})
	// Read the real stream log, not the healthy stream the test server fakes.
	server.waitStream, server.waitStreamAfter, server.waitStreamAfterPair = nil, nil, nil
	server.displayStreamRunning = func() bool { return true }
	server.resolveCablePort = func(string, string) (string, error) { return "/dev/mock-cable", nil }
	server.readCableHello = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{DeviceID: "setup-device", Board: "esp8266-smalltv-st7789", Firmware: "1.0.49", Features: []string{protocol.FeatureCableTransferV1, protocol.FeatureCableHealthV1}, Capabilities: protocol.CapabilityBlock{Transport: protocol.TransportCapabilities{Active: "usb", Mode: "cable"}}}, nil
	}
	server.readCableHealth = func(string, string) (deviceHealth, error) {
		var health deviceHealth
		err := json.Unmarshal([]byte(missing), &health)
		return health, err
	}
	// The stream restart is the moment the late frame is measured from.
	server.refreshStream = func(context.Context, string) error {
		if frameAfter >= 0 {
			go func() {
				time.Sleep(frameAfter)
				line := time.Now().UTC().Format(time.RFC3339Nano) + " sent frame -> /dev/mock-cable transport=usb deviceId=setup-device source=oauth fresh=true provider=codex label=VibeTV session=73 weekly=58 reset=2733s\n"
				file, err := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY, 0o600)
				if err != nil {
					return
				}
				defer file.Close()
				_, _ = file.WriteString(line)
			}()
		}
		return nil
	}
	server.updateFirmware = func(_ context.Context, _ string, _ runtimeconfig.Config, _ firmwareUpdateRequest, out io.Writer) error {
		_, err := io.WriteString(out, `CODEX_FIRMWARE_UPDATE_EVENT {"stage":"verifying_health","phase":"installing","firmware":"1.0.49","target":"`+cableDeviceTarget+`","deviceId":"setup-device","artifactValidated":true,"uploadAccepted":true}`+"\n")
		return err
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`)))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("install: %d %s", rec.Code, rec.Body.String())
	}
	var started firmwareUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	var job firmwareUpdateJob
	for attempt := 0; attempt < 1000; attempt++ {
		job, _ = server.firmwareUpdateJobSnapshot(started.Job.ID)
		if job.FinishedAt != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if job.FinishedAt == nil {
		t.Fatalf("update did not finish: %+v", job)
	}
	return job
}

func TestFirmwareUpdateWaitsForFirstFramesAfterThePause(t *testing.T) {
	// The first frame lands after the normal wait but inside the grace period.
	job := runCableFirmwareUpdateWithFrameAfter(t, 1500*time.Millisecond)
	if job.Phase != "complete" || job.Result == nil || !job.Result.StreamVerified {
		t.Fatalf("frames that resume inside the grace period must not need attention: phase=%q message=%q outcome=%q result=%+v", job.Phase, job.Message, job.Outcome, job.Result)
	}
	if strings.Contains(job.Message, "display stream still needs attention") {
		t.Fatalf("unexpected stream attention: %q", job.Message)
	}
}

func TestFirmwareUpdateReportsStreamAttentionWhenFramesStayMissing(t *testing.T) {
	job := runCableFirmwareUpdateWithFrameAfter(t, -1)
	if job.Phase != "attention" || job.Outcome != firmwareAttentionOutcome("stream") {
		t.Fatalf("a stream that stays missing must need attention: phase=%q outcome=%q message=%q result=%+v logs=%v", job.Phase, job.Outcome, job.Message, job.Result, job.Logs)
	}
	if job.Message != "Firmware is current, but the display stream still needs attention." {
		t.Fatalf("message=%q", job.Message)
	}
}
