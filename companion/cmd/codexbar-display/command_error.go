package main

import (
	"fmt"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

type commandError struct {
	Op   string
	Code errcode.Code
	Err  error
	Hint string
}

func (e *commandError) Error() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Op) == "" {
		return e.Err.Error()
	}
	return fmt.Sprintf("%s: %v", e.Op, e.Err)
}

func (e *commandError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *commandError) ErrorCode() errcode.Code {
	if e == nil {
		return ""
	}
	return e.Code
}

func (e *commandError) RecoveryAction() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Hint) != "" {
		return strings.TrimSpace(e.Hint)
	}
	return errcode.DefaultRecovery(e.Code)
}

func appendRecoveryHint(existing, extra string) string {
	existing = strings.TrimSpace(existing)
	extra = strings.TrimSpace(extra)
	switch {
	case existing == "":
		return extra
	case extra == "":
		return existing
	default:
		return existing + "; " + extra
	}
}
