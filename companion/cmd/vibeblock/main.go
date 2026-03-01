package main

import (
	"context"
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

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/health"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(2)
	}

	var err error
	switch os.Args[1] {
	case "daemon":
		err = runDaemon(os.Args[2:])
	case "doctor":
		err = runDoctor()
	case "health":
		err = health.Run(context.Background())
	case "version":
		err = runVersion(os.Args[2:])
	case "upgrade":
		err = runUpgrade(os.Args[2:])
	case "rollback":
		err = runRollback(os.Args[2:])
	case "restore-known-good":
		err = runRestoreKnownGood(os.Args[2:])
	case "gif-upload":
		err = runGIFUpload(os.Args[2:])
	case "setup":
		err = runSetup(os.Args[2:])
	default:
		printUsage()
		os.Exit(2)
	}

	if err != nil {
		if code := errcode.Of(err); code != "" {
			fmt.Fprintf(os.Stderr, "error code=%s\n", code)
		}
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		recovery := strings.TrimSpace(errcode.Recovery(err))
		if recovery != "" && !strings.Contains(err.Error(), "recovery:") {
			fmt.Fprintf(os.Stderr, "recovery: %s\n", recovery)
		}
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("vibeblock commands:")
	fmt.Println("  vibeblock daemon [--port /dev/cu.usbserial-10] [--interval 60s] [--once] [--theme classic|crt|mini]")
	fmt.Println("  vibeblock doctor")
	fmt.Println("  vibeblock health")
	fmt.Println("  vibeblock version [--short] [--json]")
	fmt.Println("  vibeblock upgrade [--port /dev/cu.usbserial-10] [--firmware-env env] [--target-firmware-version x.y.z] [--skip-version-guard]")
	fmt.Println("  vibeblock rollback [--port /dev/cu.usbserial-10] [--skip-companion] [--skip-firmware] [--image path/to/backup.bin] [--manifest path/to/backup.manifest] [--backup-dir <dir>] [--script-path <path>] [--skip-verify]")
	fmt.Println("  vibeblock restore-known-good [--port /dev/cu.usbserial-10] [--image path/to/backup.bin] [--backup-dir <dir>] [--script-path <path>] [--manifest <path>] [--skip-verify]")
	fmt.Println("  vibeblock gif-upload [--port /dev/cu.usbserial-10] [--gif ~/Downloads/testgif(.gif)] [--baud 115200] [--play=true]")
	fmt.Println("  vibeblock setup [--port /dev/cu.usbserial-10] [--yes] [--skip-flash] [--pin-port] [--firmware-env env] [--theme classic|crt|mini|none] [--validate-only] [--dry-run]")
}

