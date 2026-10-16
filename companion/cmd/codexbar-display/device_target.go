package main

import (
	"net/url"
	"os"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func loadRuntimeConfigForCommand() (runtimeconfig.Config, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return runtimeconfig.Config{}, false
	}
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		return runtimeconfig.Config{}, false
	}
	return cfg, true
}

func sameCommandDeviceTarget(left, right string) bool {
	left = publicDeviceTargetForConfig(left)
	right = publicDeviceTargetForConfig(right)
	return left != "" && right != "" && strings.EqualFold(left, right)
}

func targetWithQueryToken(target, token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return strings.TrimSpace(target)
	}
	parsed, ok := parseCommandDeviceTarget(target)
	if !ok {
		return strings.TrimSpace(target)
	}
	query := parsed.Query()
	if strings.TrimSpace(query.Get("token")) != "" {
		return parsed.String()
	}
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func targetWithRequiredQueryToken(target, token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return strings.TrimSpace(target)
	}
	parsed, ok := parseCommandDeviceTarget(target)
	if !ok {
		return strings.TrimSpace(target)
	}
	query := parsed.Query()
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func publicDeviceTargetForConfig(target string) string {
	parsed, ok := parseCommandDeviceTarget(target)
	if !ok {
		return strings.TrimSpace(target)
	}
	query := parsed.Query()
	query.Del("token")
	parsed.RawQuery = query.Encode()
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func parseCommandDeviceTarget(target string) (*url.URL, bool) {
	target = strings.TrimSpace(target)
	if target == "" {
		return nil, false
	}
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil || strings.TrimSpace(parsed.Scheme) == "" || strings.TrimSpace(parsed.Host) == "" {
		return nil, false
	}
	return parsed, true
}

func deviceTokenFromCommandTarget(target string) string {
	parsed, ok := parseCommandDeviceTarget(target)
	if !ok {
		return ""
	}
	return strings.TrimSpace(parsed.Query().Get("token"))
}
