package setup

import (
	"bufio"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

const (
	launchAgentLabel      = "com.vibeblock.daemon"
	defaultDaemonInterval = "60s"
	codexbarInstallURL    = "https://codexbar.app/"
	codexbarBrewCask      = "steipete/tap/codexbar"
)

type Options struct {
	Port          string
	AssumeYes     bool
	SkipFlash     bool
	PinDaemonPort bool
	FirmwareEnv   string
	Theme         string
	ValidateOnly  bool
	DryRun        bool
}

type commandRunner func(ctx context.Context, dir string, name string, args ...string) (string, error)

type deps struct {
	stdin           io.Reader
	stdout          io.Writer
	cwd             func() (string, error)
	executablePath  func() (string, error)
	homeDir         func() (string, error)
	uid             func() int
	listPorts       func() ([]string, error)
	resolvePort     func(string) (string, error)
	probePort       func(string) error
	readDeviceHello func(string) (protocol.DeviceHello, error)
	findCodexbar    func() (string, error)
	lookPath        func(string) (string, error)
	runCommand      commandRunner
	isInteractive   func() bool
}

func (d deps) withDefaults() deps {
	if d.stdin == nil {
		d.stdin = os.Stdin
	}
	if d.stdout == nil {
		d.stdout = os.Stdout
	}
	if d.cwd == nil {
		d.cwd = os.Getwd
	}
	if d.executablePath == nil {
		d.executablePath = os.Executable
	}
	if d.homeDir == nil {
		d.homeDir = os.UserHomeDir
	}
	if d.uid == nil {
		d.uid = os.Getuid
	}
	if d.listPorts == nil {
		d.listPorts = usb.ListPorts
	}
	if d.resolvePort == nil {
		d.resolvePort = usb.ResolvePort
	}
	if d.probePort == nil {
		d.probePort = usb.ProbePort
	}
	if d.readDeviceHello == nil {
		d.readDeviceHello = usb.ReadDeviceHello
	}
	if d.findCodexbar == nil {
		d.findCodexbar = codexbar.FindBinary
	}
	if d.lookPath == nil {
		d.lookPath = exec.LookPath
	}
	if d.runCommand == nil {
		d.runCommand = runSystemCommand
	}
	if d.isInteractive == nil {
		d.isInteractive = stdinIsInteractive
	}
	return d
}

type StepError struct {
	Step   string
	Code   errcode.Code
	Err    error
	Hint   string
	Output string
}

func (e *StepError) Error() string {
	if e == nil {
		return ""
	}
	var b strings.Builder
	if e.Step == "" {
		b.WriteString("setup failed")
	} else {
		b.WriteString("setup failed at ")
		b.WriteString(e.Step)
	}
	if code := e.ErrorCode(); code != "" {
		b.WriteString(" [")
		b.WriteString(string(code))
		b.WriteString("]")
	}
	if e.Err != nil {
		b.WriteString(": ")
		b.WriteString(e.Err.Error())
	}
	if recovery := e.RecoveryAction(); recovery != "" {
		b.WriteString("\nrecovery: ")
		b.WriteString(recovery)
	}
	if strings.TrimSpace(e.Output) != "" {
		b.WriteString("\noutput:\n")
		b.WriteString(strings.TrimSpace(e.Output))
	}
	return b.String()
}

func (e *StepError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *StepError) ErrorCode() errcode.Code {
	if e == nil {
		return ""
	}
	if e.Code != "" {
		return e.Code
	}
	switch strings.TrimSpace(e.Step) {
	case "codexbar-validate":
		return errcode.SetupCodexbarValidate
	case "codexbar-install":
		return errcode.SetupCodexbarInstall
	case "list-ports":
		return errcode.SetupListPorts
	case "select-port":
		return errcode.SetupSelectPort
	case "serial-probe":
		return errcode.SetupSerialProbe
	case "resolve-executable":
		return errcode.SetupResolveExecutable
	case "resolve-home":
		return errcode.SetupResolveHome
	case "unsupported-hardware":
		return errcode.SetupUnsupportedHardware
	case "locate-repository":
		return errcode.SetupLocateRepository
	case "flash-firmware", "flash-firmware-validate":
		return errcode.SetupFlashFirmware
	case "install-binary":
		return errcode.SetupInstallBinary
	case "install-recovery-assets":
		return errcode.SetupInstallRecovery
	case "write-runtime-config":
		return errcode.SetupWriteRuntimeConfig
	case "write-launchagent":
		return errcode.SetupWriteLaunchAgent
	case "launchagent-bootstrap":
		return errcode.SetupLaunchBootstrap
	case "launchagent-kickstart":
		return errcode.SetupLaunchKickstart
	case "launchagent-verify":
		return errcode.SetupLaunchVerify
	default:
		return ""
	}
}

func (e *StepError) RecoveryAction() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Hint) != "" {
		return strings.TrimSpace(e.Hint)
	}
	return errcode.DefaultRecovery(e.ErrorCode())
}

