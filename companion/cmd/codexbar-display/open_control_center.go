package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/companionapi"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/openurl"
)

var openControlCenterStartLaunchAgentFn = startLaunchAgent

var openControlCenterOpenURLFn = openURL

var openControlCenterHTTPClient = &http.Client{}

func runOpenControlCenter(args []string) error {
	fs := flag.NewFlagSet("open-control-center", flag.ContinueOnError)
	addr := fs.String("addr", companionapi.DefaultAddr, "local companion API address")
	path := fs.String("path", "/control-center", "local Control Center path")
	timeout := fs.Duration("timeout", 15*time.Second, "maximum time to wait for the local Control Center")
	noOpen := fs.Bool("no-open", false, "verify the local Control Center without opening the browser")
	if err := fs.Parse(args); err != nil {
		return err
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home directory: %w", err)
	}
	if err := openControlCenterStartLaunchAgentFn(home); err != nil {
		return fmt.Errorf("start local Control Center service: %w", err)
	}

	url := localControlCenterURL(strings.TrimSpace(*addr), strings.TrimSpace(*path))
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := waitForLocalControlCenter(ctx, url); err != nil {
		return err
	}
	if *noOpen {
		fmt.Printf("Control Center ready: %s\n", url)
		return nil
	}
	if err := openControlCenterOpenURLFn(url); err != nil {
		return fmt.Errorf("open local Control Center: %w", err)
	}
	fmt.Printf("Control Center opened: %s\n", url)
	return nil
}

func localControlCenterURL(addr, path string) string {
	if addr == "" {
		addr = companionapi.DefaultAddr
	}
	if path == "" {
		path = "/control-center"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return "http://" + addr + path
}

func waitForLocalControlCenter(ctx context.Context, url string) error {
	var lastStatus int
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return fmt.Errorf("prepare local Control Center request: %w", err)
		}
		resp, err := openControlCenterHTTPClient.Do(req)
		if err == nil {
			lastStatus = resp.StatusCode
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
		}

		select {
		case <-ctx.Done():
			if lastStatus > 0 {
				return fmt.Errorf("local Control Center did not become ready at %s (last HTTP %d)", url, lastStatus)
			}
			return fmt.Errorf("local Control Center did not become ready at %s: %w", url, ctx.Err())
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func openURL(url string) error {
	name, args := openurl.Command(url)
	return exec.Command(name, args...).Run()
}
