package companionapi

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

//go:embed all:controlcenter_static
var embeddedControlCenterStatic embed.FS

const (
	DefaultAddr               = "127.0.0.1:47832"
	appOrigin                 = "https://app.vibetv.shop"
	defaultDevOrigin          = "http://localhost:3000"
	previewOriginHostPrefix   = "codex-vibetv-control-center-"
	previewOriginHostSuffix   = "-paul-anduschus-projects.vercel.app"
	nativeControlCenterUA     = "VibeTVControlCenter/"
	deviceTimeout             = 15 * time.Second
	discoveryProbeTime        = 1500 * time.Millisecond
	repairDiscoveryAttempts   = 3
	repairDiscoveryRetryGap   = 1200 * time.Millisecond
	subnetProbeLimit          = 32
	themeInstallDisableEnv    = "VIBETV_DISABLE_WIFI_THEME_INSTALL"
	macAppUpdateDisableEnv    = "VIBETV_DISABLE_MAC_APP_SELF_UPDATE"
	displayStreamLegacyLabel  = runtimepaths.LegacyDisplayStreamLaunchAgentLabel
	displayStreamLabelEnv     = runtimepaths.DisplayStreamLaunchAgentLabelEnv
	displayStreamOutLogEnv    = runtimepaths.DisplayStreamOutLogEnv
	displayStreamReadyAge     = 2 * time.Minute
	displayVerificationAge    = 2 * time.Minute
	displayStreamWaitTime     = 12 * time.Second
	displayRenderWaitTime     = 12 * time.Second
	defaultPairAttempts       = 3
	defaultPairAttemptTimeout = 5 * time.Second
	defaultPairRetryGap       = 500 * time.Millisecond
	firmwareUpdateJobTime     = 10 * time.Minute
	macAppUpdateJobTime       = 8 * time.Minute
	usageFallbackFetchTime    = 15 * time.Second
	macAppInstallerURL        = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh"
	macAppReleaseAPIEnvVar    = "CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL"
	macAppReleaseAPIURL       = "https://api.github.com/repos/DreamyTalesPAN/CodexBar-Display/releases/latest"
	macAppReleaseCheckGap     = 6 * time.Hour
	macAppReleaseTimeout      = 5 * time.Second
	firmwareManifestEnvVar    = "CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL"
	firmwareReleaseTimeout    = 5 * time.Second
)

var deviceHealthProbeTime = 2 * time.Second
var subnetProbeTime = 450 * time.Millisecond

var printDisplayStreamService = func(ctx context.Context, service string) ([]byte, error) {
	return exec.CommandContext(ctx, "launchctl", "print", service).CombinedOutput()
}

var displayStreamLogKeys = []string{
	"code",
	"op",
	"retry",
	"recovery",
	"err",
	"transport",
	"source",
	"fresh",
	"usageMode",
	"provider",
	"label",
	"session",
	"weekly",
	"reset",
	"activity",
	"time",
	"date",
	"error",
	"reason",
	"detail",
	"activityDetail",
}

type Options struct {
	Addr                 string
	Home                 string
	AllowedOrigins       []string
	ControlCenterFS      fs.FS
	HTTPClient           *http.Client
	RefreshDisplayStream func(context.Context, string) error
	PauseDisplayStream   func(bool)
}

type Server struct {
	addr                   string
	home                   string
	allowedOrigins         map[string]struct{}
	controlCenterFS        fs.FS
	client                 *http.Client
	loadConfig             func(string) (runtimeconfig.Config, error)
	saveConfig             func(string, runtimeconfig.Config) error
	installTheme           func(context.Context, themeinstall.Options) (themeinstall.Result, error)
	runSetup               func(context.Context, setup.Options) error
	subnetTargets          func() []string
	defaultWiFiTarget      func() string
	streamStatus           func(context.Context, string) displayStreamInfo
	waitStream             func(context.Context, string) displayStreamInfo
	waitStreamAfter        func(context.Context, string, time.Time) displayStreamInfo
	waitStreamAfterPair    func(context.Context, string, time.Time) displayStreamInfo
	waitRender             func(context.Context, string, string, deviceHealth) (deviceHealth, error)
	refreshStream          func(context.Context, string) error
	pauseDisplayStream     func(bool)
	firmwareUpdateActive   atomic.Bool
	configMu               sync.Mutex
	repairMu               sync.Mutex
	repairFlightsMu        sync.Mutex
	repairFlights          map[string]*deviceRepairFlight
	deviceMaintenanceMu    sync.Mutex
	pairMu                 sync.Mutex
	verificationMu         sync.Mutex
	displayVerifications   map[string]displayVerification
	pairAttempts           int
	pairAttemptTimeout     time.Duration
	pairRetryGap           time.Duration
	allowMacAppSelfUpdate  bool
	installationMode       string
	loadUsage              func(time.Time) (daemon.PersistedUsage, bool)
	fetchUsage             func(context.Context) ([]codexbar.ParsedFrame, error)
	updateFirmware         func(context.Context, string, runtimeconfig.Config, firmwareUpdateRequest, io.Writer) error
	updateMacApp           func(context.Context, string, string, macAppUpdateRequest, io.Writer) error
	fetchMacAppRelease     func(context.Context) (githubRelease, error)
	installJobsMu          sync.Mutex
	installJobs            map[string]*themeInstallJob
	nextInstallJob         uint64
	updateJobsMu           sync.Mutex
	updateJobs             map[string]*firmwareUpdateJob
	nextUpdateJob          uint64
	macAppUpdateMu         sync.Mutex
	macAppUpdateJobs       map[string]*macAppUpdateJob
	nextMacAppUpdate       uint64
	macAppReleaseMu        sync.Mutex
	macAppReleaseChecked   bool
	macAppReleaseCheckedAt time.Time
	macAppReleaseCache     companionReleaseInfo
}

type apiError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	NextAction string `json:"nextAction"`
}

type errorResponse struct {
	OK    bool     `json:"ok"`
	Error apiError `json:"error"`
}

type multipleDevicesError struct {
	targets []string
}

func (e *multipleDevicesError) Error() string {
	if e == nil || len(e.targets) == 0 {
		return "multiple VibeTV devices found"
	}
	return fmt.Sprintf("multiple VibeTV devices found: %s", strings.Join(e.targets, ", "))
}

type invalidTargetError struct {
	target string
}

func (e *invalidTargetError) Error() string {
	return "invalid VibeTV target"
}

type repairStageError struct {
	stage string
	err   error
}

type deviceRepairFlight struct {
	done   chan struct{}
	device deviceInfo
	err    error
}

func (e *repairStageError) Error() string {
	if e == nil || e.err == nil {
		return ""
	}
	return fmt.Sprintf("%s: %v", e.stage, e.err)
}

func (e *repairStageError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

type deviceInfo struct {
	Target       string                    `json:"target,omitempty"`
	DeviceID     string                    `json:"deviceId,omitempty"`
	NetworkMode  string                    `json:"networkMode,omitempty"`
	Connected    bool                      `json:"connected"`
	Paired       bool                      `json:"paired,omitempty"`
	Ready        bool                      `json:"ready"`
	Board        string                    `json:"board,omitempty"`
	Firmware     string                    `json:"firmware,omitempty"`
	ActiveTheme  string                    `json:"activeTheme,omitempty"`
	Capabilities *protocol.CapabilityBlock `json:"capabilities,omitempty"`
	Stream       *displayStreamInfo        `json:"stream,omitempty"`
	Display      *deviceDisplayInfo        `json:"display,omitempty"`
	Health       *deviceHealthInfo         `json:"health,omitempty"`
}

type displayStreamInfo struct {
	Healthy    bool   `json:"healthy"`
	Running    bool   `json:"running"`
	LastSentAt string `json:"lastSentAt,omitempty"`
	Target     string `json:"target,omitempty"`
	LastTarget string `json:"lastTarget,omitempty"`
	Detail     string `json:"detail,omitempty"`
	ErrorCode  string `json:"errorCode,omitempty"`
}

type displayVerification struct {
	Token        string
	FullCount    uint64
	PartialCount uint64
	VerifiedAt   time.Time
}

type deviceDisplayInfo struct {
	ThemeSpec *themeSpecHealth `json:"themeSpec,omitempty"`
}

type deviceHealthInfo struct {
	OK          bool   `json:"ok"`
	ResetReason string `json:"resetReason,omitempty"`
	RenderKind  string `json:"renderKind,omitempty"`
	Error       string `json:"error,omitempty"`
}

type themeSpecHealth struct {
	Active         bool   `json:"active"`
	Path           string `json:"path,omitempty"`
	Hash           string `json:"hash,omitempty"`
	RenderOK       *bool  `json:"renderOk,omitempty"`
	RenderError    string `json:"renderError,omitempty"`
	RenderFailures uint64 `json:"renderFailures,omitempty"`
}

type statusResponse struct {
	OK        bool       `json:"ok"`
	Companion companion  `json:"companion"`
	Device    deviceInfo `json:"device"`
}

type deviceActionResponse struct {
	OK     bool       `json:"ok"`
	Device deviceInfo `json:"device"`
}

type deviceSearchEntry struct {
	Target      string `json:"target"`
	DeviceID    string `json:"deviceId,omitempty"`
	Board       string `json:"board,omitempty"`
	Firmware    string `json:"firmware,omitempty"`
	NetworkMode string `json:"networkMode,omitempty"`
	Known       bool   `json:"known"`
}

type themeInstallRequest struct {
	ThemeID            string `json:"themeId"`
	PackURL            string `json:"packUrl"`
	CatalogURL         string `json:"catalogUrl"`
	SkipFirmwareUpdate *bool  `json:"skipFirmwareUpdate"`
	Async              bool   `json:"async"`
}

type themeInstallJob struct {
	ID         string               `json:"id"`
	Phase      string               `json:"phase"`
	Message    string               `json:"message"`
	Progress   int                  `json:"progress"`
	StartedAt  time.Time            `json:"startedAt"`
	FinishedAt *time.Time           `json:"finishedAt,omitempty"`
	Logs       []string             `json:"logs,omitempty"`
	Result     *themeinstall.Result `json:"result,omitempty"`
	Error      *apiError            `json:"error,omitempty"`
	uploads    int
}

type themeInstallJobResponse struct {
	OK  bool            `json:"ok"`
	Job themeInstallJob `json:"job"`
}

type firmwareUpdateRequest struct {
	Force bool `json:"force,omitempty"`
}

type firmwareLatestResponse struct {
	CheckedAt         string `json:"checkedAt"`
	InstalledFirmware string `json:"installedFirmware,omitempty"`
	LatestFirmware    string `json:"latestFirmware,omitempty"`
	Release           string `json:"release,omitempty"`
	UpdateAvailable   bool   `json:"updateAvailable"`
	Status            string `json:"status"`
	Message           string `json:"message,omitempty"`
}

type firmwareReleaseManifest struct {
	Release   string                    `json:"release"`
	Artifacts []firmwareReleaseArtifact `json:"artifacts"`
}

type firmwareReleaseArtifact struct {
	Board           string `json:"board"`
	FirmwareVersion string `json:"firmwareVersion"`
	Severity        string `json:"severity"`
	Message         string `json:"message"`
}

type firmwareUpdateResult struct {
	Firmware string `json:"firmware,omitempty"`
	Target   string `json:"target,omitempty"`
}

type firmwareUpdateJob struct {
	ID         string                `json:"id"`
	Phase      string                `json:"phase"`
	Message    string                `json:"message"`
	Progress   int                   `json:"progress"`
	StartedAt  time.Time             `json:"startedAt"`
	FinishedAt *time.Time            `json:"finishedAt,omitempty"`
	Logs       []string              `json:"logs,omitempty"`
	Result     *firmwareUpdateResult `json:"result,omitempty"`
	Error      *apiError             `json:"error,omitempty"`
	target     string
	firmware   string
}

type firmwareUpdateJobResponse struct {
	OK  bool              `json:"ok"`
	Job firmwareUpdateJob `json:"job"`
}

type macAppUpdateRequest struct {
	Version string `json:"version,omitempty"`
}

type macAppUpdateResult struct {
	Version string `json:"version,omitempty"`
}

type macAppUpdateJob struct {
	ID         string              `json:"id"`
	Phase      string              `json:"phase"`
	Message    string              `json:"message"`
	Progress   int                 `json:"progress"`
	StartedAt  time.Time           `json:"startedAt"`
	FinishedAt *time.Time          `json:"finishedAt,omitempty"`
	Logs       []string            `json:"logs,omitempty"`
	Result     *macAppUpdateResult `json:"result,omitempty"`
	Error      *apiError           `json:"error,omitempty"`
	version    string
}

type macAppUpdateJobResponse struct {
	OK  bool            `json:"ok"`
	Job macAppUpdateJob `json:"job"`
}

type statusAPIError struct {
	status int
	api    apiError
}

func (e *statusAPIError) Error() string {
	if e == nil {
		return ""
	}
	return e.api.Message
}

type diagnosticsResponse struct {
	OK          bool              `json:"ok"`
	GeneratedAt string            `json:"generatedAt"`
	Companion   companion         `json:"companion"`
	Device      deviceInfo        `json:"device"`
	Checks      []diagnosticCheck `json:"checks"`
}

type diagnosticCheck struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Detail     string `json:"detail,omitempty"`
	ErrorCode  string `json:"errorCode,omitempty"`
	NextAction string `json:"nextAction,omitempty"`
}

type companion struct {
	Status           string               `json:"status"`
	Version          string               `json:"version"`
	InstallationMode string               `json:"installationMode"`
	Update           companionReleaseInfo `json:"update"`
	Features         companionFeatures    `json:"features"`
}

type companionFeatures struct {
	ThemeInstallEnabled     bool `json:"themeInstallEnabled"`
	MacAppSelfUpdateEnabled bool `json:"macAppSelfUpdateEnabled"`
}

type companionReleaseInfo struct {
	CheckedAt        string `json:"checkedAt"`
	Status           string `json:"status"`
	Release          string `json:"release,omitempty"`
	LatestVersion    string `json:"latestVersion,omitempty"`
	InstalledVersion string `json:"installedVersion,omitempty"`
	UpdateAvailable  bool   `json:"updateAvailable"`
	Message          string `json:"message"`
}

type githubRelease struct {
	TagName string `json:"tag_name"`
}

type settingsResponse struct {
	OK       bool           `json:"ok"`
	Settings deviceSettings `json:"settings"`
	Device   deviceInfo     `json:"device,omitempty"`
}

type deviceSettings struct {
	Display displaySettings `json:"display"`
}

type displaySettings struct {
	BrightnessPercent int `json:"brightnessPercent"`
}

type usageResponse struct {
	OK              bool                `json:"ok"`
	GeneratedAt     string              `json:"generatedAt"`
	Source          string              `json:"source"`
	UsageMode       string              `json:"usageMode"`
	CurrentProvider string              `json:"currentProvider,omitempty"`
	Providers       []usageProviderInfo `json:"providers"`
}

type displayFrameResponse struct {
	OK      bool           `json:"ok"`
	SavedAt string         `json:"savedAt,omitempty"`
	Source  string         `json:"source,omitempty"`
	Frame   protocol.Frame `json:"frame"`
}

type persistedDisplayFrame struct {
	SavedAt time.Time      `json:"savedAt"`
	Frame   protocol.Frame `json:"frame"`
}

type usageProviderInfo struct {
	ID                 string                   `json:"id"`
	Label              string                   `json:"label"`
	Source             string                   `json:"source,omitempty"`
	Session            int                      `json:"session"`
	Weekly             int                      `json:"weekly"`
	ResetSec           int64                    `json:"resetSecs,omitempty"`
	UsageMode          string                   `json:"usageMode"`
	SessionTokens      int64                    `json:"sessionTokens,omitempty"`
	WeekTokens         int64                    `json:"weekTokens,omitempty"`
	TotalTokens        int64                    `json:"totalTokens,omitempty"`
	Activity           string                   `json:"activity,omitempty"`
	Stale              bool                     `json:"stale"`
	CollectedAt        string                   `json:"collectedAt,omitempty"`
	ActivityObservedAt string                   `json:"activityObservedAt,omitempty"`
	Windows            []usageWindowInfo        `json:"windows,omitempty"`
	Status             *usageStatusInfo         `json:"status,omitempty"`
	Credits            *usageCreditsInfo        `json:"credits,omitempty"`
	ResetCredits       *usageResetCreditsInfo   `json:"resetCredits,omitempty"`
	Cost               *usageCostInfo           `json:"cost,omitempty"`
	Pace               []usagePaceInfo          `json:"pace,omitempty"`
	UsageOverTime      []usageOverTimePointInfo `json:"usageOverTime,omitempty"`
}

type usageWindowInfo struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	UsedPercent   int    `json:"usedPercent"`
	ResetSec      int64  `json:"resetSecs,omitempty"`
	WindowMinutes int    `json:"windowMinutes,omitempty"`
}

type usageStatusInfo struct {
	Indicator   string `json:"indicator,omitempty"`
	Description string `json:"description,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	URL         string `json:"url,omitempty"`
}

type usageCreditsInfo struct {
	Remaining float64 `json:"remaining"`
	UpdatedAt string  `json:"updatedAt,omitempty"`
}

type usageResetCreditsInfo struct {
	AvailableCount int    `json:"availableCount"`
	NextExpiresAt  string `json:"nextExpiresAt,omitempty"`
	UpdatedAt      string `json:"updatedAt,omitempty"`
}

type usageCostInfo struct {
	CurrencyCode      string             `json:"currencyCode,omitempty"`
	UpdatedAt         string             `json:"updatedAt,omitempty"`
	TodayCostUSD      float64            `json:"todayCostUSD,omitempty"`
	Last30DaysCostUSD float64            `json:"last30DaysCostUSD,omitempty"`
	Last30DaysTokens  int64              `json:"last30DaysTokens,omitempty"`
	LatestTokens      int64              `json:"latestTokens,omitempty"`
	TopModel          string             `json:"topModel,omitempty"`
	Daily             []usageCostDayInfo `json:"daily,omitempty"`
}

type usageCostDayInfo struct {
	Day          string               `json:"day"`
	TotalCostUSD float64              `json:"totalCostUSD,omitempty"`
	TotalTokens  int64                `json:"totalTokens,omitempty"`
	Models       []usageCostModelInfo `json:"models,omitempty"`
}

type usageCostModelInfo struct {
	Name        string  `json:"name"`
	TotalTokens int64   `json:"totalTokens,omitempty"`
	CostUSD     float64 `json:"costUSD,omitempty"`
}

type usagePaceInfo struct {
	Window              string `json:"window"`
	Stage               string `json:"stage,omitempty"`
	DeltaPercent        int    `json:"deltaPercent,omitempty"`
	ExpectedUsedPercent int    `json:"expectedUsedPercent,omitempty"`
	WillLastToReset     bool   `json:"willLastToReset"`
	ETASeconds          int64  `json:"etaSeconds,omitempty"`
	Summary             string `json:"summary,omitempty"`
}

type usageOverTimePointInfo struct {
	Day              string                  `json:"day"`
	TotalCreditsUsed float64                 `json:"totalCreditsUsed"`
	Services         []usageServiceUsageInfo `json:"services,omitempty"`
}

type usageServiceUsageInfo struct {
	Service     string  `json:"service"`
	CreditsUsed float64 `json:"creditsUsed"`
}

func New(opts Options) (*Server, error) {
	addr := strings.TrimSpace(opts.Addr)
	if addr == "" {
		addr = DefaultAddr
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("parse companion api addr: %w", err)
	}
	if host != "127.0.0.1" {
		return nil, fmt.Errorf("companion api must bind to 127.0.0.1, got %s", host)
	}
	home := strings.TrimSpace(opts.Home)
	if home == "" {
		home, err = os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("resolve home directory: %w", err)
		}
	}
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: deviceTimeout}
	}
	client = transportlayer.SerializeDeviceHTTPClient(client)
	origins := map[string]struct{}{
		appOrigin:        {},
		defaultDevOrigin: {},
	}
	for _, origin := range opts.AllowedOrigins {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins[origin] = struct{}{}
		}
	}
	controlCenterFS := opts.ControlCenterFS
	if controlCenterFS == nil {
		controlCenterFS, err = fs.Sub(embeddedControlCenterStatic, "controlcenter_static")
		if err != nil {
			return nil, fmt.Errorf("load embedded control center: %w", err)
		}
	}
	return &Server{
		addr:                  addr,
		home:                  home,
		allowedOrigins:        origins,
		controlCenterFS:       controlCenterFS,
		client:                client,
		loadConfig:            runtimeconfig.Load,
		saveConfig:            runtimeconfig.Save,
		installTheme:          themeinstall.Install,
		runSetup:              setup.Run,
		subnetTargets:         localSubnetTargets,
		defaultWiFiTarget:     setup.DefaultWiFiTarget,
		streamStatus:          inspectDisplayStream,
		waitStream:            waitForDisplayStream,
		waitStreamAfter:       waitForDisplayStreamAfter,
		waitStreamAfterPair:   waitForDisplayStreamAfterPair,
		waitRender:            nil,
		refreshStream:         opts.RefreshDisplayStream,
		pauseDisplayStream:    opts.PauseDisplayStream,
		pairAttempts:          defaultPairAttempts,
		pairAttemptTimeout:    defaultPairAttemptTimeout,
		pairRetryGap:          defaultPairRetryGap,
		displayVerifications:  make(map[string]displayVerification),
		allowMacAppSelfUpdate: false,
		installationMode:      macAppInstallationMode(),
		loadUsage:             daemon.LoadPersistedUsage,
		fetchUsage:            codexbar.FetchAllProviders,
		updateFirmware:        runFirmwareUpdateCommand,
		updateMacApp:          runMacAppUpdateCommand,
		fetchMacAppRelease:    fetchLatestMacAppRelease,
		installJobs:           make(map[string]*themeInstallJob),
		updateJobs:            make(map[string]*firmwareUpdateJob),
		macAppUpdateJobs:      make(map[string]*macAppUpdateJob),
	}, nil
}

func (s *Server) ListenAndServe(ctx context.Context) error {
	server := &http.Server{
		Addr:              s.addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		err := server.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		errc <- err
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return err
		}
		return <-errc
	case err := <-errc:
		return err
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.registerControlCenterRoutes(mux)
	mux.HandleFunc("/v1/status", s.handleStatus)
	mux.HandleFunc("/v1/runtime-health", s.handleRuntimeHealth)
	mux.HandleFunc("/v1/usage", s.handleUsage)
	mux.HandleFunc("/v1/display-frame/latest", s.handleDisplayFrameLatest)
	mux.HandleFunc("/v1/diagnostics", s.handleDiagnostics)
	mux.HandleFunc("/v1/device/discover", s.handleDeviceDiscover)
	mux.HandleFunc("/v1/device/search", s.handleDeviceSearch)
	mux.HandleFunc("/v1/device/repair", s.handleDeviceRepair)
	mux.HandleFunc("/v1/device/reload-display", s.handleDeviceReloadDisplay)
	mux.HandleFunc("/v1/device", s.handleDevice)
	mux.HandleFunc("/v1/device/pair", s.handleDevicePair)
	mux.HandleFunc("/v1/setup/reset", s.handleSetupReset)
	mux.HandleFunc("/v1/settings", s.handleSettings)
	mux.HandleFunc("/v1/themes/install", s.handleThemeInstall)
	mux.HandleFunc("/v1/themes/install/status", s.handleThemeInstallStatus)
	mux.HandleFunc("/v1/updates/latest", s.handleFirmwareLatest)
	mux.HandleFunc("/v1/updates/install", s.handleFirmwareUpdateInstall)
	mux.HandleFunc("/v1/updates/install/status", s.handleFirmwareUpdateStatus)
	if s.allowMacAppSelfUpdate {
		mux.HandleFunc("/v1/mac-app/update", s.handleMacAppUpdateInstall)
		mux.HandleFunc("/v1/mac-app/update/status", s.handleMacAppUpdateStatus)
	}
	return s.withCORS(mux)
}

func (s *Server) registerControlCenterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/control-center", s.handleControlCenter)
	mux.HandleFunc("/control-center/", s.handleControlCenter)
	mux.HandleFunc("/_next/", s.handleControlCenterAsset)
	mux.HandleFunc("/images/", s.handleControlCenterAsset)
	mux.HandleFunc("/theme-packs/", s.handleControlCenterAsset)
	mux.HandleFunc("/favicon.ico", s.handleControlCenterAsset)
	mux.HandleFunc("/install-control-center-companion.sh", s.handleControlCenterAsset)
}

func (s *Server) handleControlCenter(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet, http.MethodHead) {
		return
	}
	if s.installationMode == "dmg" && !strings.HasPrefix(strings.TrimSpace(r.UserAgent()), nativeControlCenterUA) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusGone)
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>VibeTV Control Center</title><main><h1>VibeTV Control Center moved to the Mac App.</h1><p>Open VibeTV Control Center from Applications.</p></main>`)
		}
		return
	}
	assetPath := strings.TrimPrefix(r.URL.Path, "/control-center")
	assetPath = strings.TrimPrefix(assetPath, "/")
	if assetPath == "" {
		assetPath = "index.html"
	}
	if strings.Contains(path.Base(assetPath), ".") {
		s.serveControlCenterFile(w, r, assetPath)
		return
	}
	if routeFile := assetPath + ".html"; s.controlCenterFileExists(routeFile) {
		s.serveControlCenterFile(w, r, routeFile)
		return
	}
	if routeIndex := path.Join(assetPath, "index.html"); s.controlCenterFileExists(routeIndex) {
		s.serveControlCenterFile(w, r, routeIndex)
		return
	}
	s.serveControlCenterFile(w, r, "index.html")
}

