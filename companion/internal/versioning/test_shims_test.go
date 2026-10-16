package versioning

import "strings"

// Short forms of production functions that only the tests call.

var firmwareVersionByEnvironment = map[string]string{
	"lilygo_t_display_s3":    "1.0.0",
	"esp8266_smalltv_st7789": "1.0.0",
}

func FirmwareVersionForEnvironment(env string) (string, bool) {
	key := strings.TrimSpace(strings.ToLower(env))
	if key == "" {
		return "", false
	}
	v, ok := firmwareVersionByEnvironment[key]
	return v, ok
}
