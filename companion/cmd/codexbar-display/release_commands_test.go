package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
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

// DO NOT weaken: renamed from TestFirmwareRawWritePauseKeepsLegacyReceiverPacing,
// which expected released firmware >= 1.0.37 to be sent unpaced. On real
// esp8266-smalltv-st7789 hardware running 1.0.39 the unpaced sender stalled
// waiting for the block ack in 2 of 2 attempts and the update failed; the same
// upload with the pause restored installed successfully. Every firmware is
// paced now. See docs/hardware-contract.md.
func TestFirmwareRawWritePauseIsConservativeForEveryFirmware(t *testing.T) {
	tests := []struct {
		firmware string
		want     time.Duration
	}{
		{firmware: "1.0.36", want: otaRawWritePause},
		{firmware: "1.0.37", want: otaRawWritePause},
		{firmware: "1.0.37-dev.90d0575", want: otaRawWritePause},
		{firmware: "1.0.39", want: otaRawWritePause},
		{firmware: "1.0.40-dev.ddc9332", want: otaRawWritePause},
		{firmware: "1.0.38", want: otaRawWritePause},
		{firmware: "9999.0.24", want: otaRawWritePause},
		{firmware: "invalid", want: otaRawWritePause},
	}
	for _, test := range tests {
		if got := firmwareRawWritePause(test.firmware); got != test.want {
			t.Fatalf("firmware %q write pause = %s, want %s", test.firmware, got, test.want)
		}
	}
}

// DO NOT weaken this test. It pins the removal of the unpaced fast path for
// released firmware >= 1.0.37. Hardware measurement on esp8266-smalltv-st7789
// running released 1.0.39 (2026-08-07): unpaced RAW uploads installed 0/3,
// paced uploads with the device otherwise idle installed 2/2. Pacing is
// mandatory for every firmware version, including unparseable and empty
// version strings. See docs/firmware-ota-contract.md.
func TestFirmwareRawWritePauseIsPositiveForEveryFirmwareVersion(t *testing.T) {
	for _, firmware := range []string{"1.0.37", "1.0.39", "9999.0.24", ""} {
		if got := firmwareRawWritePause(firmware); got <= 0 {
			t.Fatalf("firmware %q write pause = %s, want > 0 (unpaced RAW uploads fail on real hardware)", firmware, got)
		}
	}
}

func TestLegacyRawFirmwareUploadIsLimitedToPublic1036(t *testing.T) {
	for _, test := range []struct {
		firmware string
		want     bool
	}{
		{firmware: "1.0.36", want: true},
		{firmware: "v1.0.36", want: true},
		{firmware: "1.0.36-dev.1", want: false},
		{firmware: "1.0.37", want: false},
		{firmware: "1.0.40-dev", want: false},
		{firmware: "", want: false},
	} {
		if got := usesLegacyRawFirmwareUpload(test.firmware); got != test.want {
			t.Fatalf("usesLegacyRawFirmwareUpload(%q)=%t want=%t", test.firmware, got, test.want)
		}
	}
}

func TestWaitForHTTPFirmwareVersionBoundsHungProbe(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousPoll := firmwareHTTPVerifyPollInterval
	previousProbeTimeout := firmwareHTTPVerifyProbeTimeout
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareHTTPVerifyPollInterval = previousPoll
		firmwareHTTPVerifyProbeTimeout = previousProbeTimeout
	})

	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()
	firmwareHTTPVerifyPollInterval = time.Millisecond
	firmwareHTTPVerifyProbeTimeout = 20 * time.Millisecond

	startedAt := time.Now()
	err := waitForHTTPFirmwareVersion(context.Background(), server.URL, "1.0.99", 75*time.Millisecond)
	elapsed := time.Since(startedAt)
	if err == nil {
		t.Fatal("expected firmware verification timeout")
	}
	if elapsed > 250*time.Millisecond {
		t.Fatalf("hung firmware probe exceeded bounded verification time: %s", elapsed)
	}
}

func TestUploadFirmwareOTARawEarlyUnauthorizedSocketCloseIsUnsafe(t *testing.T) {
	previousDial := firmwareRawDialContextFn
	t.Cleanup(func() {
		firmwareRawDialContextFn = previousDial
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	serverDone := make(chan error, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			serverDone <- acceptErr
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		for {
			line, readErr := reader.ReadString('\n')
			if readErr != nil {
				serverDone <- readErr
				return
			}
			if line == "\r\n" {
				break
			}
		}
		if _, writeErr := io.WriteString(
			conn,
			"HTTP/1.1 401 Unauthorized\r\nContent-Length: 22\r\nConnection: close\r\n\r\npairing token required",
		); writeErr != nil {
			serverDone <- writeErr
			return
		}
		if tcpConn, ok := conn.(*net.TCPConn); ok {
			_ = tcpConn.SetLinger(0)
		}
		serverDone <- nil
	}()

	firmwareRawDialContextFn = func(ctx context.Context, _, _ string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, "tcp", listener.Addr().String())
	}
	imagePath := filepath.Join(t.TempDir(), "firmware.bin")
	if err := os.WriteFile(imagePath, bytes.Repeat([]byte{0xa5}, 512*1024), 0o600); err != nil {
		t.Fatalf("write firmware fixture: %v", err)
	}

	err = uploadFirmwareOTARaw(context.Background(), "http://127.0.0.1", imagePath, "stale-token", "1.0.37")
	if err == nil {
		t.Fatal("expected early unauthorized socket close to fail")
	}
	if !errors.Is(err, errFirmwareUploadMayHaveWritten) {
		t.Fatalf("expected unsafe upload classification, got %v", err)
	}
	if !firmwareUploadConnectionInterrupted(err) {
		t.Fatalf("expected interrupted upload classification, got %v", err)
	}
	if serverErr := <-serverDone; serverErr != nil {
		t.Fatalf("early unauthorized server: %v", serverErr)
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
	pinNoOtherRuntimeWriter(t)
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
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
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
	if cfg.DeviceTarget != server.URL || cfg.DeviceID != "device-a" || cfg.DeviceToken != "pair-token" {
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
	pinNoOtherRuntimeWriter(t)
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
	})
	t.Setenv("HOME", t.TempDir())

	uploads := 0
	uploadFirmwareOTAFn = func(context.Context, string, string, string, string) error {
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

func TestRunInstallUpdateCableHappyPath(t *testing.T) {
	home, manifestURL, firmwareVersion := prepareCableFirmwareUpdateTest(t)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{
		ConnectionMode: "cable",
		DeviceID:       "device-cable",
		DeviceToken:    "pair-token",
	}); err != nil {
		t.Fatal(err)
	}
	transferCableFirmwareFn = func(_ context.Context, port, deviceID, token string, image []byte) error {
		if port != "/dev/mock-cable" || deviceID != "device-cable" || token != "pair-token" || string(image) != "cable firmware" {
			t.Fatalf("unexpected Cable transfer port=%q id=%q token=%q image=%q", port, deviceID, token, image)
		}
		*firmwareVersion = "1.0.1"
		return nil
	}

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{"--target", "cable://vibetv", "--manifest-url", manifestURL, "--skip-launchagent-pause"})
	})
	if err != nil {
		t.Fatalf("Cable update: %v", err)
	}
	if !strings.Contains(output, `"uploadAccepted":true`) || !strings.Contains(output, `"observedFirmware":"1.0.1"`) {
		t.Fatalf("Cable update did not report accepted and verified firmware:\n%s", output)
	}
}

