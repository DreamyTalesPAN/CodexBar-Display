package themepack

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidatePublicHTTPSReferenceRejectsLocalAndInsecureTargets(t *testing.T) {
	for _, raw := range []string{
		"http://example.com/theme.zip",
		"https://127.0.0.1/theme.zip",
		"https://10.0.0.1/theme.zip",
		"https://169.254.169.254/latest/meta-data",
		"https://[::1]/theme.zip",
		"https://[fc00::1]/theme.zip",
		"https://100.64.0.1/theme.zip",
	} {
		t.Run(raw, func(t *testing.T) {
			if err := validatePublicHTTPSReference(raw); err == nil {
				t.Fatalf("expected %q to be blocked", raw)
			}
		})
	}
	if err := validatePublicHTTPSReference("https://example.com/theme.zip"); err != nil {
		t.Fatalf("expected public HTTPS URL to pass syntax policy: %v", err)
	}
}

func TestSecureRemoteClientRevalidatesRedirectTargets(t *testing.T) {
	client := secureRemoteClient(time.Second)
	req := &http.Request{URL: &url.URL{Scheme: "https", Host: "127.0.0.1", Path: "/private"}}
	if err := client.CheckRedirect(req, nil); err == nil {
		t.Fatal("expected redirect to a loopback address to be blocked")
	}
}

func TestLoadZipBytesVerifiedChecksPublisherMetadata(t *testing.T) {
	dir := writeThemePack(t, "")
	zipPath := filepath.Join(t.TempDir(), "cozy-meadow.zip")
	writeZipFromDir(t, zipPath, dir)
	data, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LoadZipBytesVerified(data, strings.Repeat("0", 64), int64(len(data))); err == nil || !strings.Contains(err.Error(), "sha256 mismatch") {
		t.Fatalf("expected sha256 mismatch, got %v", err)
	}
	if _, err := LoadZipBytesVerified(data, archiveSHA256(data), int64(len(data))+1); err == nil || !strings.Contains(err.Error(), "byte size mismatch") {
		t.Fatalf("expected byte size mismatch, got %v", err)
	}
	if _, err := LoadZipBytesVerified(data, archiveSHA256(data), int64(len(data))); err != nil {
		t.Fatalf("expected verified archive to load: %v", err)
	}
}

func archiveSHA256(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
