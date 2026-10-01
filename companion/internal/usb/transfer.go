package usb

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

const (
	cableTransferChunkBytes = 128
	// cable-transfer-v2: 1 KB base64 chunks, and firmware at a faster baud
	// rate for the length of the transfer. The line stays under the device's
	// 2048-byte serial frame.
	cableTransferFastChunkBytes = 1024
	// 460800 lost bytes on a real VibeTV within the first 60 KB; the UART
	// FIFO then fills in under 3 ms. 230400 doubles that margin.
	cableTransferFastBaudRate = 230400
	cableTransferBaudSettle   = 20 * time.Millisecond
	// A chunk that gets no clean answer is sent again. Every attempt together
	// stays inside the VibeTV's 15-second idle bound, after which it ends the
	// transfer (and drops back to the normal rate).
	cableTransferChunkAttempts  = 3
	cableTransferChunkAckWindow = 2 * time.Second
	cableTransferDrainWindow    = 300 * time.Millisecond
)

// TransferOptions tunes one Cable transfer. Fast is only for a VibeTV that
// advertises cable-transfer-v2; Progress, when set, hears the bytes the device
// has accepted after every chunk.
type TransferOptions struct {
	Fast     bool
	Progress func(sent, total int)
}

var ErrCableTransferInterrupted = errors.New("cable transfer interrupted")

var errCableTransferRejected = errors.New("cable transfer rejected")

type TransferSink string

const (
	TransferSinkAsset    TransferSink = "asset"
	TransferSinkFirmware TransferSink = "firmware"
)

type transferReply struct {
	Kind   string `json:"kind"`
	Status string `json:"status"`
	Next   int    `json:"next"`
	Code   string `json:"code"`
}

// PrepareThemeInstall reclaims files left by earlier incomplete installs. The
// device keeps the selected theme's files and owns the slot cleanup.
func (s *Sender) PrepareThemeInstall(ctx context.Context, pathName, deviceID, token, slot string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if strings.TrimSpace(deviceID) == "" || strings.TrimSpace(token) == "" || (slot != "live" && slot != "screensaver") {
		return errors.New("invalid Cable theme preparation")
	}
	if _, err := s.ensurePort(pathName); err != nil {
		return err
	}
	activation := "theme"
	if slot == "screensaver" {
		activation = "screensaver"
	}
	request := struct {
		Kind     string `json:"kind"`
		Op       string `json:"op"`
		DeviceID string `json:"deviceId"`
		Token    string `json:"token"`
		Sink     string `json:"sink"`
		Activate string `json:"activate"`
	}{"request", "transfer-start", deviceID, token, "prepare-theme", activation}
	if err := s.sendTransferRequestLocked(pathName, request, "prepared", 0); err != nil {
		s.closeCurrentLocked()
		return err
	}
	return nil
}

func (s *Sender) Transfer(ctx context.Context, pathName, deviceID, token string, sink TransferSink, destination, activation string, payload []byte, options TransferOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	if sink != TransferSinkAsset && sink != TransferSinkFirmware {
		return fmt.Errorf("unsupported Cable transfer sink %q", sink)
	}
	deviceID = strings.TrimSpace(deviceID)
	token = strings.TrimSpace(token)
	destination = strings.TrimSpace(destination)
	activation = strings.TrimSpace(activation)
	if deviceID == "" {
		return errors.New("cable transfer deviceId is required")
	}
	if token == "" {
		return errors.New("cable transfer pairing token is required")
	}
	if sink == TransferSinkAsset && (destination == "" || path.Clean(destination) != destination) {
		return errors.New("cable asset destination is invalid")
	}
	if len(payload) == 0 {
		return errors.New("cable transfer payload is empty")
	}

	if _, err := s.ensurePort(pathName); err != nil {
		return err
	}
	digest := md5.Sum(payload)
	digestHex := hex.EncodeToString(digest[:])
	abort := true
	defer func() {
		if abort {
			s.abortTransferLocked()
		}
	}()

	start := struct {
		Kind     string       `json:"kind"`
		Op       string       `json:"op"`
		DeviceID string       `json:"deviceId"`
		Token    string       `json:"token"`
		Sink     TransferSink `json:"sink"`
		Path     string       `json:"path,omitempty"`
		Activate string       `json:"activate,omitempty"`
		Bytes    int          `json:"bytes"`
		Hash     string       `json:"hash"`
		Baud     int          `json:"baud,omitempty"`
	}{
		Kind:     "request",
		Op:       "transfer-start",
		DeviceID: deviceID,
		Token:    token,
		Sink:     sink,
		Path:     destination,
		Activate: activation,
		Bytes:    len(payload),
		Hash:     digestHex,
	}
	chunkBytes := cableTransferChunkBytes
	if options.Fast {
		chunkBytes = cableTransferFastChunkBytes
		if sink == TransferSinkFirmware {
			start.Baud = cableTransferFastBaudRate
		}
	}
	if err := s.sendTransferRequestLocked(pathName, start, "ready", 0); err != nil {
		if errors.Is(err, errCableTransferRejected) {
			return err
		}
		return fmt.Errorf("%w: %w", ErrCableTransferInterrupted, err)
	}
	// The VibeTV answers "ready" at the old rate and switches after it. The
	// port is closed after the transfer, success or not, so the next open is
	// back at the normal rate, and the VibeTV falls back when the transfer
	// ends, is aborted, or goes idle.
	if start.Baud != 0 {
		mode := openMode()
		mode.BaudRate = start.Baud
		if err := s.port.SetMode(mode); err != nil {
			return fmt.Errorf("%w: %w", ErrCableTransferInterrupted, err)
		}
		s.sleep(cableTransferBaudSettle)
	}

	sequence := 0
	for offset := 0; offset < len(payload); offset += chunkBytes {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("%w: %w", ErrCableTransferInterrupted, err)
		}
		end := offset + chunkBytes
		if end > len(payload) {
			end = len(payload)
		}
		chunk := payload[offset:end]
		request := struct {
			Kind     string `json:"kind"`
			Op       string `json:"op"`
			Seq      int    `json:"seq"`
			Data     string `json:"data,omitempty"`
			Base64   string `json:"b64,omitempty"`
			Checksum string `json:"checksum"`
		}{
			Kind:     "request",
			Op:       "transfer-chunk",
			Seq:      sequence,
			Checksum: chunkChecksum(chunk),
		}
		if options.Fast {
			request.Base64 = base64.StdEncoding.EncodeToString(chunk)
		} else {
			request.Data = hex.EncodeToString(chunk)
		}
		sequence++
		if err := s.sendChunkLocked(pathName, request, sequence); err != nil {
			return fmt.Errorf("%w: %w", ErrCableTransferInterrupted, err)
		}
		if options.Progress != nil {
			options.Progress(end, len(payload))
		}
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("%w: %w", ErrCableTransferInterrupted, err)
	}

	finish := struct {
		Kind string `json:"kind"`
		Op   string `json:"op"`
	}{Kind: "request", Op: "transfer-finish"}
	reply, err := s.sendTransferRequestForReplyLocked(pathName, finish)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrCableTransferInterrupted, err)
	}
	if reply.Status != "complete" {
		return fmt.Errorf("%w: completion did not match the payload", ErrCableTransferInterrupted)
	}
	abort = false
	if sink == TransferSinkFirmware {
		s.closeCurrentLocked()
	}
	return nil
}

