package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
