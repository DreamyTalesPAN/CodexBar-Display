package codexbar

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	minSupportedVersionString      = "0.23"
	minDashboardSnapshotAPIVersion = "0.44.0"
	versionCheckTimeout            = 2 * time.Second
)

func MinimumSupportedVersion() string {
	return minSupportedVersionString
}

func CheckMinimumVersion(ctx context.Context, bin string) error {
	return checkMinimumVersion(ctx, bin, minSupportedVersionString, "")
}

func CheckDashboardSnapshotVersion(ctx context.Context, bin string) error {
	return checkMinimumVersion(ctx, bin, minDashboardSnapshotAPIVersion, "dashboard snapshot API")
}

func checkMinimumVersion(ctx context.Context, bin, minimumString, requirement string) error {
	version, err := installedVersion(ctx, bin)
	if err != nil {
		return err
	}
	minimum, err := parseLooseVersion(minimumString)
	if err != nil {
		return err
	}
	if version.Compare(minimum) < 0 {
		if requirement != "" {
			return fmt.Errorf("CodexBar %s is too old for the %s; need >= %s", version.String(), requirement, minimumString)
		}
		return fmt.Errorf("CodexBar %s is too old; need >= %s", version.String(), minimumString)
	}
	return nil
}

func InstalledVersion(ctx context.Context, bin string) (string, error) {
	version, err := installedVersion(ctx, bin)
	if err != nil {
		return "", err
	}
	return version.String(), nil
}

type looseVersion struct {
	major int
	minor int
	patch int
}

func (v looseVersion) String() string {
	if v.patch == 0 {
		return fmt.Sprintf("%d.%d", v.major, v.minor)
	}
	return fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch)
}

func (v looseVersion) Compare(other looseVersion) int {
	if v.major != other.major {
		if v.major < other.major {
			return -1
		}
		return 1
	}
	if v.minor != other.minor {
		if v.minor < other.minor {
			return -1
		}
		return 1
	}
	if v.patch != other.patch {
		if v.patch < other.patch {
			return -1
		}
		return 1
	}
	return 0
}

var looseVersionPattern = regexp.MustCompile(`\bv?([0-9]+)\.([0-9]+)(?:\.([0-9]+))?\b`)

// reuseEngineAnswers keeps the CLI's version and the provider inventory for as
// long as engineStamp of their files stays the same. Every poll used to start a
// new CLI process only to hear them again (#555), on Windows and on the Mac
// alike. Neither answer can change unless a file does. A variable so tests can
// switch the reuse off.
var reuseEngineAnswers = true

// engineStampSettle is how long a file must have been left alone before an
// answer read from it is kept. A second write inside one step of the file
// system's clock (2 s on FAT) leaves size and modification time as they were.
const engineStampSettle = 3 * time.Second

// engineStamp names the state of the files an answer depends on: path, size
// and modification time of each. It is empty, and nothing is kept, where
// answers are not reused, when a file cannot be read, and while a file is
// younger than engineStampSettle. Take it before asking the CLI: a file that
// changes during the call then no longer matches the answer.
func engineStamp(paths ...string) string {
	if !reuseEngineAnswers {
		return ""
	}
	var stamp strings.Builder
	for _, path := range paths {
		// Opening the file, not only stat-ing it, also proves it is readable:
		// chmod 000 changes neither size nor modification time.
		file, err := os.Open(path)
		if err != nil {
			return ""
		}
		info, err := file.Stat()
		file.Close()
		if err != nil || time.Since(info.ModTime()) < engineStampSettle {
			return ""
		}
		fmt.Fprintf(&stamp, "%s\x00%d\x00%d\x00", path, info.Size(), info.ModTime().UnixNano())
	}
	return stamp.String()
}

// engineAnswer is the CLI's last answer to one question, the engineStamp it
// was read under and when.
type engineAnswer[T any] struct {
	mu    sync.Mutex
	stamp string
	at    time.Time
	value T
	// forgotten counts the forgets, so a read that began before one can tell
	// its answer is out of date.
	forgotten uint64
}

