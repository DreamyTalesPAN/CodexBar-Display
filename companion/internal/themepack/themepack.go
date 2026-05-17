package themepack

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
)

const (
	Kind          = "vibetv-theme-pack"
	SchemaVersion = 1

	maxDevicePathChars = 31
	maxRemotePackBytes = 32 << 20
)

var packIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9\-_]{2,63}$`)

type Manifest struct {
	Kind        string      `json:"kind"`
	Schema      int         `json:"schemaVersion"`
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Version     string      `json:"version,omitempty"`
	MinFirmware string      `json:"minFirmware,omitempty"`
	ThemeSpec   FileEntry   `json:"themeSpec"`
	Assets      []FileEntry `json:"assets,omitempty"`
}

type FileEntry struct {
	Path        string `json:"path"`
	File        string `json:"file"`
	Bytes       int64  `json:"bytes,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
	ContentType string `json:"contentType,omitempty"`
}

type File struct {
	Entry FileEntry
	Data  []byte
}

type Pack struct {
	Manifest      Manifest
	ThemeSpec     themespec.Spec
	ThemeSpecRaw  []byte
	ThemeSpecFile File
	Assets        []File
}

func Load(packPath string) (*Pack, error) {
	packPath = strings.TrimSpace(packPath)
	if packPath == "" {
		return nil, errors.New("missing theme pack path")
	}
	if isHTTPURL(packPath) {
		return loadRemoteZip(packPath)
	}
	info, err := os.Stat(packPath)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return loadFromReader(func(name string) ([]byte, error) {
			return os.ReadFile(filepath.Join(packPath, filepath.FromSlash(name)))
		})
	}
	return loadZip(packPath)
}

func isHTTPURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")
}

func loadRemoteZip(packURL string) (*Pack, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(packURL)
	if err != nil {
		return nil, fmt.Errorf("download theme pack zip: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("download theme pack zip: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxRemotePackBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read theme pack zip: %w", err)
	}
	if len(data) > maxRemotePackBytes {
		return nil, fmt.Errorf("theme pack zip too large: got>%d limit=%d", maxRemotePackBytes, maxRemotePackBytes)
	}
	return loadZipBytes(packURL, data)
}

func loadZip(packPath string) (*Pack, error) {
	reader, err := zip.OpenReader(packPath)
	if err != nil {
		return nil, fmt.Errorf("open theme pack zip: %w", err)
	}
	defer reader.Close()
	return loadZipFiles(reader.File)
}

func loadZipBytes(source string, data []byte) (*Pack, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("open theme pack zip %s: %w", source, err)
	}
	return loadZipFiles(reader.File)
}

func loadZipFiles(zipFiles []*zip.File) (*Pack, error) {
	files := make(map[string]*zip.File, len(zipFiles))
	for _, file := range zipFiles {
		clean, err := cleanPackFile(file.Name)
		if err != nil || file.FileInfo().IsDir() {
			continue
		}
		files[clean] = file
	}
	return loadFromReader(func(name string) ([]byte, error) {
		file, ok := files[name]
		if !ok {
			return nil, os.ErrNotExist
		}
		rc, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		return io.ReadAll(rc)
	})
}

func loadFromReader(readFile func(string) ([]byte, error)) (*Pack, error) {
	manifestRaw, err := readFile("manifest.json")
	if err != nil {
		return nil, fmt.Errorf("read manifest.json: %w", err)
	}
	var manifest Manifest
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
		return nil, fmt.Errorf("parse manifest.json: %w", err)
	}

	if err := validateManifestFields(manifest); err != nil {
		return nil, err
	}

	themeSpecFile, err := loadEntry(readFile, manifest.ThemeSpec)
	if err != nil {
		return nil, fmt.Errorf("themeSpec: %w", err)
	}
	spec, raw, err := themespec.Parse(themeSpecFile.Data)
	if err != nil {
		return nil, err
	}
	if err := themespec.Validate(spec); err != nil {
		return nil, err
	}

	assets := make([]File, 0, len(manifest.Assets))
	seenDevicePaths := map[string]struct{}{themeSpecFile.Entry.Path: {}}
	for index, entry := range manifest.Assets {
		file, err := loadEntry(readFile, entry)
		if err != nil {
			return nil, fmt.Errorf("assets[%d]: %w", index, err)
		}
		if _, exists := seenDevicePaths[file.Entry.Path]; exists {
			return nil, fmt.Errorf("assets[%d]: duplicate device path %s", index, file.Entry.Path)
		}
		seenDevicePaths[file.Entry.Path] = struct{}{}
		assets = append(assets, file)
	}
	if err := validateReferencedAssets(spec, assets); err != nil {
		return nil, err
	}

	return &Pack{
		Manifest:      manifest,
		ThemeSpec:     spec,
		ThemeSpecRaw:  []byte(raw),
		ThemeSpecFile: themeSpecFile,
		Assets:        assets,
	}, nil
}

