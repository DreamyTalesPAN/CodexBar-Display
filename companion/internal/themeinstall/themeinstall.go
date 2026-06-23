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
	"strings"
	"time"

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
)

var installingThemeSpec = json.RawMessage(`{"v":1,"id":"installing","rev":1,"fb":"mini","p":[{"t":"r","x":0,"y":0,"w":240,"h":240,"c":"#111111"},{"t":"tx","x":28,"y":58,"v":"INSTALLING","s":2,"c":"#B6FF00"},{"t":"tx","x":36,"y":94,"v":"NEW THEME","s":2,"c":"#FFFFFF"},{"t":"p","x":34,"y":150,"w":172,"h":18,"b":"s","c":"#B6FF00","bg":"#303030"}]}`)

type FirmwareUpdater func(ctx context.Context, target, manifestURL string) error

type Options struct {
	PackURL             string
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
	UploadSettleDelay   time.Duration
	Now                 func() time.Time
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

func Install(ctx context.Context, opts Options) (Result, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	out := opts.Out
	if out == nil {
		out = io.Discard
	}
	resolvedPack, err := ResolveSource(strings.TrimSpace(opts.PackURL), strings.TrimSpace(opts.CatalogURL), strings.TrimSpace(opts.ThemeID))
	if err != nil {
		return Result{}, err
	}
	pack, err := themepack.Load(resolvedPack)
	if err != nil {
		return Result{}, err
	}
	themeName := strings.TrimSpace(pack.Manifest.Name)
	if themeName == "" {
		themeName = pack.Manifest.ID
	}
	fmt.Fprintf(out, "Preparing theme: %s\n", themeName)
	if opts.Verbose {
		fmt.Fprintf(out, "Theme source: %s\n", stripURLCredentials(resolvedPack))
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
	if err := themespec.ValidateAgainstCapabilities(pack.ThemeSpec, pack.ThemeSpecRaw, caps); err != nil {
		return Result{}, &InstallError{
			Op:   "theme-pack/capabilities",
			Code: errcode.ProtocolThemeSpecIncompatible,
			Err:  err,
		}
	}
	if err := sendInstallingThemeFrame(wifi, resolvedTarget, caps); err != nil {
		fmt.Fprintf(out, "Install screen: skipped (%v)\n", err)
	} else {
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
		if err := wifi.UploadAsset(resolvedTarget, asset.Entry.Path, filepath.Base(asset.Entry.File), asset.Data); err != nil {
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
		if err := settleUpload(wifi, resolvedTarget, asset.Entry.Path, uploadSettleDelay, opts.Verbose, out); err != nil {
			return Result{}, &InstallError{
				Op:   "theme-pack/upload",
				Code: errcode.UpgradeFlashFirmware,
				Err:  uploadError(asset.Entry.Path, err, opts.Verbose),
				Hint: "keep VibeTV powered and on the same WiFi, then retry theme install",
			}
		}
	}
	if err := wifi.UploadAsset(resolvedTarget, pack.ThemeSpecFile.Entry.Path, filepath.Base(pack.ThemeSpecFile.Entry.File), pack.ThemeSpecRaw); err != nil {
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
	if err := settleUpload(wifi, resolvedTarget, pack.ThemeSpecFile.Entry.Path, uploadSettleDelay, opts.Verbose, out); err != nil {
		return Result{}, &InstallError{
			Op:   "theme-pack/upload",
			Code: errcode.UpgradeFlashFirmware,
			Err:  uploadError(pack.ThemeSpecFile.Entry.Path, err, opts.Verbose),
			Hint: "keep VibeTV powered and on the same WiFi, then retry theme install",
		}
	}

	fmt.Fprintln(out, "Activating theme...")
	if err := wifi.ActivateStoredTheme(resolvedTarget, pack.ThemeSpecFile.Entry.Path); err != nil {
		return Result{}, &InstallError{
			Op:   "theme-pack/activate",
			Code: errcode.UpgradeFlashFirmware,
			Err:  err,
			Hint: "keep VibeTV powered and on the same WiFi, then retry theme install",
		}
	}

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

func stripTargetCredentials(target string) string {
	return stripURLCredentials(target)
}

func stripURLCredentials(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return strings.TrimSpace(raw)
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
		MaxFrameBytes:             1024,
		MaxThemeSpecBytes:         1024,
		MaxThemePrimitives:        32,
		BuiltinThemes:             theme.Names(),
		ActiveTransport:           "usb",
	}
}

func settleUpload(wifi transportlayer.WiFiTransport, target, devicePath string, delay time.Duration, verbose bool, out io.Writer) error {
	if delay > 0 {
		time.Sleep(delay)
	}
	if err := wifi.DeviceHealth(target); err != nil {
		return &uploadHealthError{devicePath: devicePath, err: err}
	}
	if verbose {
		fmt.Fprintf(out, "Upload verified: %s\n", devicePath)
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

func uploadError(devicePath string, err error, verbose bool) error {
	if verbose {
		return fmt.Errorf("upload failed for %s: %w", devicePath, err)
	}
	var healthErr *uploadHealthError
	if errors.As(err, &healthErr) {
		return fmt.Errorf("theme upload did not finish for %s: device health check failed after upload", devicePath)
	}
	return fmt.Errorf("theme upload did not finish for %s", devicePath)
}
