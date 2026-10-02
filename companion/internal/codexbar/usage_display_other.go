//go:build !windows

package codexbar

import "errors"

func windowsUsageBarsShowUsed() bool         { return true }
func setWindowsUsageBarsShowUsed(bool) error { return errors.New("windows settings unavailable") }
