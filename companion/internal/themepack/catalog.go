package themepack

import (
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
)

const (
	CatalogSchemaVersion = 1

	maxRemoteCatalogBytes = 1 << 20
)

type Catalog struct {
	SchemaVersion int            `json:"schemaVersion"`
	Themes        []CatalogTheme `json:"themes"`
}

type CatalogTheme struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description,omitempty"`
	ThemeRev      int    `json:"themeRev,omitempty"`
	DownloadURL   string `json:"downloadUrl,omitempty"`
	DownloadAsset string `json:"downloadAsset,omitempty"`
	SHA256        string `json:"sha256,omitempty"`
	Bytes         int64  `json:"bytes,omitempty"`
}

func LoadCatalog(catalogRef string) (*Catalog, error) {
	catalogRef = strings.TrimSpace(catalogRef)
	if catalogRef == "" {
		return nil, errors.New("missing theme catalog")
	}
	raw, err := readCatalog(catalogRef)
	if err != nil {
		return nil, err
	}
	var catalog Catalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return nil, fmt.Errorf("parse theme catalog: %w", err)
	}
	if err := validateCatalog(catalog); err != nil {
		return nil, err
	}
	return &catalog, nil
}

func readCatalog(catalogRef string) ([]byte, error) {
	if !isHTTPURL(catalogRef) {
		return os.ReadFile(catalogRef)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(catalogRef)
	if err != nil {
		return nil, fmt.Errorf("download theme catalog: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("download theme catalog: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxRemoteCatalogBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read theme catalog: %w", err)
	}
	if len(raw) > maxRemoteCatalogBytes {
		return nil, fmt.Errorf("theme catalog too large: got>%d limit=%d", maxRemoteCatalogBytes, maxRemoteCatalogBytes)
	}
	return raw, nil
}

func validateCatalog(catalog Catalog) error {
	if catalog.SchemaVersion != CatalogSchemaVersion {
		return fmt.Errorf("catalog schemaVersion=%d unsupported (expected %d)", catalog.SchemaVersion, CatalogSchemaVersion)
	}
	if len(catalog.Themes) == 0 {
		return errors.New("theme catalog is empty")
	}
	seen := make(map[string]struct{}, len(catalog.Themes))
	for index, theme := range catalog.Themes {
		id := strings.TrimSpace(theme.ID)
		if !packIDPattern.MatchString(id) {
			return fmt.Errorf("themes[%d].id must match [a-z0-9-_]{3,64}", index)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("themes[%d].id duplicates %s", index, id)
		}
		seen[id] = struct{}{}
		if strings.TrimSpace(theme.DownloadURL) == "" && strings.TrimSpace(theme.DownloadAsset) == "" {
			return fmt.Errorf("themes[%d] needs downloadUrl or downloadAsset", index)
		}
	}
	return nil
}

func (c Catalog) FindTheme(themeID string) (CatalogTheme, error) {
	themeID = strings.TrimSpace(themeID)
	if themeID == "" {
		return CatalogTheme{}, errors.New("missing theme id")
	}
	for _, theme := range c.Themes {
		if strings.EqualFold(strings.TrimSpace(theme.ID), themeID) {
			return theme, nil
		}
	}
	return CatalogTheme{}, fmt.Errorf("theme %q not found in catalog", themeID)
}

func ResolveThemeDownload(catalogRef string, theme CatalogTheme) (string, error) {
	if direct := strings.TrimSpace(theme.DownloadURL); direct != "" {
		return direct, nil
	}
	asset := strings.TrimSpace(theme.DownloadAsset)
	if asset == "" {
		return "", fmt.Errorf("theme %q has no download URL or asset", theme.ID)
	}
	if isHTTPURL(asset) {
		return asset, nil
	}
	if isHTTPURL(catalogRef) {
		base, err := url.Parse(strings.TrimSpace(catalogRef))
		if err != nil {
			return "", fmt.Errorf("parse catalog URL: %w", err)
		}
		rel, err := url.Parse(asset)
		if err != nil {
			return "", fmt.Errorf("parse theme download asset: %w", err)
		}
		return base.ResolveReference(rel).String(), nil
	}
	return filepath.Join(filepath.Dir(catalogRef), filepath.FromSlash(asset)), nil
}
