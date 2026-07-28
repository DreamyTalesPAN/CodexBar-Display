package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestCommandServesDedicatedRawOTAAndStopsOnSignal(t *testing.T) {
	t.Parallel()
	addr := freeLoopbackAddress(t)
	rawAddr := freeLoopbackAddress(t)
	firmware := []byte("virtual candidate firmware")
	sum := sha256.Sum256(firmware)
	binary := filepath.Join(t.TempDir(), "virtual-vibetv")
	build := exec.Command("go", "build", "-o", binary, ".")
	build.Dir = "."
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build virtual VibeTV command: %v\n%s", err, output)
	}
	command := exec.Command(binary,
		"--addr", addr,
		"--raw-addr", rawAddr,
		"--firmware", "1.0.0",
		"--candidate-firmware", "1.0.1",
		"--expected-firmware-sha256", hex.EncodeToString(sum[:]),
	)
	command.Dir = "."
	var stdout bytes.Buffer
	command.Stdout = &stdout
	if err := command.Start(); err != nil {
		t.Fatalf("start virtual VibeTV command: %v", err)
	}
	finished := false
	t.Cleanup(func() {
		if !finished {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	})

	baseURL := "http://" + addr
	deadline := time.Now().Add(10 * time.Second)
	for {
		response, err := http.Get(baseURL + "/health")
		if err == nil {
			_ = response.Body.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("virtual VibeTV did not become healthy: %v", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	request, err := http.NewRequest(http.MethodPost, "http://"+rawAddr+"/update/firmware.raw", bytes.NewReader(firmware))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-VibeTV-Token", "virtual-pair-token")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("post raw OTA: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("raw OTA status = %s", response.Status)
	}
	if err := command.Process.Signal(os.Interrupt); err != nil {
		t.Fatalf("signal virtual VibeTV: %v", err)
	}
	if err := command.Wait(); err != nil {
		t.Fatalf("graceful virtual VibeTV shutdown: %v", err)
	}
	finished = true
	if !bytes.Contains(stdout.Bytes(), []byte(`"updateUploads":1`)) {
		t.Fatalf("shutdown snapshot has no OTA evidence: %s", stdout.String())
	}
}

func freeLoopbackAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().String()
}
