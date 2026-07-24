package codexbar

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
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
var readFileFn = os.ReadFile
var executablePathFn = os.Executable

const (
	minSharedFallbackTimeBudget = 4 * time.Second
	minSupportedVersionString   = "0.23"
	versionCheckTimeout         = 2 * time.Second
)

const usageModeEnvVar = "CODEXBAR_DISPLAY_USAGE_MODE"

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

func MinimumSupportedVersion() string {
	return minSupportedVersionString
}

func CheckMinimumVersion(ctx context.Context, bin string) error {
	version, err := installedVersion(ctx, bin)
	if err != nil {
		return err
	}
	minimum, err := parseLooseVersion(minSupportedVersionString)
	if err != nil {
		return err
	}
	if version.Compare(minimum) < 0 {
		return fmt.Errorf("CodexBar %s is too old; need >= %s", version.String(), minSupportedVersionString)
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
	return info.Mode()&0o111 != 0
}

// FetchAllProviders reads provider usage from CodexBar and normalizes it.
//
// It prefers one aggregate `usage --json` call. If aggregate usage is
// unavailable, a Codex CLI-only fallback can still return a minimal payload.
func FetchAllProviders(ctx context.Context) ([]ParsedFrame, error) {
	bin, err := FindBinary()
	if err != nil {
		return nil, wrapFetchError(FetchErrorBinary, err)
	}
	if err := CheckMinimumVersion(ctx, bin); err != nil {
		return nil, wrapFetchError(FetchErrorVersion, err)
	}

	timeout := commandTimeout()
	out, err := runUsageCommandFn(ctx, timeout, bin, "usage", "--json", "--web-timeout", "8")
	allParsed, parseErr := parseAllProviders(out)

	// A non-zero exit may still contain useful provider rows. Fall back only
	// when the aggregate payload itself is unusable.
	if parseErr != nil && !errors.Is(parseErr, errGlobalCLI) {
		fallbackCtx, fallbackCancel := fallbackContext(ctx)
		defer fallbackCancel()
		if fallback, ok := fetchCodexCLIOnly(fallbackCtx, cliFallbackTimeout(timeout), bin); ok {
			allParsed = fallback
			err = nil
			parseErr = nil
		}
	}

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

	allParsed = mergeTokenStats(ctx, allParsed, bin)

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
	if key == "codex" {
		if codexCLI, ok := fetchCodexCLIProvider(ctx, cliFallbackTimeout(timeout), bin); ok {
			codexCLI.Frame = codexCLI.Frame.Normalize()
			return codexCLI, nil
		}
	}

	parsed, err := fetchProviderScopedUsageDetailed(ctx, providerScopedFallbackTimeout(timeout), bin, key, providerScopedWebTimeoutSeconds(), "")
	if err != nil {
		return ParsedFrame{}, err
	}
	parsed = mergeProviderTokenStats(ctx, parsed, bin)
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

func runUsageCommand(parent context.Context, timeout time.Duration, bin string, args ...string) ([]byte, error) {
	cmdCtx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, bin, args...)
	cmd.Env = commandEnvironment(configPathFromContext(parent))
	return cmd.Output()
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

	infoPath, ok := appInfoPlistPath(bin)
	if !ok {
		if resolved, err := filepath.EvalSymlinks(bin); err == nil {
			infoPath, ok = appInfoPlistPath(resolved)
		}
	}
	if !ok {
		return looseVersion{}, fmt.Errorf("could not determine CodexBar version from %s", bin)
	}
	raw, err := readFileFn(infoPath)
	if err != nil {
		return looseVersion{}, fmt.Errorf("read CodexBar Info.plist: %w", err)
	}
	rawVersion, err := plistStringValue(raw, "CFBundleShortVersionString")
	if err != nil || strings.TrimSpace(rawVersion) == "" {
		rawVersion, err = plistStringValue(raw, "CFBundleVersion")
	}
	if err != nil {
		return looseVersion{}, fmt.Errorf("read CodexBar version from Info.plist: %w", err)
	}
	version, err := parseLooseVersion(rawVersion)
	if err != nil {
		return looseVersion{}, fmt.Errorf("parse CodexBar version %q: %w", rawVersion, err)
	}
	return version, nil
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

func appInfoPlistPath(bin string) (string, bool) {
	clean := filepath.Clean(strings.TrimSpace(bin))
	marker := ".app" + string(os.PathSeparator) + "Contents"
	idx := strings.Index(clean, marker)
	if idx == -1 {
		return "", false
	}
	appRoot := clean[:idx+len(".app")]
	if appRoot == "" {
		return "", false
	}
	return filepath.Join(appRoot, "Contents", "Info.plist"), true
}

func plistStringValue(raw []byte, key string) (string, error) {
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	var lastKey string
	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}

		start, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "key":
			var value string
			if err := decoder.DecodeElement(&value, &start); err != nil {
				return "", err
			}
			lastKey = strings.TrimSpace(value)
		case "string":
			var value string
			if err := decoder.DecodeElement(&value, &start); err != nil {
				return "", err
			}
			if lastKey == key {
				return strings.TrimSpace(value), nil
			}
			lastKey = ""
		}
	}
	return "", fmt.Errorf("key %q not found", key)
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
		if recovered, ok := recoverCodexFrameFromErrorPayload(payload); ok {
			return recovered, nil
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

	resetAt := firstStringAtPaths(payload,
		"usage.primary.resetsAt",
		"primary.resetsAt",
		"usage.secondary.resetsAt",
	)
	resetSecs := int64(0)
	if resetAt != "" {
		if t, err := time.Parse(time.RFC3339, resetAt); err == nil {
			if d := time.Until(t); d > 0 {
				resetSecs = int64(d.Seconds())
			}
		}
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

	return ParsedFrame{
		Frame: protocol.Frame{
			V:                  1,
			Provider:           provider,
			Label:              label,
			Session:            session,
			Weekly:             weekly,
			ResetSec:           resetSecs,
			UsageUnavailable:   !sessionKnown && !weeklyKnown,
			SessionUnavailable: !sessionKnown,
			WeeklyUnavailable:  !weeklyKnown,
		},
		Provider:           provider,
		Source:             source,
		AccountEmail:       accountEmail,
		Meta:               parseProviderUsageMeta(payload),
		ActivityObservedAt: activityObservedAt,
	}, nil
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
	if usageKnown, ok := anyToBool(windowMap["usageKnown"]); ok && !usageKnown {
		return UsageWindow{}, false
	}
	used, known := knownUsagePercentAtPaths(windowMap, "usedPercent", "used_percent", "percent", "usagePercent")
	if !known {
		return UsageWindow{}, false
	}
	resetSec := resetSecondsFromWindowMap(windowMap)
	windowMinutes := intAtPaths(windowMap, "windowMinutes", "window_minutes")
	return UsageWindow{
		ID:            strings.TrimSpace(strings.ToLower(id)),
		Label:         strings.TrimSpace(label),
		UsedPercent:   used,
		ResetSec:      resetSec,
		WindowMinutes: windowMinutes,
	}, true
}

func resetSecondsFromWindowMap(windowMap map[string]any) int64 {
	if n := intAtPaths(windowMap, "resetSecs", "resetSeconds", "reset_after_seconds"); n > 0 {
		return int64(n)
	}
	resetAt := firstStringAtPaths(windowMap, "resetsAt", "resetAt")
	if resetAt == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, resetAt)
	if err != nil {
		return 0
	}
	if d := time.Until(t); d > 0 {
		return int64(d.Seconds())
	}
	return 0
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

func recoverCodexFrameFromErrorPayload(payload map[string]any) (ParsedFrame, bool) {
	provider := strings.TrimSpace(strings.ToLower(firstString(payload, "provider", "id", "slug", "name")))
	if provider != "codex" {
		return ParsedFrame{}, false
	}

	errorPayload, ok := payload["error"].(map[string]any)
	if !ok {
		return ParsedFrame{}, false
	}
	message, ok := anyToString(errorPayload["message"])
	if !ok || !strings.Contains(message, "body=") {
		return ParsedFrame{}, false
	}

	body, ok := decodeEmbeddedJSONBody(message)
	if !ok {
		return ParsedFrame{}, false
	}

	session := percentAtPaths(body, "rate_limit.primary_window.used_percent")
	weekly := percentAtPaths(body, "rate_limit.secondary_window.used_percent")
	resetSecs := int64(0)
	if n, ok := intAtPath(body, "rate_limit.primary_window.reset_after_seconds"); ok && n > 0 {
		resetSecs = int64(n)
	}
	if session == 0 && weekly == 0 && resetSecs == 0 {
		return ParsedFrame{}, false
	}

	return ParsedFrame{
		Frame: protocol.Frame{
			V:        1,
			Provider: "codex",
			Label:    "Codex",
			Session:  session,
			Weekly:   weekly,
			ResetSec: resetSecs,
		},
		Provider: "codex",
		Source:   "openai-web-recovered",
	}, true
}

func decodeEmbeddedJSONBody(message string) (map[string]any, bool) {
	idx := strings.Index(message, "body=")
	if idx == -1 {
		return nil, false
	}
	remainder := message[idx+len("body="):]
	start := strings.Index(remainder, "{")
	if start == -1 {
		return nil, false
	}

	dec := json.NewDecoder(strings.NewReader(remainder[start:]))
	var body map[string]any
	if err := dec.Decode(&body); err != nil {
		return nil, false
	}
	return body, len(body) > 0
}

func intAtPath(m map[string]any, path string) (int, bool) {
	v, ok := getPath(m, path)
	if !ok {
		return 0, false
	}
	return anyToInt(v)
}

func intAtPaths(m map[string]any, paths ...string) int {
	for _, path := range paths {
		if v, ok := getPath(m, path); ok {
			if n, ok := anyToInt(v); ok {
				return n
			}
		}
	}
	return 0
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

const (
	defaultActivityConflictWindow = 15 * time.Second
	defaultActivityMaxAge         = 6 * time.Hour
	defaultLowConfidenceMaxAge    = 20 * time.Minute
)

type activitySignalConfidence int

const (
	activityConfidenceUnknown activitySignalConfidence = iota
	activityConfidenceLow
	activityConfidenceMedium
	activityConfidenceHigh
)

func (c activitySignalConfidence) String() string {
	switch c {
	case activityConfidenceHigh:
		return "high"
	case activityConfidenceMedium:
		return "medium"
	case activityConfidenceLow:
		return "low"
	default:
		return "unknown"
	}
}

type SelectionReason string

const (
	SelectionReasonLocalActivity SelectionReason = "local-activity"
	SelectionReasonUsageDelta    SelectionReason = "usage-delta"
	SelectionReasonStickyCurrent SelectionReason = "sticky-current"
	SelectionReasonCodexbarOrder SelectionReason = "codexbar-order"
)

type SelectionDecision struct {
	Selected             ParsedFrame
	Reason               SelectionReason
	Detail               string
	ActivitySignalReason SelectionReason
	ActivityDetail       string
}

type providerActivitySignal struct {
	At         time.Time
	Confidence activitySignalConfidence
	Evidence   string
}

type ProviderActivityDetector interface {
	ProviderKey() string
	Confidence() activitySignalConfidence
	LatestActivityAt(home string) (time.Time, bool)
}

type providerActivityReader func() (map[string]providerActivitySignal, error)

// ProviderSelector applies deterministic provider selection rules:
// usage delta -> sticky current -> CodexBar provider order.
type ProviderSelector struct {
	currentKey     string
	snapshots      map[string]providerSnapshot
	activityReader providerActivityReader
	conflictWindow time.Duration
}

type providerSnapshot struct {
	session       int
	weekly        int
	sessionTokens int64
	weekTokens    int64
	totalTokens   int64
}

type activityScore struct {
	sessionDelta       int
	weeklyDelta        int
	sessionTokensDelta int64
	weekTokensDelta    int64
	totalTokensDelta   int64
}

type localActivityCandidate struct {
	idx    int
	key    string
	signal providerActivitySignal
}

type codexActivityDetector struct{}

func (codexActivityDetector) ProviderKey() string {
	return "codex"
}

func (codexActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceHigh
}

func (codexActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestCodexActivityAt(home)
}

type claudeActivityDetector struct{}

func (claudeActivityDetector) ProviderKey() string {
	return "claude"
}

func (claudeActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceHigh
}

func (claudeActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestClaudeActivityAt(home)
}

type vertexAIActivityDetector struct{}

func (vertexAIActivityDetector) ProviderKey() string {
	return "vertexai"
}

func (vertexAIActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceHigh
}

func (vertexAIActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestVertexAIActivityAt(home)
}

type jetbrainsActivityDetector struct{}

func (jetbrainsActivityDetector) ProviderKey() string {
	return "jetbrains"
}

func (jetbrainsActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceHigh
}

func (jetbrainsActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestJetBrainsActivityAt(home)
}

type cursorSessionActivityDetector struct{}

func (cursorSessionActivityDetector) ProviderKey() string {
	return "cursor"
}

func (cursorSessionActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceMedium
}

func (cursorSessionActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestCursorSessionActivityAt(home)
}

type factorySessionActivityDetector struct{}

func (factorySessionActivityDetector) ProviderKey() string {
	return "factory"
}

func (factorySessionActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceMedium
}

func (factorySessionActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestFactorySessionActivityAt(home)
}

type augmentSessionActivityDetector struct{}

func (augmentSessionActivityDetector) ProviderKey() string {
	return "augment"
}

func (augmentSessionActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceMedium
}

func (augmentSessionActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestAugmentSessionActivityAt(home)
}

type geminiCredentialsActivityDetector struct{}

func (geminiCredentialsActivityDetector) ProviderKey() string {
	return "gemini"
}

func (geminiCredentialsActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceMedium
}

func (geminiCredentialsActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestGeminiActivityAt(home)
}

type kimiBrowserCookieActivityDetector struct{}

func (kimiBrowserCookieActivityDetector) ProviderKey() string {
	return "kimi"
}

func (kimiBrowserCookieActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceLow
}

func (kimiBrowserCookieActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestKimiCookieActivityAt(home)
}

type ollamaBrowserCookieActivityDetector struct{}

func (ollamaBrowserCookieActivityDetector) ProviderKey() string {
	return "ollama"
}

func (ollamaBrowserCookieActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceLow
}

func (ollamaBrowserCookieActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	return latestOllamaCookieActivityAt(home)
}

type genericPathActivityDetector struct {
	providerKey string
	filePaths   []string
	dirPaths    []string
}

func (d genericPathActivityDetector) ProviderKey() string {
	return d.providerKey
}

func (d genericPathActivityDetector) Confidence() activitySignalConfidence {
	return activityConfidenceMedium
}

func (d genericPathActivityDetector) LatestActivityAt(home string) (time.Time, bool) {
	var latest time.Time

	for _, path := range d.filePaths {
		if t, err := fileModTime(withHome(home, path)); err == nil {
			latest = newerTime(latest, t)
		}
	}
	for _, root := range d.dirPaths {
		if t, err := latestFileModTime(withHome(home, root), nil); err == nil {
			latest = newerTime(latest, t)
		}
	}

	return latest, !latest.IsZero()
}

func defaultActivityDetectors() []ProviderActivityDetector {
	detectors := []ProviderActivityDetector{
		codexActivityDetector{},
		claudeActivityDetector{},
		vertexAIActivityDetector{},
		jetbrainsActivityDetector{},
		cursorSessionActivityDetector{},
		factorySessionActivityDetector{},
		augmentSessionActivityDetector{},
		geminiCredentialsActivityDetector{},
		kimiBrowserCookieActivityDetector{},
		ollamaBrowserCookieActivityDetector{},
	}
	return append(detectors, customActivityDetectors()...)
}

func NewProviderSelector() *ProviderSelector {
	return NewProviderSelectorWithConfig(noLocalProviderActivity, activityConflictWindow())
}

func NewProviderSelectorWithActivityReader(reader providerActivityReader) *ProviderSelector {
	return NewProviderSelectorWithConfig(reader, defaultActivityConflictWindow)
}

func NewProviderSelectorWithConfig(reader providerActivityReader, conflictWindow time.Duration) *ProviderSelector {
	if reader == nil {
		reader = noLocalProviderActivity
	}
	if conflictWindow <= 0 {
		conflictWindow = defaultActivityConflictWindow
	}
	return &ProviderSelector{
		snapshots:      make(map[string]providerSnapshot),
		activityReader: reader,
		conflictWindow: conflictWindow,
	}
}

func noLocalProviderActivity() (map[string]providerActivitySignal, error) {
	return map[string]providerActivitySignal{}, nil
}

func (s *ProviderSelector) SetCurrentProvider(provider string) {
	if s == nil {
		return
	}
	s.currentKey = strings.TrimSpace(strings.ToLower(provider))
}

func (s *ProviderSelector) Select(all []ParsedFrame) (ParsedFrame, bool) {
	decision, ok := s.SelectWithDecision(all)
	if !ok {
		return ParsedFrame{}, false
	}
	return decision.Selected, true
}

func (s *ProviderSelector) SelectWithDecision(all []ParsedFrame) (SelectionDecision, bool) {
	if len(all) == 0 {
		return SelectionDecision{}, false
	}
	if s.snapshots == nil {
		s.snapshots = make(map[string]providerSnapshot)
	}
	if s.conflictWindow <= 0 {
		s.conflictWindow = defaultActivityConflictWindow
	}

	availableIdx := firstAvailableProviderIndex(all)
	selected := all[0]
	if availableIdx >= 0 {
		selected = all[availableIdx]
	}
	reason := SelectionReasonCodexbarOrder
	detail := "initial-provider-order"

	if byActivity, activityDetail, ok := s.selectByRecentLocalActivity(all); ok {
		selected = byActivity
		reason = SelectionReasonLocalActivity
		detail = activityDetail
	} else if byDelta, score, ok := s.selectByUsageDelta(all); ok {
		selected = byDelta
		reason = SelectionReasonUsageDelta
		detail = fmt.Sprintf("provider=%s score=%s", providerKey(byDelta), formatActivityScore(score))
	} else if s.currentKey != "" {
		if idx := indexOfProviderKey(all, s.currentKey); idx >= 0 {
			if providerUsageAvailable(all[idx]) || availableIdx < 0 {
				selected = all[idx]
				reason = SelectionReasonStickyCurrent
				detail = fmt.Sprintf("provider=%s", s.currentKey)
			} else {
				detail = fmt.Sprintf("current-provider-unavailable provider=%s", s.currentKey)
			}
		} else {
			detail = "current-provider-missing"
		}
	}

	resultSignalReason := SelectionReason("")
	resultActivityDetail := ""
	if score, ok := s.activityScoreForSelected(selected); ok {
		resultSignalReason = SelectionReasonUsageDelta
		resultActivityDetail = fmt.Sprintf("source=usage-delta score=%s", formatActivityScore(score))
	}

	s.currentKey = providerKey(selected)
	next := make(map[string]providerSnapshot, len(all))
	for _, p := range all {
		next[providerKey(p)] = providerSnapshot{
			session:       p.Frame.Session,
			weekly:        p.Frame.Weekly,
			sessionTokens: p.Frame.SessionTokens,
			weekTokens:    p.Frame.WeekTokens,
			totalTokens:   p.Frame.TotalTokens,
		}
	}
	s.snapshots = next

	return SelectionDecision{
		Selected:             selected,
		Reason:               reason,
		Detail:               detail,
		ActivitySignalReason: resultSignalReason,
		ActivityDetail:       resultActivityDetail,
	}, true
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

func (s *ProviderSelector) selectByRecentLocalActivity(all []ParsedFrame) (ParsedFrame, string, bool) {
	if s.activityReader == nil {
		return ParsedFrame{}, "", false
	}

	activityByProvider, err := s.activityReader()
	if err != nil || len(activityByProvider) == 0 {
		return ParsedFrame{}, "", false
	}

	var candidates []localActivityCandidate
	bestConfidence := activityConfidenceUnknown
	latestAt := time.Time{}
	for i, p := range all {
		key := providerKey(p)
		signal, ok := activityByProvider[key]
		if !ok || signal.At.IsZero() {
			continue
		}
		candidates = append(candidates, localActivityCandidate{idx: i, key: key, signal: signal})
		if signal.Confidence > bestConfidence {
			bestConfidence = signal.Confidence
		}
	}

	if len(candidates) == 0 {
		return ParsedFrame{}, "", false
	}

	var strongest []localActivityCandidate
	for _, candidate := range candidates {
		if candidate.signal.Confidence != bestConfidence {
			continue
		}
		strongest = append(strongest, candidate)
		if latestAt.IsZero() || candidate.signal.At.After(latestAt) {
			latestAt = candidate.signal.At
		}
	}

	if len(strongest) == 0 {
		return ParsedFrame{}, "", false
	}

	var conflictSet []localActivityCandidate
	for _, c := range strongest {
		if !latestAt.IsZero() && latestAt.Sub(c.signal.At) <= s.conflictWindow {
			conflictSet = append(conflictSet, c)
		}
	}
	if len(conflictSet) == 0 {
		return ParsedFrame{}, "", false
	}
	if len(conflictSet) == 1 {
		chosen := conflictSet[0]
		return all[chosen.idx], fmt.Sprintf("provider=%s confidence=%s at=%s evidence=%s", chosen.key, chosen.signal.Confidence, chosen.signal.At.Format(time.RFC3339), chosen.signal.Evidence), true
	}

	if idx := indexInConflictSetByProvider(conflictSet, s.currentKey); idx >= 0 {
		chosen := conflictSet[idx]
		return all[chosen.idx], fmt.Sprintf("conflict keep-current provider=%s candidates=%s", chosen.key, formatActivityCandidates(conflictSet)), true
	}

	if idx, score, ok := s.selectBestDeltaFromCandidates(all, conflictSet); ok {
		key := providerKey(all[idx])
		return all[idx], fmt.Sprintf("conflict resolved-by=usage-delta provider=%s score=%s candidates=%s", key, formatActivityScore(score), formatActivityCandidates(conflictSet)), true
	}

	// Preserve CodexBar provider order for deterministic behavior when no other tie-break applies.
	chosen := conflictSet[0]
	return all[chosen.idx], fmt.Sprintf("conflict resolved-by=codexbar-order provider=%s candidates=%s", chosen.key, formatActivityCandidates(conflictSet)), true
}

func (s *ProviderSelector) activityScoreForSelected(selected ParsedFrame) (activityScore, bool) {
	if s == nil || s.snapshots == nil {
		return activityScore{}, false
	}
	key := providerKey(selected)
	prev, ok := s.snapshots[key]
	if !ok {
		return activityScore{}, false
	}
	score := computeActivityScore(prev, selected.Frame)
	if !score.hasSignal() {
		return activityScore{}, false
	}
	return score, true
}

func (s *ProviderSelector) selectBestDeltaFromCandidates(all []ParsedFrame, conflictSet []localActivityCandidate) (int, activityScore, bool) {
	bestIdx := -1
	bestScore := activityScore{}

	for _, candidate := range conflictSet {
		prev, ok := s.snapshots[candidate.key]
		if !ok {
			continue
		}
		score := computeActivityScore(prev, all[candidate.idx].Frame)
		if !score.hasSignal() {
			continue
		}
		if bestIdx == -1 || score.betterThan(bestScore) {
			bestIdx = candidate.idx
			bestScore = score
		}
	}

	if bestIdx == -1 {
		return -1, activityScore{}, false
	}
	return bestIdx, bestScore, true
}

func (s *ProviderSelector) selectByUsageDelta(all []ParsedFrame) (ParsedFrame, activityScore, bool) {
	bestIdx := -1
	bestScore := activityScore{}

	for i, p := range all {
		key := providerKey(p)
		prev, ok := s.snapshots[key]
		if !ok {
			continue
		}

		score := computeActivityScore(prev, p.Frame)
		if !score.hasSignal() {
			continue
		}
		if bestIdx == -1 || score.betterThan(bestScore) {
			bestIdx = i
			bestScore = score
		}
	}

	if bestIdx == -1 {
		return ParsedFrame{}, activityScore{}, false
	}
	return all[bestIdx], bestScore, true
}

func readLocalProviderActivityWithDetectors(detectors []ProviderActivityDetector, nowFn func() time.Time, maxAge time.Duration) (map[string]providerActivitySignal, error) {
	result := make(map[string]providerActivitySignal)

	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return result, nil
	}

	if nowFn == nil {
		nowFn = time.Now
	}
	now := nowFn()

	for _, detector := range detectors {
		if detector == nil {
			continue
		}
		key := strings.TrimSpace(strings.ToLower(detector.ProviderKey()))
		if key == "" {
			continue
		}

		at, ok := detector.LatestActivityAt(home)
		if !ok || at.IsZero() {
			continue
		}
		confidence := detector.Confidence()
		if isStaleActivity(now, at, activityMaxAgeForConfidence(maxAge, confidence)) {
			continue
		}

		signal := providerActivitySignal{
			At:         at,
			Confidence: confidence,
			Evidence:   detector.ProviderKey(),
		}
		existing, exists := result[key]
		if !exists || signal.Confidence > existing.Confidence || (signal.Confidence == existing.Confidence && signal.At.After(existing.At)) {
			result[key] = signal
		}
	}

	return result, nil
}

func indexInConflictSetByProvider(conflictSet []localActivityCandidate, key string) int {
	key = strings.TrimSpace(strings.ToLower(key))
	if key == "" {
		return -1
	}
	for i, candidate := range conflictSet {
		if candidate.key == key {
			return i
		}
	}
	return -1
}

func formatActivityCandidates(conflictSet []localActivityCandidate) string {
	parts := make([]string, 0, len(conflictSet))
	for _, candidate := range conflictSet {
		parts = append(parts, fmt.Sprintf("%s@%s[%s]", candidate.key, candidate.signal.At.Format(time.RFC3339), candidate.signal.Confidence))
	}
	return strings.Join(parts, ",")
}

func formatActivityScore(score activityScore) string {
	return fmt.Sprintf("session+%d weekly+%d sessionTokens+%d weekTokens+%d totalTokens+%d", score.sessionDelta, score.weeklyDelta, score.sessionTokensDelta, score.weekTokensDelta, score.totalTokensDelta)
}

func activityConflictWindow() time.Duration {
	return parsePositiveDurationEnv("CODEXBAR_DISPLAY_ACTIVITY_CONFLICT_WINDOW", defaultActivityConflictWindow)
}

func parsePositiveDurationEnv(key string, def time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return def
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return def
	}
	return parsed
}

func activityMaxAgeForConfidence(maxAge time.Duration, confidence activitySignalConfidence) time.Duration {
	if confidence != activityConfidenceLow {
		return maxAge
	}
	if maxAge <= 0 || maxAge > defaultLowConfidenceMaxAge {
		return defaultLowConfidenceMaxAge
	}
	return maxAge
}

func isStaleActivity(now, at time.Time, maxAge time.Duration) bool {
	if maxAge <= 0 {
		return false
	}
	if at.After(now) {
		return false
	}
	return now.Sub(at) > maxAge
}

func latestCodexActivityAt(home string) (time.Time, bool) {
	var latest time.Time

	sessionsDir := withHome(home, envOrDefault("CODEXBAR_DISPLAY_CODEX_ACTIVITY_DIR", filepath.Join("~", ".codex", "sessions")))
	if t, err := latestJSONLModTime(sessionsDir); err == nil {
		latest = newerTime(latest, t)
	}

	historyFile := withHome(home, envOrDefault("CODEXBAR_DISPLAY_CODEX_ACTIVITY_FILE", filepath.Join("~", ".codex", "history.jsonl")))
	if t, err := fileModTime(historyFile); err == nil {
		latest = newerTime(latest, t)
	}

	return latest, !latest.IsZero()
}

func latestClaudeActivityAt(home string) (time.Time, bool) {
	var latest time.Time

	historyFile := withHome(home, envOrDefault("CODEXBAR_DISPLAY_CLAUDE_ACTIVITY_FILE", filepath.Join("~", ".claude", "history.jsonl")))
	if t, err := fileModTime(historyFile); err == nil {
		latest = newerTime(latest, t)
	}

	for _, projectsDir := range claudeProjectsActivityDirs(home) {
		if t, err := latestJSONLModTimeMatching(projectsDir, func(path string, _ os.FileInfo) bool {
			return !isCodexBarClaudeProbePath(path)
		}); err == nil {
			latest = newerTime(latest, t)
		}
	}

	return latest, !latest.IsZero()
}

func isCodexBarClaudeProbePath(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	lower := strings.ToLower(path)
	return strings.Contains(lower, "codexbar") && strings.Contains(lower, "claudeprobe")
}

func latestVertexAIActivityAt(home string) (time.Time, bool) {
	var latest time.Time

	for _, root := range vertexActivityDirs(home) {
		if t, err := latestJSONLModTimeMatching(root, func(path string, _ os.FileInfo) bool {
			return jsonlFileLooksVertexAI(path)
		}); err == nil {
			latest = newerTime(latest, t)
		}
	}

	return latest, !latest.IsZero()
}

func latestJetBrainsActivityAt(home string) (time.Time, bool) {
	var latest time.Time

	for _, root := range jetbrainsActivityDirs(home) {
		if t, err := latestFileModTime(root, func(_ string, fi os.FileInfo) bool {
			return strings.EqualFold(fi.Name(), "AIAssistantQuotaManager2.xml")
		}); err == nil {
			latest = newerTime(latest, t)
		}
	}

	return latest, !latest.IsZero()
}

func latestCursorSessionActivityAt(home string) (time.Time, bool) {
	path := withHome(home, envOrDefault("CODEXBAR_DISPLAY_CURSOR_ACTIVITY_FILE", filepath.Join("~", "Library", "Application Support", "CodexBar", "cursor-session.json")))
	if t, err := fileModTime(path); err == nil {
		return t, true
	}
	return time.Time{}, false
}

func latestFactorySessionActivityAt(home string) (time.Time, bool) {
	path := withHome(home, envOrDefault("CODEXBAR_DISPLAY_FACTORY_ACTIVITY_FILE", filepath.Join("~", "Library", "Application Support", "CodexBar", "factory-session.json")))
	if t, err := fileModTime(path); err == nil {
		return t, true
	}
	return time.Time{}, false
}

func latestAugmentSessionActivityAt(home string) (time.Time, bool) {
	path := withHome(home, envOrDefault("CODEXBAR_DISPLAY_AUGMENT_ACTIVITY_FILE", filepath.Join("~", "Library", "Application Support", "CodexBar", "augment-session.json")))
	if t, err := fileModTime(path); err == nil {
		return t, true
	}
	return time.Time{}, false
}

func latestGeminiActivityAt(home string) (time.Time, bool) {
	var latest time.Time

	creds := withHome(home, envOrDefault("CODEXBAR_DISPLAY_GEMINI_OAUTH_FILE", filepath.Join("~", ".gemini", "oauth_creds.json")))
	if t, err := fileModTime(creds); err == nil {
		latest = newerTime(latest, t)
	}

	settings := withHome(home, envOrDefault("CODEXBAR_DISPLAY_GEMINI_SETTINGS_FILE", filepath.Join("~", ".gemini", "settings.json")))
	if t, err := fileModTime(settings); err == nil {
		latest = newerTime(latest, t)
	}

	return latest, !latest.IsZero()
}

func claudeProjectsActivityDirs(home string) []string {
	if raw := strings.TrimSpace(os.Getenv("CODEXBAR_DISPLAY_CLAUDE_ACTIVITY_DIRS")); raw != "" {
		return splitAndResolvePaths(home, raw)
	}
	if raw := strings.TrimSpace(os.Getenv("CODEXBAR_DISPLAY_CLAUDE_ACTIVITY_DIR")); raw != "" {
		return []string{withHome(home, raw)}
	}
	return []string{
		withHome(home, filepath.Join("~", ".claude", "projects")),
		withHome(home, filepath.Join("~", ".config", "claude", "projects")),
	}
}

func vertexActivityDirs(home string) []string {
	if raw := strings.TrimSpace(os.Getenv("CODEXBAR_DISPLAY_VERTEX_ACTIVITY_DIRS")); raw != "" {
		return splitAndResolvePaths(home, raw)
	}
	if raw := strings.TrimSpace(os.Getenv("CODEXBAR_DISPLAY_VERTEX_ACTIVITY_DIR")); raw != "" {
		return []string{withHome(home, raw)}
	}
	return claudeProjectsActivityDirs(home)
}

func jetbrainsActivityDirs(home string) []string {
	if raw := strings.TrimSpace(os.Getenv("CODEXBAR_DISPLAY_JETBRAINS_ACTIVITY_DIRS")); raw != "" {
		return splitAndResolvePaths(home, raw)
	}
	return []string{
		withHome(home, filepath.Join("~", "Library", "Application Support", "JetBrains")),
		withHome(home, filepath.Join("~", "Library", "Application Support", "Google")),
		withHome(home, filepath.Join("~", ".config", "JetBrains")),
		withHome(home, filepath.Join("~", ".config", "Google")),
		withHome(home, filepath.Join("~", ".local", "share", "JetBrains")),
	}
}

func splitAndResolvePaths(home, csv string) []string {
	var paths []string
	for _, part := range strings.Split(csv, ",") {
		path := strings.TrimSpace(part)
		if path == "" {
			continue
		}
		paths = append(paths, withHome(home, path))
	}
	return dedupeStrings(paths)
}

func customActivityDetectors() []ProviderActivityDetector {
	const (
		filePrefix = "CODEXBAR_DISPLAY_ACTIVITY_FILE_"
		dirPrefix  = "CODEXBAR_DISPLAY_ACTIVITY_DIR_"
	)

	fileByProvider := make(map[string][]string)
	dirByProvider := make(map[string][]string)

	for _, env := range os.Environ() {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		if value == "" {
			continue
		}

		switch {
		case strings.HasPrefix(key, filePrefix):
			provider := normalizeCustomActivityProvider(strings.TrimPrefix(key, filePrefix))
			if provider == "" {
				continue
			}
			fileByProvider[provider] = append(fileByProvider[provider], value)
		case strings.HasPrefix(key, dirPrefix):
			provider := normalizeCustomActivityProvider(strings.TrimPrefix(key, dirPrefix))
			if provider == "" {
				continue
			}
			dirByProvider[provider] = append(dirByProvider[provider], value)
		}
	}

	seen := make(map[string]struct{})
	for provider := range fileByProvider {
		seen[provider] = struct{}{}
	}
	for provider := range dirByProvider {
		seen[provider] = struct{}{}
	}

	if len(seen) == 0 {
		return nil
	}

	providers := make([]string, 0, len(seen))
	for provider := range seen {
		providers = append(providers, provider)
	}
	sort.Strings(providers)

	detectors := make([]ProviderActivityDetector, 0, len(providers))
	for _, provider := range providers {
		detectors = append(detectors, genericPathActivityDetector{
			providerKey: provider,
			filePaths:   dedupeStrings(fileByProvider[provider]),
			dirPaths:    dedupeStrings(dirByProvider[provider]),
		})
	}
	return detectors
}

func normalizeCustomActivityProvider(raw string) string {
	s := strings.TrimSpace(strings.ToLower(raw))
	if s == "" {
		return ""
	}

	var b strings.Builder
	b.Grow(len(s))
	for _, ch := range s {
		if ch >= 'a' && ch <= 'z' {
			b.WriteRune(ch)
			continue
		}
		if ch >= '0' && ch <= '9' {
			b.WriteRune(ch)
		}
	}

	normalized := b.String()
	switch normalized {
	case "vertex":
		return "vertexai"
	case "kimik2", "k2":
		return "kimik2"
	default:
		return normalized
	}
}

func jsonlFileLooksVertexAI(path string) bool {
	tail, err := readFileTail(path, 128*1024)
	if err != nil || len(tail) == 0 {
		return false
	}

	text := strings.ToLower(string(tail))
	if strings.Contains(text, "_vrtx_") {
		return true
	}
	if strings.Contains(text, "\"vertexai\"") || strings.Contains(text, "\"vertex_ai\"") {
		return true
	}

	// Vertex AI Claude model names typically contain @-based version suffixes.
	return strings.Contains(text, "\"model\"") && strings.Contains(text, "claude-") && strings.Contains(text, "@20")
}

func readFileTail(path string, maxBytes int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	size := info.Size()
	start := int64(0)
	if maxBytes > 0 && size > maxBytes {
		start = size - maxBytes
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	return io.ReadAll(f)
}

func envOrDefault(key, def string) string {
	if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
		return raw
	}
	return def
}

func withHome(home, value string) string {
	v := strings.TrimSpace(value)
	switch {
	case v == "~":
		return home
	case strings.HasPrefix(v, "~/"):
		return filepath.Join(home, strings.TrimPrefix(v, "~/"))
	default:
		return v
	}
}

func latestJSONLModTime(root string) (time.Time, error) {
	return latestJSONLModTimeMatching(root, nil)
}

func latestJSONLModTimeMatching(root string, match func(path string, fi os.FileInfo) bool) (time.Time, error) {
	return latestFileModTime(root, func(path string, fi os.FileInfo) bool {
		if !strings.HasSuffix(strings.ToLower(fi.Name()), ".jsonl") {
			return false
		}
		if match == nil {
			return true
		}
		return match(path, fi)
	})
}

func latestFileModTime(root string, match func(path string, fi os.FileInfo) bool) (time.Time, error) {
	info, err := os.Stat(root)
	if err != nil {
		return time.Time{}, err
	}
	if !info.IsDir() {
		return time.Time{}, fmt.Errorf("not a directory: %s", root)
	}

	var latest time.Time
	err = filepath.Walk(root, func(path string, fi os.FileInfo, walkErr error) error {
		if walkErr != nil {
			// Ignore inaccessible entries and continue scanning.
			return nil
		}
		if fi == nil || fi.IsDir() {
			return nil
		}
		if match != nil && !match(path, fi) {
			return nil
		}
		latest = newerTime(latest, fi.ModTime())
		return nil
	})
	if err != nil {
		return time.Time{}, err
	}
	if latest.IsZero() {
		return time.Time{}, os.ErrNotExist
	}
	return latest, nil
}

func dedupeStrings(items []string) []string {
	if len(items) <= 1 {
		return items
	}
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}

func fileModTime(path string) (time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, err
	}
	if info.IsDir() {
		return time.Time{}, fmt.Errorf("path is a directory: %s", path)
	}
	return info.ModTime(), nil
}