func Run(ctx context.Context, opts Options) error {
	return runWithDeps(ctx, opts, deps{})
}

func runWithDeps(ctx context.Context, opts Options, d deps) error {
	d = d.withDefaults()

	fmt.Fprintln(d.stdout, "vibeblock setup")

	mode := "apply"
	if opts.ValidateOnly {
		mode = "validate-only"
	} else if opts.DryRun {
		mode = "dry-run"
	}
	fmt.Fprintf(d.stdout, "Mode: %s\n", mode)

	allowInstall := !opts.ValidateOnly && !opts.DryRun
	codexbarBin, err := ensureCodexbar(ctx, d, allowInstall)
	if err != nil {
		return err
	}
	fmt.Fprintf(d.stdout, "CodexBar CLI: %s\n", codexbarBin)

	port, err := choosePort(opts, d)
	if err != nil {
		return err
	}
	fmt.Fprintf(d.stdout, "Serial port: %s\n", port)

	if !opts.ValidateOnly && !opts.DryRun {
		stopLaunchAgentBestEffort(ctx, d)
	}

	// Avoid probe-close contention on the flash path; upload itself is the authoritative serial check.
	shouldProbe := opts.SkipFlash || opts.ValidateOnly || opts.DryRun
	if shouldProbe {
		if err := d.probePort(port); err != nil {
			code := errcode.Of(err)
			if opts.SkipFlash {
				fmt.Fprintf(d.stdout, "warning: serial probe failed (%v); continuing because --skip-flash\n", err)
			} else if code == errcode.TransportSerialCloseTimeout {
				fmt.Fprintf(d.stdout, "warning: serial probe close timed out (%v); continuing\n", err)
			} else {
				return &StepError{
					Step: "serial-probe",
					Err:  err,
					Hint: "disconnect and reconnect the board, check cable quality, then rerun setup",
				}
			}
		}
	} else {
		fmt.Fprintln(d.stdout, "Serial probe: skipped (flash step verifies port access)")
	}

	execPath, err := d.executablePath()
	if err != nil {
		return &StepError{
			Step: "resolve-executable",
			Err:  err,
		}
	}

	home, err := d.homeDir()
	if err != nil {
		return &StepError{
			Step: "resolve-home",
			Err:  err,
		}
	}

	firmwareEnv := strings.TrimSpace(opts.FirmwareEnv)
	if firmwareEnv == "" {
		firmwareEnv = DefaultFirmwareEnvironment()
	}
	resolvedFirmwareEnv, ok := ResolveFirmwareEnvironment(firmwareEnv)
	if !ok {
		return &StepError{
			Step: "validate-firmware-env",
			Err:  fmt.Errorf("unsupported firmware environment %q", firmwareEnv),
			Hint: "use esp8266_smalltv_st7789 (default) or lilygo_t_display_s3",
		}
	}
	firmwareEnv = resolvedFirmwareEnv

	targetBoardIDs := firmwareTargetExpectedIDs(firmwareEnv)
	if len(targetBoardIDs) > 0 {
		hello, helloErr := d.readDeviceHello(port)
		usb.CloseDefaultSender()
		if helloErr == nil {
			detectedBoard := strings.TrimSpace(strings.ToLower(hello.Board))
			if detectedBoard != "" && !containsString(targetBoardIDs, detectedBoard) {
				return &StepError{
					Step: "unsupported-hardware",
					Err: fmt.Errorf(
						"device board %q is incompatible with firmware env %q",
						detectedBoard,
						firmwareEnv,
					),
					Hint: "select a matching --firmware-env for the connected board or connect the expected hardware",
				}
			}
			if detectedBoard != "" {
				fmt.Fprintf(d.stdout, "Detected device board: %s (protocol=%d)\n", detectedBoard, hello.ProtocolVersion)
			}
		}
	}

	var repoRoot string
	if !opts.SkipFlash {
		repoRoot, err = locateRepository(d)
		if err != nil {
			return &StepError{
				Step: "locate-repository",
				Err:  err,
				Hint: "run setup from the repository root or pass --skip-flash if firmware is already flashed",
			}
		}

		fmt.Fprintf(d.stdout, "Repository: %s\n", repoRoot)
		fmt.Fprintf(d.stdout, "Firmware environment: %s\n", firmwareEnv)
		if opts.ValidateOnly || opts.DryRun {
			if _, err := d.lookPath("pio"); err != nil {
				return &StepError{
					Step: "flash-firmware-validate",
					Err:  err,
					Hint: "install PlatformIO CLI (`python3 -m pip install --user platformio`) and ensure `pio` is in PATH",
				}
			}
			firmwareDir := firmwareProjectDirForEnvironment(repoRoot, firmwareEnv)
			if !fileExists(filepath.Join(firmwareDir, "platformio.ini")) {
				return &StepError{
					Step: "flash-firmware-validate",
					Err:  fmt.Errorf("platformio project not found for env %q in %s", firmwareEnv, firmwareDir),
					Hint: "verify repository layout and firmware environment selection",
				}
			}
			fmt.Fprintf(d.stdout, "Firmware flash: validated (%s)\n", mode)
		} else {
			fmt.Fprintln(d.stdout, "Flashing firmware ...")
			if err := flashFirmware(ctx, d, repoRoot, port, firmwareEnv); err != nil {
				return err
			}
			fmt.Fprintln(d.stdout, "Firmware flash: ok")
		}
	} else {
		fmt.Fprintln(d.stdout, "Firmware flash: skipped (--skip-flash)")
		repoRoot, _ = locateRepository(d)
	}

	if opts.ValidateOnly {
		fmt.Fprintln(d.stdout, "Validation complete. No changes applied.")
		return nil
	}

	if opts.DryRun {
		installPath := filepath.Join(home, "Library", "Application Support", "vibeblock", "bin", "vibeblock")
		plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
		backupDir := filepath.Join(home, "Library", "Application Support", "vibeblock", "backups")
		fmt.Fprintf(d.stdout, "Dry-run: would install companion binary to %s\n", installPath)
		fmt.Fprintf(d.stdout, "Dry-run: would ensure backup dir %s\n", backupDir)
		if strings.TrimSpace(opts.Theme) != "" {
			fmt.Fprintf(d.stdout, "Dry-run: would apply runtime theme setting %q\n", opts.Theme)
		}
		if opts.PinDaemonPort {
			fmt.Fprintf(d.stdout, "Dry-run: would pin LaunchAgent to port %s\n", port)
		} else {
			fmt.Fprintln(d.stdout, "Dry-run: would configure LaunchAgent in auto-detect mode")
		}
		fmt.Fprintf(d.stdout, "Dry-run: would write LaunchAgent plist %s\n", plistPath)
		fmt.Fprintln(d.stdout, "Dry-run complete. No changes applied.")
		return nil
	}

	fmt.Fprintln(d.stdout, "Installing companion binary ...")
	installPath, err := installBinary(execPath, home)
	if err != nil {
		return &StepError{
			Step: "install-binary",
			Err:  err,
			Hint: "verify write permission for $HOME/Library/Application Support/vibeblock/bin",
		}
	}
	fmt.Fprintf(d.stdout, "Companion binary: %s\n", installPath)

	restoreScriptPath, backupDir, err := installRecoveryAssets(repoRoot, home)
	if err != nil {
		return &StepError{
			Step: "install-recovery-assets",
			Err:  err,
			Hint: "verify write permission for $HOME/Library/Application Support/vibeblock",
		}
	}
	if strings.TrimSpace(restoreScriptPath) != "" {
		fmt.Fprintf(d.stdout, "Recovery restore script: %s\n", restoreScriptPath)
	} else {
		fmt.Fprintln(d.stdout, "Recovery restore script: not installed (repository scripts unavailable)")
	}
	fmt.Fprintf(d.stdout, "Recovery backup dir: %s\n", backupDir)

	if err := applyRuntimeConfig(home, opts.Theme, d.stdout); err != nil {
		return &StepError{
			Step: "write-runtime-config",
			Err:  err,
			Hint: "use --theme classic|crt|mini or --theme none to clear",
		}
	}

	daemonPort := ""
	if opts.PinDaemonPort {
		daemonPort = port
		fmt.Fprintf(d.stdout, "Launch agent serial mode: pinned (%s)\n", daemonPort)
	} else {
		fmt.Fprintln(d.stdout, "Launch agent serial mode: auto-detect")
	}

	plistPath, err := writeLaunchAgentPlist(home, installPath, daemonPort)
	if err != nil {
		return &StepError{
			Step: "write-launchagent",
			Err:  err,
			Hint: "verify write permission for $HOME/Library/LaunchAgents",
		}
	}

	fmt.Fprintln(d.stdout, "Starting launch agent ...")
	if err := reloadLaunchAgent(ctx, d, plistPath); err != nil {
		return err
	}

	fmt.Fprintln(d.stdout, "Launch agent: running")
	fmt.Fprintln(d.stdout, "Setup complete.")
	fmt.Fprintln(d.stdout, "Re-run `vibeblock setup` anytime; it is safe and idempotent.")
	return nil
}

