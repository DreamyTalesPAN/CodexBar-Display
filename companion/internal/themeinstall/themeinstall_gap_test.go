package themeinstall

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
)

// A pack source is either a local pack, a catalog entry or nothing. Catalogs
// are local files here, so no test touches the network.
func TestResolveSourceBranches(t *testing.T) {
	dir := t.TempDir()
	catalogPath := filepath.Join(dir, "catalog.json")
	catalog := `{"schemaVersion":1,"themes":[` +
		`{"id":"mini-classic","title":"Mini","downloadAsset":"packs/mini.zip","sha256":"` + strings.Repeat("AB", 32) + `","bytes":123},` +
		`{"id":"remote-theme","title":"Remote","downloadUrl":"https://example.com/remote.zip","sha256":"` + strings.Repeat("cd", 32) + `","bytes":456}]}`
	if err := os.WriteFile(catalogPath, []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	localPack := filepath.Join(dir, "pack.zip")

	tests := []struct {
		name       string
		packPath   string
		catalogRef string
		themeID    string
		packSHA    string
		packBytes  int64
		want       ResolvedSource
		wantErr    string
		wantAnyErr bool
	}{
		{
			name:      "local pack is used verbatim with its digest and size",
			packPath:  localPack,
			packSHA:   "abcd",
			packBytes: 99,
			want:      ResolvedSource{Path: localPack, SHA256: "abcd", Bytes: 99},
		},
		{
			name:       "local pack and catalog together are rejected",
			packPath:   localPack,
			catalogRef: catalogPath,
			wantErr:    "use either packUrl or catalogUrl, not both",
		},
		{
			name:    "neither pack nor theme id is rejected",
			wantErr: "missing theme pack source",
		},
		{
			name:       "catalog theme id matches case-insensitively and resolves a relative asset",
			catalogRef: catalogPath,
			themeID:    "MINI-classic",
			want: ResolvedSource{
				Path:   filepath.Join(dir, "packs", "mini.zip"),
				SHA256: strings.Repeat("ab", 32),
				Bytes:  123,
			},
		},
		{
			name:       "catalog entry with a download URL keeps the URL",
			catalogRef: catalogPath,
			themeID:    "remote-theme",
			want: ResolvedSource{
				Path:   "https://example.com/remote.zip",
				SHA256: strings.Repeat("cd", 32),
				Bytes:  456,
			},
		},
		{
			name:       "unknown theme id is reported",
			catalogRef: catalogPath,
			themeID:    "does-not-exist",
			wantErr:    `theme "does-not-exist" not found in catalog`,
		},
		{
			name:       "catalog without a theme id is rejected",
			catalogRef: catalogPath,
			wantErr:    "missing theme id",
		},
		{
			name:       "unreadable catalog file is an error",
			catalogRef: filepath.Join(dir, "missing.json"),
			themeID:    "mini-classic",
			wantAnyErr: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveSource(tc.packPath, tc.catalogRef, tc.themeID, tc.packSHA, tc.packBytes)
			switch {
			case tc.wantErr != "":
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
				}
			case tc.wantAnyErr:
				if err == nil {
					t.Fatal("expected an error")
				}
			default:
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if got != tc.want {
					t.Fatalf("resolveSource = %+v, want %+v", got, tc.want)
				}
			}
		})
	}
}

