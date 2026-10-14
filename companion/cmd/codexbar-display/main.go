package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/health"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

func main() {
	args := os.Args[1:]
	if len(args) == 0 && launchedFromAppBundle() {
		args = []string{"open-control-center"}
	}
	if len(args) < 1 {
		printUsage()
		os.Exit(2)
	}

	var err error
	switch args[0] {
	case "daemon":
		err = runDaemon(args[1:])
	case "api":
		err = runCompanionAPI(args[1:])
	case "doctor":
		err = runDoctor()
	case "health":
		expectedOwner := healthRuntimeOwner()
		err = health.Run(context.Background(), expectedOwner, func() (protocol.DeviceCapabilities, error) {
			return readLocalCableCapabilities(expectedOwner)
		})
	case "open-control-center":
		err = runOpenControlCenter(args[1:])
	case "service":
		err = runService(args[1:])
	case "prepare-codexbar":
		err = runPinnedCodexBar(args[1:], false)
	case "validate-codexbar":
		err = runPinnedCodexBar(args[1:], true)
	case "version":
		err = runVersion(args[1:])
	case "upgrade":
		err = runUpgrade(args[1:])
	case "install-update":
		err = runInstallUpdate(args[1:])
	case "net-probe":
		err = runNetProbe(args[1:])
	case "rollback":
		err = runRollback(args[1:])
	case "restore-known-good":
		err = runRestoreKnownGood(args[1:])
	case "theme-validate":
		err = runThemeValidate(args[1:])
	case "theme-apply":
		err = runThemeApply(args[1:])
	case "theme-pack":
		err = runThemePack(args[1:])
	case "setup":
		err = runSetup(args[1:])
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

func healthRuntimeOwner() string {
	if cfg, err := readDoctorRuntimeConfig(); err == nil && cfg.configured {
		if label := strings.TrimSpace(cfg.label); label != "" {
			return label
		}
	}
	return shellRuntimeLabel()
}

// bundledRuntimeLabels are the runtimes the Mac App registers through
// SMAppService; neither has a LaunchAgents plist.
var bundledRuntimeLabels = []string{runtimepaths.ShellDisplayStreamLaunchAgentLabel, "shop.vibetv.control-center.preview-runtime"}

// shellRuntimeLabel names the runtime a command run from a shell inspects.
// Only the runtime process inherits the label environment, so on macOS a
// loaded bundled runtime wins over the legacy LaunchAgent.
func shellRuntimeLabel() string {
	if runtime.GOOS == "windows" || strings.TrimSpace(os.Getenv(runtimepaths.DisplayStreamLaunchAgentLabelEnv)) != "" {
		return runtimepaths.DisplayStreamLaunchAgentLabel()
	}
	for _, label := range bundledRuntimeLabels {
		if _, err := doctorLaunchAgentPrintFn(label); err == nil {
			return label
		}
	}
	return runtimepaths.LegacyDisplayStreamLaunchAgentLabel
}

func printUsage() {
	fmt.Println("codexbar-display commands:")
	fmt.Println("  codexbar-display api [--addr 127.0.0.1:47832] [--dev-origin http://localhost:3000]")
	fmt.Println("  codexbar-display daemon [--transport wifi|usb] [--target http://<device-ip>] [--port /dev/cu.usbserial-10] [--interval 30s] [--once] [--theme classic|crt|mini] [--api-addr 127.0.0.1:47832] [--native-shell --app-version x.y.z --app-build n --runtime-label <label>]")
	fmt.Println("  codexbar-display doctor")
	fmt.Println("  codexbar-display health")
	fmt.Println("  codexbar-display open-control-center [--addr 127.0.0.1:47832] [--path /control-center] [--no-open]")
	fmt.Println("  codexbar-display service <start|stop|status|install|uninstall> [--label <label>] [daemon args for install...]")
	fmt.Println("  codexbar-display version [--short] [--json]")
	fmt.Println("  codexbar-display upgrade [--port /dev/cu.usbserial-10] [--firmware-env env] [--target-firmware-version x.y.z] [--repo owner/name] [--skip-version-guard]")
	fmt.Println("  codexbar-display install-update [--target http://<device-ip>] [--manifest-url url] [--confirm-live-update] [--force] [--verbose]")
	fmt.Println("  codexbar-display net-probe --target http://<device-ip>")
	fmt.Println("  codexbar-display rollback [--port /dev/cu.usbserial-10] [--skip-companion] [--skip-firmware] [--image path/to/backup.bin] [--manifest path/to/backup.manifest] [--backup-dir <dir>] [--script-path <path>] [--skip-verify]")
	fmt.Println("  codexbar-display restore-known-good [--port /dev/cu.usbserial-10] [--image path/to/backup.bin] [--backup-dir <dir>] [--script-path <path>] [--manifest <path>] [--skip-verify]")
	fmt.Println("  codexbar-display theme-validate --spec path/to/theme-spec.json [--transport wifi|usb] [--target http://<device-ip>] [--port /dev/cu.usbserial-10] [--allow-unknown-capabilities]")
	fmt.Println("  codexbar-display theme-apply --spec path/to/theme-spec.json [--transport wifi|usb] [--target http://<device-ip>] [--port /dev/cu.usbserial-10] [--allow-unknown-capabilities]")
	fmt.Printf("  codexbar-display theme-pack catalog [--catalog %s]\n", defaultThemeCatalogURL)
	fmt.Println("  codexbar-display theme-pack validate --pack path/to/theme-pack-dir-or.zip-or-url [--pack-sha256 hex --pack-size-bytes n]")
	fmt.Println("  codexbar-display theme-pack install (--pack path/to/theme-pack-dir-or.zip-or-url [--pack-sha256 hex --pack-size-bytes n] | --catalog url --theme theme-id) [--target http://<device-ip>] [--firmware-manifest-url url] [--skip-firmware-update] [--allow-unknown-capabilities] [--verbose]")
	fmt.Println("  codexbar-display setup [--transport wifi|usb] [--target http://<device-ip>] [--port /dev/cu.usbserial-10] [--yes] [--skip-flash] [--firmware-env env] [--theme classic|crt|mini|none] [--validate-only] [--dry-run]")
}

func launchedFromAppBundle() bool {
	executable, err := os.Executable()
	if err != nil {
		executable = os.Args[0]
	}
	executable = filepath.ToSlash(filepath.Clean(executable))
	return strings.Contains(executable, ".app/Contents/MacOS/")
}

func flagWasSet(fs *flag.FlagSet, name string) bool {
	wasSet := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == name {
			wasSet = true
		}
	})
	return wasSet
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
