package themespec

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/theme"
)

const (
	VersionV1 = 1
)

var (
	errInvalidThemeID    = errors.New("themeId must match [a-z0-9-_]{3,64}")
	errUnsupportedColor  = errors.New("color must be empty or #RRGGBB")
	errUnknownPrimitive  = errors.New("primitive type unsupported")
	errMissingPrimitive  = errors.New("at least one primitive is required")
	errUnknownCapability = errors.New("device capabilities unavailable; connect device and retry")
	themeIDPattern       = regexp.MustCompile(`^[a-z0-9][a-z0-9\-_]{2,63}$`)
	colorPattern         = regexp.MustCompile(`^#[A-Fa-f0-9]{6}$`)
	hexPattern           = regexp.MustCompile(`^[A-Fa-f0-9]+$`)
)

type Primitive struct {
	Type         string   `json:"type"`
	ShortType    string   `json:"t,omitempty"`
	X            int      `json:"x,omitempty"`
	Y            int      `json:"y,omitempty"`
	Width        int      `json:"width,omitempty"`
	ShortWidth   int      `json:"w,omitempty"`
	Height       int      `json:"height,omitempty"`
	ShortHeight  int      `json:"h,omitempty"`
	Text         string   `json:"text,omitempty"`
	ShortText    string   `json:"v,omitempty"`
	Binding      string   `json:"binding,omitempty"`
	ShortBinding string   `json:"b,omitempty"`
	FontSize     int      `json:"fontSize,omitempty"`
	ShortSize    int      `json:"s,omitempty"`
	Color        string   `json:"color,omitempty"`
	ShortColor   string   `json:"c,omitempty"`
	BgColor      string   `json:"bgColor,omitempty"`
	ShortBg      string   `json:"bg,omitempty"`
	BorderColor  string   `json:"borderColor,omitempty"`
	ShortBorder  string   `json:"bc,omitempty"`
	AssetPath    string   `json:"assetPath,omitempty"`
	ShortAsset   string   `json:"a,omitempty"`
	Data         string   `json:"data,omitempty"`
	ShortData    string   `json:"d,omitempty"`
	Palette      []string `json:"p,omitempty"`
	Rows         []string `json:"r,omitempty"`
}

type Spec struct {
	ThemeSpecVersion int         `json:"themeSpecVersion"`
	ShortVersion     int         `json:"v,omitempty"`
	ThemeID          string      `json:"themeId"`
	ShortThemeID     string      `json:"id,omitempty"`
	ThemeRev         int         `json:"themeRev"`
	ShortThemeRev    int         `json:"rev,omitempty"`
	FallbackTheme    string      `json:"fallbackTheme,omitempty"`
	ShortFallback    string      `json:"fb,omitempty"`
	Primitives       []Primitive `json:"primitives"`
	ShortPrimitives  []Primitive `json:"p,omitempty"`
}

func Load(path string) (Spec, json.RawMessage, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Spec{}, nil, err
	}

	var spec Spec
	if err := json.Unmarshal(raw, &spec); err != nil {
		return Spec{}, nil, fmt.Errorf("parse theme spec: %w", err)
	}
	spec = normalizeSpec(spec)
	return spec, json.RawMessage(raw), nil
}

func Validate(spec Spec) error {
	spec = normalizeSpec(spec)
	if spec.ThemeSpecVersion != VersionV1 {
		return fmt.Errorf("themeSpecVersion=%d unsupported (expected %d)", spec.ThemeSpecVersion, VersionV1)
	}

	if !themeIDPattern.MatchString(spec.ThemeID) {
		return errInvalidThemeID
	}
	if spec.ThemeRev <= 0 {
		return errors.New("themeRev must be >= 1")
	}
	if spec.FallbackTheme != "" && theme.Normalize(spec.FallbackTheme) == "" {
		return fmt.Errorf("fallbackTheme unsupported: %s", spec.FallbackTheme)
	}

	if len(spec.Primitives) == 0 {
		return errMissingPrimitive
	}

	for i, primitive := range spec.Primitives {
		if err := validatePrimitive(primitive); err != nil {
			return fmt.Errorf("primitives[%d]: %w", i, err)
		}
	}

	return nil
}

