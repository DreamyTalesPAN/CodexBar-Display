//go:build !darwin && !windows

package systemload

import "errors"

func read() (Figures, error) {
	return Figures{}, errors.New("system load is not read on this system")
}
