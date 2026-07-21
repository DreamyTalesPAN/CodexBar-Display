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
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
)

const (
	Kind          = "vibetv-theme-pack"
	SchemaVersion = 1
	// MaxZipBytes limits compressed theme-pack ZIP input.
	MaxZipBytes = 32 << 20
	// MaxUncompressedZipBytes limits total expanded ZIP content.
	MaxUncompressedZipBytes = 32 << 20

	maxDevicePathChars = 31
	maxZipEntries      = 256
)

var packIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9\-_]{2,63}$`)
var spriteColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

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

func (p *Pack) ValidateAgainstCapabilities(caps protocol.DeviceCapabilities) error {
	if p == nil {
		return errors.New("theme pack is nil")
	}
	if err := themespec.ValidateStoredAgainstCapabilities(p.ThemeSpec, p.ThemeSpecRaw, caps); err != nil {
		return err
	}
	gifRefs := referencedGIFAssets(p.ThemeSpec)
	assetsByPath := make(map[string]File, len(p.Assets))
	for _, asset := range p.Assets {
		assetsByPath[asset.Entry.Path] = asset
	}
	paths := make([]string, 0, len(gifRefs))
	for assetPath := range gifRefs {
		paths = append(paths, assetPath)
	}
	sort.Strings(paths)
	for _, assetPath := range paths {
		asset, ok := assetsByPath[assetPath]
		if !ok {
			return fmt.Errorf("referenced GIF asset %s is missing", assetPath)
		}
		if caps.MaxThemeGifBytes > 0 && len(asset.Data) > caps.MaxThemeGifBytes {
			return fmt.Errorf("GIF asset %s exceeds device limit: size=%d limit=%d", asset.Entry.Path, len(asset.Data), caps.MaxThemeGifBytes)
		}
		requiredBits, err := maxGIFLZWCodeWidth(asset.Data)
		if err != nil {
			return fmt.Errorf("GIF asset %s is malformed: %w", asset.Entry.Path, err)
		}
		if caps.MaxThemeGifLzwBits > 0 && requiredBits > caps.MaxThemeGifLzwBits {
			return fmt.Errorf("GIF asset %s requires LZW code width %d bits, device supports at most %d bits", asset.Entry.Path, requiredBits, caps.MaxThemeGifLzwBits)
		}
	}
	return nil
}

func Load(packPath string) (*Pack, error) {
	return LoadVerified(packPath, "", 0)
}

// LoadVerified loads a pack and verifies publisher catalog metadata before
// parsing any ZIP entries. Remote packs always require both values.
func LoadVerified(packPath, expectedSHA256 string, expectedBytes int64) (*Pack, error) {
	packPath = strings.TrimSpace(packPath)
	if packPath == "" {
		return nil, errors.New("missing theme pack path")
	}
	if isHTTPURL(packPath) {
		if strings.TrimSpace(expectedSHA256) == "" || expectedBytes <= 0 {
			return nil, errors.New("remote theme pack requires catalog sha256 and byte size")
		}
		return loadRemoteZip(packPath, expectedSHA256, expectedBytes)
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
	if strings.TrimSpace(expectedSHA256) == "" && expectedBytes <= 0 {
		return loadZip(packPath)
	}
	data, err := os.ReadFile(packPath)
	if err != nil {
		return nil, err
	}
	if err := verifyPackArchive(data, expectedSHA256, expectedBytes); err != nil {
		return nil, err
	}
	return loadZipBytes(packPath, data)
}

func isHTTPURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")
}

func loadRemoteZip(packURL, expectedSHA256 string, expectedBytes int64) (*Pack, error) {
	if err := validatePublicHTTPSReference(packURL); err != nil {
		return nil, fmt.Errorf("download theme pack zip: %w", err)
	}
	client := secureRemoteClient(30 * time.Second)
	return loadRemoteZipWithClient(client, packURL, expectedSHA256, expectedBytes)
}

func loadRemoteZipWithClient(client *http.Client, packURL, expectedSHA256 string, expectedBytes int64) (*Pack, error) {
	resp, err := client.Get(packURL)
	if err != nil {
		return nil, fmt.Errorf("download theme pack zip: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("download theme pack zip: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, MaxZipBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read theme pack zip: %w", err)
	}
	if err := verifyPackArchive(data, expectedSHA256, expectedBytes); err != nil {
		return nil, err
	}
	return loadZipBytes(packURL, data)
}

func verifyPackArchive(data []byte, expectedSHA256 string, expectedBytes int64) error {
	if expectedBytes <= 0 || int64(len(data)) != expectedBytes {
		return fmt.Errorf("theme pack byte size mismatch: got=%d expected=%d", len(data), expectedBytes)
	}
	expectedSHA256 = strings.ToLower(strings.TrimSpace(expectedSHA256))
	if len(expectedSHA256) != sha256.Size*2 {
		return errors.New("theme pack expected sha256 is invalid")
	}
	if _, err := hex.DecodeString(expectedSHA256); err != nil {
		return errors.New("theme pack expected sha256 is invalid")
	}
	got := sha256.Sum256(data)
	if hex.EncodeToString(got[:]) != expectedSHA256 {
		return fmt.Errorf("theme pack sha256 mismatch: got=%s expected=%s", hex.EncodeToString(got[:]), expectedSHA256)
	}
	return nil
}

func loadZip(packPath string) (*Pack, error) {
	reader, err := zip.OpenReader(packPath)
	if err != nil {
		return nil, fmt.Errorf("open theme pack zip: %w", err)
	}
	defer reader.Close()
	return loadZipFiles(reader.File)
}

// LoadZipBytes validates and loads an in-memory theme-pack ZIP. The same size
// limit applies to remote and locally uploaded packs.
func LoadZipBytes(data []byte) (*Pack, error) {
	return loadZipBytes("memory", data)
}

// LoadZipBytesVerified validates publisher metadata before parsing ZIP entries.
func LoadZipBytesVerified(data []byte, expectedSHA256 string, expectedBytes int64) (*Pack, error) {
	if err := verifyPackArchive(data, expectedSHA256, expectedBytes); err != nil {
		return nil, err
	}
	return loadZipBytes("memory", data)
}

func loadZipBytes(source string, data []byte) (*Pack, error) {
	if len(data) == 0 {
		return nil, errors.New("theme pack zip is empty")
	}
	if len(data) > MaxZipBytes {
		return nil, fmt.Errorf("theme pack zip too large: got=%d limit=%d", len(data), MaxZipBytes)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("open theme pack zip %s: %w", source, err)
	}
	return loadZipFiles(reader.File)
}

func loadZipFiles(zipFiles []*zip.File) (*Pack, error) {
	if err := validateZipEntries(zipFiles, MaxUncompressedZipBytes); err != nil {
		return nil, err
	}
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
		data, err := io.ReadAll(io.LimitReader(rc, MaxUncompressedZipBytes+1))
		if err != nil {
			return nil, err
		}
		if len(data) > MaxUncompressedZipBytes {
			return nil, fmt.Errorf("theme pack ZIP entry %s is too large", name)
		}
		return data, nil
	})
}

func validateZipEntries(zipFiles []*zip.File, maxUncompressedBytes int) error {
	if len(zipFiles) > maxZipEntries {
		return fmt.Errorf("theme pack ZIP has too many entries: got=%d limit=%d", len(zipFiles), maxZipEntries)
	}
	limit := uint64(maxUncompressedBytes)
	var total uint64
	for _, file := range zipFiles {
		if file.FileInfo().IsDir() {
			continue
		}
		size := file.UncompressedSize64
		if size > limit {
			return fmt.Errorf("theme pack ZIP entry %s is too large: got=%d limit=%d", file.Name, size, limit)
		}
		if total > limit-size {
			return fmt.Errorf("theme pack ZIP expands beyond limit: got>%d limit=%d", limit, limit)
		}
		total += size
	}
	return nil
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
	if err := validateSpriteAssets(spec, assets); err != nil {
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

func validateSpriteAssets(spec themespec.Spec, assets []File) error {
	refs := referencedSpriteAssets(spec)
	if len(refs) == 0 {
		return nil
	}
	for _, asset := range assets {
		if _, ok := refs[asset.Entry.Path]; !ok {
			continue
		}
		if err := validateSpriteAsset(asset.Entry.Path, asset.Data); err != nil {
			return err
		}
	}
	return nil
}

func referencedSpriteAssets(spec themespec.Spec) map[string]struct{} {
	refs := map[string]struct{}{}
	for _, primitive := range spec.Primitives {
		if primitive.Type != "sprite" && primitive.Type != "image" {
			continue
		}
		if primitive.AssetPath != "" {
			refs[primitive.AssetPath] = struct{}{}
		}
		for _, assetPath := range primitive.StateAssets {
			refs[assetPath] = struct{}{}
		}
	}
	return refs
}

func validateSpriteAsset(devicePath string, data []byte) error {
	lowerPath := strings.ToLower(devicePath)
	if !strings.HasSuffix(lowerPath, ".cbi") && !strings.HasSuffix(lowerPath, ".cba") {
		return fmt.Errorf("sprite asset %s must be .cbi or .cba", devicePath)
	}
	lines := spriteAssetLines(data)
	if len(lines) == 0 {
		return fmt.Errorf("sprite asset %s is empty", devicePath)
	}
	switch lines[0] {
	case "CBI1":
		return validateStaticSpriteAsset(devicePath, lines)
	case "CBA1":
		return validateAnimatedSpriteAsset(devicePath, lines)
	default:
		return fmt.Errorf("sprite asset %s has unsupported header %q", devicePath, lines[0])
	}
}

func spriteAssetLines(data []byte) []string {
	raw := strings.ReplaceAll(string(data), "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, "\n")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

func validateStaticSpriteAsset(devicePath string, lines []string) error {
	width, height, _, _, err := parseSpriteDimensions(lines[1:], false)
	if err != nil {
		return fmt.Errorf("sprite asset %s: %w", devicePath, err)
	}
	paletteSize, rowStart, err := parseSpritePalette(devicePath, lines, 3)
	if err != nil {
		return err
	}
	if got, want := len(lines)-rowStart, height; got != want {
		return fmt.Errorf("sprite asset %s has %d rows, want %d", devicePath, got, want)
	}
	return validateSpriteRows(devicePath, lines[rowStart:], width, paletteSize)
}

func validateAnimatedSpriteAsset(devicePath string, lines []string) error {
	width, height, frameCount, fps, err := parseSpriteDimensions(lines[1:], true)
	if err != nil {
		return fmt.Errorf("sprite asset %s: %w", devicePath, err)
	}
	if frameCount <= 0 || frameCount > 64 {
		return fmt.Errorf("sprite asset %s frame count must be 1..64", devicePath)
	}
	if fps < 0 || fps > 30 {
		return fmt.Errorf("sprite asset %s fps must be 0..30", devicePath)
	}
	paletteSize, rowStart, err := parseSpritePalette(devicePath, lines, 3)
	if err != nil {
		return err
	}
	if got, want := len(lines)-rowStart, height*frameCount; got != want {
		return fmt.Errorf("sprite asset %s has %d frame rows, want %d", devicePath, got, want)
	}
	return validateSpriteRows(devicePath, lines[rowStart:], width, paletteSize)
}

func parseSpriteDimensions(lines []string, animated bool) (width, height, frameCount, fps int, err error) {
	if len(lines) == 0 {
		return 0, 0, 0, 0, errors.New("missing dimensions")
	}
	fields := strings.Fields(lines[0])
	want := 2
	if animated {
		want = 4
	}
	if len(fields) != want {
		return 0, 0, 0, 0, fmt.Errorf("dimensions must have %d fields", want)
	}
	width, err = strconv.Atoi(fields[0])
	if err != nil {
		return 0, 0, 0, 0, errors.New("width must be numeric")
	}
	height, err = strconv.Atoi(fields[1])
	if err != nil {
		return 0, 0, 0, 0, errors.New("height must be numeric")
	}
	if width <= 0 || height <= 0 {
		return 0, 0, 0, 0, errors.New("width/height must be > 0")
	}
	if !animated {
		return width, height, 1, 0, nil
	}
	frameCount, err = strconv.Atoi(fields[2])
	if err != nil {
		return 0, 0, 0, 0, errors.New("frame count must be numeric")
	}
	fps, err = strconv.Atoi(fields[3])
	if err != nil {
		return 0, 0, 0, 0, errors.New("fps must be numeric")
	}
	return width, height, frameCount, fps, nil
}

func parseSpritePalette(devicePath string, lines []string, index int) (paletteSize int, rowStart int, err error) {
	if len(lines) <= index {
		return 0, 0, fmt.Errorf("sprite asset %s missing palette size", devicePath)
	}
	paletteSize, err = strconv.Atoi(lines[index-1])
	if err != nil || paletteSize <= 0 || paletteSize > 26 {
		return 0, 0, fmt.Errorf("sprite asset %s palette size must be 1..26", devicePath)
	}
	rowStart = index + paletteSize
	if len(lines) < rowStart {
		return 0, 0, fmt.Errorf("sprite asset %s missing palette colors", devicePath)
	}
	for _, color := range lines[index:rowStart] {
		if !spriteColorPattern.MatchString(color) {
			return 0, 0, fmt.Errorf("sprite asset %s has invalid palette color %q", devicePath, color)
		}
	}
	return paletteSize, rowStart, nil
}

func validateSpriteRows(devicePath string, rows []string, width int, paletteSize int) error {
	for rowIndex, row := range rows {
		offset := 0
		for i := 0; i < len(row); {
			runLength := 0
			hasRunLength := false
			for i < len(row) && row[i] >= '0' && row[i] <= '9' {
				hasRunLength = true
				runLength = (runLength * 10) + int(row[i]-'0')
				i++
			}
			if !hasRunLength {
				runLength = 1
			}
			if runLength <= 0 || i >= len(row) || offset+runLength > width {
				return fmt.Errorf("sprite asset %s row %d has invalid RLE run", devicePath, rowIndex)
			}
			token := row[i]
			i++
			if token != '.' {
				if token < 'a' || token > 'z' {
					return fmt.Errorf("sprite asset %s row %d has invalid token %q", devicePath, rowIndex, token)
				}
				if int(token-'a') >= paletteSize {
					return fmt.Errorf("sprite asset %s row %d uses token %q outside palette", devicePath, rowIndex, token)
				}
			}
			offset += runLength
		}
		if offset != width {
			return fmt.Errorf("sprite asset %s row %d has width %d, want %d", devicePath, rowIndex, offset, width)
		}
	}
	return nil
}

func referencedGIFAssets(spec themespec.Spec) map[string]struct{} {
	refs := map[string]struct{}{}
	for _, primitive := range spec.Primitives {
		if primitive.Type != "gif" {
			continue
		}
		if primitive.AssetPath != "" {
			refs[primitive.AssetPath] = struct{}{}
		}
		for _, assetPath := range primitive.StateAssets {
			refs[assetPath] = struct{}{}
		}
	}
	return refs
}
