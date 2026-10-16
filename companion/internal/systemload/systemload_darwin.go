package systemload

import "golang.org/x/sys/unix"

func read() (Figures, error) {
	return darwinFigures(unix.SysctlUint32, unix.SysctlUint64, unix.SysctlRaw)
}
