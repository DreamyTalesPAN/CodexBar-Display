package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
)

type recordingWriter struct {
	writes [][]byte
}

func (w *recordingWriter) Write(p []byte) (int, error) {
	w.writes = append(w.writes, append([]byte(nil), p...))
	return len(p), nil
}

func TestRawFirmwareBodyWriterSegmentsBody(t *testing.T) {
	destination := &recordingWriter{}
	writer := &rawFirmwareBodyWriter{destination: destination}
	body := bytes.Repeat([]byte{0xa5}, 130)

	if _, err := writer.Write(body); err != nil {
		t.Fatalf("write body: %v", err)
	}
	if len(destination.writes) != 3 {
		t.Fatalf("expected three body writes, got %d", len(destination.writes))
	}
	for i, write := range destination.writes {
		if len(write) > otaRawWriteChunkBytes {
			t.Fatalf("body write %d has %d bytes, want at most %d", i, len(write), otaRawWriteChunkBytes)
		}
	}
	if got := bytes.Join(destination.writes, nil); !bytes.Equal(got, body) {
		t.Fatal("segmented body does not match input")
	}
}

func TestRawFirmwareBodyWriterWaitsForBodyBlockAcks(t *testing.T) {
	destination := &recordingWriter{}
	ackCalls := 0
	writer := &rawFirmwareBodyWriter{
		destination: destination,
		waitForAck: func() error {
			ackCalls++
			return nil
		},
	}
	body := bytes.Repeat([]byte{0x5a}, 2*otaRawAckBlockBytes+1)

	if _, err := writer.Write(body); err != nil {
		t.Fatalf("write body: %v", err)
	}
	if ackCalls != 2 {
		t.Fatalf("expected two body-block acks, got %d", ackCalls)
	}
}

func TestReleaseStateRoundTrip(t *testing.T) {
	home := t.TempDir()
	state := releaseState{
		SchemaVersion: releaseStateSchemaVersion,
		LastKnownGood: lastKnownGoodState{
			CompanionBinary:  "/tmp/codexbar-display-lkg",
			CompanionVersion: "1.0.0",
			FirmwareImage:    "/tmp/firmware.bin",
			FirmwareManifest: "/tmp/firmware.bin.manifest",
			FirmwareEnv:      "esp8266_smalltv_st7789",
		},
	}

	if err := saveReleaseState(home, state); err != nil {
		t.Fatalf("save release state: %v", err)
	}

	loaded, err := loadReleaseState(home)
	if err != nil {
		t.Fatalf("load release state: %v", err)
	}
	if loaded.SchemaVersion != releaseStateSchemaVersion {
		t.Fatalf("unexpected schema version %d", loaded.SchemaVersion)
	}
	if loaded.LastKnownGood.CompanionVersion != "1.0.0" {
		t.Fatalf("unexpected companion version %q", loaded.LastKnownGood.CompanionVersion)
	}
	if loaded.LastKnownGood.FirmwareEnv != "esp8266_smalltv_st7789" {
		t.Fatalf("unexpected firmware env %q", loaded.LastKnownGood.FirmwareEnv)
	}
}

func TestSnapshotInstalledCompanionBinaryMissingInstall(t *testing.T) {
	home := t.TempDir()
	path, version, err := snapshotInstalledCompanionBinary(home)
	if err != nil {
		t.Fatalf("snapshot companion binary: %v", err)
	}
	if path != "" || version != "" {
		t.Fatalf("expected empty snapshot for missing install, got path=%q version=%q", path, version)
	}
}

func TestCopyRegularFileAtomic(t *testing.T) {
	tmp := t.TempDir()
	source := filepath.Join(tmp, "source.txt")
	target := filepath.Join(tmp, "nested", "target.txt")

	if err := os.WriteFile(source, []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("mkdir target dir: %v", err)
	}

	if err := copyRegularFileAtomic(source, target, 0o644); err != nil {
		t.Fatalf("copy file: %v", err)
	}

	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(data) != "hello\n" {
		t.Fatalf("unexpected target content %q", string(data))
	}
}

func TestSanitizePathToken(t *testing.T) {
	if got := sanitizePathToken("v1.0.0+meta/alpha"); got != "v1.0.0_meta_alpha" {
		t.Fatalf("unexpected sanitized token %q", got)
	}
}

func TestRefreshLastKnownGoodFirmwareUpdatesPrepopulatedState(t *testing.T) {
	scratch := t.TempDir()
	home := filepath.Join(scratch, "home")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatalf("mkdir home: %v", err)
	}
	t.Setenv("HOME", home)

	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(scratch); err != nil {
		t.Fatalf("chdir scratch: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	backupDir := filepath.Join(scratch, "backups")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		t.Fatalf("mkdir backup dir: %v", err)
	}

	olderImage := filepath.Join(backupDir, "weather_backup_old.bin")
	newerImage := filepath.Join(backupDir, "weather_backup_new.bin")
	for _, image := range []string{olderImage, newerImage} {
		if err := os.WriteFile(image, []byte("firmware"), 0o644); err != nil {
			t.Fatalf("write image %s: %v", image, err)
		}
		if err := os.WriteFile(image+".manifest", []byte("{}"), 0o644); err != nil {
			t.Fatalf("write manifest for %s: %v", image, err)
		}
	}

	now := time.Now()
	if err := os.Chtimes(olderImage, now.Add(-2*time.Hour), now.Add(-2*time.Hour)); err != nil {
		t.Fatalf("set older mtime: %v", err)
	}
	if err := os.Chtimes(newerImage, now.Add(-1*time.Hour), now.Add(-1*time.Hour)); err != nil {
		t.Fatalf("set newer mtime: %v", err)
	}

	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    filepath.Join(scratch, "stale.bin"),
			FirmwareManifest: filepath.Join(scratch, "stale.bin.manifest"),
		},
	}

	refreshLastKnownGoodFirmware(&state, []string{backupDir})

	if state.LastKnownGood.FirmwareImage != newerImage {
		t.Fatalf("expected refreshed image %q, got %q", newerImage, state.LastKnownGood.FirmwareImage)
	}
	if state.LastKnownGood.FirmwareManifest != newerImage+".manifest" {
		t.Fatalf(
			"expected refreshed manifest %q, got %q",
			newerImage+".manifest",
			state.LastKnownGood.FirmwareManifest,
		)
	}
}