func TestRunInstallUpdateCableAlreadyCurrentSkipsTransfer(t *testing.T) {
	home, manifestURL, firmwareVersion := prepareCableFirmwareUpdateTest(t)
	*firmwareVersion = "1.0.1"
	if err := runtimeconfig.Save(home, runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "device-cable", DeviceToken: "pair-token"}); err != nil {
		t.Fatal(err)
	}
	transferCableFirmwareFn = func(context.Context, string, string, string, []byte) error {
		t.Fatal("already-current Cable firmware must not transfer")
		return nil
	}

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{"--target", "cable://vibetv", "--manifest-url", manifestURL, "--skip-launchagent-pause"})
	})
	if err != nil || !strings.Contains(output, `"outcome":"already_current"`) {
		t.Fatalf("Cable already-current result err=%v output=%s", err, output)
	}
}

func TestRunInstallUpdateCableReportsInterruptedTransferWithoutRetry(t *testing.T) {
	home, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "device-cable", DeviceToken: "pair-token"}); err != nil {
		t.Fatal(err)
	}
	transferCalls := 0
	transferCableFirmwareFn = func(context.Context, string, string, string, []byte) error {
		transferCalls++
		return fmt.Errorf("%w: Cable disconnected", usb.ErrCableTransferInterrupted)
	}

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{"--target", "cable://vibetv", "--manifest-url", manifestURL, "--skip-launchagent-pause"})
	})
	if err == nil || transferCalls != 1 {
		t.Fatalf("interrupted Cable transfer err=%v calls=%d", err, transferCalls)
	}
	if !strings.Contains(output, `"outcome":"interrupted"`) || !strings.Contains(output, `"retryPolicy":"reconnect_cable"`) {
		t.Fatalf("Cable interruption was not reported truthfully:\n%s", output)
	}
	if !strings.Contains(errcode.Recovery(err), "data-capable Cable") {
		t.Fatalf("Cable interruption returned the wrong recovery action: %v", err)
	}
}

func TestRunInstallUpdateCableRejectsChangedIdentity(t *testing.T) {
	home, _, _ := prepareCableFirmwareUpdateTest(t)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "device-cable", DeviceToken: "pair-token"}); err != nil {
		t.Fatal(err)
	}
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{DeviceID: "other-device", Board: "esp8266-smalltv-st7789", Firmware: "1.0.0"}, nil
	}

	err := runInstallUpdate([]string{"--target", "cable://vibetv", "--manifest-url", "https://example.invalid/manifest.json", "--skip-launchagent-pause"})
	if err == nil || !strings.Contains(err.Error(), "identity changed") {
		t.Fatalf("expected changed Cable identity rejection, got %v", err)
	}
}

func TestRunInstallUpdateCableRejectsPostRebootVersionMismatch(t *testing.T) {
	home, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "device-cable", DeviceToken: "pair-token"}); err != nil {
		t.Fatal(err)
	}
	transferCableFirmwareFn = func(context.Context, string, string, string, []byte) error { return nil }
	cableFirmwareVerifyTimeout = 5 * time.Millisecond
	cableFirmwareVerifyPollInterval = time.Millisecond

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{"--target", "cable://vibetv", "--manifest-url", manifestURL, "--skip-launchagent-pause"})
	})
	if err == nil || !strings.Contains(err.Error(), "still reports firmware 1.0.0") {
		t.Fatalf("expected post-reboot Cable version mismatch, got %v", err)
	}
	if !strings.Contains(output, `"retryPolicy":"power_cycle"`) || !strings.Contains(output, `"uploadAccepted":true`) {
		t.Fatalf("accepted Cable update must require a power cycle before retry:\n%s", output)
	}
}

