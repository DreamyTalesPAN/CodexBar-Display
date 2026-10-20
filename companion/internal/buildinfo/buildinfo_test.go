package buildinfo

import "testing"

func TestNormalizedVersionTrimsAndFallsBackToZero(t *testing.T) {
	old := Version
	defer func() { Version = old }()

	cases := []struct {
		name    string
		version string
		want    string
	}{
		{"release version is kept", "1.4.2", "1.4.2"},
		{"surrounding whitespace is trimmed", "  1.4.2\n", "1.4.2"},
		{"empty version falls back to 0.0.0", "", "0.0.0"},
		{"whitespace-only version falls back to 0.0.0", " \t ", "0.0.0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			Version = tc.version
			if got := NormalizedVersion(); got != tc.want {
				t.Fatalf("NormalizedVersion() with Version=%q = %q, want %q", tc.version, got, tc.want)
			}
		})
	}
}