func (s *Server) handleControlCenterAsset(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet, http.MethodHead) {
		return
	}
	assetPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if assetPath == "." || strings.HasPrefix(assetPath, "../") {
		http.NotFound(w, r)
		return
	}
	s.serveControlCenterFile(w, r, assetPath)
}

func (s *Server) serveControlCenterFile(w http.ResponseWriter, r *http.Request, assetPath string) bool {
	assetPath, ok := normalizeControlCenterAssetPath(assetPath)
	if !ok {
		http.NotFound(w, r)
		return false
	}
	if strings.HasSuffix(assetPath, ".html") {
		w.Header().Set("Cache-Control", "no-store")
	}
	data, err := fs.ReadFile(s.controlCenterFS, assetPath)
	if err != nil {
		if assetPath == "index.html" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			if r.Method != http.MethodHead {
				_, _ = io.WriteString(w, "<!doctype html><title>VibeTV Control Center unavailable</title><p>VibeTV Control Center is not bundled with this Mac App. Run setup again.</p>")
			}
			return false
		}
		http.NotFound(w, r)
		return false
	}
	http.ServeContent(w, r, path.Base(assetPath), time.Time{}, bytes.NewReader(data))
	return true
}

func (s *Server) controlCenterFileExists(assetPath string) bool {
	assetPath, ok := normalizeControlCenterAssetPath(assetPath)
	if !ok {
		return false
	}
	info, err := fs.Stat(s.controlCenterFS, assetPath)
	return err == nil && !info.IsDir()
}

func normalizeControlCenterAssetPath(assetPath string) (string, bool) {
	assetPath = strings.TrimPrefix(path.Clean("/"+assetPath), "/")
	if assetPath == "." || !fs.ValidPath(assetPath) {
		return "", false
	}
	return assetPath, true
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		allowed := s.isAllowedOrigin(origin)
		if origin != "" && allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if strings.EqualFold(strings.TrimSpace(r.Header.Get("Access-Control-Request-Private-Network")), "true") {
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
			}
		}
		if r.Method == http.MethodOptions {
			if origin != "" && !allowed {
				writeError(w, http.StatusForbidden, "cors_origin_not_allowed", "Origin is not allowed.", "Open the hosted VibeTV app or the configured local dev origin.")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) isAllowedOrigin(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return false
	}
	if _, allowed := s.allowedOrigins[origin]; allowed {
		return true
	}
	return isAllowedPreviewOrigin(origin)
}

func isAllowedPreviewOrigin(origin string) bool {
	parsed, err := url.Parse(strings.TrimSpace(origin))
	if err != nil {
		return false
	}
	if parsed.Scheme != "https" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "" || parsed.Port() != "" {
		return false
	}
	if !strings.HasPrefix(host, previewOriginHostPrefix) || !strings.HasSuffix(host, previewOriginHostSuffix) {
		return false
	}
	previewID := strings.TrimSuffix(strings.TrimPrefix(host, previewOriginHostPrefix), previewOriginHostSuffix)
	return previewID != "" && !strings.Contains(previewID, ".")
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	cfg, _ := s.config()
	stream := s.streamStatus(r.Context(), cfg.DeviceTarget)
	device := deviceInfo{
		Target:    publicTarget(cfg.DeviceTarget),
		Connected: strings.TrimSpace(cfg.DeviceToken) != "" && stream.Healthy,
		Paired:    strings.TrimSpace(cfg.DeviceToken) != "" && stream.Healthy,
		Stream:    streamPointer(stream),
	}
	if strings.TrimSpace(cfg.DeviceTarget) != "" {
		if hello, probeToken, err := s.getHelloProbeWithTokenFallback(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, discoveryProbeTime); err == nil {
			device = withDisplayStreamInfo(deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello), stream)
			device.Paired = strings.TrimSpace(cfg.DeviceToken) != "" &&
				probeToken == cfg.DeviceToken &&
				stream.ErrorCode != "device_pairing_required"
			if health, healthErr := s.getHealthProbe(r.Context(), cfg.DeviceTarget, probeToken, deviceHealthProbeTime); healthErr == nil {
				device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, probeToken, false)
			} else {
				device = withDeviceHealthProbeError(device, healthErr)
			}
		}
	}
	writeJSON(w, http.StatusOK, statusResponse{
		OK:        true,
		Companion: s.companionInfo(r.Context()),
		Device:    device,
	})
}

func (s *Server) handleRuntimeHealth(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK        bool `json:"ok"`
		Companion struct {
			Version string `json:"version"`
		} `json:"companion"`
	}{
		OK: true,
		Companion: struct {
			Version string `json:"version"`
		}{Version: buildinfo.NormalizedVersion()},
	})
}

func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	now := time.Now().UTC()
	showUsed := codexbar.UsageBarsShowUsed()
	writeUsage := func(resp usageResponse) {
		writeJSON(w, http.StatusOK, usageResponseForDisplayMode(resp, showUsed))
	}
	var persisted usageResponse
	havePersisted := false
	if s.loadUsage != nil {
		if usage, ok := s.loadUsage(now); ok && len(usage.Providers) > 0 {
			persisted = usageResponseFromPersisted(now, usage)
			havePersisted = len(persisted.Providers) > 0
			if usageResponseHasFreshProvider(persisted) {
				writeUsage(persisted)
				return
			}
		}
	}

	if s.fetchUsage == nil {
		if havePersisted {
			writeUsage(persisted)
			return
		}
		writeUsage(emptyUsageResponse(now, "codexbar-display"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), usageFallbackFetchTime)
	defer cancel()
	providers, err := s.fetchUsage(ctx)
	if err != nil {
		if havePersisted {
			writeUsage(persisted)
			return
		}
		writeError(
			w,
			http.StatusServiceUnavailable,
			"usage_unavailable",
			"Usage is not ready.",
			"Open CodexBar and the Mac App, then try again.",
		)
		return
	}
	resp := usageResponseFromParsed(now, providers)
	if len(resp.Providers) == 0 && havePersisted {
		writeUsage(persisted)
		return
	}
	writeUsage(resp)
}

func (s *Server) handleDisplayFrameLatest(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	logPath := displayStreamOutLogPath()
	boundary, boundaryOK := displayStreamLogBoundary(logPath)
	if boundaryOK {
		if sentAt, frame, ok := lastDisplayStreamFrameSnapshotAfter(logPath, boundary); ok {
			writeJSON(w, http.StatusOK, displayFrameResponse{
				OK:      true,
				SavedAt: sentAt.UTC().Format(time.RFC3339Nano),
				Source:  "last-sent-frame",
				Frame:   frame.Normalize(),
			})
			return
		}
	}

	saved, ok := s.loadLastGoodDisplayFrame()
	if !ok || !boundaryOK || (!boundary.IsZero() && saved.SavedAt.Before(boundary)) {
		writeError(
			w,
			http.StatusNotFound,
			"display_frame_unavailable",
			"Display frame is not available.",
			"Keep the Mac App running until VibeTV receives a usage frame.",
		)
		return
	}

	writeJSON(w, http.StatusOK, displayFrameResponse{
		OK:      true,
		SavedAt: saved.SavedAt.UTC().Format(time.RFC3339Nano),
		Source:  "last-good-frame",
		Frame:   saved.Frame.Normalize(),
	})
}

func (s *Server) loadLastGoodDisplayFrame() (persistedDisplayFrame, bool) {
	path := s.lastGoodDisplayFramePath()
	if path == "" {
		return persistedDisplayFrame{}, false
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return persistedDisplayFrame{}, false
	}

	var saved persistedDisplayFrame
	if err := json.Unmarshal(raw, &saved); err != nil {
		return persistedDisplayFrame{}, false
	}
	frame := saved.Frame.Normalize()
	if saved.SavedAt.IsZero() || strings.TrimSpace(frame.Error) != "" {
		return persistedDisplayFrame{}, false
	}
	saved.Frame = frame
	return saved, true
}

func (s *Server) lastGoodDisplayFramePath() string {
	home := strings.TrimSpace(s.home)
	if home == "" {
		return ""
	}
	return filepath.Join(home, "Library", "Application Support", "codexbar-display", "last-good-frame.json")
}

func (s *Server) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}

	checks := []diagnosticCheck{
		{
			Name:   "companion_api",
			Status: "pass",
			Detail: "Companion API is responding on loopback.",
		},
	}
	if themeInstallEnabled() {
		checks = append(checks, diagnosticCheck{
			Name:   "theme_install_gate",
			Status: "pass",
			Detail: "Theme install is available.",
		})
	} else {
		checks = append(checks, diagnosticCheck{
			Name:       "theme_install_gate",
			Status:     "disabled",
			Detail:     "Theme install is disabled by local Mac App configuration.",
			NextAction: "Unset VIBETV_DISABLE_WIFI_THEME_INSTALL, then restart the Mac App.",
		})
	}

	device := deviceInfo{
		Target:    publicTarget(cfg.DeviceTarget),
		Connected: false,
		Paired:    strings.TrimSpace(cfg.DeviceToken) != "",
		Stream:    streamPointer(s.streamStatus(r.Context(), cfg.DeviceTarget)),
	}
	if strings.TrimSpace(cfg.DeviceTarget) == "" {
		checks = append(checks, diagnosticCheck{
			Name:       "device_target",
			Status:     "attention",
			Detail:     "No VibeTV target is configured.",
			ErrorCode:  "device_target_missing",
			NextAction: "Run device discovery or enter the exact VibeTV target in the VibeTV target field.",
		})
		writeJSON(w, http.StatusOK, diagnosticsResponse{
			OK:          true,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
			Companion:   s.companionInfo(r.Context()),
			Device:      device,
			Checks:      checks,
		})
		return
	}

	checks = append(checks, diagnosticCheck{
		Name:   "device_target",
		Status: "pass",
		Detail: publicTarget(cfg.DeviceTarget),
	})
	hello, probeToken, err := s.getHelloProbeWithTokenFallback(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, discoveryProbeTime)
	if err != nil {
		checks = append(checks, diagnosticCheck{
			Name:       "device_hello",
			Status:     "fail",
			Detail:     sanitizeErrorDetail(err),
			ErrorCode:  "device_hello_failed",
			NextAction: "Keep VibeTV powered on, then run discovery again.",
		})
		writeJSON(w, http.StatusOK, diagnosticsResponse{
			OK:          true,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
			Companion:   s.companionInfo(r.Context()),
			Device:      device,
			Checks:      checks,
		})
		return
	}

	device = s.withDisplayStream(r.Context(), cfg.DeviceTarget, deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello))
	checks = append(checks, diagnosticCheck{
		Name:   "device_hello",
		Status: "pass",
		Detail: "VibeTV /hello is reachable.",
	})
	health, err := s.getHealthProbe(r.Context(), cfg.DeviceTarget, probeToken, deviceHealthProbeTime)
	if err != nil {
		device = withDeviceHealthProbeError(device, err)
		checks = append(checks, diagnosticCheck{
			Name:       "device_health",
			Status:     "attention",
			Detail:     sanitizeErrorDetail(err),
			ErrorCode:  "device_health_failed",
			NextAction: "Read-only device discovery works; retry settings or check firmware health.",
		})
	} else {
		device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, probeToken, false)
		checks = append(checks, diagnosticCheck{
			Name:   "device_health",
			Status: "pass",
			Detail: "VibeTV /health is reachable.",
		})
		if device.Display != nil && device.Display.ThemeSpec != nil && device.Display.ThemeSpec.RenderOK != nil {
			spec := device.Display.ThemeSpec
			if *spec.RenderOK {
				checks = append(checks, diagnosticCheck{
					Name:   "display_render",
					Status: "pass",
					Detail: renderHealthDiagnosticDetail(spec),
				})
			} else {
				checks = append(checks, diagnosticCheck{
					Name:       "display_render",
					Status:     "fail",
					Detail:     renderHealthDiagnosticDetail(spec),
					ErrorCode:  "display_render_failed",
					NextAction: "Reload the VibeTV image from Control Center.",
				})
			}
		}
	}
	if device.Stream != nil && device.Stream.Healthy {
		checks = append(checks, diagnosticCheck{
			Name:   "display_stream",
			Status: "pass",
			Detail: device.Stream.Detail,
		})
	} else {
		checks = append(checks, diagnosticCheck{
			Name:       "display_stream",
			Status:     "fail",
			Detail:     displayStreamDiagnosticDetail(device.Stream),
			ErrorCode:  "display_stream_not_ready",
			NextAction: "Click Fix connection to restart the display stream.",
		})
	}
	if updateJob, ok := s.latestFirmwareUpdateJob(); ok {
		checks = append(checks, diagnosticCheck{
			Name:       "firmware_update",
			Status:     firmwareUpdateDiagnosticStatus(updateJob),
			Detail:     firmwareUpdateDiagnosticDetail(updateJob),
			ErrorCode:  firmwareUpdateDiagnosticErrorCode(updateJob),
			NextAction: firmwareUpdateDiagnosticNextAction(updateJob),
		})
	}

	writeJSON(w, http.StatusOK, diagnosticsResponse{
		OK:          true,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Companion:   s.companionInfo(r.Context()),
		Device:      device,
		Checks:      checks,
	})
}

func (s *Server) companionInfo(ctx context.Context) companion {
	return companion{
		Status:           "ready",
		Version:          buildinfo.NormalizedVersion(),
		InstallationMode: s.installationMode,
		Update:           s.macAppReleaseInfo(ctx),
		Features: companionFeatures{
			ThemeInstallEnabled:     themeInstallEnabled(),
			MacAppSelfUpdateEnabled: s.allowMacAppSelfUpdate,
		},
	}
}

func (s *Server) macAppReleaseInfo(ctx context.Context) companionReleaseInfo {
	installedVersion := normalizeMacAppReleaseVersion(buildinfo.NormalizedVersion())
	now := time.Now().UTC()

	s.macAppReleaseMu.Lock()
	if s.macAppReleaseChecked &&
		s.macAppReleaseCache.InstalledVersion == installedVersion &&
		now.Sub(s.macAppReleaseCheckedAt) >= 0 &&
		now.Sub(s.macAppReleaseCheckedAt) < macAppReleaseCheckGap {
		cached := s.macAppReleaseCache
		s.macAppReleaseMu.Unlock()
		return cached
	}
	s.macAppReleaseMu.Unlock()

	checkedAt := now.Format(time.RFC3339)
	info := companionReleaseInfo{
		CheckedAt:        checkedAt,
		Status:           "check_failed",
		InstalledVersion: installedVersion,
		UpdateAvailable:  false,
		Message:          "Mac App check failed.",
	}

	if macAppReleaseCheckDisabled() {
		info.Status = "disabled"
		info.Message = "Mac App update check is disabled."
		s.cacheMacAppReleaseInfo(now, info)
		return info
	}

	fetch := s.fetchMacAppRelease
	if fetch == nil {
		fetch = fetchLatestMacAppRelease
	}
	checkCtx, cancel := context.WithTimeout(ctx, macAppReleaseTimeout)
	defer cancel()
	release, err := fetch(checkCtx)
	if err != nil {
		s.cacheMacAppReleaseInfo(now, info)
		return info
	}

	releaseTag := strings.TrimSpace(release.TagName)
	latestVersion := normalizeMacAppReleaseVersion(releaseTag)
	if latestVersion == "" {
		info.Release = releaseTag
		s.cacheMacAppReleaseInfo(now, info)
		return info
	}

	updateAvailable := installedVersion != "" && compareMacAppReleaseVersions(latestVersion, installedVersion) > 0
	info = companionReleaseInfo{
		CheckedAt:        checkedAt,
		Status:           "available",
		Release:          releaseTag,
		LatestVersion:    latestVersion,
		InstalledVersion: installedVersion,
		UpdateAvailable:  updateAvailable,
		Message:          "Mac App is up to date.",
	}
	if updateAvailable {
		info.Message = "Mac App update is available."
	}
	s.cacheMacAppReleaseInfo(now, info)
	return info
}

func (s *Server) cacheMacAppReleaseInfo(checkedAt time.Time, info companionReleaseInfo) {
	s.macAppReleaseMu.Lock()
	defer s.macAppReleaseMu.Unlock()
	s.macAppReleaseChecked = true
	s.macAppReleaseCheckedAt = checkedAt
	s.macAppReleaseCache = info
}

func macAppReleaseCheckDisabled() bool {
	value := strings.TrimSpace(os.Getenv(macAppReleaseAPIEnvVar))
	return value == "-" || strings.EqualFold(value, "off") || strings.EqualFold(value, "disabled")
}

