package themeinstall

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/theme"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themepack"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
)

const (
	DefaultCatalogURL          = "https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs.json"
	DefaultWiFiTimeout         = 60 * time.Second
	DefaultUploadSettleDelay   = 750 * time.Millisecond
	DefaultFirmwareManifestURL = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/firmware-manifest.json"
	uploadVerifyAttempts       = 3
)

var (
	renderHealthAttempts   = 8
	renderHealthDelay      = 500 * time.Millisecond
	activationAttempts     = 3
	activationRetryDelay   = 1500 * time.Millisecond
	uploadVerifyRetryDelay = 1500 * time.Millisecond
)

var installingThemeSpec = json.RawMessage(`{"v":1,"id":"installing","rev":1,"fb":"mini","p":[{"t":"r","x":0,"y":0,"w":240,"h":240,"c":"#111111"},{"t":"tx","x":28,"y":58,"v":"INSTALLING","s":2,"c":"#B6FF00"},{"t":"tx","x":36,"y":94,"v":"NEW THEME","s":2,"c":"#FFFFFF"},{"t":"p","x":34,"y":150,"w":172,"h":18,"b":"s","c":"#B6FF00","bg":"#303030"}]}`)

type FirmwareUpdater func(ctx context.Context, target, manifestURL string) error
type PairTokenStore func(target, token string) error

type Options struct {
	PackURL             string
	PackBytes           []byte
	CatalogURL          string
	ThemeID             string
	Target              string
	FirmwareManifestURL string
	SkipFirmwareUpdate  bool
	AllowUnknown        bool
	Verbose             bool
	Out                 io.Writer
	HTTPClient          *http.Client
	FirmwareUpdater     FirmwareUpdater
	PairTokenStore      PairTokenStore
	UploadSettleDelay   time.Duration
	Now                 func() time.Time
	FetchLiveFrame      func(context.Context) (protocol.Frame, error)
}

type Result struct {
	ThemeID           string `json:"themeId"`
	PackID            string `json:"packId"`
	Name              string `json:"name"`
	Target            string `json:"target"`
	ActivePath        string `json:"activePath"`
	ThemeRevision     int    `json:"themeRev"`
	CapabilitiesKnown bool   `json:"capabilitiesKnown"`
}

type InstallError struct {
	Op   string
	Code errcode.Code
	Err  error
	Hint string
}

func (e *InstallError) Error() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Op) == "" {
		return e.Err.Error()
	}
	return fmt.Sprintf("%s: %v", e.Op, e.Err)
}

func (e *InstallError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *InstallError) ErrorCode() errcode.Code {
	if e == nil {
		return ""
	}
	return e.Code
}

func (e *InstallError) RecoveryAction() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Hint) != "" {
		return strings.TrimSpace(e.Hint)
	}
	return errcode.DefaultRecovery(e.Code)
}

