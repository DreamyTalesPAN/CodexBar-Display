package codexbar

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"golang.org/x/sys/unix"
)

var pinnedRun = func(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func ValidatePinnedCLI(ctx context.Context, app string) (string, error) {
	bin := filepath.Join(app, "Contents", "Helpers", "CodexBarCLI")
	if !isExecutable(bin) {
		return "", fmt.Errorf("pinned CLI is not executable: %s", bin)
	}
	if out, err := pinnedRun(ctx, "/usr/bin/codesign", "--verify", "--deep", "--strict", "--verbose=2", app); err != nil {
		return "", fmt.Errorf("verify CodexBar signature: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	out, err := pinnedRun(ctx, "/usr/bin/codesign", "--display", "--verbose=4", app)
	if err != nil {
		return "", fmt.Errorf("inspect CodexBar signature: %w", err)
	}
	identity := "\n" + strings.TrimSpace(string(out)) + "\n"
	if !strings.Contains(identity, "\nTeamIdentifier="+pinnedTeam+"\n") || !strings.Contains(identity, "\nIdentifier="+pinnedBundle+"\n") {
		return "", errors.New("unexpected CodexBar signing identity")
	}
	if out, err := pinnedRun(ctx, "/usr/sbin/spctl", "--assess", "--type", "execute", "--verbose=4", app); err != nil {
		return "", fmt.Errorf("assess CodexBar: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	version, err := installedVersion(ctx, bin)
	if err != nil {
		return "", err
	}
	pin, _ := parseLooseVersion(PinnedVersion)
	if version.Compare(pin) != 0 {
		return "", fmt.Errorf("expected pinned CodexBar %s, got %s", PinnedVersion, version)
	}
	return bin, nil
}

// PreparePinnedCLI preserves staging order and the running-app exception. The
// shell supplies only whether the exact target is running; it owns GUI apps.
func PreparePinnedCLI(ctx context.Context, archive string, running bool) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	root := runtimepaths.Root(home)
	if root == "" {
		return "", errors.New("companion config directory is unavailable")
	}
	target := filepath.Join(root, "CodexBar", PinnedVersion, "CodexBar.app")
	safe := func() error {
		link, err := firstSymlinkInPathUnder(home, target)
		if err != nil {
			return err
		}
		if link != "" {
			return fmt.Errorf("unsafe private CodexBar path: %s", link)
		}
		return nil
	}
	if err := safe(); err != nil {
		return "", err
	}
	if running {
		if bin, err := ValidatePinnedCLI(ctx, target); err == nil {
			return bin, nil
		}
	}
	file, err := os.Open(archive)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	_, copyErr := io.Copy(hash, file)
	closeErr := file.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if hex.EncodeToString(hash.Sum(nil)) != pinnedSHA256 {
		return "", errors.New("bundled CodexBar archive checksum mismatch")
	}
	parent := filepath.Join(root, "CodexBar")
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return "", err
	}
	staging, err := os.MkdirTemp(parent, ".extract-"+PinnedVersion+"-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(staging)
	if out, err := pinnedRun(ctx, "/usr/bin/ditto", "-x", "-k", archive, staging); err != nil {
		return "", fmt.Errorf("extract CodexBar: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	staged := filepath.Join(staging, "CodexBar.app")
	if err := normalizePinnedXattrs(staged); err != nil {
		return "", err
	}
	if _, err := ValidatePinnedCLI(ctx, staged); err != nil {
		return "", err
	}
	if err := safe(); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return "", err
	}
	if err := publishPinnedApp(staged, target); err != nil {
		return "", err
	}
	return ValidatePinnedCLI(ctx, target)
}

func normalizePinnedXattrs(app string) error {
	return filepath.WalkDir(app, func(path string, _ fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		for _, attr := range []string{"com.apple.FinderInfo", "com.apple.ResourceFork"} {
			if err := unix.Lremovexattr(path, attr); err != nil && !errors.Is(err, unix.ENOATTR) {
				return err
			}
		}
		return nil
	})
}

func publishPinnedApp(staged, target string) error {
	if _, err := os.Lstat(target); errors.Is(err, os.ErrNotExist) {
		return os.Rename(staged, target)
	} else if err != nil {
		return err
	}
	// renameatx_np(RENAME_SWAP) atomically exchanges non-empty directories.
	// The old app is subsequently removed with our private staging directory.
	return unix.RenamexNp(staged, target, unix.RENAME_SWAP)
}
