package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func TestHelloWithoutCapabilitiesErrorNamesTheVibeTV(t *testing.T) {
	body, err := os.ReadFile("testdata/wifi-hello-1.0.45-without-capabilities.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, err = DecodeWiFiHello(bytes.NewReader(body))

	const want = "VibeTV /hello arrived without capabilities"
	if err == nil || err.Error() != want {
		t.Fatalf("error text = %v, want %q", err, want)
	}
	identity, ok := HelloIdentity(fmt.Errorf("probe: %w", err))
	if !ok || identity.DeviceID != "16198106" {
		t.Fatalf("HelloIdentity must see through wrapping, got %+v ok=%v", identity, ok)
	}
	if _, ok := HelloIdentity(errors.New(want)); ok {
		t.Fatal("a plain error with the same text carries no identity")
	}
}

func TestUnknownDeviceCapabilitiesMatchAnEmptyHello(t *testing.T) {
	unknown := UnknownDeviceCapabilities()
	if unknown.Known || unknown.NegotiatedProtocolVersion != ProtocolVersionV1 {
		t.Fatalf("an unknown device negotiates v1 and claims no identity: %+v", unknown)
	}
	if !reflect.DeepEqual(unknown, CapabilitiesFromHello(DeviceHello{})) {
		t.Fatalf("unknown capabilities must equal capabilities of an empty hello:\nunknown %+v\nempty   %+v",
			unknown, CapabilitiesFromHello(DeviceHello{}))
	}
	if unknown.SupportsTheme || unknown.SupportsThemeSpecV1 || unknown.SupportsProviderSlotsV1 ||
		unknown.SupportsBrightness || unknown.SupportsStandby || unknown.MaxFrameBytes != 0 ||
		unknown.StoredThemeSpecBytesLimit() != 0 {
		t.Fatalf("an unknown device must not advertise any capability: %+v", unknown)
	}
}

func TestErrorFrameWireShapeMatchesProtocolDoc(t *testing.T) {
	line, err := ErrorFrame("runtime/codexbar-command").MarshalLine()
	if err != nil {
		t.Fatal(err)
	}
	// protocol/PROTOCOL.md, "Error Frame": the device reads v and error only.
	if want := "{\"v\":1,\"error\":\"runtime/codexbar-command\"}\n"; string(line) != want {
		t.Fatalf("error frame wire = %q, want %q", line, want)
	}
}

func TestValidClockScheduleAcceptsOnlyQuarterHourOffsetsInRange(t *testing.T) {
	const (
		transition = int64(1767225600) // 2026-01-01T00:00:00Z
		following  = int64(1782864000) // 2026-07-01T00:00:00Z
	)
	cases := map[string]struct {
		schedule ClockSchedule
		valid    bool
	}{
		"current offset only":            {ClockSchedule{CurrentOffsetMinutes: 60}, true},
		"zero everywhere":                {ClockSchedule{}, true},
		"offset not a quarter hour":      {ClockSchedule{CurrentOffsetMinutes: 62}, false},
		"quarter hour below zero":        {ClockSchedule{CurrentOffsetMinutes: -570}, true},
		"offset past UTC+14":             {ClockSchedule{CurrentOffsetMinutes: 855}, false},
		"offset at UTC+14":               {ClockSchedule{CurrentOffsetMinutes: 840}, true},
		"offset at UTC-12":               {ClockSchedule{CurrentOffsetMinutes: -720}, true},
		"offset before UTC-12":           {ClockSchedule{CurrentOffsetMinutes: -735}, false},
		"offset without transition":      {ClockSchedule{CurrentOffsetMinutes: 60, OffsetMinutes: 60}, false},
		"one transition":                 {ClockSchedule{CurrentOffsetMinutes: 60, TransitionEpoch: transition, OffsetMinutes: 120}, true},
		"transition before 2025":         {ClockSchedule{CurrentOffsetMinutes: 60, TransitionEpoch: 1735689599, OffsetMinutes: 120}, false},
		"transition with bad offset":     {ClockSchedule{CurrentOffsetMinutes: 60, TransitionEpoch: transition, OffsetMinutes: 100}, false},
		"following offset without epoch": {ClockSchedule{CurrentOffsetMinutes: 60, TransitionEpoch: transition, OffsetMinutes: 120, FollowingOffsetMinutes: 60}, false},
		"two transitions":                {ClockSchedule{CurrentOffsetMinutes: 60, TransitionEpoch: transition, OffsetMinutes: 120, FollowingTransitionEpoch: following, FollowingOffsetMinutes: 60}, true},
		"following not after first":      {ClockSchedule{CurrentOffsetMinutes: 60, TransitionEpoch: transition, OffsetMinutes: 120, FollowingTransitionEpoch: transition, FollowingOffsetMinutes: 60}, false},
		"following with bad offset":      {ClockSchedule{CurrentOffsetMinutes: 60, TransitionEpoch: transition, OffsetMinutes: 120, FollowingTransitionEpoch: following, FollowingOffsetMinutes: 7}, false},
		"transition set, offset zero":    {ClockSchedule{CurrentOffsetMinutes: 0, TransitionEpoch: transition, OffsetMinutes: 0}, true},
		"epoch zero but offset set":      {ClockSchedule{CurrentOffsetMinutes: 60, OffsetMinutes: 120}, false},
	}
	for name, tc := range cases {
		if got := validClockSchedule(tc.schedule); got != tc.valid {
			t.Errorf("%s: validClockSchedule = %v, want %v", name, got, tc.valid)
		}
	}
}

func TestHasResetCountdownSeesEveryDeadlineLane(t *testing.T) {
	cases := map[string]struct {
		frame Frame
		want  bool
	}{
		"empty frame":                 {Frame{}, false},
		"top-level deadline":          {Frame{ResetSec: 1}, true},
		"negative deadline":           {Frame{ResetSec: -3}, false},
		"window with zero deadline":   {Frame{UsageWindows: []UsageWindow{{ID: "session"}}}, false},
		"window deadline":             {Frame{UsageWindows: []UsageWindow{{ID: "session"}, {ID: "weekly", ResetSec: 5}}}, true},
		"legacy slot deadline":        {Frame{UsageSlots: []UsageSlot{{ID: "weekly", ResetSec: 5}}}, true},
		"provider slot deadline":      {Frame{ProviderSlots: []UsageSlot{{ID: "codex", ResetSec: 5}}}, true},
		"provider slot without reset": {Frame{ProviderSlots: []UsageSlot{{ID: "codex"}}}, false},
	}
	for name, tc := range cases {
		if got := hasResetCountdown(tc.frame); got != tc.want {
			t.Errorf("%s: hasResetCountdown = %v, want %v", name, got, tc.want)
		}
	}
}

func TestResetSourceKeyFollowsTheFirmwareIdentifierRules(t *testing.T) {
	provider25 := strings.Repeat("a", 25)
	cases := map[string]struct {
		provider, window, want string
	}{
		"provider and window lowercased and trimmed": {" Claude ", " PRIMARY ", "claude:primary"},
		"provider only when window is empty":         {"claude", "", "claude"},
		"no provider means no identity":              {"", "primary", ""},
		"blank provider means no identity":           {"   ", "primary", ""},
		"dot, dash and underscore are allowed":       {"claude.ai", "a_b-c", "claude.ai:a_b-c"},
		"invalid character drops the identity":       {"claude", "w@x", ""},
		"space inside drops the identity":            {"claude", "w x", ""},
		"31 bytes is the largest identity":           {provider25, "abcde", provider25 + ":abcde"},
	}
	for name, tc := range cases {
		if got := ResetSourceKey(tc.provider, tc.window); got != tc.want {
			t.Errorf("%s: ResetSourceKey(%q, %q) = %q, want %q", name, tc.provider, tc.window, got, tc.want)
		}
	}
}

func TestTruncateUTF8BytesNeverSplitsARune(t *testing.T) {
	cases := []struct {
		value string
		max   int
		want  string
	}{
		{"abc", 0, ""},
		{"abc", -1, ""},
		{"abc", 3, "abc"},
		{"abc", 2, "ab"},
		{"äb", 1, ""},      // ä is two bytes; the cut falls inside it
		{"aä", 2, "a"},     // cut inside ä
		{"aä", 3, "aä"},    // fits exactly
		{"🤖", 3, ""},       // four-byte rune, three bytes allowed
		{"ab🤖cd", 5, "ab"}, // cut inside the emoji
		{"ab🤖cd", 6, "ab🤖"},
	}
	for _, tc := range cases {
		if got := truncateUTF8Bytes(tc.value, tc.max); got != tc.want {
			t.Errorf("truncateUTF8Bytes(%q, %d) = %q, want %q", tc.value, tc.max, got, tc.want)
		}
	}
}

func TestMarshalNormalizedLineWritesTheFrameAsGiven(t *testing.T) {
	frame := Frame{V: ProtocolVersionV2, Session: 150}

	raw, err := frame.MarshalNormalizedLine()
	if err != nil {
		t.Fatal(err)
	}
	if want := "{\"v\":2,\"session\":150}\n"; string(raw) != want {
		t.Fatalf("MarshalNormalizedLine must not clamp, got %q want %q", raw, want)
	}

	normalized, err := frame.MarshalLine()
	if err != nil {
		t.Fatal(err)
	}
	if want := "{\"v\":2,\"session\":100}\n"; string(normalized) != want {
		t.Fatalf("MarshalLine must clamp, got %q want %q", normalized, want)
	}
}

func TestResetSourceKeyKeepsWindowIdentityPastThe31ByteLimit(t *testing.T) {
	// Before: a provider:window key over 31 bytes became "", and ApplyResetTrust
	// then fell back to the bare provider key, so both windows shared a countdown.
	const provider = "claude-enterprise-team-plan-x"
	primary := ResetSourceKey(provider, "primary")
	secondary := ResetSourceKey(provider, "secondary")
	if primary == "" || secondary == "" || primary == secondary || primary == ResetSourceKey(provider, "") {
		t.Fatalf("windows of one provider need distinct identities: %q %q", primary, secondary)
	}
	for _, key := range []string{primary, secondary} {
		if len(key) > 31 || !regexp.MustCompile(`^[a-z0-9_.:-]+$`).MatchString(key) {
			t.Fatalf("key %q must fit the device identifier rules (31 bytes, [a-z0-9_.:-])", key)
		}
	}
	if again := ResetSourceKey(provider, "primary"); again != primary {
		t.Fatalf("the same identity must keep its key: %q then %q", primary, again)
	}
}

func TestResetSourceKeyLeavesEveryFittingIdentityUnchanged(t *testing.T) {
	// Every provider id in the engine fixtures, with the window ids the engine
	// emits (parse.go: "primary", "secondary") and no window. None of them may change.
	files, err := filepath.Glob("../codexbar/testdata/cli/*/*.json")
	if err != nil || len(files) == 0 {
		t.Fatalf("engine fixtures not found: %v", err)
	}
	providerField := regexp.MustCompile(`"provider"\s*:\s*"([^"]*)"`)
	providers := map[string]bool{}
	for _, file := range files {
		body, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range providerField.FindAllSubmatch(body, -1) {
			providers[string(m[1])] = true
		}
	}
	if len(providers) < 10 {
		t.Fatalf("expected many provider ids in the fixtures, found %d", len(providers))
	}
	for provider := range providers {
		for _, window := range []string{"", "primary", "secondary"} {
			want := strings.ToLower(strings.TrimSpace(provider))
			if window != "" {
				want += ":" + window
			}
			if len(want) > 31 {
				t.Fatalf("fixture identity %q does not fit; this test covers fitting ids only", want)
			}
			if got := ResetSourceKey(provider, window); got != want {
				t.Errorf("ResetSourceKey(%q, %q) = %q, want unchanged %q", provider, window, got, want)
			}
		}
	}
}

func TestFrameJSONKeepsEmptyPairLabelWithoutChangingSingleProviderLabels(t *testing.T) {
	for _, tc := range []struct {
		provider string
		label    string
		want     string
	}{
		{"codex+claude", "", `""`},
		{"codex+claude", "System busy", `"System busy"`},
		{"codex", "", ""},
		{"codex", "Codex", `"Codex"`},
	} {
		raw, err := json.Marshal(Frame{V: 2, Provider: tc.provider, Label: tc.label})
		if err != nil {
			t.Fatal(err)
		}
		var wire map[string]json.RawMessage
		if err := json.Unmarshal(raw, &wire); err != nil {
			t.Fatal(err)
		}
		if string(wire["label"]) != tc.want {
			t.Errorf("%s label=%s want %s", tc.provider, wire["label"], tc.want)
		}
	}
}
