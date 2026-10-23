package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themepack"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
)

const defaultThemeCatalogURL = themeinstall.DefaultCatalogURL

var themePackUploadSettleDelay = 750 * time.Millisecond

var themePackInstallFetchLiveFrameFn = codexbar.FetchFirstFrame

var themePackValidateLoadFn = themepack.LoadVerified

func runThemeValidate(args []string) error {
	fs := flag.NewFlagSet("theme-validate", flag.ContinueOnError)
	specPath := fs.String("spec", "", "path to ThemeSpec v1 JSON")
	port := fs.String("port", "", "optional serial candidate path (identity-resolved when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://192.168.1.42")
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
	port := fs.String("port", "", "optional serial candidate path (identity-resolved when empty)")
	transportName := fs.String("transport", setup.DefaultTransport(), "device transport: wifi|usb")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://192.168.1.42")
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
	if selectedTransport.Name() == "wifi" {
		requestedTarget = resolveThemeSpecWiFiTarget(requestedTarget, flagWasSet(fs, "target"))
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
		publicDeviceTargetForConfig(resolvedTarget),
	)
	return nil
}

func runThemePack(args []string) error {
	if len(args) == 0 {
		return errors.New("theme-pack subcommand required: catalog, validate or install")
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
		if usage := strings.TrimSpace(theme.Usage); usage != "" {
			fmt.Printf(" usage=%s", usage)
		}
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
	packSHA256 := fs.String("pack-sha256", "", "expected SHA-256 for a remote theme pack")
	packSizeBytes := fs.Int64("pack-size-bytes", 0, "expected byte size for a remote theme pack")
	if err := fs.Parse(args); err != nil {
		return err
	}
	pack, err := themePackValidateLoadFn(
		strings.TrimSpace(*packPath),
		strings.TrimSpace(*packSHA256),
		*packSizeBytes,
	)
	if err != nil {
		return err
	}
	fmt.Printf(
		"theme-pack valid: id=%s name=%q usage=%s themeId=%s rev=%d assets=%d themeSpecBytes=%d\n",
		pack.Manifest.ID,
		pack.Manifest.Name,
		pack.Manifest.PackUsage(),
		pack.ThemeSpec.ThemeID,
		pack.ThemeSpec.ThemeRev,
		len(pack.Assets),
		len(pack.ThemeSpecRaw),
	)
	return nil
}

func runThemePackInstall(args []string) error {
	fs := flag.NewFlagSet("theme-pack install", flag.ContinueOnError)
	slot := fs.String("slot", themepack.UsageLive, "device slot to install into: live or screensaver")
	packPath := fs.String("pack", "", "path or HTTP(S) URL to VibeTV theme pack directory or zip")
	packSHA256 := fs.String("pack-sha256", "", "expected SHA-256 for a remote theme pack")
	packSizeBytes := fs.Int64("pack-size-bytes", 0, "expected byte size for a remote theme pack")
	catalogRef := fs.String("catalog", "", "path or HTTP(S) URL to VibeTV theme catalog JSON")
	themeID := fs.String("theme", "", "theme id from catalog")
	target := fs.String("target", setup.DefaultWiFiTarget(), "WiFi target base URL, for example http://192.168.1.42")
	firmwareManifestURL := fs.String("firmware-manifest-url", themeinstall.DefaultFirmwareManifestURL, "firmware manifest URL checked before installing the theme pack")
	skipFirmwareUpdate := fs.Bool("skip-firmware-update", false, "skip the firmware update preflight before installing the theme pack")
	verbose := fs.Bool("verbose", false, "show detailed theme install paths and byte counts")
	allowUnknown := fs.Bool(
		"allow-unknown-capabilities",
		false,
		"allow local fallback profile when device capabilities are unavailable",
	)
	if err := fs.Parse(args); err != nil {
		return err
	}
	installSlot := strings.TrimSpace(*slot)
	if installSlot != themepack.UsageLive && installSlot != themepack.UsageScreensaver {
		return fmt.Errorf("unknown slot %q (expected %q or %q)", installSlot, themepack.UsageLive, themepack.UsageScreensaver)
	}
	installTarget := resolveThemePackInstallTarget(fs, strings.TrimSpace(*target))
	_, err := themeinstall.Install(context.Background(), themeinstall.Options{
		Slot:                installSlot,
		PackURL:             strings.TrimSpace(*packPath),
		PackSHA256:          strings.TrimSpace(*packSHA256),
		PackSizeBytes:       *packSizeBytes,
		CatalogURL:          strings.TrimSpace(*catalogRef),
		ThemeID:             strings.TrimSpace(*themeID),
		Target:              installTarget,
		FirmwareManifestURL: strings.TrimSpace(*firmwareManifestURL),
		SkipFirmwareUpdate:  *skipFirmwareUpdate,
		AllowUnknown:        *allowUnknown,
		Verbose:             *verbose,
		Out:                 os.Stdout,
		UploadSettleDelay:   themePackUploadSettleDelay,
		PairTokenStore:      saveThemeInstallPairingToken,
		FetchLiveFrame:      themePackInstallFetchLiveFrameFn,
		FirmwareUpdater: func(ctx context.Context, target, manifestURL string) error {
			return themePackInstallFirmwareUpdateFn(target, manifestURL)
		},
	})
	return err
}

func resolveThemePackInstallTarget(fs *flag.FlagSet, requested string) string {
	cfg, ok := loadRuntimeConfigForCommand()
	if ok && !flagWasSet(fs, "target") && strings.TrimSpace(cfg.DeviceTarget) != "" {
		requested = strings.TrimSpace(cfg.DeviceTarget)
	}
	if ok && strings.TrimSpace(cfg.DeviceToken) != "" {
		return targetWithQueryToken(requested, cfg.DeviceToken)
	}
	return requested
}

func saveThemeInstallPairingToken(target, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		return err
	}
	if publicTarget := publicDeviceTargetForConfig(target); publicTarget != "" {
		cfg.DeviceTarget = publicTarget
	}
	cfg.DeviceToken = token
	return runtimeconfig.Save(home, cfg)
}

