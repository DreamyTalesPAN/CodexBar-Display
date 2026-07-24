package codexbar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	ProviderReady              = "ready"
	ProviderAuthRequired       = "auth_required"
	ProviderPermissionRequired = "permission_required"
	ProviderNoUsageAvailable   = "no_usage_available"
	ProviderTimeout            = "timeout"
	ProviderConfigError        = "config_error"
	ProviderEngineError        = "engine_error"
	ProviderNotConfigured      = "not_configured"
)

type configPathContextKey struct{}

type EngineReadiness struct {
	Status     string `json:"status"`
	Version    string `json:"version,omitempty"`
	Path       string `json:"path,omitempty"`
	Source     string `json:"source,omitempty"`
	ConfigPath string `json:"configPath,omitempty"`
	Writable   bool   `json:"configWritable"`
}

type ProviderReadiness struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Enabled     bool   `json:"enabled"`
	Status      string `json:"status"`
	Source      string `json:"source,omitempty"`
	CollectedAt string `json:"collectedAt,omitempty"`
	Detail      string `json:"detail,omitempty"`
	NextAction  string `json:"nextAction,omitempty"`
}

type ProviderSetup struct {
	Status     string              `json:"status"`
	CheckedAt  string              `json:"checkedAt"`
	Engine     EngineReadiness     `json:"engine"`
	Providers  []ProviderReadiness `json:"providers"`
	ExactUsage *ParsedFrame        `json:"-"`
}

var openCodexBarCommand = func(ctx context.Context) error {
	return exec.CommandContext(ctx, "/usr/bin/open", "-b", "com.steipete.codexbar").Run()
}

var runConfigBootstrapCommandFn = runConfigBootstrapCommand

// EnsureConfig selects an existing CodexBar config without modifying it. If
// none exists, CodexBar itself renders and validates its current default config
// into a private path outside ~/.config. VibeTV never owns the provider
// inventory or its defaults.
func EnsureConfig(home string) (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("CODEXBAR_CONFIG")); explicit != "" {
		return ensureConfigFile(explicit)
	}
	home = strings.TrimSpace(home)
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
	}
	for _, candidate := range []string{
		filepath.Join(home, ".config", "codexbar", "config.json"),
		filepath.Join(home, ".codexbar", "config.json"),
	} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, writableConfig(candidate)
		}
	}
	return ensureConfigFile(filepath.Join(home, ".codexbar", "config.json"))
}

func ensureConfigFile(path string) (string, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "." || path == "" {
		return "", errors.New("CodexBar config path is empty")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return path, fmt.Errorf("create CodexBar config directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return path, fmt.Errorf("protect CodexBar config directory: %w", err)
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		bin, findErr := FindBinary()
		if findErr != nil {
			return path, fmt.Errorf("find CodexBar for config initialization: %w", findErr)
		}
		if initErr := initializeConfigFile(path, bin); initErr != nil {
			return path, initErr
		}
	} else if err != nil {
		return path, fmt.Errorf("inspect CodexBar config: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return path, fmt.Errorf("protect CodexBar config: %w", err)
	}
	return path, writableConfig(path)
}

func initializeConfigFile(path, bin string) error {
	dir := filepath.Dir(path)
	staged, err := os.CreateTemp(dir, ".vibetv-codexbar-default-*")
	if err != nil {
		return fmt.Errorf("stage CodexBar config: %w", err)
	}
	stagedPath := staged.Name()
	if closeErr := staged.Close(); closeErr != nil {
		_ = os.Remove(stagedPath)
		return fmt.Errorf("close staged CodexBar config: %w", closeErr)
	}
	if err := os.Remove(stagedPath); err != nil {
		return fmt.Errorf("prepare CodexBar config staging path: %w", err)
	}
	defer os.Remove(stagedPath)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	raw, err := runConfigBootstrapCommandFn(
		ctx,
		bin,
		stagedPath,
		"config",
		"dump",
		"--format",
		"json",
	)
	if err != nil {
		return fmt.Errorf("render CodexBar default config: %w", err)
	}
	if !json.Valid(raw) {
		return errors.New("CodexBar default config is not valid JSON")
	}
	if err := os.WriteFile(stagedPath, raw, 0o600); err != nil {
		return fmt.Errorf("write staged CodexBar config: %w", err)
	}
	if _, err := runConfigBootstrapCommandFn(
		ctx,
		bin,
		stagedPath,
		"config",
		"validate",
		"--format",
		"json",
	); err != nil {
		return fmt.Errorf("validate CodexBar default config: %w", err)
	}
	// A hard link publishes without replacing a config another process may
	// have created while CodexBar was rendering its defaults.
	if err := os.Link(stagedPath, path); err != nil {
		if _, statErr := os.Stat(path); statErr == nil {
			return nil
		}
		return fmt.Errorf("publish CodexBar default config: %w", err)
	}
	return nil
}

func runConfigBootstrapCommand(
	ctx context.Context,
	bin string,
	configPath string,
	args ...string,
) ([]byte, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = environmentWithConfig(configPath)
	return cmd.Output()
}

func writableConfig(path string) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		return fmt.Errorf("CodexBar config is not writable: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close CodexBar config: %w", err)
	}
	probe, err := os.CreateTemp(filepath.Dir(path), ".vibetv-write-check-*")
	if err != nil {
		return fmt.Errorf("CodexBar config directory is not writable: %w", err)
	}
	probePath := probe.Name()
	if closeErr := probe.Close(); closeErr != nil {
		_ = os.Remove(probePath)
		return fmt.Errorf("close CodexBar config write check: %w", closeErr)
	}
	if err := os.Remove(probePath); err != nil {
		return fmt.Errorf("remove CodexBar config write check: %w", err)
	}
	return nil
}

