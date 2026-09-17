package companionapi

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/childproc"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/openurl"
)

// Sign-in launch actions reported to the app.
const (
	providerSignInActionBrowser  = "browser"
	providerSignInActionCLILogin = "cli_login"
	providerSignInActionApp      = "app"
	providerSignInActionDownload = "download"
)

// providerSignInLaunch is what pressing "Sign in" does for one provider when
// its tool, not its usage endpoint, is signed out: start the tool's own login
// (Codex and Claude Code open the browser themselves), open the app (Cursor
// and Antigravity sign in inside the app), or, when nothing is installed yet,
// open the official install page.
type providerSignInLaunch struct {
	// cliNames are looked up on PATH; cliWindows/cliDarwin are the known
	// install locations relative to the home directory when PATH misses.
	cliNames   []string
	cliWindows []string
	cliDarwin  []string
	loginArgs  []string
	// appWindows/appDarwin are the desktop app locations relative to the home
	// directory (Windows) or absolute (macOS).
	appWindows  []string
	appDarwin   []string
	downloadURL string
}

var providerSignInLaunches = map[string]providerSignInLaunch{
	"codex": {
		cliNames:    []string{"codex"},
		cliWindows:  []string{"AppData/Local/Programs/codex/codex.exe"},
		cliDarwin:   []string{"/opt/homebrew/bin/codex", "/usr/local/bin/codex"},
		loginArgs:   []string{"login"},
		downloadURL: "https://developers.openai.com/codex/cli/",
	},
	"claude": {
		cliNames:    []string{"claude"},
		cliWindows:  []string{".local/bin/claude.exe"},
		cliDarwin:   []string{".local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"},
		loginArgs:   []string{"auth", "login"},
		downloadURL: "https://docs.anthropic.com/en/docs/claude-code/setup",
	},
	"cursor": {
		appWindows:  []string{"AppData/Local/Programs/cursor/Cursor.exe"},
		appDarwin:   []string{"/Applications/Cursor.app"},
		downloadURL: "https://cursor.com/download",
	},
	"antigravity": {
		appWindows:  []string{"AppData/Local/Programs/Antigravity/Antigravity.exe"},
		appDarwin:   []string{"/Applications/Antigravity.app"},
		downloadURL: "https://antigravity.google/download",
	},
}

// providerSignInPlan is the resolved action for one provider on this machine.
type providerSignInPlan struct {
	Action string
	Path   string
	Args   []string
	URL    string
}

// planProviderSignIn decides what "Sign in" does for providerID on goos with
// the given home directory, PATH lookup and file check. ok is false for
// providers the Companion has no plan for.
func planProviderSignIn(providerID, goos, home string, lookPath func(string) (string, error), exists func(string) bool) (providerSignInPlan, bool) {
	launch, ok := providerSignInLaunches[strings.ToLower(strings.TrimSpace(providerID))]
	if !ok {
		return providerSignInPlan{}, false
	}
	if len(launch.loginArgs) > 0 {
		for _, name := range launch.cliNames {
			if path, err := lookPath(name); err == nil && path != "" {
				return providerSignInPlan{Action: providerSignInActionCLILogin, Path: path, Args: launch.loginArgs}, true
			}
		}
		for _, candidate := range providerSignInCandidates(goos, home, launch.cliWindows, launch.cliDarwin) {
			if exists(candidate) {
				return providerSignInPlan{Action: providerSignInActionCLILogin, Path: candidate, Args: launch.loginArgs}, true
			}
		}
	}
	for _, candidate := range providerSignInCandidates(goos, home, launch.appWindows, launch.appDarwin) {
		if exists(candidate) {
			return providerSignInPlan{Action: providerSignInActionApp, Path: candidate}, true
		}
	}
	return providerSignInPlan{Action: providerSignInActionDownload, URL: launch.downloadURL}, true
}

func providerSignInCandidates(goos, home string, windows, darwin []string) []string {
	var relative []string
	switch goos {
	case "windows":
		relative = windows
	case "darwin":
		relative = darwin
	default:
		return nil
	}
	out := make([]string, 0, len(relative))
	for _, candidate := range relative {
		if strings.HasPrefix(candidate, "/") {
			out = append(out, candidate)
			continue
		}
		if home == "" {
			continue
		}
		out = append(out, filepath.Join(home, filepath.FromSlash(candidate)))
	}
	return out
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// providerSignInFeatureEnabledFor reports whether goos gets the shortened
// provider list and the sign-in button. Both are Windows launch decisions:
// the Mac app keeps CodexBar's full provider inventory and the rows it
// already shows today.
func providerSignInFeatureEnabledFor(goos string) bool {
	return goos == "windows"
}

// launchProviderSignInFn carries out a plan. Tests replace it.
var launchProviderSignInFn = func(plan providerSignInPlan) error {
	switch plan.Action {
	case providerSignInActionCLILogin:
		return startCLILoginInTerminal(runtime.GOOS, plan.Path, plan.Args)
	case providerSignInActionApp:
		return openApp(runtime.GOOS, plan.Path)
	default:
		name, args := openurl.Command(plan.URL)
		return exec.Command(name, args...).Run()
	}
}

// startCLILoginInTerminal starts the tool's login. On Windows it runs without
// a console window: a black terminal box the customer cannot close looks
// broken in a packaged app. The login prints its browser URL on stdout or
// stderr and normally opens the browser itself; we watch the output and open
// the URL ourselves if the browser did not come up on its own.
func startCLILoginInTerminal(goos, path string, args []string) error {
	switch goos {
	case "windows":
		cmd := childproc.Hide(exec.Command(path, args...))
		// The login keeps printing while it waits for the browser, so its
		// output must go somewhere; a full pipe buffer would stall it.
		cmd.Stdout = io.Discard
		cmd.Stderr = io.Discard
		if err := cmd.Start(); err != nil {
			return err
		}
		go func() { _ = cmd.Wait() }()
		return nil
	case "darwin":
		script := shellQuote(path)
		for _, arg := range args {
			script += " " + shellQuote(arg)
		}
		escaped := strings.ReplaceAll(script, "\"", "\\\"")
		return exec.Command("osascript",
			"-e", "tell application \"Terminal\" to do script \""+escaped+"\"",
			"-e", "tell application \"Terminal\" to activate").Run()
	default:
		cmd := exec.Command(path, args...)
		if err := cmd.Start(); err != nil {
			return err
		}
		go func() { _ = cmd.Wait() }()
		return nil
	}
}

func openApp(goos, path string) error {
	switch goos {
	case "windows":
		return exec.Command("cmd.exe", "/c", "start", "", path).Run()
	case "darwin":
		return exec.Command("open", "-a", path).Run()
	default:
		cmd := exec.Command(path)
		if err := cmd.Start(); err != nil {
			return err
		}
		go func() { _ = cmd.Wait() }()
		return nil
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
