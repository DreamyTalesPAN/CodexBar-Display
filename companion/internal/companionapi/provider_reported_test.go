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
