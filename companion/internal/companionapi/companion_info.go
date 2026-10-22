package companionapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

type companion struct {
	Status           string               `json:"status"`
	Version          string               `json:"version"`
	InstallationMode string               `json:"installationMode"`
	App              companionAppInfo     `json:"app"`
	Runtime          companionRuntimeInfo `json:"runtime"`
	Update           companionReleaseInfo `json:"update"`
	Features         companionFeatures    `json:"features"`
}

type companionAppInfo struct {
	Version                 string `json:"version,omitempty"`
	Build                   string `json:"build,omitempty"`
	Path                    string `json:"path,omitempty"`
	InstallationMode        string `json:"installationMode"`
	InstalledInApplications bool   `json:"installedInApplications"`
}

type companionRuntimeInfo struct {
	Version       string `json:"version"`
	Commit        string `json:"commit,omitempty"`
	BuiltAt       string `json:"builtAt,omitempty"`
	Executable    string `json:"executable,omitempty"`
	PID           int    `json:"pid"`
	ListenerOwner string `json:"listenerOwner,omitempty"`
	// OS lets the app word itself for the platform it runs on. Both native
	// shells replace the user agent, so the app cannot tell on its own.
	OS string `json:"os"`
}

type companionFeatures struct {
	ThemeInstallEnabled     bool `json:"themeInstallEnabled"`
	MacAppSelfUpdateEnabled bool `json:"macAppSelfUpdateEnabled"`
	// ProviderSignInEnabled tells the app that this Companion can start a
	// provider sign-in. Older Mac Companions cannot, so the app asks rather
	// than deciding from the user agent.
	ProviderSignInEnabled bool `json:"providerSignInEnabled"`
}

type companionReleaseInfo struct {
	CheckedAt        string `json:"checkedAt"`
	Status           string `json:"status"`
	Release          string `json:"release,omitempty"`
	LatestVersion    string `json:"latestVersion,omitempty"`
	InstalledVersion string `json:"installedVersion,omitempty"`
	UpdateAvailable  bool   `json:"updateAvailable"`
	Message          string `json:"message"`
}

type githubRelease struct {
	TagName string `json:"tag_name"`
}

func (s *Server) companionInfo(ctx context.Context) companion {
	return companion{
		Status:           "ready",
		Version:          buildinfo.NormalizedVersion(),
		InstallationMode: s.installationMode,
		App:              currentCompanionAppInfo(s.installationMode),
		Runtime:          currentCompanionRuntimeInfo(),
		Update:           s.macAppReleaseInfo(ctx),
		Features: companionFeatures{
			ThemeInstallEnabled:     themeInstallEnabled(),
			MacAppSelfUpdateEnabled: false,
			ProviderSignInEnabled:   providerSignInFeatureEnabledFor(runtime.GOOS),
		},
	}
}

func (s *Server) macAppReleaseInfo(ctx context.Context) companionReleaseInfo {
	app := currentCompanionAppInfo(s.installationMode)
	installedVersion := normalizeMacAppReleaseVersion(app.Version)
	if installedVersion == "" {
		installedVersion = normalizeMacAppReleaseVersion(buildinfo.NormalizedVersion())
	}
	now := time.Now().UTC()

	s.macAppReleaseMu.Lock()
	if s.macAppReleaseChecked &&
		s.macAppReleaseCache.InstalledVersion == installedVersion &&
		now.Sub(s.macAppReleaseCheckedAt) >= 0 &&
		now.Sub(s.macAppReleaseCheckedAt) < macAppReleaseCheckGap {
		cached := s.macAppReleaseCache
		s.macAppReleaseMu.Unlock()
		return cached
	}
	s.macAppReleaseMu.Unlock()

	checkedAt := now.Format(time.RFC3339)
	info := companionReleaseInfo{
		CheckedAt:        checkedAt,
		Status:           "check_failed",
		InstalledVersion: installedVersion,
		UpdateAvailable:  false,
		Message:          macAppReleaseName() + " check failed.",
	}

	if macAppReleaseCheckDisabled() {
		info.Status = "disabled"
		info.Message = macAppReleaseName() + " update check is disabled."
		s.cacheMacAppReleaseInfo(now, info)
		return info
	}

	fetch := s.fetchMacAppRelease
	if fetch == nil {
		fetch = fetchLatestMacAppRelease
	}
	checkCtx, cancel := context.WithTimeout(ctx, macAppReleaseTimeout)
	defer cancel()
	release, err := fetch(checkCtx)
	if err != nil {
		s.cacheMacAppReleaseInfo(now, info)
		return info
	}

	releaseTag := strings.TrimSpace(release.TagName)
	latestVersion := normalizeMacAppReleaseVersion(releaseTag)
	if latestVersion == "" {
		info.Release = releaseTag
		s.cacheMacAppReleaseInfo(now, info)
		return info
	}

	updateAvailable := installedVersion != "" && compareMacAppReleaseVersions(latestVersion, installedVersion) > 0
	info = companionReleaseInfo{
		CheckedAt:        checkedAt,
		Status:           "available",
		Release:          releaseTag,
		LatestVersion:    latestVersion,
		InstalledVersion: installedVersion,
		UpdateAvailable:  updateAvailable,
		Message:          macAppReleaseName() + " is up to date.",
	}
	if updateAvailable {
		info.Message = macAppReleaseName() + " update is available."
	}
	s.cacheMacAppReleaseInfo(now, info)
	return info
}

