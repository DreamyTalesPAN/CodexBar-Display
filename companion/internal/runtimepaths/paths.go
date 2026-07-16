package runtimepaths

import (
	"os"
	"path/filepath"
	"strings"
)

const (
	DisplayStreamOutLogEnv                    = "CODEXBAR_DISPLAY_STREAM_OUT_LOG"
	DisplayWriterLockEnv                      = "CODEXBAR_DISPLAY_WRITER_LOCK"
	DisplayStreamLaunchAgentLabelEnv          = "CODEXBAR_DISPLAY_STREAM_LAUNCH_AGENT_LABEL"
	LegacyDisplayStreamLaunchAgentLabel       = "com.codexbar-display.daemon"
	displayStreamOutLog                       = "daemon.out.log"
	DisplayStreamLogMaxBytes            int64 = 1024 * 1024
	DisplayStreamLogTailBytes           int64 = 64 * 1024
	DisplayStreamMarkerRepeatBytes      int64 = 32 * 1024
	DisplayStreamLogRecordMaxBytes      int64 = 8 * 1024
)

// DisplayWriterLock returns the per-user lock shared by every Companion daemon.
// An environment override keeps the lock isolated in tests.
func DisplayWriterLock(home string) string {
	if path := strings.TrimSpace(os.Getenv(DisplayWriterLockEnv)); path != "" {
		return path
	}

	home = strings.TrimSpace(home)
	if home == "" {
		resolved, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		home = strings.TrimSpace(resolved)
	}
	if home == "" {
		return ""
	}

	return filepath.Join(home, "Library", "Application Support", "codexbar-display", "run", "display-writer.lock")
}

// DisplayStreamOutLog returns the shared display-worker log used by both the
// persistent daemon and the local Companion API. An explicit environment
// override is retained for existing installations and tests.
func DisplayStreamOutLog(home string) string {
	if path := strings.TrimSpace(os.Getenv(DisplayStreamOutLogEnv)); path != "" {
		return path
	}

	home = strings.TrimSpace(home)
	if home == "" {
		resolved, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		home = strings.TrimSpace(resolved)
	}
	if home == "" {
		return ""
	}

	return filepath.Join(home, "Library", "Application Support", "codexbar-display", "logs", displayStreamOutLog)
}

// DisplayStreamOutLogArchive is the single bounded archive retained when the
// active display stream log rotates.
func DisplayStreamOutLogArchive(logPath string) string {
	logPath = strings.TrimSpace(logPath)
	if logPath == "" {
		return ""
	}
	return logPath + ".1"
}

// DisplayStreamLaunchAgentLabel returns the service whose worker state must be
// correlated with display stream log records.
func DisplayStreamLaunchAgentLabel() string {
	if label := strings.TrimSpace(os.Getenv(DisplayStreamLaunchAgentLabelEnv)); label != "" {
		return label
	}
	return LegacyDisplayStreamLaunchAgentLabel
}

// DisplayStreamRequiresStartMarker keeps legacy agents compatible while new
// bundled runtimes require records from their own process lifetime.
func DisplayStreamRequiresStartMarker() bool {
	return DisplayStreamLaunchAgentLabel() != LegacyDisplayStreamLaunchAgentLabel
}
