// Package systemload reads how starved this computer is for memory, cheaply
// and without starting a process (issue #606). The runtime only asks once its
// usage engine has stopped answering, to tell a starved computer from every
// other reason usage can be missing.
package systemload

import (
	"encoding/binary"
	"fmt"
	"os"
	"runtime"
	"strings"
)

// testStarvedEnvVar makes Read report a starved computer, so the bench can
// show the customer's dialog and VibeTV's label without exhausting the
// memory of a shared machine. The usage engine must still stop answering.
const testStarvedEnvVar = "CODEXBAR_DISPLAY_TEST_STARVED_SYSTEM"

// Figures is what the operating system reports. A field the system has no
// reading for stays zero and is left out of JSON.
type Figures struct {
	// MemoryAvailablePercent is the share of physical memory still free for
	// apps: macOS kern.memorystatus_level, Windows 100 - dwMemoryLoad.
	MemoryAvailablePercent int `json:"memoryAvailablePercent"`
	// MemoryPressure is the macOS kernel's own verdict: normal, warn, critical.
	MemoryPressure string `json:"memoryPressure,omitempty"`
	MemoryTotalMB  int64  `json:"memoryTotalMB,omitempty"`
	SwapUsedMB     int64  `json:"swapUsedMB,omitempty"`
	// CommitUsedMB and CommitLimitMB are the Windows commit charge and limit.
	CommitUsedMB  int64   `json:"commitUsedMB,omitempty"`
	CommitLimitMB int64   `json:"commitLimitMB,omitempty"`
	Load1         float64 `json:"load1,omitempty"`
	CPUs          int     `json:"cpus,omitempty"`
	// Test marks figures forced by testStarvedEnvVar.
	Test bool `json:"test,omitempty"`
}

// Starved is true when the computer is low on memory, the only cause the
// customer is told about. Load alone does not count: a heavy build keeps all
// cores busy and still leaves the usage engine the memory it needs.
func (f Figures) Starved() bool {
	if f.Test {
		return true
	}
	switch f.MemoryPressure {
	case "warn", "critical":
		return true
	}
	if f.MemoryTotalMB > 0 && f.MemoryAvailablePercent <= 10 {
		return true
	}
	// macOS grows its swap on demand: swap the size of half the memory is
	// a computer that has been paging for a long time.
	if f.MemoryTotalMB > 0 && f.SwapUsedMB >= f.MemoryTotalMB/2 {
		return true
	}
	return f.CommitLimitMB > 0 && f.CommitUsedMB*10 >= f.CommitLimitMB*9
}

// Summary is the figures as one timeline field: short, no spaces.
func (f Figures) Summary() string {
	parts := []string{fmt.Sprintf("mem%d", f.MemoryAvailablePercent)}
	if f.MemoryPressure != "" {
		parts = append(parts, f.MemoryPressure)
	}
	if f.SwapUsedMB > 0 {
		parts = append(parts, fmt.Sprintf("swap%dmb", f.SwapUsedMB))
	}
	if f.CommitLimitMB > 0 {
		parts = append(parts, fmt.Sprintf("commit%d", f.CommitUsedMB*100/f.CommitLimitMB))
	}
	if f.Load1 > 0 {
		parts = append(parts, fmt.Sprintf("load%.0f", f.Load1))
	}
	if f.Test {
		parts = append(parts, "test")
	}
	return strings.Join(parts, ".")
}

// Read returns this computer's figures.
func Read() (Figures, error) {
	if os.Getenv(testStarvedEnvVar) == "1" {
		return Figures{Test: true}, nil
	}
	return read()
}

func megabytes(bytes uint64) int64 {
	return int64(bytes / (1 << 20))
}

// darwinFigures converts the macOS sysctl readings. It takes the readers as
// arguments, so the conversion is tested on every system.
func darwinFigures(
	readUint32 func(string) (uint32, error),
	readUint64 func(string, ...int) (uint64, error),
	readRaw func(string, ...int) ([]byte, error),
) (Figures, error) {
	f := Figures{CPUs: runtime.NumCPU()}
	memsize, err := readUint64("hw.memsize")
	if err != nil {
		return Figures{}, err
	}
	f.MemoryTotalMB = megabytes(memsize)
	level, err := readUint32("kern.memorystatus_level")
	if err != nil {
		return Figures{}, err
	}
	f.MemoryAvailablePercent = int(level)
	// kern.memorystatus_vm_pressure_level: 1 normal, 2 warn, 4 critical.
	if pressure, err := readUint32("kern.memorystatus_vm_pressure_level"); err == nil {
		switch pressure {
		case 1:
			f.MemoryPressure = "normal"
		case 2:
			f.MemoryPressure = "warn"
		case 4:
			f.MemoryPressure = "critical"
		}
	}
	// struct xsw_usage { u_int64_t xsu_total, xsu_avail, xsu_used; ... }
	if raw, err := readRaw("vm.swapusage"); err == nil && len(raw) >= 24 {
		f.SwapUsedMB = megabytes(binary.LittleEndian.Uint64(raw[16:24]))
	}
	// struct loadavg { fixpt_t ldavg[3]; long fscale; }
	if raw, err := readRaw("vm.loadavg"); err == nil && len(raw) >= 24 {
		if scale := binary.LittleEndian.Uint64(raw[16:24]); scale > 0 {
			f.Load1 = float64(binary.LittleEndian.Uint32(raw[0:4])) / float64(scale)
		}
	}
	return f, nil
}

// memoryStatusEx is the Windows MEMORYSTATUSEX structure.
type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

// windowsFigures converts what GlobalMemoryStatusEx reported. The page file
// totals are the commit limit and what is left of it.
func windowsFigures(status memoryStatusEx, cpus int) Figures {
	return Figures{
		MemoryAvailablePercent: 100 - int(status.MemoryLoad),
		MemoryTotalMB:          megabytes(status.TotalPhys),
		CommitUsedMB:           megabytes(status.TotalPageFile - status.AvailPageFile),
		CommitLimitMB:          megabytes(status.TotalPageFile),
		CPUs:                   cpus,
	}
}
