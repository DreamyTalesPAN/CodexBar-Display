package systemload

import (
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

var globalMemoryStatusEx = windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")

func read() (Figures, error) {
	status := memoryStatusEx{}
	status.Length = uint32(unsafe.Sizeof(status))
	if ok, _, err := globalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&status))); ok == 0 {
		return Figures{}, err
	}
	return windowsFigures(status, runtime.NumCPU()), nil
}
