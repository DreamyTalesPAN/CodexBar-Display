package errcode

import (
	"errors"
	"fmt"
	"testing"
)

type codedError struct{ code Code }

func (e codedError) Error() string   { return "coded error" }
func (e codedError) ErrorCode() Code { return e.code }

type recoverableError struct{ action string }

func (e recoverableError) Error() string          { return "recoverable error" }
func (e recoverableError) RecoveryAction() string { return e.action }

var allCodes = []Code{
	TransportSerialPortNotFound,
	TransportNoSerialPorts,
	TransportNoUSBSerialPorts,
	TransportNoMatchingDevice,
	TransportForeignDevice,
	TransportCableFirmwareTooOld,
	TransportMultipleDevices,
	TransportSerialOpen,
	TransportSerialWrite,
	TransportSerialProbe,
	TransportSerialCloseTimeout,
	ProtocolDeviceHelloUnavailable,
	ProtocolFrameEncode,
	ProtocolFrameTooLarge,
	ProtocolThemeSpecInvalid,
	ProtocolThemeSpecIncompatible,
	RuntimeSerialResolve,
	RuntimeSerialWrite,
	RuntimeCycleTimeout,
	RuntimeFrameEncode,
	RuntimeFrameTooLarge,
	RuntimeCodexbarBinary,
	RuntimeCodexbarVersion,
	RuntimeCodexbarCmd,
	RuntimeCodexbarParse,
	RuntimeNoProviders,
	RuntimePairingRequired,
	RuntimeWriterLocked,
	SetupCodexbarValidate,
	SetupCodexbarInstall,
	SetupDependencyPreflight,
	SetupListPorts,
	SetupSelectPort,
	SetupSerialProbe,
	SetupResolveExecutable,
	SetupResolveHome,
	SetupUnsupportedHardware,
	SetupLocateRepository,
	SetupFlashFirmware,
	SetupInstallBinary,
	SetupInstallRecovery,
	SetupWriteRuntimeConfig,
	SetupWriteLaunchAgent,
	SetupLaunchBootstrap,
	SetupLaunchKickstart,
	SetupLaunchVerify,
	UpgradeResolvePort,
	UpgradePortBusy,
	UpgradeVersionGuard,
	UpgradeSnapshotCompanion,
	UpgradeStateWrite,
	UpgradeFlashFirmware,
	UpgradeLaunchAgent,
	RollbackStateLoad,
	RollbackMissingKnownGood,
	RollbackCompanionRestore,
	RollbackFirmwareRestore,
	RollbackLaunchAgent,
}

func TestOfReadsCodeThroughErrorWrapping(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want Code
	}{
		{name: "nil error", err: nil, want: ""},
		{name: "plain error has no code", err: errors.New("boom"), want: ""},
		{name: "coded error", err: codedError{code: TransportNoSerialPorts}, want: TransportNoSerialPorts},
		{name: "wrapped coded error", err: fmt.Errorf("setup: %w", codedError{code: SetupFlashFirmware}), want: SetupFlashFirmware},
		{name: "coded error with empty code", err: codedError{}, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Of(tt.err); got != tt.want {
				t.Fatalf("Of(%v)=%q, expected %q", tt.err, got, tt.want)
			}
		})
	}
}

func TestRecoveryReadsActionThroughErrorWrapping(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "nil error", err: nil, want: ""},
		{name: "plain error has no recovery", err: errors.New("boom"), want: ""},
		{name: "recoverable error", err: recoverableError{action: "Retry."}, want: "Retry."},
		{name: "wrapped recoverable error", err: fmt.Errorf("upgrade: %w", recoverableError{action: "Reconnect."}), want: "Reconnect."},
		{name: "coded error has no recovery action", err: codedError{code: RuntimeNoProviders}, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Recovery(tt.err); got != tt.want {
				t.Fatalf("Recovery(%v)=%q, expected %q", tt.err, got, tt.want)
			}
		})
	}
}

func TestDefaultRecoveryHasActionForEveryKnownCode(t *testing.T) {
	for _, code := range allCodes {
		if got := DefaultRecovery(code); got == "" {
			t.Fatalf("DefaultRecovery(%q) is empty; every known code needs a customer recovery step", code)
		}
	}
	for _, code := range []Code{Unknown, "", "runtime/not-a-code"} {
		if got := DefaultRecovery(code); got != "" {
			t.Fatalf("DefaultRecovery(%q)=%q, expected no recovery", code, got)
		}
	}
}

func TestDefaultRecoveryPinsCustomerCopyForSharedCodes(t *testing.T) {
	tests := []struct {
		name  string
		codes []Code
		want  string
	}{
		{
			name:  "no serial ports",
			codes: []Code{TransportNoSerialPorts, TransportNoUSBSerialPorts},
			want:  "Reconnect the board with a data-capable USB cable and retry.",
		},
		{
			name:  "setup file writes",
			codes: []Code{SetupInstallBinary, SetupInstallRecovery, SetupWriteRuntimeConfig, SetupWriteLaunchAgent},
			want:  "Verify write permissions under `~/Library` and rerun setup.",
		},
		{
			name:  "launch agent",
			codes: []Code{SetupLaunchBootstrap, SetupLaunchKickstart, SetupLaunchVerify},
			want:  "Inspect `launchctl print gui/$(id -u)/com.codexbar-display.daemon` and daemon logs.",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, code := range tt.codes {
				if got := DefaultRecovery(code); got != tt.want {
					t.Fatalf("DefaultRecovery(%q)=%q, expected %q", code, got, tt.want)
				}
			}
		})
	}
}