func TestRefreshLastKnownGoodFirmwareKeepsStateWhenNoValidBackupFound(t *testing.T) {
	scratch := t.TempDir()
	home := filepath.Join(scratch, "home")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatalf("mkdir home: %v", err)
	}
	t.Setenv("HOME", home)

	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(scratch); err != nil {
		t.Fatalf("chdir scratch: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	backupDir := filepath.Join(scratch, "backups")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		t.Fatalf("mkdir backup dir: %v", err)
	}
	invalidImage := filepath.Join(backupDir, "weather_backup_invalid.bin")
	if err := os.WriteFile(invalidImage, []byte("firmware"), 0o644); err != nil {
		t.Fatalf("write invalid image: %v", err)
	}

	const (
		existingImage    = "/tmp/existing.bin"
		existingManifest = "/tmp/existing.bin.manifest"
	)
	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    existingImage,
			FirmwareManifest: existingManifest,
		},
	}

	refreshLastKnownGoodFirmware(&state, []string{backupDir})

	if state.LastKnownGood.FirmwareImage != existingImage {
		t.Fatalf("expected image to stay %q, got %q", existingImage, state.LastKnownGood.FirmwareImage)
	}
	if state.LastKnownGood.FirmwareManifest != existingManifest {
		t.Fatalf("expected manifest to stay %q, got %q", existingManifest, state.LastKnownGood.FirmwareManifest)
	}
}

func TestResolveRollbackFirmwareInputsUsesStateImageAndManifest(t *testing.T) {
	tmp := t.TempDir()
	imagePath := filepath.Join(tmp, "known-good.bin")
	manifestPath := imagePath + ".manifest"
	if err := os.WriteFile(imagePath, []byte("firmware"), 0o644); err != nil {
		t.Fatalf("write image: %v", err)
	}
	if err := os.WriteFile(manifestPath, []byte("{}"), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    imagePath,
			FirmwareManifest: manifestPath,
		},
	}

	gotImage, gotManifest, stale := resolveRollbackFirmwareInputs("", "", state)
	if stale {
		t.Fatal("expected stale=false for existing state image")
	}
	if gotImage != imagePath {
		t.Fatalf("unexpected image %q", gotImage)
	}
	if gotManifest != manifestPath {
		t.Fatalf("unexpected manifest %q", gotManifest)
	}
}

func TestResolveRollbackFirmwareInputsFallbackWhenStateImageMissing(t *testing.T) {
	tmp := t.TempDir()
	staleImage := filepath.Join(tmp, "missing.bin")
	staleManifest := staleImage + ".manifest"

	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    staleImage,
			FirmwareManifest: staleManifest,
		},
	}

	gotImage, gotManifest, stale := resolveRollbackFirmwareInputs("", "", state)
	if !stale {
		t.Fatal("expected stale=true for missing state image")
	}
	if gotImage != "" {
		t.Fatalf("expected empty image for fallback, got %q", gotImage)
	}
	if gotManifest != "" {
		t.Fatalf("expected empty manifest for fallback, got %q", gotManifest)
	}
}

func TestResolveRollbackFirmwareInputsKeepsExplicitImageAndManifest(t *testing.T) {
	state := releaseState{
		LastKnownGood: lastKnownGoodState{
			FirmwareImage:    "/tmp/state-image.bin",
			FirmwareManifest: "/tmp/state-image.bin.manifest",
		},
	}

	gotImage, gotManifest, stale := resolveRollbackFirmwareInputs(" /tmp/requested.bin ", " /tmp/requested.manifest ", state)
	if stale {
		t.Fatal("expected stale=false for explicit image input")
	}
	if gotImage != "/tmp/requested.bin" {
		t.Fatalf("unexpected explicit image %q", gotImage)
	}
	if gotManifest != "/tmp/requested.manifest" {
		t.Fatalf("unexpected explicit manifest %q", gotManifest)
	}
}

func TestSelectReleaseFirmwareArtifact(t *testing.T) {
	manifest := releaseFirmwareManifest{
		Artifacts: []releaseFirmwareArtifact{
			{
				FirmwareEnv:     "lilygo_t_display_s3",
				FirmwareVersion: "1.0.3",
				Asset:           "lilygo.bin",
				SHA256:          strings.Repeat("a", 64),
			},
			{
				FirmwareEnv:     "esp8266_smalltv_st7789",
				FirmwareVersion: "1.0.3",
				Asset:           "mini.bin",
				SHA256:          strings.Repeat("b", 64),
			},
		},
	}

	artifact, err := selectReleaseFirmwareArtifact(manifest, "esp8266_smalltv_st7789", "v1.0.3")
	if err != nil {
		t.Fatalf("select artifact: %v", err)
	}
	if artifact.Asset != "mini.bin" {
		t.Fatalf("unexpected asset %q", artifact.Asset)
	}
}

func TestDownloadReleaseFirmwareVerifiesManifestAndChecksum(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	home := t.TempDir()
	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	manifestBody := `{
  "schemaVersion": 1,
  "release": "v1.0.3",
  "protocolVersion": 1,
  "artifacts": [
    {
      "firmwareEnv": "esp8266_smalltv_st7789",
      "board": "esp8266-smalltv-st7789",
      "firmwareVersion": "1.0.3",
      "asset": "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin",
      "sha256": "` + imageSHA + `"
    }
  ]
}`

	releaseHTTPClient = fakeReleaseHTTPClient{
		responses: map[string]string{
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/firmware-manifest-v1.0.3.json":                               manifestBody,
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin": imageBody,
		},
	}

	imagePath, manifestPath, artifact, err := downloadReleaseFirmware(
		context.Background(),
		home,
		"DreamyTalesPAN/CodexBar-Display",
		"v1.0.3",
		"1.0.3",
		"esp8266_smalltv_st7789",
	)
	if err != nil {
		t.Fatalf("download release firmware: %v", err)
	}
	if artifact.Asset != "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin" {
		t.Fatalf("unexpected artifact asset %q", artifact.Asset)
	}
	if data, err := os.ReadFile(imagePath); err != nil || string(data) != imageBody {
		t.Fatalf("unexpected image data data=%q err=%v", string(data), err)
	}
	if data, err := os.ReadFile(manifestPath); err != nil || !strings.Contains(string(data), `"release": "v1.0.3"`) {
		t.Fatalf("unexpected manifest data data=%q err=%v", string(data), err)
	}
}

