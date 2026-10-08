package companionapi

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

func TestReportedProviderMessageKeepsUsefulGuidance(t *testing.T) {
	for _, tc := range []struct{ name, in, want string }{
		{
			name: "a URL the engine printed itself survives",
			in:   "No Ollama session cookie found. Please sign in at https://ollama.com/signin in your browser.",
			want: "No Ollama session cookie found. Please sign in at https://ollama.com/signin in your browser.",
		},
		{
			name: "a terminal command survives",
			in:   "Not logged in to Gemini. Run 'gemini' in Terminal to authenticate.",
			want: "Not logged in to Gemini. Run 'gemini' in Terminal to authenticate.",
		},
		{
			name: "a bare domain survives",
			in:   "No Amp session cookie found. Please log in to ampcode.com in your browser.",
			want: "No Amp session cookie found. Please log in to ampcode.com in your browser.",
		},
		{
			name: "a signed-in URL whose own host carries an auth word is not read as a credential",
			in:   "Sign in at https://auth.example.com:8443/login then retry.",
			want: "Sign in at https://auth.example.com:8443/login then retry.",
		},
		{
			name: "environment variable names the customer has to set survive",
			in:   "AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY or configure Bedrock in Settings.",
			want: "AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY or configure Bedrock in Settings.",
		},
		{
			name: "a named OAuth scope survives",
			in:   "Claude OAuth token missing 'user:profile' scope.",
			want: "Claude OAuth token missing 'user:profile' scope.",
		},
		{
			// The Full Disk Access family the provider row exists to explain.
			// A word is prose, not a credential value.
			name: "the word after a cookie prefix is what went wrong, not a secret",
			in:   "Chrome cookies: missing auth cookie",
			want: "Chrome cookies: missing auth cookie",
		},
		{
			name: "a denied permission keeps its reason and loses the account name",
			in:   "Safari cookies: permission denied for /Users/paulanduschus/Library/Cookies/Cookies.binarycookies",
			want: "Safari cookies: permission denied for ~/Library/Cookies/Cookies.binarycookies",
		},
		{
			name: "a named cookie the customer has to look for survives",
			in:   "Firefox cookies: missing ory_session_* cookie",
			want: "Firefox cookies: missing ory_session_* cookie",
		},
	} {
		if got := reportedProviderMessage(tc.in); got != tc.want {
			t.Fatalf("%s:\n got %q\nwant %q", tc.name, got, tc.want)
		}
	}
}

func TestReportedProviderMessageRedactsTheHomePath(t *testing.T) {
	input := "Windsurf database not found at /Users/paulanduschus/Library/Application Support/Windsurf/User/globalStorage/state.vscdb."
	want := "Windsurf database not found at ~/Library/Application Support/Windsurf/User/globalStorage/state.vscdb."
	if got := reportedProviderMessage(input); got != want {
		t.Fatalf("home path redaction:\n got %q\nwant %q", got, want)
	}
}

