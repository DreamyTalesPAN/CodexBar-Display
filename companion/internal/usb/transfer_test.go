package usb

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	serial "go.bug.st/serial"
)

func TestSenderTransfersAssetWithOneAcknowledgedChunkInFlight(t *testing.T) {
	payload := make([]byte, cableTransferChunkBytes+3)
	for i := range payload {
		payload[i] = byte(i)
	}
	digest := md5.Sum(payload)
	digestHex := hex.EncodeToString(digest[:])
	transferID := digestHex[:16]
	port := newMockSerialPort()
	port.readQueue = [][]byte{
		[]byte(`{"kind":"transfer","id":"` + transferID + `","status":"ready","next":0}` + "\n"),
		[]byte(`{"kind":"transfer","id":"` + transferID + `","status":"chunk","next":1}` + "\n"),
		[]byte(`{"kind":"transfer","id":"` + transferID + `","status":"chunk","next":2}` + "\n"),
		[]byte(`{"kind":"transfer","id":"` + transferID + `","status":"complete","next":2}` + "\n"),
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})

	if err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkAsset, "/themes/u/test.cba", "theme", payload, TransferOptions{}); err != nil {
		t.Fatalf("transfer asset: %v", err)
	}
	if len(port.writePayloads) != 4 {
		t.Fatalf("writes=%d want=4", len(port.writePayloads))
	}
	var start struct {
		Op       string       `json:"op"`
		DeviceID string       `json:"deviceId"`
		Token    string       `json:"token"`
		Sink     TransferSink `json:"sink"`
		Path     string       `json:"path"`
		Activate string       `json:"activate"`
		Bytes    int          `json:"bytes"`
		Hash     string       `json:"hash"`
	}
	if err := json.Unmarshal(port.writePayloads[0], &start); err != nil {
		t.Fatal(err)
	}
	if start.Op != "transfer-start" || start.DeviceID != "14799300" || start.Token != "paired-token" ||
		start.Sink != TransferSinkAsset || start.Path != "/themes/u/test.cba" || start.Activate != "theme" ||
		start.Bytes != len(payload) || start.Hash != digestHex {
		t.Fatalf("unexpected start request %+v", start)
	}
	for index, want := range [][]byte{payload[:cableTransferChunkBytes], payload[cableTransferChunkBytes:]} {
		var chunk struct {
			Op       string `json:"op"`
			Seq      int    `json:"seq"`
			Data     string `json:"data"`
			Checksum string `json:"checksum"`
		}
		if err := json.Unmarshal(port.writePayloads[index+1], &chunk); err != nil {
			t.Fatal(err)
		}
		decoded, err := hex.DecodeString(chunk.Data)
		if err != nil {
			t.Fatal(err)
		}
		if chunk.Op != "transfer-chunk" || chunk.Seq != index ||
			string(decoded) != string(want) || chunk.Checksum != chunkChecksum(want) {
			t.Fatalf("unexpected chunk %d: %+v bytes=%v", index, chunk, decoded)
		}
	}
}

