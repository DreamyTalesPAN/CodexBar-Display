package theme

import "strings"

type Definition struct {
	ID                  int
	ProtocolName        string
	CompileDefaultMacro string
}

const (
	Classic = "classic"
	CRT     = "crt"
	Mini    = "mini"
)

var registry = []Definition{
	{
		ID:                  0,
		ProtocolName:        Classic,
		CompileDefaultMacro: "VIBEBLOCK_THEME_CLASSIC",
	},
	{
		ID:                  1,
		ProtocolName:        CRT,
		CompileDefaultMacro: "VIBEBLOCK_THEME_CRT",
	},
	{
		ID:                  2,
		ProtocolName:        Mini,
		CompileDefaultMacro: "VIBEBLOCK_THEME_MINI",
	},
}

func DefaultProtocolName() string {
	return Classic
}

func Definitions() []Definition {
	out := make([]Definition, len(registry))
	copy(out, registry)
	return out
}

func Names() []string {
	out := make([]string, len(registry))
	for i := range registry {
		out[i] = registry[i].ProtocolName
	}
	return out
}

func Normalize(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	if normalized == "standard" {
		return Classic
	}
	for _, def := range registry {
		if normalized == def.ProtocolName {
			return normalized
		}
	}
	return ""
}