func resolveThemeSpecWiFiTarget(requested string, targetExplicit bool) string {
	requested = strings.TrimSpace(requested)
	cfg, ok := loadRuntimeConfigForCommand()
	if !ok {
		return requested
	}

	if !targetExplicit && strings.TrimSpace(cfg.DeviceTarget) != "" {
		requested = strings.TrimSpace(cfg.DeviceTarget)
	}
	publicRequested := publicDeviceTargetForConfig(requested)
	if publicRequested == "" {
		return requested
	}

	token := ""
	if sameCommandDeviceTarget(publicRequested, cfg.DeviceTarget) {
		token = strings.TrimSpace(cfg.DeviceToken)
	}
	if token == "" {
		for _, known := range cfg.KnownDevices {
			if sameCommandDeviceTarget(publicRequested, known.Target) {
				token = strings.TrimSpace(known.DeviceToken)
				break
			}
		}
	}
	if token == "" {
		return requested
	}
	return targetWithQueryToken(publicRequested, token)
}

var themePackInstallFirmwareUpdateFn = runThemePackInstallFirmwareUpdate

func runThemePackInstallFirmwareUpdate(target, manifestURL string) error {
	args := []string{"--target", target, "--confirm-live-update"}
	if strings.TrimSpace(manifestURL) != "" {
		args = append(args, "--manifest-url", strings.TrimSpace(manifestURL))
	}
	return runInstallUpdate(args)
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
			caps = themeinstall.FallbackThemeSpecCapabilities()
			caps.ActiveTransport = deviceTransport.Name()
			fmt.Printf("warning: device hello unavailable; using local fallback capabilities for validation on %s\n", resolvedTarget)
		} else {
			return themespec.Spec{}, nil, "", protocol.DeviceCapabilities{}, err
		}
	}
	if allowUnknown && !caps.Known {
		caps = themeinstall.FallbackThemeSpecCapabilities()
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
