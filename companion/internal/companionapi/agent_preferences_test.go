package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/agentstatus"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAgentPreferencesPersistWithoutChangingDeviceOrUsage(t *testing.T) {
	s := newTestServer(t, runtimeconfig.Config{})
	s.loadConfig = runtimeconfig.Load
	s.saveConfig = runtimeconfig.Save
	calls := 0
	s.configureAgents = func(_ context.Context, enabled bool) (agentstatus.Snapshot, error) {
		calls++
		if enabled != (calls == 1) {
			t.Fatal("expected master on then off")
		}
		return agentstatus.Snapshot{}, nil
	}
	wakes := 0
	s.renderDisplayStream = func() { wakes++ }
	if err := runtimeconfig.Save(s.home, runtimeconfig.Config{DeviceID: "keep-device", ConnectionMode: "cable"}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		id, body string
		code     int
	}{{"enabled", `{"value":true}`, 200}, {"enabled", `{"value":false}`, 200}, {"blink", `{"value":false}`, 200}, {"reminder", `{"value":"15"}`, 200}, {"quiet", `{"value":"22"}`, 200}, {"reminder", `{"value":"2"}`, 400}, {"enabled", `{"value":"false"}`, 400}} {
		before := wakes
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodPatch, "/v1/preferences/vibetv.agents."+tc.id, strings.NewReader(tc.body)))
		if w.Code != tc.code {
			t.Fatalf("%s %d %s", tc.id, w.Code, w.Body.String())
		}
		wantWakes := before
		if tc.code == http.StatusOK {
			wantWakes++
		}
		if wakes != wantWakes {
			t.Fatalf("%s: render wakes = %d, want %d", tc.id, wakes, wantWakes)
		}
	}
	if calls != 2 {
		t.Fatalf("master calls: %d", calls)
	}
	cfg, err := runtimeconfig.Load(s.home)
	if err != nil {
		t.Fatal(err)
	}
	a := cfg.AgentActivitySettings()
	if a.Enabled || a.Blink || a.Reminder != "15" || a.Quiet != "22" || cfg.DeviceID != "keep-device" || cfg.ConnectionMode != "cable" {
		t.Fatalf("%+v %+v", a, cfg)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=agents", nil))
	var response preferencesResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || len(response.Items) != 4 {
		t.Fatalf("%s", w.Body.String())
	}
}

func TestAgentMasterFailuresDoNotPersistSuccess(t *testing.T) {
	for _, savingFails := range []bool{false, true} {
		t.Run(map[bool]string{false: "engine failure", true: "config failure"}[savingFails], func(t *testing.T) {
			cfg := runtimeconfig.Config{AgentActivity: &runtimeconfig.AgentActivitySettings{Enabled: false, Blink: true, Reminder: "5", Quiet: "off"}}
			s := newTestServer(t, cfg)
			s.loadConfig = func(string) (runtimeconfig.Config, error) { return cfg, nil }
			saves := 0
			s.saveConfig = func(_ string, next runtimeconfig.Config) error { saves++; return errors.New("disk full") }
			calls := []bool{}
			s.configureAgents = func(_ context.Context, enabled bool) (agentstatus.Snapshot, error) {
				calls = append(calls, enabled)
				if !savingFails {
					return agentstatus.Snapshot{}, errors.New("invalid agent settings")
				}
				return agentstatus.Snapshot{}, nil
			}
			s.renderDisplayStream = func() { t.Fatal("failed setting woke renderer") }
			_, err := (agentPreferenceAdapter{server: s}).Write(context.Background(), "vibetv.agents.enabled", true)
			if err == nil {
				t.Fatal("failed setting reported success")
			}
			if savingFails {
				if saves != 1 || len(calls) != 2 || !calls[0] || calls[1] {
					t.Fatalf("missing rollback: %v, saves %d", calls, saves)
				}
			} else if saves != 0 || len(calls) != 1 {
				t.Fatalf("failed engine saved preference: %v %d", calls, saves)
			}
		})
	}
}
