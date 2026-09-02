package companionapi

import "testing"

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
	} {
		if got := reportedProviderMessage(tc.in); got != tc.want {
			t.Fatalf("%s:\n got %q\nwant %q", tc.name, got, tc.want)
		}
	}
}

// Five of the pinned engine's 65 messages embed the account's home directory,
// and its own success payloads carry the account e-mail. None of it may reach a
// customer-facing screen.
func TestReportedProviderMessageRedactsWhatIsPrivate(t *testing.T) {
	for _, tc := range []struct{ name, in, mustNot string }{
		{
			name:    "home path",
			in:      "Windsurf database not found at /Users/paulanduschus/Library/Application Support/Windsurf/User/globalStorage/state.vscdb. Ensure Windsurf is installed.",
			mustNot: "paulanduschus",
		},
		{
			name:    "safari cookie path",
			in:      "Safari cookie file exists but is not readable (/Users/paulanduschus/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies). Enable Full Disk Access.",
			mustNot: "paulanduschus",
		},
		{
			name:    "account e-mail",
			in:      "Signed in as hallo@dreamytales.de but the session expired.",
			mustNot: "hallo@dreamytales.de",
		},
		{
			name:    "session token",
			in:      "Rejected cookie WorkosCursorSessionToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef.",
			mustNot: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef",
		},
	} {
		got := reportedProviderMessage(tc.in)
		if got == "" {
			t.Fatalf("%s: the whole sentence was dropped, leaving nothing to say", tc.name)
		}
		if tc.name == "home path" && !contains(got, "~/Library/Application Support/Windsurf") {
			t.Fatalf("%s: the path stopped being followable: %q", tc.name, got)
		}
		if contains(got, tc.mustNot) {
			t.Fatalf("%s: %q leaked into %q", tc.name, tc.mustNot, got)
		}
	}
}

// The engine's name never reaches a customer, and the two sentences that carry
// it are wrong anyway: both providers are read out of browser cookies, so
// "log in via the CodexBar menu" points away from what would work.
func TestReportedProviderMessageDropsTheEngineName(t *testing.T) {
	for _, in := range []string{
		"Not logged in to Cursor. Please log in via the CodexBar menu.",
		"Not logged in to Augment. Please log in via the CodexBar menu.",
		"No Qwen Cloud session cookies found in browsers. Sign in to Qwen Cloud in Chrome, allow CodexBar to access Chrome Safe Storage in Keychain Access.",
	} {
		if got := reportedProviderMessage(in); got != "" {
			t.Fatalf("engine name survived: %q", got)
		}
	}
}

// "No available fetch strategy for copilot." is the engine's answer for 34 of
// 65 providers. It reads as "nothing you can do" while Copilot has a working
// device flow, so it is never shown.
func TestProviderReportedIsUselessCoversTheNoStrategyAnswer(t *testing.T) {
	if !providerReportedIsUseless("No available fetch strategy for copilot.") {
		t.Fatal("the no-strategy answer must not reach the customer")
	}
	if !providerReportedIsUseless("") {
		t.Fatal("an empty report is nothing to show")
	}
	if providerReportedIsUseless("Not logged in to Gemini. Run 'gemini' in Terminal to authenticate.") {
		t.Fatal("real guidance was discarded")
	}
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) &&
		indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
