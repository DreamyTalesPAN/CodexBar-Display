package companionapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

const (
	DefaultAddr              = "127.0.0.1:47832"
	appOrigin                = "https://app.vibetv.shop"
	defaultDevOrigin         = "http://localhost:3000"
	previewOriginHostPrefix  = "codex-vibetv-control-center-"
	previewOriginHostSuffix  = "-paul-anduschus-projects.vercel.app"
	nativeControlCenterUA    = "VibeTVControlCenter/"
	deviceConnectionReady    = "ready"
	deviceConnectionRetrying = "reconnecting"
	deviceConnectionSetup    = "setup_required"
	cableDeviceTarget        = "cable://vibetv"
	cableRescueTarget        = "cable-rescue://vibetv"
	deviceTimeout            = 15 * time.Second
	deviceSearchWindow       = 30 * time.Second
	cableTransitionWait      = 55 * time.Second
	repairRequestTimeout     = 110 * time.Second
	// Device requests are serialized because the ESP8266 serves one request at
	// a time. A read-only probe can therefore wait behind a frame render before
	// it reaches the device; keep this below the client timeout, but long enough
	// to cover the normal render acknowledgement on stored themes.
	discoveryProbeTime        = 12 * time.Second
	deviceProbeCacheTime      = 750 * time.Millisecond
	repairDiscoveryAttempts   = 3
	repairDiscoveryRetryGap   = 1200 * time.Millisecond
	subnetProbeLimit          = 64
	maxSubnetDiscoveryPrefix  = 23
	maxSubnetDiscoveryTargets = 510
	themeInstallDisableEnv    = "VIBETV_DISABLE_WIFI_THEME_INSTALL"
	macAppUpdateDisableEnv    = "VIBETV_DISABLE_MAC_APP_SELF_UPDATE"
	displayStreamLegacyLabel  = runtimepaths.LegacyDisplayStreamLaunchAgentLabel
	displayStreamLabelEnv     = runtimepaths.DisplayStreamLaunchAgentLabelEnv
	displayStreamOutLogEnv    = runtimepaths.DisplayStreamOutLogEnv
	displayStreamReadyAge     = 2 * time.Minute
	// deviceConnectedGraceWindow keeps a just-seen device Connected (state
	// "reconnecting") through transient probe misses: 2.5x the 30s WiFi
	// interval. Long enough to absorb single misses, short enough that a
	// powered-off device reads disconnected well under two minutes.
	deviceConnectedGraceWindow   = 75 * time.Second
	displayVerificationAge       = 2 * time.Minute
	themeInstallStreamWaitTime   = 5 * time.Minute
	themeInstallJobTime          = 7 * time.Minute
	displayRenderWaitTime        = 12 * time.Second
	defaultPairAttempts          = 3
	defaultPairAttemptTimeout    = 5 * time.Second
	defaultPairRetryGap          = 500 * time.Millisecond
	firmwareUpdateJobTime        = 10 * time.Minute
	themeRenderPackDir           = "theme-render-packs"
	themeRenderPackRevisionLimit = 12
	macAppInstallerURL           = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh"
	macAppReleaseAPIEnvVar       = "CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL"
	macAppReleaseAPIURL          = "https://api.github.com/repos/DreamyTalesPAN/CodexBar-Display/releases/latest"
	macAppReleaseCheckGap        = 6 * time.Hour
	macAppReleaseTimeout         = 5 * time.Second
	macAppVersionEnv             = "VIBETV_MAC_APP_VERSION"
	macAppBuildEnv               = "VIBETV_MAC_APP_BUILD"
	firmwareManifestEnvVar       = "CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL"
	firmwareReleaseTimeout       = 5 * time.Second
	themePackUploadReadTime      = 30 * time.Second
)

var deviceHealthProbeTime = 2 * time.Second
var diagnosticsDiscoveryTime = 5 * time.Second

