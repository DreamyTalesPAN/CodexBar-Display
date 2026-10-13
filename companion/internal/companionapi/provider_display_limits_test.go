package companionapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func patchProviderDisplay(t *testing.T, server *Server, body string) (*httptest.ResponseRecorder, providerDisplayResponse) {
	t.Helper()
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPatch, "/v1/provider-display", bytes.NewBufferString(body)))
	var response providerDisplayResponse
	if recorder.Code == http.StatusOK {
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
	}
	return recorder, response
}

func TestProviderDisplayPairNeedsTwoDifferentEnabledProviders(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = providerSettingsFixture

	for _, body := range []string{
		`{"mode":"pair","providerIds":["claude"]}`,
		`{"mode":"pair","providerIds":["claude","CLAUDE"]}`,
		`{"mode":"pair","providerIds":["claude","cursor"]}`,
	} {
		if recorder, _ := patchProviderDisplay(t, server, body); recorder.Code != http.StatusConflict {
			t.Fatalf("%s: status=%d body=%s", body, recorder.Code, recorder.Body.String())
		}
	}

	recorder, response := patchProviderDisplay(t, server, `{"mode":"pair","providerIds":["claude","codex"]}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("pair: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if response.Selection.Mode != providerDisplayModePair || !reflect.DeepEqual(response.Selection.ProviderIDs, []string{"claude", "codex"}) {
		t.Fatalf("pair selection=%+v", response.Selection)
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ProviderDisplay.Mode != providerDisplayModePair || !reflect.DeepEqual(cfg.ProviderDisplay.ProviderIDs, []string{"claude", "codex"}) {
		t.Fatalf("saved pair=%+v", cfg.ProviderDisplay)
	}
}

func TestProviderDisplayLimitsAreSavedAndKeptAcrossModeChanges(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = providerSettingsFixture

	recorder, response := patchProviderDisplay(t, server, `{"mode":"automatic","providerIds":["codex","claude"],"hiddenWindows":{" Claude ":["Session","session"]},"showPace":false}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("limits: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	want := map[string][]string{"claude": {"session"}}
	if !reflect.DeepEqual(response.Selection.HiddenWindows, want) || response.Selection.ShowPace {
		t.Fatalf("limits answer=%+v", response.Selection)
	}

	// A change of mode leaves both out and must not reset them.
	recorder, response = patchProviderDisplay(t, server, `{"mode":"fixed","providerIds":["claude"]}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("mode: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if !reflect.DeepEqual(response.Selection.HiddenWindows, want) || response.Selection.ShowPace {
		t.Fatalf("mode change reset the limits: %+v", response.Selection)
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg.ProviderDisplay.HiddenWindows, want) || !cfg.ProviderDisplay.HidePace {
		t.Fatalf("saved limits=%+v", cfg.ProviderDisplay)
	}

	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/provider-display", nil))
	var read providerDisplayResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &read); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(read.Selection.HiddenWindows, want) || read.Selection.ShowPace {
		t.Fatalf("read back=%+v", read.Selection)
	}

	// Showing everything again stores nothing extra.
	recorder, response = patchProviderDisplay(t, server, `{"mode":"fixed","providerIds":["claude"],"hiddenWindows":{},"showPace":true}`)
	if recorder.Code != http.StatusOK || len(response.Selection.HiddenWindows) != 0 || !response.Selection.ShowPace {
		t.Fatalf("reset limits: status=%d selection=%+v", recorder.Code, response.Selection)
	}
	if cfg, _ = server.config(); cfg.ProviderDisplay.HiddenWindows != nil || cfg.ProviderDisplay.HidePace {
		t.Fatalf("saved defaults=%+v", cfg.ProviderDisplay)
	}
}

func TestProviderDisplayDefaultShowsEveryLimitAndThePace(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = providerSettingsFixture

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/provider-display", nil))
	var response providerDisplayResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Selection.HiddenWindows == nil || len(response.Selection.HiddenWindows) != 0 || !response.Selection.ShowPace {
		t.Fatalf("default=%s", recorder.Body.String())
	}
}