func choosePort(opts Options, d deps) (string, error) {
	explicit := strings.TrimSpace(opts.Port)
	if explicit != "" {
		port, err := d.resolvePort(explicit)
		if err != nil {
			return "", &StepError{
				Step: "select-port",
				Err:  err,
				Hint: "run `ls /dev/cu.usb*` and pass an existing path via --port",
			}
		}
		return port, nil
	}

	ports, err := d.listPorts()
	if err != nil {
		return "", &StepError{
			Step: "list-ports",
			Err:  err,
			Hint: "disconnect and reconnect the board, then rerun setup",
		}
	}
	if len(ports) == 0 {
		return "", &StepError{
			Step: "list-ports",
			Err:  errors.New("no serial ports found"),
			Hint: "connect the board with a data-capable USB cable and run `ls /dev/cu.usb*`",
		}
	}

	sorted := sortPreferredPorts(ports)
	if len(sorted) == 1 {
		return sorted[0], nil
	}

	if opts.AssumeYes || !d.isInteractive() {
		fmt.Fprintf(d.stdout, "Multiple serial ports detected; choosing preferred port %s (--yes/non-interactive)\n", sorted[0])
		return sorted[0], nil
	}

	return promptForPortSelection(d.stdin, d.stdout, sorted)
}

func ensureCodexbar(ctx context.Context, d deps, allowInstall bool) (string, error) {
	bin, err := d.findCodexbar()
	if err == nil {
		return bin, nil
	}
	if !allowInstall {
		return "", &StepError{
			Step: "codexbar-validate",
			Err:  err,
			Hint: "install CodexBar CLI (`brew install --cask " + codexbarBrewCask + "`) and rerun setup",
		}
	}

	fmt.Fprintln(d.stdout, "CodexBar CLI not found. Attempting install via Homebrew ...")
	if _, lookErr := d.lookPath("brew"); lookErr != nil {
		openCodexbarInstallPage(ctx, d)
		return "", &StepError{
			Step: "codexbar-install",
			Err:  err,
			Hint: "install Homebrew, then run `brew install --cask " + codexbarBrewCask + "` or download CodexBar from " + codexbarInstallURL,
		}
	}

	output, installErr := d.runCommand(ctx, "", "brew", "install", "--cask", codexbarBrewCask)
	if installErr != nil {
		openCodexbarInstallPage(ctx, d)
		return "", &StepError{
			Step:   "codexbar-install",
			Err:    installErr,
			Hint:   "run `brew install --cask " + codexbarBrewCask + "` manually, then rerun setup",
			Output: tailLines(output, 30),
		}
	}

	bin, err = d.findCodexbar()
	if err != nil {
		openCodexbarInstallPage(ctx, d)
		return "", &StepError{
			Step: "codexbar-install",
			Err:  err,
			Hint: "set CODEXBAR_BIN to the CodexBarCLI binary path and rerun setup",
		}
	}

	return bin, nil
}