func runDaemon(args []string) error {
	fs := flag.NewFlagSet("daemon", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	interval := fs.Duration("interval", 60*time.Second, "poll interval")
	once := fs.Bool("once", false, "run one cycle and exit")
	theme := fs.String("theme", "", "optional runtime theme override: classic|crt|mini")
	if err := fs.Parse(args); err != nil {
		return err
	}

	opts := daemon.Options{
		Port:     strings.TrimSpace(*port),
		Interval: *interval,
		Once:     *once,
		Theme:    strings.TrimSpace(*theme),
	}
	return daemon.Run(context.Background(), opts)
}

func runDoctor() error {
	var doctorErrs []error

	bin, err := codexbar.FindBinary()
	if err != nil {
		fmt.Printf("CodexBar CLI: not found (%v)\n", err)
		doctorErrs = append(doctorErrs, errors.New("CodexBar CLI not found"))
	} else {
		fmt.Printf("CodexBar CLI: %s\n", bin)
	}

	ports, err := usb.ListPorts()
	if err != nil {
		return fmt.Errorf("list serial ports: %w", err)
	}

	fmt.Println("Serial ports:")
	if len(ports) == 0 {
		fmt.Println("  (none)")
	} else {
		for _, p := range ports {
			fmt.Printf("  %s\n", p)
		}
	}

	if runtimeErr := runDoctorRuntimeChecks(); runtimeErr != nil {
		doctorErrs = append(doctorErrs, runtimeErr)
	}

	if bin != "" {
		checkCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		frame, fetchErr := codexbar.FetchFirstFrame(checkCtx)
		if fetchErr != nil {
			fmt.Printf("Provider preview: failed (%v)\n", fetchErr)
			doctorErrs = append(doctorErrs, fmt.Errorf("provider preview failed: %w", fetchErr))
		} else {
			fmt.Printf("Provider preview: %s session=%d%% weekly=%d%% reset=%ds\n",
				frame.Label, frame.Session, frame.Weekly, frame.ResetSec)
		}
	}

	if len(doctorErrs) > 0 {
		return errors.Join(doctorErrs...)
	}
	return nil
}

func runDoctorRuntimeChecks() error {
	fmt.Println("Runtime checks:")
	fmt.Printf("  codexbar timeout: %s\n", codexbar.CommandTimeout())
	fmt.Printf("  last-good max age: %s\n", daemon.LastGoodMaxAge())
	fmt.Printf("  sleep/wake threshold (@60s interval): %s\n", daemon.SleepWakeGapThreshold(60*time.Second))

	port, err := usb.ResolvePort("")
	if err != nil {
		fmt.Printf("  serial resolve: failed (%v)\n", err)
		return fmt.Errorf("runtime serial resolve failed: %w", err)
	}
	fmt.Printf("  serial resolve: ok (%s)\n", port)

	if err := usb.ProbePort(port); err != nil {
		fmt.Printf("  serial probe: failed (%v)\n", err)
		return fmt.Errorf("runtime serial probe failed: %w", err)
	}
	fmt.Printf("  serial probe: ok (%s)\n", port)

	return nil
}

func runSetup(args []string) error {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	yes := fs.Bool("yes", false, "auto-select defaults without prompts")
	skipFlash := fs.Bool("skip-flash", false, "skip firmware flashing")
	pinPort := fs.Bool("pin-port", false, "pin daemon to selected --port in LaunchAgent (default: auto-detect)")
	firmwareEnv := fs.String("firmware-env", setup.DefaultFirmwareEnvironment(), "PlatformIO environment to flash (examples: esp8266_smalltv_st7789, lilygo_t_display_s3)")
	theme := fs.String("theme", "", "optional runtime theme override: classic|crt|mini|none (empty keeps existing setting)")
	validateOnly := fs.Bool("validate-only", false, "validate setup prerequisites only; do not change system state")
	dryRun := fs.Bool("dry-run", false, "show setup actions without applying changes")
	if err := fs.Parse(args); err != nil {
		return err
	}

	return setup.Run(context.Background(), setup.Options{
		Port:          strings.TrimSpace(*port),
		AssumeYes:     *yes,
		SkipFlash:     *skipFlash,
		PinDaemonPort: *pinPort,
		FirmwareEnv:   strings.TrimSpace(*firmwareEnv),
		Theme:         strings.TrimSpace(*theme),
		ValidateOnly:  *validateOnly,
		DryRun:        *dryRun,
	})
}

func runRestoreKnownGood(args []string) error {
	fs := flag.NewFlagSet("restore-known-good", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
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

	resolvedPort, err := usb.ResolvePort(strings.TrimSpace(*port))
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

	sort.Slice(candidates, func(i, j int) bool {
		si, errI := os.Stat(candidates[i])
		sj, errJ := os.Stat(candidates[j])
		if errI == nil && errJ == nil {
			ti := si.ModTime()
			tj := sj.ModTime()
			if !ti.Equal(tj) {
				return ti.After(tj)
			}
		}
		return candidates[i] < candidates[j]
	})

	return candidates[0], nil
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

	return "", errors.New("restore script not found; run `vibeblock setup` first or pass --script-path /path/to/esp8266-restore.sh")
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
	return filepath.Join(home, "Library", "Application Support", "vibeblock"), nil
}

func resolvePathFromCwd(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("empty path")
	}
	if filepath.IsAbs(path) {
		return filepath.Clean(path), nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	return filepath.Clean(filepath.Join(cwd, path)), nil
}

func boolAsShellValue(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

type stringListFlag []string

func (f *stringListFlag) String() string {
	if f == nil {
		return ""
	}
	return strings.Join(*f, ",")
}

func (f *stringListFlag) Set(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("backup dir cannot be empty")
	}
	*f = append(*f, value)
	return nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}
