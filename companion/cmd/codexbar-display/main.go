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
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/theme"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themepack"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

const defaultThemeCatalogURL = "https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs.json"

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
	case "service":
		err = runService(os.Args[2:])
	case "version":
		err = runVersion(os.Args[2:])
	case "upgrade":
		err = runUpgrade(os.Args[2:])
	case "install-update":
		err = runInstallUpdate(os.Args[2:])
	case "rollback":
		err = runRollback(os.Args[2:])
	case "restore-known-good":
		err = runRestoreKnownGood(os.Args[2:])
	case "theme-validate":
		err = runThemeValidate(os.Args[2:])
	case "theme-apply":
		err = runThemeApply(os.Args[2:])
	case "theme-pack":
		err = runThemePack(os.Args[2:])
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
	fmt.Println("codexbar-display commands:")
	fmt.Println("  codexbar-display daemon [--transport wifi|usb] [--target http://vibetv.local] [--port /dev/cu.usbserial-10] [--interval 2s] [--once] [--theme classic|crt|mini]")
	fmt.Println("  codexbar-display doctor")
	fmt.Println("  codexbar-display health")
	fmt.Println("  codexbar-display service <start|stop|status>")
	fmt.Println("  codexbar-display version [--short] [--json]")
	fmt.Println("  codexbar-display upgrade [--port /dev/cu.usbserial-10] [--firmware-env env] [--target-firmware-version x.y.z] [--repo owner/name] [--skip-version-guard]")
	fmt.Println("  codexbar-display install-update [--target http://vibetv.local] [--manifest-url url] [--confirm-live-update] [--force]")
	fmt.Println("  codexbar-display rollback [--port /dev/cu.usbserial-10] [--skip-companion] [--skip-firmware] [--image path/to/backup.bin] [--manifest path/to/backup.manifest] [--backup-dir <dir>] [--script-path <path>] [--skip-verify]")
	fmt.Println("  codexbar-display restore-known-good [--port /dev/cu.usbserial-10] [--image path/to/backup.bin] [--backup-dir <dir>] [--script-path <path>] [--manifest <path>] [--skip-verify]")
	fmt.Println("  codexbar-display theme-validate --spec path/to/theme-spec.json [--transport wifi|usb] [--target http://vibetv.local] [--port /dev/cu.usbserial-10] [--allow-unknown-capabilities]")
	fmt.Println("  codexbar-display theme-apply --spec path/to/theme-spec.json [--transport wifi|usb] [--target http://vibetv.local] [--port /dev/cu.usbserial-10] [--allow-unknown-capabilities]")
	fmt.Println("  codexbar-display theme-pack catalog [--catalog https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs.json]")
	fmt.Println("  codexbar-display theme-pack validate --pack path/to/theme-pack-dir-or.zip-or-url")
	fmt.Println("  codexbar-display theme-pack install (--pack path/to/theme-pack-dir-or.zip-or-url | --catalog url --theme theme-id) [--target http://vibetv.local] [--allow-unknown-capabilities]")
	fmt.Println("  codexbar-display setup [--transport wifi|usb] [--target http://vibetv.local] [--port /dev/cu.usbserial-10] [--yes] [--skip-flash] [--pin-port] [--firmware-env env] [--theme classic|crt|mini|none] [--validate-only] [--dry-run]")
}

func runDaemon(args []string) error {
	opts, err := parseDaemonOptions(args)
	if err != nil {
		return err
	}
	return daemon.Run(context.Background(), opts)
}

