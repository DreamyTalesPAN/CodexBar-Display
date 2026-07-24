package protocol

import "strings"

const (
	FeatureTheme         = "theme"
	FeatureThemeSpecV1   = "theme-spec-v1"
	DefaultMaxFrameBytes = 512
	DefaultMinBrightness = 10
	DefaultMaxBrightness = 100
)

type DisplayBrightnessCapabilities struct {
	Supported  bool `json:"supported,omitempty"`
	MinPercent int  `json:"minPercent,omitempty"`
	MaxPercent int  `json:"maxPercent,omitempty"`
}

type DisplayCapabilities struct {
	WidthPx        int                           `json:"widthPx,omitempty"`
	HeightPx       int                           `json:"heightPx,omitempty"`
	ColorDepthBits int                           `json:"colorDepthBits,omitempty"`
	Brightness     DisplayBrightnessCapabilities `json:"brightness,omitempty"`
}

type ThemeCapabilities struct {
	SupportsThemeSpecV1     bool     `json:"supportsThemeSpecV1,omitempty"`
	SupportsStoredThemes    bool     `json:"supportsStoredThemes,omitempty"`
	MaxThemeSpecBytes       int      `json:"maxThemeSpecBytes,omitempty"`
	MaxStoredThemeSpecBytes int      `json:"maxStoredThemeSpecBytes,omitempty"`
	MaxThemePrimitives      int      `json:"maxThemePrimitives,omitempty"`
	MaxThemeGifAssets       int      `json:"maxThemeGifAssets,omitempty"`
	MaxThemeGifBytes        int      `json:"maxThemeGifBytes,omitempty"`
	MaxThemeGifWidth        int      `json:"maxThemeGifWidth,omitempty"`
	MaxThemeGifHeight       int      `json:"maxThemeGifHeight,omitempty"`
	MaxThemeGifPixels       int      `json:"maxThemeGifPixels,omitempty"`
	MaxThemeGifLzwBits      int      `json:"maxThemeGifLzwBits,omitempty"`
	SupportedPrimitiveTypes []string `json:"supportedPrimitiveTypes,omitempty"`
	BuiltinThemes           []string `json:"builtinThemes,omitempty"`
	CachedThemeID           string   `json:"cachedThemeId,omitempty"`
	CachedThemeRev          int      `json:"cachedThemeRev,omitempty"`
}

type TransportCapabilities struct {
	Active    string   `json:"active,omitempty"`
	Supported []string `json:"supported,omitempty"`
	Mode      string   `json:"mode,omitempty"`
}

type AuthCapabilities struct {
	Paired               bool   `json:"paired"`
	TokenHeader          string `json:"tokenHeader"`
	PairingWindowOpen    bool   `json:"pairingWindowOpen"`
	PairingWindowSeconds uint32 `json:"pairingWindowSeconds"`
}

type CapabilityBlock struct {
	Display   DisplayCapabilities   `json:"display,omitempty"`
	Theme     ThemeCapabilities     `json:"theme,omitempty"`
	Auth      *AuthCapabilities     `json:"auth,omitempty"`
	Transport TransportCapabilities `json:"transport,omitempty"`
}

type DeviceHello struct {
	Kind                      string          `json:"kind,omitempty"`
	ProtocolVersion           int             `json:"protocolVersion,omitempty"`
	SupportedProtocolVersions []int           `json:"supportedProtocolVersions,omitempty"`
	PreferredProtocolVersion  int             `json:"preferredProtocolVersion,omitempty"`
	Board                     string          `json:"board,omitempty"`
	Firmware                  string          `json:"firmware,omitempty"`
	DeviceID                  string          `json:"deviceId,omitempty"`
	NetworkMode               string          `json:"networkMode,omitempty"`
	Features                  []string        `json:"features,omitempty"`
	MaxFrameBytes             int             `json:"maxFrameBytes,omitempty"`
	Capabilities              CapabilityBlock `json:"capabilities,omitempty"`
}

