package main

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

type releaseHTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type rateLimitedReader struct {
	r              io.Reader
	bytesPerSecond int64
	started        time.Time
	sent           int64
}

func newRateLimitedReader(r io.Reader, bytesPerSecond int64) io.Reader {
	if bytesPerSecond <= 0 {
		return r
	}
	return &rateLimitedReader{
		r:              r,
		bytesPerSecond: bytesPerSecond,
		started:        time.Now(),
	}
}

func (r *rateLimitedReader) Read(p []byte) (int, error) {
	if len(p) > 4096 {
		p = p[:4096]
	}
	n, err := r.r.Read(p)
	if n > 0 {
		r.sent += int64(n)
		expectedElapsed := time.Duration(r.sent) * time.Second / time.Duration(r.bytesPerSecond)
		if sleep := time.Until(r.started.Add(expectedElapsed)); sleep > 0 {
			time.Sleep(sleep)
		}
	}
	return n, err
}

type releaseFirmwareManifest struct {
	SchemaVersion   int                       `json:"schemaVersion"`
	Release         string                    `json:"release"`
	ProtocolVersion int                       `json:"protocolVersion"`
	Artifacts       []releaseFirmwareArtifact `json:"artifacts"`
}

type releaseFirmwareArtifact struct {
	FirmwareEnv     string `json:"firmwareEnv"`
	Board           string `json:"board"`
	FirmwareVersion string `json:"firmwareVersion"`
	Severity        string `json:"severity"`
	Message         string `json:"message"`
	Asset           string `json:"asset"`
	FirmwareURL     string `json:"firmwareUrl"`
	FilesystemURL   string `json:"filesystemUrl"`
	SHA256          string `json:"sha256"`
}

func normalizeReleaseRepo(raw string) (string, error) {
	repo := strings.TrimSpace(raw)
	repo = strings.TrimPrefix(repo, "https://github.com/")
	repo = strings.TrimSuffix(repo, ".git")
	repo = strings.Trim(repo, "/")
	parts := strings.Split(repo, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", fmt.Errorf("invalid repository %q", raw)
	}
	return parts[0] + "/" + parts[1], nil
}

func normalizeReleaseVersion(raw string) string {
	version := strings.TrimSpace(raw)
	version = strings.TrimPrefix(version, "v")
	return version
}

func fetchLatestReleaseVersion(ctx context.Context, repo string) (tag, version string, err error) {
	endpoint := fmt.Sprintf("%s/repos/%s/releases/latest", githubAPIBaseURL, repo)
	var payload struct {
		TagName string `json:"tag_name"`
	}
	if err := fetchJSON(ctx, endpoint, &payload); err != nil {
		return "", "", err
	}
	tag = strings.TrimSpace(payload.TagName)
	if tag == "" {
		return "", "", fmt.Errorf("latest release response for %s did not include tag_name", repo)
	}
	return tag, normalizeReleaseVersion(tag), nil
}

