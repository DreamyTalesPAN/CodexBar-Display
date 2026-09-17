//go:build !windows

package childproc

import "os/exec"

func hide(*exec.Cmd) {}

func newConsole(*exec.Cmd) {}
