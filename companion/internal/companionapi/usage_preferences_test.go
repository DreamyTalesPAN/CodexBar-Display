package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestUsagePreferenceRegistry(t *testing.T) {
	for _, platform := range []string{"darwin", "windows", "linux"} {
		t.Run(platform, func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{})
			t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", "")
			stored, writes := false, 0
			adapter := usagePreferenceAdapter{
				goos:  platform,
				read:  func() (bool, error) { return stored, nil },
				write: func(_ context.Context, value bool) error { stored = value; writes++; return nil },
			}
			server.preferenceAdapters = []preferenceAdapter{adapter}
			request := func(method, path, body string) *httptest.ResponseRecorder {
				rec := httptest.NewRecorder()
				server.Handler().ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
				return rec
			}
			rec := request(http.MethodGet, "/v1/preferences?section=display", "")
			var listed preferencesResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil || rec.Code != http.StatusOK {
				t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
			}
			path := "/v1/preferences/codexbar.usageBarsShowUsed"
			if platform != "darwin" {
				if len(listed.Items) != 0 {
					t.Fatal("only Mac exposes the setting")
				}
				if got := request(http.MethodPatch, path, `{"value":"true"}`).Code; got != http.StatusNotFound {
					t.Fatalf("unsupported write = %d", got)
				}
				if writes != 0 {
					t.Fatal("unsupported write was executed")
				}
				return
			}
			if len(listed.Items) != 1 {
				t.Fatalf("items = %#v", listed.Items)
			}
			item := listed.Items[0]
			if item.Owner != "codexbar" || item.Label != "Show" || item.Value != "false" || item.EffectiveValue != "false" || !item.Writable || item.WriteStrategy != "codexbar_command" {
				t.Fatalf("descriptor = %#v", item)
			}
			if len(item.Options) != 2 || item.Options[0] != (preferenceOption{Value: "true", Label: "Used"}) || item.Options[1] != (preferenceOption{Value: "false", Label: "Remaining"}) {
				t.Fatalf("options = %#v", item.Options)
			}
			for _, value := range []string{"true", "false"} {
				rec = request(http.MethodPatch, path, `{"value":"`+value+`"}`)
				var response preferenceResponse
				if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || rec.Code != http.StatusOK || response.Item.Value != value {
					t.Fatalf("patch: %d %s", rec.Code, rec.Body.String())
				}
			}
			for _, body := range []string{`{"value":true}`, `{"value":"used"}`, `{"value":null}`} {
				if got := request(http.MethodPatch, path, body).Code; got != http.StatusBadRequest {
					t.Fatalf("invalid patch = %d", got)
				}
			}
			if writes != 2 {
				t.Fatalf("writes = %d", writes)
			}
			t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", "remaining")
			items, err := adapter.List(context.Background())
			if err != nil || items[0].Writable {
				t.Fatalf("override descriptor = %#v, %v", items, err)
			}
			if got := request(http.MethodPatch, path, `{"value":"true"}`).Code; got != http.StatusConflict || writes != 2 {
				t.Fatalf("override patch = %d, writes = %d", got, writes)
			}
			t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", "")
			adapter.write = func(context.Context, bool) error { return errors.New("private command output") }
			server.preferenceAdapters = []preferenceAdapter{adapter}
			rec = request(http.MethodPatch, path, `{"value":"true"}`)
			if rec.Code != http.StatusBadGateway || strings.Contains(rec.Body.String(), "private command output") {
				t.Fatalf("write failure: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

// Exercise the production registry and CodexBar reader without touching the
// host's saved defaults: the environment owns this test's effective value.
func TestUsagePreferenceRegisteredWithCodexBarReader(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", "remaining")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=display", nil))
	var listed preferencesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	found := false
	for _, item := range listed.Items {
		if item.ID == usageBarsPreferenceID {
			found = true
			if item.Value != "false" || item.EffectiveValue != "false" || item.Writable {
				t.Fatalf("must reflect CodexBar's environment override: %#v", item)
			}
		}
	}
	if found != (runtime.GOOS == "darwin") {
		t.Fatalf("setting listed on %s: %v", runtime.GOOS, found)
	}
}

func TestUsagePreferenceUnknownAndUnconfirmedReadback(t *testing.T) {
	t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", "")
	adapter := usagePreferenceAdapter{
		goos:  "darwin",
		read:  func() (bool, error) { return false, errors.New("missing key or read failed") },
		write: func(context.Context, bool) error { return nil },
	}
	items, err := adapter.List(context.Background())
	if err != nil || len(items) != 1 {
		t.Fatalf("list = %v, %v", items, err)
	}
	if items[0].Value != nil || items[0].EffectiveValue != nil || items[0].Availability.State == "available" {
		t.Fatalf("unknown mode must have no selected option: %+v", items[0])
	}
	if _, err := adapter.Write(context.Background(), usageBarsPreferenceID, "false"); err == nil {
		t.Fatal("failed read-back must not confirm a write")
	}
	adapter.read = func() (bool, error) { return true, nil }
	if _, err := adapter.Write(context.Background(), usageBarsPreferenceID, "false"); err == nil {
		t.Fatal("mismatched read-back must not confirm a write")
	}
}