func ValidateAgainstCapabilities(spec Spec, raw json.RawMessage, caps protocol.DeviceCapabilities) error {
	if !caps.Known {
		return errUnknownCapability
	}
	if !caps.SupportsThemeSpecV1 {
		return errors.New("device does not advertise theme-spec-v1 support")
	}
	if caps.MaxThemeSpecBytes > 0 && len(raw) > caps.MaxThemeSpecBytes {
		return fmt.Errorf("theme spec payload exceeds device limit: size=%d limit=%d", len(raw), caps.MaxThemeSpecBytes)
	}
	if caps.MaxThemePrimitives > 0 && len(spec.Primitives) > caps.MaxThemePrimitives {
		return fmt.Errorf(
			"theme spec primitive count exceeds device limit: count=%d limit=%d",
			len(spec.Primitives),
			caps.MaxThemePrimitives,
		)
	}
	if spec.FallbackTheme != "" && len(caps.BuiltinThemes) > 0 {
		fallback := theme.Normalize(spec.FallbackTheme)
		if fallback == "" {
			return fmt.Errorf("fallback theme unsupported: %s", spec.FallbackTheme)
		}
		if !containsString(caps.BuiltinThemes, fallback) {
			return fmt.Errorf("fallback theme %q not advertised by device", fallback)
		}
	}
	return nil
}

func normalizeSpec(spec Spec) Spec {
	if spec.ThemeSpecVersion == 0 {
		spec.ThemeSpecVersion = spec.ShortVersion
	}
	if spec.ThemeID == "" {
		spec.ThemeID = spec.ShortThemeID
	}
	if spec.ThemeRev == 0 {
		spec.ThemeRev = spec.ShortThemeRev
	}
	if spec.FallbackTheme == "" {
		spec.FallbackTheme = spec.ShortFallback
	}
	if len(spec.Primitives) == 0 && len(spec.ShortPrimitives) > 0 {
		spec.Primitives = spec.ShortPrimitives
	}
	spec.ThemeID = strings.TrimSpace(strings.ToLower(spec.ThemeID))
	spec.FallbackTheme = strings.TrimSpace(strings.ToLower(spec.FallbackTheme))
	for i := range spec.Primitives {
		spec.Primitives[i] = normalizePrimitive(spec.Primitives[i])
		spec.Primitives[i].Type = strings.TrimSpace(strings.ToLower(spec.Primitives[i].Type))
		spec.Primitives[i].Binding = strings.TrimSpace(spec.Primitives[i].Binding)
		spec.Primitives[i].Color = strings.TrimSpace(spec.Primitives[i].Color)
		spec.Primitives[i].BgColor = strings.TrimSpace(spec.Primitives[i].BgColor)
		spec.Primitives[i].BorderColor = strings.TrimSpace(spec.Primitives[i].BorderColor)
		spec.Primitives[i].AssetPath = strings.TrimSpace(spec.Primitives[i].AssetPath)
		spec.Primitives[i].Data = strings.TrimSpace(spec.Primitives[i].Data)
		for j := range spec.Primitives[i].Palette {
			spec.Primitives[i].Palette[j] = strings.TrimSpace(spec.Primitives[i].Palette[j])
		}
		for j := range spec.Primitives[i].Rows {
			spec.Primitives[i].Rows[j] = strings.TrimSpace(spec.Primitives[i].Rows[j])
		}
	}
	return spec
}

func normalizePrimitive(p Primitive) Primitive {
	if p.Type == "" {
		p.Type = expandPrimitiveType(p.ShortType)
	}
	if p.Width == 0 {
		p.Width = p.ShortWidth
	}
	if p.Height == 0 {
		p.Height = p.ShortHeight
	}
	if p.Text == "" {
		p.Text = p.ShortText
	}
	if p.Binding == "" {
		p.Binding = expandBinding(p.ShortBinding)
	}
	if p.FontSize == 0 {
		p.FontSize = p.ShortSize
	}
	if p.Color == "" {
		p.Color = p.ShortColor
	}
	if p.BgColor == "" {
		p.BgColor = p.ShortBg
	}
	if p.BorderColor == "" {
		p.BorderColor = p.ShortBorder
	}
	if p.AssetPath == "" {
		p.AssetPath = p.ShortAsset
	}
	if p.Data == "" {
		p.Data = p.ShortData
	}
	return p
}

func expandPrimitiveType(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "tx":
		return "text"
	case "r":
		return "rect"
	case "p":
		return "progress"
	case "g":
		return "gif"
	case "sp", "img":
		return "sprite"
	case "px":
		return "pixels"
	default:
		return value
	}
}

func expandBinding(value string) string {
	switch strings.TrimSpace(value) {
	case "l":
		return "label"
	case "pr":
		return "provider"
	case "s":
		return "session"
	case "w":
		return "weekly"
	case "r":
		return "reset"
	case "u":
		return "usageMode"
	case "st":
		return "sessionTokens"
	case "wt":
		return "weekTokens"
	case "tt":
		return "totalTokens"
	default:
		return value
	}
}

