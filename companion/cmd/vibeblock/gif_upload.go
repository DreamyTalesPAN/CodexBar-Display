package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/gif"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
	serial "go.bug.st/serial"
)

const (
	defaultGIFUploadPath = "~/Downloads/testgif"
	defaultGIFBaudRate   = 115200
)

func runGIFUpload(args []string) error {
	fs := flag.NewFlagSet("gif-upload", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	gifPath := fs.String("gif", defaultGIFUploadPath, "path to gif file (supports path without .gif suffix)")
	baud := fs.Int("baud", defaultGIFBaudRate, "serial baud rate")
	play := fs.Bool("play", true, "send PLAY after successful upload")
	timeout := fs.Duration("timeout", 45*time.Second, "serial response timeout")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *baud <= 0 {
		return fmt.Errorf("invalid --baud: %d", *baud)
	}
	if *timeout <= 0 {
		return fmt.Errorf("invalid --timeout: %s", timeout.String())
	}

	resolvedPort, err := usb.ResolvePort(strings.TrimSpace(*port))
	if err != nil {
		return fmt.Errorf("resolve serial port: %w", err)
	}

	resolvedGIFPath, err := resolveGIFUploadPath(strings.TrimSpace(*gifPath))
	if err != nil {
		return err
	}

	gifBytes, err := os.ReadFile(resolvedGIFPath)
	if err != nil {
		return fmt.Errorf("read gif file: %w", err)
	}
	if len(gifBytes) == 0 {
		return errors.New("gif file is empty")
	}

	cfg, err := gif.DecodeConfig(bytes.NewReader(gifBytes))
	if err != nil {
		return fmt.Errorf("decode gif config: %w", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return fmt.Errorf("invalid gif dimensions: %dx%d", cfg.Width, cfg.Height)
	}

	mode := &serial.Mode{BaudRate: *baud}
	serialPort, err := serial.Open(resolvedPort, mode)
	if err != nil {
		return fmt.Errorf("open serial port: %w", err)
	}
	defer serialPort.Close()

	_ = serialPort.SetReadTimeout(200 * time.Millisecond)
	_ = serialPort.SetDTR(false)
	_ = serialPort.SetRTS(false)
	time.Sleep(1200 * time.Millisecond)
	drainSerialInput(serialPort, 200*time.Millisecond)

	if err := writeSerialLine(serialPort, "HELLO"); err != nil {
		return fmt.Errorf("send HELLO: %w", err)
	}
	helloLine, err := waitForSerialPrefix(serialPort, "GIF_READY", *timeout)
	if err != nil {
		return fmt.Errorf("wait for GIF_READY: %w", err)
	}
	maxBytes := parseMaxBytesFromHello(helloLine)
	uploadBytes := gifBytes
	uploadCfg := cfg
	wasCompacted := false

	if maxBytes > 0 && len(uploadBytes) > maxBytes {
		compacted, compactErr := compactGIFToBudget(uploadBytes, maxBytes)
		if compactErr != nil {
			return fmt.Errorf("gif exceeds device maxBytes=%d and compaction failed: %w", maxBytes, compactErr)
		}
		uploadBytes = compacted
		wasCompacted = true

		compactedCfg, decodeErr := gif.DecodeConfig(bytes.NewReader(uploadBytes))
		if decodeErr != nil {
			return fmt.Errorf("decode compacted gif config: %w", decodeErr)
		}
		uploadCfg = compactedCfg
	}

	if err := writeSerialLine(serialPort, fmt.Sprintf("PUT %d", len(uploadBytes))); err != nil {
		return fmt.Errorf("send PUT command: %w", err)
	}
	if _, err := waitForSerialPrefix(serialPort, "PUT_READY", *timeout); err != nil {
		return fmt.Errorf("wait for PUT_READY: %w", err)
	}

	if err := writeSerialBytesWithProgress(serialPort, uploadBytes); err != nil {
		return fmt.Errorf("send gif bytes: %w", err)
	}

	putLine, err := waitForSerialPrefix(serialPort, "PUT_OK", *timeout)
	if err != nil {
		return fmt.Errorf("wait for PUT_OK: %w", err)
	}

	playLine := ""
	if *play {
		if err := writeSerialLine(serialPort, "PLAY"); err != nil {
			return fmt.Errorf("send PLAY: %w", err)
		}
		playLine, err = waitForSerialPrefix(serialPort, "PLAY_OK", *timeout)
		if err != nil {
			return fmt.Errorf("wait for PLAY_OK: %w", err)
		}
	}

	if err := writeSerialLine(serialPort, "STATUS"); err != nil {
		return fmt.Errorf("send STATUS: %w", err)
	}
	statusLine, err := waitForSerialPrefix(serialPort, "STATUS", *timeout)
	if err != nil {
		return fmt.Errorf("wait for STATUS: %w", err)
	}

	fmt.Printf("serial: %s\n", resolvedPort)
	fmt.Printf("gif source: %s (%d bytes, %dx%d)\n", resolvedGIFPath, len(gifBytes), cfg.Width, cfg.Height)
	if wasCompacted {
		fmt.Printf("gif upload: compacted to %d bytes, %dx%d\n", len(uploadBytes), uploadCfg.Width, uploadCfg.Height)
	} else {
		fmt.Printf("gif upload: %d bytes, %dx%d\n", len(uploadBytes), uploadCfg.Width, uploadCfg.Height)
	}
	fmt.Printf("hello: %s\n", helloLine)
	fmt.Printf("upload: %s\n", putLine)
	if playLine != "" {
		fmt.Printf("play: %s\n", playLine)
	}
	fmt.Printf("status: %s\n", statusLine)
	return nil
}

func resolveGIFUploadPath(rawPath string) (string, error) {
	candidate := strings.TrimSpace(rawPath)
	if candidate == "" {
		candidate = defaultGIFUploadPath
	}

	pathsToTry := make([]string, 0, 3)
	pathsToTry = append(pathsToTry, candidate)
	if filepath.Ext(candidate) == "" {
		pathsToTry = append(pathsToTry, candidate+".gif", candidate+".GIF")
	}

	for _, pathCandidate := range pathsToTry {
		resolved, err := resolveUserPath(pathCandidate)
		if err != nil {
			return "", err
		}
		if fileExists(resolved) {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("gif not found: tried %s", strings.Join(pathsToTry, ", "))
}

func resolveUserPath(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", errors.New("path is empty")
	}
	if strings.HasPrefix(trimmed, "~/") || trimmed == "~" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		if trimmed == "~" {
			trimmed = homeDir
		} else {
			trimmed = filepath.Join(homeDir, trimmed[2:])
		}
	}
	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed), nil
	}
	return resolvePathFromCwd(trimmed)
}