func TestDownloadReleaseFirmwareDecompressesGzipForSerialFlash(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	home := t.TempDir()
	imageBody := "firmware image"
	gzBody := gzipString(t, imageBody)
	imageSHA := sha256String(gzBody)
	manifestBody := `{
  "schemaVersion": 1,
  "release": "v1.0.3",
  "protocolVersion": 1,
  "artifacts": [
    {
      "firmwareEnv": "esp8266_smalltv_st7789",
      "board": "esp8266-smalltv-st7789",
      "firmwareVersion": "1.0.3",
      "asset": "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin.gz",
      "sha256": "` + imageSHA + `"
    }
  ]
}`

	releaseHTTPClient = fakeReleaseHTTPClient{
		responses: map[string]string{
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/firmware-manifest-v1.0.3.json":                                  manifestBody,
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin.gz": gzBody,
		},
	}

	imagePath, _, artifact, err := downloadReleaseFirmware(
		context.Background(),
		home,
		"DreamyTalesPAN/CodexBar-Display",
		"v1.0.3",
		"1.0.3",
		"esp8266_smalltv_st7789",
	)
	if err != nil {
		t.Fatalf("download release firmware: %v", err)
	}
	if artifact.Asset != "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin.gz" {
		t.Fatalf("unexpected artifact asset %q", artifact.Asset)
	}
	if strings.HasSuffix(imagePath, ".gz") {
		t.Fatalf("expected decompressed image path, got %s", imagePath)
	}
	if data, err := os.ReadFile(imagePath); err != nil || string(data) != imageBody {
		t.Fatalf("unexpected image data data=%q err=%v", string(data), err)
	}
}

func TestDownloadManifestFirmwareArtifactDecompressesGzipForOTA(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	home := t.TempDir()
	imageBody := "firmware image"
	gzBody := gzipString(t, imageBody)
	imageURL := "https://preview.example/firmware-1.0.3.bin.gz"
	releaseHTTPClient = fakeReleaseHTTPClient{
		responses: map[string]string{imageURL: gzBody},
	}

	imagePath, err := downloadManifestFirmwareArtifact(
		context.Background(),
		home,
		releaseFirmwareManifest{},
		releaseFirmwareArtifact{
			FirmwareVersion: "1.0.3",
			Asset:           "firmware-1.0.3.bin.gz",
			SHA256:          sha256String(gzBody),
			FirmwareURL:     imageURL,
		},
	)
	if err != nil {
		t.Fatalf("download manifest firmware: %v", err)
	}
	if strings.HasSuffix(imagePath, ".gz") {
		t.Fatalf("expected decompressed image path, got %s", imagePath)
	}
	if data, err := os.ReadFile(imagePath); err != nil || string(data) != imageBody {
		t.Fatalf("unexpected image data data=%q err=%v", string(data), err)
	}
}

func TestDownloadReleaseFirmwareUsesLatestManifestWhenTargetVersionEmpty(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	home := t.TempDir()
	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	manifestBody := `{
  "schemaVersion": 1,
  "release": "v1.0.4",
  "protocolVersion": 1,
  "artifacts": [
    {
      "firmwareEnv": "esp8266_smalltv_st7789",
      "board": "esp8266-smalltv-st7789",
      "firmwareVersion": "1.0.3",
      "asset": "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin",
      "sha256": "` + imageSHA + `"
    }
  ]
}`

	releaseHTTPClient = fakeReleaseHTTPClient{
		responses: map[string]string{
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.4/firmware-manifest.json":                                      manifestBody,
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.4/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin": imageBody,
		},
	}

	imagePath, manifestPath, artifact, err := downloadReleaseFirmware(
		context.Background(),
		home,
		"DreamyTalesPAN/CodexBar-Display",
		"v1.0.4",
		"",
		"esp8266_smalltv_st7789",
	)
	if err != nil {
		t.Fatalf("download release firmware: %v", err)
	}
	if artifact.FirmwareVersion != "1.0.3" {
		t.Fatalf("unexpected firmware version %q", artifact.FirmwareVersion)
	}
	if !strings.HasSuffix(manifestPath, "firmware-manifest.json") {
		t.Fatalf("expected latest manifest path, got %s", manifestPath)
	}
	if data, err := os.ReadFile(imagePath); err != nil || string(data) != imageBody {
		t.Fatalf("unexpected image data data=%q err=%v", string(data), err)
	}
}

func TestRunInstallUpdateDownloadsVerifiesAndUploadsOTA(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})
	t.Setenv("HOME", t.TempDir())

	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	uploaded := false
	pairCalls := 0
	firmwareVersion := "1.0.0"
	serverURL := ""

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
		case "/manifest.json":
			_, _ = w.Write([]byte(`{
  "schemaVersion": 1,
  "release": "v1.0.1",
  "artifacts": [{
    "firmwareEnv": "esp8266_smalltv_st7789",
    "board": "esp8266-smalltv-st7789",
    "firmwareVersion": "1.0.1",
    "asset": "firmware.bin",
    "firmwareUrl": "` + serverURL + `/firmware.bin",
    "sha256": "` + imageSHA + `"
  }]
}`))
		case "/firmware.bin":
			_, _ = w.Write([]byte(imageBody))
		case "/api/pair":
			pairCalls++
			_, _ = w.Write([]byte(`{"ok":true,"token":"pair-token"}`))
		case "/update/firmware":
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Errorf("expected paired device token header, got %q", got)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("parse multipart: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			file, _, err := r.FormFile("firmware")
			if err != nil {
				t.Errorf("firmware file missing: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			data, err := io.ReadAll(file)
			_ = file.Close()
			if err != nil || string(data) != imageBody {
				t.Errorf("unexpected uploaded body=%q err=%v", string(data), err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			uploaded = true
			firmwareVersion = "1.0.1"
			_, _ = w.Write([]byte("ok"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	serverURL = server.URL
	releaseHTTPClient = server.Client()

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{"--target", server.URL, "--manifest-url", server.URL + "/manifest.json"})
	})
	if err != nil {
		t.Fatalf("install update: %v", err)
	}
	if !uploaded {
		t.Fatal("expected OTA upload")
	}
	if pairCalls != 1 {
		t.Fatalf("expected one pairing call, got %d", pairCalls)
	}
	cfg, err := runtimeconfig.Load(os.Getenv("HOME"))
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.DeviceTarget != server.URL || cfg.DeviceToken != "pair-token" {
		t.Fatalf("expected paired runtime config, got %+v", cfg)
	}
	for _, want := range []string{
		"Checking device...",
		"Device: esp8266-smalltv-st7789 firmware 1.0.0",
		"Checking firmware...",
		"Updating firmware: 1.0.0 -> 1.0.1",
		"Pausing Mac App during firmware update...",
		"Restarting VibeTV...",
		"Done: firmware 1.0.1 installed",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected output to contain %q, got:\n%s", want, output)
		}
	}
	for _, noisy := range []string{"update plan:", "firmware downloaded:", "sha256="} {
		if strings.Contains(output, noisy) {
			t.Fatalf("expected quiet update output not to contain %q, got:\n%s", noisy, output)
		}
	}
}

func TestRunInstallUpdateDoesNotFallBackFromExplicitTarget(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
	})

	home := t.TempDir()
	t.Setenv("HOME", home)

	savedTargetCalls := 0
	savedTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		savedTargetCalls++
		w.WriteHeader(http.StatusOK)
	}))
	defer savedTarget.Close()
	explicitTarget := httptest.NewServer(http.NotFoundHandler())
	defer explicitTarget.Close()
	if err := runtimeconfig.Save(home, runtimeconfig.Config{
		DeviceTarget: savedTarget.URL,
		DeviceToken:  "pair-token",
	}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}
	releaseHTTPClient = explicitTarget.Client()

	_, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", explicitTarget.URL,
			"--manifest-url", explicitTarget.URL + "/manifest.json",
		})
	})
	if err == nil {
		t.Fatal("expected explicit target hello failure")
	}
	if savedTargetCalls != 0 {
		t.Fatalf("expected no fallback to saved target, got %d calls", savedTargetCalls)
	}
}