func newerTime(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
}

func computeActivityScore(prev providerSnapshot, cur protocol.Frame) activityScore {
	score := activityScore{}
	tokenScore := activityScore{
		sessionTokensDelta: positiveInt64Delta(prev.sessionTokens, cur.SessionTokens),
		weekTokensDelta:    positiveInt64Delta(prev.weekTokens, cur.WeekTokens),
		totalTokensDelta:   positiveInt64Delta(prev.totalTokens, cur.TotalTokens),
	}
	if tokenScore.hasSignal() {
		return tokenScore
	}

	if comparableTokenStats(prev, cur) {
		return score
	}

	if d := cur.Session - prev.session; d > 0 {
		score.sessionDelta = d
	}
	if d := cur.Weekly - prev.weekly; d > 0 {
		score.weeklyDelta = d
	}
	return score
}

func (s activityScore) hasSignal() bool {
	return s.sessionDelta > 0 ||
		s.weeklyDelta > 0 ||
		s.sessionTokensDelta > 0 ||
		s.weekTokensDelta > 0 ||
		s.totalTokensDelta > 0
}

func (s activityScore) betterThan(other activityScore) bool {
	if s.totalTokensDelta != other.totalTokensDelta {
		return s.totalTokensDelta > other.totalTokensDelta
	}
	if s.sessionTokensDelta != other.sessionTokensDelta {
		return s.sessionTokensDelta > other.sessionTokensDelta
	}
	if s.weekTokensDelta != other.weekTokensDelta {
		return s.weekTokensDelta > other.weekTokensDelta
	}
	if s.sessionDelta != other.sessionDelta {
		return s.sessionDelta > other.sessionDelta
	}
	if s.weeklyDelta != other.weeklyDelta {
		return s.weeklyDelta > other.weeklyDelta
	}
	return false
}

