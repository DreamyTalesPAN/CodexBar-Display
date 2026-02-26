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
	case "restore-known-good":
		err = runRestoreKnownGood(os.Args[2:])
	case "setup":
		err = runSetup(os.Args[2:])
	default:
		printUsage()
		os.Exit(2)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("vibeblock commands:")
	fmt.Println("  vibeblock daemon [--port /dev/cu.usbserial-10] [--interval 60s] [--once]")
	fmt.Println("  vibeblock doctor")
	fmt.Println("  vibeblock restore-known-good [--port /dev/cu.usbserial-10] [--image tmp/.../weather_backup_full.bin]")
	fmt.Println("  vibeblock setup [--port /dev/cu.usbserial-10] [--yes] [--skip-flash] [--pin-port]")
}

func runDaemon(args []string) error {
	fs := flag.NewFlagSet("daemon", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	interval := fs.Duration("interval", 60*time.Second, "poll interval")
	once := fs.Bool("once", false, "run one cycle and exit")
	if err := fs.Parse(args); err != nil {
		return err
	}

	opts := daemon.Options{
		Port:     strings.TrimSpace(*port),
		Interval: *interval,
		Once:     *once,
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
	if err := fs.Parse(args); err != nil {
		return err
	}

	return setup.Run(context.Background(), setup.Options{
		Port:          strings.TrimSpace(*port),
		AssumeYes:     *yes,
		SkipFlash:     *skipFlash,
		PinDaemonPort: *pinPort,
	})
}

func runRestoreKnownGood(args []string) error {
	fs := flag.NewFlagSet("restore-known-good", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	image := fs.String("image", "", "backup image path (auto-select newest known-good backup when empty)")
	baud := fs.Int("baud", 460800, "esptool serial baud rate")
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

	repoRoot, err := findRepositoryRootFromCwd()
	if err != nil {
		return fmt.Errorf("locate repository root: %w", err)
	}

	restoreImage, err := resolveRestoreImage(repoRoot, strings.TrimSpace(*image))
	if err != nil {
		return err
	}

	scriptPath := filepath.Join(repoRoot, "scripts", "esp8266-restore.sh")
	if _, err := os.Stat(scriptPath); err != nil {
		return fmt.Errorf("restore script not found: %s", scriptPath)
	}
	if _, err := exec.LookPath("pio"); err != nil {
		return fmt.Errorf("platformio CLI not found in PATH (needed by restore script): %w", err)
	}

	fmt.Printf("restore image: %s\n", restoreImage)
	fmt.Printf("serial port: %s\n", resolvedPort)
	fmt.Printf("baud: %d\n", *baud)

	cmd := exec.Command(
		scriptPath,
		resolvedPort,
		restoreImage,
	)
	cmd.Env = append(os.Environ(), "BAUD="+strconv.Itoa(*baud))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = repoRoot

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("restore-known-good failed: %w", err)
	}
	return nil
}

func findRepositoryRootFromCwd() (string, error) {
	start, err := os.Getwd()
	if err != nil {
		return "", err
	}

	dir := filepath.Clean(start)
	for {
		if fileExists(filepath.Join(dir, "companion", "go.mod")) && fileExists(filepath.Join(dir, "scripts", "esp8266-restore.sh")) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", errors.New("repository root not found; run from repository or pass --image with an absolute path")
}

func resolveRestoreImage(repoRoot, requested string) (string, error) {
	if requested != "" {
		path := requested
		if !filepath.IsAbs(path) {
			path = filepath.Join(repoRoot, path)
		}
		if !fileExists(path) {
			return "", fmt.Errorf("restore image not found: %s", path)
		}
		return path, nil
	}

	candidates := make([]string, 0, 8)
	patterns := []string{
		filepath.Join(repoRoot, "tmp", "backup_chunks_*", "weather_backup_full.bin"),
		filepath.Join(repoRoot, "tmp", "weather_backup_*.bin"),
	}
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern)
		for _, match := range matches {
			if fileExists(match) {
				candidates = append(candidates, match)
			}
		}
	}
	if len(candidates) == 0 {
		return "", errors.New("no known-good backup image found in tmp/; pass --image <path/to/backup.bin>")
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

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}