func prepareCableFirmwareUpdateTest(t *testing.T) (string, string, *string) {
	t.Helper()
	pinNoOtherRuntimeWriter(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	previousResolve := resolveCableFirmwarePortFn
	previousRead := readCableFirmwareHelloFn
	previousTransfer := transferCableFirmwareFn
	previousTimeout := cableFirmwareVerifyTimeout
	previousPoll := cableFirmwareVerifyPollInterval
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		resolveCableFirmwarePortFn = previousResolve
		readCableFirmwareHelloFn = previousRead
		transferCableFirmwareFn = previousTransfer
		cableFirmwareVerifyTimeout = previousTimeout
		cableFirmwareVerifyPollInterval = previousPoll
		releaseHTTPClient = previousHTTPClient
	})
	firmwareVersion := "1.0.0"
	resolveCableFirmwarePortFn = func(explicit, expectedDeviceID string) (string, error) {
		if explicit != "" || expectedDeviceID != "device-cable" {
			t.Fatalf("unexpected Cable resolution explicit=%q id=%q", explicit, expectedDeviceID)
		}
		return "/dev/mock-cable", nil
	}
	readCableFirmwareHelloFn = func(port string) (protocol.DeviceHello, error) {
		if port != "/dev/mock-cable" {
			t.Fatalf("unexpected Cable port %q", port)
		}
		return protocol.DeviceHello{DeviceID: "device-cable", Board: "esp8266-smalltv-st7789", Firmware: firmwareVersion}, nil
	}
	image := "cable firmware"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/manifest.json":
			_, _ = fmt.Fprintf(w, `{"schemaVersion":1,"release":"v1.0.1","artifacts":[{"firmwareEnv":"esp8266_smalltv_st7789","board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.1","asset":"firmware.bin","firmwareUrl":"%s/firmware.bin","sha256":"%s"}]}`, "http://"+r.Host, sha256String(image))
		case "/firmware.bin":
			_, _ = io.WriteString(w, image)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	releaseHTTPClient = server.Client()
	return home, server.URL + "/manifest.json", &firmwareVersion
}

func TestRunInstallUpdateRediscoverAfterFirmwareRebootIPChange(t *testing.T) {
	pinNoOtherRuntimeWriter(t)
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
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.1","features":["theme"],"maxFrameBytes":1024}`))
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
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.0","features":["theme"],"maxFrameBytes":1024}`))
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
		DeviceID:     "device-a",
		DeviceToken:  "pair-token",
	}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	releaseHTTPClient = oldServer.Client()
	uploadFirmwareOTAFn = func(_ context.Context, base string, _ string, token, currentFirmware string) error {
		if base != oldServer.URL {
			t.Fatalf("expected OTA upload to use old target %q, got %q", oldServer.URL, base)
		}
		if token != "pair-token" {
			t.Fatalf("expected stored token, got %q", token)
		}
		if currentFirmware != "1.0.0" {
			t.Fatalf("expected current firmware 1.0.0, got %q", currentFirmware)
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
				DeviceID:        "device-a",
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
	rebootingAt := strings.Index(output, `"stage":"rebooting"`)
	rediscoveringAt := strings.Index(output, `"stage":"rediscovering"`)
	verifiedAt := strings.LastIndex(output, `"stage":"verifying_health"`)
	if rebootingAt < 0 || rediscoveringAt <= rebootingAt || verifiedAt <= rediscoveringAt {
		t.Fatalf("expected truthful reboot -> rediscovery -> verification events, got:\n%s", output)
	}
	if !strings.Contains(output[verifiedAt:], `"observedFirmware":"1.0.1"`) {
		t.Fatalf("final verification event lost the observed firmware, got:\n%s", output)
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

func TestEnsureFirmwareUpdateDeviceTokenStoresValidatedIdentityTuple(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	home := t.TempDir()
	savedTarget := "http://192.168.178.72"
	if err := runtimeconfig.Save(home, runtimeconfig.Config{
		DeviceTarget: savedTarget,
		DeviceID:     "device-old",
		DeviceToken:  "pair-token",
	}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	authenticatedHelloCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
			t.Errorf("expected authenticated hello token, got %q", got)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		authenticatedHelloCalls++
		_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-new","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.1"}`))
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()

	token, err := ensureFirmwareUpdateDeviceToken(context.Background(), home, server.URL, "device-new")
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
	if authenticatedHelloCalls != 1 {
		t.Fatalf("expected one authenticated hello, got %d", authenticatedHelloCalls)
	}
	if cfg.DeviceTarget != server.URL || cfg.DeviceID != "device-new" || cfg.DeviceToken != "pair-token" {
		t.Fatalf("expected validated active identity tuple, got %+v", cfg)
	}
	known, ok := cfg.KnownDevice("device-new")
	if !ok || known.Target != server.URL || known.DeviceToken != "pair-token" {
		t.Fatalf("expected validated known-device tuple, got %+v", cfg.KnownDevices)
	}
}

// Renamed from TestFetchDeviceHelloHTTPWithTokenSendsQueryFallbackAndRedactsErrors.
// That test required the token in the header AND the query string. Measured on
// real hardware, exactly that combination makes the device close the connection
// (24/30 EOF) and was the reason every firmware update failed. The query
// fallback assertion is therefore gone; the header-only rule replaces it.
// See docs/hardware-contract.md.
func TestFetchDeviceHelloHTTPWithTokenSendsHeaderOnlyAndRedactsErrors(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	token := "pair token/with+symbols"
	transportErr := errors.New("connection refused")
	releaseHTTPClient = releaseHTTPDoerFunc(func(req *http.Request) (*http.Response, error) {
		if got := req.Header.Get("X-VibeTV-Token"); got != token {
			t.Fatalf("expected pairing token header, got %q", got)
		}
		if got := req.URL.Query().Get("token"); got != "" {
			t.Fatalf("pairing token must not be duplicated into the query string, got %q", got)
		}
		return nil, &url.Error{
			Op:  "Get",
			URL: req.URL.String(),
			Err: transportErr,
		}
	})

	_, err := fetchDeviceHelloHTTPWithToken(context.Background(), "http://192.0.2.10", token)
	if err == nil {
		t.Fatal("expected authenticated hello transport error")
	}
	if strings.Contains(err.Error(), token) || strings.Contains(err.Error(), url.QueryEscape(token)) {
		t.Fatalf("authenticated hello error leaked pairing token: %v", err)
	}
	// The token now travels in the header only, so it can never reach the URL
	// that transport errors quote. That is a stronger guarantee than redacting
	// it afterwards -- see docs/hardware-contract.md for why the query carrier
	// was removed. The redaction wrapper is still covered on its own below.
	if strings.Contains(err.Error(), "token=") {
		t.Fatalf("authenticated hello URL must not carry a token at all: %v", err)
	}
	if !errors.Is(err, transportErr) {
		t.Fatalf("expected original transport error to remain unwrap-compatible, got: %v", err)
	}
}

func TestFetchDeviceHelloHTTPWithTokenUsesFreshConnection(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	connections := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		connections <- req.RemoteAddr
		if req.URL.Path == "/hello" {
			if got := req.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				http.Error(w, "pairing token required", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(
				`{"kind":"hello","deviceId":"device-new","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.1"}`,
			))
		}
	}))
	defer server.Close()
	client := server.Client()
	releaseHTTPClient = client

	resp, err := client.Get(server.URL + "/warmup")
	if err != nil {
		t.Fatalf("warm shared HTTP connection: %v", err)
	}
	if _, err := io.Copy(io.Discard, resp.Body); err != nil {
		t.Fatalf("read warmup response: %v", err)
	}
	if err := resp.Body.Close(); err != nil {
		t.Fatalf("close warmup response: %v", err)
	}
	warmConnection := <-connections

	hello, err := fetchDeviceHelloHTTPWithToken(context.Background(), server.URL, "pair-token")
	if err != nil {
		t.Fatalf("fetch authenticated hello: %v", err)
	}
	if hello.DeviceID != "device-new" {
		t.Fatalf("unexpected device hello: %+v", hello)
	}
	if helloConnection := <-connections; helloConnection == warmConnection {
		t.Fatalf("authenticated hello reused existing connection %s", helloConnection)
	}
}

// Keeps the redaction wrapper itself under test now that the authenticated
// hello no longer puts the token where it could be quoted back.
func TestRedactedFirmwareDeviceTokenErrorReplacesToken(t *testing.T) {
	token := "pair token/with+symbols"
	wrapped := errors.New("boom")
	err := &redactedFirmwareDeviceTokenError{
		err: &url.Error{
			Op:  "Get",
			URL: "http://192.0.2.10/hello?token=" + url.QueryEscape(token),
			Err: wrapped,
		},
		token: token,
	}
	if strings.Contains(err.Error(), token) || strings.Contains(err.Error(), url.QueryEscape(token)) {
		t.Fatalf("redaction leaked the pairing token: %v", err)
	}
	if !strings.Contains(err.Error(), "[REDACTED]") {
		t.Fatalf("expected pairing token placeholder, got: %v", err)
	}
	if !errors.Is(err, wrapped) {
		t.Fatalf("redaction broke unwrapping: %v", err)
	}
}

func TestEnsureFirmwareUpdateDeviceTokenPairsOnlyOnceWhenFreshTokenIsRejected(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	home := t.TempDir()
	pairCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/pair":
			pairCalls++
			_, _ = w.Write([]byte(`{"ok":true,"token":"rejected-token"}`))
		case "/hello":
			http.Error(w, "pairing token required", http.StatusUnauthorized)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()

	_, err := ensureFirmwareUpdateDeviceToken(context.Background(), home, server.URL, "device-a")
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected rejected fresh token error, got %v", err)
	}
	if pairCalls != 1 {
		t.Fatalf("expected exactly one pairing attempt, got %d", pairCalls)
	}
	cfg, loadErr := runtimeconfig.Load(home)
	if loadErr != nil {
		t.Fatalf("load runtime config: %v", loadErr)
	}
	if cfg.DeviceTarget != "" || cfg.DeviceID != "" || cfg.DeviceToken != "" {
		t.Fatalf("rejected fresh token must not persist an identity, got %+v", cfg)
	}
}