func Install(ctx context.Context, opts Options) (result Result, retErr error) {
	if ctx == nil {
		ctx = context.Background()
	}
	out := opts.Out
	if out == nil {
		out = io.Discard
	}
	resolvedPack := "local upload"
	var pack *themepack.Pack
	var err error
	if opts.PackBytes != nil {
		if strings.TrimSpace(opts.PackURL) != "" || strings.TrimSpace(opts.CatalogURL) != "" {
			return Result{}, errors.New("use either pack bytes or packUrl/catalogUrl")
		}
		pack, err = themepack.LoadZipBytes(opts.PackBytes)
	} else {
		resolvedPack, err = ResolveSource(strings.TrimSpace(opts.PackURL), strings.TrimSpace(opts.CatalogURL), strings.TrimSpace(opts.ThemeID))
		if err == nil {
			pack, err = themepack.Load(resolvedPack)
		}
	}
	if err != nil {
		return Result{}, err
	}
	themeName := strings.TrimSpace(pack.Manifest.Name)
	if themeName == "" {
		themeName = pack.Manifest.ID
	}
	fmt.Fprintf(out, "Preparing theme: %s\n", themeName)
	if opts.Verbose {
		themeSource := resolvedPack
		if opts.PackBytes == nil {
			themeSource = stripTargetCredentials(resolvedPack)
		}
		fmt.Fprintf(out, "Theme source: %s\n", themeSource)
	}

	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: DefaultWiFiTimeout}
	}
	uploadSettleDelay := opts.UploadSettleDelay
	if uploadSettleDelay == 0 {
		uploadSettleDelay = DefaultUploadSettleDelay
	}
	wifi := transportlayer.NewWiFiTransportWithClient(client)
	resolvedTarget, err := wifi.ResolvePort(strings.TrimSpace(opts.Target))
	if err != nil {
		return Result{}, &InstallError{
			Op:   "theme-pack/resolve-target",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: "use --target http://vibetv.local or the IP shown on Vibe TV",
		}
	}
	resolvedTarget = discoverThemeInstallTarget(ctx, client, resolvedTarget, opts.Verbose, out)
	displayTarget := stripTargetCredentials(resolvedTarget)

	if !opts.SkipFirmwareUpdate {
		if opts.FirmwareUpdater != nil {
			manifestURL := strings.TrimSpace(opts.FirmwareManifestURL)
			if manifestURL == "" {
				manifestURL = DefaultFirmwareManifestURL
			}
			if err := opts.FirmwareUpdater(ctx, resolvedTarget, manifestURL); err != nil {
				return Result{}, &InstallError{
					Op:   "theme-pack/check-firmware",
					Code: errcode.UpgradeFlashFirmware,
					Err:  err,
					Hint: "keep VibeTV powered and on the same WiFi, then retry theme install",
				}
			}
		}
	} else if opts.Verbose {
		fmt.Fprintln(out, "Firmware check: skipped")
	}

	fmt.Fprintln(out, "Checking device...")
	caps, err := wifi.DeviceCapabilities(resolvedTarget)
	if err != nil {
		if !opts.AllowUnknown {
			return Result{}, &InstallError{
				Op:   "theme-pack/check-device",
				Code: errcode.UpgradeFlashFirmware,
				Err:  fmt.Errorf("VibeTV is not reachable at %s: %w", displayTarget, err),
				Hint: "check VibeTV power/WiFi or pass --target http://<device-ip>",
			}
		}
		caps = FallbackThemeSpecCapabilities()
		caps.ActiveTransport = "wifi"
		fmt.Fprintln(out, "Checking device: using local fallback profile")
		if opts.Verbose {
			fmt.Fprintf(out, "Device warning: hello unavailable for %s: %v\n", displayTarget, err)
		}
	}
	if opts.AllowUnknown && !caps.Known {
		caps = FallbackThemeSpecCapabilities()
		caps.ActiveTransport = "wifi"
		fmt.Fprintln(out, "Checking device: using local fallback profile")
		if opts.Verbose {
			fmt.Fprintf(out, "Device warning: capabilities unknown on %s\n", displayTarget)
		}
	}
	if !opts.AllowUnknown && !caps.Known {
		return Result{}, &InstallError{
			Op:   "theme-pack/capabilities",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err:  errors.New("device capabilities unavailable; connect device and retry"),
		}
	}
	if opts.Verbose {
		fmt.Fprintf(out, "Device: board=%s protocol=%d target=%s\n", caps.Board, caps.NegotiatedProtocolVersion, displayTarget)
	}
	if err := pack.ValidateAgainstCapabilities(caps); err != nil {
		return Result{}, &InstallError{
			Op:   "theme-pack/capabilities",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err:  err,
		}
	}
	previousThemePath, previousThemePathErr := currentStoredThemePath(wifi, resolvedTarget)
	if previousThemePathErr != nil && opts.Verbose {
		fmt.Fprintf(out, "Restore snapshot: skipped (%v)\n", previousThemePathErr)
	}
	installScreenShown := false
	defer func() {
		if retErr == nil || !installScreenShown {
			return
		}
		restoreThemeInstallScreen(ctx, wifi, &resolvedTarget, caps, previousThemePath, opts.PairTokenStore, opts.FetchLiveFrame, out)
	}()
	if err := sendInstallingThemeFrame(wifi, resolvedTarget, caps); err != nil {
		if authRequired(err) {
			pairedTarget, pairErr := pairThemeInstallTarget(wifi, resolvedTarget, opts.PairTokenStore)
			if pairErr != nil {
				return Result{}, &InstallError{
					Op:   "theme-pack/pair",
					Code: errcode.UpgradeFlashFirmware,
					Err:  pairErr,
					Hint: "keep VibeTV powered and on the same WiFi, then retry theme install",
				}
			}
			resolvedTarget = pairedTarget
			err = sendInstallingThemeFrame(wifi, resolvedTarget, caps)
		}
		if err != nil {
			fmt.Fprintf(out, "Install screen: skipped (%v)\n", err)
		} else {
			installScreenShown = true
			fmt.Fprintln(out, "Install screen: showing on VibeTV")
		}
	} else {
		installScreenShown = true
		fmt.Fprintln(out, "Install screen: showing on VibeTV")
	}

	retryNoted := false
	wifi = wifi.WithAssetUploadRetryObserver(func(retry transportlayer.AssetUploadRetry) {
		if !retryNoted {
			fmt.Fprintln(out, "Upload interrupted, retrying...")
			retryNoted = true
		}
		if opts.Verbose {
			reason := ""
			if retry.Err != nil {
				reason = retry.Err.Error()
			} else if retry.StatusCode > 0 {
				reason = fmt.Sprintf("status=%d", retry.StatusCode)
			}
			fmt.Fprintf(out, "Retrying upload: path=%s attempt=%d/%d %s\n", retry.DevicePath, retry.Attempt+1, retry.MaxAttempts, strings.TrimSpace(reason))
		}
	})

	fmt.Fprintln(out, "Uploading theme files...")
	for _, asset := range pack.Assets {
		if err := uploadAssetAndVerifyWithPairRetry(wifi, &resolvedTarget, asset.Entry.Path, filepath.Base(asset.Entry.File), asset.Data, opts.PairTokenStore, uploadSettleDelay, opts.Verbose, out); err != nil {
			return Result{}, &InstallError{
				Op:   "theme-pack/upload",
				Code: errcode.UpgradeFlashFirmware,
				Err:  uploadError(asset.Entry.Path, err, opts.Verbose),
				Hint: "keep VibeTV powered and on the same WiFi, then retry theme install",
			}
		}
		if opts.Verbose {
			fmt.Fprintf(out, "Uploaded asset: %s bytes=%d\n", asset.Entry.Path, len(asset.Data))
		}
	}
	if err := uploadAssetAndVerifyWithPairRetry(wifi, &resolvedTarget, pack.ThemeSpecFile.Entry.Path, filepath.Base(pack.ThemeSpecFile.Entry.File), pack.ThemeSpecRaw, opts.PairTokenStore, uploadSettleDelay, opts.Verbose, out); err != nil {
		return Result{}, &InstallError{
			Op:   "theme-pack/upload",
			Code: errcode.UpgradeFlashFirmware,
			Err:  uploadError(pack.ThemeSpecFile.Entry.Path, err, opts.Verbose),
			Hint: "keep VibeTV powered and on the same WiFi, then retry theme install",
		}
	}
	if opts.Verbose {
		fmt.Fprintf(out, "Uploaded theme spec: %s bytes=%d\n", pack.ThemeSpecFile.Entry.Path, len(pack.ThemeSpecRaw))
	}

	fmt.Fprintln(out, "Activating theme...")
	if err := activateAndVerifyTheme(
		ctx,
		wifi,
		&resolvedTarget,
		caps,
		pack.ThemeSpecFile.Entry.Path,
		requiredGIFAssets(pack.ThemeSpec),
		opts.PairTokenStore,
		opts.FetchLiveFrame,
		out,
	); err != nil {
		op := "theme-pack/activate"
		hint := "keep VibeTV powered and on the same WiFi, then retry theme install"
		var phaseErr *themeActivationError
		if errors.As(err, &phaseErr) {
			op = phaseErr.op
			err = phaseErr.err
			if op == "theme-pack/render-health" {
				hint = "keep VibeTV powered and retry theme install; if this repeats, contact support with `codexbar-display health` output"
			}
		}
		return Result{}, &InstallError{
			Op:   op,
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: hint,
		}
	}

	cleanupThemeUserAssets(wifi, &resolvedTarget, opts.PairTokenStore, out, themePackDevicePaths(pack))

	fmt.Fprintf(out, "Done: theme %s installed on %s\n", pack.Manifest.ID, displayTarget)
	if opts.Verbose {
		fmt.Fprintf(out, "Active theme path: %s themeId=%s rev=%d\n", pack.ThemeSpecFile.Entry.Path, pack.ThemeSpec.ThemeID, pack.ThemeSpec.ThemeRev)
	}
	return Result{
		ThemeID:           pack.ThemeSpec.ThemeID,
		PackID:            pack.Manifest.ID,
		Name:              themeName,
		Target:            displayTarget,
		ActivePath:        pack.ThemeSpecFile.Entry.Path,
		ThemeRevision:     pack.ThemeSpec.ThemeRev,
		CapabilitiesKnown: caps.Known,
	}, nil
}

