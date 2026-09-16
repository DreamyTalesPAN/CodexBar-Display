package companionapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWindowsReleaseUsesWindowsManifest(t *testing.T) {
	for _, tc := range []struct {
		name, body, status string
		code               int
		available          bool
	}{
		{"missing Windows release", ``, "missing_asset", 404, false},
		{"server error", ``, "check_failed", 500, false},
		{"malformed", `{`, "check_failed", 200, false},
		{"Mac only", `{"version":"9.0.0","platforms":{"darwin-aarch64":{"url":"https://example.com/mac.tar.gz","signature":"signed"}}}`, "missing_asset", 200, false},
		{"unsigned", `{"version":"2.0.0","platforms":{"windows-x86_64":{"url":"https://example.com/setup.exe"}}}`, "missing_asset", 200, false},
		{"new Windows release", `{"version":"2.0.0","platforms":{"windows-x86_64":{"url":"https://example.com/setup.exe","signature":"signed"}}}`, "available", 200, true},
		{"same version", `{"version":"1.0.0","platforms":{"windows-x86_64":{"url":"https://example.com/setup.exe","signature":"signed"}}}`, "available", 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(tc.code); _, _ = w.Write([]byte(tc.body)) }))
			defer srv.Close()
			got := fetchWindowsAppReleaseInfo(context.Background(), srv.URL, "1.0.0")
			if got.Status != tc.status || got.UpdateAvailable != tc.available {
				t.Fatalf("got %+v", got)
			}
		})
	}
}
