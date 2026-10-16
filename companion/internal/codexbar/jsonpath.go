package codexbar

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func intAtPaths(m map[string]any, paths ...string) int {
	n, _ := intAtPathsWithPresence(m, paths...)
	return n
}

func intAtPathsWithPresence(m map[string]any, paths ...string) (int, bool) {
	for _, path := range paths {
		if v, ok := getPath(m, path); ok {
			if n, ok := anyToInt(v); ok {
				return n, true
			}
		}
	}
	return 0, false
}

func floatAtPaths(m map[string]any, paths ...string) (float64, bool) {
	for _, path := range paths {
		if v, ok := getPath(m, path); ok {
			if n, ok := anyToFloat(v); ok {
				return n, true
			}
		}
	}
	return 0, false
}

func boolAtPaths(m map[string]any, paths ...string) bool {
	for _, path := range paths {
		if v, ok := getPath(m, path); ok {
			if b, ok := anyToBool(v); ok {
				return b
			}
		}
	}
	return false
}

func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := anyToString(m[k]); ok && s != "" {
			return s
		}
	}
	return ""
}

func firstStringAtPaths(m map[string]any, paths ...string) string {
	for _, p := range paths {
		if v, ok := getPath(m, p); ok {
			if s, ok := anyToString(v); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

func firstRFC3339AtPaths(m map[string]any, paths ...string) time.Time {
	raw := firstStringAtPaths(m, paths...)
	if raw == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func usageWindowUnavailable(m map[string]any) bool {
	if usageKnown, exists := anyToBool(m["usageKnown"]); exists && !usageKnown {
		return true
	}
	// CodexBar also uses rate-window objects for informational notices (for
	// example an absent session). Their numeric value is not a quota.
	for _, key := range []string{"isInformational", "is_informational"} {
		if informational, _ := anyToBool(m[key]); informational {
			return true
		}
	}
	return false
}

func knownUsagePercentAtPaths(m map[string]any, paths ...string) (int, bool) {
	if usageWindowUnavailable(m) {
		return 0, false
	}
	for _, path := range paths {
		value, ok := getPath(m, path)
		if !ok {
			continue
		}
		if window, ok := value.(map[string]any); ok {
			if usageWindowUnavailable(window) {
				return 0, false
			}
			for _, key := range []string{"usedPercent", "used_percent", "percent", "usagePercent"} {
				if used, exists := anyToInt(window[key]); exists {
					return clampPercent(used), true
				}
			}
			continue
		}
		if used, ok := anyToInt(value); ok {
			return clampPercent(used), true
		}
	}
	return 0, false
}

func clampPercent(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func getPath(m map[string]any, path string) (any, bool) {
	parts := strings.Split(path, ".")
	cur := any(m)
	for _, p := range parts {
		nextMap, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		next, ok := nextMap[p]
		if !ok {
			return nil, false
		}
		cur = next
	}
	return cur, true
}

func anyToString(v any) (string, bool) {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t), true
	default:
		return "", false
	}
}

func anyToInt(v any) (int, bool) {
	switch t := v.(type) {
	case float64:
		return int(t), true
	case float32:
		return int(t), true
	case int:
		return t, true
	case int64:
		return int(t), true
	case int32:
		return int(t), true
	case json.Number:
		i, err := t.Int64()
		if err != nil {
			return 0, false
		}
		return int(i), true
	case string:
		var n int
		_, err := fmt.Sscanf(strings.TrimSpace(t), "%d", &n)
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

func anyToFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case int32:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return f, err == nil
	default:
		return 0, false
	}
}

func anyToBool(v any) (bool, bool) {
	switch t := v.(type) {
	case bool:
		return t, true
	case string:
		switch strings.TrimSpace(strings.ToLower(t)) {
		case "1", "true", "yes", "on":
			return true, true
		case "0", "false", "no", "off":
			return false, true
		default:
			return false, false
		}
	default:
		return false, false
	}
}