func discoverThemeInstallTarget(ctx context.Context, client *http.Client, target string, verbose bool, out io.Writer) string {
	publicTarget := stripTargetCredentials(target)
	if !isMDNSTarget(publicTarget) {
		return target
	}
	result, err := transportlayer.DiscoverWiFiDevice(ctx, transportlayer.WiFiDiscoveryOptions{
		Candidates:         []string{publicTarget},
		IncludeNetworkScan: true,
		Client:             client,
	})
	if err != nil {
		if verbose {
			fmt.Fprintf(out, "Device discovery: no IP fallback found for %s (%v)\n", publicTarget, err)
		}
		return target
	}
	discovered := strings.TrimSpace(result.Target)
	if discovered == "" || sameTarget(publicTarget, discovered) {
		return target
	}
	if out != nil {
		fmt.Fprintf(out, "Device discovery: using %s instead of %s\n", discovered, publicTarget)
	}
	return targetWithToken(discovered, targetToken(target))
}

func sendInstallingThemeFrame(wifi transportlayer.WiFiTransport, target string, caps protocol.DeviceCapabilities) error {
	if !caps.SupportsThemeSpecV1 {
		return errors.New("device does not support theme-spec-v1")
	}
	frame := protocol.Frame{
		V:         protocol.NormalizeProtocolVersion(caps.NegotiatedProtocolVersion),
		Provider:  "vibetv",
		Label:     "Installing",
		Session:   45,
		Weekly:    45,
		UsageMode: "remaining",
		ThemeSpec: installingThemeSpec,
	}
	line, err := frame.MarshalLine()
	if err != nil {
		return fmt.Errorf("build install screen frame: %w", err)
	}
	maxFrameBytes := caps.MaxFrameBytes
	if maxFrameBytes <= 0 {
		maxFrameBytes = protocol.DefaultMaxFrameBytes
	}
	if len(bytes.TrimSpace(line)) > maxFrameBytes {
		return fmt.Errorf("install screen frame exceeds device limit: size=%d limit=%d", len(bytes.TrimSpace(line)), maxFrameBytes)
	}
	if err := wifi.SendLine(target, line); err != nil {
		return fmt.Errorf("send install screen frame: %w", err)
	}
	return nil
}

