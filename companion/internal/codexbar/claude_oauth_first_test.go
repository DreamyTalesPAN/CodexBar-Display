package codexbar

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

var claudeOAuthArgs = []string{"usage", "--json", "--provider", "claude", "--source", "oauth"}

// testClaudeCodeToken stands for the access token in Claude Code's keychain
// item. Failures name whether it arrived, never its value.
const testClaudeCodeToken = "test-access-token"

// useClaudeOAuthFirst switches the Mac's oauth read on for one test, with a
// fresh memory, an executable CODEXBAR_BIN and a signed-in Claude Code, and
// answers the oauth call with answer. It returns how often that call ran.
func useClaudeOAuthFirst(t *testing.T, answer string) *int {
	t.Helper()
	originalFirst, originalUsage, originalToken := claudeOAuthFirst, runUsageCommandFn, claudeCodeAccessTokenFn
	t.Cleanup(func() {
		claudeOAuthFirst, runUsageCommandFn, claudeCodeAccessTokenFn = originalFirst, originalUsage, originalToken
		claudeOAuthLast.at, claudeOAuthLast.item, claudeOAuthLast.ok = time.Time{}, nil, false
	})
	claudeOAuthFirst = true
	claudeOAuthLast.at, claudeOAuthLast.item, claudeOAuthLast.ok = time.Time{}, nil, false
	claudeCodeAccessTokenFn = func(context.Context) (string, bool) { return testClaudeCodeToken, true }
	bin, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_BIN", bin)
	calls := new(int)
	runUsageCommandFn = func(ctx context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if !reflect.DeepEqual(args, claudeOAuthArgs) {
			t.Fatalf("unexpected CodexBar call %v", args)
		}
		if claudeOAuthTokenFromContext(ctx) != testClaudeCodeToken {
			t.Fatal("the oauth call must carry Claude Code's access token")
		}
		*calls++
		return []byte(answer), nil
	}
	return calls
}

const (
	claudeOAuthAccountA = `[{"provider":"claude","source":"oauth","usage":{"primary":{"usedPercent":7,"windowMinutes":300},"secondary":{"usedPercent":13,"windowMinutes":10080}}}]`
	claudeOAuthRegrant  = `[{"provider":"claude","source":"oauth","error":{"message":"Claude Code credentials changed (Updated 21h ago). Click Refresh to re-grant CodexBar access."}}]`
)

func TestClaudeOAuthAnswerStandsOnlyWithUsageOrRateLimit(t *testing.T) {
	for _, tc := range []struct {
		name   string
		answer string
		stands bool
	}{
		{"usage", claudeOAuthAccountA, true},
		{"re-grant after a token rotation", claudeOAuthRegrant, false},
		{"no Claude Code sign-in", `[{"provider":"claude","source":"oauth","error":{"message":"Claude OAuth credentials not found. Run claude to authenticate."}}]`, false},
		{"keychain denied", `[{"provider":"claude","source":"oauth","error":{"message":"Claude Keychain access was denied. Switch Claude Usage source to Web/CLI, or allow access in Keychain Access."}}]`, false},
		{"unauthorized", `[{"provider":"claude","source":"oauth","error":{"message":"Claude OAuth request unauthorized. Run claude to re-authenticate."}}]`, false},
		{"rate limited", `[{"provider":"claude","source":"oauth","error":{"message":"Claude OAuth usage endpoint is rate limited by Anthropic right now. Wait a few minutes, then click Refresh."}}]`, true},
		{"no answer", "", false},
		{"another provider only", `[{"provider":"codex","source":"oauth","usage":{"primary":{"usedPercent":7}}}]`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, stands := claudeOAuthItem([]byte(tc.answer)); stands != tc.stands {
				t.Fatalf("stands=%t, want %t", stands, tc.stands)
			}
		})
	}
}

