package companionapi

import (
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo"
)

// The Mac App stops this runtime to repair CodexBar. runtime-health alone could
// only report a job that had already started, so a firmware update begun
// between that answer and the shutdown still died with this process. The Mac
// App now claims a hold first: taking it and starting an update are the same
// lock, so one of the two always loses cleanly. The hold expires on its own
// because the process it protects is normally gone before it matters.
const runtimeUpdateHoldWindow = 60 * time.Second

func (s *Server) handleRuntimeUpdateHold(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Release bool `json:"release"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if req.Release {
		s.updateHoldUntil = time.Time{}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if _, running := s.activeFirmwareUpdateJob(); running {
		// For someone tailing this runtime in a terminal. Not bench evidence:
		// the managed LaunchAgent redirects neither stream, so this never
		// reaches daemon.out.log. The 409 below is the observable contract, and
		// scripts/vibetv-prove-update-serialization.sh asks for it directly.
		s.updateHoldRefusals.Add(1)
		_, _ = fmt.Fprintln(os.Stderr, "VibeTV update hold refused: a firmware update owns this runtime")
		writeError(
			w,
			http.StatusConflict,
			"firmware_update_in_progress",
			"VibeTV update is still running.",
			"Wait for the update to finish.",
		)
		return
	}
	// A theme install job and its worker live in this process exactly like a
	// firmware job, so the repair's restart erases a running install and the
	// status the customer is watching for it. The browser defers its own repair
	// while one runs, but an externally delivered vibetv://repair-codexbar never
	// passes through that check -- the guard has to be here, where the hold is
	// granted.
	if s.themeInstallInFlight() {
		s.updateHoldRefusals.Add(1)
		_, _ = fmt.Fprintln(os.Stderr, "VibeTV update hold refused: a theme install owns this runtime")
		writeError(
			w,
			http.StatusConflict,
			"theme_install_in_progress",
			"A theme or screensaver is still being installed.",
			"Wait for it to finish.",
		)
		return
	}
	s.updateHoldUntil = time.Now().Add(runtimeUpdateHoldWindow)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Callers must hold firmwareUpdateStartMu.
func (s *Server) updateHoldActive() bool {
	return !s.updateHoldUntil.IsZero() && time.Now().Before(s.updateHoldUntil)
}

// Callers must hold firmwareUpdateStartMu, so that asking this and granting a
// hold are one step.
func (s *Server) themeInstallInFlight() bool {
	return s.themeInstallActive.Load()
}

// Callers hold firmwareUpdateStartMu so checking the accepted theme job and
// starting another device operation are one serialized decision.
// rejectBusyDevice answers 409 while a firmware update or a theme install owns
// VibeTV. nextStep tells the customer what to do once the update is done.
func (s *Server) rejectBusyDevice(w http.ResponseWriter, nextStep string) bool {
	if _, running := s.activeFirmwareUpdateJob(); running {
		writeError(w, http.StatusConflict, "firmware_update_in_progress", "VibeTV update is still running.", nextStep)
		return true
	}
	return s.rejectActiveThemeInstall(w)
}

func (s *Server) rejectActiveThemeInstall(w http.ResponseWriter) bool {
	if !s.themeInstallInFlight() {
		return false
	}
	writeError(
		w,
		http.StatusConflict,
		"theme_install_in_progress",
		"A theme or screensaver is still being installed.",
		"Wait for it to finish, then try again.",
	)
	return true
}

func (s *Server) handleRuntimeHealth(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	_, updateInProgress := s.activeFirmwareUpdateJob()
	writeJSON(w, http.StatusOK, struct {
		OK bool `json:"ok"`
		// The writer-quiesce gate cares about device writers, not runtimes: a
		// standalone `codexbar-display api` server answers here without
		// owning a display stream, and its own child updater must not
		// mistake it for one. Absent field (older runtimes) means writer.
		DisplayWriter bool `json:"displayWriter"`
		// A firmware update job lives in this process and dies with it. The Mac
		// App asks here before restarting the runtime for a CodexBar repair,
		// because that restart would strand a running update: the next status
		// poll asks a fresh process for a job id it has never seen.
		UpdateInProgress bool `json:"updateInProgress"`
		// How often this runtime has refused an update hold. The refusal is the
		// only sign from outside that a CodexBar repair actually met a running
		// job, and the runtime's stderr does not reach any file a script can
		// read: the managed LaunchAgent redirects neither stream. A bench run
		// reads this before and after it delivers the repair; an increase is
		// the collision. scripts/vibetv-prove-update-serialization.sh requires
		// it, and without it that script cannot tell a repair that was held
		// back from one that bailed out before ever asking.
		UpdateHoldRefusals uint64 `json:"updateHoldRefusals"`
		Companion          struct {
			Version string               `json:"version"`
			App     companionAppInfo     `json:"app"`
			Runtime companionRuntimeInfo `json:"runtime"`
		} `json:"companion"`
	}{
		OK:                 true,
		DisplayWriter:      s.pauseDisplayStream != nil,
		UpdateInProgress:   updateInProgress,
		UpdateHoldRefusals: s.updateHoldRefusals.Load(),
		Companion: struct {
			Version string               `json:"version"`
			App     companionAppInfo     `json:"app"`
			Runtime companionRuntimeInfo `json:"runtime"`
		}{
			Version: buildinfo.NormalizedVersion(),
			App:     currentCompanionAppInfo(s.installationMode),
			Runtime: currentCompanionRuntimeInfo(),
		},
	})
}
