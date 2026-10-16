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

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
)

func runSetup(args []string) error {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	port := fs.String("port", "", "optional serial candidate path (identity-resolved when empty)")
	transportName := fs.String("transport", setup.DefaultSetupTransport(), "device transport for LaunchAgent: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://192.168.1.42")
	yes := fs.Bool("yes", false, "auto-select defaults without prompts")
	skipFlash := fs.Bool("skip-flash", false, "skip firmware flashing")
	firmwareEnv := fs.String("firmware-env", setup.DefaultFirmwareEnvironment(), "release firmware environment to flash (examples: esp8266_smalltv_st7789, lilygo_t_display_s3)")
	theme := fs.String("theme", "", "optional runtime theme override: classic|crt|mini|none (empty keeps existing setting, defaults new installs to mini)")
	validateOnly := fs.Bool("validate-only", false, "validate setup prerequisites only; do not change system state")
	dryRun := fs.Bool("dry-run", false, "show setup actions without applying changes")
	if err := fs.Parse(args); err != nil {
		return err
	}

	return setup.Run(context.Background(), setup.Options{
		Port:         strings.TrimSpace(*port),
		Transport:    strings.TrimSpace(*transportName),
		Target:       strings.TrimSpace(*target),
		AssumeYes:    *yes,
		SkipFlash:    *skipFlash,
		FirmwareEnv:  strings.TrimSpace(*firmwareEnv),
		Theme:        strings.TrimSpace(*theme),
		ValidateOnly: *validateOnly,
		DryRun:       *dryRun,
	})
}

func runService(args []string) error {
	if len(args) == 0 {
		return errors.New("missing service subcommand: expected start, stop, status, install, or uninstall")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home directory: %w", err)
	}
	// The Windows shell installs its runtime under its own label and has no
	// environment to hand over; --label names the task for every subcommand.
	if len(args) >= 3 && args[1] == "--label" {
		if err := os.Setenv(runtimepaths.DisplayStreamLaunchAgentLabelEnv, strings.TrimSpace(args[2])); err != nil {
			return err
		}
		args = append(args[:1], args[3:]...)
	}

	subcommand := strings.TrimSpace(strings.ToLower(args[0]))
	// Every subcommand that replaces or stops the running Windows task can
	// cut off a firmware update or theme install living inside it. The same
	// hold the shell claims before a repair (main.rs claim_update_hold) is
	// claimed here, centrally, so the installer hooks and a customer typing
	// "service start" by hand are guarded alike.
	if runtime.GOOS == "windows" {
		switch subcommand {
		case "install", "uninstall", "start", "stop":
			if err := claimRuntimeUpdateHold(home, runtimepaths.DisplayStreamLaunchAgentLabel()); err != nil {
				return err
			}
		}
	}
	switch subcommand {
	case "install":
		if runtime.GOOS != "windows" {
			return errors.New("service install is only supported on Windows; run setup instead")
		}
		executable, err := os.Executable()
		if err != nil {
			return err
		}
		if _, err := parseDaemonCommandOptions(args[1:]); err != nil {
			return err
		}
		label := runtimepaths.DisplayStreamLaunchAgentLabel()
		if _, err := service.WriteTaskConfig(home, label, service.TaskConfig{Executable: executable, Arguments: append([]string{"daemon"}, args[1:]...)}); err != nil {
			return err
		}
		if err := migrateLegacyWindowsTask(home, label); err != nil {
			return err
		}
		if err := restartLaunchAgent(home); err != nil {
			return err
		}
		fmt.Println("background service: installed and started")
		return nil
	case "uninstall":
		label := runtimepaths.DisplayStreamLaunchAgentLabel()
		if err := service.New(label, home, label != runtimepaths.LegacyDisplayStreamLaunchAgentLabel).Uninstall(context.Background()); err != nil {
			return err
		}
		if runtime.GOOS == "windows" {
			if err := os.Remove(service.TaskConfigPath(home, label)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
		fmt.Println("background service: uninstalled")
		return nil
	case "start":
		if err := startLaunchAgent(home); err != nil {
			return err
		}
		fmt.Println("background service: enabled and started")
		return nil
	case "stop":
		if err := stopLaunchAgent(true); err != nil {
			return err
		}
		fmt.Println("background service: stopped and disabled")
		return nil
	case "status":
		label := shellRuntimeLabel()
		status, err := queryLaunchAgentStatus(label)
		if err != nil {
			return err
		}
		fmt.Println("codexbar-display service")
		fmt.Printf("label: %s\n", label)
		if status.Enabled {
			fmt.Println("enabled: yes")
		} else {
			fmt.Println("enabled: no")
		}
		fmt.Printf("state: %s\n", status.State)
		if status.PID != "" {
			fmt.Printf("pid: %s\n", status.PID)
		}
		if runtime.GOOS == "windows" {
			fmt.Printf("task configuration: %s\n", service.TaskConfigPath(home, label))
		} else if label == runtimepaths.LegacyDisplayStreamLaunchAgentLabel {
			fmt.Printf("plist: %s\n", filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel))
		}
		return nil
	default:
		return fmt.Errorf("unknown service subcommand %q: expected start, stop, status, install, or uninstall", args[0])
	}
}

// legacyWindowsTaskManagerFn is replaced in tests.
var legacyWindowsTaskManagerFn = func(home string) service.Manager {
	return service.New(runtimepaths.LegacyDisplayStreamLaunchAgentLabel, home, false)
}

// migrateLegacyWindowsTask retires the task an earlier "codexbar-display
// setup" registered under the legacy label before the shell runtime takes
// over. Both daemons share the writer lock and API port, so the legacy task
// would otherwise keep running and the shell's health check would reject its
// owner forever. Mirrors the Mac App's legacy LaunchAgent migration.
func migrateLegacyWindowsTask(home, label string) error {
	if runtime.GOOS != "windows" || label == runtimepaths.LegacyDisplayStreamLaunchAgentLabel {
		return nil
	}
	legacyConfig := service.TaskConfigPath(home, runtimepaths.LegacyDisplayStreamLaunchAgentLabel)
	if _, err := os.Stat(legacyConfig); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	// The central claim in runService asks only the new label; the task
	// retired here runs under the legacy label and may be mid firmware
	// update, so its own hold is claimed before it is uninstalled.
	if err := claimRuntimeUpdateHold(home, runtimepaths.LegacyDisplayStreamLaunchAgentLabel); err != nil {
		return err
	}
	if err := legacyWindowsTaskManagerFn(home).Uninstall(context.Background()); err != nil {
		return fmt.Errorf("retire legacy background task: %w", err)
	}
	if err := os.Remove(legacyConfig); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	fmt.Println("background service: retired legacy task " + runtimepaths.LegacyDisplayStreamLaunchAgentLabel)
	return nil
}
