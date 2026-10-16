package systemload

import (
	"encoding/binary"
	"errors"
	"testing"
)

func darwinReaders(level, pressure uint32, memsize, swapUsed uint64, load uint32) (
	func(string) (uint32, error),
	func(string, ...int) (uint64, error),
	func(string, ...int) ([]byte, error),
) {
	readUint32 := func(name string) (uint32, error) {
		switch name {
		case "kern.memorystatus_level":
			return level, nil
		case "kern.memorystatus_vm_pressure_level":
			return pressure, nil
		}
		return 0, errors.New("unknown " + name)
	}
	readUint64 := func(name string, _ ...int) (uint64, error) {
		if name == "hw.memsize" {
			return memsize, nil
		}
		return 0, errors.New("unknown " + name)
	}
	readRaw := func(name string, _ ...int) ([]byte, error) {
		raw := make([]byte, 32)
		switch name {
		case "vm.swapusage":
			binary.LittleEndian.PutUint64(raw[16:24], swapUsed)
		case "vm.loadavg":
			binary.LittleEndian.PutUint32(raw[0:4], load)
			binary.LittleEndian.PutUint64(raw[16:24], 2048)
		default:
			return nil, errors.New("unknown " + name)
		}
		return raw, nil
	}
	return readUint32, readUint64, readRaw
}

const gb = 1 << 30

func TestDarwinFigures(t *testing.T) {
	tests := []struct {
		name     string
		level    uint32
		pressure uint32
		swapUsed uint64
		load     uint32
		starved  bool
		summary  string
	}{
		// A normal Mac, even with every core busy from a build.
		{name: "idle", level: 82, pressure: 1, load: 5 * 2048, summary: "mem82.normal.load5"},
		{name: "heavy build", level: 45, pressure: 1, swapUsed: 2 * gb, load: 40 * 2048, summary: "mem45.normal.swap2048mb.load40"},
		// The kernel's own verdict.
		{name: "pressure warn", level: 30, pressure: 2, starved: true, summary: "mem30.warn"},
		{name: "pressure critical", level: 30, pressure: 4, starved: true, summary: "mem30.critical"},
		{name: "little memory left", level: 8, pressure: 1, starved: true, summary: "mem8.normal"},
		// Paul's Mac on 2026-10-14: 24 GB, swap 22.5 GB, load 214.
		{name: "swap half the memory", level: 40, pressure: 1, swapUsed: 22*gb + gb/2, load: 214 * 2048, starved: true, summary: "mem40.normal.swap23040mb.load214"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			f, err := darwinFigures(darwinReaders(test.level, test.pressure, 24*gb, test.swapUsed, test.load))
			if err != nil {
				t.Fatal(err)
			}
			if f.MemoryTotalMB != 24576 {
				t.Fatalf("memory total = %d", f.MemoryTotalMB)
			}
			if got := f.Starved(); got != test.starved {
				t.Fatalf("starved = %v, want %v (%+v)", got, test.starved, f)
			}
			if got := f.Summary(); got != test.summary {
				t.Fatalf("summary = %q, want %q", got, test.summary)
			}
		})
	}
}

func TestDarwinFiguresNeedMemoryReadings(t *testing.T) {
	_, readUint64, readRaw := darwinReaders(0, 0, 24*gb, 0, 0)
	failing := func(string) (uint32, error) { return 0, errors.New("no sysctl") }
	if _, err := darwinFigures(failing, readUint64, readRaw); err == nil {
		t.Fatal("figures without the memory level must be an error, not a healthy computer")
	}
}

func TestWindowsFigures(t *testing.T) {
	tests := []struct {
		name       string
		memoryLoad uint32
		commitUsed uint64
		starved    bool
		summary    string
	}{
		{name: "normal", memoryLoad: 60, commitUsed: 14 * gb, summary: "mem40.commit43"},
		{name: "little memory left", memoryLoad: 93, commitUsed: 20 * gb, starved: true, summary: "mem7.commit62"},
		{name: "commit charge at the limit", memoryLoad: 85, commitUsed: 30 * gb, starved: true, summary: "mem15.commit93"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			f := windowsFigures(memoryStatusEx{
				MemoryLoad:    test.memoryLoad,
				TotalPhys:     16 * gb,
				TotalPageFile: 32 * gb,
				AvailPageFile: 32*gb - test.commitUsed,
			}, 8)
			if got := f.Starved(); got != test.starved {
				t.Fatalf("starved = %v, want %v (%+v)", got, test.starved, f)
			}
			if got := f.Summary(); got != test.summary {
				t.Fatalf("summary = %q, want %q", got, test.summary)
			}
		})
	}
}

func TestReadTestOverride(t *testing.T) {
	t.Setenv(testStarvedEnvVar, "1")
	f, err := Read()
	if err != nil || !f.Starved() || f.Summary() != "mem0.test" {
		t.Fatalf("Read() = %+v, %v", f, err)
	}
}
