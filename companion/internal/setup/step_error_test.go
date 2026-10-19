package setup

import (
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

func TestStepErrorCodeMapsEveryKnownStep(t *testing.T) {
	tests := map[string]errcode.Code{
		"codexbar-validate":       errcode.SetupCodexbarValidate,
		"codexbar-install":        errcode.SetupCodexbarInstall,
		"dependency-preflight":    errcode.SetupDependencyPreflight,
		"list-ports":              errcode.SetupListPorts,
		"select-port":             errcode.SetupSelectPort,
		"serial-probe":            errcode.SetupSerialProbe,
		"resolve-executable":      errcode.SetupResolveExecutable,
		"resolve-home":            errcode.SetupResolveHome,
		"unsupported-hardware":    errcode.SetupUnsupportedHardware,
		"locate-repository":       errcode.SetupLocateRepository,
		"flash-firmware":          errcode.SetupFlashFirmware,
		"flash-firmware-validate": errcode.SetupFlashFirmware,
		"install-binary":          errcode.SetupInstallBinary,
		"install-recovery-assets": errcode.SetupInstallRecovery,
		"write-runtime-config":    errcode.SetupWriteRuntimeConfig,
		"write-launchagent":       errcode.SetupWriteLaunchAgent,
		"launchagent-bootstrap":   errcode.SetupLaunchBootstrap,
		"launchagent-kickstart":   errcode.SetupLaunchKickstart,
		"launchagent-verify":      errcode.SetupLaunchVerify,
	}
	for step, want := range tests {
		if got := (&StepError{Step: step}).ErrorCode(); got != want {
			t.Fatalf("step %q maps to %q, expected %q", step, got, want)
		}
	}
}

func TestStepErrorCodePrefersExplicitCodeAndTrimsStep(t *testing.T) {
	tests := []struct {
		name string
		err  *StepError
		want errcode.Code
	}{
		{name: "nil receiver", err: nil, want: ""},
		{name: "explicit code wins over step", err: &StepError{Step: "flash-firmware", Code: errcode.TransportSerialOpen}, want: errcode.TransportSerialOpen},
		{name: "step is trimmed", err: &StepError{Step: "  launchagent-verify "}, want: errcode.SetupLaunchVerify},
		{name: "empty step has no code", err: &StepError{}, want: ""},
		{name: "unknown step has no code", err: &StepError{Step: "not-a-step"}, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.ErrorCode(); got != tt.want {
				t.Fatalf("ErrorCode()=%q, expected %q", got, tt.want)
			}
		})
	}
}

func TestStepErrorRecoveryPrefersHintThenCodeDefault(t *testing.T) {
	tests := []struct {
		name string
		err  *StepError
		want string
	}{
		{name: "nil receiver", err: nil, want: ""},
		{name: "hint is trimmed and wins", err: &StepError{Step: "codexbar-install", Hint: "  Open the CodexBar page.  "}, want: "Open the CodexBar page."},
		{name: "blank hint falls back to code default", err: &StepError{Step: "codexbar-install", Hint: "   "}, want: errcode.DefaultRecovery(errcode.SetupCodexbarInstall)},
		{name: "explicit code without step uses its default", err: &StepError{Code: errcode.RuntimeNoProviders}, want: errcode.DefaultRecovery(errcode.RuntimeNoProviders)},
		{name: "no hint and no code has no recovery", err: &StepError{Step: "not-a-step"}, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.RecoveryAction(); got != tt.want {
				t.Fatalf("RecoveryAction()=%q, expected %q", got, tt.want)
			}
		})
	}
}