func TestEnsureFirmwareUpdateDeviceTokenRetriesTransientPreflightError(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	home := t.TempDir()
	if err := runtimeconfig.Save(home, runtimeconfig.Config{DeviceToken: "pair-token"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	helloCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			helloCalls++
			if helloCalls == 1 {
				// Simulate the transient EOF the single-threaded ESP8266
				// produces under connection pressure: close without response.
				hj, ok := w.(http.Hijacker)
				if !ok {
					t.Fatal("test server does not support hijacking")
				}
				conn, _, err := hj.Hijack()
				if err != nil {
					t.Fatalf("hijack: %v", err)
				}
				_ = conn.Close()
				return
			}
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.39"}`))
		case "/api/pair":
			t.Fatal("transient transport error must not trigger re-pairing")
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()

	token, err := ensureFirmwareUpdateDeviceToken(context.Background(), home, server.URL, "device-a")
	if err != nil {
		t.Fatalf("transient preflight error must be retried before the flash, got %v", err)
	}
	if token != "pair-token" {
		t.Fatalf("expected stored token, got %q", token)
	}
	if helloCalls != 2 {
		t.Fatalf("expected one retry after the transient error, got %d hello calls", helloCalls)
	}
}

func TestFirmwareOTAAuthErrorDoesNotReadStatusFromPort(t *testing.T) {
	err := errors.New(`Get "http://127.0.0.1:42401/hello": EOF`)
	if firmwareOTAAuthError(err) {
		t.Fatalf("transport error port must not look like an HTTP auth status: %v", err)
	}
}

func TestFetchDeviceHelloRetryStopsOnAuthError(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
	})

	helloCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		helloCalls++
		http.Error(w, "pairing token required", http.StatusUnauthorized)
	}))
	defer server.Close()
	releaseHTTPClient = server.Client()

	_, err := fetchDeviceHelloHTTPWithTokenRetry(context.Background(), server.URL, "stale-token")
	if err == nil || !firmwareOTAAuthError(err) {
		t.Fatalf("expected auth error, got %v", err)
	}
	if helloCalls != 1 {
		t.Fatalf("auth errors must never be retried, got %d hello calls", helloCalls)
	}
}