func TestSenderFastFirmwareTransferUsesLargeBase64ChunksAtHigherBaud(t *testing.T) {
	payload := make([]byte, cableTransferFastChunkBytes+10)
	for i := range payload {
		payload[i] = byte(i * 7)
	}
	port := newMockSerialPort()
	port.readQueue = [][]byte{
		[]byte(`{"kind":"transfer","status":"ready","next":0}` + "\n"),
		[]byte(`{"kind":"transfer","status":"chunk","next":1}` + "\n"),
		[]byte(`{"kind":"transfer","status":"chunk","next":2}` + "\n"),
		[]byte(`{"kind":"transfer","status":"complete","next":2}` + "\n"),
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})
	var sent []int
	err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkFirmware, "", "", payload, TransferOptions{
		Fast:     true,
		Progress: func(done, _ int) { sent = append(sent, done) },
	})
	if err != nil {
		t.Fatalf("fast firmware transfer: %v", err)
	}
	var start struct {
		Baud int `json:"baud"`
	}
	if err := json.Unmarshal(port.writePayloads[0], &start); err != nil {
		t.Fatal(err)
	}
	if start.Baud != cableTransferFastBaudRate {
		t.Fatalf("start baud=%d want %d", start.Baud, cableTransferFastBaudRate)
	}
	if !reflect.DeepEqual(port.baudRates, []int{cableTransferFastBaudRate}) {
		t.Fatalf("port switched to %v, want only the fast rate after ready", port.baudRates)
	}
	for index, want := range [][]byte{payload[:cableTransferFastChunkBytes], payload[cableTransferFastChunkBytes:]} {
		var chunk struct {
			Data     string `json:"data"`
			Base64   string `json:"b64"`
			Checksum string `json:"checksum"`
		}
		if err := json.Unmarshal(port.writePayloads[index+1], &chunk); err != nil {
			t.Fatal(err)
		}
		decoded, err := base64.StdEncoding.DecodeString(chunk.Base64)
		if err != nil || chunk.Data != "" || string(decoded) != string(want) || chunk.Checksum != chunkChecksum(want) {
			t.Fatalf("unexpected fast chunk %d: data=%q decoded=%d bytes err=%v", index, chunk.Data, len(decoded), err)
		}
		if len(port.writePayloads[index+1]) > 2048 {
			t.Fatalf("chunk line is %d bytes, over the device frame", len(port.writePayloads[index+1]))
		}
	}
	if !reflect.DeepEqual(sent, []int{cableTransferFastChunkBytes, len(payload)}) {
		t.Fatalf("progress=%v", sent)
	}
	if port.closeCalls != 1 {
		t.Fatal("firmware transfer must close the port so the next open is at the normal rate")
	}
}

func TestSenderFastAssetTransferKeepsTheNormalBaud(t *testing.T) {
	port := newMockSerialPort()
	port.readQueue = [][]byte{
		[]byte(`{"kind":"transfer","status":"ready","next":0}` + "\n"),
		[]byte(`{"kind":"transfer","status":"chunk","next":1}` + "\n"),
		[]byte(`{"kind":"transfer","status":"complete","next":1}` + "\n"),
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})
	if err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkAsset, "/themes/u/test.cba", "theme", []byte("asset"), TransferOptions{Fast: true}); err != nil {
		t.Fatalf("fast asset transfer: %v", err)
	}
	if strings.Contains(string(port.writePayloads[0]), `"baud"`) || len(port.baudRates) != 0 {
		t.Fatalf("asset transfer changed the baud rate: %s %v", port.writePayloads[0], port.baudRates)
	}
}

func TestSenderAbortsWhenDeviceRejectsChunkBeforeAcknowledgement(t *testing.T) {
	payload := []byte("payload")
	digest := md5.Sum(payload)
	transferID := hex.EncodeToString(digest[:])[:16]
	port := newMockSerialPort()
	port.readQueue = [][]byte{
		[]byte(`{"kind":"transfer","id":"` + transferID + `","status":"ready","next":0}` + "\n"),
		[]byte(`{"kind":"error","code":"transfer-crc"}` + "\n"),
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})

	err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkFirmware, "", "", payload, TransferOptions{})
	if err == nil {
		t.Fatal("expected rejected chunk")
	}
	if !errors.Is(err, ErrCableTransferInterrupted) {
		t.Fatalf("rejected in-flight chunk must report interrupted transfer: %v", err)
	}
	if len(port.writePayloads) != 3 {
		t.Fatalf("writes=%d want start, chunk and abort", len(port.writePayloads))
	}
	var abort struct {
		Op string `json:"op"`
	}
	if err := json.Unmarshal(port.writePayloads[2], &abort); err != nil {
		t.Fatal(err)
	}
	if abort.Op != "transfer-abort" {
		t.Fatalf("unexpected abort request %+v", abort)
	}
	if port.closeCalls != 1 {
		t.Fatal("failed transfer must close the port and discard the abort reply")
	}
}