// The account name is the folder name under the home root on every system:
// C:\Users\<name> (any drive, either slash, doubled in JSON), /Users/<name>
// and /home/<name>. A name may hold spaces, apostrophes and brackets, so the
// whole component goes, up to the next separator.
func TestReportedProviderMessageRedactsEveryHomePath(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{
			in:   `Cookies database not found at C:\Users\Paul Anduschus\AppData\Local\Google\Chrome\User Data\Default\Network\Cookies`,
			want: `Cookies database not found at ~\AppData\Local\Google\Chrome\User Data\Default\Network\Cookies`,
		},
		{
			in:   `Claude credentials not found at C:\Users\Patrick\.claude\.credentials.json.`,
			want: `Claude credentials not found at ~\.claude\.credentials.json.`,
		},
		{
			in:   `Claude credentials not found at d:/Users/Paul Anduschus/.claude/.credentials.json.`,
			want: `Claude credentials not found at ~/.claude/.credentials.json.`,
		},
		{
			in:   `{"path":"c:\\Users\\Patrick\\AppData\\Roaming\\CodexBar\\settings.json"}`,
			want: `{"path":"~\\AppData\\Roaming\\CodexBar\\settings.json"}`,
		},
		{in: `Missing file (C:\Users\Patrick)`, want: `Missing file (~)`},
		{
			in:   `Claude credentials not found at C:\Users\Jane O'Doe\.claude\.credentials.json.`,
			want: `Claude credentials not found at ~\.claude\.credentials.json.`,
		},
		{
			in:   `Claude credentials not found at C:\Users\Jane (Work)\.claude\.credentials.json.`,
			want: `Claude credentials not found at ~\.claude\.credentials.json.`,
		},
		// An unterminated name may take prose with it, never the reverse.
		{in: `Profile C:\Users\Jane is missing; see D:\logs\run.txt`, want: `Profile ~; see D:\logs\run.txt`},
		{in: `Missing profile (C:\Users\Jane O'Doe), try again.`, want: `Missing profile (~), try again.`},
		{
			in:   "Safari cookies: permission denied for /Users/Paul Anduschus/Library/Cookies/Cookies.binarycookies",
			want: "Safari cookies: permission denied for ~/Library/Cookies/Cookies.binarycookies",
		},
		{in: "Missing profile (/Users/Paul Anduschus), try again.", want: "Missing profile (~), try again."},
		{
			in:   "Codex auth file not found at /home/paul/.codex/auth.json",
			want: "Codex auth file not found at ~/.codex/auth.json",
		},
		// Two homes in one sentence: the first must not swallow the second.
		{in: "Tried /Users/paul and /Users/anna/Library/x", want: "Tried ~~/Library/x"},
		// A credential right behind a path is still one: the path rule ends
		// at ";" and ",", and the pair rule takes over from there.
		{in: "path=/Users/jane;token=abcdef", want: "path=~;token=[redacted]"},
		{in: "path=/Users/jane,token=abcdef", want: "path=~,token=[redacted]"},
		// "&" can be part of a folder name, so the path rule takes it along.
		{in: "path=/Users/jane&token=abcdef", want: "path=~"},
		{in: "path=/Users/jane/x&token=abcdef", want: "path=~/x&token=[redacted]"},
		{in: `path=C:\Users\Jane Doe;password=letmein;session=abc`, want: "path=~;password=[redacted];session=[redacted]"},
		{in: `dir=/home/jane;auth={"k":"v"}`, want: `dir=~;auth=[redacted]`},
		// A web address is not a home folder.
		{
			in:   "Open https://example.com/home/dashboard to sign in.",
			want: "Open https://example.com/home/dashboard to sign in.",
		},
	} {
		if got := reportedProviderMessage(tc.in); got != tc.want {
			t.Fatalf("home path redaction:\n  in %q\n got %q\nwant %q", tc.in, got, tc.want)
		}
	}
}

// The Windows engine joins what each source answered as "<source>: <error>",
// with the sources Web, OAuth and CLI (claude_auto_fetch_error in the pinned
// Win-CodexBar). "OAuth:" there is a label and not a credential key: read as
// one, the sentence support copies came out as "OAuth: [redacted] error: ...".
func TestReportedProviderMessageKeepsTheSourceLabelOAuth(t *testing.T) {
	const summary = "Claude usage failed from all configured sources. Web: No cookies available for web API; OAuth: OAuth error: Claude OAuth usage endpoint is rate limited. Retrying in about 1s; credentials were preserved.; CLI: Claude CLI /usage opened, but this Claude version returned local activity stats instead of plan limit percentages. Use Auto, OAuth, or Web mode for Claude limits. [claude:browser-sign-in-required https://claude.ai/login]"
	if got := reportedProviderMessage(summary); got != summary {
		t.Fatalf("browser sign-in summary:\n got %q\nwant %q", got, summary)
	}
	for _, tc := range []struct{ in, want string }{
		{
			in:   "Claude usage failed from all configured sources. OAuth: OAuth error: token expired; Web: No cookies available for web API; CLI: Parse error: Empty output from Claude CLI",
			want: "Claude usage failed from all configured sources. OAuth: OAuth error: token expired; Web: No cookies available for web API; CLI: Parse error: Empty output from Claude CLI",
		},
		// Only a word is a sentence's start. Anything else after the label,
		// and every other key with "auth" in it, is still a credential.
		{in: "OAuth: abc123def", want: "OAuth: [redacted]"},
		// A sentence has a second word. One token is a value, also when it
		// is all letters.
		{in: "OAuth: hunterpassword", want: "OAuth: [redacted]"},
		{in: "OAuth: AbCdEfGhIjKlMnOpQrStUvWxYz", want: "OAuth: [redacted]"},
		{in: "Web: No cookies; OAuth: hunterpassword; CLI: Parse error", want: "Web: No cookies; OAuth: [redacted]; CLI: Parse error"},
		{in: "OAuth: hunterpassword.", want: "OAuth: [redacted]."},
		{in: "OAuth: hunter 12345678", want: "OAuth: [redacted] 12345678"},
		{in: "OAuth: Bearer abcdefgh12", want: "OAuth: [redacted]"},
		{in: "oauth_token: letmein", want: "oauth_token: [redacted]"},
		{in: "OAuth=letmein", want: "OAuth=[redacted]"},
	} {
		if got := reportedProviderMessage(tc.in); got != tc.want {
			t.Fatalf("source label:\n  in %q\n got %q\nwant %q", tc.in, got, tc.want)
		}
	}
}

