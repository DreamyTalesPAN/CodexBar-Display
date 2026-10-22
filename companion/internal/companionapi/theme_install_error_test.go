package companionapi

import (
	"errors"
	"fmt"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
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
}