func openCodexbarInstallPage(ctx context.Context, d deps) {
	if _, err := d.lookPath("open"); err != nil {
		return
	}
	_, _ = d.runCommand(ctx, "", "open", codexbarInstallURL)
}

func sortPreferredPorts(ports []string) []string {
	seen := make(map[string]struct{}, len(ports))
	clean := make([]string, 0, len(ports))
	for _, p := range ports {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		clean = append(clean, p)
	}

	sort.Slice(clean, func(i, j int) bool {
		pi := clean[i]
		pj := clean[j]
		ri := portRank(pi)
		rj := portRank(pj)
		if ri != rj {
			return ri < rj
		}
		return pi < pj
	})
	return clean
}

func portRank(port string) int {
	switch {
	case strings.Contains(port, "usbmodem"):
		return 0
	case strings.Contains(port, "usbserial"):
		return 1
	default:
		return 2
	}
}

func promptForPortSelection(stdin io.Reader, stdout io.Writer, ports []string) (string, error) {
	fmt.Fprintln(stdout, "Multiple serial ports detected:")
	for idx, port := range ports {
		suffix := ""
		if idx == 0 {
			suffix = " (recommended)"
		}
		fmt.Fprintf(stdout, "  %d) %s%s\n", idx+1, port, suffix)
	}
	fmt.Fprintf(stdout, "Select a port [1-%d] (Enter=1): ", len(ports))

	reader := bufio.NewReader(stdin)
	line, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", &StepError{
			Step: "select-port",
			Err:  err,
			Hint: "rerun setup with --yes to auto-select the recommended port",
		}
	}

	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return ports[0], nil
	}

	selected, convErr := strconv.Atoi(trimmed)
	if convErr != nil || selected < 1 || selected > len(ports) {
		return "", &StepError{
			Step: "select-port",
			Err:  fmt.Errorf("invalid selection %q", trimmed),
			Hint: "rerun setup and enter a number from the list, or use --yes",
		}
	}

	return ports[selected-1], nil
}

