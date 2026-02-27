package buildinfo

import "strings"

// These values are overridden in release builds via -ldflags.
var (
	Version = "1.0.0"
	Commit  = "dev"
	Date    = "unknown"
)

func NormalizedVersion() string {
	v := strings.TrimSpace(Version)
	if v == "" {
		return "0.0.0"
	}
	return v
}
