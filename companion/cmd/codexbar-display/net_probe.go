package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// net-probe detects the field failure class proven on hardware 2026-08-08
// (docs/hardware-contract.md, "WiFi PHY mode"): a device whose WiFi receive
// path silently drops TCP frames above one segment while small requests keep
// answering. Any HTTP response — including 400/401 — proves the request body
// was fully delivered, so the probe needs no pairing token and works against
// every firmware version, including released 1.0.39 in the field.

const (
	netProbeSmallBody = 256
	netProbeAttempts  = 2
)

var netProbeStepTimeout = 4 * time.Second

var netProbeLargeBodies = []int{1024, 2048, 6144}

func runNetProbe(args []string) error {
	fs := flag.NewFlagSet("net-probe", flag.ExitOnError)
	target := fs.String("target", "", "device base URL, e.g. http://192.168.178.72")
	if err := fs.Parse(args); err != nil {
		return err
	}
	base := strings.TrimRight(strings.TrimSpace(*target), "/")
	if base == "" {
		return errors.New("net-probe: --target is required, e.g. --target http://192.168.178.72")
	}
	if _, err := url.ParseRequestURI(base); err != nil {
		return fmt.Errorf("net-probe: invalid --target: %w", err)
	}

	ctx := context.Background()
	fmt.Printf("Probing %s ...\n", base)
	printNetProbeWifiHealth(ctx, base)

	if !netProbeBodyDelivered(ctx, base, netProbeSmallBody) {
		return fmt.Errorf(
			"net-probe: VibeTV did not answer a %d-byte request; it is offline, busy, or unreachable — check power and WiFi before drawing conclusions",
			netProbeSmallBody)
	}
	fmt.Printf("  %5d bytes: delivered\n", netProbeSmallBody)

	failed := make([]int, 0, len(netProbeLargeBodies))
	for _, size := range netProbeLargeBodies {
		if netProbeBodyDelivered(ctx, base, size) {
			fmt.Printf("  %5d bytes: delivered\n", size)
		} else {
			fmt.Printf("  %5d bytes: LOST\n", size)
			failed = append(failed, size)
		}
	}

	if len(failed) == 0 {
		fmt.Println("verdict: no large-frame loss right now (the failure is intermittent — a clean pass does not rule it out for later)")
		return nil
	}
	fmt.Println("verdict: LARGE-FRAME BLACK HOLE — small requests answer while larger bodies vanish.")
	fmt.Println("  This matches the 802.11n A-MSDU interop failure (docs/hardware-contract.md).")
	fmt.Println("  Recovery: power-cycle the VibeTV, then retry; update to firmware >= 1.0.40,")
	fmt.Println("  which forces 802.11g and removes the failure class entirely.")
	return errors.New("net-probe: large-frame black hole detected")
}

// netProbeBodyDelivered posts an unparseable JSON body of the given size and
// reports whether the device produced any HTTP response for it. The endpoint
// rejects the body (400/401) without side effects on every firmware version.
func netProbeBodyDelivered(ctx context.Context, base string, size int) bool {
	pad := size - len(`{"pad":""}`)
	if pad < 0 {
		pad = 0
	}
	body := []byte(`{"pad":"` + strings.Repeat("A", pad) + `"}`)
	client := &http.Client{Timeout: netProbeStepTimeout}
	for attempt := 0; attempt < netProbeAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/theme/active", bytes.NewReader(body))
		if err != nil {
			return false
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err == nil {
			resp.Body.Close()
			return true
		}
	}
	return false
}

func printNetProbeWifiHealth(ctx context.Context, base string) {
	client := &http.Client{Timeout: netProbeStepTimeout}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/health", nil)
	if err != nil {
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	var payload struct {
		Firmware string `json:"firmware"`
		WiFi     *struct {
			RSSI      int    `json:"rssi"`
			Channel   int    `json:"channel"`
			PhyMode   string `json:"phyMode"`
			SleepMode string `json:"sleepMode"`
		} `json:"wifi"`
	}
	if json.NewDecoder(resp.Body).Decode(&payload) != nil {
		return
	}
	if payload.WiFi != nil {
		fmt.Printf("  firmware %s, rssi %d dBm, channel %d, phy %s, sleep %s\n",
			payload.Firmware, payload.WiFi.RSSI, payload.WiFi.Channel,
			payload.WiFi.PhyMode, payload.WiFi.SleepMode)
	} else if payload.Firmware != "" {
		fmt.Printf("  firmware %s (no wifi block in /health — firmware < 1.0.40)\n", payload.Firmware)
	}
}