func TestSenderCanTransferAfterRejectedTransfer(t *testing.T) {
	failedPort := newMockSerialPort()
	failedPort.readQueue = [][]byte{
		[]byte(`{"kind":"transfer","status":"ready","next":0}` + "\n"),
		[]byte(`{"kind":"error","code":"transfer-crc"}` + "\n"),
		[]byte(`{"kind":"transfer","status":"aborted","next":0}` + "\n"),
	}
	successPort := newMockSerialPort()
	successPort.readQueue = [][]byte{
		[]byte(`{"kind":"transfer","status":"ready","next":0}` + "\n"),
		[]byte(`{"kind":"transfer","status":"chunk","next":1}` + "\n"),
		[]byte(`{"kind":"transfer","status":"complete","next":1}` + "\n"),
	}
	ports := []SerialPort{failedPort, successPort}
	opener := &mockOpener{openFn: func(string, *serial.Mode) (SerialPort, error) {
		if len(ports) == 0 {
			return nil, errors.New("unexpected open")
		}
		port := ports[0]
		ports = ports[1:]
		return port, nil
	}}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      opener,
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})

	if err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkAsset, "/themes/u/first.cba", "", []byte("first"), TransferOptions{}); err == nil {
		t.Fatal("expected first transfer to fail")
	}
	if err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkAsset, "/themes/u/second.cba", "theme", []byte("second"), TransferOptions{}); err != nil {
		t.Fatalf("second transfer: %v", err)
	}
	if opener.openCount("/dev/mock") != 2 {
		t.Fatal("second transfer must reopen a clean serial connection")
	}
}

func TestSenderReportsMissingStartAcknowledgementAsInterrupted(t *testing.T) {
	port := newMockSerialPort()
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: time.Millisecond,
	})

	err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkFirmware, "", "", []byte("firmware"), TransferOptions{})
	if !errors.Is(err, ErrCableTransferInterrupted) {
		t.Fatalf("missing ready acknowledgement must report interrupted transfer: %v", err)
	}
	if len(port.writePayloads) != 2 || port.closeCalls != 1 {
		t.Fatalf("start timeout must abort and close: writes=%d closes=%d", len(port.writePayloads), port.closeCalls)
	}
}

func TestSenderAbortsWhenContextIsCanceledAfterAcknowledgedChunk(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	port := newMockSerialPort()
	port.readQueue = [][]byte{
		[]byte(`{"kind":"transfer","status":"ready","next":0}` + "\n"),
		[]byte(`{"kind":"transfer","status":"chunk","next":1}` + "\n"),
	}
	port.readHook = func(call int) {
		if call == 2 {
			cancel()
		}
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})
	payload := make([]byte, cableTransferChunkBytes+1)

	err := sender.Transfer(ctx, "/dev/mock", "14799300", "paired-token", TransferSinkAsset, "/themes/u/test.cba", "theme", payload, TransferOptions{})
	if !errors.Is(err, ErrCableTransferInterrupted) || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled transfer must be interrupted: %v", err)
	}
	if len(port.writePayloads) != 3 {
		t.Fatalf("canceled transfer must write start, one chunk, abort; got %d writes", len(port.writePayloads))
	}
}

func TestPrepareThemeInstallRequiresDeviceAcknowledgement(t *testing.T) {
	for _, test := range []struct {
		name, reply string
		wantError   bool
	}{
		{"prepared", `{"kind":"transfer","status":"prepared","next":0}`, false},
		{"rejected", `{"kind":"error","code":"transfer-rejected"}`, true},
		{"wrong acknowledgement", `{"kind":"transfer","status":"complete","next":0}`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			port := newMockSerialPort()
			port.readQueue = [][]byte{[]byte(test.reply + "\n")}
			sender := NewSenderWithConfig(SenderConfig{Opener: &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}}, Sleep: func(time.Duration) {}, HelloWindow: 10 * time.Millisecond})
			err := sender.PrepareThemeInstall(context.Background(), "/dev/mock", "device", "token", "live")
			if (err != nil) != test.wantError {
				t.Fatalf("prepare: %v", err)
			}
			if len(port.writePayloads) != 1 {
				t.Fatalf("unexpected writes: %d", len(port.writePayloads))
			}
			var request map[string]string
			if err := json.Unmarshal(port.writePayloads[0], &request); err != nil {
				t.Fatal(err)
			}
			if request["op"] != "transfer-start" || request["sink"] != "prepare-theme" || request["deviceId"] != "device" || request["token"] != "token" || request["activate"] != "theme" {
				t.Fatalf("unexpected request: %v", request)
			}
		})
	}
}
