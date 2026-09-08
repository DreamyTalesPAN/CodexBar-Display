//go:build !darwin

package codexbar

import (
	"context"
	"errors"
)

func PreparePinnedCLI(context.Context, string, bool) (string, error) {
	return "", errors.New("pinned CLI staging is not supported on this platform")
}
func ValidatePinnedCLI(context.Context, string) (string, error) {
	return "", errors.New("pinned CLI validation is not supported on this platform")
}
