package codexbar

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// reversibleCodec stands in for DPAPI: base64 over a marker so a test can
// prove the payload was unwrapped, changed and wrapped again.
var reversibleCodec = settingsCodec{
	unprotect: func(b []byte) ([]byte, error) {
		return base64.StdEncoding.DecodeString(string(b[len("dpapi:"):]))
	},
	protect: func(b []byte) ([]byte, error) {
		return []byte("dpapi:" + base64.StdEncoding.EncodeToString(b)), nil
	},
}

func TestAllowClaudeCredentialsRewritesProtectedPayload(t *testing.T) {
	inner := `{"enabled_providers":["claude"],"claude_allow_reading_claude_code_credentials":false,"future":{"keep":1}}`
	protected, _ := reversibleCodec.protect([]byte(inner))
	env, _ := json.Marshal(map[string]any{
		"format": "codexbar.secure-file", "version": 1, "protection": "windows-dpapi-user",
		"payload": base64.StdEncoding.EncodeToString(protected),
	})
	out, err := allowClaudeCredentials(append([]byte("\xef\xbb\xbf"), env...), reversibleCodec)
	if err != nil {
		t.Fatal(err)
	}
	if out[0] != '{' {
		t.Fatalf("output must not carry a BOM: %q", out[:4])
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(out, &envelope); err != nil {
		t.Fatal(err)
	}
	if string(envelope["protection"]) != `"windows-dpapi-user"` || string(envelope["version"]) != "1" {
		t.Fatalf("envelope fields must be preserved: %s", out)
	}
	var encoded string
	_ = json.Unmarshal(envelope["payload"], &encoded)
	raw, _ := base64.StdEncoding.DecodeString(encoded)
	plain, err := reversibleCodec.unprotect(raw)
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(plain, &settings); err != nil {
		t.Fatal(err)
	}
	if string(settings[claudeCredentialsFlag]) != "true" {
		t.Fatalf("flag not set: %s", plain)
	}
	if string(settings["future"]) != `{"keep":1}` || string(settings["enabled_providers"]) != `["claude"]` {
		t.Fatalf("other settings must be preserved: %s", plain)
	}
}

func TestAllowClaudeCredentialsHandlesPlainSeed(t *testing.T) {
	out, err := allowClaudeCredentials([]byte("{\"enabled_providers\":[]}\n"), reversibleCodec)
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(out, &settings); err != nil {
		t.Fatal(err)
	}
	if string(settings[claudeCredentialsFlag]) != "true" || string(settings["enabled_providers"]) != "[]" {
		t.Fatalf("unexpected result: %s", out)
	}
}

func TestAllowClaudeCredentialsRejectsGarbage(t *testing.T) {
	if _, err := allowClaudeCredentials([]byte("not json"), reversibleCodec); err == nil {
		t.Fatal("expected parse error")
	}
}

func TestRewriteSettingsFileReplacesAtomically(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte(`{"enabled_providers":["codex"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := rewriteSettingsFile(path, reversibleCodec); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("temp file left behind: %v", entries)
	}
	data, _ := os.ReadFile(path)
	if string(data) != `{"claude_allow_reading_claude_code_credentials":true,"enabled_providers":["codex"]}` {
		t.Fatalf("unexpected file: %s", data)
	}
}

func TestSetProviderEnabledGrantsClaudeCredentialsOnWindowsOnly(t *testing.T) {
	withProviderCommandTestBinary(t, "0.56.8")
	originalMode, originalGrant, originalRun := providerProbePerProvider, grantClaudeCredentialsFn, runProviderCommandFn
	t.Cleanup(func() {
		providerProbePerProvider, grantClaudeCredentialsFn, runProviderCommandFn = originalMode, originalGrant, originalRun
	})
	runProviderCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if args[0] == "config" && args[1] == "providers" {
			return []byte(`[{"provider":"claude","displayName":"Claude","enabled":false},{"provider":"codex","displayName":"Codex","enabled":false}]`), nil
		}
		return []byte(""), nil
	}
	grants := 0
	grantClaudeCredentialsFn = func() error { grants++; return nil }

	providerProbePerProvider = true
	for _, c := range []struct {
		id      string
		enabled bool
		want    int
	}{{"claude", true, 1}, {"claude", false, 1}, {"codex", true, 1}} {
		if err := SetProviderEnabled(context.Background(), c.id, c.enabled); err != nil {
			t.Fatal(err)
		}
		if grants != c.want {
			t.Fatalf("%s enabled=%v: grants=%d want %d", c.id, c.enabled, grants, c.want)
		}
	}

	providerProbePerProvider = false
	if err := SetProviderEnabled(context.Background(), "claude", true); err != nil {
		t.Fatal(err)
	}
	if grants != 1 {
		t.Fatalf("Mac path must not touch Win-CodexBar settings, grants=%d", grants)
	}

	providerProbePerProvider = true
	grantClaudeCredentialsFn = func() error { return errors.New("dpapi failed") }
	toggled := false
	runProviderCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if args[0] == "config" && args[1] == "providers" {
			return []byte(`[{"provider":"claude","displayName":"Claude","enabled":false}]`), nil
		}
		toggled = true
		return []byte(""), nil
	}
	if err := SetProviderEnabled(context.Background(), "claude", true); err == nil {
		t.Fatal("grant failure must surface")
	}
	if toggled {
		t.Fatal("Claude must stay disabled in CodexBar when the consent flag cannot be written")
	}
}

func TestUsageDisplayPreservesSecureSettingsAndConsent(t *testing.T) {
	for _, secured := range []bool{false, true} {
		data := []byte(`{"show_as_used":true,"claude_allow_reading_claude_code_credentials":false,"future":{"keep":1}}`)
		if secured {
			protected, _ := reversibleCodec.protect(data)
			data, _ = json.Marshal(map[string]any{"format": "codexbar.secure-file", "version": 1, "payload": base64.StdEncoding.EncodeToString(protected)})
		}
		for _, value := range []bool{false, true} {
			var err error
			data, err = updateWindowsSettings(data, reversibleCodec, func(settings map[string]json.RawMessage) { settings["show_as_used"], _ = json.Marshal(value) })
			if err != nil {
				t.Fatal(err)
			}
			settings, envelope, err := decodeWindowsSettings(data, reversibleCodec)
			if err != nil {
				t.Fatal(err)
			}
			var got bool
			_ = json.Unmarshal(settings["show_as_used"], &got)
			if got != value || (envelope != nil) != secured || string(settings[claudeCredentialsFlag]) != "false" || string(settings["future"]) != `{"keep":1}` {
				t.Fatalf("display write changed other settings: %s", data)
			}
		}
	}
}

func TestConcurrentWindowsSettingsPreserveConsentAndDisplay(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	protected, _ := reversibleCodec.protect([]byte(`{"show_as_used":true,"claude_allow_reading_claude_code_credentials":false,"future":{"keep":1}}`))
	data, _ := json.Marshal(map[string]any{"format": "codexbar.secure-file", "version": 1, "payload": base64.StdEncoding.EncodeToString(protected)})
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	codec := reversibleCodec
	codec.unprotect = func(data []byte) ([]byte, error) {
		// Keep decryption in flight long enough for the other writer to start.
		time.Sleep(20 * time.Millisecond)
		return reversibleCodec.unprotect(data)
	}
	start, done := make(chan struct{}), make(chan error, 2)
	go func() {
		<-start
		done <- rewriteSettingsFile(path, codec)
	}()
	go func() {
		<-start
		done <- rewriteWindowsSettingsFile(path, codec, func(settings map[string]json.RawMessage) {
			settings["show_as_used"] = json.RawMessage("false")
		})
	}()
	close(start)
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	settings, envelope, err := decodeWindowsSettings(data, reversibleCodec)
	if err != nil || envelope == nil || string(settings["show_as_used"]) != "false" || string(settings[claudeCredentialsFlag]) != "true" || string(settings["future"]) != `{"keep":1}` {
		t.Fatalf("concurrent update lost a setting: %s, %v", data, err)
	}
}