func TestRunInstallUpdateAlreadyCurrentSkipsOTAUpload(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
	})
	t.Setenv("HOME", t.TempDir())

	uploads := 0
	uploadFirmwareOTAFn = func(context.Context, string, string, string) error {
		uploads++
		return nil
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-current","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.1","features":["theme"],"maxFrameBytes":1024}`))
		case "/manifest.json":
			_, _ = w.Write([]byte(`{"schemaVersion":1,"release":"v1.0.1","artifacts":[{"firmwareEnv":"esp8266_smalltv_st7789","board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.1","asset":"firmware.bin","firmwareUrl":"https://example.invalid/firmware.bin","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}`))
		default:
			t.Fatalf("already-current update must not request %s", r.URL.Path)
		}
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", server.URL,
			"--manifest-url", server.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err != nil {
		t.Fatalf("already-current update: %v", err)
	}
	if uploads != 0 {
		t.Fatalf("already-current firmware must not upload, got %d calls", uploads)
	}
	if !strings.Contains(output, `"outcome":"already_current"`) {
		t.Fatalf("expected typed already-current outcome, got:\n%s", output)
	}
}

func TestRunInstallUpdateRediscoverAfterFirmwareRebootIPChange(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	previousDiscover := discoverWiFiDeviceFn
	previousPoll := firmwareHTTPVerifyPollInterval
	previousRediscoveryAfter := firmwareUpdateRediscoveryAfter
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
		discoverWiFiDeviceFn = previousDiscover
		firmwareHTTPVerifyPollInterval = previousPoll
		firmwareUpdateRediscoveryAfter = previousRediscoveryAfter
	})
	firmwareHTTPVerifyPollInterval = time.Millisecond
	firmwareUpdateRediscoveryAfter = time.Millisecond

	home := t.TempDir()
	t.Setenv("HOME", home)

	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	oldOffline := false
	oldServerURL := ""
	newServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.1","features":["theme"],"maxFrameBytes":1024}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer newServer.Close()

	oldServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if oldOffline {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.0","features":["theme"],"maxFrameBytes":1024}`))
		case "/manifest.json":
			_, _ = w.Write([]byte(`{
  "schemaVersion": 1,
  "release": "v1.0.1",
  "artifacts": [{
    "firmwareEnv": "esp8266_smalltv_st7789",
    "board": "esp8266-smalltv-st7789",
    "firmwareVersion": "1.0.1",
    "asset": "firmware.bin",
    "firmwareUrl": "` + oldServerURL + `/firmware.bin",
    "sha256": "` + imageSHA + `"
  }]
}`))
		case "/firmware.bin":
			_, _ = w.Write([]byte(imageBody))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer oldServer.Close()
	oldServerURL = oldServer.URL
	if err := runtimeconfig.Save(home, runtimeconfig.Config{
		DeviceTarget: oldServer.URL,
		DeviceToken:  "pair-token",
	}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	releaseHTTPClient = oldServer.Client()
	uploadFirmwareOTAFn = func(_ context.Context, base string, _ string, token string) error {
		if base != oldServer.URL {
			t.Fatalf("expected OTA upload to use old target %q, got %q", oldServer.URL, base)
		}
		if token != "pair-token" {
			t.Fatalf("expected stored token, got %q", token)
		}
		oldOffline = true
		return nil
	}
	var discoveryCandidates []string
	discoverWiFiDeviceFn = func(_ context.Context, opts transportlayer.WiFiDiscoveryOptions) (transportlayer.WiFiDiscoveryResult, error) {
		discoveryCandidates = append(discoveryCandidates, opts.Candidates...)
		if !opts.IncludeNetworkScan {
			t.Fatal("expected install-update rediscovery to include network scan")
		}
		return transportlayer.WiFiDiscoveryResult{
			Target: newServer.URL,
			Hello: protocol.DeviceHello{
				Kind:            "hello",
				ProtocolVersion: 2,
				Board:           "esp8266-smalltv-st7789",
				Firmware:        "1.0.1",
			},
			Source: "network-scan",
		}, nil
	}

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", oldServer.URL,
			"--manifest-url", oldServer.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err != nil {
		t.Fatalf("install update: %v", err)
	}
	if !strings.Contains(output, "Using rediscovered VibeTV address: "+newServer.URL) {
		t.Fatalf("expected rediscovery output, got:\n%s", output)
	}
	if !strings.Contains(strings.Join(discoveryCandidates, ","), oldServer.URL) {
		t.Fatalf("expected old target in discovery candidates, got %v", discoveryCandidates)
	}
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.DeviceTarget != newServer.URL || cfg.DeviceToken != "pair-token" {
		t.Fatalf("expected rediscovered target saved with existing token, got %+v", cfg)
	}
}

func TestEnsureFirmwareUpdateDeviceTokenStoresNewConcreteTarget(t *testing.T) {
	home := t.TempDir()
	savedTarget := "http://192.168.178.72"
	if err := runtimeconfig.Save(home, runtimeconfig.Config{
		DeviceTarget: savedTarget,
		DeviceToken:  "pair-token",
	}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	newTarget := "http://192.168.178.99"
	token, err := ensureFirmwareUpdateDeviceToken(context.Background(), home, newTarget, false)
	if err != nil {
		t.Fatalf("ensure token: %v", err)
	}
	if token != "pair-token" {
		t.Fatalf("expected stored token, got %q", token)
	}

	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.DeviceTarget != newTarget {
		t.Fatalf("expected new concrete target %q, got %q", newTarget, cfg.DeviceTarget)
	}
}

func TestRunInstallUpdateUsesStoredDeviceTokenForOTA(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{DeviceToken: "pair-token"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	uploaded := false
	firmwareVersion := "1.0.0"
	serverURL := ""

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
		case "/manifest.json":
			_, _ = w.Write([]byte(`{
  "schemaVersion": 1,
  "release": "v1.0.1",
  "artifacts": [{
    "firmwareEnv": "esp8266_smalltv_st7789",
    "board": "esp8266-smalltv-st7789",
    "firmwareVersion": "1.0.1",
    "asset": "firmware.bin",
    "firmwareUrl": "` + serverURL + `/firmware.bin",
    "sha256": "` + imageSHA + `"
  }]
}`))
		case "/firmware.bin":
			_, _ = w.Write([]byte(imageBody))
		case "/update/firmware":
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Errorf("expected stored device token header, got %q", got)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("parse multipart: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			uploaded = true
			firmwareVersion = "1.0.1"
			_, _ = w.Write([]byte("ok"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	serverURL = server.URL
	releaseHTTPClient = server.Client()

	if err := runInstallUpdate([]string{"--target", server.URL, "--manifest-url", server.URL + "/manifest.json"}); err != nil {
		t.Fatalf("install update: %v", err)
	}
	if !uploaded {
		t.Fatal("expected OTA upload")
	}
}

func TestRecoverInterruptedFirmwareUploadAcceptsInstalledTargetVersion(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousPoll := firmwareHTTPVerifyPollInterval
	previousTimeout := firmwareInterruptedVerifyTimeout
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareHTTPVerifyPollInterval = previousPoll
		firmwareInterruptedVerifyTimeout = previousTimeout
	})
	firmwareHTTPVerifyPollInterval = time.Millisecond
	firmwareInterruptedVerifyTimeout = 10 * time.Millisecond

	multipartCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37"}`))
		case "/update/firmware":
			multipartCalls++
			w.WriteHeader(http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()

	err := recoverInterruptedFirmwareUpload(
		context.Background(),
		server.URL,
		"1.0.37",
		"device-a",
		errors.New("write tcp: use of closed network connection"),
	)
	if err != nil {
		t.Fatalf("installed target version should resolve interrupted upload: %v", err)
	}
	if multipartCalls != 0 {
		t.Fatalf("must not retry after target version is installed, got %d multipart calls", multipartCalls)
	}
}

func TestRecoverInterruptedFirmwareUploadRequiresRestartAfterOldVersionReturns(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousPoll := firmwareHTTPVerifyPollInterval
	previousTimeout := firmwareInterruptedVerifyTimeout
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareHTTPVerifyPollInterval = previousPoll
		firmwareInterruptedVerifyTimeout = previousTimeout
	})
	firmwareHTTPVerifyPollInterval = time.Millisecond
	firmwareInterruptedVerifyTimeout = 5 * time.Millisecond

	multipartCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36"}`))
		case "/update/firmware":
			multipartCalls++
			w.WriteHeader(http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()

	unsafeErrors := []error{
		errors.New("write tcp: use of closed network connection"),
		errors.New("timed out waiting for VibeTV to acknowledge firmware data (1024 bytes pending)"),
		errors.New("POST /update/firmware.raw returned 500 body=\"Update failed: No Error\""),
		io.EOF,
	}
	for _, uploadErr := range unsafeErrors {
		err := recoverInterruptedFirmwareUpload(
			context.Background(),
			server.URL,
			"1.0.37",
			"device-a",
			uploadErr,
		)
		if !errors.Is(err, errFirmwareUploadRestartRequired) {
			t.Fatalf("expected restart-required error for %v, got %v", uploadErr, err)
		}
	}
	if multipartCalls != 0 {
		t.Fatalf("must not retry multipart in the same boot, got %d calls", multipartCalls)
	}
}

func TestRecoverInterruptedFirmwareUploadRejectsChangedDeviceIdentity(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousPoll := firmwareHTTPVerifyPollInterval
	previousTimeout := firmwareInterruptedVerifyTimeout
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareHTTPVerifyPollInterval = previousPoll
		firmwareInterruptedVerifyTimeout = previousTimeout
	})
	firmwareHTTPVerifyPollInterval = time.Millisecond
	firmwareInterruptedVerifyTimeout = 5 * time.Millisecond

	multipartCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-b","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36"}`))
		case "/update/firmware":
			multipartCalls++
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()

	err := recoverInterruptedFirmwareUpload(
		context.Background(),
		server.URL,
		"1.0.37",
		"device-a",
		errors.New("write tcp: use of closed network connection"),
	)
	if err == nil || !strings.Contains(err.Error(), "identity changed") {
		t.Fatalf("expected identity-change rejection, got %v", err)
	}
	if multipartCalls != 0 {
		t.Fatalf("must not write to a changed device, got %d multipart calls", multipartCalls)
	}
}

func TestRawFirmwareUploadUnavailableDoesNotTreatTimeoutAsSafeFallback(t *testing.T) {
	if rawFirmwareUploadUnavailable(errors.New("operation timed out")) {
		t.Fatal("a timeout may happen after firmware bytes were sent and must not trigger multipart fallback")
	}
	if !rawFirmwareUploadUnavailable(errors.New("connect: connection refused")) {
		t.Fatal("connection refusal before an upload should allow the legacy endpoint fallback")
	}
}

func TestFirmwareUploadConnectionInterruptedRequiresRecoveryForUnsafeErrors(t *testing.T) {
	tests := []error{
		errors.New("timed out waiting for VibeTV to acknowledge firmware data (1024 bytes pending)"),
		errors.New("write tcp: i/o timeout"),
		errors.New("POST /update/firmware.raw returned 500 body=\"Update failed: No Error\""),
		io.EOF,
		fmt.Errorf("%w: response disappeared", errFirmwareUploadMayHaveWritten),
	}
	for _, err := range tests {
		if !firmwareUploadConnectionInterrupted(err) {
			t.Fatalf("unsafe upload error was treated as retryable: %v", err)
		}
	}
}

func TestRunInstallUpdateRepairsStaleDeviceTokenOnUnauthorizedOTA(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
	})

	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{DeviceToken: "stale-token"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	firmwareVersion := "1.0.0"
	serverURL := ""
	pairCalls := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
		case "/manifest.json":
			_, _ = w.Write([]byte(`{
  "schemaVersion": 1,
  "release": "v1.0.1",
  "artifacts": [{
    "firmwareEnv": "esp8266_smalltv_st7789",
    "board": "esp8266-smalltv-st7789",
    "firmwareVersion": "1.0.1",
    "asset": "firmware.bin",
    "firmwareUrl": "` + serverURL + `/firmware.bin",
    "sha256": "` + imageSHA + `"
  }]
}`))
		case "/firmware.bin":
			_, _ = w.Write([]byte(imageBody))
		case "/api/pair":
			pairCalls++
			_, _ = w.Write([]byte(`{"ok":true,"token":"fresh-token"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	serverURL = server.URL
	releaseHTTPClient = server.Client()

	var uploadTokens []string
	uploadFirmwareOTAFn = func(_ context.Context, _ string, _ string, token string) error {
		uploadTokens = append(uploadTokens, token)
		if token == "stale-token" {
			return errors.New(`POST /update/firmware.raw returned 401 Unauthorized body="pairing token required"`)
		}
		if token != "fresh-token" {
			t.Fatalf("unexpected upload token %q", token)
		}
		firmwareVersion = "1.0.1"
		return nil
	}

	if err := runInstallUpdate([]string{"--target", server.URL, "--manifest-url", server.URL + "/manifest.json"}); err != nil {
		t.Fatalf("install update: %v", err)
	}
	if pairCalls != 1 {
		t.Fatalf("expected one repair pairing call, got %d", pairCalls)
	}
	if strings.Join(uploadTokens, ",") != "stale-token,fresh-token" {
		t.Fatalf("unexpected upload token sequence %v", uploadTokens)
	}
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.DeviceToken != "fresh-token" || cfg.DeviceTarget != server.URL {
		t.Fatalf("expected repaired runtime config, got %+v", cfg)
	}
}

func TestRunInstallUpdatePausesLaunchAgentDuringOTAAndRestarts(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	previousStop := upgradeStopLaunchAgentFn
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
		upgradeStopLaunchAgentFn = previousStop
		upgradeRestartLaunchAgentFn = previousRestart
	})

	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{DeviceToken: "pair-token"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	firmwareVersion := "1.0.0"
	serverURL := ""

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
		case "/manifest.json":
			_, _ = w.Write([]byte(`{
  "schemaVersion": 1,
  "release": "v1.0.1",
  "artifacts": [{
    "firmwareEnv": "esp8266_smalltv_st7789",
    "board": "esp8266-smalltv-st7789",
    "firmwareVersion": "1.0.1",
    "asset": "firmware.bin",
    "firmwareUrl": "` + serverURL + `/firmware.bin",
    "sha256": "` + imageSHA + `"
  }]
}`))
		case "/firmware.bin":
			_, _ = w.Write([]byte(imageBody))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	serverURL = server.URL
	releaseHTTPClient = server.Client()

	stopCalls := 0
	restartCalls := 0
	upgradeStopLaunchAgentFn = func() {
		stopCalls++
	}
	upgradeRestartLaunchAgentFn = func(gotHome string) error {
		restartCalls++
		if gotHome != home {
			t.Fatalf("unexpected restart home %q", gotHome)
		}
		return nil
	}
	uploadFirmwareOTAFn = func(_ context.Context, _ string, _ string, token string) error {
		if stopCalls != 1 {
			t.Fatalf("expected launch agent to be stopped before OTA, got %d stop calls", stopCalls)
		}
		if token != "pair-token" {
			t.Fatalf("unexpected token %q", token)
		}
		firmwareVersion = "1.0.1"
		return nil
	}

	if err := runInstallUpdate([]string{"--target", server.URL, "--manifest-url", server.URL + "/manifest.json"}); err != nil {
		t.Fatalf("install update: %v", err)
	}
	if stopCalls != 1 {
		t.Fatalf("expected one stop call, got %d", stopCalls)
	}
	if restartCalls != 1 {
		t.Fatalf("expected one restart call, got %d", restartCalls)
	}
}

func TestRunInstallUpdateCanSkipLaunchAgentPauseForLocalAPI(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	previousStop := upgradeStopLaunchAgentFn
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
		upgradeStopLaunchAgentFn = previousStop
		upgradeRestartLaunchAgentFn = previousRestart
	})

	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{DeviceToken: "pair-token"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	firmwareVersion := "1.0.0"
	serverURL := ""

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
		case "/manifest.json":
			_, _ = w.Write([]byte(`{
  "schemaVersion": 1,
  "release": "v1.0.1",
  "artifacts": [{
    "firmwareEnv": "esp8266_smalltv_st7789",
    "board": "esp8266-smalltv-st7789",
    "firmwareVersion": "1.0.1",
    "asset": "firmware.bin",
    "firmwareUrl": "` + serverURL + `/firmware.bin",
    "sha256": "` + imageSHA + `"
  }]
}`))
		case "/firmware.bin":
			_, _ = w.Write([]byte(imageBody))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	serverURL = server.URL
	releaseHTTPClient = server.Client()

	stopCalls := 0
	restartCalls := 0
	upgradeStopLaunchAgentFn = func() {
		stopCalls++
	}
	upgradeRestartLaunchAgentFn = func(string) error {
		restartCalls++
		return nil
	}
	uploadFirmwareOTAFn = func(_ context.Context, _ string, _ string, token string) error {
		if stopCalls != 0 {
			t.Fatalf("local API update must not stop launch agent, got %d stop calls", stopCalls)
		}
		if token != "pair-token" {
			t.Fatalf("unexpected token %q", token)
		}
		firmwareVersion = "1.0.1"
		return nil
	}

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", server.URL,
			"--manifest-url", server.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err != nil {
		t.Fatalf("install update: %v", err)
	}
	if stopCalls != 0 {
		t.Fatalf("expected no stop call, got %d", stopCalls)
	}
	if restartCalls != 0 {
		t.Fatalf("expected no restart call, got %d", restartCalls)
	}
	if strings.Contains(output, "Pausing Mac App during firmware update") {
		t.Fatalf("local API update should not claim it paused the Mac App, got:\n%s", output)
	}
}

func TestRunInstallUpdateRequiresLiveManifestConfirmation(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Errorf("unexpected request before confirmation: %s", r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.0","features":["theme"],"maxFrameBytes":1024}`))
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()

	err := runInstallUpdate([]string{"--target", server.URL})
	if err == nil {
		t.Fatal("expected confirmation error")
	}
	if !strings.Contains(err.Error(), "confirm-live-update") {
		t.Fatalf("expected live confirmation error, got %v", err)
	}
}

func TestRunUpgradeDownloadsAndFlashesReleaseFirmware(t *testing.T) {
	previousResolve := resolveSerialPortFn
	previousEnsureBusy := ensureSerialPortNotBusyFn
	previousStop := upgradeStopLaunchAgentFn
	previousRestart := upgradeRestartLaunchAgentFn
	previousLoadState := loadReleaseStateFn
	previousSaveState := saveReleaseStateFn
	previousSnapshot := snapshotInstalledCompanionBinaryFn
	previousReadHello := readDeviceHelloFn
	previousCloseDefaultSender := closeDefaultSenderFn
	previousHTTPClient := releaseHTTPClient
	previousFlash := flashReleaseFirmwareImageFn
	t.Cleanup(func() {
		resolveSerialPortFn = previousResolve
		ensureSerialPortNotBusyFn = previousEnsureBusy
		upgradeStopLaunchAgentFn = previousStop
		upgradeRestartLaunchAgentFn = previousRestart
		loadReleaseStateFn = previousLoadState
		saveReleaseStateFn = previousSaveState
		snapshotInstalledCompanionBinaryFn = previousSnapshot
		readDeviceHelloFn = previousReadHello
		closeDefaultSenderFn = previousCloseDefaultSender
		releaseHTTPClient = previousHTTPClient
		flashReleaseFirmwareImageFn = previousFlash
	})

	home := t.TempDir()
	t.Setenv("HOME", home)
	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	manifestBody := `{
  "schemaVersion": 1,
  "release": "v1.0.3",
  "protocolVersion": 1,
  "artifacts": [
    {
      "firmwareEnv": "esp8266_smalltv_st7789",
      "board": "esp8266-smalltv-st7789",
      "firmwareVersion": "1.0.3",
      "asset": "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin",
      "sha256": "` + imageSHA + `"
    }
  ]
}`

	releaseHTTPClient = fakeReleaseHTTPClient{
		responses: map[string]string{
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/firmware-manifest-v1.0.3.json":                               manifestBody,
			"https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.3/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.3.bin": imageBody,
		},
	}
	resolveSerialPortFn = func(port string) (string, error) {
		return strings.TrimSpace(port), nil
	}
	ensureSerialPortNotBusyFn = func(string) error { return nil }
	upgradeStopLaunchAgentFn = func() {}
	upgradeRestartLaunchAgentFn = func(string) error { return nil }
	loadReleaseStateFn = func(string) (releaseState, error) { return releaseState{}, nil }
	saveCalls := 0
	saveReleaseStateFn = func(string, releaseState) error {
		saveCalls++
		return nil
	}
	snapshotInstalledCompanionBinaryFn = func(string) (string, string, error) {
		return "", "", nil
	}
	readDeviceHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{}, errors.New("no hello")
	}
	closeCalls := 0
	closeDefaultSenderFn = func() {
		closeCalls++
	}
	flashed := false
	flashReleaseFirmwareImageFn = func(_ context.Context, port string, artifact releaseFirmwareArtifact, imagePath string) error {
		flashed = true
		if port != "/dev/cu.usbserial-110" {
			t.Fatalf("unexpected port %q", port)
		}
		if artifact.FirmwareEnv != "esp8266_smalltv_st7789" {
			t.Fatalf("unexpected firmware env %q", artifact.FirmwareEnv)
		}
		if data, err := os.ReadFile(imagePath); err != nil || string(data) != imageBody {
			t.Fatalf("unexpected flashed image data=%q err=%v", string(data), err)
		}
		return nil
	}

	err := runUpgrade([]string{
		"--port", "/dev/cu.usbserial-110",
		"--target-firmware-version", "1.0.3",
		"--skip-version-guard",
	})
	if err != nil {
		t.Fatalf("runUpgrade failed: %v", err)
	}
	if !flashed {
		t.Fatal("expected flash function to be called")
	}
	if closeCalls != 2 {
		t.Fatalf("expected sender close after pre/post hello reads, got %d", closeCalls)
	}
	if saveCalls != 2 {
		t.Fatalf("expected release state save twice, got %d", saveCalls)
	}
}