func locateRepository(d deps) (string, error) {
	cwd, err := d.cwd()
	if err != nil {
		return "", err
	}

	executablePath, _ := d.executablePath()

	starts := []string{cwd}
	if executablePath != "" {
		starts = append(starts, filepath.Dir(executablePath))
	}

	for _, start := range starts {
		repoRoot := walkUpToRepositoryRoot(start)
		if repoRoot != "" {
			return repoRoot, nil
		}
	}

	return "", errors.New("repository root not found")
}

func walkUpToRepositoryRoot(start string) string {
	dir := filepath.Clean(start)
	for {
		if fileExists(filepath.Join(dir, "firmware_esp32", "platformio.ini")) && fileExists(filepath.Join(dir, "companion", "go.mod")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func flashFirmware(ctx context.Context, d deps, repoRoot, port, firmwareEnv string) error {
	if _, err := d.lookPath("pio"); err != nil {
		return &StepError{
			Step: "flash-firmware",
			Err:  err,
			Hint: "install PlatformIO CLI (`python3 -m pip install --user platformio`) and ensure `pio` is in PATH",
		}
	}

	service := launchServiceTarget(d.uid())
	_, _ = d.runCommand(ctx, "", "launchctl", "bootout", service)

	firmwareDir := firmwareProjectDirForEnvironment(repoRoot, firmwareEnv)
	output, err := d.runCommand(ctx, firmwareDir, "pio", "run", "-e", firmwareEnv, "-t", "upload", "--upload-port", port)
	if err != nil {
		return &StepError{
			Step:   "flash-firmware",
			Err:    err,
			Hint:   flashRecoveryHint(output, port, d.uid()),
			Output: tailLines(output, 30),
		}
	}
	return nil
}

func firmwareProjectDirForEnvironment(repoRoot, firmwareEnv string) string {
	if target, ok := lookupFirmwareTarget(firmwareEnv); ok {
		targetDir := filepath.Join(repoRoot, target.ProjectDir)
		if fileExists(filepath.Join(targetDir, "platformio.ini")) {
			return targetDir
		}
	}

	env := strings.TrimSpace(strings.ToLower(firmwareEnv))
	switch {
	case strings.HasPrefix(env, "esp8266_"):
		esp8266Dir := filepath.Join(repoRoot, "firmware_esp8266")
		if fileExists(filepath.Join(esp8266Dir, "platformio.ini")) {
			return esp8266Dir
		}
	case strings.HasPrefix(env, "lilygo_"), strings.HasPrefix(env, "esp32_"):
		esp32Dir := filepath.Join(repoRoot, "firmware_esp32")
		if fileExists(filepath.Join(esp32Dir, "platformio.ini")) {
			return esp32Dir
		}
	}
	return filepath.Join(repoRoot, "firmware_esp32")
}

func flashRecoveryHint(output, port string, uid int) string {
	lower := strings.ToLower(output)
	if strings.Contains(lower, "failed to connect") || strings.Contains(lower, "could not open") || strings.Contains(lower, "resource busy") {
		return fmt.Sprintf("ensure no process holds %s, run `launchctl bootout %s 2>/dev/null || true`, then rerun setup", port, launchServiceTarget(uid))
	}
	return "check USB cable/device, then retry setup or pass an explicit --port"
}

func containsString(all []string, target string) bool {
	target = strings.TrimSpace(strings.ToLower(target))
	if target == "" {
		return false
	}
	for _, item := range all {
		if strings.TrimSpace(strings.ToLower(item)) == target {
			return true
		}
	}
	return false
}

func installBinary(sourcePath, home string) (string, error) {
	targetDir := filepath.Join(home, "Library", "Application Support", "vibeblock", "bin")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return "", err
	}

	targetPath := filepath.Join(targetDir, "vibeblock")
	if err := copyFileAtomic(sourcePath, targetPath, 0o755); err != nil {
		return "", err
	}
	return targetPath, nil
}

func copyFileAtomic(sourcePath, targetPath string, mode os.FileMode) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	tmpPath := fmt.Sprintf("%s.tmp-%d", targetPath, time.Now().UnixNano())
	target, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}

	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(target, source); err != nil {
		_ = target.Close()
		return err
	}
	if err := target.Close(); err != nil {
		return err
	}

	if err := os.Chmod(tmpPath, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, targetPath); err != nil {
		return err
	}

	cleanup = false
	return nil
}

