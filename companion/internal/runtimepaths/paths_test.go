package runtimepaths

import (
	"path/filepath"
	"testing"
)

func TestDisplayStreamOutLogUsesApplicationSupport(t *testing.T) {
	t.Setenv(DisplayStreamOutLogEnv, "")
	home := t.TempDir()

	got := DisplayStreamOutLog(home)
	want := filepath.Join(home, "Library", "Application Support", "codexbar-display", "logs", "daemon.out.log")
	if got != want {
		t.Fatalf("expected display stream log %q, got %q", want, got)
	}
}

func TestDisplayStreamOutLogKeepsLegacyEnvironmentOverride(t *testing.T) {
	want := filepath.Join(t.TempDir(), "legacy-daemon.log")
	t.Setenv(DisplayStreamOutLogEnv, want)

	if got := DisplayStreamOutLog(t.TempDir()); got != want {
		t.Fatalf("expected environment override %q, got %q", want, got)
	}
}

func TestDisplayStreamOutLogDoesNotFallBackToTmpWithoutHome(t *testing.T) {
	t.Setenv(DisplayStreamOutLogEnv, "")
	t.Setenv("HOME", "")

	if got := DisplayStreamOutLog(""); got != "" {
		t.Fatalf("expected no path without a home directory, got %q", got)
	}
}

func TestDisplayStreamOutLogArchiveUsesSingleSiblingFile(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	if got, want := DisplayStreamOutLogArchive(logPath), logPath+".1"; got != want {
		t.Fatalf("expected display stream archive %q, got %q", want, got)
	}
	if DisplayStreamLogTailBytes <= 0 || DisplayStreamLogTailBytes >= DisplayStreamLogMaxBytes {
		t.Fatalf(
			"expected bounded tail smaller than max log size, tail=%d max=%d",
			DisplayStreamLogTailBytes,
			DisplayStreamLogMaxBytes,
		)
	}
}

func TestDisplayStreamLaunchAgentLabelKeepsLegacyDefault(t *testing.T) {
	t.Setenv(DisplayStreamLaunchAgentLabelEnv, "")
	if got := DisplayStreamLaunchAgentLabel(); got != LegacyDisplayStreamLaunchAgentLabel {
		t.Fatalf("expected legacy display stream label %q, got %q", LegacyDisplayStreamLaunchAgentLabel, got)
	}
	if DisplayStreamRequiresStartMarker() {
		t.Fatal("legacy display stream must remain compatible without a start marker")
	}
}

func TestDisplayStreamLaunchAgentLabelRequiresMarkerForBundledRuntime(t *testing.T) {
	t.Setenv(DisplayStreamLaunchAgentLabelEnv, "shop.vibetv.control-center.runtime")
	if got := DisplayStreamLaunchAgentLabel(); got != "shop.vibetv.control-center.runtime" {
		t.Fatalf("unexpected bundled runtime label %q", got)
	}
	if !DisplayStreamRequiresStartMarker() {
		t.Fatal("bundled runtime must require its own start marker")
	}
}
