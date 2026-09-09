// Package childproc hides child-process console windows on Windows.
//
// The Companion runs as a windowless GUI process there, so every CLI or
// PowerShell call would otherwise flash its own console window.
package childproc

import "os/exec"

// Hide marks cmd so that it starts without a console window on Windows.
// It is a no-op on other platforms.
func Hide(cmd *exec.Cmd) *exec.Cmd {
	hide(cmd)
	return cmd
}
