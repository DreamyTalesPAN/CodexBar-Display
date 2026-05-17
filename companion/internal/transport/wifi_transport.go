package transport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const defaultWiFiTimeout = 5 * time.Second

type WiFiTransport struct {
	client *http.Client
}

func NewWiFiTransport() DeviceTransport {
	return WiFiTransport{
		client: &http.Client{Timeout: defaultWiFiTimeout},
	}
}

func NewWiFiTransportWithClient(client *http.Client) WiFiTransport {
	if client == nil {
		client = &http.Client{Timeout: defaultWiFiTimeout}
	}
	return WiFiTransport{client: client}
}

func (WiFiTransport) Name() string {
	return "wifi"
}

func (t WiFiTransport) ResolvePort(requested string) (string, error) {
	return normalizeWiFiTarget(requested)
}

func (t WiFiTransport) DeviceCapabilities(target string) (protocol.DeviceCapabilities, error) {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return protocol.DeviceCapabilities{}, err
	}
	resp, err := t.client.Get(base + "/hello")
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

func (t WiFiTransport) SendLine(target string, line []byte) error {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return err
	}
	resp, err := t.client.Post(base+"/frame", "application/json", bytes.NewReader(line))
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
	resp, err := t.client.Post(endpoint, writer.FormDataContentType(), &body)
	if err != nil {
		return fmt.Errorf("post asset %s: %w", devicePath, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("post asset %s: status=%d body=%q", devicePath, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
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
	resp, err := t.client.Post(base+"/theme/active", "application/json", bytes.NewReader(payload))
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
