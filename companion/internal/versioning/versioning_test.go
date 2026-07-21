package versioning

import "testing"

func TestParseSemVerValid(t *testing.T) {
	got, err := ParseSemVer("v1.2.3-rc.1+build42")
	if err != nil {
		t.Fatalf("parse semver: %v", err)
	}
	if got.Major != 1 || got.Minor != 2 || got.Patch != 3 {
		t.Fatalf("unexpected parsed core version: %+v", got)
	}
	if got.PreRelease != "rc.1" {
		t.Fatalf("unexpected pre-release: %q", got.PreRelease)
	}
}

func TestParseSemVerInvalid(t *testing.T) {
	if _, err := ParseSemVer("1.2"); err == nil {
		t.Fatalf("expected parse error for short semver")
	}
}

func TestSemVerComparePreRelease(t *testing.T) {
	alpha, err := ParseSemVer("1.0.0-alpha")
	if err != nil {
		t.Fatalf("parse alpha: %v", err)
	}
	release, err := ParseSemVer("1.0.0")
	if err != nil {
		t.Fatalf("parse release: %v", err)
	}
	if alpha.Compare(release) >= 0 {
		t.Fatalf("expected pre-release < release")
	}
}

func TestSemVerComparePrecedence(t *testing.T) {
	cases := []struct {
		left  string
		right string
		want  int
	}{
		{"1.0.44-rc.16", "1.0.44", -1},
		{"1.0.36-rc.2", "1.0.36", -1},
		{"1.0.44-beta.3", "1.0.44-rc.1", -1},
		{"1.0.44-rc.2", "1.0.44-rc.10", -1},
		{"1.0.44-alpha", "1.0.44-alpha.1", -1},
		{"1.0.44-1", "1.0.44-alpha", -1},
		{"1.0.44", "1.0.44", 0},
		{"1.0.44+build7", "1.0.44", 0},
		{"1.0.44-rc.1+build7", "1.0.44-rc.1", 0},
		{"1.0.44", "1.0.44-rc.16", 1},
		{"1.0.45-rc.1", "1.0.44", 1},
	}
	for _, tc := range cases {
		left, err := ParseSemVer(tc.left)
		if err != nil {
			t.Fatalf("parse %q: %v", tc.left, err)
		}
		right, err := ParseSemVer(tc.right)
		if err != nil {
			t.Fatalf("parse %q: %v", tc.right, err)
		}
		if got := left.Compare(right); got != tc.want {
			t.Fatalf("Compare(%q, %q) = %d, want %d", tc.left, tc.right, got, tc.want)
		}
	}
}

func TestCompatibilityMatrixAllowsV1(t *testing.T) {
	ok, rule, err := IsCompatible("1.2.0", "1.9.4", 1)
	if err != nil {
		t.Fatalf("compatibility check failed: %v", err)
	}
	if !ok {
		t.Fatalf("expected versions to be compatible")
	}
	if rule == "" {
		t.Fatalf("expected matching rule name")
	}
}

func TestCompatibilityMatrixAllowsV2(t *testing.T) {
	ok, rule, err := IsCompatible("1.2.0", "1.9.4", 2)
	if err != nil {
		t.Fatalf("compatibility check failed: %v", err)
	}
	if !ok {
		t.Fatalf("expected versions to be compatible on protocol v2")
	}
	if rule != "v2-usb-first" {
		t.Fatalf("expected v2 rule, got %q", rule)
	}
}

func TestCompatibilityMatrixBlocksMajorMismatch(t *testing.T) {
	ok, _, err := IsCompatible("1.2.0", "2.0.0", 1)
	if err != nil {
		t.Fatalf("compatibility check failed: %v", err)
	}
	if ok {
		t.Fatalf("expected incompatible major versions")
	}
}

func TestFirmwareVersionForEnvironment(t *testing.T) {
	v, ok := FirmwareVersionForEnvironment("ESP8266_SMALLTV_ST7789")
	if !ok {
		t.Fatalf("expected firmware version mapping")
	}
	if v != "1.0.0" {
		t.Fatalf("unexpected firmware version: %q", v)
	}
}

func TestFirmwareVersionForLegacyEnvironmentAliasIsRejected(t *testing.T) {
	if _, ok := FirmwareVersionForEnvironment("esp8266_smalltv_st7789_mini"); ok {
		t.Fatalf("expected legacy environment alias to be rejected")
	}
}
