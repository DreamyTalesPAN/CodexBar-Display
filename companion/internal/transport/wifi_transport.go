package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const (
	defaultWiFiTimeout      = 5 * time.Second
	pairDeviceAttempts      = 3
	assetUploadAttempts     = 3
	assetUploadRetryMaxBody = 512
	assetUploadBytesPerSec  = 1024
	assetUploadReadChunk    = 512
	assetUploadMinTimeout   = 30 * time.Second
	assetUploadTimeoutGrace = 15 * time.Second
	assetUploadMaxTimeout   = 5 * time.Minute
	deviceAuthHeader        = "X-VibeTV-Token"
	deviceAuthEnv           = "CODEXBAR_DISPLAY_DEVICE_TOKEN"
)

var assetUploadRetryDelay = 1500 * time.Millisecond
var pairDeviceRetryDelay = 500 * time.Millisecond

type WiFiTransport struct {
	client                   *http.Client
	assetUploadRetryObserver AssetUploadRetryObserver
}

type AssetUploadRetry struct {
	DevicePath  string
	Attempt     int
	MaxAttempts int
	Err         error
	StatusCode  int
}

type AssetUploadRetryObserver func(AssetUploadRetry)

type DeviceHealthSnapshot struct {
	OK      bool `json:"ok"`
	Display struct {
		ActiveTheme string `json:"activeTheme"`
		ThemeSpec   struct {
			Active         bool   `json:"active"`
			Path           string `json:"path"`
			Hash           string `json:"hash"`
			RenderOk       bool   `json:"renderOk"`
			RenderError    string `json:"renderError"`
			RenderFailures int    `json:"renderFailures"`
		} `json:"themeSpec"`
		GIF struct {
			ActivePath       string `json:"activePath"`
			FilePresent      bool   `json:"filePresent"`
			DecoderAllocated bool   `json:"decoderAllocated"`
			DecoderOpen      bool   `json:"decoderOpen"`
			LastError        string `json:"lastError"`
			LastErrorStage   string `json:"lastErrorStage"`
		} `json:"gif"`
	} `json:"display"`
}

type DeviceAsset struct {
	Path      string `json:"path"`
	SizeBytes int64  `json:"sizeBytes"`
}

type DeviceAssetsSnapshot struct {
	Assets []DeviceAsset `json:"assets"`
}

func (s DeviceAssetsSnapshot) AssetSize(devicePath string) (int64, bool) {
	devicePath = strings.TrimSpace(devicePath)
	for _, asset := range s.Assets {
		if asset.Path == devicePath {
			return asset.SizeBytes, true
		}
	}
	return 0, false
}

func (s DeviceAssetsSnapshot) PathsWithPrefix(prefix string) []string {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return nil
	}
	var paths []string
	for _, asset := range s.Assets {
		if strings.HasPrefix(asset.Path, prefix) {
			paths = append(paths, asset.Path)
		}
	}
	return paths
}

func NewWiFiTransport() DeviceTransport {
	return WiFiTransport{
		client: SerializeDeviceHTTPClient(&http.Client{Timeout: defaultWiFiTimeout}),
	}
}

func NewWiFiTransportWithClient(client *http.Client) WiFiTransport {
	if client == nil {
		client = &http.Client{Timeout: defaultWiFiTimeout}
	}
	return WiFiTransport{client: SerializeDeviceHTTPClient(client)}
}

func (t WiFiTransport) WithAssetUploadRetryObserver(observer AssetUploadRetryObserver) WiFiTransport {
	t.assetUploadRetryObserver = observer
	return t
}

func (WiFiTransport) Name() string {
	return "wifi"
}

func (t WiFiTransport) ResolvePort(requested string) (string, error) {
	return normalizeWiFiTargetWithToken(requested)
}

func (t WiFiTransport) DeviceCapabilities(target string) (protocol.DeviceCapabilities, error) {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return protocol.DeviceCapabilities{}, err
	}
	req, err := http.NewRequest(http.MethodGet, base+"/hello", nil)
	if err != nil {
		return protocol.DeviceCapabilities{}, fmt.Errorf("build device hello request: %w", err)
	}
	req.Close = true
	resp, err := t.client.Do(req)
	if err != nil {
		return protocol.DeviceCapabilities{}, fmt.Errorf("get device hello: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return protocol.DeviceCapabilities{}, fmt.Errorf("get device hello: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var hello protocol.DeviceHello
	if err := json.NewDecoder(resp.Body).Decode(&hello); err != nil {
		return protocol.DeviceCapabilities{}, fmt.Errorf("decode device hello: %w", err)
	}
	return protocol.CapabilitiesFromHello(hello), nil
}

func (t WiFiTransport) DeviceHealth(target string) error {
	_, err := t.DeviceHealthSnapshot(target)
	return err
}

func (t WiFiTransport) DeviceAssets(target string) (DeviceAssetsSnapshot, error) {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return DeviceAssetsSnapshot{}, err
	}
	req, err := http.NewRequest(http.MethodGet, base+"/assets", nil)
	if err != nil {
		return DeviceAssetsSnapshot{}, fmt.Errorf("build device assets request: %w", err)
	}
	req.Close = true
	resp, err := t.client.Do(req)
	if err != nil {
		return DeviceAssetsSnapshot{}, fmt.Errorf("get device assets: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return DeviceAssetsSnapshot{}, fmt.Errorf("get device assets: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var assets DeviceAssetsSnapshot
	if err := json.NewDecoder(resp.Body).Decode(&assets); err != nil {
		return DeviceAssetsSnapshot{}, fmt.Errorf("decode device assets: %w", err)
	}
	return assets, nil
}

func (t WiFiTransport) DeleteAsset(target, devicePath string) error {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return err
	}
	devicePath = strings.TrimSpace(devicePath)
	if devicePath == "" {
		return fmt.Errorf("asset path required")
	}
	req, err := http.NewRequest(http.MethodDelete, base+"/assets?path="+url.QueryEscape(devicePath), nil)
	if err != nil {
		return fmt.Errorf("build delete asset request: %w", err)
	}
	req.Close = true
	applyDeviceAuth(req, target)
	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("delete asset %s: %w", devicePath, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, assetUploadRetryMaxBody))
	return fmt.Errorf("delete asset %s: status=%d body=%q", devicePath, resp.StatusCode, strings.TrimSpace(string(body)))
}

