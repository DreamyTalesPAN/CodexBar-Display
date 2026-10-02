package motion

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// Read the current user's system preference on every outgoing frame, including
// while the Control Center window is closed. An unset preference is false.
func Reduced(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/bin/defaults", "read", "com.apple.universalaccess", "reduceMotion").Output()
	return err == nil && strings.TrimSpace(string(out)) == "1"
}