func sendLiveThemeFrame(ctx context.Context, wifi transportlayer.WiFiTransport, target string, caps protocol.DeviceCapabilities, fetchFrame func(context.Context) (protocol.Frame, error)) error {
	if fetchFrame == nil {
		fetchFrame = codexbar.FetchFirstFrame
	}
	frame, err := fetchFrame(ctx)
	if err != nil {
		return fmt.Errorf("fetch current usage: %w", err)
	}
	frame = frame.Normalize()
	frame.V = protocol.NormalizeProtocolVersion(caps.NegotiatedProtocolVersion)
	frame.Theme = ""
	frame.ThemeSpec = nil
	frame.ConfirmClearThemeSpec = false
	line, err := frame.MarshalLine()
	if err != nil {
		return fmt.Errorf("build live frame: %w", err)
	}
	maxFrameBytes := caps.MaxFrameBytes
	if maxFrameBytes <= 0 {
		maxFrameBytes = protocol.DefaultMaxFrameBytes
	}
	if len(bytes.TrimSpace(line)) > maxFrameBytes {
		return fmt.Errorf("live frame exceeds device limit: size=%d limit=%d", len(bytes.TrimSpace(line)), maxFrameBytes)
	}
	if err := wifi.SendLine(target, line); err != nil {
		return fmt.Errorf("send live frame: %w", err)
	}
	return nil
}

func sendClearThemeSpecFrame(ctx context.Context, wifi transportlayer.WiFiTransport, target string, caps protocol.DeviceCapabilities, fetchFrame func(context.Context) (protocol.Frame, error)) error {
	if fetchFrame == nil {
		fetchFrame = codexbar.FetchFirstFrame
	}
	frame, err := fetchFrame(ctx)
	if err != nil {
		return fmt.Errorf("fetch current usage: %w", err)
	}
	frame = frame.Normalize()
	frame.V = protocol.NormalizeProtocolVersion(caps.NegotiatedProtocolVersion)
	frame.Theme = ""
	frame.ThemeSpec = json.RawMessage("null")
	frame.ConfirmClearThemeSpec = true
	line, err := frame.MarshalLine()
	if err != nil {
		return fmt.Errorf("build clear-theme frame: %w", err)
	}
	maxFrameBytes := caps.MaxFrameBytes
	if maxFrameBytes <= 0 {
		maxFrameBytes = protocol.DefaultMaxFrameBytes
	}
	if len(bytes.TrimSpace(line)) > maxFrameBytes {
		return fmt.Errorf("clear-theme frame exceeds device limit: size=%d limit=%d", len(bytes.TrimSpace(line)), maxFrameBytes)
	}
	if err := wifi.SendLine(target, line); err != nil {
		return fmt.Errorf("send clear-theme frame: %w", err)
	}
	return nil
}

func currentStoredThemePath(wifi transportlayer.WiFiTransport, target string) (string, error) {
	health, err := wifi.DeviceHealthSnapshot(target)
	if err != nil {
		return "", err
	}
	path := strings.TrimSpace(health.Display.ThemeSpec.Path)
	if !health.Display.ThemeSpec.Active || path == "" || strings.EqualFold(strings.TrimSpace(health.Display.ActiveTheme), "installing") {
		return "", nil
	}
	return path, nil
}