func writeLaunchAgentPlist(home, binaryPath, port string) (string, error) {
	launchAgentDir := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(launchAgentDir, 0o755); err != nil {
		return "", err
	}

	plistPath := filepath.Join(launchAgentDir, launchAgentLabel+".plist")
	plistData := renderLaunchAgentPlist(binaryPath, port)
	existing, err := os.ReadFile(plistPath)
	if err == nil && bytes.Equal(existing, plistData) {
		return plistPath, nil
	}
	if err := writeFileAtomic(plistPath, plistData, 0o644); err != nil {
		return "", err
	}
	return plistPath, nil
}

func renderLaunchAgentPlist(binaryPath, port string) []byte {
	args := []string{binaryPath, "daemon", "--interval", defaultDaemonInterval}
	if strings.TrimSpace(port) != "" {
		args = append(args, "--port", strings.TrimSpace(port))
	}

	var b strings.Builder
	b.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
	b.WriteString("<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n")
	b.WriteString("<plist version=\"1.0\">\n")
	b.WriteString("  <dict>\n")
	b.WriteString("    <key>Label</key>\n")
	b.WriteString("    <string>" + xmlEscape(launchAgentLabel) + "</string>\n")
	b.WriteString("    <key>ProgramArguments</key>\n")
	b.WriteString("    <array>\n")
	for _, arg := range args {
		b.WriteString("      <string>" + xmlEscape(arg) + "</string>\n")
	}
	b.WriteString("    </array>\n")
	b.WriteString("    <key>EnvironmentVariables</key>\n")
	b.WriteString("    <dict>\n")
	b.WriteString("      <key>PATH</key>\n")
	b.WriteString("      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>\n")
	b.WriteString("    </dict>\n")
	b.WriteString("    <key>RunAtLoad</key>\n")
	b.WriteString("    <true/>\n")
	b.WriteString("    <key>KeepAlive</key>\n")
	b.WriteString("    <true/>\n")
	b.WriteString("    <key>StandardOutPath</key>\n")
	b.WriteString("    <string>/tmp/vibeblock-daemon.out.log</string>\n")
	b.WriteString("    <key>StandardErrorPath</key>\n")
	b.WriteString("    <string>/tmp/vibeblock-daemon.err.log</string>\n")
	b.WriteString("  </dict>\n")
	b.WriteString("</plist>\n")
	return []byte(b.String())
}

