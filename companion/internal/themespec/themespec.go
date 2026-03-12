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
)

type Primitive struct {
	Type     string `json:"type"`
	X        int    `json:"x,omitempty"`
	Y        int    `json:"y,omitempty"`
	Width    int    `json:"width,omitempty"`
	Height   int    `json:"height,omitempty"`
	Text     string `json:"text,omitempty"`
	FontSize int    `json:"fontSize,omitempty"`
	Color    string `json:"color,omitempty"`
	BgColor  string `json:"bgColor,omitempty"`
}

type Spec struct {
	ThemeSpecVersion int         `json:"themeSpecVersion"`
	ThemeID          string      `json:"themeId"`
	ThemeRev         int         `json:"themeRev"`
	FallbackTheme    string      `json:"fallbackTheme,omitempty"`
	Primitives       []Primitive `json:"primitives"`
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
	spec.ThemeID = strings.TrimSpace(strings.ToLower(spec.ThemeID))
	spec.FallbackTheme = strings.TrimSpace(strings.ToLower(spec.FallbackTheme))
	for i := range spec.Primitives {
		spec.Primitives[i].Type = strings.TrimSpace(strings.ToLower(spec.Primitives[i].Type))
		spec.Primitives[i].Color = strings.TrimSpace(spec.Primitives[i].Color)
		spec.Primitives[i].BgColor = strings.TrimSpace(spec.Primitives[i].BgColor)
	}
	return spec
}

func validatePrimitive(p Primitive) error {
	switch p.Type {
	case "text":
		if strings.TrimSpace(p.Text) == "" {
			return errors.New("text primitive requires non-empty text")
		}
	case "rect", "progress":
		if p.Width <= 0 || p.Height <= 0 {
			return errors.New("rect/progress primitive requires width/height > 0")
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
	return nil
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(candidate)) {
			return true
		}
	}
	return false
}