func restoreThemeInstallScreen(
	ctx context.Context,
	wifi transportlayer.WiFiTransport,
	target *string,
	caps protocol.DeviceCapabilities,
	previousThemePath string,
	store PairTokenStore,
	fetchFrame func(context.Context) (protocol.Frame, error),
	out io.Writer,
) {
	previousThemePath = strings.TrimSpace(previousThemePath)
	if previousThemePath != "" {
		fmt.Fprintln(out, "Restoring previous theme...")
		if err := activateThemeWithPairRetry(wifi, target, previousThemePath, store); err != nil {
			fmt.Fprintf(out, "Restore previous theme: skipped (%v)\n", err)
		} else {
			fmt.Fprintln(out, "Restore previous theme: activated")
			sendLiveThemeFrameWithPairRetry(ctx, wifi, target, caps, store, fetchFrame, out)
			return
		}
	}
	if err := sendClearThemeSpecFrameWithPairRetry(ctx, wifi, target, caps, store, fetchFrame); err != nil {
		fmt.Fprintf(out, "Clear install screen: skipped (%v)\n", err)
		return
	}
	fmt.Fprintln(out, "Clear install screen: refreshed")
}

type themeActivationError struct {
	op  string
	err error
}

func (e *themeActivationError) Error() string {
	if e == nil || e.err == nil {
		return ""
	}
	return e.err.Error()
}