func TestClaudeCodeAccessTokenTakesOnlyAValidAccessToken(t *testing.T) {
	now := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	later := now.Add(time.Hour).UnixMilli()
	earlier := now.Add(-time.Minute).UnixMilli()
	for _, tc := range []struct {
		name   string
		stored string
		valid  bool
	}{
		{"signed in", fmt.Sprintf(`{"claudeAiOauth":{"accessToken":"%s","refreshToken":"r","expiresAt":%d}}`, testClaudeCodeToken, later), true},
		{"no expiry stored", fmt.Sprintf(`{"claudeAiOauth":{"accessToken":"%s"}}`, testClaudeCodeToken), true},
		{"expired, Claude Code has not renewed yet", fmt.Sprintf(`{"claudeAiOauth":{"accessToken":"%s","refreshToken":"r","expiresAt":%d}}`, testClaudeCodeToken, earlier), false},
		{"MCP sign-ins only", `{"mcpOAuth":{"server":{"accessToken":"m"}}}`, false},
		{"empty access token", `{"claudeAiOauth":{"accessToken":" ","refreshToken":"r"}}`, false},
		{"not JSON", "6a756e6b", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token, valid := claudeCodeAccessTokenFrom([]byte(tc.stored), now)
			if valid != tc.valid || valid && token != testClaudeCodeToken {
				t.Fatalf("valid=%t (token taken: %t), want valid=%t", valid, token == testClaudeCodeToken, tc.valid)
			}
		})
	}
}

// The token reaches the one CodexBar process through its environment and
// nothing else.
func TestClaudeOAuthTokenReachesOnlyItsOwnCodexBarCall(t *testing.T) {
	bin, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_TEST_PROCESS", "claude-oauth-token")
	t.Setenv("CODEXBAR_TEST_EXPECTED_TOKEN", testClaudeCodeToken)
	withToken := context.WithValue(context.Background(), claudeOAuthTokenKey{}, testClaudeCodeToken)
	if out, err := runUsageCommand(withToken, 5*time.Second, bin); err != nil || string(out) != "match" {
		t.Fatalf("the oauth call must see the token: answer=%q err=%v", out, err)
	}
	if out, err := runUsageCommand(context.Background(), 5*time.Second, bin); err != nil || string(out) != "unset" {
		t.Fatalf("any other call must not see a token: answer=%q err=%v", out, err)
	}
}

// Without a Claude Code sign-in there is nothing to read: Auto stands, and
// no CodexBar call is spent on it.
func TestDashboardWithoutClaudeCodeKeepsAutoWithoutACall(t *testing.T) {
	calls := useClaudeOAuthFirst(t, claudeOAuthAccountA)
	claudeCodeAccessTokenFn = func(context.Context) (string, bool) { return "", false }
	server := newClaudeServeTestServer(t)
	defer server.Close()

	frames, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if claude := claudeFrame(t, frames); claude.Frame.Session != 80 || claude.Frame.Weekly != 90 {
		t.Fatalf("expected serve's Auto reading, got %+v", claude.Frame)
	}
	if *calls != 0 {
		t.Fatalf("oauth call ran %d times without a Claude Code sign-in", *calls)
	}
}

// Claude Code signed in to account A, the browser to account B: serve's Auto
// reads B from the browser, VibeTV shows A (#834).
func TestDashboardShowsClaudeCodeAccountOverBrowserAccount(t *testing.T) {
	calls := useClaudeOAuthFirst(t, claudeOAuthAccountA)
	server := newClaudeServeTestServer(t)
	defer server.Close()

	frames, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	claude := claudeFrame(t, frames)
	if claude.Frame.Session != 7 || claude.Frame.Weekly != 13 || claude.Source != "oauth" {
		t.Fatalf("expected the Claude Code reading, got session=%d weekly=%d source=%q", claude.Frame.Session, claude.Frame.Weekly, claude.Source)
	}
	if _, ok := serveUsageAnswer(WithServeReading(context.Background()), []ProviderSetting{{ID: "claude", Enabled: true}}); !ok {
		t.Fatal("serve's reading must carry the Claude Code item for the window's checks")
	}
	if item := string(serveUsage.items["claude"]); !strings.Contains(item, `"oauth"`) {
		t.Fatalf("serve's reading must be the Claude Code item, got %s", item)
	}

	// A wake or refresh press within a minute asks Anthropic no second time.
	if _, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if *calls != 1 {
		t.Fatalf("oauth read ran %d times within a minute, want 1", *calls)
	}
}