func TestBeginUpgradeLaunchAgentRecoveryRestartsOnErrorPath(t *testing.T) {
	previousStop := upgradeStopLaunchAgentFn
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		upgradeStopLaunchAgentFn = previousStop
		upgradeRestartLaunchAgentFn = previousRestart
	})

	stopCalls := 0
	restartCalls := 0
	upgradeStopLaunchAgentFn = func() {
		stopCalls++
	}
	upgradeRestartLaunchAgentFn = func(home string) error {
		restartCalls++
		if home != "/tmp/home" {
			t.Fatalf("unexpected home path %q", home)
		}
		return nil
	}

	runErr := &commandError{
		Op:   "flash-and-install",
		Code: errcode.UpgradeFlashFirmware,
		Err:  errors.New("flash failed"),
		Hint: "retry flash",
	}
	var retErr error = runErr
	cleanup := beginUpgradeLaunchAgentRecovery("/tmp/home", &retErr)
	if stopCalls != 1 {
		t.Fatalf("expected launch agent stop once, got %d", stopCalls)
	}

	cleanup()

	if restartCalls != 1 {
		t.Fatalf("expected launch agent restart once, got %d", restartCalls)
	}
	if errcode.Of(retErr) != errcode.UpgradeFlashFirmware {
		t.Fatalf("expected flash firmware error code, got %s", errcode.Of(retErr))
	}
}

