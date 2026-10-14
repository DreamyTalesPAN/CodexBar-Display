package versioning

import "strings"

// Short forms of production functions that only the tests call.

func FirmwareVersionForEnvironment(env string) (string, bool) {
	key := strings.TrimSpace(strings.ToLower(env))
	if key == "" {
		return "", false
	}
	v, ok := firmwareVersionByEnvironment[key]
	return v, ok
}
