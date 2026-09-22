package codexbar

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/childproc"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

var knownBinaryPaths = []string{
	"/opt/homebrew/bin/codexbar",
	"/usr/local/bin/codexbar",
	"/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI",
	"/Applications/CodexBar.app/Contents/MacOS/CodexBar",
}

var systemAppBinaryPaths = []string{
	"/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI",
	"/Applications/CodexBar.app/Contents/MacOS/CodexBar",
}

var (
	ErrNoProviders             = errors.New("codexbar returned no providers")
	ErrUnexpectedProviderShape = errors.New("unexpected provider payload")
	errGlobalCLI               = errors.New("codexbar returned a global cli error")
)

var runUsageCommandFn = runUsageCommand
var runCostCommandFn = runUsageCommand
var runVersionCommandFn = runUsageCommand
var executablePathFn = os.Executable

const (
	minSupportedVersionString      = "0.23"
	minDashboardSnapshotAPIVersion = "0.44.0"
	versionCheckTimeout            = 2 * time.Second
)

const usageModeEnvVar = "CODEXBAR_DISPLAY_USAGE_MODE"
const appManagedCodexBarVersionEnvVar = "VIBETV_CODEXBAR_PINNED_VERSION"

type FetchErrorKind string

const (
	FetchErrorUnknown     FetchErrorKind = "unknown"
	FetchErrorBinary      FetchErrorKind = "binary"
	FetchErrorCommand     FetchErrorKind = "command"
	FetchErrorParse       FetchErrorKind = "parse"
	FetchErrorNoProviders FetchErrorKind = "no-providers"
	FetchErrorVersion     FetchErrorKind = "version"
)

type FetchError struct {
	Kind FetchErrorKind
	Err  error
}

func (e *FetchError) Error() string {
	if e == nil {
		return ""
	}
	if e.Err == nil {
		return fmt.Sprintf("fetch error (%s)", e.Kind)
	}
	return e.Err.Error()
}

func (e *FetchError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func FetchErrorKindOf(err error) FetchErrorKind {
	var fetchErr *FetchError
	if errors.As(err, &fetchErr) && fetchErr != nil {
		return fetchErr.Kind
	}
	return FetchErrorUnknown
}

func wrapFetchError(kind FetchErrorKind, err error) error {
	if err == nil {
		return nil
	}
	return &FetchError{
		Kind: kind,
		Err:  err,
	}
}

func classifyParseError(err error) FetchErrorKind {
	if errors.Is(err, errGlobalCLI) {
		return FetchErrorCommand
	}
	if errors.Is(err, ErrNoProviders) {
		return FetchErrorNoProviders
	}
	return FetchErrorParse
}

func FindBinary() (string, error) {
	if version := strings.TrimSpace(os.Getenv(appManagedCodexBarVersionEnvVar)); version != "" {
		return findAppManagedBinary(version)
	}

	if env := strings.TrimSpace(os.Getenv("CODEXBAR_BIN")); env != "" {
		if isExecutable(env) {
			return env, nil
		}
		return "", fmt.Errorf("CODEXBAR_BIN is not executable: %s", env)
	}

	// The native Control Center ships CodexBarCLI next to codexbar-display.
	// Prefer that pinned copy over an unrelated Homebrew/PATH installation.
	if executable, err := executablePathFn(); err == nil {
		base := filepath.Dir(executable)
		for _, p := range []string{
			filepath.Join(base, "CodexBarCLI"),
			filepath.Join(base, "codexbar"),
			filepath.Join(base, "codexbar-cli.exe"),
			filepath.Join(base, "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"),
		} {
			if isExecutable(p) {
				return p, nil
			}
		}
	}

	home, _ := os.UserHomeDir()
	appCandidates := append([]string(nil), systemAppBinaryPaths...)
	if home != "" {
		appCandidates = append(appCandidates,
			filepath.Join(home, "Applications", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"),
			filepath.Join(home, "Applications", "CodexBar.app", "Contents", "MacOS", "CodexBar"),
		)
	}
	for _, p := range appCandidates {
		if isExecutable(p) {
			return p, nil
		}
	}

	if p, err := exec.LookPath("codexbar"); err == nil && p != "" {
		return p, nil
	}
	if p, err := exec.LookPath("codexbar-cli.exe"); err == nil && p != "" {
		return p, nil
	}

	candidates := append([]string(nil), knownBinaryPaths...)
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, "Downloads", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"),
			filepath.Join(home, "Downloads", "CodexBar.app", "Contents", "MacOS", "CodexBar"),
		)
	}
	for _, p := range candidates {
		if isExecutable(p) {
			return p, nil
		}
	}

	return "", errors.New("could not find CodexBar CLI binary")
}

func findAppManagedBinary(version string) (string, error) {
	_, bin, err := findAppManagedPayload(version)
	return bin, err
}