func TestWrapUpgradeLaunchAgentRecoveryErrorReturnsRecoveryErrorOnRestartFailure(t *testing.T) {
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		upgradeRestartLaunchAgentFn = previousRestart
	})
	upgradeRestartLaunchAgentFn = func(home string) error {
		if home != "/tmp/home" {
			t.Fatalf("unexpected home path %q", home)
		}
		return errors.New("kickstart failed")
	}

	err := wrapUpgradeLaunchAgentRecoveryError(nil, "/tmp/home")
	if errcode.Of(err) != errcode.UpgradeLaunchAgent {
		t.Fatalf("expected launch agent recovery code, got %s", errcode.Of(err))
	}
	if recovery := errcode.Recovery(err); !strings.Contains(recovery, "launchctl") {
		t.Fatalf("expected recovery hint to mention launchctl, got %q", recovery)
	}
}

func TestWrapUpgradeLaunchAgentRecoveryErrorAppendsHint(t *testing.T) {
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		upgradeRestartLaunchAgentFn = previousRestart
	})
	upgradeRestartLaunchAgentFn = func(string) error {
		return errors.New("bootstrap failed")
	}

	original := &commandError{
		Op:   "flash-and-install",
		Code: errcode.UpgradeFlashFirmware,
		Err:  errors.New("flash failed"),
		Hint: "retry flash",
	}
	err := wrapUpgradeLaunchAgentRecoveryError(original, "/tmp/home")
	if errcode.Of(err) != errcode.UpgradeFlashFirmware {
		t.Fatalf("expected original error code to be preserved, got %s", errcode.Of(err))
	}
	recovery := errcode.Recovery(err)
	if !strings.Contains(recovery, "retry flash") {
		t.Fatalf("expected original hint in recovery, got %q", recovery)
	}
	if !strings.Contains(recovery, "restart launch agent manually") {
		t.Fatalf("expected launch agent hint in recovery, got %q", recovery)
	}
}

