package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

func runRestoreKnownGood(args []string) error {
	fs := flag.NewFlagSet("restore-known-good", flag.ContinueOnError)
	port := fs.String("port", "", "required explicit serial recovery port")
	image := fs.String("image", "", "backup image path (auto-select newest known-good backup when empty)")
	baud := fs.Int("baud", 460800, "esptool serial baud rate")
	scriptPath := fs.String("script-path", "", "path to esp8266-restore.sh (auto-detect when empty)")
	manifest := fs.String("manifest", "", "manifest path (default: <image>.manifest)")
	skipVerify := fs.Bool("skip-verify", false, "skip manifest/device verification (unsafe, legacy fallback)")
	var backupDirs stringListFlag
	fs.Var(&backupDirs, "backup-dir", "backup directory to search when --image is empty (repeatable)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *baud <= 0 {
		return fmt.Errorf("invalid --baud: %d", *baud)
	}

	resolvedPort, err := resolveSerialPortFn(strings.TrimSpace(*port))
	// Discovery retains the sender; the restore subprocess needs exclusive access.
	closeDefaultSenderFn()
	if err != nil {
		return fmt.Errorf("resolve serial port: %w", err)
	}

	resolvedScriptPath, err := resolveRestoreScriptPath(strings.TrimSpace(*scriptPath))
	if err != nil {
		return err
	}

	searchDirs, err := resolveBackupSearchDirs(backupDirs)
	if err != nil {
		return err
	}

	restoreImage, err := resolveRestoreImage(strings.TrimSpace(*image), searchDirs)
	if err != nil {
		return err
	}

	manifestPath, err := resolveRestoreManifestPath(restoreImage, strings.TrimSpace(*manifest), *skipVerify)
	if err != nil {
		return err
	}

	if _, err := exec.LookPath("pio"); err != nil {
		return fmt.Errorf("platformio CLI not found in PATH (needed by restore script): %w", err)
	}

	fmt.Printf("restore script: %s\n", resolvedScriptPath)
	fmt.Printf("restore image: %s\n", restoreImage)
	if *skipVerify {
		fmt.Println("manifest verification: skipped (--skip-verify)")
	} else {
		fmt.Printf("manifest: %s\n", manifestPath)
	}
	fmt.Printf("serial port: %s\n", resolvedPort)
	fmt.Printf("baud: %d\n", *baud)

	cmd := exec.Command(
		resolvedScriptPath,
		resolvedPort,
		restoreImage,
	)
	env := append(
		os.Environ(),
		"BAUD="+strconv.Itoa(*baud),
		"SKIP_VERIFY="+boolAsShellValue(*skipVerify),
	)
	if manifestPath != "" {
		env = append(env, "MANIFEST="+manifestPath)
	}
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = filepath.Dir(resolvedScriptPath)

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("restore-known-good failed: %w", err)
	}
	return nil
}

func resolveRestoreImage(requested string, searchDirs []string) (string, error) {
	if requested != "" {
		path, err := resolvePathFromCwd(requested)
		if err != nil {
			return "", err
		}
		if !fileExists(path) {
			return "", fmt.Errorf("restore image not found: %s", path)
		}
		return path, nil
	}

	candidates := make([]string, 0, 8)
	for _, dir := range searchDirs {
		patterns := []string{
			filepath.Join(dir, "backup_chunks_*", "weather_backup_full.bin"),
			filepath.Join(dir, "weather_backup_*.bin"),
			filepath.Join(dir, "*.bin"),
		}
		for _, pattern := range patterns {
			matches, _ := filepath.Glob(pattern)
			for _, match := range matches {
				if fileExists(match) {
					candidates = append(candidates, match)
				}
			}
		}
	}
	if len(candidates) == 0 {
		return "", errors.New("no known-good backup image found; pass --image <path/to/backup.bin> or add --backup-dir <dir>")
	}

	type backupCandidate struct {
		path    string
		modTime time.Time
		hasTime bool
	}
	backups := make([]backupCandidate, 0, len(candidates))
	for _, path := range candidates {
		backup := backupCandidate{path: path}
		if info, err := os.Stat(path); err == nil {
			backup.modTime, backup.hasTime = info.ModTime(), true
		}
		backups = append(backups, backup)
	}
	sort.Slice(backups, func(i, j int) bool {
		a, b := backups[i], backups[j]
		if a.hasTime && b.hasTime && !a.modTime.Equal(b.modTime) {
			return a.modTime.After(b.modTime)
		}
		return a.path < b.path
	})

	return backups[0].path, nil
}

