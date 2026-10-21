package companionapi

import (
	"bytes"
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

//go:embed all:controlcenter_static
var embeddedControlCenterStatic embed.FS

func (s *Server) registerControlCenterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/control-center", s.handleControlCenter)
	mux.HandleFunc("/control-center/", s.handleControlCenter)
	mux.HandleFunc("/_next/", s.handleControlCenterAsset)
	mux.HandleFunc("/images/", s.handleControlCenterAsset)
	mux.HandleFunc("/models/", s.handleControlCenterAsset)
	mux.HandleFunc("/theme-packs/render/", s.handleThemeRenderPack)
	mux.HandleFunc("/theme-packs/", s.handleControlCenterAsset)
	mux.HandleFunc("/favicon.ico", s.handleControlCenterAsset)
	mux.HandleFunc("/install-control-center-companion.sh", s.handleControlCenterAsset)
}

func (s *Server) handleControlCenter(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet, http.MethodHead) {
		return
	}
	if s.installationMode == "dmg" && !strings.HasPrefix(strings.TrimSpace(r.UserAgent()), nativeControlCenterUA) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusGone)
		if r.Method == http.MethodGet {
			moved, open := "moved to the Mac App.", "from Applications."
			if providerCopyGOOS == "windows" {
				moved, open = "moved to the app.", "from the Start menu."
			}
			_, _ = io.WriteString(w, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>VibeTV Control Center</title><main><h1>VibeTV Control Center `+moved+`</h1><p>Open VibeTV Control Center `+open+`</p></main>`)
		}
		return
	}
	assetPath := strings.TrimPrefix(r.URL.Path, "/control-center")
	assetPath = strings.TrimPrefix(assetPath, "/")
	if assetPath == "" {
		assetPath = "index.html"
	}
	if strings.Contains(path.Base(assetPath), ".") {
		s.serveControlCenterFile(w, r, assetPath)
		return
	}
	if routeFile := assetPath + ".html"; s.controlCenterFileExists(routeFile) {
		s.serveControlCenterFile(w, r, routeFile)
		return
	}
	if routeIndex := path.Join(assetPath, "index.html"); s.controlCenterFileExists(routeIndex) {
		s.serveControlCenterFile(w, r, routeIndex)
		return
	}
	s.serveControlCenterFile(w, r, "index.html")
}

func (s *Server) handleControlCenterAsset(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet, http.MethodHead) {
		return
	}
	assetPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if assetPath == "." || strings.HasPrefix(assetPath, "../") {
		http.NotFound(w, r)
		return
	}
	s.serveControlCenterFile(w, r, assetPath)
}

func (s *Server) handleThemeRenderPack(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet, http.MethodHead) {
		return
	}
	themeID, specFile, exactPath := themeRenderPackRequest(r.URL.Path)
	specHash, selectorOK := themeRenderPackRequestHash(r, exactPath)
	if themeID == "" || !selectorOK {
		http.NotFound(w, r)
		return
	}
	if exactPath {
		if data, ok := s.loadThemeRenderPackBySpecFile(themeID, specFile, specHash); ok {
			serveThemeRenderPack(w, r, data)
			return
		}
		// The Mac App bundles known historic revisions at this exact path. A
		// custom cache miss may therefore safely fall through to those assets;
		// never substitute the latest revision by id.
		s.handleControlCenterAsset(w, r)
		return
	}
	if data, err := os.ReadFile(s.themeRenderPackPath(themeID)); err == nil {
		serveThemeRenderPack(w, r, data)
		return
	}
	s.handleControlCenterAsset(w, r)
}

func serveThemeRenderPack(w http.ResponseWriter, r *http.Request, data []byte) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(data)
	}
}

func themeRenderPackRequest(requestPath string) (themeID, specFile string, exactPath bool) {
	const prefix = "/theme-packs/render/"
	if !strings.HasPrefix(requestPath, prefix) {
		return "", "", false
	}
	remaining := strings.TrimPrefix(requestPath, prefix)
	parts := strings.Split(remaining, "/")
	if len(parts) == 1 {
		return themeRenderPackID(requestPath), "", false
	}
	if len(parts) != 2 || !themeRenderPackIDPattern.MatchString(parts[0]) || !themeRenderPackSpecFilePattern.MatchString(parts[1]) {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func themeRenderPackRequestHash(r *http.Request, exactPath bool) (string, bool) {
	query := r.URL.Query()
	for key := range query {
		if key != "specHash" {
			return "", false
		}
	}
	specHash := strings.ToLower(strings.TrimSpace(query.Get("specHash")))
	if (!exactPath && specHash != "") ||
		(specHash != "" && !themeRenderPackHashPattern.MatchString(specHash)) {
		return "", false
	}
	return specHash, true
}

func (s *Server) loadThemeRenderPackBySpecFile(themeID, specFile, specHash string) ([]byte, bool) {
	revisionPath := filepath.Join(s.themeRenderPackRevisionDir(themeID), specFile)
	if data, err := os.ReadFile(revisionPath); err == nil && themeRenderPackMatches(data, specFile, specHash) {
		return data, true
	}
	// Older Companions stored only <themeId>.json. It remains a safe fallback
	// when its embedded path and optional fingerprint match the exact request.
	if data, err := os.ReadFile(s.themeRenderPackPath(themeID)); err == nil && themeRenderPackMatches(data, specFile, specHash) {
		return data, true
	}
	return nil, false
}

func themeRenderPackMatches(data []byte, specFile, specHash string) bool {
	var pack themeRenderPack
	if err := json.Unmarshal(data, &pack); err != nil || !pack.OK {
		return false
	}
	if path.Base(strings.TrimSpace(pack.SpecPath)) != specFile {
		return false
	}
	if specHash != "" {
		actual := strings.ToLower(strings.TrimSpace(pack.SpecHash))
		if actual == "" {
			actual = themeRenderPackSpecHash(pack.Spec)
		}
		if actual != specHash {
			return false
		}
	}
	return true
}

func (s *Server) serveControlCenterFile(w http.ResponseWriter, r *http.Request, assetPath string) bool {
	assetPath, ok := normalizeControlCenterAssetPath(assetPath)
	if !ok {
		http.NotFound(w, r)
		return false
	}
	if strings.HasSuffix(assetPath, ".html") {
		w.Header().Set("Cache-Control", "no-store")
	}
	data, err := fs.ReadFile(s.controlCenterFS, assetPath)
	if err != nil {
		if assetPath == "index.html" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			if r.Method != http.MethodHead {
				app := "Mac App"
				if providerCopyGOOS == "windows" {
					app = "app"
				}
				_, _ = io.WriteString(w, "<!doctype html><title>VibeTV Control Center unavailable</title><p>VibeTV Control Center is not bundled with this "+app+". Run setup again.</p>")
			}
			return false
		}
		http.NotFound(w, r)
		return false
	}
	http.ServeContent(w, r, path.Base(assetPath), time.Time{}, bytes.NewReader(data))
	return true
}

func (s *Server) controlCenterFileExists(assetPath string) bool {
	assetPath, ok := normalizeControlCenterAssetPath(assetPath)
	if !ok {
		return false
	}
	info, err := fs.Stat(s.controlCenterFS, assetPath)
	return err == nil && !info.IsDir()
}

func normalizeControlCenterAssetPath(assetPath string) (string, bool) {
	assetPath = strings.TrimPrefix(path.Clean("/"+assetPath), "/")
	if assetPath == "." || !fs.ValidPath(assetPath) {
		return "", false
	}
	return assetPath, true
}