func xmlEscape(value string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(value))
	return b.String()
}

func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	tmpPath := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmpPath, data, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return os.Chmod(path, mode)
}

func reloadLaunchAgent(ctx context.Context, d deps, plistPath string) error {
	domain := fmt.Sprintf("gui/%d", d.uid())
	service := launchServiceTarget(d.uid())

	_, _ = d.runCommand(ctx, "", "launchctl", "bootout", service)

	output, err := d.runCommand(ctx, "", "launchctl", "bootstrap", domain, plistPath)
	if err != nil {
		return &StepError{
			Step:   "launchagent-bootstrap",
			Err:    err,
			Hint:   "check LaunchAgent plist path/permissions and rerun setup",
			Output: tailLines(output, 20),
		}
	}

	output, err = d.runCommand(ctx, "", "launchctl", "kickstart", "-k", service)
	if err != nil {
		return &StepError{
			Step:   "launchagent-kickstart",
			Err:    err,
			Hint:   "run `launchctl print " + service + "` and inspect /tmp/vibeblock-daemon.err.log",
			Output: tailLines(output, 20),
		}
	}

	status, err := waitForLaunchAgentState(ctx, d, service, 10, 500*time.Millisecond)
	if err != nil {
		return &StepError{
			Step:   "launchagent-verify",
			Err:    err,
			Hint:   "run `launchctl print " + service + "` manually to inspect state",
			Output: tailLines(status, 20),
		}
	}
	if !launchAgentStateHealthy(status) {
		return &StepError{
			Step:   "launchagent-verify",
			Err:    errors.New("launch agent not in running/waiting state"),
			Hint:   "inspect /tmp/vibeblock-daemon.err.log and run `launchctl kickstart -k " + service + "`",
			Output: tailLines(status, 20),
		}
	}

	return nil
}

