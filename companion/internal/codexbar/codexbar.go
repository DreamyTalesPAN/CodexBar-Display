package codexbar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

func FetchFirstFrame(ctx context.Context) (protocol.Frame, error) {
	bin, err := FindBinary()
	if err != nil {
		return protocol.Frame{}, err
	}

	cmdCtx, cancel := context.WithTimeout(ctx, commandTimeout())
	defer cancel()

	out, err := runUsageCommand(cmdCtx, bin, "usage", "--json", "--web-timeout", "8")
	if err != nil {
		return protocol.Frame{}, fmt.Errorf("run codexbar usage --json: %w", err)
	}

	parsed, err := parseUsageJSON(out)
	if err != nil {
		return protocol.Frame{}, err
	}

	// CodexBar auto source can intermittently switch Codex to openai-web with 0/0 and no reset.
	// In that case, query Codex CLI explicitly and prefer it when it carries better data.
	if shouldTryCodexCLIFallback(parsed) {
		cliOut, cliErr := runUsageCommand(cmdCtx, bin, "usage", "--json", "--provider", "codex", "--source", "cli")
		if cliErr == nil {
			if cliParsed, parseErr := parseUsageJSON(cliOut); parseErr == nil {
				if isBetterFrame(cliParsed.Frame, parsed.Frame) {
					return cliParsed.Frame.Normalize(), nil
				}
			}
		}
	}

	return parsed.Frame.Normalize(), nil
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

func runUsageCommand(ctx context.Context, bin string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	return cmd.Output()
}

type ParsedFrame struct {
	Frame    protocol.Frame
	Provider string
	Source   string
}

func parseUsageJSON(raw []byte) (ParsedFrame, error) {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return ParsedFrame{}, fmt.Errorf("parse codexbar json: %w", err)
	}

	providers := extractProviderList(root)
	if len(providers) == 0 {
		return ParsedFrame{}, errors.New("codexbar returned no providers")
	}

	first, ok := providers[0].(map[string]any)
	if !ok {
		return ParsedFrame{}, errors.New("unexpected provider payload")
	}

	provider := firstString(first, "provider", "id", "slug", "name")
	source := firstString(first, "source")
	label := humanLabel(provider)
	if l := firstString(first, "label", "displayName", "name"); l != "" {
		label = l
	}

	session := percentAtPaths(first,
		"usage.primary.usedPercent",
		"primary.usedPercent",
		"session",
		"openaiDashboard.primaryLimit.usedPercent",
	)
	weekly := percentAtPaths(first,
		"usage.secondary.usedPercent",
		"secondary.usedPercent",
		"weekly",
		"openaiDashboard.secondaryLimit.usedPercent",
	)

	resetAt := firstStringAtPaths(first,
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
		Provider: provider,
		Source:   source,
	}, nil
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
