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

// FetchAllProviders returns all provider frames from CodexBar.
func FetchAllProviders(ctx context.Context) ([]ParsedFrame, error) {
	bin, err := FindBinary()
	if err != nil {
		return nil, err
	}

	timeout := commandTimeout()

	out, err := runUsageCommand(ctx, timeout, bin, "usage", "--json", "--web-timeout", "8")
	allParsed, parseErr := parseAllProviders(out)
	if err != nil {
		if len(bytes.TrimSpace(out)) == 0 {
			return nil, fmt.Errorf("run codexbar usage --json: %w", err)
		}
		if parseErr != nil {
			return nil, fmt.Errorf("run codexbar usage --json: %w (stdout parse error: %v)", err, parseErr)
		}
	} else if parseErr != nil {
		return nil, parseErr
	}

	// Codex CLI fallback: if Codex is openai-web with 0/0, retry with --source cli.
	for i, p := range allParsed {
		pf := ParsedFrame{Frame: p.Frame, Provider: p.Provider, Source: p.Source}
		if shouldTryCodexCLIFallback(pf) {
			cliOut, cliErr := runUsageCommand(ctx, timeout, bin, "usage", "--json", "--provider", "codex", "--source", "cli")
			cliAll, cliParseErr := parseAllProviders(cliOut)
			if cliParseErr == nil && (cliErr == nil || len(bytes.TrimSpace(cliOut)) > 0) && len(cliAll) > 0 {
				if isBetterFrame(cliAll[0].Frame, p.Frame) {
					allParsed[i] = cliAll[0]
				}
			}
		}
	}

	for i := range allParsed {
		allParsed[i].Frame = allParsed[i].Frame.Normalize()
	}

	return allParsed, nil
}

// FetchFirstFrame returns the single best provider frame (legacy convenience wrapper).
func FetchFirstFrame(ctx context.Context) (protocol.Frame, error) {
	all, err := FetchAllProviders(ctx)
	if err != nil {
		return protocol.Frame{}, err
	}
	if len(all) == 0 {
		return protocol.Frame{}, errors.New("codexbar returned no providers")
	}

	// Pick the provider with the most recent lastActiveAt, falling back to updatedAt.
	best := all[0]
	for _, p := range all[1:] {
		if isBetterProviderSelection(p, best) {
			best = p
		}
	}
	return best.Frame, nil
}

func commandTimeout() time.Duration {
	// Default timeout is intentionally generous because provider aggregation can be slow.
	d := 90 * time.Second
	raw := strings.TrimSpace(os.Getenv("VIBEBLOCK_CODEXBAR_TIMEOUT_SECS"))
	if raw == "" {
		return d
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return d
	}
	return time.Duration(n) * time.Second
}

func runUsageCommand(parent context.Context, timeout time.Duration, bin string, args ...string) ([]byte, error) {
	cmdCtx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, bin, args...)
	return cmd.Output()
}

type ParsedFrame struct {
	Frame           protocol.Frame
	Provider        string
	Source          string
	UpdatedAt       time.Time
	HasUpdatedAt    bool
	LastActiveAt    time.Time
	HasLastActiveAt bool
}

func parseAllProviders(raw []byte) ([]ParsedFrame, error) {
	providers, err := extractProvidersFromRawJSON(raw)
	if err != nil {
		return nil, err
	}
	if len(providers) == 0 {
		return nil, errors.New("codexbar returned no providers")
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
		return nil, errors.New("unexpected provider payload")
	}
	return result, nil
}

func parseUsageJSON(raw []byte) (ParsedFrame, error) {
	all, err := parseAllProviders(raw)
	if err != nil {
		return ParsedFrame{}, err
	}

	best := all[0]
	for _, p := range all[1:] {
		if isBetterProviderSelection(p, best) {
			best = p
		}
	}
	return best, nil
}

func extractProvidersFromRawJSON(raw []byte) ([]any, error) {
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

func parseProviderPayload(payload map[string]any) (ParsedFrame, error) {
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

	updatedAt, hasUpdatedAt := firstTimeAtPaths(payload,
		"usage.updatedAt",
		"updatedAt",
		"openaiDashboard.updatedAt",
		"credits.updatedAt",
		"usage.providerCost.updatedAt",
		"providerCost.updatedAt",
	)

	// Compute lastActiveAt = resetsAt - windowMinutes for the primary usage window.
	// This approximates when the user actually triggered activity on this provider,
	// unlike updatedAt which is just the CodexBar scrape timestamp.
	var lastActiveAt time.Time
	hasLastActiveAt := false
	if resetAt != "" {
		if rt, err := time.Parse(time.RFC3339, resetAt); err == nil {
			windowMins, hasWindow := firstIntAtPaths(payload,
				"usage.primary.windowMinutes",
				"primary.windowMinutes",
			)
			if hasWindow && windowMins > 0 {
				lastActiveAt = rt.Add(-time.Duration(windowMins) * time.Minute)
				hasLastActiveAt = true
			}
		}
	}

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
		Provider:        provider,
		Source:          source,
		UpdatedAt:       updatedAt,
		HasUpdatedAt:    hasUpdatedAt,
		LastActiveAt:    lastActiveAt,
		HasLastActiveAt: hasLastActiveAt,
	}, nil
}

func isBetterProviderSelection(candidate ParsedFrame, current ParsedFrame) bool {
	// Prefer lastActiveAt (resetsAt - windowMinutes) which approximates when
	// the user actually used a provider. This is more meaningful than updatedAt
	// which is just the CodexBar scrape timestamp and always favours whichever
	// provider was queried last.
	if candidate.HasLastActiveAt || current.HasLastActiveAt {
		if candidate.HasLastActiveAt && !current.HasLastActiveAt {
			return true
		}
		if !candidate.HasLastActiveAt && current.HasLastActiveAt {
			return false
		}
		return candidate.LastActiveAt.After(current.LastActiveAt)
	}

	// Fall back to updatedAt when no reset window information is available.
	if candidate.HasUpdatedAt && !current.HasUpdatedAt {
		return true
	}
	if candidate.HasUpdatedAt && current.HasUpdatedAt {
		return candidate.UpdatedAt.After(current.UpdatedAt)
	}
	return false
}

func shouldTryCodexCLIFallback(parsed ParsedFrame) bool {
	if !strings.EqualFold(strings.TrimSpace(parsed.Provider), "codex") {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(parsed.Source), "openai-web") {
		return false
	}
	return parsed.Frame.Session == 0 && parsed.Frame.Weekly == 0 && parsed.Frame.ResetSec == 0
}

func isBetterFrame(candidate protocol.Frame, current protocol.Frame) bool {
	if candidate.Session > current.Session {
		return true
	}
	if candidate.Weekly > current.Weekly {
		return true
	}
	if candidate.ResetSec > current.ResetSec {
		return true
	}
	return false
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

func firstTimeAtPaths(m map[string]any, paths ...string) (time.Time, bool) {
	for _, p := range paths {
		if v, ok := getPath(m, p); ok {
			if s, ok := anyToString(v); ok && s != "" {
				t, err := time.Parse(time.RFC3339, s)
				if err == nil {
					return t, true
				}
			}
		}
	}
	return time.Time{}, false
}

func firstIntAtPaths(m map[string]any, paths ...string) (int, bool) {
	for _, p := range paths {
		if v, ok := getPath(m, p); ok {
			if n, ok := anyToInt(v); ok {
				return n, true
			}
		}
	}
	return 0, false
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