func (t WiFiTransport) DeviceHealthSnapshot(target string) (DeviceHealthSnapshot, error) {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return DeviceHealthSnapshot{}, err
	}
	req, err := http.NewRequest(http.MethodGet, base+"/health", nil)
	if err != nil {
		return DeviceHealthSnapshot{}, fmt.Errorf("build device health request: %w", err)
	}
	req.Close = true
	resp, err := t.client.Do(req)
	if err != nil {
		return DeviceHealthSnapshot{}, fmt.Errorf("get device health: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return DeviceHealthSnapshot{}, fmt.Errorf("get device health: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var health DeviceHealthSnapshot
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return DeviceHealthSnapshot{}, fmt.Errorf("decode device health: %w", err)
	}
	return health, nil
}

func (t WiFiTransport) PairDevice(target string) (string, error) {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return "", err
	}
	var lastErr error
	for attempt := 1; attempt <= pairDeviceAttempts; attempt++ {
		attemptCtx, cancel := context.WithTimeout(context.Background(), defaultWiFiTimeout)
		token, pairErr := t.pairDeviceOnce(attemptCtx, base)
		cancel()
		if pairErr == nil {
			return token, nil
		}
		lastErr = pairErr
		if attempt < pairDeviceAttempts {
			time.Sleep(pairDeviceRetryDelay)
		}
	}
	return "", fmt.Errorf("pair device failed after %d attempts: %w", pairDeviceAttempts, lastErr)
}

func (t WiFiTransport) pairDeviceOnce(ctx context.Context, base string) (string, error) {
	pairURL, err := url.Parse(base + "/api/pair")
	if err != nil {
		return "", fmt.Errorf("build device pair URL: %w", err)
	}
	query := pairURL.Query()
	query.Set("api", "1")
	pairURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pairURL.String(), nil)
	if err != nil {
		return "", fmt.Errorf("build device pair request: %w", err)
	}
	req.Close = true
	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("post device pair: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("post device pair: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var payload struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode device pair: %w", err)
	}
	token := strings.TrimSpace(payload.Token)
	if !payload.OK || token == "" {
		return "", fmt.Errorf("pairing response did not include token")
	}
	return token, nil
}

