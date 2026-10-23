package codexbar

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/childproc"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

var (
	ErrNoProviders             = errors.New("codexbar returned no providers")
	ErrUnexpectedProviderShape = errors.New("unexpected provider payload")
	errGlobalCLI               = errors.New("codexbar returned a global cli error")
)

var runUsageCommandFn = runUsageCommand
var runCostCommandFn = runUsageCommand
var runVersionCommandFn = runUsageCommand
var executablePathFn = os.Executable
var usagePreferenceGOOS = runtime.GOOS
var runUsagePreferenceCommandFn = func(ctx context.Context, bin string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, bin, args...).Output()
}

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

// UsageBarsShowUsed projects the usage data using CodexBar's effective mode.
// Existing display callers keep their used-data fallback when it is unknown;
// editable settings must use ReadUsageBarsShowUsed to preserve that distinction.
func UsageBarsShowUsed() bool {
	showUsed, err := ReadUsageBarsShowUsed()
	return err != nil || showUsed
}

// ReadUsageBarsShowUsed reads the saved choice, or CodexBar's effective choice
// from the existing bounded serve reading when no defaults value can be read.
func ReadUsageBarsShowUsed() (bool, error) {
	if showUsed, ok := usageBarsShowUsedFromEnv(); ok {
		return showUsed, nil
	}
	if usagePreferenceGOOS != "darwin" {
		return true, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	out, err := runUsagePreferenceCommandFn(ctx, "defaults", "read", "com.steipete.codexbar", "usageBarsShowUsed")
	if err == nil {
		if showUsed, ok := parseBoolPreference(out); ok {
			return showUsed, nil
		}
	}
	serveUsage.mu.Lock()
	defer serveUsage.mu.Unlock()
	if age := time.Since(serveUsage.at); age >= 0 && age <= serveUsage.maxAge && serveUsage.showUsed != nil {
		return *serveUsage.showUsed, nil
	}
	return false, errors.New("CodexBar usage preference is unavailable")
}

// UsageBarsShowUsedOverridden prevents a saved choice from being offered when
// the process environment takes precedence over CodexBar's own preference.
func UsageBarsShowUsedOverridden() bool {
	return strings.TrimSpace(os.Getenv(usageModeEnvVar)) != ""
}

// SetUsageBarsShowUsed writes only CodexBar's preference. Existing usage reads
// and display cycles pick it up without a VibeTV setting or cache.
func SetUsageBarsShowUsed(parent context.Context, showUsed bool) error {
	if usagePreferenceGOOS != "darwin" || UsageBarsShowUsedOverridden() {
		return errors.New("CodexBar usage preference is not writable")
	}
	ctx, cancel := context.WithTimeout(parent, 1500*time.Millisecond)
	defer cancel()
	_, err := runUsagePreferenceCommandFn(ctx, "defaults", "write", "com.steipete.codexbar", "usageBarsShowUsed", "-bool", strconv.FormatBool(showUsed))
	if err == nil {
		// A pre-write serve answer cannot confirm the newly saved preference.
		// Keep provider readings; only invalidate this field and fence older fetches.
		serveUsage.mu.Lock()
		serveUsage.showUsed = nil
		serveUsage.forgotten++
		serveUsage.mu.Unlock()
	}
	return err
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

func withHome(home, value string) string {
	v := strings.TrimSpace(value)
	switch {
	case v == "~":
		return home
	case strings.HasPrefix(filepath.ToSlash(v), "~/"):
		return filepath.Join(home, v[2:])
	default:
		return v
	}
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
