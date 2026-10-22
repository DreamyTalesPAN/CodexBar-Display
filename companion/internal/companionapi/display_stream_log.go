package companionapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

var displayStreamLogKeys = []string{
	"code",
	"op",
	"retry",
	"cause",
	"recovery",
	"err",
	"transport",
	"deviceId",
	"source",
	"fresh",
	"usageMode",
	"footerWindow",
	"provider",
	"label",
	"session",
	"weekly",
	"sessionTokens",
	"weekTokens",
	"totalTokens",
	"tokenTotalsKnown",
	"usageUnavailable",
	"sessionUnavailable",
	"weeklyUnavailable",
	"reset",
	"usageWindows",
	"usageSlots",
	"providerSlots",
	"activity",
	"time",
	"date",
	"error",
	"reason",
	"detail",
	"activityDetail",
	"resetTrust",
	"resetTrustSecs",
	"resetSource",
}

func lastDisplayStreamFrame(path string) (time.Time, string) {
	when, target, _, ok := lastDisplayStreamFrameLine(path)
	if !ok {
		return time.Time{}, ""
	}
	return when, target
}

func lastDisplayStreamFrameLine(path string) (time.Time, string, string, bool) {
	streamLog := readDisplayStreamLog(path)
	boundary, ok := streamLog.boundary()
	if !ok {
		return time.Time{}, "", "", false
	}
	return streamLog.lastFrameAfter(boundary)
}

func (l displayStreamLog) lastFrameAfter(boundary time.Time) (time.Time, string, string, bool) {
	for _, lines := range l {
		for i := len(lines) - 1; i >= 0; i-- {
			line := strings.TrimSpace(lines[i])
			if !strings.Contains(line, "sent frame -> ") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) == 0 {
				continue
			}
			when, err := time.Parse(time.RFC3339Nano, parts[0])
			if err != nil {
				continue
			}
			if !boundary.IsZero() && when.Before(boundary) {
				continue
			}
			after := strings.TrimSpace(strings.SplitN(line, "sent frame -> ", 2)[1])
			target := ""
			if fields := strings.Fields(after); len(fields) > 0 {
				target = fields[0]
			}
			return when, target, line, true
		}
	}
	return time.Time{}, "", "", false
}

func (l displayStreamLog) lastErrorAfter(boundary time.Time) (time.Time, string, string, bool) {
	for _, lines := range l {
		for i := len(lines) - 1; i >= 0; i-- {
			line := strings.TrimSpace(lines[i])
			if !strings.Contains(line, "cycle error:") && !strings.Contains(line, "cycle timeout:") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) == 0 {
				continue
			}
			when, err := time.Parse(time.RFC3339Nano, parts[0])
			if err != nil {
				continue
			}
			if !boundary.IsZero() && when.Before(boundary) {
				continue
			}
			op := displayStreamLogValue(line, "op")
			detail := "Display stream hit an error after the last frame and is reconnecting."
			code := "display_stream_failed"
			if displayStreamLogValue(line, "code") == "runtime/no-providers" || strings.Contains(line, "runtime/no-providers") {
				detail = "VibeTV is connected, but AI usage is not ready yet."
				code = "provider_setup_required"
			} else if op == "send-line" {
				detail = "Display stream could not send to VibeTV and is reconnecting."
				code = "display_send_failed"
			} else if op == "resolve-target" {
				// An unanswered or busy port does not prove that USB was unplugged.
				switch errcode.Code(displayStreamLogValue(line, "cause")) {
				case errcode.TransportNoUSBSerialPorts, errcode.TransportSerialPortNotFound:
					detail = "Display stream could not find VibeTV and is reconnecting."
					code = "device_not_found"
				}
			} else if strings.Contains(line, "cycle timeout:") {
				detail = "Display stream timed out and is reconnecting."
				code = "display_stream_timeout"
			}
			lower := strings.ToLower(line)
			if strings.Contains(lower, "status=401") ||
				strings.Contains(lower, "pairing token required") ||
				strings.Contains(lower, "unauthorized") {
				detail = "VibeTV connection needs attention."
				code = "device_pairing_required"
			}
			return when, detail, code, true
		}
	}
	return time.Time{}, "", "", false
}

func (l displayStreamLog) boundary() (time.Time, bool) {
	if !runtimepaths.DisplayStreamRequiresStartMarker() {
		return time.Time{}, true
	}
	return l.startMarker(displayStreamLaunchAgentLabel())
}

func (l displayStreamLog) startMarker(expectedLabel string) (time.Time, bool) {
	expectedLabel = strings.TrimSpace(expectedLabel)
	if expectedLabel == "" {
		return time.Time{}, false
	}
	var latest time.Time
	for _, lines := range l {
		for _, rawLine := range lines {
			line := strings.TrimSpace(rawLine)
			if !strings.Contains(line, "runtime event=stream-start") || displayStreamLogValue(line, "label") != expectedLabel {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) == 0 {
				continue
			}
			when, err := time.Parse(time.RFC3339Nano, parts[0])
			if err == nil && when.After(latest) {
				latest = when
			}
		}
	}
	return latest, !latest.IsZero()
}

// displayStreamLog holds the lines of the display-stream log tail and of its
// archive, current file first. One request reads and splits them once and
// searches them as often as it needs (status, the 1 s preview poll).
type displayStreamLog [][]string

func readDisplayStreamLog(path string) displayStreamLog {
	var l displayStreamLog
	for _, candidate := range displayStreamLogCandidates(path) {
		data, err := readDisplayStreamLogTail(candidate)
		if err != nil {
			continue
		}
		l = append(l, strings.Split(string(data), "\n"))
	}
	return l
}

