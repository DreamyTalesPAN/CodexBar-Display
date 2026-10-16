package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/childproc"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
)

type releaseState struct {
	SchemaVersion int                 `json:"schemaVersion"`
	UpdatedAtUTC  string              `json:"updatedAtUtc,omitempty"`
	LastKnownGood lastKnownGoodState  `json:"lastKnownGood,omitempty"`
	LastUpgrade   lastUpgradeSnapshot `json:"lastUpgrade,omitempty"`
}

type lastKnownGoodState struct {
	CompanionBinary  string `json:"companionBinary,omitempty"`
	CompanionVersion string `json:"companionVersion,omitempty"`
	FirmwareImage    string `json:"firmwareImage,omitempty"`
	FirmwareManifest string `json:"firmwareManifest,omitempty"`
	FirmwareEnv      string `json:"firmwareEnv,omitempty"`
	CapturedAtUTC    string `json:"capturedAtUtc,omitempty"`
}

type lastUpgradeSnapshot struct {
	CompanionVersion string `json:"companionVersion,omitempty"`
	FirmwareVersion  string `json:"firmwareVersion,omitempty"`
	FirmwareEnv      string `json:"firmwareEnv,omitempty"`
	Port             string `json:"port,omitempty"`
	DeviceBoard      string `json:"deviceBoard,omitempty"`
	UpgradedAtUTC    string `json:"upgradedAtUtc,omitempty"`
}

func releaseStatePath(home string) string {
	return runtimepaths.Path(home, releaseStateFileName)
}

func loadReleaseState(home string) (releaseState, error) {
	path := releaseStatePath(home)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return releaseState{SchemaVersion: releaseStateSchemaVersion}, nil
		}
		return releaseState{}, err
	}
	if len(data) == 0 {
		return releaseState{SchemaVersion: releaseStateSchemaVersion}, nil
	}

	var state releaseState
	if err := json.Unmarshal(data, &state); err != nil {
		return releaseState{}, fmt.Errorf("parse %s: %w", path, err)
	}
	if state.SchemaVersion == 0 {
		state.SchemaVersion = releaseStateSchemaVersion
	}
	return state, nil
}

func saveReleaseState(home string, state releaseState) error {
	path := releaseStatePath(home)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if state.SchemaVersion == 0 {
		state.SchemaVersion = releaseStateSchemaVersion
	}
	if strings.TrimSpace(state.UpdatedAtUTC) == "" {
		state.UpdatedAtUTC = time.Now().UTC().Format(time.RFC3339)
	}

	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')

	tmpPath := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmpPath, payload, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return os.Chmod(path, 0o644)
}

func snapshotInstalledCompanionBinary(home string) (string, string, error) {
	supportDir := runtimepaths.Root(home)
	installed := filepath.Join(supportDir, "bin", setup.CompanionBinaryName(runtime.GOOS))
	if !fileExists(installed) {
		return "", "", nil
	}

	installedVersion := detectBinaryVersion(installed)
	timestamp := time.Now().UTC().Format("20060102T150405Z")
	snapshotDir := filepath.Join(supportDir, "releases", "companion-lkg", timestamp+"-"+sanitizePathToken(installedVersion))
	if err := os.MkdirAll(snapshotDir, 0o755); err != nil {
		return "", "", err
	}

	snapshotPath := filepath.Join(snapshotDir, setup.CompanionBinaryName(runtime.GOOS))
	if err := copyRegularFileAtomic(installed, snapshotPath, 0o755); err != nil {
		return "", "", err
	}
	return snapshotPath, installedVersion, nil
}

func sanitizePathToken(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "unknown"
	}
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "unknown"
	}
	return b.String()
}

func detectBinaryVersion(binPath string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := childproc.Hide(exec.CommandContext(ctx, binPath, "version", "--short"))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "unknown"
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}

func copyRegularFileAtomic(sourcePath, targetPath string, mode os.FileMode) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	tmpPath := fmt.Sprintf("%s.tmp-%d", targetPath, time.Now().UnixNano())
	target, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}

	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(target, source); err != nil {
		_ = target.Close()
		return err
	}
	if err := target.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, targetPath); err != nil {
		return err
	}
	cleanup = false
	return nil
}
