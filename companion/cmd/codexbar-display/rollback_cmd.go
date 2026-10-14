package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
)

func runRollback(args []string) (resultErr error) {
	fs := flag.NewFlagSet("rollback", flag.ContinueOnError)
	port := fs.String("port", "", "required explicit serial port for firmware rollback")
	image := fs.String("image", "", "firmware image path (default from last-known-good state)")
	manifest := fs.String("manifest", "", "manifest path (default from last-known-good state)")
	scriptPath := fs.String("script-path", "", "path to esp8266-restore.sh (auto-detect when empty)")
	skipVerify := fs.Bool("skip-verify", false, "skip restore manifest/device verification")
	skipCompanion := fs.Bool("skip-companion", false, "skip companion binary rollback")
	skipFirmware := fs.Bool("skip-firmware", false, "skip firmware rollback")
	var backupDirs stringListFlag
	fs.Var(&backupDirs, "backup-dir", "backup directory to search for fallback rollback image (repeatable)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *skipCompanion && *skipFirmware {
		return errors.New("rollback requested with --skip-companion and --skip-firmware; nothing to do")
	}
	if !*skipFirmware {
		resolvedPort, err := resolveSerialPortFn(strings.TrimSpace(*port))
		if err != nil {
			return &commandError{Op: "resolve-port", Code: errcode.RollbackFirmwareRestore, Err: err}
		}
		*port = resolvedPort
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return &commandError{Op: "resolve-home", Code: errcode.RollbackStateLoad, Err: err}
	}

	state, err := loadReleaseStateFn(home)
	if err != nil {
		return &commandError{Op: "load-release-state", Code: errcode.RollbackStateLoad, Err: err}
	}
	recoverTask := false

	if !*skipCompanion {
		source := strings.TrimSpace(state.LastKnownGood.CompanionBinary)
		if source == "" {
			return &commandError{
				Op:   "rollback-companion",
				Code: errcode.RollbackMissingKnownGood,
				Err:  errors.New("no last-known-good companion snapshot in release state"),
			}
		}
		if !fileExists(source) {
			return &commandError{
				Op:   "rollback-companion",
				Code: errcode.RollbackCompanionRestore,
				Err:  fmt.Errorf("known-good companion snapshot missing: %s", source),
			}
		}

		supportDir, err := runtimeSupportDir()
		if err != nil {
			return &commandError{Op: "rollback-companion", Code: errcode.RollbackCompanionRestore, Err: err}
		}
		targetDir := filepath.Join(supportDir, "bin")
		if err := os.MkdirAll(targetDir, 0o755); err != nil {
			return &commandError{Op: "rollback-companion", Code: errcode.RollbackCompanionRestore, Err: err}
		}
		target := filepath.Join(targetDir, setup.CompanionBinaryName(runtime.GOOS))
		if runtime.GOOS == "windows" {
			// Stop can partially succeed before failing, so arm recovery first.
			recoverTask = true
			defer func() {
				if resultErr != nil && recoverTask {
					if err := rollbackRestartLaunchAgentFn(home); err != nil {
						resultErr = errors.Join(resultErr, &commandError{Op: "restart-background-service", Code: errcode.RollbackLaunchAgent, Err: err})
					}
				}
			}()
			if err := rollbackStopTaskFn(home); err != nil {
				return &commandError{Op: "stop-background-service", Code: errcode.RollbackLaunchAgent, Err: err}
			}
		}
		if err := copyRegularFileAtomic(source, target, 0o755); err != nil {
			return &commandError{Op: "rollback-companion", Code: errcode.RollbackCompanionRestore, Err: err}
		}
		fmt.Printf("rollback companion: restored %s -> %s\n", source, target)
	}

	if !*skipFirmware {
		imagePath, manifestPath, staleStateImage := resolveRollbackFirmwareInputs(
			strings.TrimSpace(*image),
			strings.TrimSpace(*manifest),
			state,
		)
		if staleStateImage {
			fmt.Printf(
				"rollback firmware: known-good state image missing (%s); falling back to backup discovery\n",
				strings.TrimSpace(state.LastKnownGood.FirmwareImage),
			)
		}

		restoreArgs := make([]string, 0, 16)
		if strings.TrimSpace(*port) != "" {
			restoreArgs = append(restoreArgs, "--port", strings.TrimSpace(*port))
		}
		if imagePath != "" {
			restoreArgs = append(restoreArgs, "--image", imagePath)
		}
		if manifestPath != "" {
			restoreArgs = append(restoreArgs, "--manifest", manifestPath)
		}
		if strings.TrimSpace(*scriptPath) != "" {
			restoreArgs = append(restoreArgs, "--script-path", strings.TrimSpace(*scriptPath))
		}
		for _, dir := range backupDirs {
			restoreArgs = append(restoreArgs, "--backup-dir", strings.TrimSpace(dir))
		}
		if *skipVerify {
			restoreArgs = append(restoreArgs, "--skip-verify")
		}

		if err := runRestoreKnownGoodCommandFn(restoreArgs); err != nil {
			return &commandError{Op: "rollback-firmware", Code: errcode.RollbackFirmwareRestore, Err: err}
		}
	}

	if !*skipCompanion || !*skipFirmware {
		recoverTask = false // The explicit restart below owns success/failure now.
		if err := rollbackRestartLaunchAgentFn(home); err != nil {
			return &commandError{Op: "restart-launchagent", Code: errcode.RollbackLaunchAgent, Err: err}
		}
	}

	fmt.Println("rollback complete")
	return nil
}

func refreshLastKnownGoodFirmware(state *releaseState, extraBackupDirs []string) {
	if state == nil {
		return
	}

	backupSearchDirs, backupErr := resolveBackupSearchDirs(extraBackupDirs)
	if backupErr != nil {
		return
	}

	latestBackup, imageErr := resolveRestoreImage("", backupSearchDirs)
	if imageErr != nil {
		return
	}

	manifestPath, manifestErr := resolveRestoreManifestPath(latestBackup, "", false)
	if manifestErr != nil {
		return
	}

	state.LastKnownGood.FirmwareImage = latestBackup
	state.LastKnownGood.FirmwareManifest = manifestPath
}

func resolveRollbackFirmwareInputs(requestedImage, requestedManifest string, state releaseState) (imagePath, manifestPath string, staleStateImage bool) {
	imagePath = strings.TrimSpace(requestedImage)
	manifestPath = strings.TrimSpace(requestedManifest)
	if imagePath != "" {
		return imagePath, manifestPath, false
	}

	stateImage := strings.TrimSpace(state.LastKnownGood.FirmwareImage)
	if stateImage == "" {
		return "", manifestPath, false
	}
	if !fileExists(stateImage) {
		return "", manifestPath, true
	}

	imagePath = stateImage
	if manifestPath == "" {
		manifestPath = strings.TrimSpace(state.LastKnownGood.FirmwareManifest)
	}
	return imagePath, manifestPath, false
}
