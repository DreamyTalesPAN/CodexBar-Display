package usb

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
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

	if err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkAsset, "/themes/u/test.cba", "theme", payload); err != nil {
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

	err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkFirmware, "", "", payload)
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

	if err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkAsset, "/themes/u/first.cba", "", []byte("first")); err == nil {
		t.Fatal("expected first transfer to fail")
	}
	if err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkAsset, "/themes/u/second.cba", "theme", []byte("second")); err != nil {
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

	err := sender.Transfer(context.Background(), "/dev/mock", "14799300", "paired-token", TransferSinkFirmware, "", "", []byte("firmware"))
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

	err := sender.Transfer(ctx, "/dev/mock", "14799300", "paired-token", TransferSinkAsset, "/themes/u/test.cba", "theme", payload)
	if !errors.Is(err, ErrCableTransferInterrupted) || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled transfer must be interrupted: %v", err)
	}
	if len(port.writePayloads) != 3 {
		t.Fatalf("canceled transfer must write start, one chunk, abort; got %d writes", len(port.writePayloads))
	}
}