type Options struct {
	Addr                 string
	Home                 string
	AllowedOrigins       []string
	ControlCenterFS      fs.FS
	HTTPClient           *http.Client
	RefreshDisplayStream func(context.Context, string) error
	PauseDisplayStream   func(bool)
	WakeDisplayStream    func()
	RenderDisplayStream  func()
	// RestartUsageService replaces the running CodexBar serve with a fresh
	// one when CodexBar's config changed after it started, and waits until it
	// answers. Nil when no serve is supervised.
	RestartUsageService func(context.Context) error
	// ReplaceUsageService replaces the running CodexBar serve even when its
	// config is unchanged, and waits until the new one answers. Nil when no
	// serve is supervised.
	ReplaceUsageService func(context.Context) error
	// UsageServiceInfo reports the supervised CodexBar serve. Nil when no
	// serve is supervised.
	UsageServiceInfo func() codexbar.DashboardServeInfo
	// Supplied only by the process supervising the actual worker. Running alone
	// never establishes frame freshness or device readiness.
	DisplayStreamRunning func() bool
	// Logf writes one line to the runtime's log. Nil outside the runtime.
	Logf func(string, ...any)
	// SystemBusy is the display worker's latest busy-computer verdict
	// (#606). Nil outside the runtime.
	SystemBusy func() *daemon.SystemBusy
	// Where Theme Studio keeps the customer's verified OpenAI key across
	// restarts. Nil (tests, tools) keeps it in memory only.
	AIThemeSecrets SecretStore
}

type Server struct {
	aiThemeServer          *aiThemeServer
	logf                   func(string, ...any)
	addr                   string
	home                   string
	allowedOrigins         map[string]struct{}
	controlCenterFS        fs.FS
	client                 *http.Client
	loadConfig             func(string) (runtimeconfig.Config, error)
	saveConfig             func(string, runtimeconfig.Config) error
	installTheme           func(context.Context, themeinstall.Options) (themeinstall.Result, error)
	runSetup               func(context.Context, setup.Options) error
	resolveCablePort       func(string, string) (string, error)
	cablePortVanished      func() error
	lastCablePort          func() string
	listCablePorts         func() ([]string, error)
	discoverCableDevices   func(context.Context) ([]usb.CableDevice, error)
	readCableHello         func(string) (protocol.DeviceHello, error)
	currentCableHello      func() (protocol.DeviceHello, bool)
	refreshCableHello      func() (protocol.DeviceHello, bool)
	resetCableSender       func()
	setCableConnectionMode func(string, string, string) error
	confirmCableMode       func(string, string) error
	pairCableDevice        func(string, string) (string, error)
	readCableHealth        func(string, string) (deviceHealth, error)
	readCableSettings      func(string, string) (protocol.DeviceSettings, error)
	writeCableSettings     func(string, string, protocol.DeviceSettingsPatch) (protocol.DeviceSettings, error)
	configureCableWiFi     func(string, string, string, string) error
	factoryResetCable      func(string, string) error
	scanCableWiFi          func(string, string) ([]protocol.WiFiNetwork, error)
	sendCableLine          func(string, []byte) error
	prepareCableTheme      func(context.Context, string, string, string, string) error
	transferCableAsset     func(context.Context, string, string, string, string, string, []byte) error
	subnetTargets          func() []string
	localNetworkAvailable  func() bool
	defaultWiFiTarget      func() string
	streamStatus           func(context.Context, string) displayStreamInfo
	waitStream             func(context.Context, string) displayStreamInfo
	waitStreamAfter        func(context.Context, string, time.Time) displayStreamInfo
	waitStreamAfterPair    func(context.Context, string, time.Time) displayStreamInfo
	waitRender             func(context.Context, string, string, deviceHealth) (deviceHealth, error)
	refreshStream          func(context.Context, string) error
	pauseDisplayStream     func(bool)
	wakeDisplayStream      func()
	renderDisplayStream    func()
	restartUsageService    func(context.Context) error
	freshUsageService      func(context.Context) error
	usageServiceInfo       func() codexbar.DashboardServeInfo
	usageServiceRestarting atomic.Bool
	// A successful check that arrived while a replacement was running.
	usageServiceRestartPending atomic.Bool
	// A browser sign-in read asked for a fresh usage service on unchanged settings.
	usageServiceReplacePending atomic.Bool
	// Held while a finished check's follow-up runs after its revision check, so
	// a switch of the provider cannot slip in between (#805 Codex review).
	providerFollowupMu sync.Mutex
	// Test hook: runs where a finished check is about to follow up.
	providerRetryFollowupHook func()
	// providerFollowupHeldHook runs inside whileProviderRevision after the
	// revision check passed, while providerFollowupMu is held (tests only).
	providerFollowupHeldHook func()
	displayStreamRunning     func() bool
	systemBusy               func() *daemon.SystemBusy
	firmwareUpdateActive     atomic.Bool
	firmwareUpdateStartMu    sync.Mutex
	// One shortcut press at a time: each reads the provider on screen and
	// stores its successor, so two quick presses must not read the same one.
	providerDisplayNextMu sync.Mutex
	// Serial ports already asked on behalf of a legacy WiFi VibeTV.
	legacyCableProbeMu     sync.Mutex
	legacyCableProbePorts  string
	legacyCableProbeTries  int
	legacyCableProbeBusy   int
	legacyCableProbeAt     time.Time
	updateHoldUntil        time.Time
	updateHoldRefusals     atomic.Uint64
	configMu               sync.Mutex
	repairMu               sync.Mutex
	repairFlightsMu        sync.Mutex
	repairFlights          map[string]*deviceRepairFlight
	deviceSelectionMu      sync.Mutex
	ambiguousDeviceSeen    bool
	helloProbes            *probeCache[protocol.DeviceHello]
	healthProbes           *probeCache[deviceHealth]
	probeCacheTime         time.Duration
	weakWiFiMu             sync.Mutex
	weakWiFi               weakWiFiRun
	connectionMu           sync.Mutex
	connectionStates       map[string]*configuredDeviceConnection
	now                    func() time.Time
	deviceMaintenanceMu    sync.Mutex
	pairMu                 sync.Mutex
	verificationMu         sync.Mutex
	displayVerifications   map[string]displayVerification
	pairAttempts           int
	pairAttemptTimeout     time.Duration
	pairRetryGap           time.Duration
	installationMode       string
	loadUsage              func(time.Time) (daemon.PersistedUsage, bool)
	loadCollectorCycle     func() (daemon.CollectorCycle, bool)
	probeProviderSetup     func(context.Context, string) codexbar.ProviderSetup
	probeExactProvider     func(context.Context, string, string) codexbar.ProviderSetup
	providerSetupMu        sync.Mutex
	exactProviderProbeMu   sync.Mutex
	exactProviderProbes    map[string]*exactProviderProbeFlight
	providerSetupRefresh   atomic.Bool
	providerSetupCache     codexbar.ProviderSetup
	providerSetupCachedAt  time.Time
	providerReadinessMu    sync.Mutex
	providerReadiness      map[string]providerReadinessRecord
	usageRefreshMu         sync.Mutex
	usageRefresh           usageRefreshTracker
	providerPreferences    providerPreferencesState
	preferenceAdapters     []preferenceAdapter
	updateFirmware         func(context.Context, string, runtimeconfig.Config, firmwareUpdateRequest, io.Writer) error
	fetchMacAppRelease     func(context.Context) (githubRelease, error)
	installJobsMu          sync.Mutex
	installJobs            map[string]*themeInstallJob
	themeInstallActive     bool
	nextInstallJob         uint64
	updateJobsMu           sync.Mutex
	updateJobs             map[string]*firmwareUpdateJob
	nextUpdateJob          uint64
	macAppReleaseMu        sync.Mutex
	macAppReleaseChecked   bool
	macAppReleaseCheckedAt time.Time
	macAppReleaseCache     companionReleaseInfo
	setupEvents            setupEventLog
	timeline               *timeline.Store

	// When the Mac app last reported a browser sign-in read, per provider.
	browserSignInReadMu sync.Mutex
	browserSignInReadAt map[string]time.Time
}