func fetchLatestMacAppRelease(ctx context.Context) (githubRelease, error) {
	releaseURL := strings.TrimSpace(os.Getenv(macAppReleaseAPIEnvVar))
	if releaseURL == "" {
		releaseURL = macAppReleaseAPIURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseURL, nil)
	if err != nil {
		return githubRelease{}, fmt.Errorf("build mac app release request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "vibetv-mac-app")

	client := http.Client{Timeout: macAppReleaseTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return githubRelease{}, fmt.Errorf("fetch mac app release: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return githubRelease{}, fmt.Errorf("fetch mac app release: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var release githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(&release); err != nil {
		return githubRelease{}, fmt.Errorf("decode mac app release: %w", err)
	}
	return release, nil
}

func normalizeMacAppReleaseVersion(raw string) string {
	version := strings.TrimSpace(raw)
	version = strings.TrimPrefix(version, "v")
	version = strings.TrimPrefix(version, "V")
	if !macAppUpdateVersionPattern.MatchString(version) {
		return ""
	}
	return version
}

func compareMacAppReleaseVersions(left, right string) int {
	leftParts, leftOK := parseMacAppReleaseVersion(left)
	rightParts, rightOK := parseMacAppReleaseVersion(right)
	if !leftOK || !rightOK {
		return 0
	}
	for i := 0; i < 3; i++ {
		if leftParts[i] > rightParts[i] {
			return 1
		}
		if leftParts[i] < rightParts[i] {
			return -1
		}
	}
	return 0
}

func parseMacAppReleaseVersion(version string) ([3]int, bool) {
	var parts [3]int
	normalized := normalizeMacAppReleaseVersion(version)
	if normalized == "" {
		return parts, false
	}
	core := strings.SplitN(normalized, "-", 2)[0]
	segments := strings.Split(core, ".")
	if len(segments) != 3 {
		return parts, false
	}
	for i, segment := range segments {
		value, err := strconv.Atoi(segment)
		if err != nil {
			return parts, false
		}
		parts[i] = value
	}
	return parts, true
}

func usageResponseFromPersisted(now time.Time, usage daemon.PersistedUsage) usageResponse {
	providers := make([]usageProviderInfo, 0, len(usage.Providers))
	for _, provider := range usage.Providers {
		if info, ok := usageProviderFromSnapshot(provider); ok {
			providers = append(providers, info)
		}
	}
	resp := emptyUsageResponse(now, "codexbar-display")
	resp.CurrentProvider = strings.TrimSpace(usage.CurrentProvider)
	resp.Providers = providers
	resp.UsageMode = usageModeForProviders(providers)
	if resp.CurrentProvider == "" && len(providers) > 0 {
		resp.CurrentProvider = providers[0].ID
	}
	return resp
}

func usageResponseFromParsed(now time.Time, parsed []codexbar.ParsedFrame) usageResponse {
	providers := make([]usageProviderInfo, 0, len(parsed))
	for _, provider := range parsed {
		if info, ok := usageProviderFromParsed(provider); ok {
			providers = append(providers, info)
		}
	}
	resp := emptyUsageResponse(now, "codexbar")
	resp.Providers = providers
	resp.UsageMode = usageModeForProviders(providers)
	if len(providers) > 0 {
		resp.CurrentProvider = providers[0].ID
	}
	return resp
}

func emptyUsageResponse(now time.Time, source string) usageResponse {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	return usageResponse{
		OK:          true,
		GeneratedAt: now.UTC().Format(time.RFC3339),
		Source:      strings.TrimSpace(source),
		UsageMode:   "used",
		Providers:   []usageProviderInfo{},
	}
}

func usageResponseHasFreshProvider(resp usageResponse) bool {
	for _, provider := range resp.Providers {
		if !provider.Stale {
			return true
		}
	}
	return false
}

func usageProviderFromSnapshot(snapshot daemon.ProviderUsageSnapshot) (usageProviderInfo, bool) {
	frame := snapshot.Frame.Normalize()
	if strings.TrimSpace(frame.Error) != "" {
		return usageProviderInfo{}, false
	}
	id := usageProviderID(snapshot.Provider, frame.Provider)
	if id == "" {
		return usageProviderInfo{}, false
	}
	return usageProviderInfo{
		ID:                 id,
		Label:              usageProviderLabel(id, frame.Label),
		Source:             strings.TrimSpace(snapshot.Source),
		Session:            frame.Session,
		Weekly:             frame.Weekly,
		ResetSec:           frame.ResetSec,
		UsageMode:          usageModeOrDefault(frame.UsageMode),
		SessionTokens:      frame.SessionTokens,
		WeekTokens:         frame.WeekTokens,
		TotalTokens:        frame.TotalTokens,
		Activity:           strings.TrimSpace(frame.Activity),
		Stale:              snapshot.Stale,
		CollectedAt:        formatOptionalTime(snapshot.CollectedAt),
		ActivityObservedAt: formatOptionalTime(snapshot.ActivityObservedAt),
		Windows:            usageWindowsFromMeta(snapshot.Meta),
		Status:             usageStatusFromMeta(snapshot.Meta),
		Credits:            usageCreditsFromMeta(snapshot.Meta),
		ResetCredits:       usageResetCreditsFromMeta(snapshot.Meta),
		Cost:               usageCostFromMeta(snapshot.Meta),
		Pace:               usagePaceFromMeta(snapshot.Meta),
		UsageOverTime:      usageOverTimeFromMeta(snapshot.Meta),
	}, true
}

func usageProviderFromParsed(parsed codexbar.ParsedFrame) (usageProviderInfo, bool) {
	frame := parsed.Frame.Normalize()
	if strings.TrimSpace(frame.Error) != "" {
		return usageProviderInfo{}, false
	}
	id := usageProviderID(parsed.Provider, frame.Provider)
	if id == "" {
		return usageProviderInfo{}, false
	}
	return usageProviderInfo{
		ID:                 id,
		Label:              usageProviderLabel(id, frame.Label),
		Source:             strings.TrimSpace(parsed.Source),
		Session:            frame.Session,
		Weekly:             frame.Weekly,
		ResetSec:           frame.ResetSec,
		UsageMode:          usageModeOrDefault(frame.UsageMode),
		SessionTokens:      frame.SessionTokens,
		WeekTokens:         frame.WeekTokens,
		TotalTokens:        frame.TotalTokens,
		Activity:           strings.TrimSpace(frame.Activity),
		Stale:              parsed.Stale,
		CollectedAt:        formatOptionalTime(parsed.CollectedAt),
		ActivityObservedAt: formatOptionalTime(parsed.ActivityObservedAt),
		Windows:            usageWindowsFromMeta(parsed.Meta),
		Status:             usageStatusFromMeta(parsed.Meta),
		Credits:            usageCreditsFromMeta(parsed.Meta),
		ResetCredits:       usageResetCreditsFromMeta(parsed.Meta),
		Cost:               usageCostFromMeta(parsed.Meta),
		Pace:               usagePaceFromMeta(parsed.Meta),
		UsageOverTime:      usageOverTimeFromMeta(parsed.Meta),
	}, true
}

func usageWindowsFromMeta(meta codexbar.ProviderUsageMeta) []usageWindowInfo {
	if len(meta.Windows) == 0 {
		return nil
	}
	out := make([]usageWindowInfo, 0, len(meta.Windows))
	for _, window := range meta.Windows {
		id := strings.TrimSpace(strings.ToLower(window.ID))
		label := strings.TrimSpace(window.Label)
		if id == "" || label == "" {
			continue
		}
		out = append(out, usageWindowInfo{
			ID:            id,
			Label:         label,
			UsedPercent:   clampUsagePercent(window.UsedPercent),
			ResetSec:      window.ResetSec,
			WindowMinutes: window.WindowMinutes,
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func usageStatusFromMeta(meta codexbar.ProviderUsageMeta) *usageStatusInfo {
	if meta.Status == nil {
		return nil
	}
	status := usageStatusInfo{
		Indicator:   strings.TrimSpace(meta.Status.Indicator),
		Description: strings.TrimSpace(meta.Status.Description),
		UpdatedAt:   formatOptionalTime(meta.Status.UpdatedAt),
		URL:         strings.TrimSpace(meta.Status.URL),
	}
	if status.Indicator == "" && status.Description == "" && status.UpdatedAt == "" && status.URL == "" {
		return nil
	}
	return &status
}

func usageCreditsFromMeta(meta codexbar.ProviderUsageMeta) *usageCreditsInfo {
	if meta.Credits == nil {
		return nil
	}
	return &usageCreditsInfo{
		Remaining: meta.Credits.Remaining,
		UpdatedAt: formatOptionalTime(meta.Credits.UpdatedAt),
	}
}

func usageResetCreditsFromMeta(meta codexbar.ProviderUsageMeta) *usageResetCreditsInfo {
	if meta.ResetCredits == nil {
		return nil
	}
	info := usageResetCreditsInfo{
		AvailableCount: meta.ResetCredits.AvailableCount,
		NextExpiresAt:  formatOptionalTime(meta.ResetCredits.NextExpiresAt),
		UpdatedAt:      formatOptionalTime(meta.ResetCredits.UpdatedAt),
	}
	if info.AvailableCount == 0 && info.NextExpiresAt == "" && info.UpdatedAt == "" {
		return nil
	}
	return &info
}

func usageCostFromMeta(meta codexbar.ProviderUsageMeta) *usageCostInfo {
	if meta.Cost == nil {
		return nil
	}
	cost := usageCostInfo{
		CurrencyCode:      strings.TrimSpace(meta.Cost.CurrencyCode),
		UpdatedAt:         formatOptionalTime(meta.Cost.UpdatedAt),
		TodayCostUSD:      meta.Cost.TodayCostUSD,
		Last30DaysCostUSD: meta.Cost.Last30DaysCostUSD,
		Last30DaysTokens:  meta.Cost.Last30DaysTokens,
		LatestTokens:      meta.Cost.LatestTokens,
		TopModel:          strings.TrimSpace(meta.Cost.TopModel),
		Daily:             usageCostDaysFromMeta(meta.Cost.Daily),
	}
	if cost.CurrencyCode == "" {
		cost.CurrencyCode = "USD"
	}
	if cost.TodayCostUSD <= 0 &&
		cost.Last30DaysCostUSD <= 0 &&
		cost.Last30DaysTokens <= 0 &&
		cost.LatestTokens <= 0 &&
		cost.TopModel == "" &&
		len(cost.Daily) == 0 {
		return nil
	}
	return &cost
}

func usageCostDaysFromMeta(days []codexbar.ProviderCostDay) []usageCostDayInfo {
	if len(days) == 0 {
		return nil
	}
	out := make([]usageCostDayInfo, 0, len(days))
	for _, day := range days {
		key := strings.TrimSpace(day.Day)
		if key == "" {
			continue
		}
		models := make([]usageCostModelInfo, 0, len(day.Models))
		for _, model := range day.Models {
			name := strings.TrimSpace(model.Name)
			if name == "" {
				continue
			}
			models = append(models, usageCostModelInfo{
				Name:        name,
				TotalTokens: model.TotalTokens,
				CostUSD:     model.CostUSD,
			})
		}
		out = append(out, usageCostDayInfo{
			Day:          key,
			TotalCostUSD: day.TotalCostUSD,
			TotalTokens:  day.TotalTokens,
			Models:       models,
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func usagePaceFromMeta(meta codexbar.ProviderUsageMeta) []usagePaceInfo {
	if len(meta.Pace) == 0 {
		return nil
	}
	out := make([]usagePaceInfo, 0, len(meta.Pace))
	for _, pace := range meta.Pace {
		window := strings.TrimSpace(strings.ToLower(pace.Window))
		if window == "" {
			continue
		}
		out = append(out, usagePaceInfo{
			Window:              window,
			Stage:               strings.TrimSpace(pace.Stage),
			DeltaPercent:        pace.DeltaPercent,
			ExpectedUsedPercent: clampUsagePercent(pace.ExpectedUsedPercent),
			WillLastToReset:     pace.WillLastToReset,
			ETASeconds:          pace.ETASeconds,
			Summary:             strings.TrimSpace(pace.Summary),
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func usageOverTimeFromMeta(meta codexbar.ProviderUsageMeta) []usageOverTimePointInfo {
	if len(meta.OverTime) == 0 {
		return nil
	}
	out := make([]usageOverTimePointInfo, 0, len(meta.OverTime))
	for _, point := range meta.OverTime {
		day := strings.TrimSpace(point.Day)
		if day == "" {
			continue
		}
		services := make([]usageServiceUsageInfo, 0, len(point.Services))
		for _, service := range point.Services {
			name := strings.TrimSpace(service.Service)
			if name == "" || service.CreditsUsed <= 0 {
				continue
			}
			services = append(services, usageServiceUsageInfo{
				Service:     name,
				CreditsUsed: service.CreditsUsed,
			})
		}
		out = append(out, usageOverTimePointInfo{
			Day:              day,
			TotalCreditsUsed: point.TotalCreditsUsed,
			Services:         services,
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func usageProviderID(values ...string) string {
	for _, value := range values {
		id := strings.TrimSpace(strings.ToLower(value))
		if id != "" {
			return id
		}
	}
	return ""
}

func usageProviderLabel(id string, label string) string {
	label = strings.TrimSpace(label)
	if label != "" {
		return label
	}
	if id == "" {
		return "Provider"
	}
	return strings.ToUpper(id[:1]) + id[1:]
}

func usageModeOrDefault(mode string) string {
	mode = strings.TrimSpace(strings.ToLower(mode))
	if mode == "remaining" {
		return "remaining"
	}
	return "used"
}

func usageModeForProviders(providers []usageProviderInfo) string {
	for _, provider := range providers {
		if provider.UsageMode != "" {
			return usageModeOrDefault(provider.UsageMode)
		}
	}
	return "used"
}

func usageResponseForDisplayMode(resp usageResponse, showUsed bool) usageResponse {
	targetMode := "used"
	if !showUsed {
		targetMode = "remaining"
	}
	for i := range resp.Providers {
		resp.Providers[i] = usageProviderForDisplayMode(resp.Providers[i], targetMode)
	}
	if len(resp.Providers) == 0 {
		resp.UsageMode = targetMode
	} else {
		resp.UsageMode = usageModeForProviders(resp.Providers)
	}
	return resp
}

func usageProviderForDisplayMode(provider usageProviderInfo, targetMode string) usageProviderInfo {
	currentMode := usageModeOrDefault(provider.UsageMode)
	if currentMode != targetMode {
		provider.Session = 100 - clampUsagePercent(provider.Session)
		provider.Weekly = 100 - clampUsagePercent(provider.Weekly)
		for i := range provider.Windows {
			provider.Windows[i].UsedPercent = 100 - clampUsagePercent(provider.Windows[i].UsedPercent)
		}
	}
	provider.UsageMode = usageModeOrDefault(targetMode)
	return provider
}

func clampUsagePercent(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func (s *Server) handleDeviceDiscover(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target string `json:"target"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	s.repairMu.Lock()
	defer s.repairMu.Unlock()
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	discoveryCfg := cfg
	discoveryCfg.DeviceToken = ""
	target, hello, err := s.discover(r.Context(), discoveryCfg, req.Target)
	if err != nil {
		writeDiscoveryError(w, err)
		return
	}
	cfg, err = s.updateConfig(func(current *runtimeconfig.Config) {
		current.DeviceTarget = target
	})
	if err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}{OK: true, Device: s.withDisplayStream(r.Context(), target, deviceFromHello(target, cfg.DeviceToken, hello))})
}

// handleDeviceSearch performs a read-only scan. Unlike the legacy discover
// action it intentionally does not select a target, pair, or persist config.
func (s *Server) handleDeviceSearch(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target string `json:"target"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	devices := s.searchDevices(r.Context(), cfg, strings.TrimSpace(req.Target))
	writeJSON(w, http.StatusOK, struct {
		OK      bool                `json:"ok"`
		Devices []deviceSearchEntry `json:"devices"`
	}{OK: true, Devices: devices})
}

func (s *Server) handleDeviceRepair(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target           string `json:"target"`
		ExpectedDeviceID string `json:"expectedDeviceId"`
		ForcePair        bool   `json:"forcePair"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	device, err := s.repairDevice(
		r.Context(),
		strings.TrimSpace(req.Target),
		strings.TrimSpace(req.ExpectedDeviceID),
		req.ForcePair,
	)
	if err != nil {
		writeRepairError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deviceActionResponse{OK: true, Device: device})
}

func (s *Server) handleDeviceReloadDisplay(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	s.repairMu.Lock()
	defer s.repairMu.Unlock()
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	if strings.TrimSpace(cfg.DeviceToken) == "" {
		writeError(
			w,
			http.StatusForbidden,
			"pairing_required",
			"VibeTV pairing is required before reloading the image.",
			"Pair VibeTV, then retry.",
		)
		return
	}
	s.clearDisplayVerification(cfg.DeviceTarget)
	baseline, err := s.captureDisplayRenderBaseline(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"display_reload_failed",
			"Could not read the current VibeTV screen state.",
			"Keep VibeTV powered on, then press Reload image again.",
		)
		return
	}
	streamStartedAt := time.Now().UTC()
	if err := s.startDisplayStream(r.Context(), cfg.DeviceTarget); err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"display_reload_failed",
			"Could not reload the VibeTV image.",
			"Keep VibeTV powered on, then retry.",
		)
		return
	}
	stream := s.waitForFreshDisplayStream(r.Context(), cfg.DeviceTarget, streamStartedAt)
	device := withDisplayStreamInfo(deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello), stream)
	health, err := s.waitForVerifiedDisplayRender(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, baseline, stream)
	if err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"display_reload_failed",
			"Could not reload the VibeTV image.",
			"Keep VibeTV powered on, then press Reload image again.",
		)
		return
	}
	device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, cfg.DeviceToken, true)
	if !device.Ready {
		writeError(
			w,
			http.StatusBadGateway,
			"display_reload_failed",
			"VibeTV did not render a fresh image.",
			"Keep VibeTV powered on, then press Reload image again.",
		)
		return
	}
	writeJSON(w, http.StatusOK, deviceActionResponse{OK: true, Device: device})
}

func (s *Server) handleSetupReset(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	s.repairMu.Lock()
	defer s.repairMu.Unlock()
	_, err := s.updateConfig(func(cfg *runtimeconfig.Config) {
		cfg.DeviceTarget = ""
		cfg.DeviceToken = ""
		cfg.DeviceID = ""
	})
	if err != nil {
		writeInternalError(w, err)
		return
	}
	s.clearDisplayVerification("")
	writeJSON(w, http.StatusOK, statusResponse{
		OK:        true,
		Companion: s.companionInfo(r.Context()),
		Device:    deviceInfo{Connected: false},
	})
}

func (s *Server) handleDevice(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	device := s.withDisplayStream(r.Context(), cfg.DeviceTarget, deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello))
	if health, err := s.getHealthProbe(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, deviceHealthProbeTime); err == nil {
		device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, cfg.DeviceToken, false)
	} else {
		device = withDeviceHealthProbeError(device, err)
	}
	writeJSON(w, http.StatusOK, struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}{OK: true, Device: device})
}

func (s *Server) handleDevicePair(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target string `json:"target"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	s.repairMu.Lock()
	defer s.repairMu.Unlock()
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	requestedTarget := strings.TrimSpace(req.Target)
	target := requestedTarget
	if requestedTarget != "" {
		normalizedTarget, targetErr := normalizeExplicitDeviceTarget(requestedTarget)
		if targetErr != nil {
			writeInvalidDeviceTarget(w)
			return
		}
		target = normalizedTarget
	}
	if target == "" {
		target = strings.TrimSpace(cfg.DeviceTarget)
	}
	if target == "" {
		discoveredTarget, _, discoverErr := s.discover(r.Context(), cfg, "")
		if discoverErr != nil {
			writeDiscoveryError(w, discoverErr)
			return
		}
		target = discoveredTarget
	}
	token, err := s.pair(r.Context(), target)
	if err != nil && requestedTarget == "" {
		discoveredTarget, _, discoverErr := s.discover(r.Context(), cfg, "")
		if discoverErr != nil {
			writeDiscoveryError(w, discoverErr)
			return
		}
		if discoveredTarget != target {
			target = discoveredTarget
			token, err = s.pair(r.Context(), target)
		}
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "pair_failed", "VibeTV pairing failed.", "Keep VibeTV powered on, then retry pairing.")
		return
	}
	hello, _ := s.getHello(r.Context(), target, token)
	cfg, err = s.updateConfig(func(current *runtimeconfig.Config) {
		current.DeviceTarget = target
		current.DeviceToken = token
		current.DeviceID = strings.TrimSpace(hello.DeviceID)
	})
	if err != nil {
		writeInternalError(w, err)
		return
	}
	s.clearDisplayVerification(target)
	baseline, err := s.captureDisplayRenderBaseline(r.Context(), target, token)
	if err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"display_render_not_ready",
			"Mac App could not read the current VibeTV screen state.",
			"Keep VibeTV powered on, then retry pairing.",
		)
		return
	}
	streamStartedAt := time.Now().UTC()
	if err := s.startDisplayStream(r.Context(), target); err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"display_stream_start_failed",
			"Mac App could not start the VibeTV display stream.",
			"Run the manual Mac App setup command, then retry VibeTV connection.",
		)
		return
	}
	stream := s.waitForFreshDisplayStreamAfterPair(r.Context(), target, streamStartedAt)
	device := withDisplayStreamInfo(deviceFromHello(target, token, hello), stream)
	health, err := s.waitForVerifiedDisplayRender(r.Context(), target, token, baseline, stream)
	if err != nil {
		if !stream.Healthy {
			writeError(
				w,
				http.StatusBadGateway,
				"display_stream_not_ready",
				"VibeTV has not received its first image yet.",
				"Keep VibeTV powered on, then retry pairing.",
			)
			return
		}
		writeError(
			w,
			http.StatusBadGateway,
			"display_render_not_ready",
			"VibeTV has not rendered its first image yet.",
			"Keep VibeTV powered on, then retry pairing.",
		)
		return
	}
	device = s.withVerifiedDeviceHealth(device, health, target, token, true)
	if !device.Ready {
		writeError(
			w,
			http.StatusBadGateway,
			"display_render_not_ready",
			"VibeTV has not rendered its first image yet.",
			"Keep VibeTV powered on, then retry pairing.",
		)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}{OK: true, Device: device})
}

func (s *Server) repairDevice(
	ctx context.Context,
	requestedTarget string,
	expectedDeviceID string,
	forcePair bool,
) (deviceInfo, error) {
	key := fmt.Sprintf(
		"%t|%s|%s",
		forcePair,
		strings.ToLower(strings.TrimSpace(requestedTarget)),
		strings.ToLower(strings.TrimSpace(expectedDeviceID)),
	)
	s.repairFlightsMu.Lock()
	if s.repairFlights == nil {
		s.repairFlights = make(map[string]*deviceRepairFlight)
	}
	if active := s.repairFlights[key]; active != nil {
		s.repairFlightsMu.Unlock()
		select {
		case <-active.done:
			return active.device, active.err
		case <-ctx.Done():
			return deviceInfo{}, ctx.Err()
		}
	}
	flight := &deviceRepairFlight{done: make(chan struct{})}
	s.repairFlights[key] = flight
	s.repairFlightsMu.Unlock()

	flight.device, flight.err = s.repairDeviceOnce(ctx, requestedTarget, expectedDeviceID, forcePair)
	s.repairFlightsMu.Lock()
	delete(s.repairFlights, key)
	close(flight.done)
	s.repairFlightsMu.Unlock()
	return flight.device, flight.err
}

func (s *Server) repairDeviceOnce(
	ctx context.Context,
	requestedTarget string,
	expectedDeviceID string,
	forcePair bool,
) (deviceInfo, error) {
	s.deviceMaintenanceMu.Lock()
	defer s.deviceMaintenanceMu.Unlock()

	s.repairMu.Lock()
	defer s.repairMu.Unlock()

	streamPaused := false
	pauseStream := func() {
		if streamPaused || s.pauseDisplayStream == nil {
			return
		}
		s.pauseDisplayStream(true)
		streamPaused = true
	}
	resumeStream := func() {
		if !streamPaused || s.pauseDisplayStream == nil {
			return
		}
		s.pauseDisplayStream(false)
		streamPaused = false
	}
	pauseStream()
	defer resumeStream()

	cfg, err := s.config()
	if err != nil {
		return deviceInfo{}, &repairStageError{stage: "config", err: err}
	}
	discoveryCfg := cfg
	if forcePair {
		discoveryCfg.DeviceToken = ""
	}
	target, hello, err := s.discoverRepairTarget(ctx, discoveryCfg, requestedTarget)
	tokenStale := false
	if err != nil && !forcePair && strings.TrimSpace(cfg.DeviceToken) != "" {
		discoveryCfg = cfg
		discoveryCfg.DeviceToken = ""
		target, hello, err = s.discoverRepairTarget(ctx, discoveryCfg, requestedTarget)
		if err == nil {
			tokenStale = true
		}
	}
	if err != nil {
		return deviceInfo{}, err
	}
	if err := validateRepairIdentity(
		cfg,
		hello,
		strings.TrimSpace(requestedTarget) != "",
		expectedDeviceID,
	); err != nil {
		return deviceInfo{}, err
	}

	token := strings.TrimSpace(cfg.DeviceToken)
	pairedDuringRepair := false
	if forcePair || token == "" || tokenStale {
		token, err = s.pair(ctx, target)
		if err != nil {
			return deviceInfo{}, &repairStageError{stage: "pair", err: err}
		}
		pairedDuringRepair = true
	}

	cfg, err = s.updateConfig(func(current *runtimeconfig.Config) {
		current.DeviceTarget = target
		current.DeviceToken = token
		current.DeviceID = strings.TrimSpace(hello.DeviceID)
	})
	if err != nil {
		return deviceInfo{}, &repairStageError{stage: "config", err: err}
	}
	s.clearDisplayVerification(target)
	baseline, err := s.captureDisplayRenderBaseline(ctx, target, token)
	if err != nil {
		return deviceInfo{}, &repairStageError{stage: "display-render", err: err}
	}
	resumeStream()
	streamStartedAt := time.Now().UTC()
	if err := s.startDisplayStream(ctx, target); err != nil {
		return deviceInfo{}, &repairStageError{stage: "display-stream", err: err}
	}
	var stream displayStreamInfo
	if pairedDuringRepair {
		stream = s.waitForFreshDisplayStreamAfterPair(ctx, target, streamStartedAt)
	} else {
		stream = s.waitForFreshDisplayStream(ctx, target, streamStartedAt)
	}
	if !stream.Healthy && stream.ErrorCode == "device_pairing_required" && !pairedDuringRepair {
		pauseStream()
		token, err = s.pair(ctx, target)
		if err != nil {
			return deviceInfo{}, &repairStageError{stage: "pair", err: err}
		}
		cfg, err = s.updateConfig(func(current *runtimeconfig.Config) {
			current.DeviceTarget = target
			current.DeviceToken = token
		})
		if err != nil {
			return deviceInfo{}, &repairStageError{stage: "config", err: err}
		}
		baseline, err = s.captureDisplayRenderBaseline(ctx, target, token)
		if err != nil {
			return deviceInfo{}, &repairStageError{stage: "display-render", err: err}
		}
		resumeStream()
		streamStartedAt = time.Now().UTC()
		if err := s.startDisplayStream(ctx, target); err != nil {
			return deviceInfo{}, &repairStageError{stage: "display-stream", err: err}
		}
		stream = s.waitForFreshDisplayStreamAfterPair(ctx, target, streamStartedAt)
		pairedDuringRepair = true
	}
	if refreshedHello, err := s.getHello(ctx, target, token); err == nil {
		hello = refreshedHello
	}
	device := withDisplayStreamInfo(deviceFromHello(target, token, hello), stream)
	var health deviceHealth
	if activeThemeNeedsFullRepairRender(baseline) {
		pauseStream()
		health, err = s.reactivateCurrentThemeAndWaitForFullRender(
			ctx,
			target,
			token,
			baseline,
			stream,
		)
		resumeStream()
	} else {
		health, err = s.waitForVerifiedDisplayRender(ctx, target, token, baseline, stream)
		if activeThemeNeedsFullRepairRender(health) {
			pauseStream()
			health, err = s.reactivateCurrentThemeAndWaitForFullRender(
				ctx,
				target,
				token,
				health,
				stream,
			)
			resumeStream()
		}
	}
	if err != nil {
		if !stream.Healthy {
			return deviceInfo{}, &repairStageError{stage: "display-stream", err: errors.New(displayStreamDiagnosticDetail(streamPointer(stream)))}
		}
		return deviceInfo{}, &repairStageError{stage: "display-render", err: err}
	}
	device = s.withVerifiedDeviceHealth(device, health, target, token, true)
	if !device.Ready {
		return deviceInfo{}, &repairStageError{stage: "display-render", err: errors.New("device is reachable but not ready")}
	}
	return device, nil
}

func (s *Server) discoverRepairTarget(ctx context.Context, cfg runtimeconfig.Config, requestedTarget string) (string, protocol.DeviceHello, error) {
	var lastErr error
	for _, candidate := range s.repairTargetCandidates(cfg, requestedTarget) {
		target, hello, err := s.discoverForRepair(ctx, cfg, candidate)
		if err == nil {
			return target, hello, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no device candidates")
	}
	return "", protocol.DeviceHello{}, lastErr
}

func (s *Server) repairTargetCandidates(cfg runtimeconfig.Config, requestedTarget string) []string {
	requestedTarget = strings.TrimSpace(requestedTarget)
	if requestedTarget != "" {
		return []string{requestedTarget}
	}
	candidates := []string{strings.TrimSpace(cfg.DeviceTarget)}
	if strings.TrimSpace(cfg.DeviceTarget) == "" {
		candidates = append(candidates, s.recoveredDeviceTargets()...)
	}
	return append(uniqueStrings(candidates...), "")
}

func (s *Server) discoverForRepair(ctx context.Context, cfg runtimeconfig.Config, requestedTarget string) (string, protocol.DeviceHello, error) {
	requestedTarget = strings.TrimSpace(requestedTarget)
	attempts := 1
	if requestedTarget != "" || strings.TrimSpace(cfg.DeviceToken) == "" {
		attempts = repairDiscoveryAttempts
	}

	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		target, hello, err := s.discover(ctx, cfg, requestedTarget)
		if err == nil {
			return target, hello, nil
		}
		lastErr = err
		if !repairDiscoveryErrorIsRetryable(err) || attempt == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return "", protocol.DeviceHello{}, ctx.Err()
		case <-time.After(repairDiscoveryRetryGap):
		}
	}
	return "", protocol.DeviceHello{}, lastErr
}

func (s *Server) recoveredDeviceTargets() []string {
	candidates := []string{}
	if _, target := lastDisplayStreamFrame(s.recoveryDisplayStreamOutLogPath()); strings.TrimSpace(target) != "" {
		candidates = append(candidates, target)
	}
	candidates = append(candidates, s.recoveredConfigDeviceTargets()...)
	normalized := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		target, err := normalizeExplicitDeviceTarget(candidate)
		if err == nil {
			normalized = append(normalized, target)
		}
	}
	return uniqueStrings(normalized...)
}

func (s *Server) recoveryDisplayStreamOutLogPath() string {
	return runtimepaths.DisplayStreamOutLog(s.home)
}

func (s *Server) recoveredConfigDeviceTargets() []string {
	home := strings.TrimSpace(s.home)
	if home == "" {
		return nil
	}
	configDir := filepath.Dir(runtimeconfig.ConfigPath(home))
	patterns := []string{
		"config.before-*.json",
		"config.backup-*.json",
		"config.json.backup-*",
	}
	type candidateFile struct {
		path    string
		modTime time.Time
	}
	files := []candidateFile{}
	for _, pattern := range patterns {
		matches, err := filepath.Glob(filepath.Join(configDir, pattern))
		if err != nil {
			continue
		}
		for _, match := range matches {
			info, err := os.Stat(match)
			if err != nil || info.IsDir() {
				continue
			}
			files = append(files, candidateFile{path: match, modTime: info.ModTime()})
		}
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].modTime.Equal(files[j].modTime) {
			return files[i].path > files[j].path
		}
		return files[i].modTime.After(files[j].modTime)
	})

	targets := make([]string, 0, len(files))
	for _, file := range files {
		raw, err := os.ReadFile(file.path)
		if err != nil {
			continue
		}
		var cfg runtimeconfig.Config
		if err := json.Unmarshal(raw, &cfg); err != nil {
			continue
		}
		if strings.TrimSpace(cfg.DeviceTarget) != "" {
			targets = append(targets, cfg.DeviceTarget)
		}
	}
	return uniqueStrings(targets...)
}

func repairDiscoveryErrorIsRetryable(err error) bool {
	if err == nil {
		return false
	}
	var invalidTarget *invalidTargetError
	if errors.As(err, &invalidTarget) {
		return false
	}
	var multiple *multipleDevicesError
	return !errors.As(err, &multiple)
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleSettingsGet(w, r)
	case http.MethodPost:
		s.handleSettingsPost(w, r)
	default:
		writeMethodNotAllowed(w)
	}
}

func (s *Server) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	health, err := s.getHealth(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		writeError(w, http.StatusBadGateway, "settings_read_failed", "Could not read VibeTV settings.", "Keep VibeTV powered on and retry.")
		return
	}
	device := s.withVerifiedDeviceHealth(
		s.withDisplayStream(r.Context(), cfg.DeviceTarget, deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello)),
		health,
		cfg.DeviceTarget,
		cfg.DeviceToken,
		false,
	)
	writeJSON(w, http.StatusOK, settingsResponse{
		OK:       true,
		Settings: health.Settings,
		Device:   device,
	})
}

func (s *Server) handleSettingsPost(w http.ResponseWriter, r *http.Request) {
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	var req struct {
		BrightnessPercent int `json:"brightnessPercent"`
		Display           struct {
			BrightnessPercent int `json:"brightnessPercent"`
		} `json:"display"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	brightness := req.BrightnessPercent
	if brightness == 0 {
		brightness = req.Display.BrightnessPercent
	}
	caps := protocol.CapabilitiesFromHello(hello)
	if caps.Known && !caps.SupportsBrightness {
		writeError(w, http.StatusBadRequest, "brightness_unsupported", "This VibeTV does not advertise brightness control.", "Update firmware or use a device with brightness support.")
		return
	}
	minBrightness := protocol.DefaultMinBrightness
	maxBrightness := protocol.DefaultMaxBrightness
	if caps.SupportsBrightness {
		minBrightness = caps.MinBrightnessPercent
		maxBrightness = caps.MaxBrightnessPercent
	}
	if brightness < minBrightness || brightness > maxBrightness {
		writeError(w, http.StatusBadRequest, "invalid_brightness", fmt.Sprintf("Brightness must be between %d and %d.", minBrightness, maxBrightness), "Choose a supported brightness value and retry.")
		return
	}
	settings, err := s.updateBrightness(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, brightness)
	if err != nil {
		writeError(w, http.StatusBadGateway, "settings_write_failed", "Could not update VibeTV settings.", "Keep VibeTV powered on and retry.")
		return
	}
	device := s.withDisplayStream(r.Context(), cfg.DeviceTarget, deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello))
	if health, err := s.getHealth(r.Context(), cfg.DeviceTarget, cfg.DeviceToken); err == nil {
		device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, cfg.DeviceToken, false)
	}
	writeJSON(w, http.StatusOK, settingsResponse{
		OK:       true,
		Settings: settings,
		Device:   device,
	})
}

func (s *Server) handleThemeInstall(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req themeInstallRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.ThemeID) == "" && strings.TrimSpace(req.PackURL) == "" {
		writeError(w, http.StatusBadRequest, "missing_theme_source", "themeId or packUrl is required.", "Select a theme and retry.")
		return
	}
	if !validRemoteThemePackURL(req.PackURL) {
		writeError(
			w,
			http.StatusBadRequest,
			"invalid_theme_pack_url",
			"Theme pack URL is invalid.",
			"Fix the Shopify theme pack URL to an http(s) download URL, then reload the catalog.",
		)
		return
	}
	if !themeInstallEnabled() {
		writeError(
			w,
			http.StatusForbidden,
			"theme_install_disabled",
			"Theme install is disabled for this Companion build.",
			"Unset VIBETV_DISABLE_WIFI_THEME_INSTALL, then restart the Mac App.",
		)
		return
	}
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	if !s.requireThemeInstallPreflight(w, r, cfg, hello) {
		return
	}
	if req.Async {
		job := s.createThemeInstallJob()
		s.startThemeInstallJob(r.Context(), job.ID, cfg, req)
		writeJSON(w, http.StatusAccepted, themeInstallJobResponse{OK: true, Job: job})
		return
	}

	var installLog bytes.Buffer
	result, err := s.runThemeInstall(r.Context(), cfg, req, &installLog)
	if err != nil {
		writeThemeInstallError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK     bool                `json:"ok"`
		Result themeinstall.Result `json:"result"`
		Logs   []string            `json:"logs,omitempty"`
	}{OK: true, Result: result, Logs: splitInstallLog(installLog.String())})
}

func (s *Server) handleThemeInstallStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	jobID := strings.TrimSpace(r.URL.Query().Get("jobId"))
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "missing_install_job", "Theme install status is missing.", "Start theme install again.")
		return
	}
	job, ok := s.themeInstallJobSnapshot(jobID)
	if !ok {
		writeError(w, http.StatusNotFound, "install_job_not_found", "Theme install status was not found.", "Start theme install again.")
		return
	}
	writeJSON(w, http.StatusOK, themeInstallJobResponse{OK: true, Job: job})
}

func (s *Server) handleFirmwareLatest(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	board := strings.TrimSpace(r.URL.Query().Get("board"))
	installedFirmware := strings.TrimSpace(r.URL.Query().Get("firmware"))
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	if board == "" || installedFirmware == "" {
		writeJSON(w, http.StatusOK, firmwareLatestResponse{
			CheckedAt:         checkedAt,
			InstalledFirmware: installedFirmware,
			UpdateAvailable:   false,
			Status:            "missing_device_info",
			Message:           "VibeTV update info is not available yet.",
		})
		return
	}

	manifest, err := s.fetchFirmwareReleaseManifest(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, firmwareLatestResponse{
			CheckedAt:         checkedAt,
			InstalledFirmware: installedFirmware,
			UpdateAvailable:   false,
			Status:            "check_failed",
			Message:           "Firmware check failed.",
		})
		return
	}
	artifact := latestFirmwareArtifactForBoard(manifest, board)
	if strings.TrimSpace(artifact.FirmwareVersion) == "" {
		writeJSON(w, http.StatusOK, firmwareLatestResponse{
			CheckedAt:         checkedAt,
			InstalledFirmware: installedFirmware,
			Release:           manifest.Release,
			UpdateAvailable:   false,
			Status:            "no_board_release",
			Message:           "No update is available for this VibeTV.",
		})
		return
	}

	updateAvailable := firmwareVersionCompare(artifact.FirmwareVersion, installedFirmware) > 0
	message := "Firmware is up to date."
	status := "current"
	if updateAvailable {
		status = "update_available"
		message = strings.TrimSpace(artifact.Message)
		if message == "" {
			message = "Firmware update available."
		}
	}
	writeJSON(w, http.StatusOK, firmwareLatestResponse{
		CheckedAt:         checkedAt,
		InstalledFirmware: installedFirmware,
		LatestFirmware:    strings.TrimSpace(artifact.FirmwareVersion),
		Release:           manifest.Release,
		UpdateAvailable:   updateAvailable,
		Status:            status,
		Message:           message,
	})
}

func (s *Server) fetchFirmwareReleaseManifest(ctx context.Context) (firmwareReleaseManifest, error) {
	manifestURL := strings.TrimSpace(os.Getenv(firmwareManifestEnvVar))
	if manifestURL == "" {
		manifestURL = themeinstall.DefaultFirmwareManifestURL
	}
	ctx, cancel := context.WithTimeout(ctx, firmwareReleaseTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return firmwareReleaseManifest{}, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return firmwareReleaseManifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return firmwareReleaseManifest{}, fmt.Errorf("firmware manifest status %d", resp.StatusCode)
	}
	var manifest firmwareReleaseManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&manifest); err != nil {
		return firmwareReleaseManifest{}, err
	}
	return manifest, nil
}

func latestFirmwareArtifactForBoard(manifest firmwareReleaseManifest, board string) firmwareReleaseArtifact {
	normalizedBoard := strings.ToLower(strings.TrimSpace(board))
	var latest firmwareReleaseArtifact
	for _, artifact := range manifest.Artifacts {
		if strings.ToLower(strings.TrimSpace(artifact.Board)) != normalizedBoard {
			continue
		}
		if strings.TrimSpace(latest.FirmwareVersion) == "" ||
			firmwareVersionCompare(artifact.FirmwareVersion, latest.FirmwareVersion) > 0 {
			latest = artifact
		}
	}
	return latest
}

func firmwareVersionCompare(left, right string) int {
	leftVersion, leftErr := versioning.ParseSemVer(left)
	rightVersion, rightErr := versioning.ParseSemVer(right)
	if leftErr != nil || rightErr != nil {
		return strings.Compare(strings.TrimSpace(left), strings.TrimSpace(right))
	}
	return leftVersion.Compare(rightVersion)
}

func (s *Server) handleFirmwareUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req firmwareUpdateRequest
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	if strings.TrimSpace(cfg.DeviceToken) == "" {
		writeError(
			w,
			http.StatusForbidden,
			"pairing_required",
			"VibeTV pairing is required before updating.",
			"Pair VibeTV, then retry.",
		)
		return
	}
	caps := protocol.CapabilitiesFromHello(hello)
	if strings.TrimSpace(caps.Board) == "" || strings.TrimSpace(caps.Firmware) == "" {
		writeError(
			w,
			http.StatusBadGateway,
			"update_device_info_missing",
			"Could not read VibeTV update info.",
			"Keep VibeTV powered on, then retry.",
		)
		return
	}
	if active, ok := s.activeFirmwareUpdateJob(); ok {
		writeJSON(w, http.StatusAccepted, firmwareUpdateJobResponse{OK: true, Job: active})
		return
	}
	job := s.createFirmwareUpdateJob(cfg)
	s.startFirmwareUpdateJob(r.Context(), job.ID, cfg, req)
	writeJSON(w, http.StatusAccepted, firmwareUpdateJobResponse{OK: true, Job: job})
}

func (s *Server) handleFirmwareUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	jobID := strings.TrimSpace(r.URL.Query().Get("jobId"))
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "missing_update_job", "Update status is missing.", "Start the update again.")
		return
	}
	job, ok := s.firmwareUpdateJobSnapshot(jobID)
	if !ok {
		writeError(w, http.StatusNotFound, "update_job_not_found", "Update status was not found.", "Start the update again.")
		return
	}
	writeJSON(w, http.StatusOK, firmwareUpdateJobResponse{OK: true, Job: job})
}

func (s *Server) handleMacAppUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req macAppUpdateRequest
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	version, ok := normalizeMacAppUpdateVersion(req.Version)
	if !ok {
		writeError(
			w,
			http.StatusBadRequest,
			"invalid_mac_app_update_version",
			"Mac App update version is invalid.",
			"Check for updates again, then retry.",
		)
		return
	}
	req.Version = version
	if active, ok := s.activeMacAppUpdateJob(); ok {
		writeJSON(w, http.StatusAccepted, macAppUpdateJobResponse{OK: true, Job: active})
		return
	}
	job := s.createMacAppUpdateJob(req)
	s.startMacAppUpdateJob(r.Context(), job.ID, req)
	writeJSON(w, http.StatusAccepted, macAppUpdateJobResponse{OK: true, Job: job})
}

func (s *Server) handleMacAppUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	jobID := strings.TrimSpace(r.URL.Query().Get("jobId"))
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "missing_mac_app_update_job", "Mac App update status is missing.", "Start the Mac App update again.")
		return
	}
	job, ok := s.macAppUpdateJobSnapshot(jobID)
	if !ok {
		writeError(w, http.StatusNotFound, "mac_app_update_job_not_found", "Mac App update status was not found.", "Check the Mac App version again.")
		return
	}
	writeJSON(w, http.StatusOK, macAppUpdateJobResponse{OK: true, Job: job})
}

func (s *Server) runThemeInstall(ctx context.Context, cfg runtimeconfig.Config, req themeInstallRequest, out io.Writer) (themeinstall.Result, error) {
	s.deviceMaintenanceMu.Lock()
	defer s.deviceMaintenanceMu.Unlock()

	s.repairMu.Lock()
	defer s.repairMu.Unlock()

	streamPaused := false
	if s.pauseDisplayStream != nil {
		s.pauseDisplayStream(true)
		streamPaused = true
	}
	resumeStream := func() {
		if streamPaused && s.pauseDisplayStream != nil {
			s.pauseDisplayStream(false)
			streamPaused = false
		}
	}
	defer resumeStream()

	latestCfg, err := s.config()
	if err != nil {
		return themeinstall.Result{}, err
	}
	cfg = latestCfg
	if strings.TrimSpace(cfg.DeviceTarget) == "" || strings.TrimSpace(cfg.DeviceToken) == "" {
		return themeinstall.Result{}, &statusAPIError{
			status: http.StatusForbidden,
			api: apiError{
				Code:       "pairing_required",
				Message:    "VibeTV pairing is required before installing a theme.",
				NextAction: "Finish VibeTV setup, then retry the theme install.",
			},
		}
	}
	s.clearDisplayVerification(cfg.DeviceTarget)
	baseline, err := s.captureDisplayRenderBaseline(ctx, cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		return themeinstall.Result{}, &statusAPIError{
			status: http.StatusBadGateway,
			api: apiError{
				Code:       "display_render_failed",
				Message:    "Mac App could not read the current VibeTV screen state.",
				NextAction: "Keep VibeTV powered on, then retry the theme install.",
			},
		}
	}

	skipFirmwareUpdate := true
	if req.SkipFirmwareUpdate != nil {
		skipFirmwareUpdate = *req.SkipFirmwareUpdate
	}
	pairedDuringThemeInstall := false
	result, err := s.installTheme(ctx, themeinstall.Options{
		ThemeID:            strings.TrimSpace(req.ThemeID),
		PackURL:            strings.TrimSpace(req.PackURL),
		CatalogURL:         strings.TrimSpace(req.CatalogURL),
		Target:             targetWithToken(cfg.DeviceTarget, cfg.DeviceToken),
		SkipFirmwareUpdate: skipFirmwareUpdate,
		Verbose:            true,
		Out:                out,
		HTTPClient:         s.client,
		PairTokenStore: func(target, token string) error {
			pairedDuringThemeInstall = true
			target = normalizeTarget(target)
			updated, updateErr := s.updateConfig(func(current *runtimeconfig.Config) {
				if target != "" {
					current.DeviceTarget = target
				}
				current.DeviceToken = token
			})
			if updateErr == nil {
				cfg = updated
			}
			return updateErr
		},
	})
	if err != nil {
		return themeinstall.Result{}, err
	}
	fmt.Fprintln(out, "Refreshing display stream...")
	resumeStream()
	streamStartedAt := time.Now().UTC()
	if err := s.startDisplayStream(ctx, cfg.DeviceTarget); err != nil {
		return themeinstall.Result{}, &statusAPIError{
			status: http.StatusBadGateway,
			api: apiError{
				Code:       "display_stream_refresh_failed",
				Message:    "Theme installed, but Mac App could not refresh the VibeTV display.",
				NextAction: "Run setup again or restart the Mac App, then retry.",
			},
		}
	}
	var stream displayStreamInfo
	if pairedDuringThemeInstall {
		stream = s.waitForFreshDisplayStreamAfterPair(ctx, cfg.DeviceTarget, streamStartedAt)
	} else {
		stream = s.waitForFreshDisplayStream(ctx, cfg.DeviceTarget, streamStartedAt)
	}
	health, err := s.waitForVerifiedDisplayRender(ctx, cfg.DeviceTarget, cfg.DeviceToken, baseline, stream)
	if err != nil {
		if !stream.Healthy {
			return themeinstall.Result{}, &statusAPIError{
				status: http.StatusBadGateway,
				api: apiError{
					Code:       "display_stream_refresh_failed",
					Message:    "Theme installed, but Mac App did not send a fresh image to VibeTV.",
					NextAction: "Keep VibeTV powered on, then use Reload image in Control Center.",
				},
			}
		}
		return themeinstall.Result{}, &statusAPIError{
			status: http.StatusBadGateway,
			api: apiError{
				Code:       "display_render_failed",
				Message:    "Theme installed, but VibeTV could not redraw the image.",
				NextAction: "Use Reload image in Control Center. If it keeps failing, choose a lighter theme.",
			},
		}
	}
	device := withDisplayStreamInfo(deviceInfo{
		Target:    publicTarget(cfg.DeviceTarget),
		Connected: true,
		Paired:    true,
	}, stream)
	if !s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, cfg.DeviceToken, true).Ready {
		return themeinstall.Result{}, &statusAPIError{
			status: http.StatusBadGateway,
			api: apiError{
				Code:       "display_stream_refresh_failed",
				Message:    "Theme installed, but the continuous VibeTV display stream is not running.",
				NextAction: "Keep VibeTV powered on, then use Reload image in Control Center.",
			},
		}
	}
	fmt.Fprintln(out, "Display stream: refreshed and rendered")
	return result, nil
}

func (s *Server) createThemeInstallJob() themeInstallJob {
	s.installJobsMu.Lock()
	defer s.installJobsMu.Unlock()
	if s.installJobs == nil {
		s.installJobs = make(map[string]*themeInstallJob)
	}
	s.nextInstallJob++
	id := fmt.Sprintf("theme-install-%d-%d", time.Now().UnixNano(), s.nextInstallJob)
	job := &themeInstallJob{
		ID:        id,
		Phase:     "installing",
		Message:   "Preparing theme install.",
		Progress:  5,
		StartedAt: time.Now().UTC(),
		Logs:      []string{"Preparing theme install."},
	}
	s.installJobs[id] = job
	return cloneThemeInstallJob(job)
}

func (s *Server) startThemeInstallJob(_ context.Context, jobID string, cfg runtimeconfig.Config, req themeInstallRequest) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		writer := &themeInstallProgressWriter{server: s, jobID: jobID}
		result, err := s.runThemeInstall(ctx, cfg, req, writer)
		finishedAt := time.Now().UTC()
		if err != nil {
			_, apiErr := themeInstallErrorPayload(err)
			s.updateThemeInstallJob(jobID, func(job *themeInstallJob) {
				job.Phase = "error"
				job.Message = "Theme install failed."
				job.Progress = 100
				job.FinishedAt = &finishedAt
				job.Error = &apiErr
				appendInstallJobLog(job, "Theme install failed.")
			})
			return
		}
		s.updateThemeInstallJob(jobID, func(job *themeInstallJob) {
			job.Phase = "complete"
			job.Message = "Theme is active on VibeTV."
			job.Progress = 100
			job.FinishedAt = &finishedAt
			job.Result = &result
			appendInstallJobLog(job, "Theme is active on VibeTV.")
		})
	}()
}

func (s *Server) updateThemeInstallJob(jobID string, update func(*themeInstallJob)) {
	s.installJobsMu.Lock()
	defer s.installJobsMu.Unlock()
	if s.installJobs == nil {
		return
	}
	job := s.installJobs[jobID]
	if job == nil {
		return
	}
	update(job)
}

func (s *Server) themeInstallJobSnapshot(jobID string) (themeInstallJob, bool) {
	s.installJobsMu.Lock()
	defer s.installJobsMu.Unlock()
	job := s.installJobs[jobID]
	if job == nil {
		return themeInstallJob{}, false
	}
	return cloneThemeInstallJob(job), true
}

func cloneThemeInstallJob(job *themeInstallJob) themeInstallJob {
	if job == nil {
		return themeInstallJob{}
	}
	clone := *job
	clone.Logs = append([]string(nil), job.Logs...)
	if job.Result != nil {
		result := *job.Result
		clone.Result = &result
	}
	if job.Error != nil {
		apiErr := *job.Error
		clone.Error = &apiErr
	}
	if job.FinishedAt != nil {
		finishedAt := *job.FinishedAt
		clone.FinishedAt = &finishedAt
	}
	return clone
}

type themeInstallProgressWriter struct {
	server  *Server
	jobID   string
	pending string
}

func (w *themeInstallProgressWriter) Write(p []byte) (int, error) {
	text := w.pending + string(p)
	lines := strings.Split(text, "\n")
	if !strings.HasSuffix(text, "\n") {
		w.pending = lines[len(lines)-1]
		lines = lines[:len(lines)-1]
	} else {
		w.pending = ""
	}
	for _, line := range lines {
		w.noteLine(line)
	}
	return len(p), nil
}

func (w *themeInstallProgressWriter) noteLine(line string) {
	line = strings.TrimSpace(line)
	if line == "" || w.server == nil {
		return
	}
	w.server.updateThemeInstallJob(w.jobID, func(job *themeInstallJob) {
		message, progress, ok := customerInstallProgress(line, job)
		if !ok {
			return
		}
		job.Message = message
		if progress > job.Progress {
			job.Progress = progress
		}
		appendInstallJobLog(job, message)
	})
}

func customerInstallProgress(line string, job *themeInstallJob) (string, int, bool) {
	switch {
	case strings.HasPrefix(line, "Preparing theme:"):
		return "Preparing theme files.", 10, true
	case strings.HasPrefix(line, "Checking device"):
		return "Checking VibeTV.", 20, true
	case strings.HasPrefix(line, "Install screen: showing"):
		return "Showing install screen on VibeTV.", 30, true
	case strings.HasPrefix(line, "Upload interrupted"):
		return "Upload interrupted. Retrying.", maxInt(job.Progress, 40), true
	case strings.HasPrefix(line, "Retrying upload:"):
		return "Retrying theme file upload.", maxInt(job.Progress, 40), true
	case strings.HasPrefix(line, "Uploading theme files"):
		return "Uploading theme files.", 40, true
	case strings.HasPrefix(line, "Uploaded asset:"):
		job.uploads++
		return fmt.Sprintf("Uploaded theme file %d.", job.uploads), minInt(70, 40+job.uploads*6), true
	case strings.HasPrefix(line, "Uploaded theme spec:"):
		return "Uploaded theme layout.", 76, true
	case strings.HasPrefix(line, "Activating theme"):
		return "Activating theme.", 84, true
	case strings.HasPrefix(line, "Theme activation interrupted"):
		return "Theme activation interrupted. Retrying.", maxInt(job.Progress, 84), true
	case strings.HasPrefix(line, "Theme activation retry"):
		return "Retrying theme activation.", maxInt(job.Progress, 84), true
	case strings.HasPrefix(line, "Theme activation did not settle"):
		return "Waiting for VibeTV to apply theme.", maxInt(job.Progress, 86), true
	case strings.HasPrefix(line, "Live usage frame: refreshed"):
		return "Refreshing live usage.", 90, true
	case strings.HasPrefix(line, "Live usage frame: skipped"):
		return "Waiting for live usage.", 90, true
	case strings.HasPrefix(line, "Refreshing display stream"):
		return "Refreshing display stream.", 94, true
	case strings.HasPrefix(line, "Display stream: refreshed"):
		return "Display stream refreshed.", 98, true
	case strings.HasPrefix(line, "Done:"):
		return "Theme installed.", 88, true
	default:
		return "", 0, false
	}
}

func appendInstallJobLog(job *themeInstallJob, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	if len(job.Logs) > 0 && job.Logs[len(job.Logs)-1] == message {
		return
	}
	job.Logs = append(job.Logs, message)
	if len(job.Logs) > 12 {
		job.Logs = append([]string(nil), job.Logs[len(job.Logs)-12:]...)
	}
}

func (s *Server) activeFirmwareUpdateJob() (firmwareUpdateJob, bool) {
	s.updateJobsMu.Lock()
	defer s.updateJobsMu.Unlock()
	for _, job := range s.updateJobs {
		if job != nil && job.Phase == "installing" {
			return cloneFirmwareUpdateJob(job), true
		}
	}
	return firmwareUpdateJob{}, false
}

func (s *Server) latestFirmwareUpdateJob() (firmwareUpdateJob, bool) {
	s.updateJobsMu.Lock()
	defer s.updateJobsMu.Unlock()
	var latest *firmwareUpdateJob
	for _, job := range s.updateJobs {
		if job == nil {
			continue
		}
		if latest == nil || job.StartedAt.After(latest.StartedAt) {
			latest = job
		}
	}
	if latest == nil {
		return firmwareUpdateJob{}, false
	}
	return cloneFirmwareUpdateJob(latest), true
}

func (s *Server) createFirmwareUpdateJob(cfg runtimeconfig.Config) firmwareUpdateJob {
	s.updateJobsMu.Lock()
	defer s.updateJobsMu.Unlock()
	if s.updateJobs == nil {
		s.updateJobs = make(map[string]*firmwareUpdateJob)
	}
	s.nextUpdateJob++
	id := fmt.Sprintf("firmware-update-%d-%d", time.Now().UnixNano(), s.nextUpdateJob)
	job := &firmwareUpdateJob{
		ID:        id,
		Phase:     "installing",
		Message:   "Preparing VibeTV update.",
		Progress:  5,
		StartedAt: time.Now().UTC(),
		Logs:      []string{"Preparing VibeTV update."},
		target:    publicTarget(cfg.DeviceTarget),
	}
	s.updateJobs[id] = job
	return cloneFirmwareUpdateJob(job)
}

func (s *Server) startFirmwareUpdateJob(_ context.Context, jobID string, cfg runtimeconfig.Config, req firmwareUpdateRequest) {
	go func() {
		s.deviceMaintenanceMu.Lock()
		defer s.deviceMaintenanceMu.Unlock()

		s.firmwareUpdateActive.Store(true)
		if s.pauseDisplayStream != nil {
			s.pauseDisplayStream(true)
		}
		defer func() {
			s.firmwareUpdateActive.Store(false)
			if s.pauseDisplayStream != nil {
				s.pauseDisplayStream(false)
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), firmwareUpdateJobTime)
		defer cancel()
		writer := &firmwareUpdateProgressWriter{server: s, jobID: jobID}
		err := s.updateFirmware(ctx, s.home, cfg, req, writer)
		finishedAt := time.Now().UTC()
		if err != nil {
			if detail := sanitizeErrorDetail(err); detail != "" {
				_, _ = fmt.Fprintf(os.Stderr, "VibeTV firmware update failed: %s\n", detail)
			}
			apiErr := firmwareUpdateErrorPayload(err)
			s.updateFirmwareUpdateJob(jobID, func(job *firmwareUpdateJob) {
				job.Phase = "error"
				job.Message = "Update failed."
				job.Progress = 100
				job.FinishedAt = &finishedAt
				job.Error = &apiErr
				appendFirmwareUpdateJobLog(job, "Update failed.")
			})
			return
		}
		s.updateFirmwareUpdateJob(jobID, func(job *firmwareUpdateJob) {
			job.Phase = "complete"
			job.Message = "Update complete."
			job.Progress = 100
			job.FinishedAt = &finishedAt
			job.Result = &firmwareUpdateResult{
				Firmware: strings.TrimSpace(job.firmware),
				Target:   strings.TrimSpace(job.target),
			}
			appendFirmwareUpdateJobLog(job, "Update complete.")
		})
	}()
}

func (s *Server) updateFirmwareUpdateJob(jobID string, update func(*firmwareUpdateJob)) {
	s.updateJobsMu.Lock()
	defer s.updateJobsMu.Unlock()
	if s.updateJobs == nil {
		return
	}
	job := s.updateJobs[jobID]
	if job == nil {
		return
	}
	update(job)
}

func (s *Server) firmwareUpdateJobSnapshot(jobID string) (firmwareUpdateJob, bool) {
	s.updateJobsMu.Lock()
	defer s.updateJobsMu.Unlock()
	job := s.updateJobs[jobID]
	if job == nil {
		return firmwareUpdateJob{}, false
	}
	return cloneFirmwareUpdateJob(job), true
}

func cloneFirmwareUpdateJob(job *firmwareUpdateJob) firmwareUpdateJob {
	if job == nil {
		return firmwareUpdateJob{}
	}
	clone := *job
	clone.Logs = append([]string(nil), job.Logs...)
	if job.Result != nil {
		result := *job.Result
		clone.Result = &result
	}
	if job.Error != nil {
		apiErr := *job.Error
		clone.Error = &apiErr
	}
	if job.FinishedAt != nil {
		finishedAt := *job.FinishedAt
		clone.FinishedAt = &finishedAt
	}
	return clone
}

type firmwareUpdateProgressWriter struct {
	server  *Server
	jobID   string
	pending string
}

func (w *firmwareUpdateProgressWriter) Write(p []byte) (int, error) {
	text := w.pending + string(p)
	lines := strings.Split(text, "\n")
	if !strings.HasSuffix(text, "\n") {
		w.pending = lines[len(lines)-1]
		lines = lines[:len(lines)-1]
	} else {
		w.pending = ""
	}
	for _, line := range lines {
		w.noteLine(line)
	}
	return len(p), nil
}

func (w *firmwareUpdateProgressWriter) noteLine(line string) {
	line = strings.TrimSpace(line)
	if line == "" || w.server == nil {
		return
	}
	w.server.updateFirmwareUpdateJob(w.jobID, func(job *firmwareUpdateJob) {
		message, progress, ok := customerFirmwareUpdateProgress(line, job)
		if !ok {
			return
		}
		job.Message = message
		if progress > job.Progress {
			job.Progress = progress
		}
		appendFirmwareUpdateJobLog(job, message)
	})
}

func customerFirmwareUpdateProgress(line string, job *firmwareUpdateJob) (string, int, bool) {
	switch {
	case strings.HasPrefix(line, "Checking device"):
		return "Checking VibeTV.", 10, true
	case strings.HasPrefix(line, "Device:"):
		return "VibeTV is ready.", 18, true
	case strings.HasPrefix(line, "Checking firmware"):
		return "Checking update.", 25, true
	case strings.HasPrefix(line, "Firmware: already current"):
		return "VibeTV is already up to date.", 95, true
	case strings.HasPrefix(line, "Updating firmware:"):
		job.firmware = firmwareVersionFromUpdateLine(line)
		return "Preparing update.", 35, true
	case strings.HasPrefix(line, "Firmware downloaded:"):
		return "Update downloaded.", 45, true
	case strings.HasPrefix(line, "Pausing Mac App during firmware update"):
		return "Preparing VibeTV.", 50, true
	case strings.HasPrefix(line, "Uploading firmware"):
		return "Updating VibeTV.", 65, true
	case strings.HasPrefix(line, "Restarting VibeTV"):
		return "Restarting VibeTV.", 82, true
	case strings.HasPrefix(line, "Done: firmware"):
		job.firmware = firmwareVersionFromDoneLine(line)
		return "Checking result.", 96, true
	default:
		return "", 0, false
	}
}

func firmwareVersionFromUpdateLine(line string) string {
	line = strings.TrimSpace(line)
	if idx := strings.LastIndex(line, "->"); idx >= 0 {
		return strings.TrimSpace(line[idx+2:])
	}
	return ""
}

func firmwareVersionFromDoneLine(line string) string {
	line = strings.TrimSpace(strings.TrimPrefix(line, "Done: firmware"))
	line = strings.TrimSuffix(line, "installed")
	return strings.TrimSpace(line)
}

func appendFirmwareUpdateJobLog(job *firmwareUpdateJob, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	if len(job.Logs) > 0 && job.Logs[len(job.Logs)-1] == message {
		return
	}
	job.Logs = append(job.Logs, message)
	if len(job.Logs) > 12 {
		job.Logs = append([]string(nil), job.Logs[len(job.Logs)-12:]...)
	}
}

func (s *Server) activeMacAppUpdateJob() (macAppUpdateJob, bool) {
	s.macAppUpdateMu.Lock()
	defer s.macAppUpdateMu.Unlock()
	for _, job := range s.macAppUpdateJobs {
		if job != nil && job.Phase == "installing" {
			return cloneMacAppUpdateJob(job), true
		}
	}
	return macAppUpdateJob{}, false
}

func (s *Server) createMacAppUpdateJob(req macAppUpdateRequest) macAppUpdateJob {
	s.macAppUpdateMu.Lock()
	defer s.macAppUpdateMu.Unlock()
	if s.macAppUpdateJobs == nil {
		s.macAppUpdateJobs = make(map[string]*macAppUpdateJob)
	}
	s.nextMacAppUpdate++
	id := fmt.Sprintf("mac-app-update-%d-%d", time.Now().UnixNano(), s.nextMacAppUpdate)
	job := &macAppUpdateJob{
		ID:        id,
		Phase:     "installing",
		Message:   "Preparing Mac App update.",
		Progress:  5,
		StartedAt: time.Now().UTC(),
		Logs:      []string{"Preparing Mac App update."},
		version:   strings.TrimSpace(req.Version),
	}
	s.macAppUpdateJobs[id] = job
	return cloneMacAppUpdateJob(job)
}

func (s *Server) startMacAppUpdateJob(_ context.Context, jobID string, req macAppUpdateRequest) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), macAppUpdateJobTime)
		defer cancel()
		writer := &macAppUpdateProgressWriter{server: s, jobID: jobID}
		err := s.updateMacApp(ctx, s.home, s.addr, req, writer)
		finishedAt := time.Now().UTC()
		if err != nil {
			apiErr := macAppUpdateErrorPayload(err)
			s.updateMacAppUpdateJob(jobID, func(job *macAppUpdateJob) {
				job.Phase = "error"
				job.Message = "Mac App update failed."
				job.Progress = 100
				job.FinishedAt = &finishedAt
				job.Error = &apiErr
				appendMacAppUpdateJobLog(job, "Mac App update failed.")
			})
			return
		}
		s.updateMacAppUpdateJob(jobID, func(job *macAppUpdateJob) {
			job.Phase = "complete"
			job.Message = "Mac App updated."
			job.Progress = 100
			job.FinishedAt = &finishedAt
			job.Result = &macAppUpdateResult{
				Version: strings.TrimSpace(job.version),
			}
			appendMacAppUpdateJobLog(job, "Mac App updated.")
		})
	}()
}

func (s *Server) updateMacAppUpdateJob(jobID string, update func(*macAppUpdateJob)) {
	s.macAppUpdateMu.Lock()
	defer s.macAppUpdateMu.Unlock()
	if s.macAppUpdateJobs == nil {
		return
	}
	job := s.macAppUpdateJobs[jobID]
	if job == nil {
		return
	}
	update(job)
}

func (s *Server) macAppUpdateJobSnapshot(jobID string) (macAppUpdateJob, bool) {
	s.macAppUpdateMu.Lock()
	defer s.macAppUpdateMu.Unlock()
	job := s.macAppUpdateJobs[jobID]
	if job == nil {
		return macAppUpdateJob{}, false
	}
	return cloneMacAppUpdateJob(job), true
}

func cloneMacAppUpdateJob(job *macAppUpdateJob) macAppUpdateJob {
	if job == nil {
		return macAppUpdateJob{}
	}
	clone := *job
	clone.Logs = append([]string(nil), job.Logs...)
	if job.Result != nil {
		result := *job.Result
		clone.Result = &result
	}
	if job.Error != nil {
		apiErr := *job.Error
		clone.Error = &apiErr
	}
	if job.FinishedAt != nil {
		finishedAt := *job.FinishedAt
		clone.FinishedAt = &finishedAt
	}
	return clone
}

type macAppUpdateProgressWriter struct {
	server  *Server
	jobID   string
	pending string
}

func (w *macAppUpdateProgressWriter) Write(p []byte) (int, error) {
	text := w.pending + string(p)
	lines := strings.Split(text, "\n")
	if !strings.HasSuffix(text, "\n") {
		w.pending = lines[len(lines)-1]
		lines = lines[:len(lines)-1]
	} else {
		w.pending = ""
	}
	for _, line := range lines {
		w.noteLine(line)
	}
	return len(p), nil
}

func (w *macAppUpdateProgressWriter) noteLine(line string) {
	line = strings.TrimSpace(line)
	if line == "" || w.server == nil {
		return
	}
	w.server.updateMacAppUpdateJob(w.jobID, func(job *macAppUpdateJob) {
		message, progress, ok := customerMacAppUpdateProgress(line, job)
		if !ok {
			return
		}
		job.Message = message
		if progress > job.Progress {
			job.Progress = progress
		}
		appendMacAppUpdateJobLog(job, message)
	})
}

func customerMacAppUpdateProgress(line string, job *macAppUpdateJob) (string, int, bool) {
	switch {
	case strings.HasPrefix(line, "vibetv: release="):
		job.version = macAppVersionFromReleaseLine(line)
		return "Downloading Mac App update.", 20, true
	case strings.HasPrefix(line, "vibetv: arch="):
		return "Preparing this Mac.", 25, true
	case strings.Contains(line, "Mac setup binary installed"):
		return "Installing Mac App.", 70, true
	case strings.Contains(line, "background service installed"):
		return "Restarting Mac App.", 85, true
	case strings.Contains(line, "Mac App answered with version"):
		if version := macAppVersionFromAnsweredLine(line); version != "" {
			job.version = version
		}
		return "Checking Mac App.", 90, true
	case strings.Contains(line, "Mac App update verified"):
		return "Mac App is ready.", 96, true
	default:
		return "", 0, false
	}
}

func macAppVersionFromReleaseLine(line string) string {
	version := strings.TrimSpace(strings.TrimPrefix(line, "vibetv: release="))
	version = strings.TrimPrefix(version, "v")
	normalized, ok := normalizeMacAppUpdateVersion(version)
	if !ok {
		return ""
	}
	return normalized
}

func macAppVersionFromAnsweredLine(line string) string {
	const marker = "Mac App answered with version"
	idx := strings.Index(line, marker)
	if idx < 0 {
		return ""
	}
	version := strings.TrimSpace(line[idx+len(marker):])
	if fields := strings.Fields(version); len(fields) > 0 {
		version = fields[0]
	}
	version = strings.Trim(version, ".;")
	normalized, ok := normalizeMacAppUpdateVersion(version)
	if !ok {
		return ""
	}
	return normalized
}

func appendMacAppUpdateJobLog(job *macAppUpdateJob, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	if len(job.Logs) > 0 && job.Logs[len(job.Logs)-1] == message {
		return
	}
	job.Logs = append(job.Logs, message)
	if len(job.Logs) > 12 {
		job.Logs = append([]string(nil), job.Logs[len(job.Logs)-12:]...)
	}
}

func macAppUpdateErrorPayload(_ error) apiError {
	return apiError{
		Code:       "mac_app_update_failed",
		Message:    "Mac App update failed.",
		NextAction: "Copy the update command and run it in Terminal, then try again.",
	}
}

var macAppUpdateVersionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z._-]*)?$`)

func normalizeMacAppUpdateVersion(raw string) (string, bool) {
	version := strings.TrimSpace(raw)
	version = strings.TrimPrefix(version, "v")
	if version == "" {
		return "", true
	}
	if !macAppUpdateVersionPattern.MatchString(version) {
		return "", false
	}
	return version, true
}

func firmwareUpdateErrorPayload(err error) apiError {
	if errcode.Of(err) == errcode.UpgradeVersionGuard {
		return apiError{
			Code:       "firmware_update_blocked",
			Message:    "Update cannot be installed on this VibeTV.",
			NextAction: "Create a support report.",
		}
	}
	return apiError{
		Code:       "firmware_update_failed",
		Message:    "VibeTV update failed.",
		NextAction: "Keep VibeTV powered on, then try again.",
	}
}

func firmwareUpdateDiagnosticStatus(job firmwareUpdateJob) string {
	switch job.Phase {
	case "complete":
		return "pass"
	case "error":
		return "fail"
	default:
		return "attention"
	}
}

func firmwareUpdateDiagnosticDetail(job firmwareUpdateJob) string {
	switch job.Phase {
	case "complete":
		if job.Result != nil && strings.TrimSpace(job.Result.Firmware) != "" {
			return "Last VibeTV update completed. Firmware " + strings.TrimSpace(job.Result.Firmware) + " is installed."
		}
		return "Last VibeTV update completed."
	case "error":
		if job.Error != nil && strings.TrimSpace(job.Error.Message) != "" {
			return "Last VibeTV update failed: " + strings.TrimSpace(job.Error.Message)
		}
		return "Last VibeTV update failed."
	default:
		return "VibeTV update is still running."
	}
}

func firmwareUpdateDiagnosticErrorCode(job firmwareUpdateJob) string {
	if job.Phase != "error" || job.Error == nil {
		return ""
	}
	return strings.TrimSpace(job.Error.Code)
}

func firmwareUpdateDiagnosticNextAction(job firmwareUpdateJob) string {
	if job.Phase != "error" || job.Error == nil {
		return ""
	}
	return strings.TrimSpace(job.Error.NextAction)
}

func runFirmwareUpdateCommand(ctx context.Context, home string, cfg runtimeconfig.Config, req firmwareUpdateRequest, out io.Writer) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	target := publicTarget(cfg.DeviceTarget)
	if target == "" {
		return errors.New("device target is empty")
	}
	args := firmwareUpdateCommandArgs(target, os.Getenv(firmwareManifestEnvVar), req.Force)
	cmd := exec.CommandContext(ctx, executable, args...)
	cmd.Stdout = out
	cmd.Stderr = out
	if strings.TrimSpace(home) != "" {
		cmd.Env = append(os.Environ(), "HOME="+home)
	}
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("firmware update command failed: %w", err)
	}
	return nil
}

func firmwareUpdateCommandArgs(target, manifestURL string, force bool) []string {
	args := []string{
		"install-update",
		"--target",
		target,
		"--confirm-live-update",
		"--skip-launchagent-pause",
	}
	if manifestURL = strings.TrimSpace(manifestURL); manifestURL != "" {
		args = append(args, "--manifest-url", manifestURL)
	}
	if force {
		args = append(args, "--force")
	}
	return args
}

func runMacAppUpdateCommand(ctx context.Context, home string, addr string, req macAppUpdateRequest, out io.Writer) error {
	args := []string{"--skip-device-setup"}
	if version := strings.TrimSpace(req.Version); version != "" {
		args = append(args, "--version", version)
	}
	if addr = strings.TrimSpace(addr); addr != "" {
		args = append(args, "--addr", addr)
	}
	script := `set -euo pipefail
installer_url="$1"
shift
curl -fsSL "$installer_url" | bash -s -- "$@"
`
	cmdArgs := append([]string{"-c", script, "vibetv-mac-app-update", macAppInstallerURL}, args...)
	cmd := exec.CommandContext(ctx, "/bin/bash", cmdArgs...)
	cmd.Stdout = out
	cmd.Stderr = out
	if strings.TrimSpace(home) != "" {
		cmd.Env = append(os.Environ(), "HOME="+home)
	}
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("mac app update command failed: %w", err)
	}
	return nil
}

func (s *Server) requireThemeInstallPreflight(w http.ResponseWriter, r *http.Request, cfg runtimeconfig.Config, hello protocol.DeviceHello) bool {
	if strings.TrimSpace(cfg.DeviceToken) == "" {
		writeError(
			w,
			http.StatusForbidden,
			"pairing_required",
			"VibeTV pairing is required before installing themes.",
			"Pair VibeTV, then retry install.",
		)
		return false
	}

	caps := protocol.CapabilitiesFromHello(hello)
	if !caps.Known || !caps.SupportsThemeSpecV1 {
		writeError(
			w,
			http.StatusBadRequest,
			"theme_install_unsupported",
			"This VibeTV does not advertise theme install support.",
			"Update VibeTV firmware or use a device that supports ThemeSpec v1.",
		)
		return false
	}

	if _, err := s.getHealth(r.Context(), cfg.DeviceTarget, cfg.DeviceToken); err != nil {
		writeError(
			w,
			http.StatusBadGateway,
			"device_health_failed",
			"VibeTV health check failed before theme install.",
			"Keep VibeTV powered on, confirm it is on the same WiFi, then retry discovery before installing.",
		)
		return false
	}
	return true
}

func splitInstallLog(log string) []string {
	lines := strings.Split(log, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, sanitizeLogLine(line))
		}
	}
	return out
}

func validRemoteThemePackURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return true
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if parsed.User != nil || strings.TrimSpace(parsed.Host) == "" {
		return false
	}
	return strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")
}

func (s *Server) config() (runtimeconfig.Config, error) {
	s.configMu.Lock()
	defer s.configMu.Unlock()
	return s.loadConfigNormalized()
}

func (s *Server) loadConfigNormalized() (runtimeconfig.Config, error) {
	cfg, err := s.loadConfig(s.home)
	if err != nil {
		return runtimeconfig.Config{}, err
	}
	cfg.DeviceTarget = strings.TrimSpace(cfg.DeviceTarget)
	cfg.DeviceToken = strings.TrimSpace(cfg.DeviceToken)
	cfg.DeviceID = strings.TrimSpace(cfg.DeviceID)
	return cfg, nil
}

func (s *Server) updateConfig(mutate func(*runtimeconfig.Config)) (runtimeconfig.Config, error) {
	s.configMu.Lock()
	defer s.configMu.Unlock()
	cfg, err := s.loadConfigNormalized()
	if err != nil {
		return runtimeconfig.Config{}, err
	}
	if mutate != nil {
		mutate(&cfg)
	}
	cfg.DeviceTarget = strings.TrimSpace(cfg.DeviceTarget)
	cfg.DeviceToken = strings.TrimSpace(cfg.DeviceToken)
	cfg.DeviceID = strings.TrimSpace(cfg.DeviceID)
	if err := s.saveConfig(s.home, cfg); err != nil {
		return runtimeconfig.Config{}, err
	}
	return cfg, nil
}

func (s *Server) requireDevice(w http.ResponseWriter, r *http.Request) (runtimeconfig.Config, protocol.DeviceHello, bool) {
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false
	}
	if strings.TrimSpace(cfg.DeviceTarget) == "" {
		writeDeviceNotFound(w)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false
	}
	hello, err := s.getHello(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		// A read-only status poll must never fan out into a subnet scan. The
		// Control Center polls this endpoint frequently; when VibeTV is offline,
		// overlapping scans can consume every ESP8266 receive buffer just as a
		// recovery or OTA update starts. Discovery remains available through the
		// explicit /v1/device/discover and /v1/device/repair actions.
		writeDeviceNotFound(w)
		return runtimeconfig.Config{}, protocol.DeviceHello{}, false
	}
	return cfg, hello, true
}

func (s *Server) discover(ctx context.Context, cfg runtimeconfig.Config, explicitTarget string) (string, protocol.DeviceHello, error) {
	explicitTarget = strings.TrimSpace(explicitTarget)
	var lastErr error
	if explicitTarget != "" {
		target, targetErr := normalizeExplicitDeviceTarget(explicitTarget)
		if targetErr != nil {
			return "", protocol.DeviceHello{}, targetErr
		}
		hello, err := s.getHelloProbe(ctx, target, cfg.DeviceToken, discoveryProbeTime)
		if err != nil {
			if !isVibeTVLocalTarget(target) {
				return "", protocol.DeviceHello{}, err
			}
			lastErr = err
		} else {
			return target, hello, nil
		}
	} else {
		candidates := uniqueStrings(cfg.DeviceTarget, s.configuredDefaultWiFiTarget())
		for _, candidate := range candidates {
			hello, err := s.getHelloProbe(ctx, candidate, cfg.DeviceToken, discoveryProbeTime)
			if err == nil {
				return normalizeTarget(candidate), hello, nil
			}
			lastErr = err
		}
	}
	if target, hello, err := s.discoverSubnet(ctx, cfg); err == nil {
		return target, hello, nil
	} else if err != nil {
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no device candidates")
	}
	return "", protocol.DeviceHello{}, lastErr
}

func isVibeTVLocalTarget(target string) bool {
	parsed, err := url.Parse(normalizeTarget(target))
	if err != nil {
		return false
	}
	host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(parsed.Hostname())), ".")
	return host == "vibetv.local"
}