// What the engines print about an account is an address: "OpenAI dashboard
// signed in as ", "Antigravity local session is signed in as " and "OpenAI
// web session does not match Codex account. Found: <browser>=<address>"
// (CodexBar 0.63.0). Neither engine prints a person's name or a browser
// profile's display name; the Windows engine names a profile by its folder
// ("Default", "Profile 1").
func TestReportedProviderMessageRedactsTheAccountInTheEnginesOwnSentences(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{
			in:   "OpenAI dashboard signed in as paul@example.com, but Codex uses hallo@dreamytales.de. Switch accounts in your browser and update OpenAI cookies in Providers → Codex.",
			want: "OpenAI dashboard signed in as [redacted], but Codex uses [redacted]. Switch accounts in your browser and update OpenAI cookies in Providers → Codex.",
		},
		{
			in:   "Antigravity local session is signed in as paul@example.com; local usage cannot be used for the selected account.",
			want: "Antigravity local session is signed in as [redacted]; local usage cannot be used for the selected account.",
		},
		{
			in:   "OpenAI web session does not match Codex account. Found: Chrome=paul@example.com, Safari=hallo@dreamytales.de.",
			want: "OpenAI web session does not match Codex account. Found: Chrome=[redacted], Safari=[redacted].",
		},
		{
			in:   "Cookies database not found for Chrome profile Profile 1",
			want: "Cookies database not found for Chrome profile Profile 1",
		},
	} {
		if got := reportedProviderMessage(tc.in); got != tc.want {
			t.Fatalf("account in an engine sentence:\n  in %q\n got %q\nwant %q", tc.in, got, tc.want)
		}
	}
}

// CodexBar 0.46.0 interpolates the account address and whole HTTP bodies into
// the sentences this field carries -- "OpenAI dashboard signed in as ",
// "Antigravity local session is signed in as ", "Unexpected response body (".
// The provider row publishes that text and offers it as a Copy button, so a
// session token or an e-mail address reaching a screen is the leak this guards.
func TestReportedProviderMessageRedactsAccountsAndSecrets(t *testing.T) {
	for _, tc := range []struct{ name, in, want string }{
		{
			name: "an account address",
			in:   "Signed in as hallo@dreamytales.de but the session expired.",
			want: "Signed in as [redacted] but the session expired.",
		},
		{
			name: "a named session token keeps its name and loses its value",
			in:   "Rejected cookie WorkosCursorSessionToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef.",
			want: "Rejected cookie WorkosCursorSessionToken=[redacted].",
		},
		{
			name: "an API key inside an echoed response body",
			in:   `Unexpected response body ({"access_token":"sk-proj-A1b2C3d4E5f6G7h8J9k0L1m2N3o4P5q6"})`,
			want: `Unexpected response body ({"access_token":[redacted]})`,
		},
		{
			name: "a cookie header",
			in:   "Set-Cookie: sessionid=abc123def456ghi789jkl012mno345; Path=/",
			want: "Set-Cookie: [redacted]; Path=/",
		},
		{
			name: "every value in a multi-cookie request header",
			in:   "Cookie: foo=hunter; bar=letmein",
			want: "Cookie: [redacted]",
		},
		{
			name: "an arbitrary short cookie value",
			in:   "Chrome cookies: hunter",
			want: "Chrome cookies: [redacted]",
		},
		{
			name: "an authorization header collapses to one marker",
			in:   "Request failed. Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
			want: "Request failed. Authorization: [redacted]",
		},
		{
			name: "a bare token with no key beside it",
			in:   "GitHub token ghp_16C7e42F292c6912E7710c838347Ae178B4a is invalid.",
			want: "GitHub token [redacted] is invalid.",
		},
		{
			// The prose exception is for "Chrome cookies: missing auth cookie";
			// an equals sign never introduces prose, however short the value.
			name: "a short alphabetic password value",
			in:   "Login rejected: password=letmein",
			want: "Login rejected: password=[redacted]",
		},
		{
			name: "a short alphabetic token value",
			in:   "Rejected token=abcdef for this account.",
			want: "Rejected token=[redacted] for this account.",
		},
		{
			name: "a password key never gets the prose exception",
			in:   "Keychain password: hunter",
			want: "Keychain password: [redacted]",
		},
		{
			name: "a short alphabetic token after a colon",
			in:   "Rejected token: letmein",
			want: "Rejected token: [redacted]",
		},
		{
			name: "a short alphabetic session value after a colon",
			in:   "Stored session: hunter expired.",
			want: "Stored session: [redacted] expired.",
		},
		{
			name: "a short scalar credential value",
			in:   `Unexpected response body ({"credential":"hunter"})`,
			want: `Unexpected response body ({"credential":[redacted]})`,
		},
		{
			name: "a structured credentials value",
			in:   `Unexpected response body ({"credentials":{"value":"hunter"}})`,
			want: `Unexpected response body ({"credentials":[redacted]`,
		},
		{
			name: "a short passphrase value",
			in:   `Unexpected response body ({"passphrase":"hunter"})`,
			want: `Unexpected response body ({"passphrase":[redacted]})`,
		},
		{
			name: "a structured passcode value",
			in:   `Unexpected response body ({"passcode":{"value":"hunter"}})`,
			want: `Unexpected response body ({"passcode":[redacted]`,
		},
		{
			name: "credential pairs inside a query string",
			in:   "Callback rejected: https://host/callback?token=abcdefgh&session=hunter&next=home",
			want: "Callback rejected: https://host/callback?token=[redacted]&session=[redacted]&next=home",
		},
		{
			name: "a credential pair in a URL fragment",
			in:   "Callback rejected: https://host/callback?next=home#token=hunter",
			want: "Callback rejected: https://host/callback?next=home#token=[redacted]",
		},
		{
			name: "credentials embedded in URL userinfo",
			in:   "Proxy rejected https://auth:hunter@127.0.0.1/login.",
			want: "Proxy rejected https://[redacted]@127.0.0.1/login.",
		},
		{
			name: "token-only URL userinfo",
			in:   "Callback rejected https://api-token@127.0.0.1/callback.",
			want: "Callback rejected https://[redacted]@127.0.0.1/callback.",
		},
		{
			name: "nested credential object",
			in:   `Unexpected response body ({"token":{"access_token":"hunter"}})`,
			want: `Unexpected response body ({"token":[redacted]`,
		},
		{
			name: "multiline credential object",
			in:   "Unexpected response body ({\"token\": {\n  \"value\": \"hunter\"\n}})",
			want: `Unexpected response body ({"token": [redacted]`,
		},
	} {
		if got := reportedProviderMessage(tc.in); got != tc.want {
			t.Fatalf("%s:\n got %q\nwant %q", tc.name, got, tc.want)
		}
	}
}