func validatePrimitive(p Primitive) error {
	switch p.Type {
	case "text":
		if strings.TrimSpace(p.Text) == "" && strings.TrimSpace(p.Binding) == "" {
			return errors.New("text primitive requires non-empty text or binding")
		}
	case "rect", "progress":
		if p.Width <= 0 || p.Height <= 0 {
			return errors.New("rect/progress primitive requires width/height > 0")
		}
	case "gif":
		if p.Width <= 0 || p.Height <= 0 {
			return errors.New("gif primitive requires width/height > 0")
		}
		if !isSafeThemeAssetPath(p.AssetPath) {
			return errors.New("gif primitive requires assetPath under /themes/")
		}
	case "sprite", "image":
		if !isSafeThemeAssetPath(p.AssetPath) {
			return errors.New("sprite primitive requires assetPath under /themes/")
		}
		if p.Width < 0 || p.Height < 0 {
			return errors.New("sprite primitive width/height must be >= 0")
		}
	case "pixels":
		if p.Width <= 0 || p.Height <= 0 {
			return errors.New("pixels primitive requires width/height > 0")
		}
		if p.Width*p.Height > 1024 {
			return errors.New("pixels primitive must be <= 1024 pixels")
		}
		hasBitmapData := p.Data != ""
		hasRLEData := len(p.Palette) > 0 || len(p.Rows) > 0
		if !hasBitmapData && !hasRLEData {
			return errors.New("pixels primitive requires hex data or palette/RLE rows")
		}
		if hasBitmapData && !isValidBitmapData(p.Data, p.Width, p.Height) {
			return errors.New("pixels primitive requires hex data sized for width/height")
		}
		if hasRLEData && !isValidPaletteRows(p.Palette, p.Rows, p.Width, p.Height) {
			return errors.New("pixels primitive requires palette colors and RLE rows sized for width/height")
		}
	default:
		return fmt.Errorf("%w: %s", errUnknownPrimitive, p.Type)
	}

	if p.X < 0 || p.Y < 0 {
		return errors.New("primitive coordinates must be >= 0")
	}
	if p.FontSize < 0 {
		return errors.New("fontSize must be >= 0")
	}
	if p.Color != "" && !colorPattern.MatchString(p.Color) {
		return errUnsupportedColor
	}
	if p.BgColor != "" && !colorPattern.MatchString(p.BgColor) {
		return errUnsupportedColor
	}
	if p.BorderColor != "" && !colorPattern.MatchString(p.BorderColor) {
		return errUnsupportedColor
	}
	return nil
}

func isValidBitmapData(data string, width, height int) bool {
	if width <= 0 || height <= 0 {
		return false
	}
	expected := ((width*height + 7) / 8) * 2
	return len(data) == expected && hexPattern.MatchString(data)
}

func isValidPaletteRows(palette, rows []string, width, height int) bool {
	if width <= 0 || height <= 0 || len(palette) == 0 || len(palette) > 26 || len(rows) != height {
		return false
	}
	for _, color := range palette {
		if !colorPattern.MatchString(color) {
			return false
		}
	}
	for _, row := range rows {
		if !isValidPaletteRow(row, width, len(palette)) {
			return false
		}
	}
	return true
}

func isValidPaletteRow(row string, width, paletteSize int) bool {
	x := 0
	for i := 0; i < len(row); {
		runLength := 0
		hasRunLength := false
		if row[i] == '0' {
			return false
		}
		for i < len(row) && row[i] >= '0' && row[i] <= '9' {
			hasRunLength = true
			runLength = runLength*10 + int(row[i]-'0')
			if runLength > width {
				return false
			}
			i++
		}
		if i >= len(row) {
			return false
		}
		token := row[i]
		i++
		if !isValidPaletteToken(token, paletteSize) {
			return false
		}
		if !hasRunLength {
			runLength = 1
		}
		if runLength <= 0 {
			return false
		}
		x += runLength
		if x > width {
			return false
		}
	}
	return x == width
}

func isValidPaletteToken(token byte, paletteSize int) bool {
	if token == '.' {
		return true
	}
	return token >= 'a' && token < byte('a'+paletteSize)
}

func isSafeThemeAssetPath(path string) bool {
	path = strings.TrimSpace(path)
	return strings.HasPrefix(path, "/themes/") &&
		!strings.Contains(path, "..") &&
		!strings.Contains(path, "\\") &&
		!strings.HasSuffix(path, "/")
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(candidate)) {
			return true
		}
	}
	return false
}
