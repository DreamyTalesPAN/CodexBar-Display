package transport

import "testing"

// The screensaver preview borrows the screen without standby, so a snapshot can
// report a live path while Standby.Active is false. Reading the drawn spec
// there hands out a /themes/s/ path as the live slot, which a rollback would
// then write into it.
func TestLiveThemeSpecPathPrefersTheReportedWayBack(t *testing.T) {
	cases := []struct {
		name    string
		active  bool
		live    string
		drawn   string
		drawnOn bool
		want    string
	}{
		{name: "awake reports the drawn live theme", drawn: "/themes/u/claude--5-ef8ada.json", drawnOn: true, want: "/themes/u/claude--5-ef8ada.json"},
		{name: "standby reports its saved path", active: true, live: "/themes/u/claude--5-ef8ada.json", drawn: "/themes/s/nc-3-e18e4217.json", drawnOn: true, want: "/themes/u/claude--5-ef8ada.json"},
		{name: "preview reports its saved path without standby", live: "/themes/u/claude--5-ef8ada.json", drawn: "/themes/s/nc-3-e18e4217.json", drawnOn: true, want: "/themes/u/claude--5-ef8ada.json"},
		{name: "standby without a saved path yields nothing", active: true, drawn: "/themes/s/nc-3-e18e4217.json", drawnOn: true, want: ""},
		{name: "inactive spec yields nothing", drawn: "/themes/u/claude--5-ef8ada.json", want: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var snapshot DeviceHealthSnapshot
			snapshot.Standby.Active = tc.active
			snapshot.Standby.LiveThemePath = tc.live
			snapshot.Display.ThemeSpec.Path = tc.drawn
			snapshot.Display.ThemeSpec.Active = tc.drawnOn
			if got := snapshot.LiveThemeSpecPath(); got != tc.want {
				t.Fatalf("LiveThemeSpecPath() = %q, want %q", got, tc.want)
			}
		})
	}
}