func findAppManagedPayload(version string) (string, string, error) {
	if !regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`).MatchString(version) {
		return "", "", fmt.Errorf("%s has invalid version: %s", appManagedCodexBarVersionEnvVar, version)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("resolve home directory for app-managed CodexBar: %w", err)
	}
	if strings.TrimSpace(home) == "" {
		return "", "", errors.New("home directory for app-managed CodexBar is empty")
	}
	app := filepath.Join(
		runtimepaths.Root(home),
		"CodexBar",
		version,
		"CodexBar.app",
	)
	bin := filepath.Join(
		app,
		"Contents",
		"Helpers",
		"CodexBarCLI",
	)
	if linkPath, err := firstSymlinkInPathUnder(home, bin); err != nil {
		return "", "", fmt.Errorf("verify app-managed CodexBar path: %w", err)
	} else if linkPath != "" {
		return "", "", fmt.Errorf("app-managed CodexBar path contains symlink: %s", linkPath)
	}
	if isExecutable(bin) {
		return app, bin, nil
	}
	return "", "", fmt.Errorf("app-managed CodexBar %s is not executable: %s", version, bin)
}

func MinimumSupportedVersion() string {
	return minSupportedVersionString
}

func CheckMinimumVersion(ctx context.Context, bin string) error {
	return checkMinimumVersion(ctx, bin, minSupportedVersionString, "")
}

func CheckDashboardSnapshotVersion(ctx context.Context, bin string) error {
	return checkMinimumVersion(ctx, bin, minDashboardSnapshotAPIVersion, "dashboard snapshot API")
}

func checkMinimumVersion(ctx context.Context, bin, minimumString, requirement string) error {
	version, err := installedVersion(ctx, bin)
	if err != nil {
		return err
	}
	minimum, err := parseLooseVersion(minimumString)
	if err != nil {
		return err
	}
	if version.Compare(minimum) < 0 {
		if requirement != "" {
			return fmt.Errorf("CodexBar %s is too old for the %s; need >= %s", version.String(), requirement, minimumString)
		}
		return fmt.Errorf("CodexBar %s is too old; need >= %s", version.String(), minimumString)
	}
	return nil
}

func InstalledVersion(ctx context.Context, bin string) (string, error) {
	version, err := installedVersion(ctx, bin)
	if err != nil {
		return "", err
	}
	return version.String(), nil
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	if info.IsDir() {
		return false
	}
	// Windows has no POSIX execute bits; the process launcher checks the format.
	return runtime.GOOS == "windows" || info.Mode()&0o111 != 0
}

func firstSymlinkInPathUnder(root, path string) (string, error) {
	cleanRoot := filepath.Clean(root)
	cleanPath := filepath.Clean(path)
	if cleanPath != cleanRoot && !strings.HasPrefix(cleanPath, cleanRoot+string(os.PathSeparator)) {
		return cleanPath, nil
	}
	if info, err := os.Lstat(cleanRoot); err != nil {
		if !os.IsNotExist(err) {
			return "", err
		}
	} else if info.Mode()&os.ModeSymlink != 0 {
		return cleanRoot, nil
	}
	rest := strings.TrimPrefix(cleanPath, cleanRoot)
	rest = strings.TrimPrefix(rest, string(os.PathSeparator))
	current := cleanRoot
	for _, component := range strings.Split(rest, string(os.PathSeparator)) {
		if component == "" || component == "." {
			continue
		}
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil {
			if os.IsNotExist(err) {
				return "", nil
			}
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return current, nil
		}
	}
	return "", nil
}

// FetchAllProviders reads provider usage from CodexBar and normalizes it.
func FetchAllProviders(ctx context.Context) ([]ParsedFrame, error) {
	bin, err := FindBinary()
	if err != nil {
		return nil, wrapFetchError(FetchErrorBinary, err)
	}
	if err := CheckMinimumVersion(ctx, bin); err != nil {
		return nil, wrapFetchError(FetchErrorVersion, err)
	}
	configPath, err := EnsureConfig("")
	if err != nil {
		return nil, wrapFetchError(FetchErrorCommand, err)
	}
	ctx = context.WithValue(ctx, configPathContextKey{}, configPath)

	timeout := commandTimeout()
	// Deliberately only the providers CodexBar already has switched on. The
	// first run used to ask for "--provider all" and then switch on everything
	// it could read, one sequential CLI write per provider: minutes of silence
	// before the customer saw a screen, then providers arriving and toggling
	// themselves on under their hands. Which providers are on is CodexBar's
	// own setting and the customer's choice, not something to seed from a probe.
	out, err := runUsageAllEnabled(ctx, timeout, bin, "--web-timeout", "8")
	allParsed, parseErr := parseAllProviders(out)

	if err != nil {
		if len(bytes.TrimSpace(out)) == 0 {
			return nil, wrapFetchError(FetchErrorCommand, fmt.Errorf("run codexbar usage --json: %w", err))
		}
		if parseErr != nil {
			return nil, wrapFetchError(classifyParseError(parseErr), fmt.Errorf("run codexbar usage --json: %w (stdout parse error: %v)", err, parseErr))
		}
	} else if parseErr != nil {
		return nil, wrapFetchError(classifyParseError(parseErr), parseErr)
	}

	for i := range allParsed {
		allParsed[i].Frame = allParsed[i].Frame.Normalize()
	}

	return allParsed, nil
}

// FetchFirstFrame returns one selected frame for one-shot calls (doctor/setup).
func FetchFirstFrame(ctx context.Context) (protocol.Frame, error) {
	all, err := FetchAllProviders(ctx)
	if err != nil {
		return protocol.Frame{}, err
	}
	selector := NewProviderSelector()
	selected, ok := selector.Select(all)
	if !ok {
		return protocol.Frame{}, ErrNoProviders
	}
	return selected.Frame, nil
}

// FetchProvider returns usage for a single provider using provider-scoped CodexBar calls.
// It is optimized for low-latency polling loops and honors the parent context deadline.
func FetchProvider(ctx context.Context, provider string) (ParsedFrame, error) {
	key := strings.TrimSpace(strings.ToLower(provider))
	if key == "" {
		return ParsedFrame{}, wrapFetchError(FetchErrorParse, errors.New("provider key is empty"))
	}

	bin, err := FindBinary()
	if err != nil {
		return ParsedFrame{}, wrapFetchError(FetchErrorBinary, err)
	}
	if err := CheckMinimumVersion(ctx, bin); err != nil {
		return ParsedFrame{}, wrapFetchError(FetchErrorVersion, err)
	}

	timeout := commandTimeout()
	parsed, err := fetchProviderScopedUsageDetailed(ctx, providerScopedFallbackTimeout(timeout), bin, key, providerScopedWebTimeoutSeconds(), "")
	if err != nil {
		return ParsedFrame{}, err
	}
	parsed.Frame = parsed.Frame.Normalize()
	return parsed, nil
}

func CommandTimeout() time.Duration {
	return commandTimeout()
}

func commandTimeout() time.Duration {
	// Collector runs in the background, so allow a generous default to reduce
	// false timeout churn on loaded machines.
	d := 300 * time.Second
	raw := strings.TrimSpace(os.Getenv("CODEXBAR_DISPLAY_TIMEOUT_SECS"))
	if raw == "" {
		return d
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return d
	}
	return time.Duration(n) * time.Second
}

// UsageBarsShowUsed reflects CodexBar's "used vs remaining" display mode.
// It defaults to "used" when the preference is unavailable.
func UsageBarsShowUsed() bool {
	if showUsed, ok := usageBarsShowUsedFromEnv(); ok {
		return showUsed
	}
	if runtime.GOOS == "windows" {
		return windowsUsageBarsShowUsed()
	}
	if runtime.GOOS != "darwin" {
		return true
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	out, err := exec.CommandContext(ctx, "defaults", "read", "com.steipete.codexbar", "usageBarsShowUsed").Output()
	if err != nil {
		return true
	}
	if showUsed, ok := parseBoolPreference(out); ok {
		return showUsed
	}
	return true
}

// SetUsageBarsShowUsed writes the same preference read by CodexBar and the stream.
func SetUsageBarsShowUsed(ctx context.Context, showUsed bool) error {
	if runtime.GOOS == "windows" {
		return setWindowsUsageBarsShowUsed(showUsed)
	}
	value := "false"
	if showUsed {
		value = "true"
	}
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	if err := exec.CommandContext(ctx, "defaults", "write", "com.steipete.codexbar", "usageBarsShowUsed", "-bool", value).Run(); err != nil {
		return err
	}
	if UsageBarsShowUsed() != showUsed {
		return errors.New("usage display preference was not applied")
	}
	return nil
}

func runUsageCommand(parent context.Context, timeout time.Duration, bin string, args ...string) ([]byte, error) {
	cmdCtx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	cmd := childproc.Hide(exec.CommandContext(cmdCtx, bin, args...))
	env, err := commandEnvironment(configPathFromContext(parent))
	if err != nil {
		return nil, err
	}
	cmd.Env = env
	out, err := cmd.Output()
	if err != nil && cmdCtx.Err() != nil {
		return out, cmdCtx.Err()
	}
	return out, err
}

func usageBarsShowUsedFromEnv() (bool, bool) {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(usageModeEnvVar)))
	switch raw {
	case "":
		return false, false
	case "used":
		return true, true
	case "remaining", "remain":
		return false, true
	default:
		return false, false
	}
}

func parseBoolPreference(raw []byte) (bool, bool) {
	switch strings.TrimSpace(strings.ToLower(string(raw))) {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	default:
		return false, false
	}
}

type ParsedFrame struct {
	Frame              protocol.Frame
	Provider           string
	Source             string
	AccountEmail       string
	Meta               ProviderUsageMeta
	CollectedAt        time.Time
	ActivityObservedAt time.Time
	Stale              bool
}

type ProviderUsageMeta struct {
	Windows      []UsageWindow
	Status       *ProviderStatus
	Credits      *ProviderCredits
	ResetCredits *ProviderResetCredits
	Cost         *ProviderCostUsage
	Pace         []ProviderPace
	OverTime     []UsageOverTimePoint
}

type UsageWindow struct {
	ID            string
	Label         string
	UsedPercent   int
	ResetSec      int64
	WindowMinutes int
}

type ProviderStatus struct {
	Indicator   string
	Description string
	UpdatedAt   time.Time
	URL         string
}

type ProviderCredits struct {
	Remaining float64
	UpdatedAt time.Time
}

type ProviderResetCredits struct {
	AvailableCount int
	NextExpiresAt  time.Time
	UpdatedAt      time.Time
}

type ProviderCostUsage struct {
	CurrencyCode      string
	UpdatedAt         time.Time
	TodayCostUSD      float64
	Last30DaysCostUSD float64
	Last30DaysTokens  int64
	LatestTokens      int64
	TopModel          string
	Daily             []ProviderCostDay
	// KnownZero marks a complete scan that found no usage at all. An
	// all-zero result is otherwise indistinguishable from "nothing known".
	KnownZero bool
}

type ProviderCostDay struct {
	Day          string
	TotalCostUSD float64
	TotalTokens  int64
	Models       []ProviderCostModel
}

type ProviderCostModel struct {
	Name        string
	TotalTokens int64
	CostUSD     float64
}

type ProviderPace struct {
	Window              string
	Stage               string
	DeltaPercent        int
	ExpectedUsedPercent int
	WillLastToReset     bool
	ETASeconds          int64
	Summary             string
}

type UsageOverTimePoint struct {
	Day              string
	TotalCreditsUsed float64
	Services         []UsageServiceUsage
}

type UsageServiceUsage struct {
	Service     string
	CreditsUsed float64
}

type looseVersion struct {
	major int
	minor int
	patch int
}

func (v looseVersion) String() string {
	if v.patch == 0 {
		return fmt.Sprintf("%d.%d", v.major, v.minor)
	}
	return fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch)
}

func (v looseVersion) Compare(other looseVersion) int {
	if v.major != other.major {
		if v.major < other.major {
			return -1
		}
		return 1
	}
	if v.minor != other.minor {
		if v.minor < other.minor {
			return -1
		}
		return 1
	}
	if v.patch != other.patch {
		if v.patch < other.patch {
			return -1
		}
		return 1
	}
	return 0
}

var looseVersionPattern = regexp.MustCompile(`\bv?([0-9]+)\.([0-9]+)(?:\.([0-9]+))?\b`)

func installedVersion(ctx context.Context, bin string) (looseVersion, error) {
	bin = strings.TrimSpace(bin)
	if bin == "" {
		return looseVersion{}, errors.New("CodexBar binary path is empty")
	}

	if out, err := runVersionCommandFn(ctx, versionCheckTimeout, bin, "--version"); err == nil {
		if version, ok := extractLooseVersion(string(out)); ok {
			return version, nil
		}
	}

	return looseVersion{}, fmt.Errorf("could not determine CodexBar version from %s --version", bin)
}

func extractLooseVersion(raw string) (looseVersion, bool) {
	match := looseVersionPattern.FindStringSubmatch(raw)
	if len(match) == 0 {
		return looseVersion{}, false
	}
	version, err := parseLooseVersion(match[0])
	if err != nil {
		return looseVersion{}, false
	}
	return version, true
}

func parseLooseVersion(raw string) (looseVersion, error) {
	match := looseVersionPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if len(match) == 0 {
		return looseVersion{}, fmt.Errorf("invalid version %q", raw)
	}

	major, err := strconv.Atoi(match[1])
	if err != nil {
		return looseVersion{}, err
	}
	minor, err := strconv.Atoi(match[2])
	if err != nil {
		return looseVersion{}, err
	}
	patch := 0
	if match[3] != "" {
		patch, err = strconv.Atoi(match[3])
		if err != nil {
			return looseVersion{}, err
		}
	}
	return looseVersion{major: major, minor: minor, patch: patch}, nil
}

func parseAllProviders(raw []byte) ([]ParsedFrame, error) {
	providers, err := extractProvidersFromRawJSON(raw)
	if err != nil {
		return nil, err
	}
	if len(providers) == 0 {
		return nil, ErrNoProviders
	}

	var result []ParsedFrame
	var globalCLIError bool
	for _, providerAny := range providers {
		payload, ok := providerAny.(map[string]any)
		if !ok {
			continue
		}
		parsed, err := parseProviderPayload(payload)
		if err != nil {
			if errors.Is(err, errGlobalCLI) {
				globalCLIError = true
			}
			continue
		}
		result = append(result, parsed)
	}

	if len(result) == 0 {
		if globalCLIError {
			return nil, errGlobalCLI
		}
		return nil, ErrUnexpectedProviderShape
	}
	return result, nil
}

func parseUsageJSON(raw []byte) (ParsedFrame, error) {
	all, err := parseAllProviders(raw)
	if err != nil {
		return ParsedFrame{}, err
	}
	if len(all) == 0 {
		return ParsedFrame{}, ErrNoProviders
	}
	return all[0], nil
}

func parseProviderPayload(payload map[string]any) (ParsedFrame, error) {
	if providerPayloadHasError(payload) {
		provider := strings.TrimSpace(strings.ToLower(firstString(payload, "provider", "id", "slug", "name")))
		source := strings.TrimSpace(strings.ToLower(firstString(payload, "source")))
		if provider == "cli" && source == "cli" {
			return ParsedFrame{}, errGlobalCLI
		}
		if provider == "" {
			return ParsedFrame{}, errors.New("provider error payload has no identity")
		}
		label := firstString(payload, "label", "displayName")
		if label == "" {
			label = humanLabel(provider)
		}
		return ParsedFrame{
			Frame: protocol.Frame{
				V:                1,
				Provider:         provider,
				Label:            label,
				UsageUnavailable: true,
			},
			Provider: provider,
			Source:   source,
			Stale:    true,
		}, nil
	}

	provider := firstString(payload, "provider", "id", "slug", "name")
	source := firstString(payload, "source")
	label := humanLabel(provider)
	if l := firstString(payload, "label", "displayName", "name"); l != "" {
		label = l
	}

	session, sessionKnown := knownUsagePercentAtPaths(payload,
		"usage.primary",
		"primary",
		"session",
		"openaiDashboard.primaryLimit",
	)
	weekly, weeklyKnown := knownUsagePercentAtPaths(payload,
		"usage.secondary",
		"secondary",
		"weekly",
		"openaiDashboard.secondaryLimit",
	)

	resetWindow := "primary"
	resetAt := firstStringAtPaths(payload,
		"usage.primary.resetsAt",
		"primary.resetsAt",
	)
	if resetAt == "" {
		resetWindow = "secondary"
		resetAt = firstStringAtPaths(payload, "usage.secondary.resetsAt")
	}
	resetSecs := int64(0)
	if resetAt != "" {
		if t, err := time.Parse(time.RFC3339, resetAt); err == nil {
			if d := time.Until(t); d > 0 {
				resetSecs = int64(d.Seconds())
			}
		}
	}
	resetSource := ""
	if resetSecs > 0 {
		resetSource = protocol.ResetSourceKey(provider, resetWindow)
	}

	accountEmail := firstStringAtPaths(payload,
		"usage.accountEmail",
		"usage.identity.accountEmail",
		"accountEmail",
	)
	activityObservedAt := firstRFC3339AtPaths(payload,
		"usage.updatedAt",
		"openaiDashboard.updatedAt",
		"credits.updatedAt",
		"updatedAt",
	)

	if provider == "" && label == "" {
		return ParsedFrame{}, errors.New("provider identity missing in codexbar output")
	}
	if label == "" {
		label = "Provider"
	}

	meta := parseProviderUsageMeta(payload)
	usageWindows := usageWindowsFromWindows(meta.Windows)
	if len(usageWindows) > 0 {
		session = usageWindows[0].Percent
		resetSecs = usageWindows[0].ResetSec
	}
	if len(usageWindows) > 1 {
		weekly = usageWindows[1].Percent
	}
	frame := protocol.Frame{
		V:                  protocol.ProtocolVersionV2,
		Provider:           provider,
		Label:              label,
		Session:            session,
		Weekly:             weekly,
		ResetSec:           resetSecs,
		ResetSource:        resetSource,
		UsageWindows:       usageWindows,
		UsageUnavailable:   !sessionKnown && !weeklyKnown && len(usageWindows) == 0,
		SessionUnavailable: !sessionKnown,
		WeeklyUnavailable:  !weeklyKnown,
	}.Normalize()
	return ParsedFrame{
		Frame:              frame,
		Provider:           provider,
		Source:             source,
		AccountEmail:       accountEmail,
		Meta:               meta,
		ActivityObservedAt: activityObservedAt,
	}, nil
}

func usageWindowsFromWindows(windows []UsageWindow) []protocol.UsageWindow {
	if len(windows) == 0 {
		return nil
	}
	out := make([]protocol.UsageWindow, 0, len(windows))
	for _, window := range windows {
		if strings.TrimSpace(window.ID) == "" || strings.TrimSpace(window.Label) == "" {
			continue
		}
		out = append(out, protocol.UsageWindow{
			ID:       window.ID,
			Label:    window.Label,
			Percent:  window.UsedPercent,
			ResetSec: window.ResetSec,
		})
	}
	return out
}

func parseProviderUsageMeta(payload map[string]any) ProviderUsageMeta {
	meta := ProviderUsageMeta{
		Windows:  parseUsageWindows(payload),
		Pace:     parseProviderPace(payload),
		OverTime: parseUsageOverTime(payload),
	}
	if status, ok := parseProviderStatus(payload); ok {
		meta.Status = &status
	}
	if credits, ok := parseProviderCredits(payload); ok {
		meta.Credits = &credits
	}
	if resetCredits, ok := parseProviderResetCredits(payload); ok {
		meta.ResetCredits = &resetCredits
	}
	return meta
}

func parseUsageOverTime(payload map[string]any) []UsageOverTimePoint {
	for _, path := range []string{
		"openaiDashboard.usageBreakdown",
		"openaiDashboard.dailyBreakdown",
		"openaiDashboard.creditEvents",
		"usageBreakdown",
		"dailyBreakdown",
		"creditEvents",
		"usage.overTime",
		"usage.history",
		"credits.events",
	} {
		raw, ok := getPath(payload, path)
		if !ok {
			continue
		}
		if points := parseUsageOverTimePoints(raw); len(points) > 0 {
			return points
		}
	}
	return nil
}

func parseUsageOverTimePoints(raw any) []UsageOverTimePoint {
	items, ok := raw.([]any)
	if !ok || len(items) == 0 {
		return nil
	}

	points := make([]UsageOverTimePoint, 0, len(items))
	for _, item := range items {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		point, ok := parseUsageOverTimePoint(itemMap)
		if ok {
			points = append(points, point)
		}
	}
	if len(points) == 0 {
		return nil
	}
	points = mergeUsageOverTimePoints(points)
	sort.Slice(points, func(i, j int) bool {
		return points[i].Day < points[j].Day
	})
	const maxUsageOverTimeDays = 30
	if len(points) > maxUsageOverTimeDays {
		points = points[len(points)-maxUsageOverTimeDays:]
	}
	return points
}

func parseUsageOverTimePoint(item map[string]any) (UsageOverTimePoint, bool) {
	day := usageDayKey(firstString(item, "day", "date", "dayKey"))
	if day == "" {
		return UsageOverTimePoint{}, false
	}

	services := parseUsageServiceUsageList(item["services"])
	total, ok := floatAtPaths(item, "totalCreditsUsed", "total", "creditsUsed")
	if len(services) == 0 {
		if service := firstString(item, "service", "label", "name"); service != "" && ok {
			services = append(services, UsageServiceUsage{
				Service:     service,
				CreditsUsed: total,
			})
		}
	}
	if !ok {
		for _, service := range services {
			total += service.CreditsUsed
		}
	}
	if total < 0 {
		total = 0
	}
	if total == 0 && len(services) == 0 {
		return UsageOverTimePoint{}, false
	}

	return UsageOverTimePoint{
		Day:              day,
		TotalCreditsUsed: total,
		Services:         services,
	}, true
}

func mergeUsageOverTimePoints(points []UsageOverTimePoint) []UsageOverTimePoint {
	type dayUsage struct {
		total    float64
		services map[string]float64
	}

	byDay := map[string]*dayUsage{}
	for _, point := range points {
		day := strings.TrimSpace(point.Day)
		if day == "" {
			continue
		}
		usage := byDay[day]
		if usage == nil {
			usage = &dayUsage{services: map[string]float64{}}
			byDay[day] = usage
		}
		if point.TotalCreditsUsed > 0 {
			usage.total += point.TotalCreditsUsed
		}
		for _, service := range point.Services {
			name := strings.TrimSpace(service.Service)
			if name == "" || service.CreditsUsed <= 0 {
				continue
			}
			usage.services[name] += service.CreditsUsed
		}
	}
	if len(byDay) == 0 {
		return nil
	}

	days := make([]string, 0, len(byDay))
	for day := range byDay {
		days = append(days, day)
	}
	sort.Strings(days)

	merged := make([]UsageOverTimePoint, 0, len(days))
	for _, day := range days {
		usage := byDay[day]
		services := make([]UsageServiceUsage, 0, len(usage.services))
		for name, credits := range usage.services {
			if credits <= 0 {
				continue
			}
			services = append(services, UsageServiceUsage{
				Service:     name,
				CreditsUsed: credits,
			})
		}
		sort.SliceStable(services, func(i, j int) bool {
			if services[i].CreditsUsed == services[j].CreditsUsed {
				return strings.ToLower(services[i].Service) < strings.ToLower(services[j].Service)
			}
			return services[i].CreditsUsed > services[j].CreditsUsed
		})
		if len(services) > maxUsageOverTimeServices {
			services = services[:maxUsageOverTimeServices]
		}
		merged = append(merged, UsageOverTimePoint{
			Day:              day,
			TotalCreditsUsed: usage.total,
			Services:         services,
		})
	}
	return merged
}

const maxUsageOverTimeServices = 8

func parseUsageServiceUsageList(raw any) []UsageServiceUsage {
	appendService := func(out []UsageServiceUsage, service string, credits float64) []UsageServiceUsage {
		service = strings.TrimSpace(service)
		if service == "" || credits <= 0 {
			return out
		}
		out = append(out, UsageServiceUsage{
			Service:     service,
			CreditsUsed: credits,
		})
		return out
	}

	var out []UsageServiceUsage
	switch v := raw.(type) {
	case []any:
		out = make([]UsageServiceUsage, 0, len(v))
		for _, item := range v {
			itemMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			credits, ok := floatAtPaths(itemMap, "creditsUsed", "credits", "usage")
			if !ok {
				continue
			}
			out = appendService(out, firstString(itemMap, "service", "label", "name"), credits)
		}
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out = make([]UsageServiceUsage, 0, len(keys))
		for _, key := range keys {
			credits, ok := anyToFloat(v[key])
			if !ok {
				continue
			}
			out = appendService(out, key, credits)
		}
	}

	if len(out) == 0 {
		return nil
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreditsUsed == out[j].CreditsUsed {
			return strings.ToLower(out[i].Service) < strings.ToLower(out[j].Service)
		}
		return out[i].CreditsUsed > out[j].CreditsUsed
	})
	if len(out) > maxUsageOverTimeServices {
		out = out[:maxUsageOverTimeServices]
	}
	return out
}

func usageDayKey(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) >= len("2006-01-02") {
		raw = raw[:len("2006-01-02")]
	}
	if _, err := time.Parse("2006-01-02", raw); err != nil {
		return ""
	}
	return raw
}

func parseUsageWindows(payload map[string]any) []UsageWindow {
	windows := []UsageWindow{}
	for _, spec := range []struct {
		id    string
		label string
		paths []string
	}{
		{id: "primary", label: "Session", paths: []string{"usage.primary", "primary", "openaiDashboard.primaryLimit"}},
		{id: "secondary", label: "Weekly", paths: []string{"usage.secondary", "secondary", "openaiDashboard.secondaryLimit"}},
		{id: "tertiary", label: "Tertiary", paths: []string{"usage.tertiary", "tertiary", "openaiDashboard.tertiaryLimit"}},
	} {
		if window, ok := usageWindowAtPaths(payload, spec.id, spec.label, spec.paths...); ok {
			windows = append(windows, window)
		}
	}

	extra, ok := getPath(payload, "usage.extra")
	if !ok {
		extra, ok = payload["extra"]
	}
	if !ok {
		extra, ok = getPath(payload, "usage.extraRateWindows")
	}
	if !ok {
		extra, ok = payload["extraRateWindows"]
	}
	if ok {
		windows = append(windows, parseExtraUsageWindows(extra)...)
	}
	return windows
}

func usageWindowAtPaths(payload map[string]any, id string, label string, paths ...string) (UsageWindow, bool) {
	for _, path := range paths {
		raw, ok := getPath(payload, path)
		if !ok {
			continue
		}
		windowMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		window, ok := parseUsageWindowMap(windowMap, id, label)
		if ok {
			return window, true
		}
	}
	return UsageWindow{}, false
}

func parseExtraUsageWindows(raw any) []UsageWindow {
	switch v := raw.(type) {
	case []any:
		out := make([]UsageWindow, 0, len(v))
		for i, item := range v {
			itemMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			id := firstString(itemMap, "id", "key", "name")
			if id == "" {
				id = fmt.Sprintf("extra-%d", i+1)
			}
			label := firstString(itemMap, "label", "title", "name")
			if label == "" {
				label = humanLabel(id)
			}
			windowMap := itemMap
			if nested, ok := itemMap["window"].(map[string]any); ok {
				windowMap = nested
			}
			if window, ok := parseUsageWindowMap(windowMap, id, label); ok {
				out = append(out, window)
			}
		}
		return out
	case map[string]any:
		out := make([]UsageWindow, 0, len(v))
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			itemMap, ok := v[key].(map[string]any)
			if !ok {
				continue
			}
			label := firstString(itemMap, "label", "title", "name")
			if label == "" {
				label = humanLabel(key)
			}
			if window, ok := parseUsageWindowMap(itemMap, key, label); ok {
				out = append(out, window)
			}
		}
		return out
	default:
		return nil
	}
}

func parseUsageWindowMap(windowMap map[string]any, id string, label string) (UsageWindow, bool) {
	used, known := knownUsagePercentAtPaths(windowMap, "usedPercent", "used_percent", "percent", "usagePercent")
	if !known {
		return UsageWindow{}, false
	}
	resetSec, _ := resetSecondsFromWindowMap(windowMap)
	windowMinutes, _ := intAtPathsWithPresence(windowMap, "windowMinutes", "window_minutes")
	return UsageWindow{
		ID:            strings.TrimSpace(strings.ToLower(id)),
		Label:         strings.TrimSpace(label),
		UsedPercent:   used,
		ResetSec:      resetSec,
		WindowMinutes: windowMinutes,
	}, true
}

func resetSecondsFromWindowMap(windowMap map[string]any) (int64, bool) {
	if n, ok := intAtPathsWithPresence(
		windowMap,
		"resetSecs",
		"resetSeconds",
		"reset_after_seconds",
	); ok {
		if n < 0 {
			n = 0
		}
		return int64(n), true
	}
	resetAt := firstStringAtPaths(windowMap, "resetsAt", "resetAt", "resets_at")
	if resetAt == "" {
		return 0, false
	}
	t, err := time.Parse(time.RFC3339, resetAt)
	if err != nil {
		return 0, false
	}
	if d := time.Until(t); d > 0 {
		return int64(d.Seconds()), true
	}
	return 0, true
}

func parseProviderStatus(payload map[string]any) (ProviderStatus, bool) {
	statusAny, ok := payload["status"]
	if !ok {
		return ProviderStatus{}, false
	}
	statusMap, ok := statusAny.(map[string]any)
	if !ok {
		return ProviderStatus{}, false
	}
	status := ProviderStatus{
		Indicator:   firstString(statusMap, "indicator", "status"),
		Description: firstString(statusMap, "description", "summary", "message"),
		URL:         firstString(statusMap, "url", "statusPageURL", "statusLinkURL"),
	}
	if updatedAt := firstRFC3339AtPaths(statusMap, "updatedAt"); !updatedAt.IsZero() {
		status.UpdatedAt = updatedAt
	}
	if status.Indicator == "" && status.Description == "" && status.URL == "" {
		return ProviderStatus{}, false
	}
	return status, true
}

func parseProviderCredits(payload map[string]any) (ProviderCredits, bool) {
	creditsAny, ok := payload["credits"]
	if !ok {
		return ProviderCredits{}, false
	}
	creditsMap, ok := creditsAny.(map[string]any)
	if !ok {
		return ProviderCredits{}, false
	}
	remaining, ok := floatAtPaths(creditsMap, "remaining", "remainingCredits", "balance")
	if !ok {
		return ProviderCredits{}, false
	}
	credits := ProviderCredits{Remaining: remaining}
	if updatedAt := firstRFC3339AtPaths(creditsMap, "updatedAt"); !updatedAt.IsZero() {
		credits.UpdatedAt = updatedAt
	}
	return credits, true
}

func parseProviderResetCredits(payload map[string]any) (ProviderResetCredits, bool) {
	resetAny, ok := getPath(payload, "usage.codexResetCredits")
	if !ok {
		resetAny, ok = getPath(payload, "codexResetCredits")
	}
	if !ok {
		return ProviderResetCredits{}, false
	}
	resetMap, ok := resetAny.(map[string]any)
	if !ok {
		return ProviderResetCredits{}, false
	}

	availableCount := intAtPaths(resetMap, "availableCount", "available_count")
	if availableCount < 0 {
		availableCount = 0
	}

	var nextExpiresAt time.Time
	if creditsAny, ok := resetMap["credits"]; ok {
		if credits, ok := creditsAny.([]any); ok {
			counted := 0
			for _, creditAny := range credits {
				credit, ok := creditAny.(map[string]any)
				if !ok {
					continue
				}
				status := strings.TrimSpace(strings.ToLower(firstString(credit, "status")))
				if status != "" && status != "available" {
					continue
				}
				counted++
				expiresAt := firstRFC3339AtPaths(credit, "expires_at", "expiresAt")
				if expiresAt.IsZero() {
					continue
				}
				if nextExpiresAt.IsZero() || expiresAt.Before(nextExpiresAt) {
					nextExpiresAt = expiresAt.UTC()
				}
			}
			if availableCount == 0 {
				availableCount = counted
			}
		}
	}

	updatedAt := firstRFC3339AtPaths(resetMap, "updatedAt", "updated_at")
	if availableCount == 0 && nextExpiresAt.IsZero() && updatedAt.IsZero() {
		return ProviderResetCredits{}, false
	}

	return ProviderResetCredits{
		AvailableCount: availableCount,
		NextExpiresAt:  nextExpiresAt,
		UpdatedAt:      updatedAt,
	}, true
}

func parseProviderPace(payload map[string]any) []ProviderPace {
	paceAny, ok := payload["pace"]
	if !ok {
		return nil
	}
	paceMap, ok := paceAny.(map[string]any)
	if !ok {
		return nil
	}
	keys := make([]string, 0, len(paceMap))
	for key := range paceMap {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	out := make([]ProviderPace, 0, len(keys))
	for _, key := range keys {
		itemMap, ok := paceMap[key].(map[string]any)
		if !ok {
			continue
		}
		pace := ProviderPace{
			Window:              strings.TrimSpace(strings.ToLower(key)),
			Stage:               firstString(itemMap, "stage"),
			DeltaPercent:        intAtPaths(itemMap, "deltaPercent"),
			ExpectedUsedPercent: intAtPaths(itemMap, "expectedUsedPercent"),
			WillLastToReset:     boolAtPaths(itemMap, "willLastToReset"),
			ETASeconds:          int64(intAtPaths(itemMap, "etaSeconds")),
			Summary:             firstString(itemMap, "summary"),
		}
		if pace.Stage == "" && pace.Summary == "" {
			continue
		}
		out = append(out, pace)
	}
	return out
}

func intAtPaths(m map[string]any, paths ...string) int {
	n, _ := intAtPathsWithPresence(m, paths...)
	return n
}

func intAtPathsWithPresence(m map[string]any, paths ...string) (int, bool) {
	for _, path := range paths {
		if v, ok := getPath(m, path); ok {
			if n, ok := anyToInt(v); ok {
				return n, true
			}
		}
	}
	return 0, false
}

func floatAtPaths(m map[string]any, paths ...string) (float64, bool) {
	for _, path := range paths {
		if v, ok := getPath(m, path); ok {
			if n, ok := anyToFloat(v); ok {
				return n, true
			}
		}
	}
	return 0, false
}

func boolAtPaths(m map[string]any, paths ...string) bool {
	for _, path := range paths {
		if v, ok := getPath(m, path); ok {
			if b, ok := anyToBool(v); ok {
				return b
			}
		}
	}
	return false
}

func providerPayloadHasError(payload map[string]any) bool {
	raw, ok := payload["error"]
	if !ok || raw == nil {
		return false
	}

	switch v := raw.(type) {
	case string:
		return strings.TrimSpace(v) != ""
	case map[string]any:
		if len(v) == 0 {
			return false
		}
		// Non-empty provider error payloads are not usable usage frames.
		return true
	default:
		return true
	}
}

type SelectionReason string

const (
	SelectionReasonAgentActivity SelectionReason = "agent-activity"
	SelectionReasonStickyCurrent SelectionReason = "sticky-current"
	SelectionReasonCodexbarOrder SelectionReason = "codexbar-order"
)

type SelectionDecision struct {
	Selected ParsedFrame
	Reason   SelectionReason
	Detail   string
}

// ProviderSelector joins observed activity to already-normalized usage frames.
// Without a matching agent it retains the current provider, then CodexBar order.
// Usage counters and filesystem timestamps never imply agent activity.
type ProviderSelector struct{ currentKey string }

func NewProviderSelector() *ProviderSelector { return &ProviderSelector{} }

func (s *ProviderSelector) SetCurrentProvider(provider string) {
	if s != nil {
		s.currentKey = strings.ToLower(strings.TrimSpace(provider))
	}
}

func (s *ProviderSelector) Select(all []ParsedFrame) (ParsedFrame, bool) {
	decision, ok := s.SelectWithDecision(all)
	return decision.Selected, ok
}

func (s *ProviderSelector) SelectWithDecision(all []ParsedFrame, activeProviders ...string) (SelectionDecision, bool) {
	if len(all) == 0 {
		return SelectionDecision{}, false
	}
	selected := all[0]
	available := firstAvailableProviderIndex(all)
	if available >= 0 {
		selected = all[available]
	}
	reason := SelectionReasonCodexbarOrder
	if idx := indexOfProviderKey(all, s.currentKey); idx >= 0 && (providerUsageAvailable(all[idx]) || available < 0) {
		selected = all[idx]
		reason = SelectionReasonStickyCurrent
	}
	for _, provider := range activeProviders {
		if idx := indexOfProviderKey(all, provider); idx >= 0 && providerUsageAvailable(all[idx]) {
			selected = all[idx]
			reason = SelectionReasonAgentActivity
			break
		}
	}
	s.currentKey = providerKey(selected)
	return SelectionDecision{Selected: selected, Reason: reason, Detail: "provider=" + s.currentKey}, true
}

func firstAvailableProviderIndex(all []ParsedFrame) int {
	for i := range all {
		if providerUsageAvailable(all[i]) {
			return i
		}
	}
	return -1
}

func providerUsageAvailable(provider ParsedFrame) bool {
	return !provider.Stale && !provider.Frame.UsageUnavailable
}

func providerKey(p ParsedFrame) string {
	provider := strings.TrimSpace(strings.ToLower(p.Provider))
	if provider == "" {
		provider = strings.TrimSpace(strings.ToLower(p.Frame.Provider))
	}
	if provider == "" {
		provider = strings.TrimSpace(strings.ToLower(p.Frame.Label))
	}
	if provider == "" {
		provider = "provider"
	}
	return provider
}

func indexOfProviderKey(all []ParsedFrame, key string) int {
	for i, p := range all {
		if providerKey(p) == key {
			return i
		}
	}
	return -1
}

func fetchProviderScopedUsageDetailed(ctx context.Context, timeout time.Duration, bin string, provider string, webTimeoutSeconds int, source string) (ParsedFrame, error) {
	key := strings.TrimSpace(strings.ToLower(provider))
	if key == "" {
		return ParsedFrame{}, wrapFetchError(FetchErrorParse, errors.New("provider key is empty"))
	}

	args := []string{"usage", "--json", "--provider", key}
	source = strings.TrimSpace(strings.ToLower(source))
	if source != "" {
		args = append(args, "--source", source)
	}
	if webTimeoutSeconds <= 0 {
		webTimeoutSeconds = 8
	}
	args = append(args, "--web-timeout", strconv.Itoa(webTimeoutSeconds))

	raw, cmdErr := runUsageCommandFn(ctx, timeout, bin, args...)
	parsed, parseErr := parseAllProviders(raw)
	if parseErr != nil || len(parsed) == 0 {
		if cmdErr != nil && len(bytes.TrimSpace(raw)) == 0 {
			return ParsedFrame{}, wrapFetchError(FetchErrorCommand, fmt.Errorf("run codexbar usage --provider %s: %w", key, cmdErr))
		}
		if parseErr != nil {
			return ParsedFrame{}, wrapFetchError(classifyParseError(parseErr), parseErr)
		}
		return ParsedFrame{}, wrapFetchError(FetchErrorNoProviders, ErrNoProviders)
	}

	// Keep parsed payload when command exits non-zero but still emitted JSON.
	if cmdErr != nil && len(bytes.TrimSpace(raw)) == 0 {
		return ParsedFrame{}, wrapFetchError(FetchErrorCommand, fmt.Errorf("run codexbar usage --provider %s: %w", key, cmdErr))
	}

	for _, candidate := range parsed {
		if providerKey(candidate) == key {
			candidate.Frame = candidate.Frame.Normalize()
			return candidate, nil
		}
	}
	return ParsedFrame{}, wrapFetchError(
		FetchErrorNoProviders,
		fmt.Errorf("codexbar returned no result for requested provider %s", key),
	)
}

func providerScopedFallbackTimeout(primaryTimeout time.Duration) time.Duration {
	const (
		minTimeout = 4 * time.Second
		maxTimeout = 12 * time.Second
	)

	timeout := primaryTimeout / 8
	if timeout <= 0 {
		timeout = minTimeout
	}
	if timeout < minTimeout {
		return minTimeout
	}
	if timeout > maxTimeout {
		return maxTimeout
	}
	return timeout
}

func providerScopedWebTimeoutSeconds() int {
	const (
		def = 3
		min = 2
		max = 8
	)

	raw := strings.TrimSpace(os.Getenv("CODEXBAR_DISPLAY_PROVIDER_WEB_TIMEOUT_SECS"))
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

func extractProviderList(root any) []any {
	switch v := root.(type) {
	case []any:
		return v
	case map[string]any:
		for _, key := range []string{"providers", "items", "data", "results"} {
			if arr, ok := v[key].([]any); ok {
				return arr
			}
		}
	}
	return nil
}

func extractProvidersFromRawJSON(raw []byte) ([]any, error) {
	providers, err := decodeProvidersFromRaw(raw)
	if err == nil || len(providers) > 0 {
		return providers, err
	}

	// CodexBar can occasionally prefix stderr-like text before JSON while still
	// emitting a valid provider payload later in stdout. In that case, retry
	// decode from the first JSON token start.
	remainder := raw
	for len(remainder) > 0 {
		idx := bytes.IndexAny(remainder, "[{")
		if idx == -1 {
			break
		}

		candidate := remainder[idx:]
		parsed, parseErr := decodeProvidersFromRaw(candidate)
		if parseErr == nil || len(parsed) > 0 {
			return parsed, parseErr
		}

		remainder = candidate[1:]
	}

	return nil, err
}

func decodeProvidersFromRaw(raw []byte) ([]any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	var providers []any

	for {
		var value any
		err := dec.Decode(&value)
		if err == io.EOF {
			break
		}
		if err != nil {
			// Keep already decoded provider payloads if trailing data is malformed.
			if len(providers) > 0 {
				break
			}
			return nil, fmt.Errorf("parse codexbar json: %w", err)
		}

		if parsed := extractProviderList(value); len(parsed) > 0 {
			providers = append(providers, parsed...)
		}
	}

	return providers, nil
}

func humanLabel(provider string) string {
	p := strings.TrimSpace(strings.ToLower(provider))
	switch p {
	case "":
		return "Provider"
	case "codex":
		return "Codex"
	case "claude":
		return "Claude"
	case "cursor":
		return "Cursor"
	case "copilot":
		return "Copilot"
	case "gemini":
		return "Gemini"
	default:
		return strings.ToUpper(p[:1]) + p[1:]
	}
}

func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := anyToString(m[k]); ok && s != "" {
			return s
		}
	}
	return ""
}

func firstStringAtPaths(m map[string]any, paths ...string) string {
	for _, p := range paths {
		if v, ok := getPath(m, p); ok {
			if s, ok := anyToString(v); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

func firstRFC3339AtPaths(m map[string]any, paths ...string) time.Time {
	raw := firstStringAtPaths(m, paths...)
	if raw == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func usageWindowUnavailable(m map[string]any) bool {
	if usageKnown, exists := anyToBool(m["usageKnown"]); exists && !usageKnown {
		return true
	}
	// CodexBar also uses rate-window objects for informational notices (for
	// example an absent session). Their numeric value is not a quota.
	for _, key := range []string{"isInformational", "is_informational"} {
		if informational, _ := anyToBool(m[key]); informational {
			return true
		}
	}
	return false
}

func knownUsagePercentAtPaths(m map[string]any, paths ...string) (int, bool) {
	if usageWindowUnavailable(m) {
		return 0, false
	}
	for _, path := range paths {
		value, ok := getPath(m, path)
		if !ok {
			continue
		}
		if window, ok := value.(map[string]any); ok {
			if usageWindowUnavailable(window) {
				return 0, false
			}
			for _, key := range []string{"usedPercent", "used_percent", "percent", "usagePercent"} {
				if used, exists := anyToInt(window[key]); exists {
					return clampPercent(used), true
				}
			}
			continue
		}
		if used, ok := anyToInt(value); ok {
			return clampPercent(used), true
		}
	}
	return 0, false
}

func clampPercent(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func getPath(m map[string]any, path string) (any, bool) {
	parts := strings.Split(path, ".")
	cur := any(m)
	for _, p := range parts {
		nextMap, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		next, ok := nextMap[p]
		if !ok {
			return nil, false
		}
		cur = next
	}
	return cur, true
}

func anyToString(v any) (string, bool) {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t), true
	default:
		return "", false
	}
}

func anyToInt(v any) (int, bool) {
	switch t := v.(type) {
	case float64:
		return int(t), true
	case float32:
		return int(t), true
	case int:
		return t, true
	case int64:
		return int(t), true
	case int32:
		return int(t), true
	case json.Number:
		i, err := t.Int64()
		if err != nil {
			return 0, false
		}
		return int(i), true
	case string:
		var n int
		_, err := fmt.Sscanf(strings.TrimSpace(t), "%d", &n)
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

func anyToFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case int32:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return f, err == nil
	default:
		return 0, false
	}
}

func anyToBool(v any) (bool, bool) {
	switch t := v.(type) {
	case bool:
		return t, true
	case string:
		switch strings.TrimSpace(strings.ToLower(t)) {
		case "1", "true", "yes", "on":
			return true, true
		case "0", "false", "no", "off":
			return false, true
		default:
			return false, false
		}
	default:
		return false, false
	}
}