func downloadReleaseFirmware(ctx context.Context, home, repo, releaseTag, version, firmwareEnv string) (imagePath, manifestPath string, artifact releaseFirmwareArtifact, err error) {
	version = normalizeReleaseVersion(version)
	releaseTag = strings.TrimSpace(releaseTag)
	if version == "" && releaseTag == "" {
		return "", "", releaseFirmwareArtifact{}, errors.New("release tag or firmware version cannot be empty")
	}
	if releaseTag == "" {
		releaseTag = "v" + version
	}

	releaseDir := filepath.Join(
		runtimepaths.Root(home),
		"releases",
		"firmware",
		sanitizePathToken(releaseTag),
	)
	if err := os.MkdirAll(releaseDir, 0o755); err != nil {
		return "", "", releaseFirmwareArtifact{}, err
	}

	manifestAsset := "firmware-manifest.json"
	if version != "" {
		manifestAsset = fmt.Sprintf("firmware-manifest-v%s.json", version)
	}
	manifestPath = filepath.Join(releaseDir, manifestAsset)
	manifestURL := githubReleaseAssetURL(repo, releaseTag, manifestAsset)
	if err := downloadURLToFile(ctx, manifestURL, manifestPath, 0o644); err != nil {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("download manifest: %w", err)
	}

	var manifest releaseFirmwareManifest
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", "", releaseFirmwareArtifact{}, err
	}
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("parse firmware manifest: %w", err)
	}

	artifact, err = selectReleaseFirmwareArtifact(manifest, firmwareEnv, version)
	if err != nil {
		return "", "", releaseFirmwareArtifact{}, err
	}

	imagePath = filepath.Join(releaseDir, artifact.Asset)
	imageURL := strings.TrimSpace(artifact.FirmwareURL)
	if imageURL == "" {
		imageURL = githubReleaseAssetURL(repo, releaseTag, artifact.Asset)
	}
	if err := downloadURLToFile(ctx, imageURL, imagePath, 0o644); err != nil {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("download firmware image: %w", err)
	}

	actualSHA, err := sha256File(imagePath)
	if err != nil {
		return "", "", releaseFirmwareArtifact{}, err
	}
	expectedSHA := strings.ToLower(strings.TrimSpace(artifact.SHA256))
	if expectedSHA == "" {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("manifest artifact %q has empty sha256", artifact.Asset)
	}
	if actualSHA != expectedSHA {
		return "", "", releaseFirmwareArtifact{}, fmt.Errorf("sha256 mismatch for %s: expected %s actual %s", artifact.Asset, expectedSHA, actualSHA)
	}
	if strings.HasSuffix(strings.ToLower(imagePath), ".gz") {
		rawImagePath := strings.TrimSuffix(imagePath, filepath.Ext(imagePath))
		if err := gunzipFile(imagePath, rawImagePath, 0o644); err != nil {
			return "", "", releaseFirmwareArtifact{}, fmt.Errorf("decompress firmware image: %w", err)
		}
		imagePath = rawImagePath
	}

	return imagePath, manifestPath, artifact, nil
}

func githubReleaseAssetURL(repo, releaseTag, asset string) string {
	return fmt.Sprintf(
		"%s/%s/releases/download/%s/%s",
		githubDownloadBaseURL,
		repo,
		url.PathEscape(strings.TrimSpace(releaseTag)),
		url.PathEscape(strings.TrimSpace(asset)),
	)
}

func selectReleaseFirmwareArtifact(manifest releaseFirmwareManifest, firmwareEnv, version string) (releaseFirmwareArtifact, error) {
	firmwareEnv = strings.TrimSpace(firmwareEnv)
	version = normalizeReleaseVersion(version)
	for _, artifact := range manifest.Artifacts {
		if strings.TrimSpace(artifact.FirmwareEnv) != firmwareEnv {
			continue
		}
		if version != "" && normalizeReleaseVersion(artifact.FirmwareVersion) != version {
			return releaseFirmwareArtifact{}, fmt.Errorf(
				"manifest artifact for %s has firmware version %q, expected %q",
				firmwareEnv,
				artifact.FirmwareVersion,
				version,
			)
		}
		if strings.TrimSpace(artifact.Asset) == "" {
			return releaseFirmwareArtifact{}, fmt.Errorf("manifest artifact for %s has empty asset", firmwareEnv)
		}
		if strings.TrimSpace(artifact.SHA256) == "" {
			return releaseFirmwareArtifact{}, fmt.Errorf("manifest artifact for %s has empty sha256", firmwareEnv)
		}
		return artifact, nil
	}
	return releaseFirmwareArtifact{}, fmt.Errorf("no firmware artifact for env %q in release manifest", firmwareEnv)
}

func selectLatestFirmwareArtifactForBoard(manifest releaseFirmwareManifest, board string) (releaseFirmwareArtifact, error) {
	board = strings.TrimSpace(strings.ToLower(board))
	if board == "" {
		return releaseFirmwareArtifact{}, errors.New("device board is empty")
	}

	var selected releaseFirmwareArtifact
	var selectedVersion *versioning.SemVer
	for _, artifact := range manifest.Artifacts {
		if strings.TrimSpace(strings.ToLower(artifact.Board)) != board {
			continue
		}
		parsed, err := versioning.ParseSemVer(artifact.FirmwareVersion)
		if err != nil {
			continue
		}
		if selectedVersion == nil || parsed.Compare(*selectedVersion) > 0 {
			candidate := parsed
			selectedVersion = &candidate
			selected = artifact
		}
	}
	if selectedVersion == nil {
		return releaseFirmwareArtifact{}, fmt.Errorf("no firmware artifact for board %q", board)
	}
	if strings.TrimSpace(selected.SHA256) == "" {
		return releaseFirmwareArtifact{}, fmt.Errorf("manifest artifact for board %q has empty sha256", board)
	}
	return selected, nil
}