// The redaction only has to exist in one place because the raw field never
// reaches the wire on its own: /v1/status, the provider retry response and the
// diagnostics all marshal the same struct.
func TestProviderReadinessNeverMarshalsItsReportedText(t *testing.T) {
	raw, err := json.Marshal(codexbar.ProviderReadiness{
		ID:       "cursor",
		Reported: "token=sk-ant-secret123456789",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"reported", "sk-ant-secret123456789"} {
		if bytes.Contains(raw, []byte(forbidden)) {
			t.Fatalf("provider readiness published %q: %s", forbidden, raw)
		}
	}
}

// Google ended Gemini CLI OAuth for consumer accounts. CodexBar 0.63.0 words
// the remedy for its own app; inside VibeTV it names Antigravity alone.
func TestReportedProviderMessageNamesAntigravityWithoutCodexBar(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{
			in:   "Google no longer supports Gemini CLI OAuth for individual, AI Pro, or Ultra accounts. Enable CodexBar's Antigravity provider, sign in to Antigravity or run `agy`, then refresh.",
			want: "Google no longer supports Gemini CLI OAuth for individual, AI Pro, or Ultra accounts. Enable Antigravity, sign in to Antigravity or run `agy`, then refresh.",
		},
		{
			in:   "Could not refresh Gemini OAuth credentials from Gemini CLI. Enable Win-CodexBar's Antigravity provider, sign in to Antigravity or run `agy`, then refresh.",
			want: "Could not refresh Gemini OAuth credentials from Gemini CLI. Enable Antigravity, sign in to Antigravity or run `agy`, then refresh.",
		},
		{
			in:   "Individual accounts should use CodexBar's Antigravity provider instead. Workspace and education accounts should keep using Gemini.",
			want: "Individual accounts should use Antigravity instead. Workspace and education accounts should keep using Gemini.",
		},
	} {
		if got := reportedProviderMessage(tc.in); got != tc.want {
			t.Fatalf("got  %q\nwant %q", got, tc.want)
		}
	}
}
