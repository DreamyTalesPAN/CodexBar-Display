package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
)

func runtimeHoldServer(t *testing.T, owner string, holdStatus int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runtime-health":
			_, _ = w.Write([]byte(`{"ok":true,"displayWriter":true,"companion":{"runtime":{"listenerOwner":"` + owner + `"}}}`))
		case "/v1/runtime-health/update-hold":
			if r.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			w.WriteHeader(holdStatus)
			_, _ = w.Write([]byte(`{"ok":false,"error":{"code":"firmware_update_in_progress"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestClaimRuntimeUpdateHoldBlocksWhileDeviceWriteOwnsRuntime(t *testing.T) {
	server := runtimeHoldServer(t, "shop.vibetv.control-center.runtime", http.StatusConflict)
	defer server.Close()
	err := claimRuntimeUpdateHoldAt([]string{server.URL}, "shop.vibetv.control-center.runtime")
	if err == nil || !strings.Contains(err.Error(), "still running") {
		t.Fatalf("expected the uninstall to be refused while a job owns the runtime, got %v", err)
	}
}

func TestClaimRuntimeUpdateHoldPassesWhenGrantedOrNoRuntime(t *testing.T) {
	server := runtimeHoldServer(t, "shop.vibetv.control-center.runtime", http.StatusOK)
	defer server.Close()
	if err := claimRuntimeUpdateHoldAt([]string{server.URL}, "shop.vibetv.control-center.runtime"); err != nil {
		t.Fatalf("granted hold must not block: %v", err)
	}
	// A runtime under another label is not ours; nothing identified, nothing to hold.
	other := runtimeHoldServer(t, "com.codexbar.other", http.StatusConflict)
	defer other.Close()
	if err := claimRuntimeUpdateHoldAt([]string{other.URL}, "shop.vibetv.control-center.runtime"); err != nil {
		t.Fatalf("foreign runtime must not block: %v", err)
	}
	gone := runtimeHoldServer(t, "shop.vibetv.control-center.runtime", http.StatusOK)
	gone.Close()
	if err := claimRuntimeUpdateHoldAt([]string{gone.URL}, "shop.vibetv.control-center.runtime"); err != nil {
		t.Fatalf("no runtime must not block: %v", err)
	}
}

type recordingTaskManager struct {
	uninstalled bool
}

func (m *recordingTaskManager) Install(context.Context) error    { return nil }
func (m *recordingTaskManager) Start(context.Context) error      { return nil }
func (m *recordingTaskManager) Stop(context.Context, bool) error { return nil }
func (m *recordingTaskManager) Status(context.Context) (service.Status, error) {
	return service.Status{}, nil
}
func (m *recordingTaskManager) Uninstall(context.Context) error {
	m.uninstalled = true
	return nil
}

// The central claim in runService asks the new label only. The legacy task
// retired by the migration may be mid firmware update, so its own hold must
// be claimed before it is uninstalled.
func TestMigrateLegacyWindowsTaskClaimsLegacyRuntimeHold(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("legacy task migration runs on Windows only")
	}
	server := runtimeHoldServer(t, runtimepaths.LegacyDisplayStreamLaunchAgentLabel, http.StatusConflict)
	defer server.Close()
	home := t.TempDir()
	endpointPath := runtimeEndpointPath(home)
	if err := os.MkdirAll(filepath.Dir(endpointPath), 0o700); err != nil {
		t.Fatal(err)
	}
	endpoint, _ := json.Marshal(runtimeEndpoint{Origin: server.URL})
	if err := os.WriteFile(endpointPath, endpoint, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.WriteTaskConfig(home, runtimepaths.LegacyDisplayStreamLaunchAgentLabel, service.TaskConfig{Executable: "legacy.exe"}); err != nil {
		t.Fatal(err)
	}
	manager := &recordingTaskManager{}
	original := legacyWindowsTaskManagerFn
	t.Cleanup(func() { legacyWindowsTaskManagerFn = original })
	legacyWindowsTaskManagerFn = func(string) service.Manager { return manager }

	err := migrateLegacyWindowsTask(home, "shop.vibetv.control-center.runtime")
	if err == nil || !strings.Contains(err.Error(), "still running") {
		t.Fatalf("migration must be refused while the legacy runtime owns a job, got %v", err)
	}
	if manager.uninstalled {
		t.Fatal("legacy task was uninstalled although its runtime refused the hold")
	}
}
