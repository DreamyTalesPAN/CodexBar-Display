package errcode

import "errors"

type Code string

const (
	Unknown Code = "runtime/unknown"

	TransportSerialPortNotFound Code = "transport/serial-port-not-found"
	TransportNoSerialPorts      Code = "transport/no-serial-ports"
	TransportNoUSBSerialPorts   Code = "transport/no-usb-serial-ports"
	TransportSerialOpen         Code = "transport/serial-open"
	TransportSerialWrite        Code = "transport/serial-write"
	TransportSerialProbe        Code = "transport/serial-probe"
	TransportSerialCloseTimeout Code = "transport/serial-close-timeout"

	ProtocolDeviceHelloUnavailable Code = "protocol/device-hello-unavailable"
	ProtocolFrameEncode            Code = "protocol/frame-encode"
	ProtocolFrameTooLarge          Code = "protocol/frame-too-large"
	ProtocolThemeSpecInvalid       Code = "protocol/theme-spec-invalid"
	ProtocolThemeSpecIncompatible  Code = "protocol/theme-spec-incompatible"

	RuntimeSerialResolve  Code = "runtime/serial-resolve"
	RuntimeSerialWrite    Code = "runtime/serial-write"
	RuntimeCycleTimeout   Code = "runtime/cycle-timeout"
	RuntimeFrameEncode    Code = "runtime/frame-encode"
	RuntimeFrameTooLarge  Code = "runtime/frame-too-large"
	RuntimeCodexbarBinary Code = "runtime/codexbar-binary"
	RuntimeCodexbarCmd    Code = "runtime/codexbar-command"
	RuntimeCodexbarParse  Code = "runtime/codexbar-parse"
	RuntimeNoProviders    Code = "runtime/no-providers"

	SetupCodexbarValidate    Code = "setup/codexbar-validate"
	SetupCodexbarInstall     Code = "setup/codexbar-install"
	SetupListPorts           Code = "setup/list-ports"
	SetupSelectPort          Code = "setup/select-port"
	SetupSerialProbe         Code = "setup/serial-probe"
	SetupResolveExecutable   Code = "setup/resolve-executable"
	SetupResolveHome         Code = "setup/resolve-home"
	SetupUnsupportedHardware Code = "setup/unsupported-hardware"
	SetupLocateRepository    Code = "setup/locate-repository"
	SetupFlashFirmware       Code = "setup/flash-firmware"
	SetupInstallBinary       Code = "setup/install-binary"
	SetupInstallRecovery     Code = "setup/install-recovery-assets"
	SetupWriteRuntimeConfig  Code = "setup/write-runtime-config"
	SetupWriteLaunchAgent    Code = "setup/write-launchagent"
	SetupLaunchBootstrap     Code = "setup/launchagent-bootstrap"
	SetupLaunchKickstart     Code = "setup/launchagent-kickstart"
	SetupLaunchVerify        Code = "setup/launchagent-verify"

	UpgradeResolvePort       Code = "upgrade/resolve-port"
	UpgradePortBusy          Code = "upgrade/port-busy"
	UpgradeVersionGuard      Code = "upgrade/version-guard"
	UpgradeSnapshotCompanion Code = "upgrade/snapshot-companion"
	UpgradeStateWrite        Code = "upgrade/state-write"
	UpgradeFlashFirmware     Code = "upgrade/flash-firmware"
	UpgradeLaunchAgent       Code = "upgrade/launchagent-restart"

	RollbackStateLoad        Code = "rollback/state-load"
	RollbackMissingKnownGood Code = "rollback/missing-known-good"
	RollbackCompanionRestore Code = "rollback/companion-restore"
	RollbackFirmwareRestore  Code = "rollback/firmware-restore"
	RollbackLaunchAgent      Code = "rollback/launchagent-restart"
)

type Coded interface {
	ErrorCode() Code
}

type Recoverable interface {
	RecoveryAction() string
}

func Of(err error) Code {
	if err == nil {
		return ""
	}
	var coded Coded
	if errors.As(err, &coded) {
		return coded.ErrorCode()
	}
	return ""
}

func Recovery(err error) string {
	if err == nil {
		return ""
	}
	var recoverable Recoverable
	if errors.As(err, &recoverable) {
		return recoverable.RecoveryAction()
	}
	return ""
}