func writeSerialLine(port serial.Port, line string) error {
	text := strings.TrimSpace(line)
	if text == "" {
		return errors.New("line is empty")
	}
	_, err := port.Write([]byte(text + "\n"))
	return err
}

func writeSerialBytesWithProgress(port serial.Port, payload []byte) error {
	written := 0
	lastProgress := time.Now().Add(-time.Second)
	for written < len(payload) {
		end := written + 64
		if end > len(payload) {
			end = len(payload)
		}
		n, err := port.Write(payload[written:end])
		if err != nil {
			return err
		}
		if n <= 0 {
			return errors.New("serial write returned zero bytes")
		}
		written += n
		if time.Since(lastProgress) >= 750*time.Millisecond || written == len(payload) {
			pct := (float64(written) * 100.0) / float64(len(payload))
			fmt.Printf("\rupload progress: %.1f%% (%d/%d bytes)", pct, written, len(payload))
			lastProgress = time.Now()
		}
		time.Sleep(8 * time.Millisecond)
	}
	fmt.Println()
	return nil
}

func parseMaxBytesFromHello(line string) int {
	parts := strings.Fields(strings.TrimSpace(line))
	for _, part := range parts {
		if !strings.HasPrefix(part, "maxBytes=") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(part, "maxBytes="))
		maxBytes, err := strconv.Atoi(value)
		if err == nil && maxBytes > 0 {
			return maxBytes
		}
	}
	return 0
}