func (s *Server) discoverSubnet(ctx context.Context, cfg runtimeconfig.Config) (string, protocol.DeviceHello, error) {
	if s.subnetTargets == nil {
		return "", protocol.DeviceHello{}, errors.New("subnet discovery unavailable")
	}
	candidates := uniqueStrings(s.subnetTargets()...)
	if len(candidates) == 0 {
		return "", protocol.DeviceHello{}, errors.New("no subnet candidates")
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	type result struct {
		target string
		hello  protocol.DeviceHello
		err    error
	}
	jobs := make(chan string)
	results := make(chan result, len(candidates))
	workers := subnetProbeLimit
	if len(candidates) < workers {
		workers = len(candidates)
	}

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for candidate := range jobs {
				hello, err := s.getHelloProbe(ctx, candidate, cfg.DeviceToken, subnetProbeTime)
				select {
				case results <- result{target: candidate, hello: hello, err: err}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, candidate := range candidates {
			select {
			case jobs <- candidate:
			case <-ctx.Done():
				return
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	var lastErr error
	var matches []result
	for res := range results {
		if res.err == nil {
			res.target = normalizeTarget(res.target)
			matches = append(matches, res)
			if len(matches) > 1 {
				cancel()
				targets := make([]string, 0, len(matches))
				for _, match := range matches {
					targets = append(targets, match.target)
				}
				sort.Strings(targets)
				return "", protocol.DeviceHello{}, &multipleDevicesError{targets: targets}
			}
			continue
		}
		lastErr = res.err
	}
	if len(matches) == 1 {
		return matches[0].target, matches[0].hello, nil
	}
	if lastErr == nil {
		lastErr = errors.New("subnet discovery found no device")
	}
	return "", protocol.DeviceHello{}, lastErr
}

func (s *Server) searchDevices(ctx context.Context, cfg runtimeconfig.Config, explicitTarget string) []deviceSearchEntry {
	byIdentity := make(map[string]deviceSearchEntry)
	for attempt := 0; attempt < repairDiscoveryAttempts; attempt++ {
		foundKnown := false
		for _, entry := range s.searchDevicesOnce(ctx, cfg, explicitTarget) {
			key := deviceSearchIdentityKey(entry)
			if prior, ok := byIdentity[key]; !ok || (!prior.Known && entry.Known) {
				byIdentity[key] = entry
			}
			if entry.Known {
				foundKnown = true
			}
		}
		if foundKnown {
			return sortedDeviceSearchEntries(byIdentity)
		}
		if attempt+1 >= repairDiscoveryAttempts {
			break
		}
		select {
		case <-ctx.Done():
			return sortedDeviceSearchEntries(byIdentity)
		case <-time.After(repairDiscoveryRetryGap):
		}
	}
	return sortedDeviceSearchEntries(byIdentity)
}

func (s *Server) searchDevicesOnce(ctx context.Context, cfg runtimeconfig.Config, explicitTarget string) []deviceSearchEntry {
	candidates := []string{}
	if explicitTarget != "" {
		if target, err := normalizeExplicitDeviceTarget(explicitTarget); err == nil {
			candidates = append(candidates, target)
		}
	}
	candidates = append(candidates, cfg.DeviceTarget, s.configuredDefaultWiFiTarget())
	if s.subnetTargets != nil {
		candidates = append(candidates, s.subnetTargets()...)
	}
	candidates = uniqueStrings(candidates...)
	if len(candidates) == 0 {
		return []deviceSearchEntry{}
	}

	type result struct {
		target string
		hello  protocol.DeviceHello
	}
	workers := subnetProbeLimit
	if len(candidates) < workers {
		workers = len(candidates)
	}
	jobs := make(chan string)
	results := make(chan result, len(candidates))
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for candidate := range jobs {
				hello, err := s.getHelloProbe(ctx, candidate, "", subnetProbeTime)
				if err == nil {
					results <- result{target: normalizeTarget(candidate), hello: hello.Normalize()}
				}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, candidate := range candidates {
			select {
			case jobs <- candidate:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		wg.Wait()
		close(results)
	}()

	byIdentity := make(map[string]deviceSearchEntry)
	for found := range results {
		hello := found.hello
		if hello.NetworkMode == "setup" {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(hello.DeviceID))
		if key == "" {
			key = strings.ToLower(publicTarget(found.target))
		}
		entry := deviceSearchEntry{
			Target:      publicTarget(found.target),
			DeviceID:    hello.DeviceID,
			Board:       hello.Board,
			Firmware:    hello.Firmware,
			NetworkMode: hello.NetworkMode,
			Known:       deviceIdentityMatches(cfg, hello),
		}
		if prior, ok := byIdentity[key]; !ok || (!prior.Known && entry.Known) {
			byIdentity[key] = entry
		}
	}
	devices := make([]deviceSearchEntry, 0, len(byIdentity))
	for _, entry := range byIdentity {
		devices = append(devices, entry)
	}
	sort.Slice(devices, func(i, j int) bool {
		if devices[i].Known != devices[j].Known {
			return devices[i].Known
		}
		return devices[i].Target < devices[j].Target
	})
	return devices
}

func deviceSearchIdentityKey(entry deviceSearchEntry) string {
	key := strings.ToLower(strings.TrimSpace(entry.DeviceID))
	if key == "" {
		key = strings.ToLower(publicTarget(entry.Target))
	}
	return key
}

func (s *Server) configuredDefaultWiFiTarget() string {
	if s.defaultWiFiTarget != nil {
		return s.defaultWiFiTarget()
	}
	return setup.DefaultWiFiTarget()
}

func sortedDeviceSearchEntries(byIdentity map[string]deviceSearchEntry) []deviceSearchEntry {
	devices := make([]deviceSearchEntry, 0, len(byIdentity))
	for _, entry := range byIdentity {
		devices = append(devices, entry)
	}
	sort.Slice(devices, func(i, j int) bool {
		if devices[i].Known != devices[j].Known {
			return devices[i].Known
		}
		return devices[i].Target < devices[j].Target
	})
	return devices
}

func deviceIdentityMatches(cfg runtimeconfig.Config, hello protocol.DeviceHello) bool {
	wantID := strings.TrimSpace(cfg.DeviceID)
	gotID := strings.TrimSpace(hello.DeviceID)
	return wantID != "" && gotID != "" && strings.EqualFold(wantID, gotID)
}

func validateRepairIdentity(
	cfg runtimeconfig.Config,
	hello protocol.DeviceHello,
	explicit bool,
	expectedDeviceID string,
) error {
	hello = hello.Normalize()
	if hello.NetworkMode == "setup" {
		return &repairStageError{stage: "discovery", err: errors.New("VibeTV is still in Wi-Fi setup mode")}
	}
	expectedDeviceID = strings.TrimSpace(expectedDeviceID)
	if expectedDeviceID != "" && !strings.EqualFold(expectedDeviceID, strings.TrimSpace(hello.DeviceID)) {
		return &repairStageError{stage: "discovery", err: errors.New("selected VibeTV identity changed before pairing")}
	}
	if explicit || strings.TrimSpace(cfg.DeviceID) == "" {
		return nil
	}
	if !strings.EqualFold(strings.TrimSpace(cfg.DeviceID), strings.TrimSpace(hello.DeviceID)) {
		return &repairStageError{stage: "discovery", err: errors.New("discovered VibeTV does not match the saved device identity")}
	}
	return nil
}

func (s *Server) getHello(ctx context.Context, target, token string) (protocol.DeviceHello, error) {
	var hello protocol.DeviceHello
	if err := s.doJSON(ctx, http.MethodGet, target, "/hello", token, nil, &hello); err != nil {
		return protocol.DeviceHello{}, err
	}
	return hello.Normalize(), nil
}

func (s *Server) getHelloProbe(ctx context.Context, target, token string, timeout time.Duration) (protocol.DeviceHello, error) {
	if timeout <= 0 {
		return s.getHello(ctx, target, token)
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return s.getHello(probeCtx, target, token)
}

func (s *Server) getHelloProbeWithTokenFallback(ctx context.Context, target, token string, timeout time.Duration) (protocol.DeviceHello, string, error) {
	hello, err := s.getHelloProbe(ctx, target, token, timeout)
	if err == nil || strings.TrimSpace(token) == "" {
		return hello, strings.TrimSpace(token), err
	}
	tokenlessHello, tokenlessErr := s.getHelloProbe(ctx, target, "", timeout)
	if tokenlessErr == nil {
		return tokenlessHello, "", nil
	}
	return protocol.DeviceHello{}, strings.TrimSpace(token), err
}

type deviceHealth struct {
	OK       bool           `json:"ok"`
	Settings deviceSettings `json:"settings"`
	// correlatedFrameProof is set only by the companion after it correlates a
	// fresh, target-matching stream acknowledgement with device render counters.
	// It is intentionally not populated from device JSON.
	correlatedFrameProof bool
	System               struct {
		ResetReason string `json:"resetReason"`
	} `json:"system"`
	Display struct {
		ActiveTheme string `json:"activeTheme"`
		ThemeSpec   struct {
			Active         bool   `json:"active"`
			Path           string `json:"path"`
			Hash           string `json:"hash"`
			RenderOK       *bool  `json:"renderOk"`
			RenderError    string `json:"renderError"`
			RenderFailures uint64 `json:"renderFailures"`
		} `json:"themeSpec"`
	} `json:"display"`
	Render struct {
		FullCount    *uint64 `json:"fullCount"`
		PartialCount *uint64 `json:"partialCount"`
		LastKind     string  `json:"lastKind"`
	} `json:"render"`
}

func (s *Server) getHealth(ctx context.Context, target, token string) (deviceHealth, error) {
	var health deviceHealth
	if err := s.doJSON(ctx, http.MethodGet, target, "/health", token, nil, &health); err != nil {
		return deviceHealth{}, err
	}
	return health, nil
}

func (s *Server) getHealthProbe(ctx context.Context, target, token string, timeout time.Duration) (deviceHealth, error) {
	if timeout <= 0 {
		return s.getHealth(ctx, target, token)
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return s.getHealth(probeCtx, target, token)
}

func (s *Server) captureDisplayRenderBaseline(ctx context.Context, target, token string) (deviceHealth, error) {
	health, err := s.getHealthProbe(ctx, target, token, deviceHealthProbeTime)
	if err == nil || strings.TrimSpace(token) == "" {
		return health, err
	}
	return s.getHealthProbe(ctx, target, "", deviceHealthProbeTime)
}

func (s *Server) waitForDisplayRender(ctx context.Context, target, token string, baseline deviceHealth) (deviceHealth, error) {
	return s.waitForDisplayRenderWithStream(ctx, target, token, baseline, displayStreamInfo{})
}

func (s *Server) waitForDisplayRenderWithStream(
	ctx context.Context,
	target string,
	token string,
	baseline deviceHealth,
	stream displayStreamInfo,
) (deviceHealth, error) {
	deadline := time.Now().Add(displayRenderWaitTime)
	var last deviceHealth
	var lastErr error
	for {
		health, err := s.getHealth(ctx, target, token)
		if err == nil {
			last = health
			if health.OK && renderHealthyFromHealth(health) && displayRenderAdvanced(baseline, health) {
				return health, nil
			}
			if health.OK && correlatedOverlayProvesUsage(baseline, health, stream, target) {
				health.correlatedFrameProof = true
				return health, nil
			}
			detail := strings.TrimSpace(health.Display.ThemeSpec.RenderError)
			if detail == "" {
				if !displayRenderAdvanced(baseline, health) {
					detail = "render counters did not advance"
				} else {
					detail = "lastKind=" + strings.TrimSpace(health.Render.LastKind)
				}
			}
			lastErr = fmt.Errorf("display render not ready: %s", detail)
		} else {
			lastErr = err
		}
		if time.Now().After(deadline) {
			if lastErr == nil {
				lastErr = errors.New("display render did not become healthy")
			}
			return last, lastErr
		}
		select {
		case <-ctx.Done():
			if lastErr == nil {
				lastErr = ctx.Err()
			}
			return last, lastErr
		case <-time.After(750 * time.Millisecond):
		}
	}
}

func displayRenderAdvanced(baseline, current deviceHealth) bool {
	baselineFull, baselinePartial, baselineOK := displayRenderCounters(baseline)
	currentFull, currentPartial, currentOK := displayRenderCounters(current)
	return baselineOK && currentOK &&
		currentFull >= baselineFull && currentPartial >= baselinePartial &&
		(currentFull > baselineFull || currentPartial > baselinePartial)
}

func displayRenderCounters(health deviceHealth) (uint64, uint64, bool) {
	if health.Render.FullCount == nil || health.Render.PartialCount == nil {
		return 0, 0, false
	}
	return *health.Render.FullCount, *health.Render.PartialCount, true
}

func renderHealthyFromHealth(health deviceHealth) bool {
	if !renderSurfaceHealthy(health) {
		return false
	}
	return usageRenderKind(health.Render.LastKind)
}

func fullUsageRenderKind(raw string) bool {
	switch strings.TrimSpace(raw) {
	case "usage", "theme_spec_usage":
		return true
	default:
		return false
	}
}

func activeThemeNeedsFullRepairRender(health deviceHealth) bool {
	spec := health.Display.ThemeSpec
	return spec.Active && strings.TrimSpace(spec.Path) != "" && !fullUsageRenderKind(health.Render.LastKind)
}

func renderSurfaceHealthy(health deviceHealth) bool {
	if _, _, ok := displayRenderCounters(health); !ok {
		return false
	}
	spec := health.Display.ThemeSpec
	if !spec.Active {
		// Older firmware may omit ThemeSpec health entirely. If it explicitly
		// reports renderOk while active=false, normal usage frames draw the
		// customer-visible "Theme missing" screen and must never count as ready.
		return spec.RenderOK == nil
	}
	return spec.RenderOK != nil && *spec.RenderOK
}

func usageRenderKind(raw string) bool {
	switch strings.TrimSpace(raw) {
	case "usage", "theme_spec_usage", "theme_spec_frame":
		return true
	default:
		return false
	}
}

func localOverlayRenderKind(raw string) bool {
	switch strings.TrimSpace(raw) {
	case "reset", "update_notice":
		return true
	default:
		return false
	}
}

func liveScreenRenderKind(raw string) bool {
	return usageRenderKind(raw) || localOverlayRenderKind(raw)
}

func correlatedOverlayProvesUsage(
	baseline deviceHealth,
	current deviceHealth,
	stream displayStreamInfo,
	target string,
) bool {
	baselineFull, baselinePartial, baselineOK := displayRenderCounters(baseline)
	currentFull, currentPartial, currentOK := displayRenderCounters(current)
	if !baselineOK || !currentOK {
		return false
	}
	if currentFull <= baselineFull || currentPartial < baselinePartial {
		return false
	}
	if !localOverlayRenderKind(current.Render.LastKind) || !renderSurfaceHealthy(current) {
		return false
	}
	if !displayStreamHealthyForTarget(&stream, target) {
		return false
	}
	return true
}

func (s *Server) waitForVerifiedDisplayRender(
	ctx context.Context,
	target string,
	token string,
	baseline deviceHealth,
	stream displayStreamInfo,
) (deviceHealth, error) {
	if s.waitRender != nil {
		health, err := s.waitRender(ctx, target, token, baseline)
		if err != nil && health.OK && correlatedOverlayProvesUsage(baseline, health, stream, target) {
			health.correlatedFrameProof = true
			return health, nil
		}
		return health, err
	}
	return s.waitForDisplayRenderWithStream(ctx, target, token, baseline, stream)
}

func (s *Server) reactivateCurrentThemeAndWaitForFullRender(
	ctx context.Context,
	target string,
	token string,
	baseline deviceHealth,
	stream displayStreamInfo,
) (deviceHealth, error) {
	themePath := strings.TrimSpace(baseline.Display.ThemeSpec.Path)
	if !baseline.Display.ThemeSpec.Active || themePath == "" {
		return baseline, errors.New("active VibeTV theme path is unavailable")
	}
	var response struct {
		OK bool `json:"ok"`
	}
	if err := s.doJSON(
		ctx,
		http.MethodPost,
		target,
		"/theme/active",
		token,
		struct {
			Path string `json:"path"`
		}{Path: themePath},
		&response,
	); err != nil {
		return baseline, fmt.Errorf("reactivate current VibeTV theme: %w", err)
	}
	if !response.OK {
		return baseline, errors.New("VibeTV did not confirm current theme reactivation")
	}
	health, err := s.waitForVerifiedDisplayRender(ctx, target, token, baseline, stream)
	if err != nil {
		return health, err
	}
	if !fullUsageRenderKind(health.Render.LastKind) && !health.correlatedFrameProof {
		return health, fmt.Errorf("VibeTV did not confirm a full display render: lastKind=%s", strings.TrimSpace(health.Render.LastKind))
	}
	return health, nil
}

func (s *Server) updateBrightness(ctx context.Context, target, token string, brightness int) (deviceSettings, error) {
	form := url.Values{}
	form.Set("api", "1")
	form.Set("b", fmt.Sprintf("%d", brightness))
	var response struct {
		Settings deviceSettings `json:"settings"`
	}
	if err := s.doForm(ctx, target, "/api/settings", token, form, &response); err != nil {
		return deviceSettings{}, err
	}
	return response.Settings, nil
}

func (s *Server) pair(ctx context.Context, target string) (string, error) {
	s.pairMu.Lock()
	defer s.pairMu.Unlock()

	attempts := s.pairAttempts
	if attempts <= 0 {
		attempts = 1
	}
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		attemptCtx := ctx
		cancel := func() {}
		if s.pairAttemptTimeout > 0 {
			attemptCtx, cancel = context.WithTimeout(ctx, s.pairAttemptTimeout)
		}
		token, err := s.pairOnce(attemptCtx, target)
		cancel()
		if err == nil {
			return token, nil
		}
		lastErr = err
		if attempt == attempts {
			break
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(s.pairRetryGap):
		}
	}
	return "", fmt.Errorf("pairing failed after %d attempts: %w", attempts, lastErr)
}

func (s *Server) pairOnce(ctx context.Context, target string) (string, error) {
	pairURL, err := url.Parse(endpoint(target, "/api/pair"))
	if err != nil {
		return "", err
	}
	query := pairURL.Query()
	query.Set("api", "1")
	pairURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pairURL.String(), nil)
	if err != nil {
		return "", err
	}
	req.Close = true
	var response struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
	}
	if err := s.do(req, &response); err != nil {
		return "", err
	}
	token := strings.TrimSpace(response.Token)
	if !response.OK || token == "" {
		return "", errors.New("pairing response did not include token")
	}
	return token, nil
}

func (s *Server) startDisplayStream(ctx context.Context, target string) error {
	target = strings.TrimSpace(target)
	if target == "" {
		return errors.New("device target is empty")
	}
	if s.refreshStream != nil {
		return s.refreshStream(ctx, target)
	}
	opts := setup.Options{
		Transport: "wifi",
		Target:    target,
		AssumeYes: true,
		SkipFlash: true,
	}
	validateOpts := opts
	validateOpts.ValidateOnly = true
	if err := s.runSetup(ctx, validateOpts); err != nil {
		return err
	}
	return s.runSetup(ctx, opts)
}

func (s *Server) doJSON(ctx context.Context, method, target, path, token string, body any, out any) error {
	if s.firmwareUpdateActive.Load() {
		return errors.New("VibeTV firmware update is in progress")
	}
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint(target, path), reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	applyDeviceToken(req, token)
	return s.do(req, out)
}

func (s *Server) doForm(ctx context.Context, target, path, token string, form url.Values, out any) error {
	if s.firmwareUpdateActive.Load() {
		return errors.New("VibeTV firmware update is in progress")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint(target, path), strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	applyDeviceToken(req, token)
	return s.do(req, out)
}

func (s *Server) do(req *http.Request, out any) error {
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("device status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func requireMethod(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	for _, method := range methods {
		if r.Method == method {
			return true
		}
	}
	writeMethodNotAllowed(w)
	return false
}

func decodeOptionalJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil {
		return true
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body could not be read.", "Send a valid JSON request.")
		return false
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return true
	}
	if err := json.Unmarshal(data, v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.", "Send a valid JSON request.")
		return false
	}
	return true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body is required.", "Send a valid JSON request.")
		return false
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.", "Send a valid JSON request.")
		return false
	}
	return true
}

func writeDeviceNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "device_not_found", "No VibeTV device was found.", "Restart VibeTV, wait until it shows WiFi connected, then run setup again.")
}

func writeDiscoveryError(w http.ResponseWriter, err error) {
	var invalidTarget *invalidTargetError
	if errors.As(err, &invalidTarget) {
		writeInvalidDeviceTarget(w)
		return
	}
	var multiple *multipleDevicesError
	if errors.As(err, &multiple) {
		writeError(
			w,
			http.StatusConflict,
			"multiple_devices_found",
			"Multiple VibeTV devices were found.",
			"Enter the exact VibeTV target in the VibeTV target field, for example http://vibetv.local or http://<device-ip>, then search again.",
		)
		return
	}
	writeDeviceNotFound(w)
}

func writeRepairError(w http.ResponseWriter, err error) {
	var invalidTarget *invalidTargetError
	if errors.As(err, &invalidTarget) {
		writeInvalidDeviceTarget(w)
		return
	}
	var multiple *multipleDevicesError
	if errors.As(err, &multiple) {
		writeDiscoveryError(w, err)
		return
	}
	var stageErr *repairStageError
	if errors.As(err, &stageErr) {
		switch stageErr.stage {
		case "config":
			writeInternalError(w, err)
			return
		case "pair":
			writeError(w, http.StatusBadGateway, "pair_failed", "VibeTV pairing failed.", "Keep VibeTV powered on, then retry Fix connection.")
			return
		case "display-stream":
			writeError(w, http.StatusBadGateway, "display_stream_repair_failed", "Mac App could not refresh the VibeTV display stream.", "Run setup again or restart the Mac App, then retry Fix connection.")
			return
		case "display-render":
			writeError(w, http.StatusBadGateway, "display_render_repair_failed", "VibeTV did not render a fresh image.", "Keep VibeTV powered on, then retry Fix connection.")
			return
		}
	}
	writeDeviceNotFound(w)
}

func writeInvalidDeviceTarget(w http.ResponseWriter) {
	writeError(w, http.StatusBadRequest, "invalid_device_target", "VibeTV target is invalid.", "Enter vibetv.local, an IP address, or an http(s) URL with a valid port and without path, username, password, query, or fragment.")
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method is not allowed.", "Use the documented method for this endpoint.")
}

func writeInternalError(w http.ResponseWriter, err error) {
	_ = err
	writeError(w, http.StatusInternalServerError, "internal_error", "The companion could not complete the request.", "Restart the companion and retry.")
}

func writeThemeInstallError(w http.ResponseWriter, err error) {
	status, apiErr := themeInstallErrorPayload(err)
	writeError(w, status, apiErr.Code, apiErr.Message, apiErr.NextAction)
}

func themeInstallErrorPayload(err error) (int, apiError) {
	var apiStatus *statusAPIError
	if errors.As(err, &apiStatus) {
		return apiStatus.status, apiStatus.api
	}
	code := "theme_install_failed"
	if c := errcode.Of(err); c != "" {
		code = string(c)
	}
	next := errcode.Recovery(err)
	if strings.TrimSpace(next) == "" {
		next = "Keep VibeTV powered on and retry the install."
	}
	message := "Theme install failed."
	if detail := sanitizeErrorDetail(err); detail != "" {
		message = "Theme install failed: " + detail
	}
	return http.StatusBadGateway, apiError{
		Code:       code,
		Message:    message,
		NextAction: next,
	}
}

var sensitiveQueryValuePattern = regexp.MustCompile(`(?i)([?&](?:token|auth|key|secret)=)[^&\s"]+`)
var sensitiveURLUserInfoPattern = regexp.MustCompile(`(?i)\b(https?://)[^/\s"@]+@`)
var publicLogURLPattern = regexp.MustCompile(`https?://[^\s)]+`)

func sanitizeLogLine(line string) string {
	return publicLogURLPattern.ReplaceAllStringFunc(line, func(raw string) string {
		parsed, err := url.Parse(raw)
		if err != nil {
			return raw
		}
		parsed.User = nil
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String()
	})
}

func sanitizeErrorDetail(err error) string {
	if err == nil {
		return ""
	}
	detail := strings.TrimSpace(err.Error())
	if detail == "" {
		return ""
	}
	detail = sensitiveURLUserInfoPattern.ReplaceAllString(detail, "${1}<redacted>@")
	detail = sensitiveQueryValuePattern.ReplaceAllString(detail, "${1}<redacted>")
	if len(detail) > 240 {
		detail = detail[:237] + "..."
	}
	return detail
}

func themeInstallEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(themeInstallDisableEnv))) {
	case "1", "true", "yes", "on":
		return false
	default:
		return true
	}
}