type apiError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	NextAction string `json:"nextAction"`
	// Device is the VibeTV the error is about, when setup can still act on it.
	Device *deviceSearchEntry `json:"device,omitempty"`
}

type errorResponse struct {
	OK    bool     `json:"ok"`
	Error apiError `json:"error"`
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
	if permissionsErr := runtimeconfig.RestrictPermissions(home); permissionsErr != nil {
		return nil, fmt.Errorf("restrict runtime config permissions: %w", permissionsErr)
	}
	if _, recoverErr := runtimeconfig.RecoverPendingDeviceSelection(home); recoverErr != nil {
		return nil, fmt.Errorf("recover pending device selection: %w", recoverErr)
	}
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: deviceTimeout}
	}
	client = transportlayer.SerializeDeviceHTTPClient(client)
	origins := map[string]struct{}{
		appOrigin:        {},
		defaultDevOrigin: {},
		"http://" + addr: {},
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
	ai := &aiThemeServer{aiTheme: newAIThemeState(nil, nil)}
	ai.aiTheme.enabled = true
	ai.aiTheme.rememberAcross(opts.AIThemeSecrets)
	// The runtime that owns the display stream holds the display writer lock,
	// so there is one of it per home folder. Only that one saves the setup
	// log and the timeline; an API server beside it reads them.
	displayWriter := opts.PauseDisplayStream != nil
	openTimeline := timeline.OpenReadOnly
	if displayWriter {
		openTimeline = timeline.Open
	}
	server := &Server{
		aiThemeServer:          ai,
		addr:                   addr,
		home:                   home,
		setupEvents:            setupEventLog{path: runtimepaths.Path(home, "setup-log.json"), readOnly: !displayWriter},
		timeline:               openTimeline(runtimepaths.Path(home, "timeline.json")),
		allowedOrigins:         origins,
		controlCenterFS:        controlCenterFS,
		client:                 client,
		loadConfig:             runtimeconfig.Load,
		saveConfig:             runtimeconfig.Save,
		installTheme:           themeinstall.Install,
		runSetup:               setup.Run,
		resolveCablePort:       usb.ResolveVibeTVControlPort,
		cablePortVanished:      usb.OpenCablePortVanished,
		lastCablePort:          usb.LastCablePort,
		listCablePorts:         usb.ListPorts,
		discoverCableDevices:   usb.DiscoverVibeTVs,
		readCableHello:         usb.ReadDeviceHello,
		currentCableHello:      usb.CurrentDeviceHello,
		refreshCableHello:      refreshDefaultCableHello,
		resetCableSender:       usb.CloseDefaultSender,
		setCableConnectionMode: usb.SetConnectionMode,
		confirmCableMode:       usb.ConfirmConnectionMode,
		pairCableDevice:        usb.PairDevice,
		readCableHealth:        readCableDeviceHealth,
		readCableSettings:      usb.ReadSettings,
		writeCableSettings:     usb.WriteSettings,
		configureCableWiFi:     usb.ConfigureWiFi,
		factoryResetCable:      usb.FactoryReset,
		scanCableWiFi:          usb.ScanWiFi,
		sendCableLine:          usb.SendLine,
		prepareCableTheme:      usb.PrepareThemeInstall,
		transferCableAsset:     usb.TransferAsset,
		subnetTargets:          localSubnetTargets,
		localNetworkAvailable:  hostHasUsableNetwork,
		defaultWiFiTarget:      setup.DefaultWiFiTarget,
		streamStatus: func(ctx context.Context, target string) displayStreamInfo {
			return inspectDisplayStreamAfterRunning(ctx, target, time.Time{}, opts.DisplayStreamRunning)
		},
		waitRender:           nil,
		refreshStream:        opts.RefreshDisplayStream,
		pauseDisplayStream:   opts.PauseDisplayStream,
		wakeDisplayStream:    opts.WakeDisplayStream,
		renderDisplayStream:  opts.RenderDisplayStream,
		restartUsageService:  opts.RestartUsageService,
		freshUsageService:    opts.ReplaceUsageService,
		usageServiceInfo:     opts.UsageServiceInfo,
		displayStreamRunning: opts.DisplayStreamRunning,
		systemBusy:           opts.SystemBusy,
		pairAttempts:         defaultPairAttempts,
		pairAttemptTimeout:   defaultPairAttemptTimeout,
		pairRetryGap:         defaultPairRetryGap,
		repairFlights:        make(map[string]*deviceRepairFlight),
		helloProbes:          newProbeCache[protocol.DeviceHello](),
		healthProbes:         newProbeCache[deviceHealth](),
		probeCacheTime:       deviceProbeCacheTime,
		connectionStates:     make(map[string]*configuredDeviceConnection),
		now:                  time.Now,
		displayVerifications: make(map[string]displayVerification),
		installationMode:     macAppInstallationMode(),
		loadUsage:            daemon.LoadPersistedUsage,
		loadCollectorCycle:   daemon.LoadCollectorCycle,
		logf:                 opts.Logf,
		probeProviderSetup:   codexbar.ProbeProviderSetup,
		probeExactProvider:   codexbar.ProbeProviderSetupForProvider,
		exactProviderProbes:  make(map[string]*exactProviderProbeFlight),
		providerPreferences: providerPreferencesState{
			load:          codexbar.FetchProviderSettings,
			set:           codexbar.SetProviderEnabled,
			loadInventory: codexbar.FetchProviderInventory,
		},
		updateFirmware:     firmwareUpdateCommandRunner(opts.PauseDisplayStream != nil),
		fetchMacAppRelease: fetchLatestMacAppRelease,
		installJobs:        make(map[string]*themeInstallJob),
		updateJobs:         make(map[string]*firmwareUpdateJob),
	}
	return server, nil
}

