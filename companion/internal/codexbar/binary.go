package codexbar

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

var knownBinaryPaths = []string{
	"/opt/homebrew/bin/codexbar",
	"/usr/local/bin/codexbar",
	"/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI",
	"/Applications/CodexBar.app/Contents/MacOS/CodexBar",
}

var systemAppBinaryPaths = []string{
	"/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI",
	"/Applications/CodexBar.app/Contents/MacOS/CodexBar",
}

func FindBinary() (string, error) {
	if version := strings.TrimSpace(os.Getenv(appManagedCodexBarVersionEnvVar)); version != "" {
		return findAppManagedBinary(version)
	}

	if env := strings.TrimSpace(os.Getenv("CODEXBAR_BIN")); env != "" {
		if isExecutable(env) {
			return env, nil
		}
		return "", fmt.Errorf("CODEXBAR_BIN is not executable: %s", env)
	}

	// The native Control Center ships CodexBarCLI next to codexbar-display.
	// Prefer that pinned copy over an unrelated Homebrew/PATH installation.
	if executable, err := executablePathFn(); err == nil {
		base := filepath.Dir(executable)
		for _, p := range []string{
			filepath.Join(base, "CodexBarCLI"),
			filepath.Join(base, "codexbar"),
			filepath.Join(base, "codexbar-cli.exe"),
			filepath.Join(base, "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"),
		} {
			if isExecutable(p) {
				return p, nil
			}
		}
	}

	home, _ := os.UserHomeDir()
	appCandidates := append([]string(nil), systemAppBinaryPaths...)
	if home != "" {
		appCandidates = append(appCandidates,
			filepath.Join(home, "Applications", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"),
			filepath.Join(home, "Applications", "CodexBar.app", "Contents", "MacOS", "CodexBar"),
		)
	}
	for _, p := range appCandidates {
		if isExecutable(p) {
			return p, nil
		}
	}

	if p, err := exec.LookPath("codexbar"); err == nil && p != "" {
		return p, nil
	}
	if p, err := exec.LookPath("codexbar-cli.exe"); err == nil && p != "" {
		return p, nil
	}

	candidates := append([]string(nil), knownBinaryPaths...)
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, "Downloads", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"),
			filepath.Join(home, "Downloads", "CodexBar.app", "Contents", "MacOS", "CodexBar"),
		)
	}
	for _, p := range candidates {
		if isExecutable(p) {
			return p, nil
		}
	}

	return "", errors.New("could not find CodexBar CLI binary")
}

func findAppManagedBinary(version string) (string, error) {
	_, bin, err := findAppManagedPayload(version)
	return bin, err
}

func findAppManagedPayload(version string) (string, string, error) {
	if !regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`).MatchString(version) {
		return "", "", fmt.Errorf("%s has invalid version: %s", appManagedCodexBarVersionEnvVar, version)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("resolve home directory for app-managed CodexBar: %w", err)
	}
	if strings.TrimSpace(home) == "" {
		return "", "", errors.New("home directory for app-managed CodexBar is empty")
	}
	app := filepath.Join(
		runtimepaths.Root(home),
		"CodexBar",
		version,
		"CodexBar.app",
	)
	bin := filepath.Join(
		app,
		"Contents",
		"Helpers",
		"CodexBarCLI",
	)
	if linkPath, err := firstSymlinkInPathUnder(home, bin); err != nil {
		return "", "", fmt.Errorf("verify app-managed CodexBar path: %w", err)
	} else if linkPath != "" {
		return "", "", fmt.Errorf("app-managed CodexBar path contains symlink: %s", linkPath)
	}
	if isExecutable(bin) {
		return app, bin, nil
	}
	return "", "", fmt.Errorf("app-managed CodexBar %s is not executable: %s", version, bin)
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	if info.IsDir() {
		return false
	}
	// Windows has no POSIX execute bits; the process launcher checks the format.
	return runtime.GOOS == "windows" || info.Mode()&0o111 != 0
}

func firstSymlinkInPathUnder(root, path string) (string, error) {
	cleanRoot := filepath.Clean(root)
	cleanPath := filepath.Clean(path)
	if cleanPath != cleanRoot && !strings.HasPrefix(cleanPath, cleanRoot+string(os.PathSeparator)) {
		return cleanPath, nil
	}
	if info, err := os.Lstat(cleanRoot); err != nil {
		if !os.IsNotExist(err) {
			return "", err
		}
	} else if info.Mode()&os.ModeSymlink != 0 {
		return cleanRoot, nil
	}
	rest := strings.TrimPrefix(cleanPath, cleanRoot)
	rest = strings.TrimPrefix(rest, string(os.PathSeparator))
	current := cleanRoot
	for _, component := range strings.Split(rest, string(os.PathSeparator)) {
		if component == "" || component == "." {
			continue
		}
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil {
			if os.IsNotExist(err) {
				return "", nil
			}
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return current, nil
		}
	}
	return "", nil
}
