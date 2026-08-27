package usb

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

const cableTransferChunkBytes = 128

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

func (s *Sender) Transfer(ctx context.Context, pathName, deviceID, token string, sink TransferSink, destination, activation string, payload []byte) error {
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
	if err := s.sendTransferRequestLocked(pathName, start, "ready", 0); err != nil {
		if errors.Is(err, errCableTransferRejected) {
			return err
		}
		return fmt.Errorf("%w: %w", ErrCableTransferInterrupted, err)
	}

	sequence := 0
	for offset := 0; offset < len(payload); offset += cableTransferChunkBytes {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("%w: %w", ErrCableTransferInterrupted, err)
		}
		end := offset + cableTransferChunkBytes
		if end > len(payload) {
			end = len(payload)
		}
		chunk := payload[offset:end]
		request := struct {
			Kind     string `json:"kind"`
			Op       string `json:"op"`
			Seq      int    `json:"seq"`
			Data     string `json:"data"`
			Checksum string `json:"checksum"`
		}{
			Kind:     "request",
			Op:       "transfer-chunk",
			Seq:      sequence,
			Data:     hex.EncodeToString(chunk),
			Checksum: chunkChecksum(chunk),
		}
		sequence++
		if err := s.sendTransferRequestLocked(pathName, request, "chunk", sequence); err != nil {
			return fmt.Errorf("%w: %w", ErrCableTransferInterrupted, err)
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

func (s *Sender) sendTransferRequestForReplyLocked(pathName string, request any) (transferReply, error) {
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
	seen := readPortLines(s.port, s.helloWindow, func(line string) bool {
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
