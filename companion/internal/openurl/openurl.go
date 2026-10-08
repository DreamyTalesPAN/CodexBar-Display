// Package openurl selects the OS URL handler without invoking a shell.
package openurl

import "runtime"

func Command(url string) (string, []string) { return commandForOS(runtime.GOOS, url) }

func commandForOS(goos, url string) (string, []string) {
	if goos == "windows" {
		return "rundll32.exe", []string{"url.dll,FileProtocolHandler", url}
	}
	return "open", []string{url}
}