func DefaultRecovery(code Code) string {
	switch code {
	case TransportSerialPortNotFound:
		return "Check `ls /dev/cu.usb*`, reconnect the device, then retry with a valid `--port`."
	case TransportNoSerialPorts, TransportNoUSBSerialPorts:
		return "Reconnect the board with a data-capable USB cable and retry."
	case TransportSerialOpen:
		return "Release the port (`lsof <port>`), reconnect device, then retry."
	case TransportSerialWrite:
		return "Wait for reconnect or run `codexbar-display doctor` to verify serial health."
	case TransportSerialProbe:
		return "Disconnect/reconnect the board and re-run `codexbar-display setup`."
	case TransportSerialCloseTimeout:
		return "Retry; if persistent, restart the daemon to clear stale serial handles."
	case ProtocolDeviceHelloUnavailable:
		return "Proceed with capability fallback or reconnect the board to retry handshake."
	case ProtocolFrameEncode:
		return "Reduce optional payload fields and retry."
	case ProtocolFrameTooLarge:
		return "Use a shorter frame payload or device profile with larger `maxFrameBytes`."
	case ProtocolThemeSpecInvalid:
		return "Fix ThemeSpec schema/fields and retry (`codexbar-display theme-validate --spec ...`)."
	case ProtocolThemeSpecIncompatible:
		return "Use a ThemeSpec compatible with device capabilities (`maxThemeSpecBytes`, `maxThemePrimitives`, fallback theme)."
	case RuntimeSerialResolve:
		return "Reconnect the board or pass `--port` to `codexbar-display daemon`."
	case RuntimeSerialWrite:
		return "Check cable/device power; daemon will retry automatically."
	case RuntimeCycleTimeout:
		return "Daemon cycle timed out; restart daemon (LaunchAgent KeepAlive will auto-restart) and run `codexbar-display doctor` to verify USB serial health."
	case RuntimeFrameEncode, RuntimeFrameTooLarge:
		return "Inspect payload size and optional fields; reduce frame footprint."
	case RuntimeCodexbarBinary:
		return "Install CodexBar CLI or set `CODEXBAR_BIN`."
	case RuntimeCodexbarCmd:
		return "Retry; if persistent run `codexbar usage --json` manually and inspect output."
	case RuntimeCodexbarParse:
		return "Update CodexBar and check provider JSON output format."
	case RuntimeNoProviders:
		return "Open a provider once in CodexBar, then retry."
	case SetupCodexbarValidate:
		return "Install CodexBar CLI (`brew install --cask steipete/tap/codexbar`) and rerun setup."
	case SetupCodexbarInstall:
		return "Install CodexBar manually, then rerun setup."
	case SetupListPorts, SetupSelectPort:
		return "Reconnect the board and retry port selection."
	case SetupSerialProbe:
		return "Disconnect/reconnect the board and rerun setup."
	case SetupResolveExecutable, SetupResolveHome:
		return "Verify local user environment and retry."
	case SetupUnsupportedHardware:
		return "Pick matching `--firmware-env` for connected board."
	case SetupLocateRepository:
		return "Run from repo root or pass `--skip-flash` if already flashed."
	case SetupFlashFirmware:
		return "Fix PlatformIO/USB flash issue and rerun setup."
	case SetupInstallBinary, SetupInstallRecovery, SetupWriteRuntimeConfig, SetupWriteLaunchAgent:
		return "Verify write permissions under `~/Library` and rerun setup."
	case SetupLaunchBootstrap, SetupLaunchKickstart, SetupLaunchVerify:
		return "Inspect `launchctl print gui/$(id -u)/com.codexbar-display.daemon` and daemon logs."
	case UpgradeResolvePort:
		return "Reconnect the board or pass a valid `--port`."
	case UpgradePortBusy:
		return "Stop processes using the serial port (`lsof <port>`) and retry upgrade."
	case UpgradeVersionGuard:
		return "Use a compatible firmware target/version or update companion/firmware together."
	case UpgradeSnapshotCompanion:
		return "Ensure companion install dir is writable, then retry upgrade."
	case UpgradeStateWrite:
		return "Verify write permissions under `~/Library/Application Support/codexbar-display`."
	case UpgradeFlashFirmware:
		return "Fix flash/setup error details and rerun `codexbar-display upgrade`."
	case UpgradeLaunchAgent:
		return "Restart launch agent manually with `launchctl bootout/bootstrap/kickstart`."
	case RollbackStateLoad:
		return "Run one successful `codexbar-display upgrade` first or provide explicit rollback flags."
	case RollbackMissingKnownGood:
		return "Provide explicit rollback inputs (`--image`, `--manifest`) or run upgrade to capture known-good state."
	case RollbackCompanionRestore:
		return "Verify known-good companion snapshot exists and is readable."
	case RollbackFirmwareRestore:
		return "Provide a valid firmware backup image/manifest and retry rollback."
	case RollbackLaunchAgent:
		return "Restart launch agent manually with `launchctl bootout/bootstrap/kickstart`."
	default:
		return ""
	}
}