func TestRunInstallUpdateUsesStoredDeviceTokenForOTA(t *testing.T) {
	pinNoOtherRuntimeWriter(t)
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
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
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

func TestRunInstallUpdateRepairsStaleDeviceTokenBeforeOTA(t *testing.T) {
	pinNoOtherRuntimeWriter(t)
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
	})

	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{
		DeviceTarget: "http://192.0.2.50",
		DeviceID:     "device-old",
		DeviceToken:  "stale-token",
	}); err != nil {
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
			token := r.Header.Get("X-VibeTV-Token")
			if token == "" {
				token = r.URL.Query().Get("token")
			}
			if token == "stale-token" {
				http.Error(w, "pairing token required", http.StatusUnauthorized)
				return
			}
			if token != "" && token != "fresh-token" {
				http.Error(w, "unexpected token", http.StatusForbidden)
				return
			}
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
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
	uploadFirmwareOTAFn = func(_ context.Context, _ string, _ string, token, _ string) error {
		uploadTokens = append(uploadTokens, token)
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
	if strings.Join(uploadTokens, ",") != "fresh-token" {
		t.Fatalf("unexpected upload token sequence %v", uploadTokens)
	}
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.DeviceToken != "fresh-token" || cfg.DeviceTarget != server.URL || cfg.DeviceID != "device-a" {
		t.Fatalf("expected repaired runtime config, got %+v", cfg)
	}
	known, ok := cfg.KnownDevice("device-a")
	if !ok || known.Target != server.URL || known.DeviceToken != "fresh-token" {
		t.Fatalf("expected repaired identity tuple in known devices, got %+v", cfg.KnownDevices)
	}
}

func TestRunInstallUpdateStopsBeforeOTAOnNonAuthPreflightError(t *testing.T) {
	pinNoOtherRuntimeWriter(t)
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
	})

	home := t.TempDir()
	t.Setenv("HOME", home)
	initial := runtimeconfig.Config{
		DeviceTarget: "http://192.0.2.60",
		DeviceID:     "device-old",
		DeviceToken:  "saved-token",
	}
	if err := runtimeconfig.Save(home, initial); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	imageBody := "firmware image"
	imageSHA := sha256String(imageBody)
	serverURL := ""
	pairCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if r.Header.Get("X-VibeTV-Token") != "" || r.URL.Query().Get("token") != "" {
				http.Error(w, "temporary hello failure", http.StatusInternalServerError)
				return
			}
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.0"}`))
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

	uploadCalls := 0
	uploadFirmwareOTAFn = func(context.Context, string, string, string, string) error {
		uploadCalls++
		return nil
	}
	err := runInstallUpdate([]string{
		"--target", server.URL,
		"--manifest-url", server.URL + "/manifest.json",
		"--skip-launchagent-pause",
	})
	if err == nil || !strings.Contains(err.Error(), "GET /hello returned 500") {
		t.Fatalf("expected non-authenticated preflight failure, got %v", err)
	}
	if pairCalls != 0 {
		t.Fatalf("non-auth preflight error must not repair pairing, got %d calls", pairCalls)
	}
	if uploadCalls != 0 {
		t.Fatalf("non-auth preflight error must not open OTA, got %d uploads", uploadCalls)
	}
	cfg, loadErr := runtimeconfig.Load(home)
	if loadErr != nil {
		t.Fatalf("load runtime config: %v", loadErr)
	}
	if cfg.DeviceTarget != initial.DeviceTarget || cfg.DeviceID != initial.DeviceID || cfg.DeviceToken != initial.DeviceToken {
		t.Fatalf("failed preflight must not replace saved identity, got %+v", cfg)
	}
}

func TestRunInstallUpdatePausesLaunchAgentDuringOTAAndRestarts(t *testing.T) {
	pinNoOtherRuntimeWriter(t)
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
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
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
	uploadFirmwareOTAFn = func(_ context.Context, _ string, _ string, token, _ string) error {
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
	pinNoOtherRuntimeWriter(t)
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
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"` + firmwareVersion + `","features":["theme"],"maxFrameBytes":1024}`))
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
	uploadFirmwareOTAFn = func(_ context.Context, _ string, _ string, token, _ string) error {
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

// quiesceTestDeviceServer serves the minimal already-current device so a
// runInstallUpdate call that passes the writer-quiesce gate finishes without
// uploading anything. Every request is counted.
func quiesceTestDeviceServer(t *testing.T, requests *int) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*requests++
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.1","features":["theme"],"maxFrameBytes":1024}`))
		case "/manifest.json":
			_, _ = w.Write([]byte(`{"schemaVersion":1,"release":"v1.0.1","artifacts":[{"firmwareEnv":"esp8266_smalltv_st7789","board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.1","asset":"firmware.bin","firmwareUrl":"https://example.invalid/firmware.bin","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

// DO NOT weaken this test. Measured on esp8266-smalltv-st7789 firmware 1.0.39
// (2026-08-07): a correctly paced RAW OTA upload still failed 0/1 while the
// Mac App runtime kept polling the device. The direct CLI updater must
// therefore refuse to send any device request while another local runtime is
// alive, unless the operator explicitly claims every writer is stopped.
func TestRunInstallUpdateAbortsBeforeAnyDeviceRequestWhenAnotherRuntimeIsAlive(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousOrigin := firmwareUpdateRuntimeHealthOrigin
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareUpdateRuntimeHealthOrigin = previousOrigin
	})
	t.Setenv("HOME", t.TempDir())

	runtimeHealthCalls := 0
	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/runtime-health" {
			runtimeHealthCalls++
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer runtime.Close()
	firmwareUpdateRuntimeHealthOrigin = runtime.URL

	deviceRequests := 0
	device := quiesceTestDeviceServer(t, &deviceRequests)
	releaseHTTPClient = device.Client()

	_, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", device.URL,
			"--manifest-url", device.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err == nil {
		t.Fatal("expected abort while another runtime is alive")
	}
	if !strings.Contains(err.Error(), "another VibeTV runtime is running and polling the device; stop it first or pass --i-stopped-all-writers") {
		t.Fatalf("expected quiesce abort message, got: %v", err)
	}
	if deviceRequests != 0 {
		t.Fatalf("abort must happen before any device request, got %d device requests", deviceRequests)
	}
	if runtimeHealthCalls == 0 {
		t.Fatal("expected the updater to probe the runtime-health endpoint")
	}
}

// DO NOT weaken this test. The quiesce gate cares about device writers, not
// runtimes: a standalone `codexbar-display api` parent answers runtime-health
// with displayWriter=false and must not block its own child updater, while a
// writer-owning runtime (displayWriter=true or an older response without the
// field) keeps blocking.
func TestRunInstallUpdateIgnoresNonWriterRuntimeHealthResponder(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousOrigin := firmwareUpdateRuntimeHealthOrigin
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareUpdateRuntimeHealthOrigin = previousOrigin
	})
	t.Setenv("HOME", t.TempDir())

	nonWriter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/runtime-health" {
			_, _ = w.Write([]byte(`{"ok":true,"displayWriter":false}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer nonWriter.Close()
	firmwareUpdateRuntimeHealthOrigin = nonWriter.URL

	deviceRequests := 0
	device := quiesceTestDeviceServer(t, &deviceRequests)
	releaseHTTPClient = device.Client()

	_, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", device.URL,
			"--manifest-url", device.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err != nil {
		t.Fatalf("a declared non-writer must not block the update, got: %v", err)
	}
	if deviceRequests == 0 {
		t.Fatal("expected the update to reach the device")
	}
}

// An older runtime that omits the displayWriter field must stay a writer.
func TestRunInstallUpdateTreatsLegacyRuntimeHealthAsWriter(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousOrigin := firmwareUpdateRuntimeHealthOrigin
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareUpdateRuntimeHealthOrigin = previousOrigin
	})
	t.Setenv("HOME", t.TempDir())

	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer legacy.Close()
	firmwareUpdateRuntimeHealthOrigin = legacy.URL

	deviceRequests := 0
	device := quiesceTestDeviceServer(t, &deviceRequests)
	releaseHTTPClient = device.Client()

	_, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", device.URL,
			"--manifest-url", device.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err == nil || !strings.Contains(err.Error(), "another VibeTV runtime is running") {
		t.Fatalf("a legacy runtime-health response must stay a writer, got: %v", err)
	}
	if deviceRequests != 0 {
		t.Fatalf("abort must happen before any device request, got %d", deviceRequests)
	}
}