func displayStreamLogCandidates(path string) []string {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	return []string{path, runtimepaths.DisplayStreamOutLogArchive(path)}
}

func readDisplayStreamLogTail(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	limit := runtimepaths.DisplayStreamLogTailBytes
	start := info.Size() - limit
	if start < 0 {
		start = 0
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, limit))
	if err != nil {
		return nil, err
	}
	if start > 0 {
		if newline := bytes.IndexByte(data, '\n'); newline >= 0 {
			data = data[newline+1:]
		} else {
			data = nil
		}
	}
	return data, nil
}

func frameFromDisplayStreamLogLine(line string) (protocol.Frame, bool) {
	session, hasSession := intFieldFromDisplayStreamLog(line, "session")
	weekly, hasWeekly := intFieldFromDisplayStreamLog(line, "weekly")
	if !hasSession || !hasWeekly {
		return protocol.Frame{}, false
	}

	frame := protocol.Frame{
		V:                  protocol.ProtocolVersionV1,
		Provider:           displayStreamLogValue(line, "provider"),
		Label:              displayStreamLogValue(line, "label"),
		Session:            session,
		Weekly:             weekly,
		UsageUnavailable:   boolFieldFromDisplayStreamLog(line, "usageUnavailable"),
		SessionUnavailable: boolFieldFromDisplayStreamLog(line, "sessionUnavailable"),
		WeeklyUnavailable:  boolFieldFromDisplayStreamLog(line, "weeklyUnavailable"),
		ResetSource:        displayStreamLogValue(line, "resetSource"),
		ResetTrust:         displayStreamLogValue(line, "resetTrust"),
		UsageMode:          displayStreamLogValue(line, "usageMode"),
		FooterWindow:       displayStreamLogValue(line, "footerWindow"),
		Activity:           displayStreamLogValue(line, "activity"),
		Time:               displayStreamLogValue(line, "time"),
		Date:               displayStreamLogValue(line, "date"),
		Error:              displayStreamLogValue(line, "error"),
	}
	if reset, ok := int64FieldFromDisplayStreamLog(line, "reset"); ok {
		frame.ResetSec = reset
	}
	// Without its budget a trust statement would make the preview stop
	// trusting the frame at once, so the two only count together.
	if trustSecs, ok := int64FieldFromDisplayStreamLog(line, "resetTrustSecs"); ok {
		frame.ResetTrustSec = trustSecs
	} else {
		frame.ResetTrust = ""
	}
	if sessionTokens, ok := int64FieldFromDisplayStreamLog(line, "sessionTokens"); ok {
		frame.SessionTokens = sessionTokens
	}
	if weekTokens, ok := int64FieldFromDisplayStreamLog(line, "weekTokens"); ok {
		frame.WeekTokens = weekTokens
	}
	if totalTokens, ok := int64FieldFromDisplayStreamLog(line, "totalTokens"); ok {
		frame.TotalTokens = totalTokens
	}
	frame.TokenTotalsKnown = boolFieldFromDisplayStreamLog(line, "tokenTotalsKnown")
	if encodedWindows := displayStreamLogValue(line, "usageWindows"); encodedWindows != "" && encodedWindows != "-" {
		if rawWindows, err := url.QueryUnescape(encodedWindows); err == nil {
			_ = json.Unmarshal([]byte(rawWindows), &frame.UsageWindows)
			frame.V = protocol.ProtocolVersionV2
		}
	} else if encodedSlots := displayStreamLogValue(line, "usageSlots"); encodedSlots != "" {
		if rawSlots, err := url.QueryUnescape(encodedSlots); err == nil {
			_ = json.Unmarshal([]byte(rawSlots), &frame.UsageSlots)
			frame.V = protocol.ProtocolVersionV2
		}
	}
	if encodedProviderSlots := displayStreamLogValue(line, "providerSlots"); encodedProviderSlots != "" && encodedProviderSlots != "-" {
		if rawProviderSlots, err := url.QueryUnescape(encodedProviderSlots); err == nil {
			_ = json.Unmarshal([]byte(rawProviderSlots), &frame.ProviderSlots)
			frame.V = protocol.ProtocolVersionV2
		}
	}
	return frame.Normalize(), true
}

func boolFieldFromDisplayStreamLog(line, key string) bool {
	parsed, err := strconv.ParseBool(displayStreamLogValue(line, key))
	return err == nil && parsed
}

func intFieldFromDisplayStreamLog(line, key string) (int, bool) {
	value := strings.TrimSuffix(displayStreamLogValue(line, key), "s")
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func int64FieldFromDisplayStreamLog(line, key string) (int64, bool) {
	value := strings.TrimSuffix(displayStreamLogValue(line, key), "s")
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func displayStreamLogValue(line, key string) string {
	marker := key + "="
	start := strings.Index(line, marker)
	if start < 0 {
		return ""
	}
	start += len(marker)
	rest := line[start:]
	end := len(rest)
	for _, nextKey := range displayStreamLogKeys {
		nextMarker := " " + nextKey + "="
		if idx := strings.Index(rest, nextMarker); idx >= 0 && idx < end {
			end = idx
		}
	}
	return strings.Trim(strings.TrimSpace(rest[:end]), `"`)
}

func displayStreamOutLogPath() string {
	return runtimepaths.DisplayStreamOutLog("")
}

func samePublicTarget(left, right string) bool {
	return publicTarget(left) == publicTarget(right)
}

func displayStreamDiagnosticDetail(stream *displayStreamInfo) string {
	if stream == nil || strings.TrimSpace(stream.Detail) == "" {
		return "Display stream is not ready."
	}
	return stream.Detail
}