func (s *Server) cacheMacAppReleaseInfo(checkedAt time.Time, info companionReleaseInfo) {
	s.macAppReleaseMu.Lock()
	defer s.macAppReleaseMu.Unlock()
	s.macAppReleaseChecked = true
	s.macAppReleaseCheckedAt = checkedAt
	s.macAppReleaseCache = info
}

// macAppReleaseName names the app in its update message. The Windows app is
// "App" in customer copy (#558), the same switch as the other server-worded text.
func macAppReleaseName() string {
	if providerCopyGOOS == "windows" {
		return "App"
	}
	return "Mac App"
}

func macAppReleaseCheckDisabled() bool {
	value := strings.TrimSpace(os.Getenv(macAppReleaseAPIEnvVar))
	return value == "-" || strings.EqualFold(value, "off") || strings.EqualFold(value, "disabled")
}

func fetchLatestMacAppRelease(ctx context.Context) (githubRelease, error) {
	releaseURL := strings.TrimSpace(os.Getenv(macAppReleaseAPIEnvVar))
	if releaseURL == "" {
		releaseURL = macAppReleaseAPIURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseURL, nil)
	if err != nil {
		return githubRelease{}, fmt.Errorf("build mac app release request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "vibetv-mac-app")

	client := http.Client{Timeout: macAppReleaseTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return githubRelease{}, fmt.Errorf("fetch mac app release: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return githubRelease{}, fmt.Errorf("fetch mac app release: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var release githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(&release); err != nil {
		return githubRelease{}, fmt.Errorf("decode mac app release: %w", err)
	}
	return release, nil
}

func normalizeMacAppReleaseVersion(raw string) string {
	version := strings.TrimSpace(raw)
	version = strings.TrimPrefix(version, "v")
	version = strings.TrimPrefix(version, "V")
	if !macAppReleaseVersionPattern.MatchString(version) {
		return ""
	}
	return version
}

func compareMacAppReleaseVersions(left, right string) int {
	leftVersion, leftErr := versioning.ParseSemVer(normalizeMacAppReleaseVersion(left))
	rightVersion, rightErr := versioning.ParseSemVer(normalizeMacAppReleaseVersion(right))
	if leftErr != nil || rightErr != nil {
		return 0
	}
	return leftVersion.Compare(rightVersion)
}

var macAppReleaseVersionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z._-]*)?$`)

func themeInstallEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(themeInstallDisableEnv))) {
	case "1", "true", "yes", "on":
		return false
	default:
		return true
	}
}

func macAppInstallationMode() string {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(macAppUpdateDisableEnv))) {
	case "1", "true", "yes", "on":
		return "dmg"
	default:
		return "legacy"
	}
}

func currentCompanionAppInfo(installationMode string) companionAppInfo {
	version := strings.TrimSpace(os.Getenv(macAppVersionEnv))
	build := strings.TrimSpace(os.Getenv(macAppBuildEnv))
	appPath := companionAppBundlePath()
	installed := strings.HasPrefix(filepath.Clean(appPath), filepath.Clean("/Applications")+string(os.PathSeparator))
	if runtime.GOOS == "windows" {
		// The Windows shell installs the companion next to its own exe; the
		// shell runs the updater itself, so "installed" means the shell is
		// present, not any particular directory.
		installed = appPath != ""
	}
	return companionAppInfo{
		Version:                 version,
		Build:                   build,
		Path:                    appPath,
		InstallationMode:        strings.TrimSpace(installationMode),
		InstalledInApplications: installed,
	}
}

func currentCompanionRuntimeInfo() companionRuntimeInfo {
	executable, _ := os.Executable()
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	return companionRuntimeInfo{
		Version:       buildinfo.NormalizedVersion(),
		Commit:        strings.TrimSpace(buildinfo.Commit),
		BuiltAt:       strings.TrimSpace(buildinfo.Date),
		Executable:    strings.TrimSpace(executable),
		PID:           os.Getpid(),
		ListenerOwner: displayStreamLaunchAgentLabel(),
		OS:            runtime.GOOS,
	}
}

func companionAppBundlePath() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, resolveErr := filepath.EvalSymlinks(executable); resolveErr == nil {
		executable = resolved
	}
	if runtime.GOOS == "windows" {
		return windowsShellAppPath(filepath.Dir(executable))
	}
	helpersDir := filepath.Dir(executable)
	if filepath.Base(helpersDir) != "Helpers" {
		return ""
	}
	contentsDir := filepath.Dir(helpersDir)
	if filepath.Base(contentsDir) != "Contents" {
		return ""
	}
	appDir := filepath.Dir(contentsDir)
	if !strings.HasSuffix(strings.ToLower(appDir), ".app") {
		return ""
	}
	return filepath.Clean(appDir)
}

const windowsShellExecutable = "VibeTVControlCenter.exe"

func windowsShellAppPath(dir string) string {
	if info, err := os.Stat(filepath.Join(dir, windowsShellExecutable)); err != nil || !info.Mode().IsRegular() {
		return ""
	}
	return filepath.Clean(dir)
}
