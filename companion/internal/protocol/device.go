package protocol

import "strings"

const (
	FeatureTheme         = "theme"
	DefaultMaxFrameBytes = 512
)

type DeviceHello struct {
	Kind            string   `json:"kind,omitempty"`
	ProtocolVersion int      `json:"protocolVersion,omitempty"`
	Board           string   `json:"board,omitempty"`
	Firmware        string   `json:"firmware,omitempty"`
	Features        []string `json:"features,omitempty"`
	MaxFrameBytes   int      `json:"maxFrameBytes,omitempty"`
}

func (h DeviceHello) Normalize() DeviceHello {
	h.Kind = strings.TrimSpace(strings.ToLower(h.Kind))
	h.Board = strings.TrimSpace(strings.ToLower(h.Board))
	h.Firmware = strings.TrimSpace(h.Firmware)
	for i := range h.Features {
		h.Features[i] = strings.TrimSpace(strings.ToLower(h.Features[i]))
	}
	return h
}

func (h DeviceHello) HasFeature(feature string) bool {
	feature = strings.TrimSpace(strings.ToLower(feature))
	if feature == "" {
		return false
	}
	for _, f := range h.Features {
		if strings.TrimSpace(strings.ToLower(f)) == feature {
			return true
		}
	}
	return false
}

type DeviceCapabilities struct {
	Known           bool
	ProtocolVersion int
	Board           string
	Features        []string
	SupportsTheme   bool
	MaxFrameBytes   int
}

func UnknownDeviceCapabilities() DeviceCapabilities {
	return DeviceCapabilities{}
}

func CapabilitiesFromHello(raw DeviceHello) DeviceCapabilities {
	h := raw.Normalize()
	caps := DeviceCapabilities{
		ProtocolVersion: h.ProtocolVersion,
		Board:           h.Board,
		Features:        append([]string(nil), h.Features...),
		SupportsTheme:   h.HasFeature(FeatureTheme),
		MaxFrameBytes:   h.MaxFrameBytes,
	}
	if h.Kind == "hello" && (h.Board != "" || h.ProtocolVersion > 0 || len(h.Features) > 0 || h.MaxFrameBytes > 0) {
		caps.Known = true
	}
	return caps
}