func macAppInstallationMode() string {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(macAppUpdateDisableEnv))) {
	case "1", "true", "yes", "on":
		return "dmg"
	default:
		return "legacy"
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func writeError(w http.ResponseWriter, status int, code, message, nextAction string) {
	writeJSON(w, status, errorResponse{
		OK: false,
		Error: apiError{
			Code:       code,
			Message:    message,
			NextAction: nextAction,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) withDisplayStream(ctx context.Context, target string, device deviceInfo) deviceInfo {
	return withDisplayStreamInfo(device, s.streamStatus(ctx, target))
}

func withDisplayStreamInfo(device deviceInfo, stream displayStreamInfo) deviceInfo {
	if strings.TrimSpace(stream.Target) == "" {
		stream.Target = device.Target
	}
	device.Stream = streamPointer(stream)
	if stream.ErrorCode == "device_pairing_required" {
		device.Paired = false
	}
	if !stream.Healthy {
		device.Ready = false
	}
	return device
}

func withDeviceHealth(device deviceInfo, health deviceHealth) deviceInfo {
	device.Health = &deviceHealthInfo{
		OK:          health.OK,
		ResetReason: strings.TrimSpace(health.System.ResetReason),
		RenderKind:  strings.TrimSpace(health.Render.LastKind),
	}
	device.ActiveTheme = strings.TrimSpace(health.Display.ActiveTheme)
	if health.Display.ThemeSpec.Active || health.Display.ThemeSpec.RenderOK != nil {
		device.Display = &deviceDisplayInfo{
			ThemeSpec: &themeSpecHealth{
				Active:         health.Display.ThemeSpec.Active,
				Path:           strings.TrimSpace(health.Display.ThemeSpec.Path),
				Hash:           strings.TrimSpace(health.Display.ThemeSpec.Hash),
				RenderOK:       health.Display.ThemeSpec.RenderOK,
				RenderError:    strings.TrimSpace(health.Display.ThemeSpec.RenderError),
				RenderFailures: health.Display.ThemeSpec.RenderFailures,
			},
		}
	}
	device.Ready = device.Paired &&
		device.Connected &&
		health.OK &&
		device.Stream != nil &&
		device.Stream.Healthy &&
		renderHealthyFromHealth(health)
	return device
}

func (s *Server) withVerifiedDeviceHealth(
	device deviceInfo,
	health deviceHealth,
	target string,
	token string,
	explicit bool,
) deviceInfo {
	device = withDeviceHealth(device, health)
	// Recompute readiness below with the stricter target, service, and proof
	// checks. withDeviceHealth only attaches the raw health fields.
	device.Ready = false
	target = publicTarget(target)
	token = strings.TrimSpace(token)
	fullCount, partialCount, countersOK := displayRenderCounters(health)
	directRenderProof := renderHealthyFromHealth(health)
	overlayTail := localOverlayRenderKind(health.Render.LastKind)
	liveScreenHealthy := renderSurfaceHealthy(health) && liveScreenRenderKind(health.Render.LastKind)
	healthyExactStream := displayStreamHealthyForTarget(device.Stream, target)
	lostResponseStream := displayStreamLostResponseForTarget(device.Stream, target)
	explicitRenderProof := directRenderProof || (overlayTail && health.correlatedFrameProof)
	baseReady := target != "" && token != "" && device.Connected && device.Paired &&
		health.OK && countersOK && liveScreenHealthy && (healthyExactStream || lostResponseStream)
	if !baseReady || (explicit && !explicitRenderProof) {
		if explicit {
			s.clearDisplayVerification(target)
		}
		return device
	}

	now := time.Now().UTC()
	s.verificationMu.Lock()
	if s.displayVerifications == nil {
		s.displayVerifications = make(map[string]displayVerification)
	}
	verification, found := s.displayVerifications[target]
	matchingToken := found && verification.Token == token
	countersRegressed := matchingToken &&
		(fullCount < verification.FullCount || partialCount < verification.PartialCount)
	if countersRegressed {
		delete(s.displayVerifications, target)
		matchingToken = false
	} else if explicit {
		verification = displayVerification{
			Token:        token,
			FullCount:    fullCount,
			PartialCount: partialCount,
			VerifiedAt:   now,
		}
		s.displayVerifications[target] = verification
		matchingToken = true
	}
	verified := matchingToken && !verification.VerifiedAt.IsZero() &&
		now.Sub(verification.VerifiedAt) <= displayVerificationAge
	s.verificationMu.Unlock()

	// A healthy stream is itself a recent, exact-target frame acknowledgement
	// from the expected persistent LaunchAgent. It can keep a live reset or
	// update overlay ready even after the API process restarts and loses its
	// in-memory action proof.
	if healthyExactStream {
		device.Ready = true
		return device
	}
	// The short-lived cache only recovers a direct usage render whose HTTP/log
	// acknowledgement was lost. Local overlay counters never create, renew, or
	// reuse that fallback.
	if !verified || !directRenderProof || !lostResponseStream {
		return device
	}

	stream := *device.Stream
	stream.Healthy = true
	stream.ErrorCode = ""
	stream.Detail = "VibeTV confirmed a freshly rendered image."
	if stream.Target == "" {
		stream.Target = target
	}
	if stream.LastTarget == "" {
		stream.LastTarget = target
	}
	if stream.LastSentAt == "" {
		stream.LastSentAt = verification.VerifiedAt.Format(time.RFC3339)
	}
	device.Stream = &stream
	device.Ready = true
	return device
}

func displayStreamSafeForProof(stream *displayStreamInfo, target string) bool {
	if stream == nil || !stream.Running || strings.TrimSpace(target) == "" {
		return false
	}
	if code := strings.TrimSpace(stream.ErrorCode); code != "" && code != "display_send_failed" {
		return false
	}
	if streamTarget := strings.TrimSpace(stream.Target); streamTarget != "" && !samePublicTarget(target, streamTarget) {
		return false
	}
	if lastTarget := strings.TrimSpace(stream.LastTarget); lastTarget != "" && !samePublicTarget(target, lastTarget) {
		return false
	}
	return true
}

func displayStreamHealthyForTarget(stream *displayStreamInfo, target string) bool {
	return displayStreamSafeForProof(stream, target) &&
		stream.Healthy && strings.TrimSpace(stream.ErrorCode) == "" &&
		strings.TrimSpace(stream.LastTarget) != "" && samePublicTarget(target, stream.LastTarget)
}

func displayStreamLostResponseForTarget(stream *displayStreamInfo, target string) bool {
	return displayStreamSafeForProof(stream, target) &&
		!stream.Healthy && strings.TrimSpace(stream.ErrorCode) == "display_send_failed"
}

func (s *Server) clearDisplayVerification(target string) {
	target = publicTarget(target)
	s.verificationMu.Lock()
	defer s.verificationMu.Unlock()
	if target == "" {
		clear(s.displayVerifications)
		return
	}
	delete(s.displayVerifications, target)
}

func withDeviceHealthProbeError(device deviceInfo, err error) deviceInfo {
	if err == nil {
		return device
	}
	device.Health = &deviceHealthInfo{
		OK:    false,
		Error: sanitizeErrorDetail(err),
	}
	device.Ready = false
	return device
}

func renderHealthDiagnosticDetail(spec *themeSpecHealth) string {
	if spec == nil {
		return "VibeTV render health is unavailable."
	}
	if spec.RenderOK == nil {
		return "VibeTV firmware did not report render health."
	}
	if *spec.RenderOK {
		return "VibeTV rendered the current image."
	}
	if spec.RenderError != "" {
		return "VibeTV could not redraw the current image: " + spec.RenderError + "."
	}
	return "VibeTV could not redraw the current image."
}

func streamPointer(stream displayStreamInfo) *displayStreamInfo {
	if !stream.Healthy && !stream.Running && stream.LastSentAt == "" && stream.Target == "" && stream.LastTarget == "" && stream.Detail == "" {
		return nil
	}
	return &stream
}

func inspectDisplayStream(ctx context.Context, target string) displayStreamInfo {
	return inspectDisplayStreamAfter(ctx, target, time.Time{})
}

func inspectDisplayStreamAfter(ctx context.Context, target string, notBefore time.Time) displayStreamInfo {
	target = publicTarget(target)
	stream := displayStreamInfo{Target: target}
	if target == "" {
		stream.Detail = "No VibeTV target configured."
		return stream
	}

	service := fmt.Sprintf("gui/%d/%s", os.Getuid(), displayStreamLaunchAgentLabel())
	output, err := printDisplayStreamService(ctx, service)
	state := parseDisplayStreamLaunchState(string(output))
	stream.Running = displayStreamLaunchStateRunning(state)
	if err != nil {
		stream.Detail = "Display stream is not loaded."
		return stream
	}
	if !stream.Running {
		stream.Detail = "Display stream is not running."
		return stream
	}

	logPath := displayStreamOutLogPath()
	boundary, boundaryOK := displayStreamLogBoundary(logPath)
	if !boundaryOK {
		stream.Detail = "Display stream is starting."
		return stream
	}
	if !notBefore.IsZero() && notBefore.After(boundary) {
		boundary = notBefore
	}
	lastSentAt, lastTarget, _, frameOK := lastDisplayStreamFrameLineAfter(logPath, boundary)
	errorAt, errorDetail, errorCode, errorOK := lastDisplayStreamErrorRecordAfter(logPath, boundary)
	if !frameOK || lastSentAt.IsZero() {
		if errorOK && time.Since(errorAt) <= displayStreamReadyAge {
			stream.Detail = errorDetail
			stream.ErrorCode = errorCode
			return stream
		}
		stream.Detail = "Display stream has not sent usage yet."
		return stream
	}
	stream.LastSentAt = lastSentAt.UTC().Format(time.RFC3339)
	stream.LastTarget = publicTarget(lastTarget)

	if stream.LastTarget != "" && !samePublicTarget(target, stream.LastTarget) {
		stream.Detail = "Display stream is sending to another VibeTV."
		return stream
	}
	if errorOK && errorAt.After(lastSentAt) && time.Since(errorAt) <= displayStreamReadyAge {
		stream.Detail = errorDetail
		stream.ErrorCode = errorCode
		return stream
	}
	if time.Since(lastSentAt) > displayStreamReadyAge {
		stream.Detail = "Last usage frame is too old."
		return stream
	}

	stream.Healthy = true
	stream.Detail = "Display stream is sending usage frames."
	return stream
}

func waitForDisplayStream(ctx context.Context, target string) displayStreamInfo {
	return waitForDisplayStreamAfter(ctx, target, time.Time{})
}

func waitForDisplayStreamAfter(ctx context.Context, target string, notBefore time.Time) displayStreamInfo {
	return waitForDisplayStreamAfterMode(ctx, target, notBefore, true)
}

func waitForDisplayStreamAfterPair(ctx context.Context, target string, notBefore time.Time) displayStreamInfo {
	return waitForDisplayStreamAfterMode(ctx, target, notBefore, false)
}

func waitForDisplayStreamAfterMode(ctx context.Context, target string, notBefore time.Time, stopOnPairingError bool) displayStreamInfo {
	return waitForDisplayStreamAfterProbe(ctx, target, notBefore, stopOnPairingError, inspectDisplayStreamAfter)
}

func waitForDisplayStreamAfterProbe(
	ctx context.Context,
	target string,
	notBefore time.Time,
	stopOnPairingError bool,
	inspect func(context.Context, string, time.Time) displayStreamInfo,
) displayStreamInfo {
	deadline := time.Now().Add(displayStreamWaitTime)
	var last displayStreamInfo
	for {
		last = inspect(ctx, target, notBefore)
		if last.Healthy || (stopOnPairingError && last.ErrorCode == "device_pairing_required") ||
			time.Now().After(deadline) {
			return last
		}
		select {
		case <-ctx.Done():
			return last
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (s *Server) waitForFreshDisplayStream(ctx context.Context, target string, notBefore time.Time) displayStreamInfo {
	if s.waitStreamAfter != nil {
		return s.waitStreamAfter(ctx, target, notBefore)
	}
	return s.waitStream(ctx, target)
}

func (s *Server) waitForFreshDisplayStreamAfterPair(ctx context.Context, target string, notBefore time.Time) displayStreamInfo {
	if s.waitStreamAfterPair != nil {
		return s.waitStreamAfterPair(ctx, target, notBefore)
	}
	return s.waitForFreshDisplayStream(ctx, target, notBefore)
}

func parseDisplayStreamLaunchState(output string) string {
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(raw)
		if !strings.HasPrefix(line, "state = ") {
			continue
		}
		return strings.TrimSpace(strings.TrimPrefix(line, "state = "))
	}
	return ""
}

func displayStreamLaunchStateRunning(state string) bool {
	switch strings.TrimSpace(state) {
	case "running", "waiting", "spawn scheduled":
		return true
	default:
		return false
	}
}

func displayStreamLaunchAgentLabel() string {
	return runtimepaths.DisplayStreamLaunchAgentLabel()
}

func lastDisplayStreamFrame(path string) (time.Time, string) {
	when, target, _, ok := lastDisplayStreamFrameLine(path)
	if !ok {
		return time.Time{}, ""
	}
	return when, target
}

func lastDisplayStreamFrameSnapshotAfter(path string, boundary time.Time) (time.Time, protocol.Frame, bool) {
	when, _, line, ok := lastDisplayStreamFrameLineAfter(path, boundary)
	if !ok {
		return time.Time{}, protocol.Frame{}, false
	}
	frame, ok := frameFromDisplayStreamLogLine(line)
	if !ok {
		return time.Time{}, protocol.Frame{}, false
	}
	return when, frame, true
}

func lastDisplayStreamFrameLine(path string) (time.Time, string, string, bool) {
	boundary, ok := displayStreamLogBoundary(path)
	if !ok {
		return time.Time{}, "", "", false
	}
	return lastDisplayStreamFrameLineAfter(path, boundary)
}

func lastDisplayStreamFrameLineAfter(path string, boundary time.Time) (time.Time, string, string, bool) {
	for _, candidate := range displayStreamLogCandidates(path) {
		data, err := readDisplayStreamLogTail(candidate)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for i := len(lines) - 1; i >= 0; i-- {
			line := strings.TrimSpace(lines[i])
			if !strings.Contains(line, "sent frame -> ") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) == 0 {
				continue
			}
			when, err := time.Parse(time.RFC3339Nano, parts[0])
			if err != nil {
				continue
			}
			if !boundary.IsZero() && when.Before(boundary) {
				continue
			}
			after := strings.TrimSpace(strings.SplitN(line, "sent frame -> ", 2)[1])
			target := ""
			if fields := strings.Fields(after); len(fields) > 0 {
				target = fields[0]
			}
			return when, target, line, true
		}
	}
	return time.Time{}, "", "", false
}

func lastDisplayStreamError(path string) (time.Time, string, bool) {
	boundary, ok := displayStreamLogBoundary(path)
	if !ok {
		return time.Time{}, "", false
	}
	return lastDisplayStreamErrorAfter(path, boundary)
}

func lastDisplayStreamErrorAfter(path string, boundary time.Time) (time.Time, string, bool) {
	when, detail, _, ok := lastDisplayStreamErrorRecordAfter(path, boundary)
	return when, detail, ok
}

func lastDisplayStreamErrorRecordAfter(path string, boundary time.Time) (time.Time, string, string, bool) {
	for _, candidate := range displayStreamLogCandidates(path) {
		data, err := readDisplayStreamLogTail(candidate)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for i := len(lines) - 1; i >= 0; i-- {
			line := strings.TrimSpace(lines[i])
			if !strings.Contains(line, "cycle error:") && !strings.Contains(line, "cycle timeout:") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) == 0 {
				continue
			}
			when, err := time.Parse(time.RFC3339Nano, parts[0])
			if err != nil {
				continue
			}
			if !boundary.IsZero() && when.Before(boundary) {
				continue
			}
			op := displayStreamLogValue(line, "op")
			detail := "Display stream hit an error after the last frame and is reconnecting."
			code := "display_stream_failed"
			if op == "send-line" {
				detail = "Display stream could not send to VibeTV and is reconnecting."
				code = "display_send_failed"
			} else if op == "resolve-target" {
				detail = "Display stream could not find VibeTV and is reconnecting."
				code = "device_not_found"
			} else if strings.Contains(line, "cycle timeout:") {
				detail = "Display stream timed out and is reconnecting."
				code = "display_stream_timeout"
			}
			lower := strings.ToLower(line)
			if strings.Contains(lower, "status=401") ||
				strings.Contains(lower, "pairing token required") ||
				strings.Contains(lower, "unauthorized") {
				detail = "VibeTV rejected the saved pairing token."
				code = "device_pairing_required"
			}
			return when, detail, code, true
		}
	}
	return time.Time{}, "", "", false
}

func displayStreamLogBoundary(path string) (time.Time, bool) {
	if !runtimepaths.DisplayStreamRequiresStartMarker() {
		return time.Time{}, true
	}
	return latestDisplayStreamStartMarker(path, displayStreamLaunchAgentLabel())
}

func latestDisplayStreamStartMarker(path, expectedLabel string) (time.Time, bool) {
	expectedLabel = strings.TrimSpace(expectedLabel)
	if expectedLabel == "" {
		return time.Time{}, false
	}
	var latest time.Time
	for _, candidate := range displayStreamLogCandidates(path) {
		data, err := readDisplayStreamLogTail(candidate)
		if err != nil {
			continue
		}
		for _, rawLine := range strings.Split(string(data), "\n") {
			line := strings.TrimSpace(rawLine)
			if !strings.Contains(line, "runtime event=stream-start") || displayStreamLogValue(line, "label") != expectedLabel {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) == 0 {
				continue
			}
			when, err := time.Parse(time.RFC3339Nano, parts[0])
			if err == nil && when.After(latest) {
				latest = when
			}
		}
	}
	return latest, !latest.IsZero()
}

func displayStreamLogCandidates(path string) []string {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	return []string{path, runtimepaths.DisplayStreamOutLogArchive(path)}
}

func readDisplayStreamLogTail(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	limit := runtimepaths.DisplayStreamLogTailBytes
	start := info.Size() - limit
	if start < 0 {
		start = 0
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, limit))
	if err != nil {
		return nil, err
	}
	if start > 0 {
		if newline := bytes.IndexByte(data, '\n'); newline >= 0 {
			data = data[newline+1:]
		} else {
			data = nil
		}
	}
	return data, nil
}

func frameFromDisplayStreamLogLine(line string) (protocol.Frame, bool) {
	session, hasSession := intFieldFromDisplayStreamLog(line, "session")
	weekly, hasWeekly := intFieldFromDisplayStreamLog(line, "weekly")
	if !hasSession || !hasWeekly {
		return protocol.Frame{}, false
	}

	frame := protocol.Frame{
		V:         protocol.ProtocolVersionV1,
		Provider:  displayStreamLogValue(line, "provider"),
		Label:     displayStreamLogValue(line, "label"),
		Session:   session,
		Weekly:    weekly,
		UsageMode: displayStreamLogValue(line, "usageMode"),
		Activity:  displayStreamLogValue(line, "activity"),
		Time:      displayStreamLogValue(line, "time"),
		Date:      displayStreamLogValue(line, "date"),
		Error:     displayStreamLogValue(line, "error"),
	}
	if reset, ok := int64FieldFromDisplayStreamLog(line, "reset"); ok {
		frame.ResetSec = reset
	}
	return frame.Normalize(), true
}

func intFieldFromDisplayStreamLog(line, key string) (int, bool) {
	value := strings.TrimSuffix(displayStreamLogValue(line, key), "s")
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func int64FieldFromDisplayStreamLog(line, key string) (int64, bool) {
	value := strings.TrimSuffix(displayStreamLogValue(line, key), "s")
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func displayStreamLogValue(line, key string) string {
	marker := key + "="
	start := strings.Index(line, marker)
	if start < 0 {
		return ""
	}
	start += len(marker)
	rest := line[start:]
	end := len(rest)
	for _, nextKey := range displayStreamLogKeys {
		nextMarker := " " + nextKey + "="
		if idx := strings.Index(rest, nextMarker); idx >= 0 && idx < end {
			end = idx
		}
	}
	return strings.Trim(strings.TrimSpace(rest[:end]), `"`)
}

func displayStreamOutLogPath() string {
	return runtimepaths.DisplayStreamOutLog("")
}

func samePublicTarget(left, right string) bool {
	return publicTarget(left) == publicTarget(right)
}

func displayStreamDiagnosticDetail(stream *displayStreamInfo) string {
	if stream == nil || strings.TrimSpace(stream.Detail) == "" {
		return "Display stream is not ready."
	}
	return stream.Detail
}

func deviceFromHello(target, token string, hello protocol.DeviceHello) deviceInfo {
	hello = hello.Normalize()
	caps := protocol.CapabilitiesFromHello(hello)
	var capabilityBlock *protocol.CapabilityBlock
	if caps.Known {
		capabilityBlock = &hello.Capabilities
	}
	return deviceInfo{
		Target:       publicTarget(target),
		DeviceID:     hello.DeviceID,
		NetworkMode:  hello.NetworkMode,
		Connected:    caps.Known,
		Paired:       strings.TrimSpace(token) != "",
		Board:        caps.Board,
		Firmware:     caps.Firmware,
		Capabilities: capabilityBlock,
	}
}

func endpoint(target, path string) string {
	base := normalizeTarget(target)
	return strings.TrimRight(base, "/") + path
}

func normalizeTarget(target string) string {
	target = strings.TrimSpace(target)
	if target == "" {
		return ""
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return target
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func normalizeExplicitDeviceTarget(target string) (string, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return "", &invalidTargetError{}
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return "", &invalidTargetError{target: target}
	}
	if parsed.User != nil || strings.TrimSpace(parsed.Host) == "" {
		return "", &invalidTargetError{target: target}
	}
	if !validExplicitTargetPort(parsed) {
		return "", &invalidTargetError{target: target}
	}
	if !strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https") {
		return "", &invalidTargetError{target: target}
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", &invalidTargetError{target: target}
	}
	if strings.TrimSpace(parsed.RawQuery) != "" || strings.TrimSpace(parsed.Fragment) != "" {
		return "", &invalidTargetError{target: target}
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return parsed.String(), nil
}

func validExplicitTargetPort(parsed *url.URL) bool {
	port := parsed.Port()
	if port == "" {
		return !strings.HasSuffix(parsed.Host, ":")
	}
	value, err := strconv.Atoi(port)
	return err == nil && value > 0 && value <= 65535
}

func publicTarget(target string) string {
	target = normalizeTarget(target)
	if target == "" {
		return ""
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return target
	}
	parsed.User = nil
	return parsed.String()
}

func targetWithToken(target, token string) string {
	base := normalizeTarget(target)
	token = strings.TrimSpace(token)
	if base == "" || token == "" {
		return base
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return base
	}
	query := parsed.Query()
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func applyDeviceToken(req *http.Request, token string) {
	if token = strings.TrimSpace(token); token != "" {
		req.Header.Set("X-VibeTV-Token", token)
		// ESP8266WebServer 3.1.2 does not reliably retain custom headers on every
		// route. Keep the header for compatible firmware, and also send the token
		// through the firmware's existing query fallback used by the display
		// stream. This makes /hello token verification reliable on real hardware.
		query := req.URL.Query()
		query.Set("token", token)
		req.URL.RawQuery = query.Encode()
	}
}

func localSubnetTargets() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var targets []string
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ip, _, ok := addrToIPv4(addr)
			if !ok {
				continue
			}
			for host := 1; host <= 254; host++ {
				if int(ip[3]) == host {
					continue
				}
				targets = append(targets, fmt.Sprintf("http://%d.%d.%d.%d", ip[0], ip[1], ip[2], host))
			}
		}
	}
	return uniqueStrings(targets...)
}

func addrToIPv4(addr net.Addr) (net.IP, *net.IPNet, bool) {
	var ip net.IP
	var network *net.IPNet
	switch value := addr.(type) {
	case *net.IPNet:
		ip = value.IP
		network = value
	case *net.IPAddr:
		ip = value.IP
	default:
		return nil, nil, false
	}
	ip = ip.To4()
	if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || !ip.IsPrivate() {
		return nil, nil, false
	}
	return ip, network, true
}

func uniqueStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = normalizeTarget(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
