package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/virtualvibetv"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:47834", "Companion HTTP listen address")
	rawAddr := flag.String("raw-addr", "127.0.0.1:8081", "Raw OTA listen address")
	firmware := flag.String("firmware", "1.0.0", "installed firmware version")
	candidate := flag.String("candidate-firmware", "1.0.1", "firmware version after a valid OTA")
	expectedSHA := flag.String("expected-firmware-sha256", "", "optional SHA-256 required for raw OTA uploads")
	scenarios := flag.String("scenario", "healthy", "comma-separated scenarios: "+strings.Join(scenarioNames(), ", "))
	flag.Parse()

	cfg := virtualvibetv.DefaultConfig()
	for _, name := range strings.Split(*scenarios, ",") {
		apply, ok := virtualvibetv.Scenarios[strings.TrimSpace(name)]
		if !ok {
			fmt.Fprintf(os.Stderr, "unknown scenario %q; choose from %s\n", name, strings.Join(scenarioNames(), ", "))
			os.Exit(2)
		}
		apply(&cfg)
	}
	cfg.HTTPListenAddr = strings.TrimSpace(*addr)
	cfg.RawOTAListenAddr = strings.TrimSpace(*rawAddr)
	cfg.Firmware = strings.TrimSpace(*firmware)
	cfg.CandidateFirmware = strings.TrimSpace(*candidate)
	cfg.ExpectedFirmwareSHA256 = strings.TrimSpace(*expectedSHA)
	running, err := virtualvibetv.Start(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "start Virtual VibeTV: %v\n", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	fmt.Printf("Virtual VibeTV HTTP=%s rawOTA=%s firmware=%s candidate=%s\n", running.HTTPURL, running.RawOTAURL, cfg.Firmware, cfg.CandidateFirmware)
	<-ctx.Done()
	if err := running.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "stop Virtual VibeTV: %v\n", err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(running.Snapshot()); err != nil {
		fmt.Fprintf(os.Stderr, "encode Virtual VibeTV snapshot: %v\n", err)
		os.Exit(1)
	}
}

func scenarioNames() []string {
	names := make([]string, 0, len(virtualvibetv.Scenarios))
	for name := range virtualvibetv.Scenarios {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
