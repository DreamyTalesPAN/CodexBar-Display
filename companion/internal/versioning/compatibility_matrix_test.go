package versioning

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type protocolCompatibilityMatrix struct {
	SchemaVersion         int                 `json:"schemaVersion"`
	FirmwareByEnvironment map[string]string   `json:"firmwareByEnvironment"`
	Rules                 []CompatibilityRule `json:"rules"`
}

func TestDefaultCompatibilityMatrixMatchesProtocolCompatibilityFile(t *testing.T) {
	matrix := loadProtocolCompatibilityMatrix(t)
	if !reflect.DeepEqual(matrix.Rules, DefaultCompatibilityMatrix()) {
		t.Fatalf("compatibility rules mismatch: protocol=%v companion=%v", matrix.Rules, DefaultCompatibilityMatrix())
	}
}

func TestFirmwareVersionForEnvironmentMatchesProtocolCompatibilityFile(t *testing.T) {
	matrix := loadProtocolCompatibilityMatrix(t)
	for env, want := range matrix.FirmwareByEnvironment {
		got, ok := FirmwareVersionForEnvironment(env)
		if !ok {
			t.Fatalf("expected firmware mapping for env %q", env)
		}
		if got != want {
			t.Fatalf("firmware mapping mismatch for env %q: protocol=%q companion=%q", env, want, got)
		}
	}
}

func loadProtocolCompatibilityMatrix(t *testing.T) protocolCompatibilityMatrix {
	t.Helper()
	path := filepath.Join(repoRoot(t), "protocol", "compatibility_matrix.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read compatibility matrix: %v", err)
	}

	var out protocolCompatibilityMatrix
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("parse compatibility matrix: %v", err)
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