// DO NOT weaken this test. The native app starts the daemon with
// --api-fallback: when the default port is occupied the daemon serves from a
// fallback port and publishes it in runtime-endpoint.json. The quiesce gate
// must detect that writer even though nothing answers the default origin.
func TestRunInstallUpdateAbortsWhenRuntimeAnswersOnPublishedFallbackEndpoint(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousOrigin := firmwareUpdateRuntimeHealthOrigin
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareUpdateRuntimeHealthOrigin = previousOrigin
	})
	home := t.TempDir()
	t.Setenv("HOME", home)

	// Nothing answers the default origin: grab a loopback port and close it.
	closedListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	firmwareUpdateRuntimeHealthOrigin = "http://" + closedListener.Addr().String()
	_ = closedListener.Close()

	runtimeHealthCalls := 0
	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/runtime-health" {
			runtimeHealthCalls++
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer runtime.Close()

	endpointPath := runtimeEndpointPath(home)
	if err := os.MkdirAll(filepath.Dir(endpointPath), 0o700); err != nil {
		t.Fatal(err)
	}
	endpointJSON := `{"origin":"` + runtime.URL + `","pid":12345}`
	if err := os.WriteFile(endpointPath, []byte(endpointJSON), 0o600); err != nil {
		t.Fatal(err)
	}

	deviceRequests := 0
	device := quiesceTestDeviceServer(t, &deviceRequests)
	releaseHTTPClient = device.Client()

	_, err = captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", device.URL,
			"--manifest-url", device.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err == nil {
		t.Fatal("expected abort while a runtime answers on the published fallback endpoint")
	}
	if !strings.Contains(err.Error(), "another VibeTV runtime is running and polling the device") {
		t.Fatalf("expected quiesce abort message, got: %v", err)
	}
	if deviceRequests != 0 {
		t.Fatalf("abort must happen before any device request, got %d device requests", deviceRequests)
	}
	if runtimeHealthCalls == 0 {
		t.Fatal("expected the updater to probe the published runtime endpoint")
	}
}

// DO NOT weaken this test. --i-stopped-all-writers is the operator's explicit
// claim that every device writer is stopped; the update must proceed then.
func TestRunInstallUpdateProceedsWithWriterFlagDespiteAliveRuntime(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousOrigin := firmwareUpdateRuntimeHealthOrigin
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareUpdateRuntimeHealthOrigin = previousOrigin
	})
	t.Setenv("HOME", t.TempDir())

	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer runtime.Close()
	firmwareUpdateRuntimeHealthOrigin = runtime.URL

	deviceRequests := 0
	device := quiesceTestDeviceServer(t, &deviceRequests)
	releaseHTTPClient = device.Client()

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", device.URL,
			"--manifest-url", device.URL + "/manifest.json",
			"--skip-launchagent-pause",
			"--i-stopped-all-writers",
		})
	})
	if err != nil {
		t.Fatalf("update with --i-stopped-all-writers must proceed, got: %v", err)
	}
	if deviceRequests == 0 {
		t.Fatal("expected the update to talk to the device")
	}
	if !strings.Contains(output, `"outcome":"already_current"`) {
		t.Fatalf("expected already-current outcome, got:\n%s", output)
	}
}

// DO NOT weaken this test. The API job pauses the display stream itself and
// marks its child updater via VIBETV_UPDATE_PARENT_PAUSED=1; the customer path
// must keep working without the CLI flag.
func TestRunInstallUpdateProceedsWhenParentPausedEnvIsSet(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousOrigin := firmwareUpdateRuntimeHealthOrigin
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareUpdateRuntimeHealthOrigin = previousOrigin
	})
	t.Setenv("HOME", t.TempDir())
	t.Setenv("VIBETV_UPDATE_PARENT_PAUSED", "1")

	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer runtime.Close()
	firmwareUpdateRuntimeHealthOrigin = runtime.URL

	deviceRequests := 0
	device := quiesceTestDeviceServer(t, &deviceRequests)
	releaseHTTPClient = device.Client()

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", device.URL,
			"--manifest-url", device.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err != nil {
		t.Fatalf("update from the paused API parent must proceed, got: %v", err)
	}
	if deviceRequests == 0 {
		t.Fatal("expected the update to talk to the device")
	}
	if !strings.Contains(output, `"outcome":"already_current"`) {
		t.Fatalf("expected already-current outcome, got:\n%s", output)
	}
}

