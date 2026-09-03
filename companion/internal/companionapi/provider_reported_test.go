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

func TestReportedProviderMessageRedactsOnlyTheHomePath(t *testing.T) {
	input := "Windsurf database not found at /Users/paulanduschus/Library/Application Support/Windsurf/User/globalStorage/state.vscdb."
	want := "Windsurf database not found at ~/Library/Application Support/Windsurf/User/globalStorage/state.vscdb."
	if got := reportedProviderMessage(input); got != want {
		t.Fatalf("home path redaction:\n got %q\nwant %q", got, want)
	}

	for _, message := range []string{
		"Signed in as hallo@dreamytales.de but the session expired.",
		"Rejected cookie WorkosCursorSessionToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef.",
		"Not logged in to Cursor. Please log in via the CodexBar menu.",
		"No available fetch strategy for copilot.",
	} {
		if got := reportedProviderMessage(message); got != message {
			t.Fatalf("CodexBar's sentence was rewritten:\n got %q\nwant %q", got, message)
		}
	}
}
