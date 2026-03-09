package usb

import (
	"errors"
	"fmt"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

var ErrDeviceHelloUnavailable = errors.New("device hello unavailable")

type TransportError struct {
	code     errcode.Code
	op       string
	path     string
	err      error
	recovery string
}

func (e *TransportError) Error() string {
	if e == nil {
		return ""
	}
	base := string(e.code)
	if e.op != "" {
		base = fmt.Sprintf("%s (%s)", base, e.op)
	}
	if e.path != "" {
		base = fmt.Sprintf("%s path=%s", base, e.path)
	}
	if e.err != nil {
		return fmt.Sprintf("%s: %v", base, e.err)
	}
	return base
}

func (e *TransportError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func (e *TransportError) ErrorCode() errcode.Code {
	if e == nil {
		return ""
	}
	return e.code
}

func (e *TransportError) RecoveryAction() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.recovery) != "" {
		return strings.TrimSpace(e.recovery)
	}
	return errcode.DefaultRecovery(e.code)
}

func wrapTransportError(code errcode.Code, op, path, recovery string, err error) error {
	if err == nil {
		return nil
	}
	return &TransportError{
		code:     code,
		op:       op,
		path:     strings.TrimSpace(path),
		err:      err,
		recovery: recovery,
	}
}