func commandEnvironment(configPath string) []string {
	path := strings.TrimSpace(configPath)
	if path == "" {
		var err error
		path, err = EnsureConfig("")
		if err != nil || path == "" {
			return environmentWithConfig("")
		}
	}
	return environmentWithConfig(path)
}

func environmentWithConfig(configPath string) []string {
	env := os.Environ()
	filtered := make([]string, 0, len(env)+1)
	for _, entry := range env {
		if strings.HasPrefix(entry, "CODEXBAR_CONFIG=") {
			if strings.TrimSpace(strings.TrimPrefix(entry, "CODEXBAR_CONFIG=")) != "" &&
				strings.TrimSpace(configPath) == "" {
				return env
			}
			continue
		}
		filtered = append(filtered, entry)
	}
	if path := strings.TrimSpace(configPath); path != "" {
		filtered = append(filtered, "CODEXBAR_CONFIG="+path)
	}
	return filtered
}

func configPathFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	path, _ := ctx.Value(configPathContextKey{}).(string)
	return strings.TrimSpace(path)
}

// ProbeProviderSetup performs one bounded, read-only CodexBar usage probe.
// It never returns provider error text verbatim because that text can contain
// account identifiers, paths or tokens.
func ProbeProviderSetup(ctx context.Context, home string) ProviderSetup {
	return probeProviderSetup(ctx, home, "")
}

// ProbeProviderSetupForProvider verifies one provider from CodexBar's dynamic
// inventory. The usage call is explicitly provider-scoped and uses CodexBar's
// authoritative auto source selection.
func ProbeProviderSetupForProvider(ctx context.Context, home, providerID string) ProviderSetup {
	return probeProviderSetup(ctx, home, strings.TrimSpace(strings.ToLower(providerID)))
}

