package companionapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themepack"
)

var themeRenderPackIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,63}$`)

var themeRenderPackSpecFilePattern = regexp.MustCompile(`^[a-zA-Z0-9._-]+\.json$`)

var themeRenderPackHashPattern = regexp.MustCompile(`^[a-f0-9]{8}$`)

type themeRenderPackAsset struct {
	ContentType string `json:"contentType"`
	Data        string `json:"data"`
	Encoding    string `json:"encoding"`
}

type themeRenderPack struct {
	OK       bool                            `json:"ok"`
	ThemeID  string                          `json:"themeId"`
	Name     string                          `json:"name"`
	Spec     json.RawMessage                 `json:"spec"`
	SpecPath string                          `json:"specPath"`
	SpecHash string                          `json:"specHash"`
	Assets   map[string]themeRenderPackAsset `json:"assets"`
}

func (s *Server) persistThemeRenderPack(packBytes []byte) error {
	pack, err := themepack.LoadZipBytes(packBytes)
	if err != nil {
		return err
	}
	themeID := strings.TrimSpace(pack.ThemeSpec.ThemeID)
	if !themeRenderPackIDPattern.MatchString(themeID) {
		return fmt.Errorf("invalid render pack theme id %q", themeID)
	}
	assets := make(map[string]themeRenderPackAsset, len(pack.Assets))
	for _, asset := range pack.Assets {
		contentType := strings.TrimSpace(asset.Entry.ContentType)
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		textAsset := strings.HasPrefix(strings.ToLower(contentType), "text/") ||
			strings.EqualFold(path.Ext(asset.Entry.File), ".cbi") ||
			strings.EqualFold(path.Ext(asset.Entry.File), ".cba")
		encoding := "base64"
		data := base64.StdEncoding.EncodeToString(asset.Data)
		if textAsset {
			encoding = "text"
			data = string(asset.Data)
		}
		assets[asset.Entry.Path] = themeRenderPackAsset{
			ContentType: contentType,
			Data:        data,
			Encoding:    encoding,
		}
	}
	specPath := strings.TrimSpace(pack.ThemeSpecFile.Entry.Path)
	specHash := themeRenderPackSpecHash(pack.ThemeSpecRaw)
	payload, err := json.Marshal(themeRenderPack{
		OK:       true,
		ThemeID:  themeID,
		Name:     strings.TrimSpace(pack.Manifest.Name),
		Spec:     json.RawMessage(pack.ThemeSpecRaw),
		SpecPath: specPath,
		SpecHash: specHash,
		Assets:   assets,
	})
	if err != nil {
		return err
	}
	// Keep a bounded revision history. Custom themes deliberately reuse their
	// ID while editing, so one id.json file is not enough to render the exact
	// ThemeSpec that an already-connected VibeTV reports.
	destination := s.themeRenderPackRevisionPath(themeID, specPath)
	if err := writeThemeRenderPackFile(destination, payload); err != nil {
		return err
	}
	if err := s.pruneThemeRenderPackRevisions(themeID, destination); err != nil {
		return err
	}
	// Retain the original latest-by-id cache for old Mac Apps that do not send
	// an exact ThemeSpec selector yet.
	return writeThemeRenderPackFile(s.themeRenderPackPath(themeID), payload)
}

func writeThemeRenderPackFile(destination string, payload []byte) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".theme-render-pack-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, destination)
}

func (s *Server) themeRenderPackPath(themeID string) string {
	return filepath.Join(
		runtimepaths.Root(s.home),
		themeRenderPackDir,
		themeID+".json",
	)
}

func (s *Server) themeRenderPackRevisionPath(themeID, specPath string) string {
	return filepath.Join(s.themeRenderPackRevisionDir(themeID), path.Base(specPath))
}

func (s *Server) themeRenderPackRevisionDir(themeID string) string {
	return filepath.Join(
		runtimepaths.Root(s.home),
		themeRenderPackDir,
		themeID,
	)
}

func (s *Server) pruneThemeRenderPackRevisions(themeID, preservePath string) error {
	revisionDir := s.themeRenderPackRevisionDir(themeID)
	entries, err := os.ReadDir(revisionDir)
	if err != nil {
		return err
	}
	type cachedRevision struct {
		name       string
		modTime    time.Time
		isPreserve bool
	}
	revisions := make([]cachedRevision, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		entryPath := filepath.Join(revisionDir, entry.Name())
		revisions = append(revisions, cachedRevision{
			name:       entry.Name(),
			modTime:    info.ModTime(),
			isPreserve: entryPath == preservePath,
		})
	}
	sort.Slice(revisions, func(i, j int) bool {
		if revisions[i].isPreserve != revisions[j].isPreserve {
			return revisions[i].isPreserve
		}
		if !revisions[i].modTime.Equal(revisions[j].modTime) {
			return revisions[i].modTime.After(revisions[j].modTime)
		}
		return revisions[i].name > revisions[j].name
	})
	if len(revisions) <= themeRenderPackRevisionLimit {
		return nil
	}
	for _, revision := range revisions[themeRenderPackRevisionLimit:] {
		if err := os.Remove(filepath.Join(revisionDir, revision.name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

// themeRenderPackSpecHash matches the FNV-1a hash exposed by the VibeTV
// /health display.themeSpec.hash field. Firmware trims stored ThemeSpec bytes
// before hashing, so a pack's harmless final newline must not change it.
func themeRenderPackSpecHash(spec json.RawMessage) string {
	hash := fnv.New32a()
	_, _ = hash.Write(bytes.TrimSpace(spec))
	return fmt.Sprintf("%08x", hash.Sum32())
}

func themeRenderPackID(requestPath string) string {
	const prefix = "/theme-packs/render/"
	if !strings.HasPrefix(requestPath, prefix) || !strings.HasSuffix(requestPath, ".json") {
		return ""
	}
	themeID := strings.TrimSuffix(strings.TrimPrefix(requestPath, prefix), ".json")
	if strings.Contains(themeID, "/") || !themeRenderPackIDPattern.MatchString(themeID) {
		return ""
	}
	return themeID
}
