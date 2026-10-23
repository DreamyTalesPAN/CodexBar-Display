package companionapi

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
	serial "go.bug.st/serial"
)

func TestCablePairingPersistsComputerKeyAndAuthenticatesWiFi(t *testing.T) {
	const proposed = "00112233445566778899aabbccddeeff"
	for _, existing := range []string{"", "legacy-key-kept-on-device"} {
		t.Run(existing, func(t *testing.T) {
			key, _ := hex.DecodeString(proposed)
			random := bytes.NewReader(key)
			port := &pairingKeyPort{stored: existing}
			sender := usb.NewSenderWithConfig(usb.SenderConfig{
				Random: random, Opener: pairingKeyOpener{port}, HelloWindow: 10 * time.Millisecond,
			})
			defer sender.Close()
			server := newTestServer(t, runtimeconfig.Config{ConnectionMode: "cable"})
			// Exercise the real disk store instead of newTestServer's in-memory fake.
			server.loadConfig, server.saveConfig = runtimeconfig.Load, runtimeconfig.Save
			if err := runtimeconfig.Save(server.home, runtimeconfig.Config{ConnectionMode: "cable"}); err != nil {
				t.Fatal(err)
			}
			server.resolveCablePort = func(string, string) (string, error) { return "/dev/mock", nil }
			server.readCableHello = func(string) (protocol.DeviceHello, error) {
				return protocol.DeviceHello{
					Kind: "hello", DeviceID: "paired-device", Board: "esp8266-smalltv-st7789",
					Capabilities: protocol.CapabilityBlock{
						Auth:      &protocol.AuthCapabilities{Paired: existing != ""},
						Transport: protocol.TransportCapabilities{Active: "usb", Mode: "cable", Supported: []string{"usb", "wifi"}},
					},
				}, nil
			}
			server.pairCableDevice = sender.PairDevice
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/v1/setup/connection-mode", strings.NewReader(`{"mode":"cable"}`))
			req.Header.Set("Content-Type", "application/json")
			server.Handler().ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("pair: %d %s", rec.Code, rec.Body.String())
			}
			if port.proposed != proposed || random.Len() != 0 {
				t.Fatal("USB pair did not send the 16 injected random bytes")
			}
			want := proposed
			if existing != "" {
				want = existing
			}
			cfg, err := runtimeconfig.Load(server.home)
			if err != nil {
				t.Fatal(err)
			}
			known, ok := cfg.KnownDevice("paired-device")
			if cfg.DeviceToken != want || !ok || known.DeviceToken != want || port.stored != want {
				t.Fatal("pairing did not persist the acknowledged key in both device profiles")
			}
			if strings.Contains(rec.Body.String(), want) {
				t.Fatal("pairing API leaked the key")
			}
			writes := 0
			device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/frame" || r.Header.Get("X-VibeTV-Token") != port.stored {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				writes++
				w.WriteHeader(http.StatusNoContent)
			}))
			defer device.Close()
			// A fresh config read after setup supplies the key to the normal WiFi writer.
			if err := server.doJSON(context.Background(), http.MethodPost, device.URL, "/frame", cfg.DeviceToken, map[string]any{"v": 2}, nil); err != nil {
				t.Fatal(err)
			}
			if writes != 1 {
				t.Fatal("stored key did not authorize the display write")
			}
		})
	}
}

type pairingKeyOpener struct{ port usb.SerialPort }

func (o pairingKeyOpener) Open(string, *serial.Mode) (usb.SerialPort, error) { return o.port, nil }

type pairingKeyPort struct {
	usb.SerialPort
	reply            *bytes.Reader
	proposed, stored string
}

func (p *pairingKeyPort) Write(data []byte) (int, error) {
	var req struct{ Kind, Op, DeviceID, Token string }
	if err := json.Unmarshal(data, &req); err != nil {
		return 0, err
	}
	key, err := hex.DecodeString(req.Token)
	if err != nil || len(key) != 16 || req.Op != "pair" || req.DeviceID != "paired-device" {
		return 0, errors.New("pair request needs the host key and exact identity")
	}
	p.proposed = req.Token
	if p.stored == "" {
		p.stored = req.Token
	}
	reply, _ := json.Marshal(map[string]string{"kind": "pairing", "status": "paired", "deviceId": req.DeviceID, "token": p.stored})
	p.reply = bytes.NewReader(append(reply, '\n'))
	return len(data), nil
}
func (p *pairingKeyPort) Read(data []byte) (int, error)    { return p.reply.Read(data) }
func (*pairingKeyPort) ResetInputBuffer() error            { return nil }
func (*pairingKeyPort) SetReadTimeout(time.Duration) error { return nil }
func (*pairingKeyPort) SetDTR(bool) error                  { return nil }
func (*pairingKeyPort) SetRTS(bool) error                  { return nil }
func (*pairingKeyPort) Close() error                       { return nil }
