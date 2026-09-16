package openurl

import (
	"reflect"
	"testing"
)

func TestCommand(t *testing.T) {
	url := "http://127.0.0.1:47832/?a=one&b=two"
	for _, tc := range []struct {
		goos, name string
		args       []string
	}{
		{"darwin", "open", []string{url}},
		{"windows", "rundll32.exe", []string{"url.dll,FileProtocolHandler", url}},
	} {
		name, args := commandForOS(tc.goos, url)
		if name != tc.name || !reflect.DeepEqual(args, tc.args) {
			t.Fatalf("%s: %s %q", tc.goos, name, args)
		}
	}
}