func (e *themeActivationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func activateAndVerifyTheme(
	ctx context.Context,
	wifi transportlayer.WiFiTransport,
	target *string,
	caps protocol.DeviceCapabilities,
	activePath string,
	gifAssets []string,
	store PairTokenStore,
	fetchFrame func(context.Context) (protocol.Frame, error),
	out io.Writer,
) error {
	attempts := activationAttempts
	if attempts < 1 {
		attempts = 1
	}
	var lastErr error
	lastOp := "theme-pack/activate"
	for attempt := 1; attempt <= attempts; attempt++ {
		if attempt > 1 {
			fmt.Fprintf(out, "Theme activation retry %d/%d.\n", attempt, attempts)
		}
		if err := activateThemeWithPairRetry(wifi, target, activePath, store); err != nil {
			lastErr = err
			lastOp = "theme-pack/activate"
			if !themeInstallRetryableError(err) || attempt == attempts {
				return &themeActivationError{op: lastOp, err: lastErr}
			}
			fmt.Fprintln(out, "Theme activation interrupted, retrying...")
			if err := sleepActivationRetry(ctx); err != nil {
				return &themeActivationError{op: lastOp, err: err}
			}
			continue
		}

		sendLiveThemeFrameWithPairRetry(ctx, wifi, target, caps, store, fetchFrame, out)
		if err := verifyThemeInstallHealth(wifi, *target, activePath, gifAssets); err != nil {
			lastErr = err
			lastOp = "theme-pack/render-health"
			if attempt == attempts {
				return &themeActivationError{op: lastOp, err: lastErr}
			}
			fmt.Fprintln(out, "Theme activation did not settle, retrying...")
			if err := sleepActivationRetry(ctx); err != nil {
				return &themeActivationError{op: lastOp, err: err}
			}
			continue
		}
		return nil
	}
	if lastErr == nil {
		lastErr = errors.New("theme activation did not complete")
	}
	return &themeActivationError{op: lastOp, err: lastErr}
}

func sendLiveThemeFrameWithPairRetry(
	ctx context.Context,
	wifi transportlayer.WiFiTransport,
	target *string,
	caps protocol.DeviceCapabilities,
	store PairTokenStore,
	fetchFrame func(context.Context) (protocol.Frame, error),
	out io.Writer,
) {
	err := sendLiveThemeFrame(ctx, wifi, *target, caps, fetchFrame)
	if err != nil && authRequired(err) {
		pairedTarget, pairErr := pairThemeInstallTarget(wifi, *target, store)
		if pairErr == nil {
			*target = pairedTarget
			err = sendLiveThemeFrame(ctx, wifi, *target, caps, fetchFrame)
		} else {
			err = pairErr
		}
	}
	if err != nil {
		fmt.Fprintf(out, "Live usage frame: skipped (%v)\n", err)
		return
	}
	fmt.Fprintln(out, "Live usage frame: refreshed")
}

func sendClearThemeSpecFrameWithPairRetry(
	ctx context.Context,
	wifi transportlayer.WiFiTransport,
	target *string,
	caps protocol.DeviceCapabilities,
	store PairTokenStore,
	fetchFrame func(context.Context) (protocol.Frame, error),
) error {
	err := sendClearThemeSpecFrame(ctx, wifi, *target, caps, fetchFrame)
	if err == nil || !authRequired(err) {
		return err
	}
	pairedTarget, pairErr := pairThemeInstallTarget(wifi, *target, store)
	if pairErr != nil {
		return pairErr
	}
	*target = pairedTarget
	return sendClearThemeSpecFrame(ctx, wifi, *target, caps, fetchFrame)
}

func cleanupThemeUserAssets(wifi transportlayer.WiFiTransport, target *string, store PairTokenStore, out io.Writer, keepPaths map[string]bool) {
	assets, err := wifi.DeviceAssets(*target)
	if err != nil {
		fmt.Fprintf(out, "Theme file cleanup: skipped (%v)\n", err)
		return
	}
	paths := cleanupThemeUserAssetPaths(assets, keepPaths)
	if len(paths) == 0 {
		return
	}
	fmt.Fprintln(out, "Cleaning old theme files...")
	for _, devicePath := range paths {
		if err := deleteAssetWithPairRetry(wifi, target, devicePath, store); err != nil {
			fmt.Fprintf(out, "Theme file cleanup: skipped %s (%v)\n", devicePath, err)
		}
	}
}

func cleanupThemeUserAssetPaths(assets transportlayer.DeviceAssetsSnapshot, keepPaths map[string]bool) []string {
	paths := assets.PathsWithPrefix("/themes/u/")
	filtered := paths[:0]
	for _, devicePath := range paths {
		if keepPaths[strings.TrimSpace(devicePath)] {
			continue
		}
		filtered = append(filtered, devicePath)
	}
	sort.Strings(filtered)
	return filtered
}

func themePackDevicePaths(pack *themepack.Pack) map[string]bool {
	if pack == nil {
		return nil
	}
	paths := make(map[string]bool, len(pack.Assets)+1)
	addThemeDevicePath(paths, pack.ThemeSpecFile.Entry.Path)
	for _, asset := range pack.Assets {
		addThemeDevicePath(paths, asset.Entry.Path)
	}
	return paths
}

func addThemeDevicePath(paths map[string]bool, devicePath string) {
	devicePath = strings.TrimSpace(devicePath)
	if devicePath != "" {
		paths[devicePath] = true
	}
}

func deleteAssetWithPairRetry(wifi transportlayer.WiFiTransport, target *string, devicePath string, store PairTokenStore) error {
	err := wifi.DeleteAsset(*target, devicePath)
	if err == nil || !authRequired(err) {
		return err
	}
	pairedTarget, pairErr := pairThemeInstallTarget(wifi, *target, store)
	if pairErr != nil {
		return pairErr
	}
	*target = pairedTarget
	return wifi.DeleteAsset(*target, devicePath)
}

func sleepActivationRetry(ctx context.Context) error {
	if activationRetryDelay <= 0 {
		return nil
	}
	timer := time.NewTimer(activationRetryDelay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func uploadAssetWithPairRetry(wifi transportlayer.WiFiTransport, target *string, devicePath, filename string, data []byte, store PairTokenStore) error {
	err := wifi.UploadAsset(*target, devicePath, filename, data)
	if err == nil || !authRequired(err) {
		return err
	}
	pairedTarget, pairErr := pairThemeInstallTarget(wifi, *target, store)
	if pairErr != nil {
		return pairErr
	}
	*target = pairedTarget
	return wifi.UploadAsset(*target, devicePath, filename, data)
}

func uploadAssetAndVerifyWithPairRetry(
	wifi transportlayer.WiFiTransport,
	target *string,
	devicePath,
	filename string,
	data []byte,
	store PairTokenStore,
	settleDelay time.Duration,
	verbose bool,
	out io.Writer,
) error {
	var lastErr error
	for attempt := 1; attempt <= uploadVerifyAttempts; attempt++ {
		if err := uploadAssetWithPairRetry(wifi, target, devicePath, filename, data, store); err != nil {
			return err
		} else if err := settleUpload(wifi, *target, devicePath, len(data), settleDelay, verbose, out); err != nil {
			lastErr = err
		} else {
			return nil
		}

		if attempt >= uploadVerifyAttempts {
			return lastErr
		}
		fmt.Fprintln(out, "Upload verification failed, retrying...")
		if verbose {
			fmt.Fprintf(out, "Upload retry %d/%d: %s (%v)\n", attempt+1, uploadVerifyAttempts, devicePath, lastErr)
		}
		time.Sleep(uploadVerifyRetryDelay)
	}
	return lastErr
}

func activateThemeWithPairRetry(wifi transportlayer.WiFiTransport, target *string, devicePath string, store PairTokenStore) error {
	err := wifi.ActivateStoredTheme(*target, devicePath)
	if err == nil || !authRequired(err) {
		return err
	}
	pairedTarget, pairErr := pairThemeInstallTarget(wifi, *target, store)
	if pairErr != nil {
		return pairErr
	}
	*target = pairedTarget
	return wifi.ActivateStoredTheme(*target, devicePath)
}

func pairThemeInstallTarget(wifi transportlayer.WiFiTransport, target string, store PairTokenStore) (string, error) {
	token, err := wifi.PairDevice(target)
	if err != nil {
		return target, err
	}
	publicTarget := stripTargetCredentials(target)
	if store != nil {
		if err := store(publicTarget, token); err != nil {
			return target, err
		}
	}
	return targetWithToken(publicTarget, token), nil
}

func targetWithToken(target, token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return target
	}
	parsed, err := url.Parse(strings.TrimSpace(target))
	if err != nil {
		return target
	}
	query := parsed.Query()
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func targetToken(target string) string {
	parsed, err := url.Parse(strings.TrimSpace(target))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(parsed.Query().Get("token"))
}

func isMDNSTarget(target string) bool {
	parsed, err := url.Parse(strings.TrimSpace(target))
	if err != nil {
		return strings.Contains(strings.ToLower(target), "vibetv.local")
	}
	return strings.EqualFold(parsed.Hostname(), "vibetv.local")
}

func sameTarget(left, right string) bool {
	return strings.EqualFold(
		strings.TrimRight(stripTargetCredentials(left), "/"),
		strings.TrimRight(stripTargetCredentials(right), "/"),
	)
}

func authRequired(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "status=401") ||
		strings.Contains(msg, "pairing token required") ||
		strings.Contains(msg, "unauthorized")
}

func themeInstallRetryableError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "status=408") ||
		strings.Contains(msg, "status=429") ||
		strings.Contains(msg, "status=500") ||
		strings.Contains(msg, "status=502") ||
		strings.Contains(msg, "status=503") ||
		strings.Contains(msg, "status=504") {
		return true
	}
	for _, part := range []string{
		"timeout",
		"context deadline exceeded",
		"connection reset",
		"connection refused",
		"broken pipe",
		"server closed idle connection",
		"eof",
		"temporary",
	} {
		if strings.Contains(msg, part) {
			return true
		}
	}
	return false
}

