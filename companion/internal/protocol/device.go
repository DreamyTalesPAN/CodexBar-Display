package protocol

import "strings"

const (
	FeatureTheme         = "theme"
	FeatureThemeSpecV1   = "theme-spec-v1"
	DefaultMaxFrameBytes = 512
)

type DisplayCapabilities struct {
	WidthPx        int `json:"widthPx,omitempty"`
	HeightPx       int `json:"heightPx,omitempty"`
	ColorDepthBits int `json:"colorDepthBits,omitempty"`
}

type ThemeCapabilities struct {
	SupportsThemeSpecV1 bool     `json:"supportsThemeSpecV1,omitempty"`
	MaxThemeSpecBytes   int      `json:"maxThemeSpecBytes,omitempty"`
	MaxThemePrimitives  int      `json:"maxThemePrimitives,omitempty"`
	BuiltinThemes       []string `json:"builtinThemes,omitempty"`
	CachedThemeID       string   `json:"cachedThemeId,omitempty"`
	CachedThemeRev      int      `json:"cachedThemeRev,omitempty"`
}

type TransportCapabilities struct {
	Active    string   `json:"active,omitempty"`
	Supported []string `json:"supported,omitempty"`
}

type CapabilityBlock struct {
	Display   DisplayCapabilities   `json:"display,omitempty"`
	Theme     ThemeCapabilities     `json:"theme,omitempty"`
	Transport TransportCapabilities `json:"transport,omitempty"`
}

type DeviceHello struct {
	Kind                      string          `json:"kind,omitempty"`
	ProtocolVersion           int             `json:"protocolVersion,omitempty"`
	SupportedProtocolVersions []int           `json:"supportedProtocolVersions,omitempty"`
	PreferredProtocolVersion  int             `json:"preferredProtocolVersion,omitempty"`
	Board                     string          `json:"board,omitempty"`
	Firmware                  string          `json:"firmware,omitempty"`
	Features                  []string        `json:"features,omitempty"`
	MaxFrameBytes             int             `json:"maxFrameBytes,omitempty"`
	Capabilities              CapabilityBlock `json:"capabilities,omitempty"`
}

