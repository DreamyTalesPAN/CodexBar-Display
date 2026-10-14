package motion

import (
	"context"
	"unsafe"

	"golang.org/x/sys/windows"
)

var systemParametersInfo = windows.NewLazySystemDLL("user32.dll").NewProc("SystemParametersInfoW")

// SPI_GETCLIENTAREAANIMATION is the Windows system animation preference.
// https://learn.microsoft.com/en-us/windows/win32/winauto/client-area-animation
func Reduced(context.Context) bool {
	var enabled int32 = 1
	ok, _, _ := systemParametersInfo.Call(0x1042, 0, uintptr(unsafe.Pointer(&enabled)), 0)
	return ok != 0 && enabled == 0
}