func validateManifestFields(manifest Manifest) error {
	if manifest.Kind != Kind {
		return fmt.Errorf("manifest kind %q unsupported (expected %q)", manifest.Kind, Kind)
	}
	if manifest.Schema != SchemaVersion {
		return fmt.Errorf("schemaVersion=%d unsupported (expected %d)", manifest.Schema, SchemaVersion)
	}
	if !packIDPattern.MatchString(strings.TrimSpace(manifest.ID)) {
		return errors.New("id must match [a-z0-9-_]{3,64}")
	}
	if strings.TrimSpace(manifest.Name) == "" {
		return errors.New("name is required")
	}
	return nil
}

func loadEntry(readFile func(string) ([]byte, error), entry FileEntry) (File, error) {
	entry.Path = strings.TrimSpace(entry.Path)
	entry.File = strings.TrimSpace(entry.File)
	entry.SHA256 = strings.TrimSpace(strings.ToLower(entry.SHA256))
	if err := validateDevicePath(entry.Path); err != nil {
		return File{}, err
	}
	cleanFile, err := cleanPackFile(entry.File)
	if err != nil {
		return File{}, err
	}
	entry.File = cleanFile
	data, err := readFile(cleanFile)
	if err != nil {
		return File{}, fmt.Errorf("read %s: %w", cleanFile, err)
	}
	if entry.Bytes > 0 && int64(len(data)) != entry.Bytes {
		return File{}, fmt.Errorf("%s byte size mismatch: got=%d expected=%d", cleanFile, len(data), entry.Bytes)
	}
	if entry.SHA256 != "" {
		sum := sha256.Sum256(data)
		got := hex.EncodeToString(sum[:])
		if got != entry.SHA256 {
			return File{}, fmt.Errorf("%s sha256 mismatch: got=%s expected=%s", cleanFile, got, entry.SHA256)
		}
	}
	return File{Entry: entry, Data: data}, nil
}

func validateDevicePath(devicePath string) error {
	if devicePath == "" {
		return errors.New("device path is required")
	}
	if len(devicePath) > maxDevicePathChars {
		return fmt.Errorf("device path too long for ESP8266 LittleFS: %s (%d/%d)", devicePath, len(devicePath), maxDevicePathChars)
	}
	if !strings.HasPrefix(devicePath, "/themes/") {
		return fmt.Errorf("device path must start with /themes/: %s", devicePath)
	}
	if strings.Contains(devicePath, "..") ||
		strings.Contains(devicePath, "\\") ||
		strings.Contains(devicePath, "//") ||
		strings.HasSuffix(devicePath, "/") {
		return fmt.Errorf("unsafe device path: %s", devicePath)
	}
	return nil
}

func cleanPackFile(name string) (string, error) {
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	if name == "" {
		return "", errors.New("file is required")
	}
	if strings.HasPrefix(name, "/") {
		return "", fmt.Errorf("file path must be relative: %s", name)
	}
	clean := path.Clean(name)
	if clean == "." || strings.HasPrefix(clean, "../") || clean == ".." {
		return "", fmt.Errorf("unsafe file path: %s", name)
	}
	return clean, nil
}

func validateReferencedAssets(spec themespec.Spec, assets []File) error {
	available := make(map[string]struct{}, len(assets))
	for _, asset := range assets {
		available[asset.Entry.Path] = struct{}{}
	}
	for index, primitive := range spec.Primitives {
		if primitive.Type != "gif" && primitive.Type != "sprite" && primitive.Type != "image" {
			continue
		}
		if primitive.AssetPath != "" {
			if _, ok := available[primitive.AssetPath]; !ok {
				return fmt.Errorf("primitives[%d] references %s, but manifest assets do not include it", index, primitive.AssetPath)
			}
		}
		for state, assetPath := range primitive.StateAssets {
			if _, ok := available[assetPath]; !ok {
				return fmt.Errorf("primitives[%d].stateAssets[%s] references %s, but manifest assets do not include it", index, state, assetPath)
			}
		}
	}
	return nil
}
