package companionapi

import (
	"regexp"
	"strings"
)

// Five of the pinned engine's provider messages embed the account's home
// directory. That is the one private shape evidenced in real output.
var reportedHomePath = regexp.MustCompile(`(?i)/Users/[^/\s)]+`)

// reportedProviderMessage keeps the usage service's sentence intact except for
// the evidenced account-name segment inside a macOS home path.
func reportedProviderMessage(raw string) string {
	message := strings.TrimSpace(raw)
	if message == "" {
		return ""
	}
	return reportedHomePath.ReplaceAllString(message, "~")
}
