package companionapi

import (
	"encoding/json"
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
	if err := runtimeconfig.Save(s.home, runtimeconfig.Config{DeviceID: "keep-device", ConnectionMode: "cable"}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		id, body string
		code     int
	}{{"enabled", `{"value":false}`, 200}, {"blink", `{"value":false}`, 200}, {"reminder", `{"value":"15"}`, 200}, {"quiet", `{"value":"22"}`, 200}, {"reminder", `{"value":"2"}`, 400}, {"enabled", `{"value":"false"}`, 400}} {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodPatch, "/v1/preferences/vibetv.agents."+tc.id, strings.NewReader(tc.body)))
		if w.Code != tc.code {
			t.Fatalf("%s %d %s", tc.id, w.Code, w.Body.String())
		}
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
