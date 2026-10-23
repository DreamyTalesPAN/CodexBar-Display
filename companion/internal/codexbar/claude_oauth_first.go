package codexbar

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/childproc"
)

// Claude on the Mac reads the Claude Code sign-in first (#834). CodexBar's
// Auto for Claude asks the browser first and the Claude Code CLI second, so a
// browser signed in to another account than Claude Code showed that other
// account, and a Mac with Claude Code only waited for the slow CLI (#786).
// CodexBar keeps that order and recommends pinning "--source oauth"
// (steipete/CodexBar#4704). Serve has one source per provider for the whole
// config, which the customer's own CodexBar app shares, so the Companion asks
// for the Claude Code reading on its own, once per read, and keeps serve's
// Auto answer whenever that reading fails.
//
// CodexBar itself never reads Claude Code's keychain item in the background:
// it may not without a dialog, and answers "not found" or "credentials
// changed ... re-grant" instead (#786, #912). The Companion therefore reads
// the item's short-lived access token through /usr/bin/security and hands it
// to that one CodexBar call as CODEXBAR_CLAUDE_OAUTH_TOKEN, CodexBar's own
// way to take an OAuth token from outside (decision 172a, 23.10.2026). The
// token is never stored, logged or put in an error, and the refresh token is
// never used: renewing it is Claude Code's job, and a renewal from here would
// end Claude Code's own sign-in. An expired token is no reading; Auto stands
// until Claude Code has renewed it.
//
// Windows is unchanged: the pinned Win-CodexBar already asks the Claude Code
// login first (#650).
//
// Off in test binaries: a developer Mac may have a real CodexBar, and no
// package's tests may read the real Claude Code sign-in. The tests of this
// read switch it on themselves.
var claudeOAuthFirst = runtime.GOOS == "darwin" && !testing.Testing()

// claudeOAuthTimeout bounds the one oauth call. CodexBar reads the keychain
// without a dialog in the background and asks one HTTP endpoint, so a call
// that takes longer than this is no answer, and Auto stands.
const claudeOAuthTimeout = 15 * time.Second

// claudeOAuthReuse is how long one oauth answer stands for further reads: the
// shortest refresh serve itself uses. A wake or a refresh press within it
// does not ask Anthropic's usage endpoint again.
const claudeOAuthReuse = DashboardServeMinimumRefreshInterval

// claudeOAuthTokenEnv is CodexBar's variable for an OAuth access token handed
// in from outside. With it, CodexBar uses the token as given and does not
// touch the keychain or renew anything.
const claudeOAuthTokenEnv = "CODEXBAR_CLAUDE_OAUTH_TOKEN"

// claudeCodeKeychainService is the keychain item Claude Code keeps its sign-in
// in on the Mac.
const claudeCodeKeychainService = "Claude Code-credentials"

// claudeCodeKeychainTimeout bounds the keychain read. It answers at once when
// it may read; a read that waits is no reading.
const claudeCodeKeychainTimeout = 3 * time.Second

var claudeCodeAccessTokenFn = claudeCodeAccessToken

type claudeOAuthTokenKey struct{}

// claudeOAuthTokenFromContext is the token for the one CodexBar call that
// carries it (runUsageCommand).
func claudeOAuthTokenFromContext(ctx context.Context) string {
	token, _ := ctx.Value(claudeOAuthTokenKey{}).(string)
	return token
}

var claudeOAuthLast struct {
	mu   sync.Mutex
	at   time.Time
	item json.RawMessage
	ok   bool
}

// claudeOAuthUsage is Claude's item of CodexBar's "usage --provider claude
// --source oauth" answer, when it was read, and whether it stands instead of
// Auto. It stands when it has usage,
// and when CodexBar says the usage endpoint is rate limited: the Claude Code
// sign-in still works there, and Auto could show another account's values in
// the meantime. Every other answer (no Claude Code sign-in, a sign-in that
// CodexBar may not read without a dialog, "credentials changed ... re-grant",
// no answer at all) leaves Auto for this read. There is no retry: the next
// read asks again. fresh skips an answer kept from an earlier read: a check
// the customer started asks now.
func claudeOAuthUsage(ctx context.Context, bin string, fresh bool) (json.RawMessage, time.Time, bool) {
	claudeOAuthLast.mu.Lock()
	defer claudeOAuthLast.mu.Unlock()
	if age := time.Since(claudeOAuthLast.at); !fresh && !claudeOAuthLast.at.IsZero() && age >= 0 && age < claudeOAuthReuse {
		return claudeOAuthLast.item, claudeOAuthLast.at, claudeOAuthLast.ok
	}
	var item json.RawMessage
	ok := false
	// No Claude Code sign-in (or an expired one): Auto, without a CodexBar
	// call that could only fail.
	if token, signedIn := claudeCodeAccessTokenFn(ctx); signedIn {
		raw, _ := runUsageCommandFn(context.WithValue(ctx, claudeOAuthTokenKey{}, token), claudeOAuthTimeout, bin,
			"usage", "--json",
			"--provider", "claude",
			"--source", "oauth",
		)
		item, ok = claudeOAuthItem(raw)
	}
	// Round(0) drops the monotonic reading: the age must count sleep.
	at := time.Now().Round(0)
	if ctx.Err() != nil {
		// The caller went away; this says nothing about the sign-in.
		return nil, at, false
	}
	claudeOAuthLast.at, claudeOAuthLast.item, claudeOAuthLast.ok = at, item, ok
	return item, at, ok
}

