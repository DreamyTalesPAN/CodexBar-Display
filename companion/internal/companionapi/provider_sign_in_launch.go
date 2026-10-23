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
// open the official install page. On macOS CodexBar reads Claude and Cursor
// from the browser sign-in ("No Cursor session found ... log in to cursor.com
// in Safari, Chrome, ..."), so there the button opens that sign-in page.
type providerSignInLaunch struct {
	// cliNames are looked up on PATH; cliWindows/cliDarwin are the known
	// install locations relative to the home directory when PATH misses.
	cliNames   []string
	cliWindows []string
	cliDarwin  []string
	loginArgs  []string
	// appWindows/appDarwin are the desktop app locations relative to the home
	// directory (Windows) or absolute (macOS).
	appWindows []string
	appDarwin  []string
	// browserDarwin is the sign-in page CodexBar reads on macOS.
	browserDarwin string
	downloadURL   string
}

var providerSignInLaunches = map[string]providerSignInLaunch{
	"codex": {
		cliNames:   []string{"codex"},
		cliWindows: []string{"AppData/Local/Programs/codex/codex.exe"},
		// The ChatGPT app ships the Codex CLI inside its bundle.
		cliDarwin:   []string{"/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"},
		loginArgs:   []string{"login"},
		downloadURL: "https://developers.openai.com/codex/cli/",
	},
	"claude": {
		cliNames:      []string{"claude"},
		cliWindows:    []string{".local/bin/claude.exe"},
		loginArgs:     []string{"auth", "login"},
		browserDarwin: "https://claude.ai/login",
		downloadURL:   "https://docs.anthropic.com/en/docs/claude-code/setup",
	},
	"cursor": {
		appWindows:    []string{"AppData/Local/Programs/cursor/Cursor.exe"},
		browserDarwin: "https://cursor.com/dashboard",
		downloadURL:   "https://cursor.com/download",
	},
	"antigravity": {
		appWindows:  []string{"AppData/Local/Programs/Antigravity/Antigravity.exe"},
		appDarwin:   []string{"/Applications/Antigravity.app"},
		downloadURL: "https://antigravity.google/download",
	},
	// The logins below open the browser themselves and need no terminal:
	// Grok's default is the browser sign-in, Kiro picks the method in the
	// browser, Augment's --headless ends after the browser sign-in, Kilo's
	// --provider skips the provider menu and its link carries the device
	// code, and gcloud stores the credentials Vertex AI reads.
	"grok": {
		cliNames:    []string{"grok"},
		cliWindows:  []string{".grok/bin/grok.exe"},
		cliDarwin:   []string{".grok/bin/grok"},
		loginArgs:   []string{"login"},
		downloadURL: "https://docs.x.ai/build/overview",
	},
	"kiro": {
		cliNames: []string{"kiro-cli"},
		// The official MSI installs into LocalAppDataFolder\Kiro-Cli.
		cliWindows:  []string{"AppData/Local/Kiro-Cli/kiro-cli.exe"},
		cliDarwin:   []string{".local/bin/kiro-cli", "/opt/homebrew/bin/kiro-cli", "/usr/local/bin/kiro-cli"},
		loginArgs:   []string{"login"},
		downloadURL: "https://kiro.dev/cli/",
	},
	"augment": {
		cliNames:    []string{"auggie"},
		cliWindows:  []string{"AppData/Roaming/npm/auggie.cmd"},
		cliDarwin:   []string{"/opt/homebrew/bin/auggie", "/usr/local/bin/auggie"},
		loginArgs:   []string{"login", "--headless"},
		downloadURL: "https://docs.augmentcode.com/cli/setup-auggie/install-auggie-cli",
	},
	"kilo": {
		cliNames:    []string{"kilo"},
		cliWindows:  []string{"AppData/Roaming/npm/kilo.cmd"},
		cliDarwin:   []string{"/opt/homebrew/bin/kilo", "/usr/local/bin/kilo"},
		loginArgs:   []string{"auth", "login", "--provider", "kilo"},
		downloadURL: "https://kilo.ai/cli",
	},
	"vertexai": {
		cliNames:    []string{"gcloud"},
		cliWindows:  []string{"AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"},
		cliDarwin:   []string{"/opt/homebrew/bin/gcloud", "/usr/local/bin/gcloud", "google-cloud-sdk/bin/gcloud"},
		loginArgs:   []string{"auth", "application-default", "login"},
		downloadURL: "https://cloud.google.com/sdk/docs/install",
	},
	"windsurf": {
		appWindows:  []string{"AppData/Local/Programs/Windsurf/Windsurf.exe"},
		appDarwin:   []string{"/Applications/Windsurf.app"},
		downloadURL: "https://windsurf.com/download",
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
	if goos == "darwin" && launch.browserDarwin != "" {
		return providerSignInPlan{Action: providerSignInActionBrowser, URL: launch.browserDarwin}, true
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

// providerSignInFeatureEnabledFor reports whether goos gets the sign-in
// button. Windows and the Mac look and work the same.
func providerSignInFeatureEnabledFor(goos string) bool {
	return goos == "windows" || goos == "darwin"
}

// launchProviderSignInFn carries out a plan. Tests replace it.
var launchProviderSignInFn = func(plan providerSignInPlan) error {
	switch plan.Action {
	case providerSignInActionCLILogin:
		return startCLILogin(plan.Path, plan.Args)
	case providerSignInActionApp:
		return openApp(runtime.GOOS, plan.Path)
	default:
		name, args := openurl.Command(plan.URL)
		return exec.Command(name, args...).Run()
	}
}

// startCLILogin starts the tool's login without a terminal window, on Windows
// and on the Mac alike: a terminal box the customer cannot close looks broken
// in a packaged app. The login opens the browser itself.
func startCLILogin(path string, args []string) error {
	name := path
	// npm installs Augment and Kilo, and Google installs gcloud, as .cmd
	// files; Windows runs those only through the command interpreter.
	if runtime.GOOS == "windows" {
		switch strings.ToLower(filepath.Ext(path)) {
		case ".cmd", ".bat":
			name = "cmd.exe"
			args = append([]string{"/c", path}, args...)
		}
	}
	cmd := childproc.Hide(exec.Command(name, args...))
	// The login keeps printing while it waits for the browser, so its
	// output must go somewhere; a full pipe buffer would stall it.
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
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
