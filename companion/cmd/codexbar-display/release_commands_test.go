package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

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