func verifyThemeInstallHealth(wifi transportlayer.WiFiTransport, target, activePath string, gifAssets []string) error {
	expectedGIFs := stringSet(gifAssets)
	var lastErr error
	for attempt := 0; attempt < renderHealthAttempts; attempt++ {
		health, err := wifi.DeviceHealthSnapshot(target)
		if err != nil {
			lastErr = err
		} else if err := validateThemeHealthSnapshot(health, activePath, expectedGIFs); err != nil {
			lastErr = err
		} else {
			return nil
		}
		time.Sleep(renderHealthDelay)
	}
	return lastErr
}

func validateThemeHealthSnapshot(health transportlayer.DeviceHealthSnapshot, activePath string, expectedGIFs map[string]struct{}) error {
	if !health.Display.ThemeSpec.Active ||
		!health.Display.ThemeSpec.RenderOk ||
		(strings.TrimSpace(activePath) != "" && health.Display.ThemeSpec.Path != activePath) {
		return fmt.Errorf(
			"theme render not healthy: active=%t path=%q renderOk=%t renderError=%q activeTheme=%q",
			health.Display.ThemeSpec.Active,
			health.Display.ThemeSpec.Path,
			health.Display.ThemeSpec.RenderOk,
			health.Display.ThemeSpec.RenderError,
			health.Display.ActiveTheme,
		)
	}
	if len(expectedGIFs) == 0 {
		return nil
	}
	gif := health.Display.GIF
	if _, ok := expectedGIFs[gif.ActivePath]; !ok ||
		!gif.FilePresent ||
		!gif.DecoderAllocated ||
		!gif.DecoderOpen ||
		strings.TrimSpace(gifHealthLastError(gif.LastError, gif.LastErrorStage)) != "" {
		return fmt.Errorf(
			"gif playback not healthy: activePath=%q expected=%v filePresent=%t decoderAllocated=%t decoderOpen=%t lastError=%q",
			gif.ActivePath,
			mapKeys(expectedGIFs),
			gif.FilePresent,
			gif.DecoderAllocated,
			gif.DecoderOpen,
			gifHealthLastError(gif.LastError, gif.LastErrorStage),
		)
	}
	return nil
}

func requiredGIFAssets(spec themespec.Spec) []string {
	seen := map[string]struct{}{}
	for _, primitive := range spec.Primitives {
		if primitive.Type != "gif" {
			continue
		}
		if primitive.AssetPath != "" {
			seen[primitive.AssetPath] = struct{}{}
		}
		for _, assetPath := range primitive.StateAssets {
			if strings.TrimSpace(assetPath) != "" {
				seen[assetPath] = struct{}{}
			}
		}
	}
	return mapKeys(seen)
}

