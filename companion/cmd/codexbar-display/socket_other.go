//go:build !windows

package main

import (
	"errors"
	"syscall"
)

func isAddressInUse(err error) bool { return errors.Is(err, syscall.EADDRINUSE) }