func parseDaemonOptions(args []string) (daemon.Options, error) {
	fs := flag.NewFlagSet("daemon", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://vibetv.local")
	interval := fs.Duration("interval", 60*time.Second, "poll interval")
	once := fs.Bool("once", false, "run one cycle and exit")
	theme := fs.String("theme", "", "optional runtime theme override: classic|crt|mini")
	if err := fs.Parse(args); err != nil {
		return daemon.Options{}, err
	}

	normalizedTransport := strings.TrimSpace(strings.ToLower(*transportName))
	if normalizedTransport == "" {
		normalizedTransport = setup.DefaultTransport()
	}
	if normalizedTransport != "usb" && normalizedTransport != "wifi" {
		return daemon.Options{}, fmt.Errorf("unsupported transport %q", *transportName)
	}

	return daemon.Options{
		Port:      strings.TrimSpace(*port),
		Transport: normalizedTransport,
		Target:    strings.TrimSpace(*target),
		Interval:  *interval,
		Once:      *once,
		Theme:     strings.TrimSpace(*theme),
	}, nil
}

func runDoctor() error {
	var doctorErrs []error

	bin, err := codexbar.FindBinary()
	if err != nil {
		fmt.Printf("CodexBar CLI: not found (%v)\n", err)
		doctorErrs = append(doctorErrs, errors.New("CodexBar CLI not found"))
	} else {
		fmt.Printf("CodexBar CLI: %s\n", bin)
		versionCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		version, versionErr := codexbar.InstalledVersion(versionCtx, bin)
		if versionErr != nil {
			fmt.Printf("CodexBar version: failed (%v)\n", versionErr)
			doctorErrs = append(doctorErrs, fmt.Errorf("CodexBar version check failed: %w", versionErr))
		} else if versionCheckErr := codexbar.CheckMinimumVersion(versionCtx, bin); versionCheckErr != nil {
			fmt.Printf("CodexBar version: %s (too old, need >= %s)\n", version, codexbar.MinimumSupportedVersion())
			doctorErrs = append(doctorErrs, versionCheckErr)
		} else {
			fmt.Printf("CodexBar version: %s (ok, need >= %s)\n", version, codexbar.MinimumSupportedVersion())
		}
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

	if runtimeErr := runDoctorRuntimeChecks(ports); runtimeErr != nil {
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

func runDoctorRuntimeChecks(ports []string) error {
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
		if errcode.Of(err) == errcode.TransportSerialCloseTimeout {
			fmt.Printf("  serial probe: warning (%v)\n", err)
		} else {
			fmt.Printf("  serial probe: failed (%v)\n", err)
			return fmt.Errorf("runtime serial probe failed: %w", err)
		}
	} else {
		fmt.Printf("  serial probe: ok (%s)\n", port)
	}

	pinnedPort, err := doctorPinnedLaunchAgentPort()
	if err != nil {
		fmt.Printf("  launchagent port affinity: failed (%v)\n", err)
		return fmt.Errorf("runtime launchagent affinity check failed: %w", err)
	}
	if pinnedPort == "" {
		fmt.Println("  launchagent port affinity: auto-detect")
		if len(ports) > 1 {
			return fmt.Errorf(
				"runtime port affinity check failed: %d serial ports detected while LaunchAgent is unpinned; rerun setup with --pin-port",
				len(ports),
			)
		}
	} else {
		fmt.Printf("  launchagent port affinity: pinned (%s)\n", pinnedPort)
		if len(ports) > 0 && !containsPort(ports, pinnedPort) {
			return fmt.Errorf(
				"runtime port affinity check failed: pinned LaunchAgent port %q is not currently available",
				pinnedPort,
			)
		}
	}

	hello, err := usb.ReadDeviceHello(port)
	if err != nil {
		fmt.Printf("  device hello: warning (%v)\n", err)
		fmt.Println("  warning: capability handshake unavailable; runtime will use optimistic theme send fallback")
		return nil
	}

	caps := protocol.CapabilitiesFromHello(hello)
	fmt.Printf("  device hello: ok board=%s protocol=%d negotiated=%d firmware=%s theme=%t themeSpecV1=%t maxFrameBytes=%d\n",
		caps.Board,
		caps.ProtocolVersion,
		caps.NegotiatedProtocolVersion,
		hello.Firmware,
		caps.SupportsTheme,
		caps.SupportsThemeSpecV1,
		caps.MaxFrameBytes)
	if len(caps.SupportedProtocolVersions) > 0 {
		fmt.Printf("  device hello protocols: %v (preferred=%d)\n", caps.SupportedProtocolVersions, caps.PreferredProtocolVersion)
	}
	if !caps.Known {
		fmt.Println("  warning: device capabilities are unknown; skipping strict hardware/theme contract checks")
		return nil
	}

	switch caps.Board {
	case "esp8266-smalltv-st7789":
		if caps.Known && !caps.SupportsTheme {
			return fmt.Errorf("runtime capability check failed: board %q does not advertise theme support", caps.Board)
		}
	case "esp32-lilygo-t-display-s3":
		fmt.Println("  warning: esp32 fallback board detected (non-blocking)")
	default:
		return fmt.Errorf("runtime hardware contract failed: unsupported board %q", caps.Board)
	}

	if !protocol.IsSupportedProtocolVersion(caps.NegotiatedProtocolVersion) {
		return fmt.Errorf(
			"runtime protocol contract failed: negotiated protocol version %d unsupported by companion",
			caps.NegotiatedProtocolVersion,
		)
	}

	return nil
}

func runSetup(args []string) error {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport for LaunchAgent: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://vibetv.local")
	yes := fs.Bool("yes", false, "auto-select defaults without prompts")
	skipFlash := fs.Bool("skip-flash", false, "skip firmware flashing")
	pinPort := fs.Bool("pin-port", false, "pin daemon to selected --port in LaunchAgent (default: auto-detect)")
	firmwareEnv := fs.String("firmware-env", setup.DefaultFirmwareEnvironment(), "PlatformIO environment to flash (examples: esp8266_smalltv_st7789, lilygo_t_display_s3)")
	theme := fs.String("theme", "", "optional runtime theme override: classic|crt|mini|none (empty keeps existing setting, defaults new installs to mini)")
	validateOnly := fs.Bool("validate-only", false, "validate setup prerequisites only; do not change system state")
	dryRun := fs.Bool("dry-run", false, "show setup actions without applying changes")
	if err := fs.Parse(args); err != nil {
		return err
	}

	return setup.Run(context.Background(), setup.Options{
		Port:          strings.TrimSpace(*port),
		Transport:     strings.TrimSpace(*transportName),
		Target:        strings.TrimSpace(*target),
		AssumeYes:     *yes,
		SkipFlash:     *skipFlash,
		PinDaemonPort: *pinPort,
		FirmwareEnv:   strings.TrimSpace(*firmwareEnv),
		Theme:         strings.TrimSpace(*theme),
		ValidateOnly:  *validateOnly,
		DryRun:        *dryRun,
	})
}

func runService(args []string) error {
	if len(args) == 0 {
		return errors.New("missing service subcommand: expected start, stop, or status")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home directory: %w", err)
	}

	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "start":
		if err := startLaunchAgent(home); err != nil {
			return err
		}
		fmt.Println("launchagent: enabled and started")
		return nil
	case "stop":
		if err := stopLaunchAgent(true); err != nil {
			return err
		}
		fmt.Println("launchagent: stopped and disabled")
		return nil
	case "status":
		status, err := queryLaunchAgentStatus()
		if err != nil {
			return err
		}
		fmt.Println("codexbar-display service")
		if status.Enabled {
			fmt.Println("enabled: yes")
		} else {
			fmt.Println("enabled: no")
		}
		fmt.Printf("state: %s\n", status.State)
		if status.PID != "" {
			fmt.Printf("pid: %s\n", status.PID)
		}
		fmt.Printf("plist: %s\n", filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel))
		return nil
	default:
		return fmt.Errorf("unknown service subcommand %q: expected start, stop, or status", args[0])
	}
}

func runThemeValidate(args []string) error {
	fs := flag.NewFlagSet("theme-validate", flag.ContinueOnError)
	specPath := fs.String("spec", "", "path to ThemeSpec v1 JSON")
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://vibetv.local")
	allowUnknown := fs.Bool(
		"allow-unknown-capabilities",
		false,
		"allow local fallback profile when device capabilities are unavailable",
	)
	if err := fs.Parse(args); err != nil {
		return err
	}

	selectedTransport, requestedTarget, err := resolveThemeSpecTransport(
		resolveThemeSpecTransportName(*transportName, strings.TrimSpace(*port), flagWasSet(fs, "transport")),
		strings.TrimSpace(*target),
		strings.TrimSpace(*port),
	)
	if err != nil {
		return err
	}

	_, _, resolvedTarget, caps, err := loadAndValidateThemeSpec(
		strings.TrimSpace(*specPath),
		selectedTransport,
		requestedTarget,
		*allowUnknown,
	)
	if err != nil {
		return err
	}

	fmt.Printf(
		"theme-spec valid: transport=%s protocol=%d board=%s target=%s maxBytes=%d maxPrimitives=%d\n",
		selectedTransport.Name(),
		caps.NegotiatedProtocolVersion,
		caps.Board,
		resolvedTarget,
		caps.MaxThemeSpecBytes,
		caps.MaxThemePrimitives,
	)
	return nil
}

func runThemeApply(args []string) error {
	fs := flag.NewFlagSet("theme-apply", flag.ContinueOnError)
	specPath := fs.String("spec", "", "path to ThemeSpec v1 JSON")
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://vibetv.local")
	allowUnknown := fs.Bool(
		"allow-unknown-capabilities",
		false,
		"allow local fallback profile when device capabilities are unavailable",
	)
	if err := fs.Parse(args); err != nil {
		return err
	}

	selectedTransport, requestedTarget, err := resolveThemeSpecTransport(
		resolveThemeSpecTransportName(*transportName, strings.TrimSpace(*port), flagWasSet(fs, "transport")),
		strings.TrimSpace(*target),
		strings.TrimSpace(*port),
	)
	if err != nil {
		return err
	}

	spec, raw, resolvedTarget, caps, err := loadAndValidateThemeSpec(
		strings.TrimSpace(*specPath),
		selectedTransport,
		requestedTarget,
		*allowUnknown,
	)
	if err != nil {
		return err
	}

	frame := protocol.Frame{
		V:         protocol.NormalizeProtocolVersion(caps.NegotiatedProtocolVersion),
		ThemeSpec: raw,
	}
	if spec.FallbackTheme != "" {
		frame.Theme = spec.FallbackTheme
	}
	line, err := frame.MarshalLine()
	if err != nil {
		return &commandError{
			Op:   "theme-apply/marshal-frame",
			Code: errcode.ProtocolFrameEncode,
			Err:  err,
		}
	}
	if caps.MaxFrameBytes > 0 && len(line) > caps.MaxFrameBytes {
		return &commandError{
			Op:   "theme-apply/frame-size",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err: fmt.Errorf(
				"encoded frame exceeds maxFrameBytes: frame=%d limit=%d",
				len(line),
				caps.MaxFrameBytes,
			),
		}
	}
	if err := selectedTransport.SendLine(resolvedTarget, line); err != nil {
		return err
	}

	fmt.Printf(
		"theme-spec applied: id=%s rev=%d transport=%s protocol=%d board=%s target=%s\n",
		spec.ThemeID,
		spec.ThemeRev,
		selectedTransport.Name(),
		frame.V,
		caps.Board,
		resolvedTarget,
	)
	return nil
}

func runThemePack(args []string) error {
	if len(args) == 0 {
		return errors.New("theme-pack subcommand required: validate or install")
	}
	switch args[0] {
	case "catalog":
		return runThemePackCatalog(args[1:])
	case "validate":
		return runThemePackValidate(args[1:])
	case "install":
		return runThemePackInstall(args[1:])
	default:
		return fmt.Errorf("unknown theme-pack subcommand %q: expected catalog, validate, or install", args[0])
	}
}

func runThemePackCatalog(args []string) error {
	fs := flag.NewFlagSet("theme-pack catalog", flag.ContinueOnError)
	catalogRef := fs.String("catalog", defaultThemeCatalogURL, "path or HTTP(S) URL to VibeTV theme catalog JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	catalog, err := themepack.LoadCatalog(strings.TrimSpace(*catalogRef))
	if err != nil {
		return err
	}
	fmt.Printf("theme catalog: themes=%d source=%s\n", len(catalog.Themes), strings.TrimSpace(*catalogRef))
	for _, theme := range catalog.Themes {
		title := strings.TrimSpace(theme.Title)
		if title == "" {
			title = theme.ID
		}
		fmt.Printf("- %s: %s", theme.ID, title)
		if theme.ThemeRev > 0 {
			fmt.Printf(" rev=%d", theme.ThemeRev)
		}
		if theme.Bytes > 0 {
			fmt.Printf(" bytes=%d", theme.Bytes)
		}
		fmt.Println()
		if description := strings.TrimSpace(theme.Description); description != "" {
			fmt.Printf("  %s\n", description)
		}
	}
	return nil
}

func runThemePackValidate(args []string) error {
	fs := flag.NewFlagSet("theme-pack validate", flag.ContinueOnError)
	packPath := fs.String("pack", "", "path or HTTP(S) URL to VibeTV theme pack directory or zip")
	if err := fs.Parse(args); err != nil {
		return err
	}
	pack, err := themepack.Load(strings.TrimSpace(*packPath))
	if err != nil {
		return err
	}
	fmt.Printf(
		"theme-pack valid: id=%s name=%q themeId=%s rev=%d assets=%d themeSpecBytes=%d\n",
		pack.Manifest.ID,
		pack.Manifest.Name,
		pack.ThemeSpec.ThemeID,
		pack.ThemeSpec.ThemeRev,
		len(pack.Assets),
		len(pack.ThemeSpecRaw),
	)
	return nil
}

func runThemePackInstall(args []string) error {
	fs := flag.NewFlagSet("theme-pack install", flag.ContinueOnError)
	packPath := fs.String("pack", "", "path or HTTP(S) URL to VibeTV theme pack directory or zip")
	catalogRef := fs.String("catalog", "", "path or HTTP(S) URL to VibeTV theme catalog JSON")
	themeID := fs.String("theme", "", "theme id from catalog")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://vibetv.local")
	allowUnknown := fs.Bool(
		"allow-unknown-capabilities",
		false,
		"allow local fallback profile when device capabilities are unavailable",
	)
	if err := fs.Parse(args); err != nil {
		return err
	}
	resolvedPack, err := resolveThemePackInstallSource(strings.TrimSpace(*packPath), strings.TrimSpace(*catalogRef), strings.TrimSpace(*themeID))
	if err != nil {
		return err
	}
	pack, err := themepack.Load(resolvedPack)
	if err != nil {
		return err
	}

	wifi := transportlayer.NewWiFiTransportWithClient(nil)
	resolvedTarget, err := wifi.ResolvePort(strings.TrimSpace(*target))
	if err != nil {
		return err
	}
	caps, err := wifi.DeviceCapabilities(resolvedTarget)
	if err != nil {
		if !*allowUnknown {
			return err
		}
		caps = fallbackThemeSpecCapabilities()
		caps.ActiveTransport = "wifi"
		fmt.Printf("warning: device hello unavailable; using local fallback capabilities for validation on %s\n", resolvedTarget)
	}
	if *allowUnknown && !caps.Known {
		caps = fallbackThemeSpecCapabilities()
		caps.ActiveTransport = "wifi"
		fmt.Printf("warning: capabilities unknown; using local fallback profile on %s\n", resolvedTarget)
	}
	if !*allowUnknown && !caps.Known {
		return &commandError{
			Op:   "theme-pack/capabilities",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err:  errors.New("device capabilities unavailable; connect device and retry"),
		}
	}
	if err := themespec.ValidateAgainstCapabilities(pack.ThemeSpec, pack.ThemeSpecRaw, caps); err != nil {
		return &commandError{
			Op:   "theme-pack/capabilities",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err:  err,
		}
	}

	for _, asset := range pack.Assets {
		if err := wifi.UploadAsset(resolvedTarget, asset.Entry.Path, filepath.Base(asset.Entry.File), asset.Data); err != nil {
			return err
		}
		fmt.Printf("uploaded asset: %s bytes=%d\n", asset.Entry.Path, len(asset.Data))
	}
	if err := wifi.UploadAsset(resolvedTarget, pack.ThemeSpecFile.Entry.Path, filepath.Base(pack.ThemeSpecFile.Entry.File), pack.ThemeSpecRaw); err != nil {
		return err
	}
	fmt.Printf("uploaded theme spec: %s bytes=%d\n", pack.ThemeSpecFile.Entry.Path, len(pack.ThemeSpecRaw))

	if err := wifi.ActivateStoredTheme(resolvedTarget, pack.ThemeSpecFile.Entry.Path); err != nil {
		return err
	}

	frame := protocol.Frame{
		V:         protocol.NormalizeProtocolVersion(caps.NegotiatedProtocolVersion),
		Provider:  "vibetv",
		Label:     "VibeTV",
		Session:   50,
		Weekly:    50,
		ResetSec:  3600,
		UsageMode: "remaining",
		Time:      time.Now().Format("15:04"),
		Date:      time.Now().Format("02.01.2006"),
	}
	line, err := frame.MarshalLine()
	if err != nil {
		return err
	}
	if err := wifi.SendLine(resolvedTarget, line); err != nil {
		return err
	}

	fmt.Printf(
		"theme-pack installed: id=%s themeId=%s rev=%d target=%s activePath=%s\n",
		pack.Manifest.ID,
		pack.ThemeSpec.ThemeID,
		pack.ThemeSpec.ThemeRev,
		resolvedTarget,
		pack.ThemeSpecFile.Entry.Path,
	)
	return nil
}

func resolveThemePackInstallSource(packPath, catalogRef, themeID string) (string, error) {
	if packPath != "" {
		if catalogRef != "" || themeID != "" {
			return "", errors.New("use either --pack or --catalog/--theme, not both")
		}
		return packPath, nil
	}
	if catalogRef == "" && themeID == "" {
		return "", errors.New("missing theme pack source: pass --pack or --catalog and --theme")
	}
	if catalogRef == "" {
		catalogRef = defaultThemeCatalogURL
	}
	catalog, err := themepack.LoadCatalog(catalogRef)
	if err != nil {
		return "", err
	}
	theme, err := catalog.FindTheme(themeID)
	if err != nil {
		return "", err
	}
	return themepack.ResolveThemeDownload(catalogRef, theme)
}

func resolveThemeSpecTransport(transportName, target, port string) (transportlayer.DeviceTransport, string, error) {
	normalizedTransport := strings.TrimSpace(strings.ToLower(transportName))
	if normalizedTransport == "" {
		normalizedTransport = setup.DefaultTransport()
	}
	switch normalizedTransport {
	case "wifi":
		return transportlayer.NewWiFiTransport(), strings.TrimSpace(target), nil
	case "usb":
		return transportlayer.NewUSBTransport(), strings.TrimSpace(port), nil
	default:
		return nil, "", fmt.Errorf("unsupported transport %q", transportName)
	}
}

func resolveThemeSpecTransportName(transportName, port string, transportExplicit bool) string {
	if !transportExplicit && strings.TrimSpace(port) != "" {
		return "usb"
	}
	return strings.TrimSpace(transportName)
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

func loadAndValidateThemeSpec(
	specPath string,
	deviceTransport transportlayer.DeviceTransport,
	requestedTarget string,
	allowUnknown bool,
) (themespec.Spec, []byte, string, protocol.DeviceCapabilities, error) {
	if strings.TrimSpace(specPath) == "" {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/load",
			Code: errcode.ProtocolThemeSpecInvalid,
			Err:  errors.New("missing required --spec path"),
		}
	}
	if deviceTransport == nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, errors.New("device transport is required")
	}

	spec, raw, err := themespec.Load(specPath)
	if err != nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/load",
			Code: errcode.ProtocolThemeSpecInvalid,
			Err:  err,
		}
	}
	if err := themespec.Validate(spec); err != nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/validate",
			Code: errcode.ProtocolThemeSpecInvalid,
			Err:  err,
		}
	}

	resolvedTarget, err := deviceTransport.ResolvePort(requestedTarget)
	if err != nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, err
	}
	caps, err := deviceTransport.DeviceCapabilities(resolvedTarget)
	if err != nil {
		if allowUnknown && errcode.Of(err) == errcode.ProtocolDeviceHelloUnavailable {
			caps = fallbackThemeSpecCapabilities()
			caps.ActiveTransport = deviceTransport.Name()
			fmt.Printf("warning: device hello unavailable; using local fallback capabilities for validation on %s\n", resolvedTarget)
		} else {
			return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, err
		}
	}
	if allowUnknown && !caps.Known {
		caps = fallbackThemeSpecCapabilities()
		caps.ActiveTransport = deviceTransport.Name()
		fmt.Printf("warning: capabilities unknown; using local fallback profile on %s\n", resolvedTarget)
	}
	if !allowUnknown && !caps.Known {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/capabilities",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err:  errors.New("device capabilities unavailable; connect device and retry"),
		}
	}
	if err := themespec.ValidateAgainstCapabilities(spec, raw, caps); err != nil {
		return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, &commandError{
			Op:   "theme-spec/capabilities",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err:  err,
		}
	}

	return spec, raw, resolvedTarget, caps, nil
}