// Transient failures are retried; auth and not-found answers are not, because
// retrying them cannot succeed.
func TestThemeInstallRetryableErrorClassifiesTransientFailures(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil error", err: nil, want: false},
		{name: "gateway status", err: errors.New("get device hello: status=503 body=\"\""), want: true},
		{name: "rate limit status", err: errors.New("upload: status=429"), want: true},
		{name: "timeout text", err: errors.New("device timeout while reading"), want: true},
		{name: "connection reset in mixed case", err: errors.New("Connection Reset by peer"), want: true},
		{name: "unexpected EOF is retryable", err: errors.New("unexpected EOF"), want: true},
		{name: "unauthorized is not retryable", err: errors.New("status=401 unauthorized"), want: false},
		{name: "not found is not retryable", err: errors.New("status=404 not found"), want: false},
		{name: "invalid pack is not retryable", err: errors.New("invalid theme pack"), want: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := themeInstallRetryableError(tc.err); got != tc.want {
				t.Fatalf("themeInstallRetryableError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// The device is faked in-process: the transport never dials, so the test cannot
// reach a real VibeTV on the network.
func fakeDeviceTransport(body []byte, transportErr error) transportlayer.WiFiTransport {
	return transportlayer.NewWiFiTransportWithClient(&http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if transportErr != nil {
				return nil, transportErr
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": {"application/json"}},
				Body:       io.NopCloser(bytes.NewReader(body)),
				Request:    r,
			}, nil
		}),
	})
}

func TestThemeInstallCapabilitiesFallsBackOnlyWhenAllowed(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeUsageSlotsThemeHello(t, recorder, false)
	knownHello := recorder.Body.Bytes()
	// Without any capability field the hello is accepted but stays unknown.
	unknownHello := []byte(`{"kind":"hello"}`)
	unreachable := errors.New("dial tcp 192.0.2.10:80: connection refused")
	const displayTarget = "192.0.2.10"

	t.Run("known device returns its own capabilities without fallback", func(t *testing.T) {
		var out bytes.Buffer
		caps, err := themeInstallCapabilities(fakeDeviceTransport(knownHello, nil), "http://"+displayTarget, displayTarget, false, false, &out)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !caps.Known {
			t.Fatal("expected known capabilities from the hello")
		}
		if strings.Contains(out.String(), "fallback") {
			t.Fatalf("known device must not print the fallback note: %q", out.String())
		}
	})

	t.Run("unreachable device is a check-device error without allowUnknown", func(t *testing.T) {
		var out bytes.Buffer
		_, err := themeInstallCapabilities(fakeDeviceTransport(nil, unreachable), "http://"+displayTarget, displayTarget, false, false, &out)
		var installErr *InstallError
		if !errors.As(err, &installErr) {
			t.Fatalf("expected *InstallError, got %T: %v", err, err)
		}
		if installErr.Op != "theme-pack/check-device" || installErr.Code != errcode.UpgradeFlashFirmware {
			t.Fatalf("op=%q code=%q, want theme-pack/check-device and %q", installErr.Op, installErr.Code, errcode.UpgradeFlashFirmware)
		}
		if !strings.Contains(installErr.Error(), "VibeTV is not reachable at "+displayTarget) {
			t.Fatalf("message does not name the device: %q", installErr.Error())
		}
		if installErr.RecoveryAction() == "" {
			t.Fatal("expected a recovery hint for the customer")
		}
		if out.Len() != 0 {
			t.Fatalf("no fallback must be announced on refusal: %q", out.String())
		}
	})

	t.Run("unreachable device uses the local fallback profile with allowUnknown", func(t *testing.T) {
		var out bytes.Buffer
		caps, err := themeInstallCapabilities(fakeDeviceTransport(nil, unreachable), "http://"+displayTarget, displayTarget, true, true, &out)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !caps.Known || caps.ActiveTransport != "wifi" {
			t.Fatalf("expected known wifi fallback, got known=%v transport=%q", caps.Known, caps.ActiveTransport)
		}
		if !strings.Contains(out.String(), "using local fallback profile") {
			t.Fatalf("fallback not announced: %q", out.String())
		}
		if !strings.Contains(out.String(), "hello unavailable for "+displayTarget) {
			t.Fatalf("verbose warning missing: %q", out.String())
		}
	})

	t.Run("unknown hello is refused without allowUnknown", func(t *testing.T) {
		_, err := themeInstallCapabilities(fakeDeviceTransport(unknownHello, nil), "http://"+displayTarget, displayTarget, false, false, io.Discard)
		var installErr *InstallError
		if !errors.As(err, &installErr) {
			t.Fatalf("expected *InstallError, got %T: %v", err, err)
		}
		if installErr.Op != "theme-pack/capabilities" || installErr.Code != errcode.ProtocolThemeSpecIncompatible {
			t.Fatalf("op=%q code=%q, want theme-pack/capabilities and %q", installErr.Op, installErr.Code, errcode.ProtocolThemeSpecIncompatible)
		}
	})

	t.Run("unknown hello uses the fallback profile with allowUnknown", func(t *testing.T) {
		var out bytes.Buffer
		caps, err := themeInstallCapabilities(fakeDeviceTransport(unknownHello, nil), "http://"+displayTarget, displayTarget, true, false, &out)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !caps.Known || caps.ActiveTransport != "wifi" {
			t.Fatalf("expected known wifi fallback, got known=%v transport=%q", caps.Known, caps.ActiveTransport)
		}
		if !strings.Contains(out.String(), "using local fallback profile") {
			t.Fatalf("fallback not announced: %q", out.String())
		}
	})
}

// The health error is what the customer sees after an upload, so it names the
// asset and keeps the underlying cause reachable for logs.
func TestUploadHealthErrorNamesTheAssetAndKeepsTheCause(t *testing.T) {
	cause := errors.New("connection refused")
	err := &uploadHealthError{devicePath: "/themes/mini/mini.gif", err: cause}
	if got, want := err.Error(), "device did not answer health check after uploading /themes/mini/mini.gif"; got != want {
		t.Fatalf("Error() = %q, want %q", got, want)
	}
	if !errors.Is(err, cause) {
		t.Fatal("expected the cause to stay reachable through Unwrap")
	}
}

func TestUploadAssetVerifyErrorDescribesEachFailure(t *testing.T) {
	cause := errors.New("asset list timed out")
	const devicePath = "/themes/mini/mini.gif"
	tests := []struct {
		name    string
		err     *uploadAssetVerifyError
		want    string
		wrapped error
	}{
		{
			name:    "asset list request failed",
			err:     &uploadAssetVerifyError{devicePath: devicePath, err: cause},
			want:    "device asset list failed after uploading " + devicePath + ": asset list timed out",
			wrapped: cause,
		},
		{
			name: "asset is missing on the device",
			err:  &uploadAssetVerifyError{devicePath: devicePath, expectedBytes: 20},
			want: "uploaded asset " + devicePath + " is missing on VibeTV",
		},
		{
			name: "asset has the wrong size",
			err:  &uploadAssetVerifyError{devicePath: devicePath, expectedBytes: 20, actualBytes: 10, found: true},
			want: "uploaded asset " + devicePath + " has size 10 bytes, expected 20",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.err.Error(); got != tc.want {
				t.Fatalf("Error() = %q, want %q", got, tc.want)
			}
			if tc.wrapped != nil && !errors.Is(tc.err, tc.wrapped) {
				t.Fatal("expected the cause to stay reachable through Unwrap")
			}
		})
	}
}