func TestRunRollbackFirmwareOnlyRestartsLaunchAgent(t *testing.T) {
	previousResolve := resolveSerialPortFn
	previousLoadState := loadReleaseStateFn
	previousRunRestore := runRestoreKnownGoodCommandFn
	previousRestart := rollbackRestartLaunchAgentFn
	t.Cleanup(func() {
		resolveSerialPortFn = previousResolve
		loadReleaseStateFn = previousLoadState
		runRestoreKnownGoodCommandFn = previousRunRestore
		rollbackRestartLaunchAgentFn = previousRestart
	})

	t.Setenv("HOME", t.TempDir())

	restoreCalls := 0
	restartCalls := 0
	resolveSerialPortFn = func(port string) (string, error) {
		return strings.TrimSpace(port), nil
	}
	loadReleaseStateFn = func(string) (releaseState, error) {
		return releaseState{
			LastKnownGood: lastKnownGoodState{
				FirmwareImage:    "/tmp/missing.bin",
				FirmwareManifest: "/tmp/missing.bin.manifest",
			},
		}, nil
	}
	runRestoreKnownGoodCommandFn = func(args []string) error {
		restoreCalls++
		if !containsArg(args, "--port", "/dev/cu.usbserial-110") {
			t.Fatalf("expected --port argument in restore call, got %v", args)
		}
		return nil
	}
	rollbackRestartLaunchAgentFn = func(home string) error {
		restartCalls++
		if strings.TrimSpace(home) == "" {
			t.Fatal("expected non-empty home for restart call")
		}
		return nil
	}

	if err := runRollback([]string{"--skip-companion", "--port", "/dev/cu.usbserial-110"}); err != nil {
		t.Fatalf("runRollback failed: %v", err)
	}
	if restoreCalls != 1 {
		t.Fatalf("expected restore invocation once, got %d", restoreCalls)
	}
	if restartCalls != 1 {
		t.Fatalf("expected launchagent restart once, got %d", restartCalls)
	}
}

