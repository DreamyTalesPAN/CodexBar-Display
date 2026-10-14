//go:build !darwin && !windows

package motion

import "context"

func Reduced(context.Context) bool { return false }
