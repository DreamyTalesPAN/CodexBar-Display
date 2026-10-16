package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func firmwareUploadConnectionInterrupted(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errFirmwareUploadMayHaveWritten) || errors.Is(err, io.EOF) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "use of closed network connection") ||
		strings.Contains(message, "connection reset by peer") ||
		strings.Contains(message, "broken pipe") ||
		strings.Contains(message, "unexpected eof") ||
		strings.Contains(message, "timed out waiting for vibetv to acknowledge firmware data") ||
		strings.Contains(message, "i/o timeout") ||
		strings.Contains(message, "operation timed out") ||
		strings.Contains(message, "update failed: no error")
}

func uploadFirmwareOTARaw(ctx context.Context, base, imagePath, token, currentFirmware string) error {
	endpoint, err := rawFirmwareEndpoint(base)
	if err != nil {
		return err
	}
	file, err := os.Open(imagePath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, file)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("User-Agent", "codexbar-display-update")
	applyFirmwareUpdateToken(req, token)
	req.ContentLength = info.Size()
	req.Close = true
	if strings.ContainsAny(strings.TrimSpace(token), "\r\n") {
		return errors.New("firmware update token contains an invalid newline")
	}

	parsedEndpoint, err := url.Parse(endpoint)
	if err != nil {
		return err
	}
	if parsedEndpoint.Scheme != "http" {
		return fmt.Errorf("raw firmware upload requires http, got %q", parsedEndpoint.Scheme)
	}
	address := parsedEndpoint.Host
	if _, _, err := net.SplitHostPort(address); err != nil {
		address = net.JoinHostPort(parsedEndpoint.Hostname(), "8081")
	}
	conn, err := firmwareRawDialContextFn(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer conn.Close()
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
	}
	deadline := time.Now().Add(5 * time.Minute)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	_ = conn.SetDeadline(deadline)

	waitForAck := func() error {
		return waitForFirmwareRawAck(ctx, conn, otaRawAckTimeout)
	}
	header := fmt.Sprintf(
		"POST %s HTTP/1.1\r\nHost: %s\r\nContent-Type: application/octet-stream\r\nContent-Length: %d\r\nUser-Agent: codexbar-display-update\r\nConnection: close\r\n",
		parsedEndpoint.RequestURI(),
		parsedEndpoint.Host,
		info.Size(),
	)
	if normalizedToken := strings.TrimSpace(token); normalizedToken != "" {
		header += "X-VibeTV-Token: " + normalizedToken + "\r\n"
	}
	header += "\r\n"
	if err := writeAll(conn, []byte(header)); err != nil {
		return err
	}
	if err := waitForAck(); err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	time.Sleep(otaRawHeaderPause)
	bodyWriter := &rawFirmwareBodyWriter{
		destination: conn,
		waitForAck:  waitForAck,
		writePause:  firmwareRawWritePause(currentFirmware),
	}
	if _, err := io.Copy(bodyWriter, file); err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	if err := waitForAck(); err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		err := fmt.Errorf("POST /update/firmware.raw returned %s body=%q", resp.Status, strings.TrimSpace(string(body)))
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return err
		}
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	return nil
}

// rawFirmwareBodyWriter writes the firmware body in small TCP writes and waits
// for the receiver after every block. ESP8266 firmware 1.0.36 and older also
// need a pause after every write to avoid exhausting their receive queue.
type rawFirmwareBodyWriter struct {
	destination   io.Writer
	waitForAck    func() error
	writePause    time.Duration
	bytesSinceAck int
}

func (w *rawFirmwareBodyWriter) Write(p []byte) (int, error) {
	originalLength := len(p)
	for len(p) > 0 {
		chunkSize := otaRawWriteChunkBytes
		if len(p) < chunkSize {
			chunkSize = len(p)
		}
		if remainingInBlock := otaRawAckBlockBytes - w.bytesSinceAck; chunkSize > remainingInBlock {
			chunkSize = remainingInBlock
		}
		if err := writeAll(w.destination, p[:chunkSize]); err != nil {
			return originalLength - len(p), err
		}
		w.bytesSinceAck += chunkSize
		p = p[chunkSize:]
		if w.writePause > 0 {
			time.Sleep(w.writePause)
		}
		if w.bytesSinceAck == otaRawAckBlockBytes {
			if w.waitForAck != nil {
				if err := w.waitForAck(); err != nil {
					return originalLength - len(p), err
				}
			}
			w.bytesSinceAck = 0
		}
	}
	return originalLength, nil
}

// Every firmware gets the conservative inter-chunk pause.
//
// This used to return 0 for released firmware >= 1.0.37, assuming the receiver
// fix made pacing unnecessary. Real hardware disagrees: on
// esp8266-smalltv-st7789 running released 1.0.39, the unpaced sender stalled
// waiting for the block acknowledgement in 2 of 2 attempts ("192 bytes
// pending", "512 bytes pending"), each time leaving the firmware unchanged and
// rebooting the device. The very same upload with the pause restored completed
// and installed 9999.0.24. See docs/hardware-contract.md.
//
// The parameter stays so callers keep documenting which firmware they are
// talking to, and so a future measured exception has somewhere to live.
func firmwareRawWritePause(string) time.Duration {
	return otaRawWritePause
}

func writeAll(w io.Writer, p []byte) error {
	for len(p) > 0 {
		written, err := w.Write(p)
		if err != nil {
			return err
		}
		if written <= 0 {
			return io.ErrShortWrite
		}
		p = p[written:]
	}
	return nil
}

func rawFirmwareEndpoint(base string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(base))
	if err != nil {
		return "", err
	}
	host := parsed.Hostname()
	if host == "" {
		return "", fmt.Errorf("target host is required")
	}
	port := strings.TrimSpace(firmwareRawOTAPort)
	if port == "" {
		port = "8081"
	}
	parsed.Host = net.JoinHostPort(host, port)
	parsed.Path = "/update/firmware.raw"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func rawFirmwareUploadUnavailable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "no route to host") ||
		strings.Contains(msg, "404")
}
