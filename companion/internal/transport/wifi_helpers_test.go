package transport

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestRetryableAssetStatusRetriesOnlyTimeoutsRateLimitsAndServerErrors(t *testing.T) {
	cases := []struct {
		status int
		want   bool
	}{
		{http.StatusOK, false},
		{http.StatusNotModified, false},
		{http.StatusBadRequest, false},
		{http.StatusUnauthorized, false},
		{http.StatusForbidden, false},
		{http.StatusNotFound, false},
		{http.StatusRequestTimeout, true},
		{http.StatusTooManyRequests, true},
		{http.StatusInternalServerError, true},
		{http.StatusNotImplemented, true},
		{http.StatusServiceUnavailable, true},
		{599, true},
		{600, false},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprint(tc.status), func(t *testing.T) {
			if got := retryableAssetStatus(tc.status); got != tc.want {
				t.Fatalf("retryableAssetStatus(%d) = %v, want %v", tc.status, got, tc.want)
			}
		})
	}
}

func TestPairDeviceAuthorizationRejectedMatchesOnlyAccessStatuses(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"no error", nil, false},
		{"unauthorized", errors.New(`post pairing: status=401 body=""`), true},
		{"forbidden", errors.New("post pairing: status=403"), true},
		{"not found", errors.New("post pairing: status=404"), true},
		{"rate limited", errors.New("post pairing: status=429"), true},
		{"status is matched case-insensitively", errors.New("POST PAIRING: STATUS=401"), true},
		{"server error is retried", errors.New("post pairing: status=500"), false},
		{"timeout is retried", errors.New("post pairing: context deadline exceeded"), false},
		{"bare code without status= is not matched", errors.New("401 unauthorized"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pairDeviceAuthorizationRejected(tc.err); got != tc.want {
				t.Fatalf("pairDeviceAuthorizationRejected(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestAssetUploadTimeoutForBytesScalesWithBodyWithinBounds(t *testing.T) {
	// Current formula: bytes / 8192 B/s + 15 s grace, clamped to [30 s, 5 min].
	cases := []struct {
		name  string
		bytes int
		want  time.Duration
	}{
		{"empty body uses the minimum", 0, 30 * time.Second},
		{"negative body uses the minimum", -1, 30 * time.Second},
		{"small body uses the minimum", 20 * 1024, 30 * time.Second},
		{"scaled time reaches the minimum exactly", 15 * 8192, 30 * time.Second},
		{"one byte less than that still uses the minimum", 15*8192 - 1, 30 * time.Second},
		{"scaled time above the minimum", 60 * 8192, 75 * time.Second},
		{"scaled time reaches the maximum exactly", 285 * 8192, 5 * time.Minute},
		{"large body is capped at the maximum", 10 << 20, 5 * time.Minute},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := assetUploadTimeoutForBytes(tc.bytes); got != tc.want {
				t.Fatalf("assetUploadTimeoutForBytes(%d) = %s, want %s", tc.bytes, got, tc.want)
			}
		})
	}
}

func TestIsVibeTVHelloNeedsKnownCapabilitiesAndAVibeTVSignal(t *testing.T) {
	cases := []struct {
		name  string
		hello string
		want  bool
	}{
		{"smalltv board with wifi transport", `{"kind":"hello","board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`, true},
		{"vibetv board on usb", `{"kind":"hello","board":"VibeTV-Mini","capabilities":{"transport":{"active":"usb"}}}`, true},
		{"codexbar board on usb", `{"kind":"hello","board":"CodexBar-Display","capabilities":{"transport":{"active":"usb"}}}`, true},
		{"unknown board with theme-spec and wifi active", `{"kind":"hello","board":"other-board","features":["theme-spec-v1"],"capabilities":{"transport":{"active":"wifi"}}}`, true},
		{"unknown board with theme-spec and wifi listed as supported", `{"kind":"hello","board":"other-board","features":["theme-spec-v1"],"capabilities":{"transport":{"active":"usb","supported":["usb","wifi"]}}}`, true},
		{"unknown board with theme-spec on usb only", `{"kind":"hello","board":"other-board","features":["theme-spec-v1"],"capabilities":{"transport":{"active":"usb","supported":["usb"]}}}`, false},
		{"unknown board with wifi but no theme-spec", `{"kind":"hello","board":"other-board","capabilities":{"transport":{"active":"wifi"}}}`, false},
		{"smalltv board without kind hello is not known", `{"board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var hello protocol.DeviceHello
			if err := json.Unmarshal([]byte(tc.hello), &hello); err != nil {
				t.Fatalf("fixture does not parse: %v", err)
			}
			if got := isVibeTVHello(hello); got != tc.want {
				t.Fatalf("isVibeTVHello = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMatchesExpectedDeviceIDIgnoresCaseAndSpacesAndAcceptsAnyWhenUnset(t *testing.T) {
	cases := []struct {
		name     string
		expected string
		deviceID string
		want     bool
	}{
		{"empty expectation accepts any device", "", "vt-01", true},
		{"blank expectation accepts a device without id", "   ", "", true},
		{"exact match", "vt-01", "vt-01", true},
		{"case-insensitive match", "VT-01", "vt-01", true},
		{"surrounding spaces are ignored", "  vt-01 ", "vt-01", true},
		{"different device is rejected", "vt-01", "vt-02", false},
		{"device without id does not match a named expectation", "vt-01", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hello := protocol.DeviceHello{DeviceID: tc.deviceID}
			if got := matchesExpectedDeviceID(hello, tc.expected); got != tc.want {
				t.Fatalf("matchesExpectedDeviceID(%q, %q) = %v, want %v", tc.deviceID, tc.expected, got, tc.want)
			}
		})
	}
}

func TestUniqueDiscoveryTargetsNormalizesDropsBlanksAndDuplicates(t *testing.T) {
	got := uniqueDiscoveryTargets([]string{
		"http://192.168.178.123/",
		"192.168.178.123",
		" http://192.168.178.123 ",
		"",
		"   ",
		"192.168.178.124?token=abc",
		"192.168.178.124",
	})
	want := []string{"http://192.168.178.123", "http://192.168.178.124"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("uniqueDiscoveryTargets = %q, want %q", got, want)
	}
	// Unsupported schemes fail normalization and pass through with only the
	// trailing slash removed; the probe then rejects them.
	if got := uniqueDiscoveryTargets([]string{"ftp://192.168.178.125/"}); strings.Join(got, ",") != "ftp://192.168.178.125" {
		t.Fatalf("unsupported scheme target = %q", got)
	}
}

// Issue #526: probeWiFiHello says a hello without capabilities is not a found
// VibeTV. Known is also set by a board alone, so isVibeTVHello needs the
// transport from the capabilities block as well.
func TestIsVibeTVHelloRejectsBoardOnlyHelloWithoutCapabilities(t *testing.T) {
	var hello protocol.DeviceHello
	if err := json.Unmarshal([]byte(`{"kind":"hello","board":"esp8266-smalltv-st7789"}`), &hello); err != nil {
		t.Fatalf("fixture does not parse: %v", err)
	}
	if isVibeTVHello(hello) {
		t.Fatal("a hello without capabilities must not count as a found VibeTV")
	}
}

// The WiFi hello of the first WiFi-first firmware in the repository history
// (2cad00b1): the capabilities block of its wifi branch, complete. Discovery
// must still find that VibeTV.
func TestIsVibeTVHelloAcceptsTheOldestWiFiHelloWithCapabilities(t *testing.T) {
	const body = `{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","deviceId":"14799300","features":["theme","theme-spec-v1"],"maxFrameBytes":1024,"capabilities":{"display":{"widthPx":240,"heightPx":240,"colorDepthBits":16},"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1024,"maxThemePrimitives":32,"builtinThemes":["classic","crt","mini"]},"transport":{"active":"wifi","supported":["usb","wifi"]}}}`
	hello, err := protocol.DecodeWiFiHello(strings.NewReader(body))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !isVibeTVHello(hello) {
		t.Fatalf("the oldest WiFi hello with capabilities must count as a found VibeTV: %+v", hello)
	}
}

func TestPathsWithPrefixReturnsMatchingPathsInSnapshotOrder(t *testing.T) {
	snapshot := DeviceAssetsSnapshot{Assets: []DeviceAsset{
		{Path: "/themes/u/a.cbi", SizeBytes: 1},
		{Path: "/themes/s/b.cbi", SizeBytes: 2},
		{Path: "/themes/u/c.cba", SizeBytes: 3},
	}}
	cases := []struct {
		name   string
		prefix string
		want   string
	}{
		{"live prefix", "/themes/u/", "/themes/u/a.cbi,/themes/u/c.cba"},
		{"surrounding spaces in prefix are ignored", "  /themes/s/ ", "/themes/s/b.cbi"},
		{"no match", "/themes/x/", ""},
		{"empty prefix matches nothing", "", ""},
		{"blank prefix matches nothing", "   ", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := strings.Join(snapshot.PathsWithPrefix(tc.prefix), ","); got != tc.want {
				t.Fatalf("PathsWithPrefix(%q) = %q, want %q", tc.prefix, got, tc.want)
			}
		})
	}
}
