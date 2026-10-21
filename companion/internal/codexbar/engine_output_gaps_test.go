package codexbar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"
)

// These tests pin what the Companion does today with values it reads from
// CodexBar output and with the errors it hands to the Control Center.

func TestAnyToIntReadsEngineNumbersAndNumericText(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want int
		ok   bool
	}{
		{"float64 truncates toward zero", 3.9, 3, true},
		{"negative float64 truncates toward zero", -2.5, -2, true},
		{"float32", float32(7), 7, true},
		{"int", 4, 4, true},
		{"int64", int64(5), 5, true},
		{"int32", int32(6), 6, true},
		{"json integer", json.Number("42"), 42, true},
		{"json fraction is rejected", json.Number("4.2"), 0, false},
		{"numeric text is trimmed", " 17 ", 17, true},
		// Sscanf("%d") stops at the first non-digit, so "17.5" reads as 17.
		{"numeric text stops at a decimal point", "17.5", 17, true},
		{"text without digits", "abc", 0, false},
		{"empty text", "", 0, false},
		{"bool is not a number", true, 0, false},
		{"missing value", nil, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := anyToInt(tc.in)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("anyToInt(%#v) = %d, %v; want %d, %v", tc.in, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestAnyToInt64ReadsTokenCounts(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want int64
		ok   bool
	}{
		{"float64 truncates toward zero", 12.9, 12, true},
		{"float32", float32(2), 2, true},
		{"int", 3, 3, true},
		{"int64", int64(9_000_000_000), 9_000_000_000, true},
		{"int32", int32(6), 6, true},
		{"json integer", json.Number("9"), 9, true},
		{"json fraction is rejected", json.Number("1.5"), 0, false},
		{"numeric text is trimmed", " 8 ", 8, true},
		{"text without digits", "x", 0, false},
		{"missing value", nil, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := anyToInt64(tc.in)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("anyToInt64(%#v) = %d, %v; want %d, %v", tc.in, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestAnyToFloatReadsUsageNumbers(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want float64
		ok   bool
	}{
		{"float64", 1.5, 1.5, true},
		{"float32", float32(2.5), 2.5, true},
		{"int", 3, 3, true},
		{"int64", int64(4), 4, true},
		{"int32", int32(5), 5, true},
		{"json decimal", json.Number("2.25"), 2.25, true},
		{"json text is rejected", json.Number("x"), 0, false},
		{"numeric text is trimmed", " 6.5 ", 6.5, true},
		// A decimal comma is not read as a decimal point.
		{"decimal comma is rejected", "7,5", 0, false},
		{"bool is not a number", false, 0, false},
		{"missing value", nil, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := anyToFloat(tc.in)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("anyToFloat(%#v) = %v, %v; want %v, %v", tc.in, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestTokenStatsFailureReasonClassifiesTimeoutAndCancel(t *testing.T) {
	const fallback = "cost"
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	expired, stop := context.WithTimeout(context.Background(), -time.Second)
	defer stop()
	plain := errors.New("exit status 1")

	cases := []struct {
		name    string
		ctx     context.Context
		err     error
		elapsed time.Duration
		timeout time.Duration
		want    string
	}{
		{"expired context is a timeout", expired, plain, time.Second, time.Minute, "timeout"},
		{"cancelled context is canceled", canceled, plain, time.Second, time.Minute, "canceled"},
		{"deadline error is a timeout", context.Background(), context.DeadlineExceeded, time.Second, time.Minute, "timeout"},
		{"wrapped deadline error is a timeout", context.Background(), fmt.Errorf("run: %w", context.DeadlineExceeded), time.Second, time.Minute, "timeout"},
		{"cancel error is canceled", context.Background(), context.Canceled, time.Second, time.Minute, "canceled"},
		{"run that used the budget minus one second is a timeout", context.Background(), plain, 59 * time.Second, time.Minute, "timeout"},
		{"run just inside that margin keeps the fallback", context.Background(), plain, 58 * time.Second, time.Minute, fallback},
		{"no timeout set: a long run keeps the fallback", context.Background(), plain, time.Hour, 0, fallback},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tokenStatsFailureReason(tc.ctx, tc.err, tc.elapsed, tc.timeout, fallback)
			if got != tc.want {
				t.Fatalf("tokenStatsFailureReason = %q; want %q", got, tc.want)
			}
		})
	}
}

func TestProviderScopedWebTimeoutSecondsIsClamped(t *testing.T) {
	cases := []struct {
		name string
		env  string
		want int
	}{
		{"unset uses the default", "", 3},
		{"blank uses the default", "   ", 3},
		{"text uses the default", "soon", 3},
		{"below the minimum is raised", "1", 2},
		{"negative is raised to the minimum", "-4", 2},
		{"inside the range is kept", "5", 5},
		{"above the maximum is lowered", "99", 8},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CODEXBAR_DISPLAY_PROVIDER_WEB_TIMEOUT_SECS", tc.env)
			if got := providerScopedWebTimeoutSeconds(); got != tc.want {
				t.Fatalf("providerScopedWebTimeoutSeconds() = %d; want %d", got, tc.want)
			}
		})
	}
}

func TestBrowserSignInGuidanceIsTheFixedProviderSentence(t *testing.T) {
	cases := []struct {
		name string
		id   string
		url  string
		want string
	}{
		{
			name: "login page",
			id:   "claude",
			url:  "https://claude.ai/login",
			want: "Sign in to Claude in your browser, then close the browser.",
		},
		{
			name: "path after the host",
			id:   "claude",
			url:  "https://claude.ai/settings/usage",
			want: "Sign in to Claude in your browser, then close the browser.",
		},
		{
			name: "no URL",
			id:   "codex",
			url:  "",
			want: "Sign in to Codex in your browser, then close the browser.",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := BrowserSignInGuidance(tc.id, tc.url); got != tc.want {
				t.Fatalf("BrowserSignInGuidance(%q, %q) = %q; want %q", tc.id, tc.url, got, tc.want)
			}
		})
	}
}

func TestFetchErrorMessageAndUnwrap(t *testing.T) {
	inner := errors.New("codexbar exited 2")

	if got := (*FetchError)(nil).Error(); got != "" {
		t.Fatalf("nil FetchError message = %q; want empty", got)
	}
	if got := (&FetchError{Kind: FetchErrorVersion}).Error(); got != "fetch error (version)" {
		t.Fatalf("kind-only FetchError message = %q", got)
	}
	wrapped := &FetchError{Kind: FetchErrorCommand, Err: inner}
	if got := wrapped.Error(); got != inner.Error() {
		t.Fatalf("FetchError message = %q; want the inner message", got)
	}
	if !errors.Is(wrapped, inner) {
		t.Fatal("errors.Is must reach the inner error through Unwrap")
	}
	if got := (*FetchError)(nil).Unwrap(); got != nil {
		t.Fatalf("nil FetchError Unwrap = %v; want nil", got)
	}
	if err := wrapFetchError(FetchErrorBinary, nil); err != nil {
		t.Fatalf("wrapFetchError(nil) = %v; want nil", err)
	}
}

func TestProviderSettingsErrorMessageAndUnwrap(t *testing.T) {
	inner := errors.New("settings file is locked")

	if got := (*ProviderSettingsError)(nil).Error(); got != "provider settings error" {
		t.Fatalf("nil ProviderSettingsError message = %q", got)
	}
	if got := (&ProviderSettingsError{Kind: ProviderSettingsErrorUnavailable}).Error(); got != "provider settings error" {
		t.Fatalf("no-inner-error message = %q", got)
	}
	wrapped := &ProviderSettingsError{Kind: ProviderSettingsErrorVersion, Err: inner}
	if got := wrapped.Error(); got != inner.Error() {
		t.Fatalf("ProviderSettingsError message = %q; want the inner message", got)
	}
	if !errors.Is(wrapped, inner) {
		t.Fatal("errors.Is must reach the inner error through Unwrap")
	}
}

func TestProviderSettingsErrorUnwrapNilReceiverDoesNotPanic(t *testing.T) {
	var nilErr *ProviderSettingsError
	if got := errors.Unwrap(nilErr); got != nil {
		t.Fatalf("nil ProviderSettingsError must unwrap to nil, got %v", got)
	}
}