func (s *Server) ListenAndServe(ctx context.Context) error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}
	return s.Serve(ctx, listener)
}

func (s *Server) Serve(ctx context.Context, listener net.Listener) error {
	server := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		err := server.Serve(listener)
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
	s.aiThemeServer.registerAIThemeRoutes(mux)
	mux.HandleFunc("/v1/status", s.handleStatus)
	mux.HandleFunc("/v1/runtime-health", s.handleRuntimeHealth)
	mux.HandleFunc("/v1/runtime-health/update-hold", s.handleRuntimeUpdateHold)
	mux.HandleFunc("/v1/usage", s.handleUsage)
	mux.HandleFunc("/v1/preferences", s.handlePreferences)
	mux.HandleFunc("/v1/preferences/", s.handlePreference)
	mux.HandleFunc("/v1/provider-display", s.handleProviderDisplay)
	mux.HandleFunc("/v1/provider-display/next", s.handleProviderDisplayNext)
	mux.HandleFunc("/v1/display-frame/latest", s.handleDisplayFrameLatest)
	mux.HandleFunc("/v1/diagnostics", s.handleDiagnostics)
	mux.HandleFunc("/v1/providers/retry", s.handleProviderRetry)
	mux.HandleFunc("/v1/providers/sign-in", s.handleProviderSignIn)
	mux.HandleFunc("/v1/providers/setup-guide", s.handleProviderSetupGuide)
	mux.HandleFunc("/v1/device/discover", s.handleDeviceDiscover)
	mux.HandleFunc("/v1/device/search", s.setupStep("device_search", "Searching for VibeTV.", "", s.handleDeviceSearch))
	mux.HandleFunc("/v1/device/select", s.setupStep("device_select", "Connecting to the selected VibeTV.", "VibeTV connected.", s.handleDeviceSelect))
	mux.HandleFunc("/v1/device/repair", s.setupStep("device_pair", "Repairing the VibeTV connection.", "", s.handleDeviceRepair))
	mux.HandleFunc("/v1/device/reload-display", s.handleDeviceReloadDisplay)
	mux.HandleFunc("/v1/device", s.handleDevice)
	mux.HandleFunc("/v1/device/pair", s.setupStep("device_pair", "Pairing with VibeTV.", "VibeTV paired.", s.handleDevicePair))
	mux.HandleFunc("/v1/device/factory-reset", s.handleDeviceFactoryReset)
	mux.HandleFunc("/v1/setup/connection-mode", s.setupStep("connection_mode", "Changing how VibeTV connects.", "Connection choice saved.", s.handleSetupConnectionMode))
	mux.HandleFunc("/v1/setup/wifi-networks", s.handleSetupWiFiNetworks)
	mux.HandleFunc("/v1/setup/wifi", s.setupStep("wifi_setup", "Sending WiFi details to VibeTV.", "VibeTV received the WiFi details.", s.handleSetupWiFi))
	mux.HandleFunc("/v1/setup/reset", s.handleSetupReset)
	mux.HandleFunc("/v1/setup/events", s.handleSetupEvents)
	mux.HandleFunc("/v1/setup/providers/complete", s.setupStep("provider_setup", "", "AI provider setup complete.", s.handleProviderSetupComplete))
	mux.HandleFunc("/v1/settings", s.handleSettings)
	mux.HandleFunc("/v1/themes/install", s.setupStep("theme_install", "", "", s.handleThemeInstall))
	mux.HandleFunc("/v1/themes/install/status", s.handleThemeInstallStatus)
	mux.HandleFunc("/v1/updates/latest", s.handleFirmwareLatest)
	mux.HandleFunc("/v1/updates/install", s.setupStep("firmware_update", "Starting the VibeTV update.", "", s.handleFirmwareUpdateInstall))
	mux.HandleFunc("/v1/updates/install/status", s.handleFirmwareUpdateStatus)
	return s.withCORS(mux)
}

func (s *Server) currentTime() time.Time {
	if s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
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
	cfg.Normalize()
	return cfg, nil
}

func (s *Server) updateConfig(mutate func(*runtimeconfig.Config)) (runtimeconfig.Config, error) {
	s.configMu.Lock()
	defer s.configMu.Unlock()
	var updated runtimeconfig.Config
	err := runtimeconfig.WithConfigLock(s.home, func() error {
		cfg, err := s.loadConfigNormalized()
		if err != nil {
			return err
		}
		if mutate != nil {
			mutate(&cfg)
		}
		cfg.Normalize()
		if err := s.saveConfig(s.home, cfg); err != nil {
			return err
		}
		updated = cfg
		return nil
	})
	return updated, err
}
