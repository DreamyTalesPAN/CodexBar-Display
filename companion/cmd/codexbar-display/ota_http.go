package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func firmwareOTAAuthError(err error) bool {
	if err == nil {
		return false
	}
	var httpErr *firmwareDeviceHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.StatusCode == http.StatusUnauthorized || httpErr.StatusCode == http.StatusForbidden
	}
	// The preflight wraps actual HTTP responses in firmwareDeviceHTTPError.
	// Transport error text includes addresses (e.g. port 40165), not statuses.
	return false
}

func normalizeHTTPBaseURL(raw string) (string, error) {
	target := strings.TrimSpace(raw)
	if target == "" {
		return "", errors.New("target is required, for example http://192.168.1.42")
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported target scheme %q", parsed.Scheme)
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return "", errors.New("target host is required")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func fetchDeviceHelloHTTP(ctx context.Context, base string) (protocol.DeviceHello, error) {
	return fetchDeviceHelloHTTPWithToken(ctx, base, "")
}

type firmwareDeviceHTTPError struct {
	Operation  string
	StatusCode int
	Status     string
	Body       string
}

type redactedFirmwareDeviceTokenError struct {
	err   error
	token string
}

func (e *redactedFirmwareDeviceTokenError) Error() string {
	if e == nil || e.err == nil {
		return ""
	}
	message := e.err.Error()
	for _, secret := range []string{e.token, url.QueryEscape(e.token), url.PathEscape(e.token)} {
		if secret != "" {
			message = strings.ReplaceAll(message, secret, "[REDACTED]")
		}
	}
	return message
}

func (e *redactedFirmwareDeviceTokenError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func (e *firmwareDeviceHTTPError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("%s returned %s body=%q", e.Operation, e.Status, e.Body)
}

const (
	firmwarePreflightAttempts   = 3
	firmwarePreflightRetryDelay = 500 * time.Millisecond
)

// fetchDeviceHelloHTTPWithTokenRetry retries the authenticated preflight only
// for transient transport failures (EOF, reset, timeout). It runs strictly
// before the first firmware byte is sent, so the OTA contract's no-retry rule
// for the write itself is untouched. Real auth errors (401/403) are never
// retried here; the caller owns the single re-pair path for those.
func fetchDeviceHelloHTTPWithTokenRetry(ctx context.Context, base, token string) (protocol.DeviceHello, error) {
	var hello protocol.DeviceHello
	var err error
	for attempt := 1; attempt <= firmwarePreflightAttempts; attempt++ {
		hello, err = fetchDeviceHelloHTTPWithToken(ctx, base, token)
		if err == nil || firmwareOTAAuthError(err) || ctx.Err() != nil {
			return hello, err
		}
		if attempt == firmwarePreflightAttempts {
			break
		}
		fmt.Printf("Transient preflight error (attempt %d/%d), retrying: %v\n",
			attempt, firmwarePreflightAttempts, err)
		select {
		case <-ctx.Done():
			return protocol.DeviceHello{}, ctx.Err()
		case <-time.After(firmwarePreflightRetryDelay):
		}
	}
	return hello, err
}

func fetchDeviceHelloHTTPWithToken(ctx context.Context, base, token string) (protocol.DeviceHello, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/hello", nil)
	if err != nil {
		return protocol.DeviceHello{}, err
	}
	req.Header.Set("User-Agent", "codexbar-display-update")
	req.Close = true
	if token = strings.TrimSpace(token); token != "" {
		// Header only. Sending the token in the header AND the query string at
		// the same time makes the device close the connection without a
		// response: measured on esp8266-smalltv-st7789 firmware 1.0.39, 24/30
		// requests failed with EOF, while header-only and query-only were both
		// 0/30. See docs/hardware-contract.md.
		applyFirmwareUpdateToken(req, token)
		if client, ok := releaseHTTPClient.(interface{ CloseIdleConnections() }); ok {
			client.CloseIdleConnections()
		}
	}
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		if token != "" {
			err = &redactedFirmwareDeviceTokenError{err: err, token: token}
		}
		return protocol.DeviceHello{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return protocol.DeviceHello{}, &firmwareDeviceHTTPError{
			Operation:  "GET /hello",
			StatusCode: resp.StatusCode,
			Status:     resp.Status,
			Body:       strings.TrimSpace(string(body)),
		}
	}
	hello, err := protocol.DecodeWiFiHello(resp.Body)
	if identity, ok := protocol.HelloIdentity(err); ok {
		// Issue #526: the update reads only device ID, board and firmware
		// from a WiFi hello, and those are intact when the VibeTV had no heap
		// for its capabilities. This update is what gives it that heap back.
		return identity, nil
	}
	return hello, err
}

func uploadFirmwareOTA(ctx context.Context, base, imagePath, token, currentFirmware string) error {
	if !usesLegacyRawFirmwareUpload(currentFirmware) {
		return uploadFirmwareOTAMultipart(ctx, base, imagePath, token)
	}
	if err := uploadFirmwareOTARaw(ctx, base, imagePath, token, currentFirmware); err == nil {
		return nil
	} else if !rawFirmwareUploadUnavailable(err) {
		return err
	}
	return uploadFirmwareOTAMultipart(ctx, base, imagePath, token)
}

func usesLegacyRawFirmwareUpload(currentFirmware string) bool {
	return normalizeReleaseVersion(currentFirmware) == "1.0.36"
}

func uploadFirmwareOTAMultipart(ctx context.Context, base, imagePath, token string) error {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("firmware", filepath.Base(imagePath))
	if err != nil {
		return err
	}
	file, err := os.Open(imagePath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(part, file); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}

	reqBody := newRateLimitedReader(bytes.NewReader(body.Bytes()), otaUploadBytesPerSecond)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/update/firmware", reqBody)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("User-Agent", "codexbar-display-update")
	applyFirmwareUpdateToken(req, token)
	// Never reuse a pooled connection for the upload, and never leave one open
	// on the single-threaded device across its post-upload reboot.
	req.Close = true
	req.ContentLength = int64(body.Len())
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		err := fmt.Errorf("POST /update/firmware returned %s body=%q", resp.Status, strings.TrimSpace(string(body)))
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return err
		}
		if resp.StatusCode == http.StatusNotFound {
			// Nothing was written: the device has no WiFi update route.
			return fmt.Errorf("%w: %v", errFirmwareUpdateCableOnly, err)
		}
		return fmt.Errorf("%w: %v", errFirmwareUploadMayHaveWritten, err)
	}
	return nil
}

func applyFirmwareUpdateToken(req *http.Request, token string) {
	token = strings.TrimSpace(token)
	if token != "" {
		req.Header.Set("X-VibeTV-Token", token)
	}
}
