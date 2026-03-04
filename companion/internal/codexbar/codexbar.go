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

var (
	ErrNoProviders             = errors.New("codexbar returned no providers")
	ErrUnexpectedProviderShape = errors.New("unexpected provider payload")
)

var runUsageCommandFn = runUsageCommand

const minSharedFallbackTimeBudget = 4 * time.Second

var providerScopedFallbackOrder = []string{
	"codex",
	"claude",
	"cursor",
	"copilot",
	"gemini",
	"vertexai",
	"jetbrains",
	"augment",
	"factory",
}

const usageModeEnvVar = "CODEXBAR_DISPLAY_USAGE_MODE"

type FetchErrorKind string

const (
	FetchErrorUnknown     FetchErrorKind = "unknown"
	FetchErrorBinary      FetchErrorKind = "binary"
	FetchErrorCommand     FetchErrorKind = "command"
	FetchErrorParse       FetchErrorKind = "parse"
	FetchErrorNoProviders FetchErrorKind = "no-providers"
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

	if p, err := exec.LookPath("codexbar"); err == nil && p != "" {
		return p, nil
	}

	home, _ := os.UserHomeDir()
	candidates := make([]string, 0, len(knownBinaryPaths)+4)
	candidates = append(candidates, knownBinaryPaths...)
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, "Applications", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"),
			filepath.Join(home, "Applications", "CodexBar.app", "Contents", "MacOS", "CodexBar"),
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
// Codex provider data is CLI-prioritized: if a Codex CLI frame is available
// it replaces/adds the Codex provider entry from the aggregated payload.
func FetchAllProviders(ctx context.Context) ([]ParsedFrame, error) {
	bin, err := FindBinary()
	if err != nil {
		return nil, wrapFetchError(FetchErrorBinary, err)
	}

	timeout := commandTimeout()
	out, err := runUsageCommandFn(ctx, timeout, bin, "usage", "--json", "--web-timeout", "8")
	allParsed, parseErr := parseAllProviders(out)
	if shouldRetryAfterStartingCodexBarApp(err, parseErr, allParsed, out) {
		startCodexBarApp(ctx)
		retryOut, retryErr := runUsageCommandFn(ctx, timeout, bin, "usage", "--json", "--web-timeout", "8")
		retryParsed, retryParseErr := parseAllProviders(retryOut)
		out = retryOut
		err = retryErr
		allParsed = retryParsed
		parseErr = retryParseErr
	}

	// KISS fallback: when aggregated usage is unavailable, fall back to a
	// Codex CLI-only payload (then provider-scoped web fallback) instead of
	// failing hard.
	if err != nil || parseErr != nil {
		fallbackCtx := fallbackContext(ctx)
		if fallback, ok := fetchCodexCLIOnly(fallbackCtx, cliFallbackTimeout(timeout), bin); ok {
			allParsed = fallback
			err = nil
			parseErr = nil
		} else if fallback, ok := fetchFirstProviderScopedFallback(fallbackCtx, providerScopedFallbackTimeout(timeout), bin); ok {
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

	allParsed = repairCodexFromCLI(ctx, timeout, bin, allParsed)

	for i := range allParsed {
		allParsed[i].Frame = allParsed[i].Frame.Normalize()
	}

	return allParsed, nil
}

func shouldRetryAfterStartingCodexBarApp(cmdErr error, parseErr error, parsed []ParsedFrame, raw []byte) bool {
	if cmdErr == nil {
		return false
	}
	if len(parsed) > 0 {
		return false
	}

	lower := strings.ToLower(string(raw))
	if strings.Contains(lower, "dashboard data not found") ||
		strings.Contains(lower, "download app") ||
		strings.Contains(lower, "openai dashboard data not found") {
		return true
	}

	if len(bytes.TrimSpace(raw)) == 0 {
		return true
	}

	return errors.Is(parseErr, ErrNoProviders)
}

func startCodexBarApp(parent context.Context) {
	cmdCtx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()

	_ = exec.CommandContext(cmdCtx, "open", "-a", "CodexBar").Run()

	// Give launch services a short moment to bring up app internals before retry.
	select {
	case <-parent.Done():
		return
	case <-time.After(1500 * time.Millisecond):
	}
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
	parsed.Frame = parsed.Frame.Normalize()
	return parsed, nil
}

func CommandTimeout() time.Duration {
	return commandTimeout()
}

func commandTimeout() time.Duration {
	// Keep default bounded so display startup is responsive even when codexbar stalls.
	d := 120 * time.Second
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
	Frame        protocol.Frame
	Provider     string
	Source       string
	AccountEmail string
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
	for _, providerAny := range providers {
		payload, ok := providerAny.(map[string]any)
		if !ok {
			continue
		}
		parsed, err := parseProviderPayload(payload)
		if err != nil {
			continue
		}
		result = append(result, parsed)
	}

	if len(result) == 0 {
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
		return ParsedFrame{}, errors.New("provider error payload")
	}

	provider := firstString(payload, "provider", "id", "slug", "name")
	source := firstString(payload, "source")
	label := humanLabel(provider)
	if l := firstString(payload, "label", "displayName", "name"); l != "" {
		label = l
	}

	session := percentAtPaths(payload,
		"usage.primary.usedPercent",
		"primary.usedPercent",
		"session",
		"openaiDashboard.primaryLimit.usedPercent",
	)
	weekly := percentAtPaths(payload,
		"usage.secondary.usedPercent",
		"secondary.usedPercent",
		"weekly",
		"openaiDashboard.secondaryLimit.usedPercent",
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

	if provider == "" && label == "" {
		return ParsedFrame{}, errors.New("provider identity missing in codexbar output")
	}
	if label == "" {
		label = "Provider"
	}

	return ParsedFrame{
		Frame: protocol.Frame{
			V:        1,
			Provider: provider,
			Label:    label,
			Session:  session,
			Weekly:   weekly,
			ResetSec: resetSecs,
		},
		Provider:     provider,
		Source:       source,
		AccountEmail: accountEmail,
	}, nil
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
	Selected ParsedFrame
	Reason   SelectionReason
	Detail   string
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
// local activity -> usage delta -> sticky current -> CodexBar provider order.
type ProviderSelector struct {
	currentKey     string
	snapshots      map[string]providerSnapshot
	activityReader providerActivityReader
	conflictWindow time.Duration
}

type providerSnapshot struct {
	session int
	weekly  int
	reset   int64
}

type activityScore struct {
	sessionDelta int
	weeklyDelta  int
	resetGain    int64
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
	return NewProviderSelectorWithConfig(readLocalProviderActivity, activityConflictWindow())
}

func NewProviderSelectorWithActivityReader(reader providerActivityReader) *ProviderSelector {
	return NewProviderSelectorWithConfig(reader, defaultActivityConflictWindow)
}

func NewProviderSelectorWithConfig(reader providerActivityReader, conflictWindow time.Duration) *ProviderSelector {
	if reader == nil {
		reader = readLocalProviderActivity
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

	selected := all[0]
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
			selected = all[idx]
			reason = SelectionReasonStickyCurrent
			detail = fmt.Sprintf("provider=%s", s.currentKey)
		} else {
			detail = "current-provider-missing"
		}
	}

	s.currentKey = providerKey(selected)
	next := make(map[string]providerSnapshot, len(all))
	for _, p := range all {
		next[providerKey(p)] = providerSnapshot{
			session: p.Frame.Session,
			weekly:  p.Frame.Weekly,
			reset:   p.Frame.ResetSec,
		}
	}
	s.snapshots = next

	return SelectionDecision{
		Selected: selected,
		Reason:   reason,
		Detail:   detail,
	}, true
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

func readLocalProviderActivity() (map[string]providerActivitySignal, error) {
	detectors := defaultActivityDetectors()
	nowFn := time.Now
	maxAge := activityMaxAge()
	ttl := activityCacheTTL()
	if ttl <= 0 {
		return readLocalProviderActivityWithDetectors(detectors, nowFn, maxAge)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	cacheKey := fmt.Sprintf("%s|maxAge=%s|detectors=%d", strings.TrimSpace(home), maxAge, len(detectors))
	now := nowFn()

	if cached, ok := providerActivityCache.get(cacheKey, now); ok {
		return cached, nil
	}

	signals, err := readLocalProviderActivityWithDetectors(detectors, nowFn, maxAge)
	if err != nil {
		return nil, err
	}
	providerActivityCache.put(cacheKey, signals, now.Add(ttl))
	return copyProviderSignals(signals), nil
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
	return fmt.Sprintf("session+%d weekly+%d reset+%d", score.sessionDelta, score.weeklyDelta, score.resetGain)
}

func activityConflictWindow() time.Duration {
	return parsePositiveDurationEnv("CODEXBAR_DISPLAY_ACTIVITY_CONFLICT_WINDOW", defaultActivityConflictWindow)
}

func activityMaxAge() time.Duration {
	return parsePositiveDurationEnv("CODEXBAR_DISPLAY_ACTIVITY_MAX_AGE", defaultActivityMaxAge)
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
	if d := cur.Session - prev.session; d > 0 {
		score.sessionDelta = d
	}
	if d := cur.Weekly - prev.weekly; d > 0 {
		score.weeklyDelta = d
	}

	// resetSecs normally counts down. A jump upwards suggests a fresh activity
	// window or state repair from a previously missing reset.
	if prev.reset == 0 && cur.ResetSec > 0 {
		score.resetGain = cur.ResetSec
	} else if jump := cur.ResetSec - prev.reset; jump > 120 {
		score.resetGain = jump
	}

	return score
}

func (s activityScore) hasSignal() bool {
	return s.sessionDelta > 0 || s.weeklyDelta > 0 || s.resetGain > 0
}

func (s activityScore) betterThan(other activityScore) bool {
	if s.sessionDelta != other.sessionDelta {
		return s.sessionDelta > other.sessionDelta
	}
	if s.weeklyDelta != other.weeklyDelta {
		return s.weeklyDelta > other.weeklyDelta
	}
	if s.resetGain != other.resetGain {
		return s.resetGain > other.resetGain
	}
	return false
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
			return candidate, true
		}
	}
	return ParsedFrame{}, false
}

func fetchFirstProviderScopedFallback(ctx context.Context, timeout time.Duration, bin string) ([]ParsedFrame, bool) {
	for _, provider := range providerScopedFallbackOrder {
		parsed, ok := fetchProviderScopedUsage(ctx, timeout, bin, provider)
		if !ok {
			continue
		}
		return []ParsedFrame{parsed}, true
	}
	return nil, false
}

func fetchProviderScopedUsage(ctx context.Context, timeout time.Duration, bin string, provider string) (ParsedFrame, bool) {
	parsed, err := fetchProviderScopedUsageDetailed(ctx, timeout, bin, provider, 8, "")
	return parsed, err == nil
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
	parsed[0].Frame = parsed[0].Frame.Normalize()
	return parsed[0], nil
}

func fallbackContext(parent context.Context) context.Context {
	if parent == nil {
		ctx, _ := context.WithTimeout(context.Background(), minSharedFallbackTimeBudget)
		return ctx
	}
	if parent.Err() != nil {
		ctx, _ := context.WithTimeout(context.Background(), minSharedFallbackTimeBudget)
		return ctx
	}
	if deadline, ok := parent.Deadline(); ok {
		if time.Until(deadline) < minSharedFallbackTimeBudget {
			ctx, _ := context.WithTimeout(context.Background(), minSharedFallbackTimeBudget)
			return ctx
		}
	}
	return parent
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
	hasCodex := false
	for _, parsed := range all {
		if providerKey(parsed) != "codex" {
			continue
		}
		hasCodex = true
		if !isCodexCLISource(parsed.Source) {
			return true
		}
	}
	return !hasCodex
}

func isCodexCLISource(source string) bool {
	s := strings.TrimSpace(strings.ToLower(source))
	return s == "codex-cli" || s == "cli"
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

	codexCLI, ok := fetchCodexCLIProvider(fallbackContext(ctx), cliFallbackTimeout(timeout), bin)
	if !ok {
		return all
	}
	return replaceOrAppendCodexProvider(all, codexCLI)
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

func percentAtPaths(m map[string]any, paths ...string) int {
	for _, p := range paths {
		if v, ok := getPath(m, p); ok {
			if n, ok := anyToInt(v); ok {
				if n < 0 {
					n = 0
				}
				if n > 100 {
					n = 100
				}
				return n
			}
		}
	}
	return 0
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