func chunkChecksum(chunk []byte) string {
	digest := md5.Sum(chunk)
	return hex.EncodeToString(digest[:4])
}

func (s *Sender) sendTransferRequestLocked(pathName string, request any, status string, next int) error {
	reply, err := s.sendTransferRequestForReplyLocked(pathName, request)
	if err != nil {
		return err
	}
	if reply.Status != status || reply.Next != next {
		return fmt.Errorf("cable transfer returned unexpected acknowledgement")
	}
	return nil
}

// sendChunkLocked sends one chunk. A single lost or damaged byte leaves a line
// the VibeTV cannot read or an answer the Mac cannot read; without a second
// attempt that ended a theme install or firmware update after a 30-second wait.
// The VibeTV acknowledges a repeated chunk without writing it again (v1 and
// v2), so the same chunk is simply sent once more.
func (s *Sender) sendChunkLocked(pathName string, request any, next int) error {
	for attempt := 1; ; attempt++ {
		reply, err := s.sendTransferRequestWithinLocked(pathName, request, min(s.helloWindow, cableTransferChunkAckWindow))
		if err == nil && reply.Status == "chunk" && reply.Next == next {
			return nil
		}
		if err == nil {
			err = fmt.Errorf("cable transfer returned unexpected acknowledgement")
		}
		if attempt == cableTransferChunkAttempts || s.port == nil {
			return err
		}
		// End a line the VibeTV may still be holding, and drop its answer to it.
		if writeErr := writeWithTimeout(s.port, []byte("\n"), s.writeTimeout); writeErr != nil {
			return err
		}
		readPortLines(s.port, min(s.helloWindow, cableTransferDrainWindow), func(string) bool { return false })
	}
}

func (s *Sender) sendTransferRequestForReplyLocked(pathName string, request any) (transferReply, error) {
	return s.sendTransferRequestWithinLocked(pathName, request, s.helloWindow)
}

func (s *Sender) sendTransferRequestWithinLocked(pathName string, request any, window time.Duration) (transferReply, error) {
	line, err := json.Marshal(request)
	if err != nil {
		return transferReply{}, err
	}
	line = append(line, '\n')
	if err := writeWithTimeout(s.port, line, s.writeTimeout); err != nil {
		s.closeCurrentLocked()
		return transferReply{}, wrapTransportError(
			errcode.TransportSerialWrite,
			"cable-transfer",
			pathName,
			"Keep the selected VibeTV connected by Cable and retry.",
			err,
		)
	}

	var reply transferReply
	seen := readPortLines(s.port, window, func(line string) bool {
		if json.Unmarshal([]byte(line), &reply) != nil {
			return false
		}
		return strings.TrimSpace(reply.Kind) == "transfer" || strings.TrimSpace(reply.Kind) == "error"
	})
	if !seen {
		return transferReply{}, errors.New("VibeTV did not acknowledge the Cable transfer")
	}
	if strings.TrimSpace(reply.Kind) == "error" {
		return transferReply{}, fmt.Errorf("%w: %s", errCableTransferRejected, strings.TrimSpace(reply.Code))
	}
	return reply, nil
}

func (s *Sender) abortTransferLocked() {
	if s.port == nil {
		return
	}
	request := struct {
		Kind string `json:"kind"`
		Op   string `json:"op"`
	}{Kind: "request", Op: "transfer-abort"}
	line, err := json.Marshal(request)
	if err == nil {
		line = append(line, '\n')
		_ = writeWithTimeout(s.port, line, s.writeTimeout)
	}
	// The device replies to abort. Closing here discards that reply so it
	// cannot be mistaken for the acknowledgement of the next transfer.
	s.closeCurrentLocked()
}
