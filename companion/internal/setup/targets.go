package setup

import "strings"

type firmwareTarget struct {
	Env         string
	ProjectDir  string
	ExpectedIDs []string
}

const firmwareEnvironment = "esp8266_smalltv_st7789"

var firmwareTargets = map[string]firmwareTarget{
	"lilygo_t_display_s3": {
		Env:         "lilygo_t_display_s3",
		ProjectDir:  "firmware",
		ExpectedIDs: []string{"esp32-lilygo-t-display-s3"},
	},
	"esp8266_probe": {
		Env:         "esp8266_probe",
		ProjectDir:  "firmware_esp8266",
		ExpectedIDs: []string{"esp8266-probe"},
	},
	"esp8266_smalltv_st7789": {
		Env:         "esp8266_smalltv_st7789",
		ProjectDir:  "firmware_esp8266",
		ExpectedIDs: []string{"esp8266-smalltv-st7789"},
	},
	"esp8266_smalltv_st7789_crt": {
		Env:         "esp8266_smalltv_st7789_crt",
		ProjectDir:  "firmware_esp8266",
		ExpectedIDs: []string{"esp8266-smalltv-st7789"},
	},
	"esp8266_smalltv_st7789_alt": {
		Env:         "esp8266_smalltv_st7789_alt",
		ProjectDir:  "firmware_esp8266",
		ExpectedIDs: []string{"esp8266-smalltv-st7789-alt"},
	},
	"esp8266_smalltv_st7789_alt_crt": {
		Env:         "esp8266_smalltv_st7789_alt_crt",
		ProjectDir:  "firmware_esp8266",
		ExpectedIDs: []string{"esp8266-smalltv-st7789-alt"},
	},
}

func DefaultFirmwareEnvironment() string {
	return firmwareEnvironment
}

func lookupFirmwareTarget(env string) (firmwareTarget, bool) {
	key := strings.TrimSpace(strings.ToLower(env))
	target, ok := firmwareTargets[key]
	return target, ok
}

func firmwareTargetExpectedIDs(env string) []string {
	target, ok := lookupFirmwareTarget(env)
	if !ok {
		return nil
	}
	return append([]string(nil), target.ExpectedIDs...)
}