func resolveRestoreScriptPath(requested string) (string, error) {
	if strings.TrimSpace(requested) != "" {
		path, err := resolvePathFromCwd(requested)
		if err != nil {
			return "", err
		}
		if !fileExists(path) {
			return "", fmt.Errorf("restore script not found: %s", path)
		}
		return path, nil
	}

	candidates := make([]string, 0, 4)
	if appSupport, err := runtimeSupportDir(); err == nil {
		candidates = append(candidates, filepath.Join(appSupport, "scripts", "esp8266-restore.sh"))
	}

	if execPath, err := os.Executable(); err == nil {
		binDir := filepath.Dir(execPath)
		candidates = append(candidates, filepath.Join(filepath.Dir(binDir), "scripts", "esp8266-restore.sh"))
	}

	if repoRoot, ok := findRepositoryRootFromWorkingDir(); ok {
		candidates = append(candidates, filepath.Join(repoRoot, "scripts", "esp8266-restore.sh"))
	}

	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		candidate = filepath.Clean(candidate)
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		if fileExists(candidate) {
			return candidate, nil
		}
	}

	return "", errors.New("restore script not found; run `codexbar-display setup` first or pass --script-path /path/to/esp8266-restore.sh")
}

func resolveBackupSearchDirs(extraDirs []string) ([]string, error) {
	candidateDirs := make([]string, 0, len(extraDirs)+4)
	candidateDirs = append(candidateDirs, extraDirs...)

	if appSupport, err := runtimeSupportDir(); err == nil {
		candidateDirs = append(candidateDirs, filepath.Join(appSupport, "backups"))
		candidateDirs = append(candidateDirs, filepath.Join(appSupport, "known-good"))
	}

	if repoRoot, ok := findRepositoryRootFromWorkingDir(); ok {
		candidateDirs = append(candidateDirs, filepath.Join(repoRoot, "tmp"))
		candidateDirs = append(candidateDirs, filepath.Join(repoRoot, "known-good"))
	}

	if cwd, err := os.Getwd(); err == nil {
		candidateDirs = append(candidateDirs, filepath.Join(cwd, "tmp"))
	}

	seen := make(map[string]struct{}, len(candidateDirs))
	resolved := make([]string, 0, len(candidateDirs))
	for _, dir := range candidateDirs {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		abs, err := resolvePathFromCwd(dir)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		resolved = append(resolved, abs)
	}
	return resolved, nil
}

func resolveRestoreManifestPath(imagePath, requested string, skipVerify bool) (string, error) {
	if skipVerify {
		return "", nil
	}

	if strings.TrimSpace(requested) != "" {
		path, err := resolvePathFromCwd(requested)
		if err != nil {
			return "", err
		}
		if !fileExists(path) {
			return "", fmt.Errorf("manifest not found: %s", path)
		}
		return path, nil
	}

	candidates := []string{
		imagePath + ".manifest",
		imagePath + ".manifest.json",
	}
	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("manifest not found for %s; run backup again or pass --manifest <path> (or use --skip-verify)", imagePath)
}

func findRepositoryRootFromWorkingDir() (string, bool) {
	start, err := os.Getwd()
	if err != nil {
		return "", false
	}
	dir := filepath.Clean(start)
	for {
		if fileExists(filepath.Join(dir, "companion", "go.mod")) && fileExists(filepath.Join(dir, "scripts", "esp8266-restore.sh")) {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", false
}

func runtimeSupportDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	root := runtimepaths.Root(home)
	if root == "" {
		return "", errors.New("user config directory is unavailable")
	}
	return root, nil
}