func (h DeviceHello) Normalize() DeviceHello {
	h.Kind = strings.TrimSpace(strings.ToLower(h.Kind))
	h.Board = strings.TrimSpace(strings.ToLower(h.Board))
	h.Firmware = strings.TrimSpace(h.Firmware)
	h.SupportedProtocolVersions = normalizeProtocolVersions(h.SupportedProtocolVersions)
	if h.PreferredProtocolVersion > 0 && !containsProtocolVersion(h.SupportedProtocolVersions, h.PreferredProtocolVersion) {
		h.PreferredProtocolVersion = 0
	}
	for i := range h.Features {
		h.Features[i] = strings.TrimSpace(strings.ToLower(h.Features[i]))
	}
	for i := range h.Capabilities.Theme.BuiltinThemes {
		h.Capabilities.Theme.BuiltinThemes[i] = strings.TrimSpace(strings.ToLower(h.Capabilities.Theme.BuiltinThemes[i]))
	}
	h.Capabilities.Theme.CachedThemeID = strings.TrimSpace(h.Capabilities.Theme.CachedThemeID)
	h.Capabilities.Transport.Active = strings.TrimSpace(strings.ToLower(h.Capabilities.Transport.Active))
	for i := range h.Capabilities.Transport.Supported {
		h.Capabilities.Transport.Supported[i] = strings.TrimSpace(strings.ToLower(h.Capabilities.Transport.Supported[i]))
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
	Known                      bool
	ProtocolVersion            int
	SupportedProtocolVersions  []int
	PreferredProtocolVersion   int
	NegotiatedProtocolVersion  int
	Board                      string
	Features                   []string
	SupportsTheme              bool
	SupportsThemeSpecV1        bool
	MaxFrameBytes              int
	MaxThemeSpecBytes          int
	MaxThemePrimitives         int
	BuiltinThemes              []string
	CachedThemeID              string
	CachedThemeRev             int
	DisplayWidthPx             int
	DisplayHeightPx            int
	DisplayColorDepthBits      int
	ActiveTransport            string
	SupportedTransportChannels []string
}

func UnknownDeviceCapabilities() DeviceCapabilities {
	return DeviceCapabilities{
		NegotiatedProtocolVersion: ProtocolVersionV1,
	}
}

func CapabilitiesFromHello(raw DeviceHello) DeviceCapabilities {
	h := raw.Normalize()
	supportedProtocols := append([]int(nil), h.SupportedProtocolVersions...)
	if len(supportedProtocols) == 0 && h.ProtocolVersion > 0 {
		supportedProtocols = append(supportedProtocols, h.ProtocolVersion)
	}

	negotiated := NegotiateProtocolVersion(supportedProtocols, h.PreferredProtocolVersion, h.ProtocolVersion)
	supportsTheme := h.HasFeature(FeatureTheme)
	if !supportsTheme {
		supportsTheme = len(h.Capabilities.Theme.BuiltinThemes) > 0
	}
	supportsThemeSpecV1 := h.HasFeature(FeatureThemeSpecV1) || h.Capabilities.Theme.SupportsThemeSpecV1

	caps := DeviceCapabilities{
		ProtocolVersion:            h.ProtocolVersion,
		SupportedProtocolVersions:  supportedProtocols,
		PreferredProtocolVersion:   h.PreferredProtocolVersion,
		NegotiatedProtocolVersion:  negotiated,
		Board:                      h.Board,
		Features:                   append([]string(nil), h.Features...),
		SupportsTheme:              supportsTheme,
		SupportsThemeSpecV1:        supportsThemeSpecV1,
		MaxFrameBytes:              h.MaxFrameBytes,
		MaxThemeSpecBytes:          h.Capabilities.Theme.MaxThemeSpecBytes,
		MaxThemePrimitives:         h.Capabilities.Theme.MaxThemePrimitives,
		BuiltinThemes:              append([]string(nil), h.Capabilities.Theme.BuiltinThemes...),
		CachedThemeID:              h.Capabilities.Theme.CachedThemeID,
		CachedThemeRev:             h.Capabilities.Theme.CachedThemeRev,
		DisplayWidthPx:             h.Capabilities.Display.WidthPx,
		DisplayHeightPx:            h.Capabilities.Display.HeightPx,
		DisplayColorDepthBits:      h.Capabilities.Display.ColorDepthBits,
		ActiveTransport:            h.Capabilities.Transport.Active,
		SupportedTransportChannels: append([]string(nil), h.Capabilities.Transport.Supported...),
	}
	if h.Kind == "hello" && (h.Board != "" ||
		h.ProtocolVersion > 0 ||
		len(h.SupportedProtocolVersions) > 0 ||
		len(h.Features) > 0 ||
		h.MaxFrameBytes > 0 ||
		h.Capabilities.Display.WidthPx > 0 ||
		h.Capabilities.Display.HeightPx > 0 ||
		h.Capabilities.Theme.MaxThemeSpecBytes > 0 ||
		h.Capabilities.Theme.MaxThemePrimitives > 0 ||
		h.Capabilities.Theme.CachedThemeRev > 0 ||
		strings.TrimSpace(h.Capabilities.Theme.CachedThemeID) != "" ||
		strings.TrimSpace(h.Capabilities.Transport.Active) != "") {
		caps.Known = true
	}
	return caps
}

func normalizeProtocolVersions(raw []int) []int {
	if len(raw) == 0 {
		return nil
	}
	out := make([]int, 0, len(raw))
	seen := make(map[int]struct{}, len(raw))
	for _, candidate := range raw {
		if !IsSupportedProtocolVersion(candidate) {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		out = append(out, candidate)
	}
	return out
}

func containsProtocolVersion(versions []int, version int) bool {
	for _, candidate := range versions {
		if candidate == version {
			return true
		}
	}
	return false
}
