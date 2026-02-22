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

// FetchAllProviders reads provider usage from CodexBar and normalizes it.
//
// To handle the known Codex web bug (0/0 usage), we patch the Codex provider
// from `--provider codex --source cli` when needed.
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

	allParsed = repairCodexFromCLI(ctx, timeout, bin, allParsed)

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
		return protocol.Frame{}, errors.New("codexbar returned no providers")
	}
	return selected.Frame, nil
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
	if len(all) == 0 {
		return ParsedFrame{}, errors.New("codexbar returned no providers")
	}
	return all[0], nil
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

// ProviderSelector tracks previous snapshots and switches only on real activity deltas.
type ProviderSelector struct {
	currentKey     string
	snapshots      map[string]providerSnapshot
	activityReader providerActivityReader
}

type providerActivityReader func() (map[string]time.Time, error)

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

func NewProviderSelector() *ProviderSelector {
	return NewProviderSelectorWithActivityReader(readLocalProviderActivity)
}

func NewProviderSelectorWithActivityReader(reader providerActivityReader) *ProviderSelector {
	return &ProviderSelector{
		snapshots:      make(map[string]providerSnapshot),
		activityReader: reader,
	}
}

func (s *ProviderSelector) Select(all []ParsedFrame) (ParsedFrame, bool) {
	if len(all) == 0 {
		return ParsedFrame{}, false
	}
	if s.snapshots == nil {
		s.snapshots = make(map[string]providerSnapshot)
	}

	selected := all[0]
	if byActivity, ok := s.selectByRecentLocalActivity(all); ok {
		selected = byActivity
	} else if byDelta, ok := s.selectByUsageDelta(all); ok {
		selected = byDelta
	} else if s.currentKey != "" {
		if idx := indexOfProviderKey(all, s.currentKey); idx >= 0 {
			selected = all[idx]
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

	return selected, true
}

func (s *ProviderSelector) selectByRecentLocalActivity(all []ParsedFrame) (ParsedFrame, bool) {
	if s.activityReader == nil {
		return ParsedFrame{}, false
	}

	activityByProvider, err := s.activityReader()
	if err != nil || len(activityByProvider) == 0 {
		return ParsedFrame{}, false
	}

	bestIdx := -1
	var bestAt time.Time
	for i, p := range all {
		at, ok := activityByProvider[providerKey(p)]
		if !ok {
			continue
		}
		if bestIdx == -1 || at.After(bestAt) {
			bestIdx = i
			bestAt = at
		}
	}

	if bestIdx == -1 {
		return ParsedFrame{}, false
	}
	return all[bestIdx], true
}

func (s *ProviderSelector) selectByUsageDelta(all []ParsedFrame) (ParsedFrame, bool) {
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
		return ParsedFrame{}, false
	}
	return all[bestIdx], true
}

func readLocalProviderActivity() (map[string]time.Time, error) {
	result := make(map[string]time.Time)

	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return result, nil
	}

	if t, ok := latestCodexActivityAt(home); ok {
		result["codex"] = t
	}
	if t, ok := latestClaudeActivityAt(home); ok {
		result["claude"] = t
	}

	return result, nil
}

func latestCodexActivityAt(home string) (time.Time, bool) {
	var latest time.Time

	sessionsDir := withHome(home, envOrDefault("VIBEBLOCK_CODEX_ACTIVITY_DIR", filepath.Join("~", ".codex", "sessions")))
	if t, err := latestJSONLModTime(sessionsDir); err == nil {
		latest = newerTime(latest, t)
	}

	historyFile := withHome(home, envOrDefault("VIBEBLOCK_CODEX_ACTIVITY_FILE", filepath.Join("~", ".codex", "history.jsonl")))
	if t, err := fileModTime(historyFile); err == nil {
		latest = newerTime(latest, t)
	}

	return latest, !latest.IsZero()
}

func latestClaudeActivityAt(home string) (time.Time, bool) {
	var latest time.Time

	historyFile := withHome(home, envOrDefault("VIBEBLOCK_CLAUDE_ACTIVITY_FILE", filepath.Join("~", ".claude", "history.jsonl")))
	if t, err := fileModTime(historyFile); err == nil {
		latest = newerTime(latest, t)
	}

	projectsDir := withHome(home, envOrDefault("VIBEBLOCK_CLAUDE_ACTIVITY_DIR", filepath.Join("~", ".claude", "projects")))
	if t, err := latestJSONLModTime(projectsDir); err == nil {
		latest = newerTime(latest, t)
	}

	return latest, !latest.IsZero()
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
		if !strings.HasSuffix(strings.ToLower(fi.Name()), ".jsonl") {
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

func repairCodexFromCLI(ctx context.Context, timeout time.Duration, bin string, all []ParsedFrame) []ParsedFrame {
	idx := -1
	for i := range all {
		if shouldTryCodexCLIRepair(all[i]) {
			idx = i
			break
		}
	}
	if idx == -1 {
		return all
	}

	cliOut, cliErr := runUsageCommand(ctx, timeout, bin, "usage", "--json", "--provider", "codex", "--source", "cli")
	cliAll, cliParseErr := parseAllProviders(cliOut)
	if cliErr != nil || cliParseErr != nil || len(cliAll) == 0 {
		return all
	}

	for _, candidate := range cliAll {
		if strings.EqualFold(strings.TrimSpace(candidate.Provider), "codex") {
			all[idx] = candidate
			return all
		}
	}

	all[idx] = cliAll[0]
	return all
}

func shouldTryCodexCLIRepair(parsed ParsedFrame) bool {
	if !strings.EqualFold(strings.TrimSpace(parsed.Provider), "codex") {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(parsed.Source), "openai-web") {
		return false
	}
	return parsed.Frame.Session == 0 && parsed.Frame.Weekly == 0 && parsed.Frame.ResetSec == 0
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
