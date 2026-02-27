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
