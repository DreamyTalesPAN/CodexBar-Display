package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type launchd struct {
	label, domain, target, plist string
	managed                      bool
	run                          Runner
}

// NewDarwin exposes the command boundary for hermetic lifecycle tests on every
// host. The gui domain never needs to be constructed by a feature caller.
func NewDarwin(label, home string, uid int, managed bool, run Runner) Manager {
	domain := fmt.Sprintf("gui/%d", uid)
	plist := ""
	if home != "" {
		plist = PlistPath(home, label)
	}
	return &launchd{label: label, domain: domain, target: domain + "/" + label, plist: plist, managed: managed, run: run}
}

func (s *launchd) Install(ctx context.Context) error {
	if s.managed {
		return nil
	} // SMAppService owns registration of bundled apps.
	s.bootout(ctx)
	_, _ = s.run(ctx, "launchctl", "enable", s.target)
	var output string
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		output, err = s.run(ctx, "launchctl", "bootstrap", s.domain, s.plist)
		if err == nil {
			return nil
		}
		if _, loadedErr := s.run(ctx, "launchctl", "print", s.target); loadedErr == nil {
			return nil
		}
		if attempt < 2 {
			s.bootout(ctx)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(300 * time.Millisecond):
			}
		}
	}
	return fmt.Errorf("bootstrap launchagent: %w (%s)", err, strings.TrimSpace(output))
}

func (s *launchd) Start(ctx context.Context) error {
	if s.managed {
		out, err := s.run(ctx, "launchctl", "kill", "SIGCONT", s.target)
		if err == nil {
			return nil
		}
		kick, kickErr := s.run(ctx, "launchctl", "kickstart", "-k", s.target)
		if kickErr != nil {
			return fmt.Errorf("resume runtime: %w (%s); kickstart: %v (%s)", err, strings.TrimSpace(out), kickErr, strings.TrimSpace(kick))
		}
		return nil
	}
	out, err := s.run(ctx, "launchctl", "kickstart", "-k", s.target)
	if err != nil {
		return fmt.Errorf("kickstart launchagent: %w (%s)", err, strings.TrimSpace(out))
	}
	return nil
}

func (s *launchd) Stop(ctx context.Context, disable bool) error {
	if s.managed && !disable {
		_, err := s.run(ctx, "launchctl", "kill", "SIGSTOP", s.target)
		return err
	}
	out, err := s.run(ctx, "launchctl", "bootout", s.target)
	trimmed := strings.TrimSpace(out)
	if err != nil && trimmed != "" && !strings.Contains(strings.ToLower(trimmed), "could not find service") && !strings.Contains(strings.ToLower(trimmed), "service is disabled") {
		return fmt.Errorf("bootout launchagent: %w (%s)", err, trimmed)
	}
	if disable {
		out, err = s.run(ctx, "launchctl", "disable", s.target)
		trimmed = strings.TrimSpace(out)
		if err != nil && trimmed != "" && !strings.Contains(strings.ToLower(trimmed), "already disabled") {
			return fmt.Errorf("disable launchagent: %w (%s)", err, trimmed)
		}
	}
	return nil
}

func (s *launchd) bootout(ctx context.Context) {
	_, _ = s.run(ctx, "launchctl", "bootout", s.target)
	if s.plist != "" {
		_, _ = s.run(ctx, "launchctl", "bootout", s.domain, s.plist)
	}
}

func (s *launchd) Uninstall(ctx context.Context) error {
	s.bootout(ctx)
	return ctx.Err()
}

func (s *launchd) Status(ctx context.Context) (Status, error) {
	status := Status{Enabled: true, State: "not-loaded"}
	if out, err := s.run(ctx, "launchctl", "print-disabled", s.domain); err == nil {
		status.Enabled = !strings.Contains(out, fmt.Sprintf("\"%s\" => disabled", s.label))
	}
	out, err := s.run(ctx, "launchctl", "print", s.target)
	status.Raw = out
	if err != nil {
		return status, err
	}
	status.State, status.PID = ParseStatus(out)
	return status, nil
}

func ParseStatus(output string) (state, pid string) {
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "state =") {
			state = strings.TrimSpace(strings.TrimPrefix(line, "state ="))
		}
		if strings.HasPrefix(line, "pid =") {
			candidate := strings.TrimSpace(strings.TrimPrefix(line, "pid ="))
			if _, err := strconv.Atoi(candidate); err == nil {
				pid = candidate
			}
		}
	}
	return
}

func Healthy(state string) bool {
	return state == "running" || state == "waiting" || state == "spawn scheduled"
}