func (t WiFiTransport) SendLine(target string, line []byte) error {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, base+"/frame", bytes.NewReader(line))
	if err != nil {
		return fmt.Errorf("build frame request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Close = true
	applyDeviceAuth(req, target)
	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("post frame: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("post frame: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (t WiFiTransport) UploadAsset(target, devicePath, filename string, data []byte) error {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return err
	}
	devicePath = strings.TrimSpace(devicePath)
	if devicePath == "" {
		return fmt.Errorf("asset path required")
	}
	if strings.TrimSpace(filename) == "" {
		filename = filepath.Base(devicePath)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("asset", filename)
	if err != nil {
		return fmt.Errorf("create asset multipart form: %w", err)
	}
	if _, err := part.Write(data); err != nil {
		return fmt.Errorf("write asset multipart form: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("close asset multipart form: %w", err)
	}

	endpoint := base + "/assets?path=" + url.QueryEscape(devicePath)
	contentType := writer.FormDataContentType()
	bodyBytes := body.Bytes()
	uploadClient := t.assetUploadClient(len(bodyBytes))
	var lastErr error
	for attempt := 1; attempt <= assetUploadAttempts; attempt++ {
		req, err := http.NewRequest(http.MethodPost, endpoint, newRateLimitedAssetReader(bodyBytes))
		if err != nil {
			return fmt.Errorf("build asset request %s: %w", devicePath, err)
		}
		req.Header.Set("Content-Type", contentType)
		req.Close = true
		req.ContentLength = int64(len(bodyBytes))
		applyDeviceAuth(req, target)
		resp, err := uploadClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("post asset %s: %w", devicePath, err)
			if !retryableAssetError(err) || attempt >= assetUploadAttempts {
				return lastErr
			}
			t.noteAssetUploadRetry(AssetUploadRetry{
				DevicePath:  devicePath,
				Attempt:     attempt,
				MaxAttempts: assetUploadAttempts,
				Err:         err,
			})
			time.Sleep(assetUploadRetryDelay)
			continue
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			_ = resp.Body.Close()
			return nil
		}
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, assetUploadRetryMaxBody))
		_ = resp.Body.Close()
		lastErr = fmt.Errorf("post asset %s: status=%d body=%q", devicePath, resp.StatusCode, strings.TrimSpace(string(respBody)))
		if !retryableAssetStatus(resp.StatusCode) || attempt >= assetUploadAttempts {
			return lastErr
		}
		t.noteAssetUploadRetry(AssetUploadRetry{
			DevicePath:  devicePath,
			Attempt:     attempt,
			MaxAttempts: assetUploadAttempts,
			StatusCode:  resp.StatusCode,
		})
		time.Sleep(assetUploadRetryDelay)
	}
	return lastErr
}

func (t WiFiTransport) assetUploadClient(bodyBytes int) *http.Client {
	client := *t.client
	timeout := assetUploadTimeoutForBytes(bodyBytes)
	if client.Timeout == 0 || client.Timeout < timeout {
		client.Timeout = timeout
	}
	return &client
}

func assetUploadTimeoutForBytes(bodyBytes int) time.Duration {
	if bodyBytes <= 0 {
		return assetUploadMinTimeout
	}
	timeout := time.Duration(bodyBytes)*time.Second/time.Duration(assetUploadBytesPerSec) + assetUploadTimeoutGrace
	if timeout < assetUploadMinTimeout {
		return assetUploadMinTimeout
	}
	if timeout > assetUploadMaxTimeout {
		return assetUploadMaxTimeout
	}
	return timeout
}

func retryableAssetError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, io.EOF) ||
		errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && (netErr.Timeout() || netErr.Temporary()) {
		return true
	}
	message := strings.ToLower(err.Error())
	for _, transient := range []string{
		"connection reset",
		"connection refused",
		"broken pipe",
		"server closed idle connection",
		"unexpected eof",
	} {
		if strings.Contains(message, transient) {
			return true
		}
	}
	return false
}

type rateLimitedAssetReader struct {
	reader *bytes.Reader
}

func newRateLimitedAssetReader(data []byte) io.Reader {
	return &rateLimitedAssetReader{reader: bytes.NewReader(data)}
}

func (r *rateLimitedAssetReader) Read(p []byte) (int, error) {
	if len(p) > assetUploadReadChunk {
		p = p[:assetUploadReadChunk]
	}
	n, err := r.reader.Read(p)
	if n > 0 {
		time.Sleep(time.Duration(n) * time.Second / time.Duration(assetUploadBytesPerSec))
	}
	return n, err
}

func (t WiFiTransport) noteAssetUploadRetry(retry AssetUploadRetry) {
	if t.assetUploadRetryObserver != nil {
		t.assetUploadRetryObserver(retry)
	}
}

func retryableAssetStatus(statusCode int) bool {
	return statusCode == http.StatusRequestTimeout ||
		statusCode == http.StatusTooManyRequests ||
		(statusCode >= 500 && statusCode <= 599)
}

func (t WiFiTransport) ActivateStoredTheme(target, devicePath string) error {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(struct {
		Path string `json:"path"`
	}{Path: strings.TrimSpace(devicePath)})
	if err != nil {
		return fmt.Errorf("marshal theme activation: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, base+"/theme/active", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build theme activation request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Close = true
	applyDeviceAuth(req, target)
	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("post theme activation: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("post theme activation: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func applyDeviceAuth(req *http.Request, rawTarget string) {
	if token := deviceAuthTokenForTarget(rawTarget); token != "" {
		req.Header.Set(deviceAuthHeader, token)
	}
}

func deviceAuthTokenForTarget(raw string) string {
	token := deviceAuthTokenFromTarget(raw)
	if token != "" {
		return token
	}
	return strings.TrimSpace(os.Getenv(deviceAuthEnv))
}

func deviceAuthTokenFromTarget(raw string) string {
	target := strings.TrimSpace(raw)
	if target == "" {
		return ""
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(parsed.Query().Get("token"))
}

func normalizeWiFiTargetWithToken(raw string) (string, error) {
	base, err := normalizeWiFiTarget(raw)
	if err != nil {
		return "", err
	}
	token := deviceAuthTokenFromTarget(raw)
	if token == "" {
		return base, nil
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func normalizeWiFiTarget(raw string) (string, error) {
	target := strings.TrimSpace(raw)
	if target == "" {
		return "", fmt.Errorf("wifi target required, for example http://192.168.178.123")
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return "", fmt.Errorf("parse wifi target: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported wifi target scheme %q", parsed.Scheme)
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return "", fmt.Errorf("wifi target host required")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}
