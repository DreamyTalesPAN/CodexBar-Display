package companionapi

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
)

// Issue #927: when VibeTV did not answer the first check of a WiFi install,
// the dialog showed the engine's text and a hint written for the CLI.
func TestThemeInstallDeviceNoAnswerIsPlainText(t *testing.T) {
	noAnswer := &themeinstall.InstallError{
		Op:   "theme-pack/check-device",
		Code: errcode.UpgradeFlashFirmware,
		Err:  fmt.Errorf("VibeTV is not reachable at http://192.168.178.189: %w", errors.New("decode device hello: unexpected EOF")),
		Hint: "check VibeTV power/WiFi or pass --target http://<device-ip>",
	}
	want := apiError{
		Code:       "device_unreachable",
		Message:    "VibeTV didn't answer.",
		NextAction: "Check that VibeTV is on and near your WiFi, then try again.",
	}
	for _, slot := range []string{"live", "screensaver"} {
		if _, got := themeInstallErrorPayload(slot, noAnswer); got != want {
			t.Fatalf("%s: got %+v, want %+v", slot, got, want)
		}
	}

	// Other install steps keep their own wording.
	upload := &themeinstall.InstallError{Op: "theme-pack/upload", Code: errcode.UpgradeFlashFirmware, Err: errors.New("write /themes/u/a.json: timeout")}
	if _, got := themeInstallErrorPayload("live", upload); got.Code == want.Code || got.Message == want.Message {
		t.Fatalf("an upload failure must not read as no answer, got %+v", got)
	}

	// A VibeTV that rejects a stale token did answer. Moving it nearer the
	// WiFi cannot help, so the check keeps its earlier wording (PR #943 review).
	rejected := &themeinstall.InstallError{
		Op:   "theme-pack/check-device",
		Code: errcode.UpgradeFlashFirmware,
		Err:  fmt.Errorf("VibeTV is not reachable at http://192.168.178.189: %w", errors.New(`get device hello: status=401 body="unauthorized"`)),
		Hint: "check VibeTV power/WiFi or pass --target http://<device-ip>",
	}
	if _, got := themeInstallErrorPayload("live", rejected); got.Code == want.Code || got.Message == want.Message {
		t.Fatalf("a rejected token must not read as no answer, got %+v", got)
	}
}

// checkDeviceAnswer runs the first check of a WiFi install against a VibeTV
// that answers /hello with status and body, through the real WiFi transport,
// and wraps the failure as the install engine does.
func checkDeviceAnswer(t *testing.T, status int, body []byte) error {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(body)
	}))
	defer server.Close()
	_, err := transportlayer.NewWiFiTransportWithClient(server.Client()).DeviceCapabilities(server.URL)
	if err == nil {
		t.Fatalf("/hello status %d must fail the check", status)
	}
	return &themeinstall.InstallError{
		Op:   "theme-pack/check-device",
		Code: errcode.UpgradeFlashFirmware,
		Err:  fmt.Errorf("VibeTV is not reachable at %s: %w", server.URL, err),
		Hint: "check VibeTV power/WiFi or pass --target http://<device-ip>",
	}
}

// Issue #953: firmware 1.0.45 at low heap answers /hello without its
// capabilities block. VibeTV did answer, so it is not "didn't answer"; a
// restart frees its memory.
func TestThemeInstallIncompleteHelloSaysVibeTVIsBusy(t *testing.T) {
	body, err := os.ReadFile("../protocol/testdata/wifi-hello-1.0.45-without-capabilities.txt")
	if err != nil {
		t.Fatal(err)
	}
	want := apiError{
		Code:       "device_busy",
		Message:    "VibeTV is busy right now.",
		NextAction: "Unplug VibeTV for a few seconds, plug it back in, then try again.",
	}
	incomplete := checkDeviceAnswer(t, http.StatusOK, body)
	for _, slot := range []string{"live", "screensaver"} {
		if _, got := themeInstallErrorPayload(slot, incomplete); got != want {
			t.Fatalf("%s: got %+v, want %+v", slot, got, want)
		}
	}
}

// PR #943 review: a 401 from the real WiFi transport keeps the check's earlier
// wording. This pins the transport's status text the no-answer rule relies on.
func TestThemeInstallRejectedTokenFromTransportIsNotNoAnswer(t *testing.T) {
	rejected := checkDeviceAnswer(t, http.StatusUnauthorized, []byte("unauthorized"))
	if _, got := themeInstallErrorPayload("live", rejected); got.Code == "device_unreachable" || got.Code == "device_busy" {
		t.Fatalf("a rejected token must keep the earlier wording, got %+v", got)
	}
}
