package firmwareupdate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

// RescueMarkerMaxAge bounds how long a half-written VibeTV is assumed to still
// sit on its port. After that the port name may belong to something else.
const RescueMarkerMaxAge = 24 * time.Hour

// RescueMarker records that a Cable rescue erased a VibeTV's firmware and did
// not finish. The VibeTV then boot-loops without a hello, so this marker is
// the only proof that the ROM loader on Port may be written again (issue #818).
type RescueMarker struct {
	Port string `json:"port"`
	// Board and Firmware are what the VibeTV reported before the rescue.
	Board          string    `json:"board,omitempty"`
	Firmware       string    `json:"firmware,omitempty"`
	TargetFirmware string    `json:"targetFirmware"`
	ImagePath      string    `json:"imagePath"`
	ImageSHA256    string    `json:"imageSha256"`
	WriteStartedAt time.Time `json:"writeStartedAt"`
}

// RescueMarkerPath is the marker file under the Companion directory.
func RescueMarkerPath(home string) string {
	return runtimepaths.Path(home, "updates", "firmware", "cable-rescue-pending.json")
}

func SaveRescueMarker(home string, marker RescueMarker) error {
	path := RescueMarkerPath(home)
	if path == "" {
		return os.ErrNotExist
	}
	data, err := json.Marshal(marker)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	// Written next to the old marker and renamed over it, so a full disk or a
	// crash leaves the previous marker intact instead of a truncated one.
	tmp, err := os.CreateTemp(filepath.Dir(path), ".cable-rescue-pending-*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// LoadRescueMarker returns the marker only while it is complete and recent.
func LoadRescueMarker(home string, now time.Time) (RescueMarker, bool) {
	path := RescueMarkerPath(home)
	if path == "" {
		return RescueMarker{}, false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return RescueMarker{}, false
	}
	var marker RescueMarker
	if json.Unmarshal(data, &marker) != nil ||
		strings.TrimSpace(marker.Port) == "" ||
		strings.TrimSpace(marker.TargetFirmware) == "" ||
		strings.TrimSpace(marker.ImagePath) == "" ||
		now.Sub(marker.WriteStartedAt) > RescueMarkerMaxAge ||
		marker.WriteStartedAt.After(now.Add(time.Minute)) {
		return RescueMarker{}, false
	}
	return marker, true
}

func ClearRescueMarker(home string) error {
	path := RescueMarkerPath(home)
	if path == "" {
		return nil
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