func positiveInt64Delta(prev, cur int64) int64 {
	if prev <= 0 || cur <= prev {
		return 0
	}
	return cur - prev
}

func comparableTokenStats(prev providerSnapshot, cur protocol.Frame) bool {
	return (prev.sessionTokens > 0 && cur.SessionTokens > 0) ||
		(prev.weekTokens > 0 && cur.WeekTokens > 0) ||
		(prev.totalTokens > 0 && cur.TotalTokens > 0)
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

func fetchCodexCLIOnly(ctx context.Context, timeout time.Duration, bin string) ([]ParsedFrame, bool) {
	codexParsed, ok := fetchCodexCLIProvider(ctx, timeout, bin)
	if !ok {
		return nil, false
	}
	codexParsed.Source = fallbackSource(codexParsed.Source, "codex-cli-fallback")
	return []ParsedFrame{codexParsed}, true
}

func fetchCodexCLIProvider(ctx context.Context, timeout time.Duration, bin string) (ParsedFrame, bool) {
	cliOut, cliErr := runUsageCommandFn(ctx, timeout, bin, "usage", "--json", "--provider", "codex", "--source", "cli")
	if cliErr != nil {
		return ParsedFrame{}, false
	}
	cliAll, cliParseErr := parseAllProviders(cliOut)
	if cliParseErr != nil || len(cliAll) == 0 {
		return ParsedFrame{}, false
	}

	for _, candidate := range cliAll {
		if providerKey(candidate) == "codex" {
			candidate.Source = fallbackSource(candidate.Source, "codex-cli")
			return candidate, true
		}
	}
	return ParsedFrame{}, false
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

func fallbackContext(parent context.Context) (context.Context, context.CancelFunc) {
	if parent == nil {
		return context.WithTimeout(context.Background(), minSharedFallbackTimeBudget)
	}
	if parent.Err() != nil {
		return context.WithTimeout(context.Background(), minSharedFallbackTimeBudget)
	}
	if deadline, ok := parent.Deadline(); ok {
		if time.Until(deadline) < minSharedFallbackTimeBudget {
			return context.WithTimeout(context.Background(), minSharedFallbackTimeBudget)
		}
	}
	return parent, func() {}
}

func cliFallbackTimeout(primaryTimeout time.Duration) time.Duration {
	if primaryTimeout > 0 {
		return primaryTimeout
	}
	return commandTimeout()
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

func needsCodexCLIPriority(all []ParsedFrame) bool {
	for _, parsed := range all {
		if providerKey(parsed) == "codex" {
			// Keep aggregated codex usage as-is to mirror CodexBar desktop values.
			return false
		}
	}
	return true
}

func replaceOrAppendCodexProvider(all []ParsedFrame, codex ParsedFrame) []ParsedFrame {
	out := make([]ParsedFrame, 0, len(all)+1)
	replaced := false
	for _, parsed := range all {
		if providerKey(parsed) != "codex" {
			out = append(out, parsed)
			continue
		}
		if !replaced {
			out = append(out, codex)
			replaced = true
		}
	}
	if !replaced {
		out = append(out, codex)
	}
	return out
}

func repairCodexFromCLI(ctx context.Context, timeout time.Duration, bin string, all []ParsedFrame) []ParsedFrame {
	if !needsCodexCLIPriority(all) {
		return all
	}

	fallbackCtx, fallbackCancel := fallbackContext(ctx)
	defer fallbackCancel()
	codexCLI, ok := fetchCodexCLIProvider(fallbackCtx, cliFallbackTimeout(timeout), bin)
	if !ok {
		return all
	}
	codexCLI.Source = fallbackSource(codexCLI.Source, "codex-cli-repair")
	return replaceOrAppendCodexProvider(all, codexCLI)
}

func fallbackSource(current string, fallback string) string {
	current = strings.TrimSpace(strings.ToLower(current))
	if current == "" {
		return fallback
	}
	if strings.Contains(current, "fallback") || strings.Contains(current, "repair") {
		return current
	}
	return current + "+" + fallback
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

func percentAtPaths(m map[string]any, paths ...string) int {
	for _, p := range paths {
		if v, ok := getPath(m, p); ok {
			if n, ok := anyToInt(v); ok {
				return clampPercent(n)
			}
		}
	}
	return 0
}

func knownUsagePercentAtPaths(m map[string]any, paths ...string) (int, bool) {
	for _, path := range paths {
		value, ok := getPath(m, path)
		if !ok {
			continue
		}
		if window, ok := value.(map[string]any); ok {
			if usageKnown, exists := anyToBool(window["usageKnown"]); exists && !usageKnown {
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