// claudeCodeAccessToken reads the access token of Claude Code's sign-in from
// its keychain item. Only the access token is taken, and only while it is
// valid. Nothing of the item reaches a log or an error.
func claudeCodeAccessToken(ctx context.Context) (string, bool) {
	ctx, cancel := context.WithTimeout(ctx, claudeCodeKeychainTimeout)
	defer cancel()
	cmd := childproc.Hide(exec.CommandContext(ctx, "/usr/bin/security",
		"find-generic-password", "-s", claudeCodeKeychainService, "-w"))
	raw, err := cmd.Output()
	defer clear(raw)
	if err != nil {
		return "", false
	}
	return claudeCodeAccessTokenFrom(raw, time.Now())
}

// claudeCodeAccessTokenFrom takes the access token out of Claude Code's
// stored sign-in. The refresh token is not even decoded.
func claudeCodeAccessTokenFrom(raw []byte, now time.Time) (string, bool) {
	var stored struct {
		ClaudeAiOauth *struct {
			AccessToken string `json:"accessToken"`
			ExpiresAt   int64  `json:"expiresAt"`
		} `json:"claudeAiOauth"`
	}
	if json.Unmarshal(bytes.TrimSpace(raw), &stored) != nil || stored.ClaudeAiOauth == nil {
		return "", false
	}
	token := strings.TrimSpace(stored.ClaudeAiOauth.AccessToken)
	if token == "" {
		return "", false
	}
	if expiresAt := stored.ClaudeAiOauth.ExpiresAt; expiresAt > 0 && !time.UnixMilli(expiresAt).After(now) {
		return "", false
	}
	return token, true
}

// claudeOAuthItem picks Claude's item out of the oauth answer and decides
// whether it stands.
func claudeOAuthItem(raw []byte) (json.RawMessage, bool) {
	items, err := extractProvidersFromRawJSON(raw)
	if err != nil {
		return nil, false
	}
	for _, candidate := range items {
		payload, isMap := candidate.(map[string]any)
		if !isMap || strings.ToLower(strings.TrimSpace(firstString(payload, "provider", "id"))) != "claude" {
			continue
		}
		item, err := json.Marshal(payload)
		if err != nil {
			return nil, false
		}
		if providerPayloadHasError(payload) {
			return item, classifyProviderHealth(providerHealthErrorText(payload["error"])) == ProviderHealthRateLimited
		}
		return item, providerPayloadHasUsage(payload)
	}
	return nil, false
}

// withClaudeOAuth puts the Claude Code reading in place of the Auto reading
// of Claude, when it stands. readings, when given, is serve's answer per
// provider (serveUsage) and takes the same item.
func withClaudeOAuth(ctx context.Context, frames []ParsedFrame, readings map[string]json.RawMessage) []ParsedFrame {
	if !claudeOAuthFirst {
		return frames
	}
	index := -1
	for i := range frames {
		if providerKey(frames[i]) == "claude" {
			index = i
			break
		}
	}
	if index < 0 {
		return frames
	}
	bin, err := FindBinary()
	if err != nil {
		return frames
	}
	item, at, ok := claudeOAuthUsage(ctx, bin, false)
	if !ok {
		return frames
	}
	parsed, err := parseAllProviders(claudeOAuthAnswer(item))
	if err != nil || len(parsed) != 1 {
		return frames
	}
	reading := parsed[0]
	reading.Frame = reading.Frame.Normalize()
	if reading.CollectedAt.IsZero() {
		reading.CollectedAt = at.UTC()
	}
	frames[index] = reading
	if readings != nil {
		readings["claude"] = item
	}
	return frames
}

// claudeOAuthAnswer is the item in the form "usage --json" prints.
func claudeOAuthAnswer(item json.RawMessage) []byte {
	return append(append([]byte("["), item...), ']')
}