func fetchReleaseFirmwareManifestURL(ctx context.Context, manifestURL string) (releaseFirmwareManifest, error) {
	manifestURL = strings.TrimSpace(manifestURL)
	if manifestURL == "" {
		return releaseFirmwareManifest{}, errors.New("manifest URL cannot be empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return releaseFirmwareManifest{}, err
	}
	req.Header.Set("User-Agent", "codexbar-display-update")
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return releaseFirmwareManifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return releaseFirmwareManifest{}, fmt.Errorf("GET %s returned %s body=%q", manifestURL, resp.Status, strings.TrimSpace(string(body)))
	}
	var manifest releaseFirmwareManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(&manifest); err != nil {
		return releaseFirmwareManifest{}, err
	}
	return manifest, nil
}

func downloadManifestFirmwareArtifact(ctx context.Context, home string, manifest releaseFirmwareManifest, artifact releaseFirmwareArtifact) (string, error) {
	firmwareURL := strings.TrimSpace(artifact.FirmwareURL)
	if firmwareURL == "" && strings.HasPrefix(strings.TrimSpace(artifact.Asset), "http") {
		firmwareURL = strings.TrimSpace(artifact.Asset)
	}
	if firmwareURL == "" && strings.TrimSpace(manifest.Release) != "" && strings.TrimSpace(artifact.Asset) != "" {
		firmwareURL = githubReleaseAssetURL(defaultReleaseRepo, manifest.Release, artifact.Asset)
	}
	if firmwareURL == "" {
		return "", errors.New("manifest artifact has no firmwareUrl or downloadable asset")
	}

	version := normalizeReleaseVersion(artifact.FirmwareVersion)
	releaseDir := filepath.Join(
		runtimepaths.Root(home),
		"updates",
		"firmware",
		sanitizePathToken(version),
	)
	assetName := strings.TrimSpace(artifact.Asset)
	if assetName == "" {
		assetName = "firmware-" + sanitizePathToken(version) + ".bin"
	}
	imagePath := filepath.Join(releaseDir, filepath.Base(assetName))
	if err := downloadURLToFile(ctx, firmwareURL, imagePath, 0o644); err != nil {
		return "", err
	}

	actualSHA, err := sha256File(imagePath)
	if err != nil {
		return "", err
	}
	expectedSHA := strings.ToLower(strings.TrimSpace(artifact.SHA256))
	if expectedSHA == "" {
		return "", errors.New("manifest artifact has empty sha256")
	}
	if actualSHA != expectedSHA {
		return "", fmt.Errorf("sha256 mismatch for %s: expected %s actual %s", assetName, expectedSHA, actualSHA)
	}
	if strings.HasSuffix(strings.ToLower(imagePath), ".gz") {
		rawImagePath := strings.TrimSuffix(imagePath, filepath.Ext(imagePath))
		if err := gunzipFile(imagePath, rawImagePath, 0o644); err != nil {
			return "", fmt.Errorf("decompress firmware image: %w", err)
		}
		imagePath = rawImagePath
	}
	return imagePath, nil
}

func fetchJSON(ctx context.Context, endpoint string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "codexbar-display-upgrade")

	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s returned %s", endpoint, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

func downloadURLToFile(ctx context.Context, endpoint, path string, mode os.FileMode) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "codexbar-display-upgrade")

	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s returned %s", endpoint, resp.Status)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmpPath := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	out, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}

	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(out, resp.Body); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func gunzipFile(srcPath, dstPath string, mode os.FileMode) error {
	in, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer in.Close()

	gz, err := gzip.NewReader(in)
	if err != nil {
		return err
	}
	defer gz.Close()

	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return err
	}
	tmpPath := fmt.Sprintf("%s.tmp-%d", dstPath, time.Now().UnixNano())
	out, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}

	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(out, gz); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, dstPath); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