func compactGIFToBudget(gifData []byte, maxBytes int) ([]byte, error) {
	if maxBytes <= 0 || len(gifData) <= maxBytes {
		return append([]byte(nil), gifData...), nil
	}
	decoded, err := gif.DecodeAll(bytes.NewReader(gifData))
	if err != nil {
		return nil, fmt.Errorf("decode gif: %w", err)
	}
	if len(decoded.Image) <= 1 {
		return nil, errors.New("gif too large and cannot compact single frame")
	}

	for stride := 2; stride <= len(decoded.Image); stride++ {
		compacted, compactErr := reencodeGIFWithStride(decoded, stride)
		if compactErr != nil {
			continue
		}
		if len(compacted) <= maxBytes {
			return compacted, nil
		}
	}
	return nil, fmt.Errorf("gif still too large after compaction (bytes=%d, max=%d)", len(gifData), maxBytes)
}

func reencodeGIFWithStride(src *gif.GIF, stride int) ([]byte, error) {
	if src == nil || stride <= 1 || len(src.Image) == 0 {
		return nil, errors.New("invalid compaction request")
	}
	out := &gif.GIF{
		Image:           make([]*image.Paletted, 0, (len(src.Image)+stride-1)/stride),
		Delay:           make([]int, 0, (len(src.Image)+stride-1)/stride),
		Disposal:        make([]byte, 0, (len(src.Image)+stride-1)/stride),
		LoopCount:       src.LoopCount,
		Config:          src.Config,
		BackgroundIndex: src.BackgroundIndex,
	}

	for i := 0; i < len(src.Image); i += stride {
		end := i + stride
		if end > len(src.Image) {
			end = len(src.Image)
		}
		totalDelay := 0
		for j := i; j < end; j++ {
			if j < len(src.Delay) {
				totalDelay += src.Delay[j]
			} else {
				totalDelay++
			}
		}
		if totalDelay <= 0 {
			totalDelay = 1
		}

		out.Image = append(out.Image, src.Image[i])
		out.Delay = append(out.Delay, totalDelay)
		if i < len(src.Disposal) {
			out.Disposal = append(out.Disposal, src.Disposal[i])
		}
	}

	if len(out.Image) == 0 {
		return nil, errors.New("gif compaction produced no frames")
	}

	var buffer bytes.Buffer
	if err := gif.EncodeAll(&buffer, out); err != nil {
		return nil, fmt.Errorf("encode compacted gif: %w", err)
	}
	return buffer.Bytes(), nil
}

func drainSerialInput(port serial.Port, duration time.Duration) {
	if duration <= 0 {
		return
	}
	deadline := time.Now().Add(duration)
	buffer := make([]byte, 256)
	for time.Now().Before(deadline) {
		_, err := port.Read(buffer)
		if err != nil && !isTimeoutError(err) {
			return
		}
	}
}

func waitForSerialPrefix(port serial.Port, prefix string, timeout time.Duration) (string, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		line, err := readSerialLine(port, deadline)
		if err != nil {
			return "", err
		}
		if strings.HasPrefix(line, "ERR ") || strings.HasPrefix(line, "PUT_ERR") {
			return "", fmt.Errorf("device rejected command: %s", line)
		}
		if strings.HasPrefix(line, prefix) {
			return line, nil
		}
	}
	return "", fmt.Errorf("timeout waiting for %s", prefix)
}

func readSerialLine(port serial.Port, deadline time.Time) (string, error) {
	buffer := make([]byte, 1)
	builder := strings.Builder{}
	for time.Now().Before(deadline) {
		n, err := port.Read(buffer)
		if err != nil {
			if isTimeoutError(err) {
				continue
			}
			return "", err
		}
		if n == 0 {
			continue
		}
		b := buffer[0]
		if b == '\r' {
			continue
		}
		if b == '\n' {
			line := strings.TrimSpace(builder.String())
			if line == "" {
				builder.Reset()
				continue
			}
			return line, nil
		}
		if builder.Len() < 4096 {
			builder.WriteByte(b)
		}
	}
	return "", errors.New("timeout waiting for serial line")
}

func isTimeoutError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(message, "timeout")
}