func waitForLaunchAgentState(ctx context.Context, d deps, service string, attempts int, delay time.Duration) (string, error) {
	if attempts <= 0 {
		attempts = 1
	}
	if delay <= 0 {
		delay = 500 * time.Millisecond
	}

	var lastStatus string
	var lastErr error
	for i := 0; i < attempts; i++ {
		status, err := d.runCommand(ctx, "", "launchctl", "print", service)
		if err == nil {
			lastStatus = status
			if launchAgentStateHealthy(status) {
				return status, nil
			}
		} else {
			lastErr = err
		}

		if i == attempts-1 {
			break
		}

		select {
		case <-ctx.Done():
			if ctxErr := ctx.Err(); ctxErr != nil {
				return lastStatus, ctxErr
			}
			return lastStatus, errors.New("setup context canceled")
		case <-time.After(delay):
		}
	}

	if lastErr != nil && strings.TrimSpace(lastStatus) == "" {
		return lastStatus, lastErr
	}
	return lastStatus, nil
}

func launchAgentStateHealthy(status string) bool {
	return strings.Contains(status, "state = running") ||
		strings.Contains(status, "state = waiting") ||
		strings.Contains(status, "state = spawn scheduled")
}

func launchServiceTarget(uid int) string {
	return fmt.Sprintf("gui/%d/%s", uid, launchAgentLabel)
}

func tailLines(text string, maxLines int) string {
	if maxLines <= 0 {
		return strings.TrimSpace(text)
	}
	lines := strings.Split(strings.TrimSpace(text), "\n")
	if len(lines) <= maxLines {
		return strings.TrimSpace(text)
	}
	return strings.Join(lines[len(lines)-maxLines:], "\n")
}

func runSystemCommand(ctx context.Context, dir string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir

	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out

	err := cmd.Run()
	return strings.TrimSpace(out.String()), err
}

func stopLaunchAgentBestEffort(ctx context.Context, d deps) {
	service := launchServiceTarget(d.uid())
	_, _ = d.runCommand(ctx, "", "launchctl", "bootout", service)
}

func installRecoveryAssets(repoRoot, home string) (string, string, error) {
	appSupportDir := filepath.Join(home, "Library", "Application Support", "vibeblock")
	backupDir := filepath.Join(appSupportDir, "backups")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return "", "", err
	}

	repoRoot = strings.TrimSpace(repoRoot)
	if repoRoot == "" {
		return "", backupDir, nil
	}

	restoreSource := filepath.Join(repoRoot, "scripts", "esp8266-restore.sh")
	backupSource := filepath.Join(repoRoot, "scripts", "esp8266-backup.sh")
	if !fileExists(restoreSource) || !fileExists(backupSource) {
		return "", backupDir, nil
	}

	scriptsDir := filepath.Join(appSupportDir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		return "", "", err
	}

	restoreTarget := filepath.Join(scriptsDir, "esp8266-restore.sh")
	backupTarget := filepath.Join(scriptsDir, "esp8266-backup.sh")
	if err := copyFileAtomic(restoreSource, restoreTarget, 0o755); err != nil {
		return "", "", err
	}
	if err := copyFileAtomic(backupSource, backupTarget, 0o755); err != nil {
		return "", "", err
	}

	return restoreTarget, backupDir, nil
}

func applyRuntimeConfig(home, rawTheme string, stdout io.Writer) error {
	themeInput := strings.TrimSpace(rawTheme)
	if themeInput == "" {
		return nil
	}

	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		return err
	}

	switch {
	case runtimeconfig.ClearThemeValue(themeInput):
		cfg.Theme = ""
		if err := runtimeconfig.Save(home, cfg); err != nil {
			return err
		}
		if stdout != nil {
			fmt.Fprintln(stdout, "Runtime config: cleared theme override")
		}
		return nil
	default:
		normalized := runtimeconfig.NormalizeTheme(themeInput)
		if normalized == "" {
			return fmt.Errorf("unsupported theme %q", themeInput)
		}
		cfg.Theme = normalized
		if err := runtimeconfig.Save(home, cfg); err != nil {
			return err
		}
		if stdout != nil {
			fmt.Fprintf(stdout, "Runtime config: theme=%s\n", normalized)
		}
		return nil
	}
}

func stdinIsInteractive() bool {
	info, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}
