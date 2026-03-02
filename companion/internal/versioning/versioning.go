package versioning

import (
	"fmt"
	"strconv"
	"strings"
)

type SemVer struct {
	Major      int
	Minor      int
	Patch      int
	PreRelease string
}

func ParseSemVer(raw string) (SemVer, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return SemVer{}, fmt.Errorf("empty version")
	}
	v = strings.TrimPrefix(v, "v")

	if idx := strings.Index(v, "+"); idx >= 0 {
		v = v[:idx]
	}

	pre := ""
	if idx := strings.Index(v, "-"); idx >= 0 {
		pre = strings.TrimSpace(v[idx+1:])
		v = strings.TrimSpace(v[:idx])
	}

	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return SemVer{}, fmt.Errorf("invalid semver %q", raw)
	}

	major, err := strconv.Atoi(parts[0])
	if err != nil || major < 0 {
		return SemVer{}, fmt.Errorf("invalid major version in %q", raw)
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil || minor < 0 {
		return SemVer{}, fmt.Errorf("invalid minor version in %q", raw)
	}
	patch, err := strconv.Atoi(parts[2])
	if err != nil || patch < 0 {
		return SemVer{}, fmt.Errorf("invalid patch version in %q", raw)
	}

	return SemVer{
		Major:      major,
		Minor:      minor,
		Patch:      patch,
		PreRelease: pre,
	}, nil
}

func (v SemVer) String() string {
	base := fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
	if strings.TrimSpace(v.PreRelease) == "" {
		return base
	}
	return base + "-" + v.PreRelease
}

func (v SemVer) Compare(other SemVer) int {
	if v.Major != other.Major {
		if v.Major < other.Major {
			return -1
		}
		return 1
	}
	if v.Minor != other.Minor {
		if v.Minor < other.Minor {
			return -1
		}
		return 1
	}
	if v.Patch != other.Patch {
		if v.Patch < other.Patch {
			return -1
		}
		return 1
	}
	return comparePreRelease(v.PreRelease, other.PreRelease)
}

func comparePreRelease(a, b string) int {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == b {
		return 0
	}
	if a == "" {
		return 1
	}
	if b == "" {
		return -1
	}

	aParts := strings.Split(a, ".")
	bParts := strings.Split(b, ".")
	limit := len(aParts)
	if len(bParts) < limit {
		limit = len(bParts)
	}

	for i := 0; i < limit; i++ {
		left := aParts[i]
		right := bParts[i]
		if left == right {
			continue
		}

		leftNum, leftNumErr := strconv.Atoi(left)
		rightNum, rightNumErr := strconv.Atoi(right)
		switch {
		case leftNumErr == nil && rightNumErr == nil:
			if leftNum < rightNum {
				return -1
			}
			return 1
		case leftNumErr == nil && rightNumErr != nil:
			return -1
		case leftNumErr != nil && rightNumErr == nil:
			return 1
		default:
			if left < right {
				return -1
			}
			return 1
		}
	}

	if len(aParts) < len(bParts) {
		return -1
	}
	return 1
}

type CompatibilityRule struct {
	Name                  string `json:"name"`
	CompanionMin          string `json:"companionMin"`
	CompanionMaxExclusive string `json:"companionMaxExclusive"`
	FirmwareMin           string `json:"firmwareMin"`
	FirmwareMaxExclusive  string `json:"firmwareMaxExclusive"`
	ProtocolVersion       int    `json:"protocolVersion"`
	Notes                 string `json:"notes"`
}

var defaultCompatibilityRules = []CompatibilityRule{
		{
			Name:                  "v1-stable",
			CompanionMin:          "1.0.0",
			CompanionMaxExclusive: "2.0.0",
			FirmwareMin:           "1.0.0",
			FirmwareMaxExclusive:  "2.0.0",
			ProtocolVersion:       1,
			Notes:                 "Companion v1.x supports firmware v1.x on protocol v1.",
		},
	}

func DefaultCompatibilityMatrix() []CompatibilityRule {
	out := make([]CompatibilityRule, len(defaultCompatibilityRules))
	copy(out, defaultCompatibilityRules)
	return out
}

func IsCompatible(companionVersion, firmwareVersion string, protocolVersion int) (bool, string, error) {
	companion, err := ParseSemVer(companionVersion)
	if err != nil {
		return false, "", fmt.Errorf("parse companion version: %w", err)
	}
	firmware, err := ParseSemVer(firmwareVersion)
	if err != nil {
		return false, "", fmt.Errorf("parse firmware version: %w", err)
	}

	for _, rule := range defaultCompatibilityRules {
		if protocolVersion > 0 && rule.ProtocolVersion > 0 && rule.ProtocolVersion != protocolVersion {
			continue
		}

		companionMin, err := ParseSemVer(rule.CompanionMin)
		if err != nil {
			return false, "", fmt.Errorf("parse matrix companion min %q: %w", rule.CompanionMin, err)
		}
		companionMax, err := ParseSemVer(rule.CompanionMaxExclusive)
		if err != nil {
			return false, "", fmt.Errorf("parse matrix companion max %q: %w", rule.CompanionMaxExclusive, err)
		}
		firmwareMin, err := ParseSemVer(rule.FirmwareMin)
		if err != nil {
			return false, "", fmt.Errorf("parse matrix firmware min %q: %w", rule.FirmwareMin, err)
		}
		firmwareMax, err := ParseSemVer(rule.FirmwareMaxExclusive)
		if err != nil {
			return false, "", fmt.Errorf("parse matrix firmware max %q: %w", rule.FirmwareMaxExclusive, err)
		}

		if inRange(companion, companionMin, companionMax) && inRange(firmware, firmwareMin, firmwareMax) {
			return true, rule.Name, nil
		}
	}

	return false, "", nil
}

func inRange(v, min, max SemVer) bool {
	return v.Compare(min) >= 0 && v.Compare(max) < 0
}

var firmwareVersionByEnvironment = map[string]string{
	"lilygo_t_display_s3":    "1.0.0",
	"esp8266_smalltv_st7789": "1.0.0",
}

func FirmwareVersionForEnvironment(env string) (string, bool) {
	key := strings.TrimSpace(strings.ToLower(env))
	if key == "" {
		return "", false
	}
	v, ok := firmwareVersionByEnvironment[key]
	return v, ok
}
