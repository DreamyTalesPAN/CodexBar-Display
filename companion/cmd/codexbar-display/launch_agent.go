package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
)

const launchAgentLabel = runtimepaths.LegacyDisplayStreamLaunchAgentLabel + ".plist"

func restartLaunchAgent(home string) error {
	label := runtimepaths.DisplayStreamLaunchAgentLabel()
	managed := label != runtimepaths.LegacyDisplayStreamLaunchAgentLabel
	if runtime.GOOS == "windows" {
		if _, err := os.Stat(service.TaskConfigPath(home, label)); errors.Is(err, os.ErrNotExist) {
			return nil
		} else if err != nil {
			return err
		}
	}
	if runtime.GOOS != "windows" && !managed && !fileExists(service.PlistPath(home, label)) {
		return nil
	}
	manager := service.New(label, home, managed)
	ctx := context.Background()
	if err := manager.Install(ctx); err != nil {
		return err
	}
	return manager.Start(ctx)
}

func startLaunchAgent(home string) error {
	if runtime.GOOS == "windows" {
		if _, err := service.ReadTaskConfig(home, runtimepaths.DisplayStreamLaunchAgentLabel()); err != nil {
			return fmt.Errorf("read installed task configuration (rerun setup): %w", err)
		}
		return restartLaunchAgent(home)
	}
	plist := service.PlistPath(home, strings.TrimSuffix(launchAgentLabel, ".plist"))
	if !fileExists(plist) {
		return fmt.Errorf("launchagent plist not found: %s", plist)
	}
	return restartLaunchAgent(home)
}

func stopLaunchAgent(disable bool) error {
	label := runtimepaths.DisplayStreamLaunchAgentLabel()
	return service.New(label, "", label != runtimepaths.LegacyDisplayStreamLaunchAgentLabel).Stop(context.Background(), disable)
}

type launchAgentStatus = service.Status

func queryLaunchAgentStatus(label string) (launchAgentStatus, error) {
	status, err := service.New(label, "", label != runtimepaths.LegacyDisplayStreamLaunchAgentLabel).Status(context.Background())
	if err != nil {
		trimmed := strings.TrimSpace(status.Raw)
		lower := strings.ToLower(trimmed)
		if runtime.GOOS != "windows" && !errors.Is(err, service.ErrUnsupported) && (strings.Contains(lower, "could not find service") || strings.Contains(lower, "not found") || trimmed == "") {
			return status, nil
		}
		return status, fmt.Errorf("inspect background service: %w (%s)", err, trimmed)
	}
	return status, nil
}