// DO NOT weaken this test. No runtime listening means no other writer; the
// check must stay silent and never block the update.
func TestRunInstallUpdateProceedsWhenRuntimeHealthEndpointIsDead(t *testing.T) {
	previousHTTPClient := releaseHTTPClient
	previousOrigin := firmwareUpdateRuntimeHealthOrigin
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		firmwareUpdateRuntimeHealthOrigin = previousOrigin
	})
	t.Setenv("HOME", t.TempDir())

	deadRuntime := httptest.NewServer(http.NotFoundHandler())
	deadOrigin := deadRuntime.URL
	deadRuntime.Close()
	firmwareUpdateRuntimeHealthOrigin = deadOrigin

	deviceRequests := 0
	device := quiesceTestDeviceServer(t, &deviceRequests)
	releaseHTTPClient = device.Client()

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", device.URL,
			"--manifest-url", device.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err != nil {
		t.Fatalf("update without a running runtime must proceed, got: %v", err)
	}
	if deviceRequests == 0 {
		t.Fatal("expected the update to talk to the device")
	}
	if !strings.Contains(output, `"outcome":"already_current"`) {
		t.Fatalf("expected already-current outcome, got:\n%s", output)
	}
}

// themeRestoreTestDevice is a fake device whose upload was aborted: it stays
// on the old firmware and reports the stored theme spec path with
// active=false until POST /theme/active flips it.
type themeRestoreTestDevice struct {
	server           *httptest.Server
	themeActive      bool
	themeActiveCalls int
	themeActiveBody  string
	themeActiveToken string
	themeActiveQuery string
}

func newThemeRestoreTestDevice(t *testing.T, initiallyActive bool) *themeRestoreTestDevice {
	t.Helper()
	device := &themeRestoreTestDevice{themeActive: initiallyActive}
	imageBody := "firmware image"
	device.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.0","features":["theme"],"maxFrameBytes":1024}`))
		case "/manifest.json":
			_, _ = w.Write([]byte(`{"schemaVersion":1,"release":"v1.0.1","artifacts":[{"firmwareEnv":"esp8266_smalltv_st7789","board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.1","asset":"firmware.bin","firmwareUrl":"` + device.server.URL + `/firmware.bin","sha256":"` + sha256String(imageBody) + `"}]}`))
		case "/firmware.bin":
			_, _ = w.Write([]byte(imageBody))
		case "/health":
			active := "false"
			if device.themeActive {
				active = "true"
			}
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"active":` + active + `,"path":"/themes/u/x.json","hash":null,"renderOk":true,"renderError":null,"renderFailures":0}}}`))
		case "/theme/active":
			body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
			device.themeActiveCalls++
			device.themeActiveBody = strings.TrimSpace(string(body))
			device.themeActiveToken = r.Header.Get("X-VibeTV-Token")
			device.themeActiveQuery = r.URL.RawQuery
			device.themeActive = true
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(device.server.Close)
	return device
}

func withFastInterruptedVerify(t *testing.T) {
	t.Helper()
	previousPoll := firmwareHTTPVerifyPollInterval
	previousVerify := firmwareInterruptedVerifyTimeout
	t.Cleanup(func() {
		firmwareHTTPVerifyPollInterval = previousPoll
		firmwareInterruptedVerifyTimeout = previousVerify
	})
	firmwareHTTPVerifyPollInterval = time.Millisecond
	firmwareInterruptedVerifyTimeout = 50 * time.Millisecond
}

// DO NOT weaken this test. Measured on esp8266-smalltv-st7789 firmware 1.0.39
// (2026-08-07): an aborted OTA upload reboots the device and leaves the stored
// theme spec with active=false ("theme-missing") while its path survives; a
// seven-minute isolated observation showed no self-healing. The updater must
// therefore re-activate the stored spec exactly once via an authenticated
// header-token-only POST /theme/active, and still return the upload error.
func TestRunInstallUpdateRestoresStoredThemeAfterAbortedUpload(t *testing.T) {
	pinNoOtherRuntimeWriter(t)
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
	})
	withFastInterruptedVerify(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{DeviceToken: "pair-token"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	device := newThemeRestoreTestDevice(t, false)
	releaseHTTPClient = device.server.Client()
	uploadFirmwareOTAFn = func(context.Context, string, string, string, string) error {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, errors.New("broken pipe"))
	}

	output, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", device.server.URL,
			"--manifest-url", device.server.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err == nil || !errors.Is(err, errFirmwareUploadRestartRequired) {
		t.Fatalf("the original upload error must still be returned, got: %v", err)
	}
	if device.themeActiveCalls != 1 {
		t.Fatalf("expected exactly one stored-theme activation, got %d", device.themeActiveCalls)
	}
	if device.themeActiveToken != "pair-token" {
		t.Fatalf("expected header pairing token on /theme/active, got %q", device.themeActiveToken)
	}
	if strings.Contains(device.themeActiveQuery, "token") {
		t.Fatalf("theme activation must not carry the token in the query, got %q", device.themeActiveQuery)
	}
	if device.themeActiveBody != `{"path":"/themes/u/x.json"}` {
		t.Fatalf("unexpected theme activation body %q", device.themeActiveBody)
	}
	if !device.themeActive {
		t.Fatal("expected device to report the stored theme as active again")
	}
	if !strings.Contains(output, "restored stored theme after aborted upload") {
		t.Fatalf("expected restore log line, got:\n%s", output)
	}
}

// DO NOT weaken this test. When the stored theme is still active after an
// aborted upload there is nothing to repair: no /theme/active write may be
// sent, and the upload error is still returned.
func TestRunInstallUpdateDoesNotTouchActiveThemeAfterAbortedUpload(t *testing.T) {
	previousWatch := themeRestoreRebootWatch
	previousPoll := themeRestorePollInterval
	t.Cleanup(func() {
		themeRestoreRebootWatch = previousWatch
		themeRestorePollInterval = previousPoll
	})
	themeRestoreRebootWatch = 200 * time.Millisecond
	themeRestorePollInterval = 10 * time.Millisecond
	pinNoOtherRuntimeWriter(t)
	previousHTTPClient := releaseHTTPClient
	previousUpload := uploadFirmwareOTAFn
	t.Cleanup(func() {
		releaseHTTPClient = previousHTTPClient
		uploadFirmwareOTAFn = previousUpload
	})
	withFastInterruptedVerify(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{DeviceToken: "pair-token"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	device := newThemeRestoreTestDevice(t, true)
	releaseHTTPClient = device.server.Client()
	uploadFirmwareOTAFn = func(context.Context, string, string, string, string) error {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, errors.New("broken pipe"))
	}

	_, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{
			"--target", device.server.URL,
			"--manifest-url", device.server.URL + "/manifest.json",
			"--skip-launchagent-pause",
		})
	})
	if err == nil || !errors.Is(err, errFirmwareUploadRestartRequired) {
		t.Fatalf("the original upload error must still be returned, got: %v", err)
	}
	if device.themeActiveCalls != 0 {
		t.Fatalf("an active stored theme must not be re-activated, got %d calls", device.themeActiveCalls)
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
		_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-a","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.0","features":["theme"],"maxFrameBytes":1024}`))
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

