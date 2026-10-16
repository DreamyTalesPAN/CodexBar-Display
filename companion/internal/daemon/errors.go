package daemon

import (
	"errors"
	"fmt"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

var errMarshalFrameTooLarge = errors.New("frame exceeds max bytes")

var ErrConnectionModeChanged = errors.New("VibeTV connection mode changed")

type runtimeErrorKind errcode.Code

const (
	runtimeErrorUnknown         runtimeErrorKind = runtimeErrorKind(errcode.Unknown)
	runtimeErrorSerialResolve   runtimeErrorKind = runtimeErrorKind(errcode.RuntimeSerialResolve)
	runtimeErrorSerialWrite     runtimeErrorKind = runtimeErrorKind(errcode.RuntimeSerialWrite)
	runtimeErrorCycleTimeout    runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCycleTimeout)
	runtimeErrorFrameEncode     runtimeErrorKind = runtimeErrorKind(errcode.RuntimeFrameEncode)
	runtimeErrorFrameTooLarge   runtimeErrorKind = runtimeErrorKind(errcode.RuntimeFrameTooLarge)
	runtimeErrorDeviceHello     runtimeErrorKind = runtimeErrorKind(errcode.ProtocolDeviceHelloUnavailable)
	runtimeErrorCodexbarBinary  runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarBinary)
	runtimeErrorCodexbarVersion runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarVersion)
	runtimeErrorCodexbarCmd     runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarCmd)
	runtimeErrorCodexbarParse   runtimeErrorKind = runtimeErrorKind(errcode.RuntimeCodexbarParse)
	runtimeErrorNoProviders     runtimeErrorKind = runtimeErrorKind(errcode.RuntimeNoProviders)
	runtimeErrorPairingRequired runtimeErrorKind = runtimeErrorKind(errcode.RuntimePairingRequired)
)

type RuntimeError struct {
	Kind runtimeErrorKind
	Op   string
	Err  error
	Hint string
}

func (e *RuntimeError) Error() string {
	if e == nil {
		return ""
	}
	if e.Op == "" {
		return fmt.Sprintf("%s: %v", e.ErrorCode(), e.Err)
	}
	return fmt.Sprintf("%s (%s): %v", e.ErrorCode(), e.Op, e.Err)
}

func (e *RuntimeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *RuntimeError) ErrorCode() errcode.Code {
	if e == nil || e.Kind == "" {
		return errcode.Unknown
	}
	return errcode.Code(e.Kind)
}

func (e *RuntimeError) RecoveryAction() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Hint) != "" {
		return strings.TrimSpace(e.Hint)
	}
	return errcode.DefaultRecovery(e.ErrorCode())
}

func wifiDeviceHelloRuntimeError(target string, err error) *RuntimeError {
	if err == nil {
		err = errors.New("device capabilities unknown")
	}
	return &RuntimeError{
		Kind: runtimeErrorDeviceHello,
		Op:   "read-device-hello",
		Err:  fmt.Errorf("read VibeTV /hello from %s: %w", publicDeviceTarget(target), err),
		Hint: "Wait for VibeTV to finish starting and verify its Wi-Fi connection; the daemon will retry /hello with backoff and will not send frames until the handshake succeeds.",
	}
}

func usageDataRuntimeError(kind runtimeErrorKind, op string, err error) *RuntimeError {
	if kind == "" {
		kind = runtimeErrorUnknown
	}
	if err == nil {
		err = errors.New("usage data unavailable")
	}

	switch strings.TrimSpace(op) {
	case "select-provider":
		return &RuntimeError{
			Kind: kind,
			Op:   "select-provider",
			Err:  fmt.Errorf("select provider: %w", err),
		}
	default:
		return &RuntimeError{
			Kind: kind,
			Op:   "fetch-usage",
			Err:  fmt.Errorf("fetch codexbar usage: %w", err),
		}
	}
}

func asRuntimeError(err error) *RuntimeError {
	var runtimeErr *RuntimeError
	if errors.As(err, &runtimeErr) && runtimeErr != nil {
		return runtimeErr
	}
	return &RuntimeError{
		Kind: runtimeErrorUnknown,
		Op:   "unknown",
		Err:  err,
	}
}

// deviceUnreachableError reports whether the cycle failed because the VibeTV
// itself was not reachable over its transport. Only these failures earn the
// short reconnect retry; everything else keeps the normal interval.
func deviceUnreachableError(runtimeErr *RuntimeError) bool {
	if runtimeErr == nil {
		return false
	}
	switch runtimeErr.Kind {
	case runtimeErrorDeviceHello, runtimeErrorSerialResolve, runtimeErrorSerialWrite:
		return true
	}
	return false
}

func runtimeErrorKindFromFetchErr(err error) runtimeErrorKind {
	if err == nil {
		return runtimeErrorUnknown
	}

	switch codexbar.FetchErrorKindOf(err) {
	case codexbar.FetchErrorBinary:
		return runtimeErrorCodexbarBinary
	case codexbar.FetchErrorVersion:
		return runtimeErrorCodexbarVersion
	case codexbar.FetchErrorCommand:
		return runtimeErrorCodexbarCmd
	case codexbar.FetchErrorParse:
		return runtimeErrorCodexbarParse
	case codexbar.FetchErrorNoProviders:
		return runtimeErrorNoProviders
	default:
		if errors.Is(err, codexbar.ErrNoProviders) {
			return runtimeErrorNoProviders
		}
		return runtimeErrorCodexbarCmd
	}
}

func runtimeErrorFrameCode(kind runtimeErrorKind) string {
	if kind == "" {
		kind = runtimeErrorUnknown
	}
	return string(kind)
}