func TestRunRollbackReturnsLaunchAgentErrorCodeWhenRestartFails(t *testing.T) {
	previousResolve := resolveSerialPortFn
	previousLoadState := loadReleaseStateFn
	previousRunRestore := runRestoreKnownGoodCommandFn
	previousRestart := rollbackRestartLaunchAgentFn
	t.Cleanup(func() {
		resolveSerialPortFn = previousResolve
		loadReleaseStateFn = previousLoadState
		runRestoreKnownGoodCommandFn = previousRunRestore
		rollbackRestartLaunchAgentFn = previousRestart
	})

	t.Setenv("HOME", t.TempDir())

	resolveSerialPortFn = func(port string) (string, error) {
		return strings.TrimSpace(port), nil
	}
	loadReleaseStateFn = func(string) (releaseState, error) {
		return releaseState{}, nil
	}
	runRestoreKnownGoodCommandFn = func([]string) error {
		return nil
	}
	rollbackRestartLaunchAgentFn = func(string) error {
		return errors.New("launchctl kickstart failed")
	}

	err := runRollback([]string{"--skip-companion", "--port", "/dev/cu.usbserial-110"})
	if err == nil {
		t.Fatal("expected rollback restart error")
	}
	if got := errcode.Of(err); got != errcode.RollbackLaunchAgent {
		t.Fatalf("expected rollback launchagent code, got %s", got)
	}
}

func TestRunUpgradePreflightPortBusyReturnsUpgradePortBusyCode(t *testing.T) {
	previousResolve := resolveSerialPortFn
	previousEnsureBusy := ensureSerialPortNotBusyFn
	previousStop := upgradeStopLaunchAgentFn
	previousRestart := upgradeRestartLaunchAgentFn
	t.Cleanup(func() {
		resolveSerialPortFn = previousResolve
		ensureSerialPortNotBusyFn = previousEnsureBusy
		upgradeStopLaunchAgentFn = previousStop
		upgradeRestartLaunchAgentFn = previousRestart
	})

	t.Setenv("HOME", t.TempDir())

	resolveSerialPortFn = func(port string) (string, error) {
		return strings.TrimSpace(port), nil
	}
	ensureSerialPortNotBusyFn = func(string) error {
		return errors.New("serial port busy")
	}
	upgradeStopLaunchAgentFn = func() {}
	upgradeRestartLaunchAgentFn = func(string) error { return nil }

	err := runUpgrade([]string{"--port", "/dev/cu.usbserial-110"})
	if err == nil {
		t.Fatal("expected preflight busy error")
	}
	if got := errcode.Of(err); got != errcode.UpgradePortBusy {
		t.Fatalf("expected upgrade/port-busy code, got %s", got)
	}
}

func TestReleaseWrapperScriptsCallExpectedCommands(t *testing.T) {
	root := repoRoot(t)
	upgradeWrapper := filepath.Join(root, "scripts", "upgrade-with-preflight.sh")
	rollbackWrapper := filepath.Join(root, "scripts", "rollback-last-known-good.sh")

	upgradeData, err := os.ReadFile(upgradeWrapper)
	if err != nil {
		t.Fatalf("read upgrade wrapper: %v", err)
	}
	rollbackData, err := os.ReadFile(rollbackWrapper)
	if err != nil {
		t.Fatalf("read rollback wrapper: %v", err)
	}

	if !strings.Contains(string(upgradeData), " upgrade ") {
		t.Fatalf("expected upgrade wrapper to invoke upgrade command")
	}
	if !strings.Contains(string(rollbackData), " rollback ") {
		t.Fatalf("expected rollback wrapper to invoke rollback command")
	}
}

func containsArg(args []string, flag, value string) bool {
	for i := 0; i < len(args)-1; i++ {
		if args[i] == flag && args[i+1] == value {
			return true
		}
	}
	return false
}

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "companion", "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("repository root not found from %s", dir)
		}
		dir = parent
	}
}

type fakeReleaseHTTPClient struct {
	responses map[string]string
}

func (f fakeReleaseHTTPClient) Do(req *http.Request) (*http.Response, error) {
	body, ok := f.responses[req.URL.String()]
	if !ok {
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Status:     "404 Not Found",
			Body:       io.NopCloser(strings.NewReader("not found")),
			Header:     make(http.Header),
		}, nil
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}, nil
}

func sha256String(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

func gzipString(t *testing.T, text string) string {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write([]byte(text)); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buf.String()
}
