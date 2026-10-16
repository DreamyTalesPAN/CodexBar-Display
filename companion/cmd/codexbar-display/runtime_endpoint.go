package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/companionapi"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

type runtimeEndpoint struct {
	Origin string `json:"origin"`
	PID    int    `json:"pid"`
}

func runtimeEndpointPath(home string) string {
	return filepath.Join(
		runtimepaths.Root(home),
		"run",
		"runtime-endpoint.json",
	)
}

func writeRuntimeEndpoint(path string, endpoint runtimeEndpoint) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.Chmod(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(endpoint)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".runtime-endpoint-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}

func removeRuntimeEndpoint(path string, pid int) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var endpoint runtimeEndpoint
	if json.Unmarshal(data, &endpoint) == nil && endpoint.PID == pid {
		_ = os.Remove(path)
	}
}

func doctorCompanionOrigins() []string {
	defaultOrigin := "http://" + companionapi.DefaultAddr
	origins := []string{defaultOrigin}
	if home, err := os.UserHomeDir(); err == nil {
		if data, err := os.ReadFile(runtimeEndpointPath(home)); err == nil {
			var endpoint runtimeEndpoint
			if json.Unmarshal(data, &endpoint) == nil {
				if published := strings.TrimSpace(endpoint.Origin); published != "" && published != defaultOrigin {
					origins = append([]string{published}, origins...)
				}
			}
		}
	}
	return origins
}

func runtimeHealthOrigins(home string) []string {
	defaultOrigin := "http://" + companionapi.DefaultAddr
	origins := []string{defaultOrigin}
	if data, err := os.ReadFile(runtimeEndpointPath(home)); err == nil {
		var endpoint runtimeEndpoint
		if json.Unmarshal(data, &endpoint) == nil {
			if published := strings.TrimSpace(endpoint.Origin); published != "" && published != defaultOrigin {
				origins = append([]string{published}, origins...)
			}
		}
	}
	return origins
}