func (h DeviceHello) Normalize() DeviceHello {
	h.Kind = strings.TrimSpace(strings.ToLower(h.Kind))
	h.Board = strings.TrimSpace(strings.ToLower(h.Board))
	h.Firmware = strings.TrimSpace(h.Firmware)
	h.DeviceID = strings.TrimSpace(h.DeviceID)
	h.NetworkMode = strings.TrimSpace(strings.ToLower(h.NetworkMode))
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
	for i := range h.Capabilities.Theme.SupportedPrimitiveTypes {
		h.Capabilities.Theme.SupportedPrimitiveTypes[i] = strings.TrimSpace(strings.ToLower(h.Capabilities.Theme.SupportedPrimitiveTypes[i]))
	}
	h.Capabilities.Theme.CachedThemeID = strings.TrimSpace(h.Capabilities.Theme.CachedThemeID)
	if h.Capabilities.Auth != nil {
		h.Capabilities.Auth.TokenHeader = strings.TrimSpace(h.Capabilities.Auth.TokenHeader)
		if !h.Capabilities.Auth.PairingWindowOpen {
			h.Capabilities.Auth.PairingWindowSeconds = 0
		}
	}
	h.Capabilities.Transport.Active = strings.TrimSpace(strings.ToLower(h.Capabilities.Transport.Active))
	h.Capabilities.Transport.Mode = strings.TrimSpace(strings.ToLower(h.Capabilities.Transport.Mode))
	for i := range h.Capabilities.Transport.Supported {
		h.Capabilities.Transport.Supported[i] = strings.TrimSpace(strings.ToLower(h.Capabilities.Transport.Supported[i]))
	}
	if h.NetworkMode == "" {
		h.NetworkMode = h.Capabilities.Transport.Mode
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
	Firmware                   string
	Features                   []string
	SupportsTheme              bool
	SupportsThemeSpecV1        bool
	SupportsStoredThemes       bool
	MaxFrameBytes              int
	MaxThemeSpecBytes          int
	MaxStoredThemeSpecBytes    int
	MaxThemePrimitives         int
	MaxThemeGifAssets          int
	MaxThemeGifBytes           int
	MaxThemeGifWidth           int
	MaxThemeGifHeight          int
	MaxThemeGifPixels          int
	MaxThemeGifLzwBits         int
	SupportedPrimitiveTypes    []string
	BuiltinThemes              []string
	CachedThemeID              string
	CachedThemeRev             int
	DisplayWidthPx             int
	DisplayHeightPx            int
	DisplayColorDepthBits      int
	SupportsBrightness         bool
	MinBrightnessPercent       int
	MaxBrightnessPercent       int
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
	supportsThemeSpecV1 := h.HasFeature(FeatureThemeSpecV1) || h.Capabilities.Theme.SupportsThemeSpecV1
	supportsStoredThemes := h.Capabilities.Theme.SupportsStoredThemes || h.Capabilities.Theme.MaxStoredThemeSpecBytes > 0
	if !supportsTheme {
		supportsTheme = len(h.Capabilities.Theme.BuiltinThemes) > 0 || supportsThemeSpecV1
	}

	caps := DeviceCapabilities{
		ProtocolVersion:            h.ProtocolVersion,
		SupportedProtocolVersions:  supportedProtocols,
		PreferredProtocolVersion:   h.PreferredProtocolVersion,
		NegotiatedProtocolVersion:  negotiated,
		Board:                      h.Board,
		Firmware:                   h.Firmware,
		Features:                   append([]string(nil), h.Features...),
		SupportsTheme:              supportsTheme,
		SupportsThemeSpecV1:        supportsThemeSpecV1,
		SupportsStoredThemes:       supportsStoredThemes,
		MaxFrameBytes:              h.MaxFrameBytes,
		MaxThemeSpecBytes:          h.Capabilities.Theme.MaxThemeSpecBytes,
		MaxStoredThemeSpecBytes:    h.Capabilities.Theme.MaxStoredThemeSpecBytes,
		MaxThemePrimitives:         h.Capabilities.Theme.MaxThemePrimitives,
		MaxThemeGifAssets:          h.Capabilities.Theme.MaxThemeGifAssets,
		MaxThemeGifBytes:           h.Capabilities.Theme.MaxThemeGifBytes,
		MaxThemeGifWidth:           h.Capabilities.Theme.MaxThemeGifWidth,
		MaxThemeGifHeight:          h.Capabilities.Theme.MaxThemeGifHeight,
		MaxThemeGifPixels:          h.Capabilities.Theme.MaxThemeGifPixels,
		MaxThemeGifLzwBits:         h.Capabilities.Theme.MaxThemeGifLzwBits,
		SupportedPrimitiveTypes:    append([]string(nil), h.Capabilities.Theme.SupportedPrimitiveTypes...),
		BuiltinThemes:              append([]string(nil), h.Capabilities.Theme.BuiltinThemes...),
		CachedThemeID:              h.Capabilities.Theme.CachedThemeID,
		CachedThemeRev:             h.Capabilities.Theme.CachedThemeRev,
		DisplayWidthPx:             h.Capabilities.Display.WidthPx,
		DisplayHeightPx:            h.Capabilities.Display.HeightPx,
		DisplayColorDepthBits:      h.Capabilities.Display.ColorDepthBits,
		SupportsBrightness:         h.Capabilities.Display.Brightness.Supported,
		MinBrightnessPercent:       h.Capabilities.Display.Brightness.MinPercent,
		MaxBrightnessPercent:       h.Capabilities.Display.Brightness.MaxPercent,
		ActiveTransport:            h.Capabilities.Transport.Active,
		SupportedTransportChannels: append([]string(nil), h.Capabilities.Transport.Supported...),
	}
	if caps.SupportsBrightness {
		if caps.MinBrightnessPercent == 0 {
			caps.MinBrightnessPercent = DefaultMinBrightness
		}
		if caps.MaxBrightnessPercent == 0 {
			caps.MaxBrightnessPercent = DefaultMaxBrightness
		}
	}
	if h.Kind == "hello" && (h.Board != "" ||
		h.ProtocolVersion > 0 ||
		len(h.SupportedProtocolVersions) > 0 ||
		len(h.Features) > 0 ||
		h.MaxFrameBytes > 0 ||
		h.Capabilities.Display.WidthPx > 0 ||
		h.Capabilities.Display.HeightPx > 0 ||
		h.Capabilities.Theme.MaxThemeSpecBytes > 0 ||
		h.Capabilities.Theme.MaxStoredThemeSpecBytes > 0 ||
		h.Capabilities.Theme.MaxThemePrimitives > 0 ||
		h.Capabilities.Theme.MaxThemeGifBytes > 0 ||
		h.Capabilities.Theme.MaxThemeGifLzwBits > 0 ||
		h.Capabilities.Theme.CachedThemeRev > 0 ||
		strings.TrimSpace(h.Capabilities.Theme.CachedThemeID) != "" ||
		strings.TrimSpace(h.Capabilities.Transport.Active) != "") {
		caps.Known = true
	}
	return caps
}

// StoredThemeSpecBytesLimit returns the advertised limit for theme specs that
// are uploaded to device storage. Older firmware only advertised the inline
// ThemeSpec limit, so that value remains the compatibility fallback.
func (c DeviceCapabilities) StoredThemeSpecBytesLimit() int {
	if c.MaxStoredThemeSpecBytes > 0 {
		return c.MaxStoredThemeSpecBytes
	}
	return c.MaxThemeSpecBytes
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