type releaseHTTPDoerFunc func(*http.Request) (*http.Response, error)

func (fn releaseHTTPDoerFunc) Do(req *http.Request) (*http.Response, error) {
	return fn(req)
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

// DO NOT weaken: this locks a device-proven transport rule. Sending the pairing
// token in the header AND the query string at once makes the real
// esp8266-smalltv-st7789 close the connection without a response (24/30 requests
// failed with EOF on firmware 1.0.39; header-only and query-only were 0/30).
// That is what made every firmware update die in the auth preflight before the
// upload ever started. See docs/hardware-contract.md.
func TestDeviceHelloPreflightSendsTokenOnlyInHeader(t *testing.T) {
	const token = "preflight-token"

	var sawHeader, sawQuery bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			http.NotFound(w, r)
			return
		}
		sawHeader = r.Header.Get("X-VibeTV-Token") == token
		sawQuery = r.URL.Query().Get("token") != ""
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","deviceId":"14799300","firmware":"1.0.39"}`))
	}))
	defer server.Close()

	if _, err := fetchDeviceHelloHTTPWithToken(context.Background(), server.URL, token); err != nil {
		t.Fatalf("authenticated hello: %v", err)
	}
	if !sawHeader {
		t.Fatal("preflight must send the token in the X-VibeTV-Token header")
	}
	if sawQuery {
		t.Fatal("preflight must not duplicate the token into the query string; the device drops those connections")
	}
}

// pinNoOtherRuntimeWriter points the writer-quiesce probe at a stable
// non-writer endpoint so tests never depend on local runtime state or port
// reuse timing.
func pinNoOtherRuntimeWriter(t *testing.T) {
	t.Helper()
	nonWriter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"displayWriter":false}`))
	}))
	previous := firmwareUpdateRuntimeHealthOrigin
	t.Cleanup(func() {
		firmwareUpdateRuntimeHealthOrigin = previous
		nonWriter.Close()
	})
	firmwareUpdateRuntimeHealthOrigin = nonWriter.URL
}

// Hardware, esp8266-smalltv-st7789, 2026-08-07: after a stalled upload the
// device was left on activeTheme "theme-missing" with themeSpec.path intact and
// active=false, and the shipped recovery did not restore it -- although one
// hand-issued header-token POST /theme/active fixed it instantly seconds later.
// The reason is timing: the stall does not always reboot the device
// immediately, so a single check right after the failure still sees the theme
// active, returns, and the theme only goes missing on the reboot that follows.
// The recovery has to keep watching across that reboot.
func TestRunInstallUpdateRestoresStoredThemeLostOnTheRebootAfterAnAbortedUpload(t *testing.T) {
	previousWatch := themeRestoreRebootWatch
	previousPoll := themeRestorePollInterval
	t.Cleanup(func() {
		themeRestoreRebootWatch = previousWatch
		themeRestorePollInterval = previousPoll
	})
	themeRestoreRebootWatch = 2 * time.Second
	themeRestorePollInterval = 10 * time.Millisecond

	var healthCalls atomic.Int32
	var activations atomic.Int32
	var activatedPath atomic.Value
	activatedPath.Store("")
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-late-reboot","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.39"}`))
		case "/health":
			// The first samples still show the pre-reboot device with its theme
			// active. Only the later boot reports the theme gone.
			if healthCalls.Add(1) <= 2 && activations.Load() == 0 {
				_, _ = w.Write([]byte(`{"ok":true,"system":{"bootId":"boot-a","resetCount":381},"display":{"activeTheme":"clippy","themeSpec":{"active":true,"path":"/themes/u/clippy-3-fe3fd4.json"}}}`))
				return
			}
			if activations.Load() > 0 {
				_, _ = w.Write([]byte(`{"ok":true,"system":{"bootId":"boot-b","resetCount":382},"display":{"activeTheme":"clippy","themeSpec":{"active":true,"path":"/themes/u/clippy-3-fe3fd4.json"}}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"system":{"bootId":"boot-b","resetCount":382},"display":{"activeTheme":"theme-missing","themeSpec":{"active":false,"path":"/themes/u/clippy-3-fe3fd4.json"}}}`))
		case "/theme/active":
			if r.URL.RawQuery != "" {
				t.Errorf("stored-theme activation must not put anything in the query: %q", r.URL.RawQuery)
			}
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Errorf("stored-theme activation must send the pairing token in the header, got %q", got)
			}
			var body struct {
				Path string `json:"path"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			activatedPath.Store(body.Path)
			activations.Add(1)
			_, _ = w.Write([]byte(`{"ok":true,"path":"` + body.Path + `"}`))
		default:
			t.Errorf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	restoreStoredThemeAfterAbortedUpload(context.Background(), device.URL, "pair-token")

	if got := activations.Load(); got != 1 {
		t.Fatalf("expected exactly one stored-theme activation across the reboot, got %d", got)
	}
	if got := activatedPath.Load().(string); got != "/themes/u/clippy-3-fe3fd4.json" {
		t.Fatalf("activated the wrong theme path: %q", got)
	}
}