func fallbackThemeSpecCapabilities() protocol.DeviceCapabilities {
	return protocol.DeviceCapabilities{
		Known:                     true,
		ProtocolVersion:           protocol.ProtocolVersionV2,
		SupportedProtocolVersions: []int{protocol.ProtocolVersionV2, protocol.ProtocolVersionV1},
		PreferredProtocolVersion:  protocol.ProtocolVersionV2,
		NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
		Board:                     "assumed-usb-profile",
		SupportsTheme:             true,
		SupportsThemeSpecV1:       true,
		MaxFrameBytes:             1024,
		MaxThemeSpecBytes:         1024,
		MaxThemePrimitives:        32,
		BuiltinThemes:             theme.Names(),
		ActiveTransport:           "usb",
	}
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
	return filepath.Join(home, "Library", "Application Support", "codexbar-display"), nil
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

func containsPort(ports []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, port := range ports {
		if strings.TrimSpace(port) == target {
			return true
		}
	}
	return false
}

func doctorPinnedLaunchAgentPort() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	plistPath := filepath.Join(home, "Library", "LaunchAgents", "com.codexbar-display.daemon.plist")
	data, err := os.ReadFile(plistPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	return parsePinnedPortFromLaunchAgentPlist(string(data)), nil
}

func parsePinnedPortFromLaunchAgentPlist(plist string) string {
	const marker = "<string>--port</string>"
	idx := strings.Index(plist, marker)
	if idx < 0 {
		return ""
	}
	rest := plist[idx+len(marker):]
	start := strings.Index(rest, "<string>")
	if start < 0 {
		return ""
	}
	rest = rest[start+len("<string>"):]
	end := strings.Index(rest, "</string>")
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(rest[:end])
}