// The #912 trap: CodexBar may not read Claude Code's sign-in in the
// background. That read falls back to serve's Auto value once, with no retry.
func TestDashboardKeepsAutoWhenClaudeCodeNeedsRegrant(t *testing.T) {
	calls := useClaudeOAuthFirst(t, claudeOAuthRegrant)
	server := newClaudeServeTestServer(t)
	defer server.Close()

	frames, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	claude := claudeFrame(t, frames)
	if claude.Frame.UsageUnavailable || claude.Frame.Session != 80 || claude.Frame.Weekly != 90 {
		t.Fatalf("expected serve's Auto reading, got %+v", claude.Frame)
	}
	if *calls != 1 {
		t.Fatalf("oauth read ran %d times, want exactly 1", *calls)
	}
}

func TestExactClaudeCheckUsesClaudeCodeWithoutWaitingForAuto(t *testing.T) {
	useClaudeOAuthFirst(t, claudeOAuthAccountA)
	setExistingConfig(t)
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.75.0"), nil
	}
	var calls [][]string
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string(nil), args...))
		switch {
		case len(args) >= 2 && args[0] == "config" && args[1] == "providers":
			return []byte(`[{"provider":"claude","displayName":"Claude","enabled":true}]`), nil
		case reflect.DeepEqual(args, claudeOAuthArgs):
			return []byte(claudeOAuthAccountA), nil
		}
		t.Fatalf("Auto must not run when Claude Code answered: %v", args)
		return nil, nil
	}

	got := ProbeProviderSetupForProvider(context.Background(), t.TempDir(), "claude")
	if got.Status != ProviderReady || len(got.Providers) != 1 || got.Providers[0].Source != "oauth" {
		t.Fatalf("unexpected Claude readiness: %+v", got)
	}
}

func TestExactClaudeCheckFallsBackToAutoOnce(t *testing.T) {
	useClaudeOAuthFirst(t, claudeOAuthRegrant)
	setExistingConfig(t)
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.75.0"), nil
	}
	oauth, auto := 0, 0
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		switch {
		case len(args) >= 2 && args[0] == "config" && args[1] == "providers":
			return []byte(`[{"provider":"claude","displayName":"Claude","enabled":true}]`), nil
		case reflect.DeepEqual(args, claudeOAuthArgs):
			oauth++
			return []byte(claudeOAuthRegrant), nil
		case reflect.DeepEqual(args, []string{"usage", "--json", "--provider", "claude", "--source", "auto", "--web-timeout", "8"}):
			auto++
			return []byte(`[{"provider":"claude","source":"web","usage":{"primary":{"usedPercent":80},"secondary":{"usedPercent":90}}}]`), nil
		}
		t.Fatalf("unexpected CodexBar call %v", args)
		return nil, nil
	}

	got := ProbeProviderSetupForProvider(context.Background(), t.TempDir(), "claude")
	if got.Status != ProviderReady || got.Providers[0].Source != "web" {
		t.Fatalf("expected the Auto reading, got %+v", got)
	}
	if oauth != 1 || auto != 1 {
		t.Fatalf("oauth=%d auto=%d, want one of each", oauth, auto)
	}
}

// newClaudeServeTestServer is a serve whose Auto read Claude from the
// browser: account B at 80 % session and 90 % weekly.
func newClaudeServeTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	forgetServeUsage()
	t.Cleanup(forgetServeUsage)
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case dashboardSnapshotPath:
			_, _ = w.Write([]byte(`{"schemaVersion":1,"providers":[{"id":"claude","name":"Claude","windows":[
				{"kind":"session","label":"Session","usedPercent":80},
				{"kind":"weekly","label":"Weekly","usedPercent":90}
			]}]}`))
		case dashboardUsagePath:
			_, _ = w.Write([]byte(`[{"provider":"claude","source":"web","usage":{
				"primary":{"usedPercent":80,"windowMinutes":300},
				"secondary":{"usedPercent":90,"windowMinutes":10080}
			}}]`))
		default:
			http.NotFound(w, r)
		}
	}))
}

func claudeFrame(t *testing.T, frames []ParsedFrame) ParsedFrame {
	t.Helper()
	for _, frame := range frames {
		if providerKey(frame) == "claude" {
			return frame
		}
	}
	t.Fatalf("no Claude frame in %+v", frames)
	return ParsedFrame{}
}
