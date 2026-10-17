package theme

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type protocolThemeRegistry struct {
	Version             int    `json:"version"`
	DefaultProtocolName string `json:"defaultProtocolName"`
	Themes              []struct {
		ID                  int    `json:"id"`
		ProtocolName        string `json:"protocolName"`
		CompileDefaultMacro string `json:"compileDefaultMacro"`
	} `json:"themes"`
}

type frameSchema struct {
	Properties struct {
		Theme struct {
			Enum []string `json:"enum"`
		} `json:"theme"`
	} `json:"properties"`
}

func TestCompanionThemeRegistryMatchesProtocolRegistryFile(t *testing.T) {
	protocolRegistry := loadProtocolThemeRegistry(t)

	if protocolRegistry.DefaultProtocolName != DefaultProtocolName() {
		t.Fatalf("default mismatch: protocol=%q companion=%q", protocolRegistry.DefaultProtocolName, DefaultProtocolName())
	}

	companionDefs := Definitions()
	if len(companionDefs) != len(protocolRegistry.Themes) {
		t.Fatalf("theme count mismatch: protocol=%d companion=%d", len(protocolRegistry.Themes), len(companionDefs))
	}

	for i := range companionDefs {
		got := companionDefs[i]
		want := protocolRegistry.Themes[i]
		if got.ID != want.ID {
			t.Fatalf("theme[%d] id mismatch: protocol=%d companion=%d", i, want.ID, got.ID)
		}
		if got.ProtocolName != want.ProtocolName {
			t.Fatalf("theme[%d] name mismatch: protocol=%q companion=%q", i, want.ProtocolName, got.ProtocolName)
		}
		if got.CompileDefaultMacro != want.CompileDefaultMacro {
			t.Fatalf("theme[%d] compile default macro mismatch: protocol=%q companion=%q", i, want.CompileDefaultMacro, got.CompileDefaultMacro)
		}
	}
}

func TestCompanionThemeRegistryMatchesProtocolSchemaEnum(t *testing.T) {
	protocolSchema := loadFrameSchema(t)

	if !reflect.DeepEqual(protocolSchema.Properties.Theme.Enum, Names()) {
		t.Fatalf("protocol schema enum mismatch: schema=%v companion=%v", protocolSchema.Properties.Theme.Enum, Names())
	}
}

func TestNormalizeMapsNamesAndStandardAlias(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "classic name", input: "classic", want: Classic},
		{name: "crt name", input: "crt", want: CRT},
		{name: "mini name", input: "mini", want: Mini},
		{name: "upper case is folded", input: "CRT", want: CRT},
		{name: "surrounding whitespace is trimmed", input: "  Mini\t", want: Mini},
		{name: "standard alias maps to classic", input: "standard", want: Classic},
		{name: "standard alias is case and space insensitive", input: " Standard ", want: Classic},
		{name: "unknown name is rejected", input: "neon", want: ""},
		{name: "near miss is rejected", input: "classicc", want: ""},
		{name: "inner whitespace is not removed", input: "c r t", want: ""},
		{name: "empty string is rejected", input: "", want: ""},
		{name: "whitespace only is rejected", input: "   ", want: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Normalize(tc.input); got != tc.want {
				t.Fatalf("Normalize(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func loadProtocolThemeRegistry(t *testing.T) protocolThemeRegistry {
	t.Helper()
	path := filepath.Join(repoRoot(t), "protocol", "theme_registry.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read theme registry: %v", err)
	}
	var out protocolThemeRegistry
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("parse theme registry: %v", err)
	}
	return out
}

func loadFrameSchema(t *testing.T) frameSchema {
	t.Helper()
	path := filepath.Join(repoRoot(t), "protocol", "schema.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	var out frameSchema
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("parse schema: %v", err)
	}
	return out
}

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "companion", "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("repository root not found from %s", dir)
		}
		dir = parent
	}
}