// load returns the answer kept for stamp unless it is older than maxAge.
// Zero accepts any age.
func (a *engineAnswer[T]) load(stamp string, maxAge time.Duration) (T, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.value, stamp != "" && stamp == a.stamp && (maxAge == 0 || time.Since(a.at) < maxAge)
}

// store keeps value for stamp. An empty stamp forgets the answer.
func (a *engineAnswer[T]) store(stamp string, value T) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if stamp == "" {
		a.forgotten++
	}
	a.stamp, a.at, a.value = stamp, time.Now(), value
}

// forgets is the number of forgets so far. Take it before a read starts.
func (a *engineAnswer[T]) forgets() uint64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.forgotten
}

// storeUnlessForgotten keeps value for stamp only if nothing was forgotten
// since forgets returned before.
func (a *engineAnswer[T]) storeUnlessForgotten(before uint64, stamp string, value T) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.forgotten == before {
		a.stamp, a.at, a.value = stamp, time.Now(), value
	}
}

var engineVersion engineAnswer[looseVersion]

// installedVersion is the CLI's version. The app-managed copy is not run for
// it: its path is keyed by the pinned version, and that version was checked
// against the binary itself when the copy was installed. Running it again on
// every probe and settings read hit the 2 s deadline on a fresh Mac, which
// reported a broken engine and sent the app to reinstall it (#508).
//
// Windows has no pinned copy: its CLI sits next to the Companion. It is run
// once per state of that file (reuseEngineAnswers).
func installedVersion(ctx context.Context, bin string) (looseVersion, error) {
	if pinned := strings.TrimSpace(os.Getenv(appManagedCodexBarVersionEnvVar)); pinned != "" {
		if managed, err := findAppManagedBinary(pinned); err == nil && managed == strings.TrimSpace(bin) {
			return parseLooseVersion(pinned)
		}
	}
	stamp := engineStamp(strings.TrimSpace(bin))
	if version, ok := engineVersion.load(stamp, 0); ok {
		return version, nil
	}
	version, err := reportedVersion(ctx, bin, versionCheckTimeout)
	if err == nil {
		engineVersion.store(stamp, version)
	}
	return version, err
}

// reportedVersion runs the CLI and reads the version it reports.
func reportedVersion(ctx context.Context, bin string, timeout time.Duration) (looseVersion, error) {
	bin = strings.TrimSpace(bin)
	if bin == "" {
		return looseVersion{}, errors.New("CodexBar binary path is empty")
	}

	if out, err := runVersionCommandFn(ctx, timeout, bin, "--version"); err == nil {
		if version, ok := extractLooseVersion(string(out)); ok {
			return version, nil
		}
	}

	return looseVersion{}, fmt.Errorf("could not determine CodexBar version from %s --version", bin)
}

func extractLooseVersion(raw string) (looseVersion, bool) {
	match := looseVersionPattern.FindStringSubmatch(raw)
	if len(match) == 0 {
		return looseVersion{}, false
	}
	version, err := parseLooseVersion(match[0])
	if err != nil {
		return looseVersion{}, false
	}
	return version, true
}

func parseLooseVersion(raw string) (looseVersion, error) {
	match := looseVersionPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if len(match) == 0 {
		return looseVersion{}, fmt.Errorf("invalid version %q", raw)
	}

	major, err := strconv.Atoi(match[1])
	if err != nil {
		return looseVersion{}, err
	}
	minor, err := strconv.Atoi(match[2])
	if err != nil {
		return looseVersion{}, err
	}
	patch := 0
	if match[3] != "" {
		patch, err = strconv.Atoi(match[3])
		if err != nil {
			return looseVersion{}, err
		}
	}
	return looseVersion{major: major, minor: minor, patch: patch}, nil
}