func stringSet(values []string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out[value] = struct{}{}
		}
	}
	return out
}

func mapKeys(values map[string]struct{}) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func gifHealthLastError(lastError, lastErrorStage string) string {
	if strings.TrimSpace(lastError) != "" {
		return strings.TrimSpace(lastError)
	}
	return strings.TrimSpace(lastErrorStage)
}

func stripTargetCredentials(target string) string {
	parsed, err := url.Parse(strings.TrimSpace(target))
	if err != nil {
		return strings.TrimSpace(target)
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func ResolveSource(packPath, catalogRef, themeID string) (string, error) {
	if packPath != "" {
		if catalogRef != "" {
			return "", errors.New("use either packUrl or catalogUrl, not both")
		}
		return packPath, nil
	}
	if catalogRef == "" && themeID == "" {
		return "", errors.New("missing theme pack source: pass packUrl or themeId")
	}
	if catalogRef == "" {
		catalogRef = DefaultCatalogURL
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

func FallbackThemeSpecCapabilities() protocol.DeviceCapabilities {
	return protocol.DeviceCapabilities{
		Known:                     true,
		ProtocolVersion:           protocol.ProtocolVersionV2,
		SupportedProtocolVersions: []int{protocol.ProtocolVersionV2, protocol.ProtocolVersionV1},
		PreferredProtocolVersion:  protocol.ProtocolVersionV2,
		NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
		Board:                     "assumed-usb-profile",
		SupportsTheme:             true,
		SupportsThemeSpecV1:       true,
		SupportsStoredThemes:      true,
		MaxFrameBytes:             1024,
		MaxThemeSpecBytes:         1024,
		MaxStoredThemeSpecBytes:   1024,
		MaxThemePrimitives:        32,
		BuiltinThemes:             theme.Names(),
		ActiveTransport:           "usb",
	}
}

func settleUpload(wifi transportlayer.WiFiTransport, target, devicePath string, expectedBytes int, delay time.Duration, verbose bool, out io.Writer) error {
	if delay > 0 {
		time.Sleep(delay)
	}
	if err := wifi.DeviceHealth(target); err != nil {
		return &uploadHealthError{devicePath: devicePath, err: err}
	}
	assets, err := wifi.DeviceAssets(target)
	if err != nil {
		return &uploadAssetVerifyError{devicePath: devicePath, expectedBytes: expectedBytes, err: err}
	}
	actualBytes, ok := assets.AssetSize(devicePath)
	if !ok {
		return &uploadAssetVerifyError{devicePath: devicePath, expectedBytes: expectedBytes}
	}
	if actualBytes != int64(expectedBytes) {
		return &uploadAssetVerifyError{
			devicePath:    devicePath,
			expectedBytes: expectedBytes,
			actualBytes:   actualBytes,
			found:         true,
		}
	}
	if verbose {
		fmt.Fprintf(out, "Upload verified: %s bytes=%d\n", devicePath, expectedBytes)
	}
	return nil
}

type uploadHealthError struct {
	devicePath string
	err        error
}

func (e *uploadHealthError) Error() string {
	return fmt.Sprintf("device did not answer health check after uploading %s", e.devicePath)
}

func (e *uploadHealthError) Unwrap() error {
	return e.err
}

type uploadAssetVerifyError struct {
	devicePath    string
	expectedBytes int
	actualBytes   int64
	found         bool
	err           error
}

func (e *uploadAssetVerifyError) Error() string {
	if e.err != nil {
		return fmt.Sprintf("device asset list failed after uploading %s: %v", e.devicePath, e.err)
	}
	if !e.found {
		return fmt.Sprintf("uploaded asset %s is missing on VibeTV", e.devicePath)
	}
	return fmt.Sprintf("uploaded asset %s has size %d bytes, expected %d", e.devicePath, e.actualBytes, e.expectedBytes)
}

func (e *uploadAssetVerifyError) Unwrap() error {
	return e.err
}

func uploadError(devicePath string, err error, verbose bool) error {
	if verbose {
		return fmt.Errorf("upload failed for %s: %w", devicePath, err)
	}
	var verifyErr *uploadAssetVerifyError
	if errors.As(err, &verifyErr) {
		return fmt.Errorf("theme upload did not finish for %s: %v", devicePath, verifyErr)
	}
	var healthErr *uploadHealthError
	if errors.As(err, &healthErr) {
		return fmt.Errorf("theme upload did not finish for %s: device health check failed after upload", devicePath)
	}
	return fmt.Errorf("theme upload did not finish for %s", devicePath)
}
