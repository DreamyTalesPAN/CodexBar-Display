package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/virtualvibetv"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:47834", "listen address")
	deviceID := flag.String("device-id", "virtual-vibetv-001", "stable virtual device ID")
	firmware := flag.String("firmware", "1.0.0", "installed firmware version")
	candidate := flag.String("candidate-firmware", "1.0.1", "version applied after a valid OTA upload")
	token := flag.String("token", "virtual-pair-token", "pairing token required by write endpoints")
	expectedSHA := flag.String("expected-firmware-sha256", "", "optional SHA-256 required for OTA uploads")
	scenario := flag.String("scenario", "normal", "normal|different-device|never-returns|health-unhealthy|render-fails|stream-restart-fails|accepted-transport-error")
	rebootRequests := flag.Int("reboot-unavailable-requests", 2, "number of requests returning 503 after OTA")
	flag.Parse()

	cfg := virtualvibetv.DefaultConfig()
	cfg.DeviceID = strings.TrimSpace(*deviceID)
	cfg.Firmware = strings.TrimSpace(*firmware)
	cfg.CandidateFirmware = strings.TrimSpace(*candidate)
	cfg.PairingToken = strings.TrimSpace(*token)
	cfg.ExpectedFirmwareSHA256 = strings.TrimSpace(*expectedSHA)
	cfg.RebootUnavailableRequests = *rebootRequests
	switch strings.TrimSpace(*scenario) {
	case "normal":
	case "different-device":
		cfg.DeviceIDAfterUpdate = cfg.DeviceID + "-different"
	case "never-returns":
		cfg.NeverReturnsAfterUpdate = true
	case "health-unhealthy":
		cfg.HealthUnhealthy = true
	case "render-fails":
		cfg.RenderVerificationFails = true
	case "stream-restart-fails":
		cfg.StreamRestartFails = true
	case "accepted-transport-error":
		cfg.DropUpdateResponseAfterAccept = true
	default:
		fmt.Fprintf(os.Stderr, "unknown scenario %q\n", *scenario)
		os.Exit(2)
	}

	device := virtualvibetv.New(cfg)
	server := &http.Server{Addr: *addr, Handler: device, ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	fmt.Printf("Virtual VibeTV listening on http://%s deviceId=%s firmware=%s candidate=%s scenario=%s\n", *addr, cfg.DeviceID, cfg.Firmware, cfg.CandidateFirmware, *scenario)
	err := server.ListenAndServe()
	snapshot := device.Snapshot()
	_ = json.NewEncoder(os.Stdout).Encode(snapshot)
	if err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
