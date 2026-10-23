package companionapi

import (
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
)

// SingleProviderTheme uses the same health probe and exact render revision as
// the app. It also works with the app closed, without a browser-owned choice.
func (s *Server) SingleProviderTheme() bool {
	cfg, err := s.config()
	if err != nil || cfg.DeviceTarget == "" {
		return false
	}
	health, err := s.getHealthProbe(context.Background(), cfg.DeviceTarget, cfg.DeviceToken, deviceHealthProbeTime)
	if err != nil {
		return false
	}
	return s.singleProviderThemeFromHealth(health)
}

// Previews reuse the already observed device state and never start a probe.
func (s *Server) cachedSingleProviderTheme() bool {
	cfg, err := s.config()
	if err != nil {
		return false
	}
	s.probeMu.Lock()
	cached, ok := s.healthProbeCache[deviceProbeKey(cfg.DeviceTarget, cfg.DeviceToken)]
	s.probeMu.Unlock()
	return ok && cached.err == nil && s.singleProviderThemeFromHealth(cached.health)
}

func (s *Server) singleProviderThemeFromHealth(health deviceHealth) bool {
	specPath, hash := strings.TrimSpace(health.Display.ThemeSpec.Path), strings.ToLower(strings.TrimSpace(health.Display.ThemeSpec.Hash))
	if !health.Display.ThemeSpec.Active {
		return false
	}
	if health.Standby != nil && health.Standby.LiveThemePath != "" {
		specPath, hash = strings.TrimSpace(health.Standby.LiveThemePath), ""
	}
	file := path.Base(specPath)
	if !themeRenderPackSpecFilePattern.MatchString(file) {
		return false
	}
	matches := func(raw []byte) bool {
		if !themeRenderPackMatches(raw, file, hash) {
			return false
		}
		var pack themeRenderPack
		if json.Unmarshal(raw, &pack) != nil || pack.SpecPath != specPath {
			return false
		}
		spec, _, err := themespec.Parse(pack.Spec)
		return err == nil && spec.MaxProviders == 1
	}
	// The live slot may be borrowed by a screensaver, so resolve its exact
	// path rather than the name of the theme currently on screen.
	files, _ := filepath.Glob(filepath.Join(runtimepaths.Root(s.home), themeRenderPackDir, "*", file))
	for _, name := range files {
		if raw, err := os.ReadFile(name); err == nil && matches(raw) {
			return true
		}
	}
	assets, _ := fs.Glob(s.controlCenterFS, "theme-packs/render/*/"+file)
	for _, name := range assets {
		if raw, err := fs.ReadFile(s.controlCenterFS, name); err == nil && matches(raw) {
			return true
		}
	}
	return false
}
