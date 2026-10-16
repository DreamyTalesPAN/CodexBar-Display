package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ShownFrame is the last frame the display stream delivered to one VibeTV,
// as its "sent frame" log line without the timestamp. The Companion reads it
// when that line has left the bounded log tail it reads (#368).
type ShownFrame struct {
	SentAt time.Time `json:"sentAt"`
	Line   string    `json:"line"`
}

// maxShownFrames bounds the file; a Mac rarely streams to more VibeTVs.
const maxShownFrames = 8

// LoadShownFrames returns the last delivered frame per device ID.
func LoadShownFrames(path string) map[string]ShownFrame {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var frames map[string]ShownFrame
	if json.Unmarshal(raw, &frames) != nil {
		return nil
	}
	return frames
}

func saveShownFrame(path, deviceID string, sentAt time.Time, line string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	frames := LoadShownFrames(path)
	if frames == nil {
		frames = map[string]ShownFrame{}
	}
	frames[strings.TrimSpace(deviceID)] = ShownFrame{SentAt: sentAt.UTC(), Line: strings.TrimSpace(line)}
	for len(frames) > maxShownFrames {
		oldest := ""
		for id, frame := range frames {
			if oldest == "" || frame.SentAt.Before(frames[oldest].SentAt) {
				oldest = id
			}
		}
		delete(frames, oldest)
	}
	raw, err := json.Marshal(frames)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