func probeProviderSetup(ctx context.Context, home, exactProvider string) ProviderSetup {
	result := ProviderSetup{Status: "setup_required", CheckedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	bin, err := FindBinary()
	if err != nil {
		result.Engine.Status = ProviderNotConfigured
		result.Providers = []ProviderReadiness{providerResult("codexbar", ProviderNotConfigured)}
		return result
	}
	result.Engine.Path = bin
	result.Engine.Source = BinarySource(bin)
	configPath, configErr := EnsureConfig(home)
	result.Engine.ConfigPath = configPath
	result.Engine.Writable = configErr == nil
	if configErr != nil {
		result.Engine.Status = ProviderConfigError
		result.Providers = []ProviderReadiness{providerResult("codexbar", ProviderConfigError)}
		return result
	}
	configuredCtx := context.WithValue(ctx, configPathContextKey{}, configPath)
	versionCtx, cancelVersion := context.WithTimeout(configuredCtx, versionCheckTimeout)
	version, versionErr := installedVersion(versionCtx, bin)
	cancelVersion()
	if versionErr != nil {
		result.Engine.Status = ProviderEngineError
		result.Providers = []ProviderReadiness{providerResult("codexbar", ProviderEngineError)}
		return result
	}
	result.Engine.Version = version.String()
	minimum, _ := parseLooseVersion(minSupportedVersionString)
	if version.Compare(minimum) < 0 {
		result.Engine.Status = ProviderEngineError
		result.Providers = []ProviderReadiness{providerResult("codexbar", ProviderEngineError)}
		return result
	}
	result.Engine.Status = ProviderReady

	probeCtx, cancel := context.WithTimeout(configuredCtx, 20*time.Second)
	defer cancel()
	args := []string{"usage", "--json", "--web-timeout", "8"}
	var exactSetting *ProviderSetting
	if exactProvider != "" {
		if !validProviderID(exactProvider) {
			result.Providers = []ProviderReadiness{providerResult(exactProvider, ProviderNotConfigured)}
			return result
		}
		inventoryRaw, inventoryErr := runUsageCommandFn(probeCtx, 5*time.Second, bin, "config", "providers", "--json")
		inventory, parseErr := parseProviderSettings(inventoryRaw)
		if inventoryErr != nil || parseErr != nil {
			result.Providers = []ProviderReadiness{providerResult(exactProvider, ProviderConfigError)}
			return result
		}
		for i := range inventory {
			if inventory[i].ID == exactProvider {
				exactSetting = &inventory[i]
				break
			}
		}
		if exactSetting == nil {
			result.Providers = []ProviderReadiness{providerResult(exactProvider, ProviderNotConfigured)}
			return result
		}
		args = []string{
			"usage", "--json",
			"--provider", exactProvider,
			"--source", "auto",
			"--web-timeout", "8",
		}
	}
	out, commandErr := runUsageCommandFn(probeCtx, 18*time.Second, bin, args...)
	if exactProvider == "" {
		result.Providers = providerReadinessFromOutput(out, commandErr, probeCtx.Err())
	} else {
		provider := exactProviderReadinessFromOutput(exactProvider, out, commandErr, probeCtx.Err())
		provider.Label = exactSetting.Label
		provider.Enabled = exactSetting.Enabled
		result.Providers = []ProviderReadiness{provider}
		if provider.Status == ProviderReady {
			collectedAt, collectedErr := time.Parse(time.RFC3339, provider.CollectedAt)
			if parsed, parseErr := parseAllProviders(out); parseErr == nil && collectedErr == nil {
				for i := range parsed {
					if providerKey(parsed[i]) != exactProvider {
						continue
					}
					parsed[i].Frame = parsed[i].Frame.Normalize()
					parsed[i].CollectedAt = collectedAt.UTC()
					result.ExactUsage = &parsed[i]
					break
				}
			}
		}
	}
	for _, provider := range result.Providers {
		if provider.Status == ProviderReady {
			result.Status = ProviderReady
			return result
		}
	}
	return result
}

func exactProviderReadinessFromOutput(providerID string, raw []byte, commandErr, contextErr error) ProviderReadiness {
	for _, provider := range providerReadinessFromOutput(raw, commandErr, contextErr) {
		if provider.ID == providerID {
			return provider
		}
		if provider.ID == "codexbar" && provider.Status == ProviderTimeout {
			return providerResult(providerID, ProviderTimeout)
		}
	}
	return providerResult(providerID, ProviderNoUsageAvailable)
}

func providerReadinessFromOutput(raw []byte, commandErr, contextErr error) []ProviderReadiness {
	if errors.Is(contextErr, context.DeadlineExceeded) || errors.Is(commandErr, context.DeadlineExceeded) {
		return []ProviderReadiness{providerResult("codexbar", ProviderTimeout)}
	}
	providers, parseErr := extractProvidersFromRawJSON(raw)
	if parseErr != nil || len(providers) == 0 {
		status := ProviderNotConfigured
		if commandErr != nil {
			status = classifyProviderError(commandErrorDetail(commandErr))
		}
		return []ProviderReadiness{providerResult("codexbar", status)}
	}
	seen := make(map[string]ProviderReadiness)
	for _, item := range providers {
		payload, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id := strings.ToLower(strings.TrimSpace(firstString(payload, "provider", "id", "slug", "name")))
		if id == "" || id == "cli" {
			continue
		}
		status := ProviderReady
		if providerPayloadHasError(payload) {
			status = classifyProviderError(providerErrorText(payload))
		} else if !providerPayloadHasUsage(payload) {
			status = ProviderNoUsageAvailable
		}
		provider := providerResult(id, status)
		provider.Enabled = true
		provider.Source = safeProviderSource(firstString(payload, "source"))
		if collectedAt := firstRFC3339AtPaths(payload, "usage.updatedAt", "updatedAt"); !collectedAt.IsZero() {
			provider.CollectedAt = collectedAt.Format(time.RFC3339)
		}
		seen[id] = provider
	}
	if len(seen) == 0 {
		return []ProviderReadiness{providerResult("codexbar", ProviderNotConfigured)}
	}
	result := make([]ProviderReadiness, 0, len(seen))
	for _, provider := range seen {
		result = append(result, provider)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func safeProviderSource(raw string) string {
	source := strings.TrimSpace(strings.ToLower(raw))
	if source == "" || len(source) > 40 {
		return ""
	}
	for _, character := range source {
		if (character >= 'a' && character <= 'z') ||
			(character >= '0' && character <= '9') ||
			character == '-' || character == '_' || character == '.' || character == '+' {
			continue
		}
		return ""
	}
	return source
}

func commandErrorDetail(err error) string {
	if err == nil {
		return ""
	}
	detail := err.Error()
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
		detail += " " + string(exitErr.Stderr)
	}
	return detail
}

func providerPayloadHasUsage(payload map[string]any) bool {
	if len(parseUsageWindows(payload)) > 0 {
		return true
	}
	for _, path := range []string{"credits", "openaiDashboard.credits", "openaiDashboard.balance"} {
		if value, ok := getPath(payload, path); ok && value != nil {
			return true
		}
	}
	return false
}

func providerErrorText(payload map[string]any) string {
	raw := payload["error"]
	switch value := raw.(type) {
	case string:
		return value
	case map[string]any:
		encoded, _ := json.Marshal(value)
		return string(encoded)
	default:
		return fmt.Sprint(value)
	}
}

func classifyProviderError(detail string) string {
	lower := strings.ToLower(detail)
	switch {
	case strings.Contains(lower, "timeout"), strings.Contains(lower, "timed out"), strings.Contains(lower, "deadline exceeded"):
		return ProviderTimeout
	case strings.Contains(lower, "permission"), strings.Contains(lower, "not permitted"), strings.Contains(lower, "access denied"), strings.Contains(lower, "keychain") && (strings.Contains(lower, "denied") || strings.Contains(lower, "locked") || strings.Contains(lower, "not allowed")):
		return ProviderPermissionRequired
	case strings.Contains(lower, ".config"), strings.Contains(lower, "config"), strings.Contains(lower, "read-only file system"), strings.Contains(lower, "save"):
		return ProviderConfigError
	case strings.Contains(lower, "login"), strings.Contains(lower, "log in"), strings.Contains(lower, "logged in"), strings.Contains(lower, "sign in"), strings.Contains(lower, "session"), strings.Contains(lower, "cookie"), strings.Contains(lower, "credential"), strings.Contains(lower, "authentication"), strings.Contains(lower, "unauthorized"), strings.Contains(lower, "oauth"), strings.Contains(lower, "api key"), strings.Contains(lower, "token found"), strings.Contains(lower, "keychain"):
		return ProviderAuthRequired
	case strings.Contains(lower, "free tier"), strings.Contains(lower, "free plan"), strings.Contains(lower, "subscription required"), strings.Contains(lower, "account does not expose usage"), strings.Contains(lower, "usage") && (strings.Contains(lower, "unavailable") || strings.Contains(lower, "not available") || strings.Contains(lower, "unsupported")):
		return ProviderNoUsageAvailable
	case strings.Contains(lower, "no available fetch strategy"), strings.Contains(lower, "no providers"):
		return ProviderNotConfigured
	default:
		return ProviderEngineError
	}
}

func providerResult(id, status string) ProviderReadiness {
	label := humanLabel(id)
	if id == "codexbar" {
		label = "CodexBar"
	}
	result := ProviderReadiness{ID: id, Label: label, Status: status}
	switch status {
	case ProviderReady:
		result.Detail = "Usage data is available."
	case ProviderAuthRequired:
		result.Detail = "This provider needs an active sign-in."
		result.NextAction = "Open CodexBar and sign in to this provider, then check again."
	case ProviderPermissionRequired:
		result.Detail = "macOS blocked access required by this provider."
		result.NextAction = "Open CodexBar and allow the requested macOS permission, then check again."
	case ProviderNoUsageAvailable:
		result.Detail = "This account does not expose usage data."
		result.NextAction = "Choose another provider that exposes usage limits."
	case ProviderTimeout:
		result.Detail = "The provider check timed out."
		result.NextAction = "Open CodexBar, confirm the provider works, then check again."
	case ProviderConfigError:
		result.Detail = "CodexBar could not save or read its provider configuration."
		result.NextAction = "Open CodexBar and check its provider settings."
	case ProviderNotConfigured:
		result.Detail = "No usable AI provider is configured yet."
		result.NextAction = "Open CodexBar and connect an AI provider."
	default:
		result.Detail = "CodexBar could not read this provider."
		result.NextAction = "Open CodexBar, check this provider, then try again."
	}
	return result
}

func BinarySource(bin string) string {
	if explicit := strings.TrimSpace(os.Getenv("CODEXBAR_BIN")); explicit != "" && filepath.Clean(bin) == filepath.Clean(explicit) {
		return "override"
	}
	if executable, err := executablePathFn(); err == nil && strings.HasPrefix(filepath.Clean(bin), filepath.Dir(executable)+string(os.PathSeparator)) {
		return "bundled"
	}
	return "system"
}

func OpenApp(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return openCodexBarCommand(ctx)
}
