package firmwareupdate

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/writerlock"
)

// RescueMarkerMaxAge bounds how long a half-written VibeTV is assumed to still
// sit on its port or on the port it was moved to. After that the port name may
// belong to something else.
const RescueMarkerMaxAge = 14 * 24 * time.Hour

// RescueMarker records that a Cable rescue erased a VibeTV's firmware and did
// not finish. The VibeTV then boot-loops without a hello, so this marker is
// the only proof that the ROM loader on Port may be written again (issue #818).
type RescueMarker struct {
	Port string `json:"port"`
	// Board and Firmware are what the VibeTV reported before the rescue.
	Board          string `json:"board,omitempty"`
	Firmware       string `json:"firmware,omitempty"`
	TargetFirmware string `json:"targetFirmware"`
	ImagePath      string `json:"imagePath"`
	ImageSHA256    string `json:"imageSha256"`
	// ChipMAC is the eFuse MAC of the ESP8266 whose firmware was erased. A
	// resumed rescue writes only that chip, so another VibeTV on a reused port
	// stays untouched.
	ChipMAC string `json:"chipMac,omitempty"`
	// ChipNotRead marks a marker saved before the chip was read: no FLASH_BEGIN
	// was sent, so the VibeTV is untouched and a replug may clear it. Markers
	// without the flag (#819 and #840 builds) may be half-written and are kept.
	ChipNotRead bool `json:"chipNotRead,omitempty"`
	// Ports lists the Cable ports that were there when the write started. A
	// VibeTV plugged into another USB socket shows up on a port missing here.
	// Nil means unknown, and then no moved VibeTV is looked for.
	Ports          []string  `json:"ports"`
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
	// Lock a stable sidecar, not the marker inode replaced by durableRename.
	// Every marker mutation uses this same cross-process lock.
	lock, err := writerlock.AcquireAtWait(path + ".lock")
	if err != nil {
		return err
	}
	defer lock.Release()
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
	// The rename must be on disk before the write may start: on the first
	// rescue there is no older marker to fall back to after a power loss.
	return durableRename(tmpPath, path)
}

// RescueImageIntact reports whether the image a marker points to is still
// there unchanged, so a rescue from that marker can actually start.
func RescueImageIntact(marker RescueMarker) bool {
	data, err := os.ReadFile(marker.ImagePath)
	if err != nil {
		return false
	}
	sum := sha256.Sum256(data)
	return strings.EqualFold(hex.EncodeToString(sum[:]), strings.TrimSpace(marker.ImageSHA256))
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
	lock, err := writerlock.AcquireAtWait(path + ".lock")
	if err != nil {
		return err
	}
	defer lock.Release()
	return clearRescueMarker(path)
}

// The caller holds the marker's sidecar lock throughout inspection and removal.
func clearRescueMarker(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// ClearRescueMarkerIfUnchanged clears the flagged chipless marker inspected
// earlier, but only while it is still that marker. An overlapping rescue may
// have saved a newer marker with the chip since (issue #842); that one stays.
func ClearRescueMarkerIfUnchanged(home string, inspected RescueMarker) error {
	return clearRescueMarkerIfUnchanged(home, inspected, nil)
}

func clearRescueMarkerIfUnchanged(home string, inspected RescueMarker, beforeRemove func()) error {
	path := RescueMarkerPath(home)
	if path == "" {
		return nil
	}
	lock, err := writerlock.AcquireAtWait(path + ".lock")
	if err != nil {
		return err
	}
	defer lock.Release()
	current, ok := LoadRescueMarker(home, time.Now())
	if !ok || current.Port != inspected.Port || !current.WriteStartedAt.Equal(inspected.WriteStartedAt) ||
		current.ChipMAC != "" || !current.ChipNotRead {
		return nil
	}
	if beforeRemove != nil {
		beforeRemove()
	}
	return clearRescueMarker(path)
}

// MovedRescuePort finds the port a half-written VibeTV moved to after it was
// plugged into another USB socket. It is the one listed port that was not there
// when the write started, is not the marked port, and does not answer a hello.
// No candidate, or more than one, means no port: nothing may be written then.
// ChipDeviceID is the deviceId firmware on the marked chip reports in its hello:
// ESP.getChipId(), which the SDK derives from the same eFuse words as ChipMAC
// ("%08x%08x" of MAC1, MAC0), like esptool's chip_id. ok is false without a
// readable ChipMAC.
func ChipDeviceID(chipMAC string) (string, bool) {
	chipMAC = strings.TrimSpace(chipMAC)
	if len(chipMAC) != 16 {
		return "", false
	}
	mac1, err1 := strconv.ParseUint(chipMAC[:8], 16, 32)
	mac0, err0 := strconv.ParseUint(chipMAC[8:], 16, 32)
	if err1 != nil || err0 != nil {
		return "", false
	}
	id := uint32(mac0>>24) | uint32((mac1&0xFFFFFF)<<8)
	return strconv.FormatUint(uint64(id), 10), true
}

func MovedRescuePort(marker RescueMarker, listed []string, readHello func(string) (protocol.DeviceHello, error)) (string, bool) {
	if marker.Ports == nil {
		return "", false
	}
	before := make(map[string]bool, len(marker.Ports))
	for _, port := range marker.Ports {
		before[strings.ToUpper(strings.TrimSpace(port))] = true
	}
	marked := strings.ToUpper(strings.TrimSpace(marker.Port))
	var candidates []string
	for _, port := range listed {
		key := strings.ToUpper(strings.TrimSpace(port))
		if key == "" || key == marked || before[key] {
			continue
		}
		if hello, err := readHello(port); err == nil && (strings.TrimSpace(hello.DeviceID) != "" || strings.TrimSpace(hello.Firmware) != "") {
			continue
		}
		candidates = append(candidates, port)
	}
	if len(candidates) != 1 {
		return "", false
	}
	return candidates[0], true
}
