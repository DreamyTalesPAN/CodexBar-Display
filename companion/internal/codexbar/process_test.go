package codexbar

import (
	"fmt"
	"os"
	"testing"
	"time"
)

// Re-exec the Go test binary instead of relying on /bin/sh on the host.
func TestMain(m *testing.M) {
	switch os.Getenv("CODEXBAR_TEST_PROCESS") {
	case "config":
		if len(os.Args) > 2 && os.Args[1] == "config" && os.Args[2] == "dump" {
			fmt.Print(`{"version":1,"providers":[{"id":"future-provider","enabled":true}]}`)
		} else if len(os.Args) > 2 && os.Args[1] == "config" && os.Args[2] == "validate" {
			fmt.Print(`[]`)
		} else {
			fmt.Print(os.Getenv("CODEXBAR_CONFIG"))
		}
		os.Exit(0)
	case "cost":
		if len(os.Args) < 3 || os.Args[1] != "cost" || os.Args[2] != "--json" {
			os.Exit(64)
		}
		time.Sleep(2100 * time.Millisecond)
		fmt.Print(`[{"provider":"codex","source":"local","updatedAt":"2026-07-28T09:00:00Z","sessionTokens":120,"last30DaysTokens":240,"totals":{"totalTokens":240}}]`)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func testBinary(t *testing.T) string {
	t.Helper()
	bin, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return bin
}
