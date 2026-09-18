package service

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestDarwinLifecyclePreservesDomainAndRegistration(t *testing.T) {
	var calls []string
	manager := NewDarwin("example", "/Users/test", 501, false, func(_ context.Context, name string, args ...string) (string, error) {
		calls = append(calls, name+" "+strings.Join(args, " "))
		return "state = running\npid = 42", nil
	})
	ctx := context.Background()
	if err := manager.Install(ctx); err != nil {
		t.Fatal(err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	want := []string{"launchctl bootout gui/501/example", "launchctl bootout gui/501 /Users/test/Library/LaunchAgents/example.plist", "launchctl enable gui/501/example", "launchctl bootstrap gui/501 /Users/test/Library/LaunchAgents/example.plist", "launchctl kickstart -k gui/501/example"}
	// Construct the path natively when this command-runner contract runs on Windows.
	want[1] = "launchctl bootout gui/501 " + PlistPath("/Users/test", "example")
	want[3] = "launchctl bootstrap gui/501 " + PlistPath("/Users/test", "example")
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("calls=%v", calls)
	}
	status, err := manager.Status(ctx)
	if err != nil || status.PID != "42" || !Healthy(status.State) {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	if err := manager.Stop(ctx, true); err != nil {
		t.Fatal(err)
	}
	if calls[len(calls)-1] != "launchctl disable gui/501/example" {
		t.Fatal(calls)
	}
}

func TestManagedRuntimeSuspendsWithoutUnregistering(t *testing.T) {
	var calls []string
	manager := NewDarwin("bundled", "", 501, true, func(_ context.Context, _ string, args ...string) (string, error) {
		calls = append(calls, strings.Join(args, " "))
		if args[0] == "kill" && args[1] == "SIGCONT" {
			return "gone", errors.New("not running")
		}
		return "", nil
	})
	ctx := context.Background()
	if err := manager.Stop(ctx, false); err != nil {
		t.Fatal(err)
	}
	if err := manager.Install(ctx); err != nil {
		t.Fatal(err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	want := []string{"kill SIGSTOP gui/501/bundled", "kill SIGCONT gui/501/bundled", "kickstart -k gui/501/bundled"}
	if !reflect.DeepEqual(calls, want) {
		t.Fatal(calls)
	}
}

func TestBootstrapAlreadyLoadedRace(t *testing.T) {
	manager := NewDarwin("test", "/home", 501, false, func(_ context.Context, _ string, args ...string) (string, error) {
		if args[0] == "bootstrap" {
			return "already loaded", errors.New("race")
		}
		return "", nil
	})
	if err := manager.Install(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestUnsupportedServiceFailsClosed(t *testing.T) {
	var manager Manager = unsupported{}
	ctx := context.Background()
	for _, err := range []error{manager.Install(ctx), manager.Start(ctx), manager.Stop(ctx, false), manager.Uninstall(ctx)} {
		if !errors.Is(err, ErrUnsupported) {
			t.Fatal(err)
		}
	}
	if _, err := manager.Status(ctx); !errors.Is(err, ErrUnsupported) {
		t.Fatal(err)
	}
}
