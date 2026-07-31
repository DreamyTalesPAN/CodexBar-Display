package codexbar

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DashboardServeHost                   = "127.0.0.1"
	DashboardServeDefaultRefreshInterval = 60 * time.Second
	DashboardServeMinimumRefreshInterval = 60 * time.Second
	dashboardServeHealthPath             = "/health"
	dashboardServeTokenEnv               = "CODEXBAR_DASHBOARD_TOKEN"
	dashboardServeDefaultBackoffBase     = time.Second
	dashboardServeDefaultBackoffMax      = 30 * time.Second
	dashboardServeDefaultHealthInterval  = 2 * time.Second
	dashboardServeHealthTimeout          = 2 * time.Second
	dashboardServeMaxHealthFailures      = 3
)

type DashboardServe interface {
	Info() DashboardServeInfo
}

type DashboardServeInfo struct {
	Endpoint        string        `json:"endpoint,omitempty"`
	Token           string        `json:"token,omitempty"`
	Healthy         bool          `json:"healthy"`
	Running         bool          `json:"running"`
	PID             int           `json:"pid,omitempty"`
	LastHealthAt    time.Time     `json:"lastHealthAt,omitempty"`
	LastError       string        `json:"lastError,omitempty"`
	RefreshInterval time.Duration `json:"refreshInterval"`
}

type DashboardServeConfig struct {
	Binary          string
	RefreshInterval time.Duration
	HealthInterval  time.Duration
	BackoffBase     time.Duration
	BackoffMax      time.Duration
	HTTPClient      *http.Client
	Logf            func(string, ...any)

	testArgsPrefix []string
	testEnv        []string
}

type DashboardServeSupervisor struct {
	binary          string
	token           string
	refreshInterval time.Duration
	healthInterval  time.Duration
	backoffBase     time.Duration
	backoffMax      time.Duration
	client          *http.Client
	logf            func(string, ...any)
	testArgsPrefix  []string
	testEnv         []string

	mu   sync.RWMutex
	info DashboardServeInfo
}

func StartDashboardServe(ctx context.Context, logf func(string, ...any)) DashboardServe {
	bin, err := FindBinary()
	if err == nil {
		err = CheckDashboardServeVersion(ctx, bin)
	}
	if err != nil {
		if logf != nil {
			logf("codexbar-dashboard event=supervisor-unavailable err=%v\n", err)
		}
		return nil
	}
	supervisor, err := NewDashboardServeSupervisor(DashboardServeConfig{Binary: bin, Logf: logf})
	if err != nil {
		if logf != nil {
			logf("codexbar-dashboard event=supervisor-unavailable err=%v\n", err)
		}
		return nil
	}
	go supervisor.Run(ctx)
	return supervisor
}

func NewDashboardServeSupervisor(cfg DashboardServeConfig) (*DashboardServeSupervisor, error) {
	token, err := randomDashboardToken()
	if err != nil {
		return nil, fmt.Errorf("generate dashboard token: %w", err)
	}
	refreshInterval := cfg.RefreshInterval
	if refreshInterval <= 0 {
		refreshInterval = DashboardServeDefaultRefreshInterval
	}
	if refreshInterval < DashboardServeMinimumRefreshInterval {
		refreshInterval = DashboardServeMinimumRefreshInterval
	}
	healthInterval := cfg.HealthInterval
	if healthInterval <= 0 {
		healthInterval = dashboardServeDefaultHealthInterval
	}
	backoffBase := cfg.BackoffBase
	if backoffBase <= 0 {
		backoffBase = dashboardServeDefaultBackoffBase
	}
	backoffMax := cfg.BackoffMax
	if backoffMax <= 0 {
		backoffMax = dashboardServeDefaultBackoffMax
	}
	if backoffMax < backoffBase {
		backoffMax = backoffBase
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: dashboardServeHealthTimeout}
	}
	return &DashboardServeSupervisor{
		binary:          strings.TrimSpace(cfg.Binary),
		token:           token,
		refreshInterval: refreshInterval,
		healthInterval:  healthInterval,
		backoffBase:     backoffBase,
		backoffMax:      backoffMax,
		client:          client,
		logf:            cfg.Logf,
		testArgsPrefix:  append([]string(nil), cfg.testArgsPrefix...),
		testEnv:         append([]string(nil), cfg.testEnv...),
		info: DashboardServeInfo{
			Token:           token,
			RefreshInterval: refreshInterval,
		},
	}, nil
}

func (s *DashboardServeSupervisor) Info() DashboardServeInfo {
	if s == nil {
		return DashboardServeInfo{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.info
}

func (s *DashboardServeSupervisor) Run(ctx context.Context) {
	if s == nil {
		return
	}
	backoff := dashboardServeBackoff{base: s.backoffBase, max: s.backoffMax}
	for {
		if err := ctx.Err(); err != nil {
			s.setStopped("", err)
			return
		}
		err := s.runOnce(ctx)
		if err := ctx.Err(); err != nil {
			s.setStopped("", err)
			return
		}
		if err != nil && s.logf != nil {
			s.logf("codexbar-dashboard event=child-exited retry=%s err=%v\n", backoff.Peek(), err)
		}
		delay := backoff.Next()
		select {
		case <-ctx.Done():
			s.setStopped("", ctx.Err())
			return
		case <-time.After(delay):
		}
	}
}

func (s *DashboardServeSupervisor) runOnce(ctx context.Context) error {
	bin := s.binary
	if bin == "" {
		resolved, err := FindBinary()
		if err != nil {
			s.setStopped("", err)
			return err
		}
		bin = resolved
	}

	port, err := allocateDashboardServePort()
	if err != nil {
		s.setStopped("", err)
		return err
	}
	endpoint := "http://" + net.JoinHostPort(DashboardServeHost, strconv.Itoa(port))
	args := append([]string{}, s.testArgsPrefix...)
	args = append(args,
		"serve",
		"--host", DashboardServeHost,
		"--port", strconv.Itoa(port),
		"--refresh-interval", strconv.Itoa(durationSecondsCeil(s.refreshInterval)),
		"--request-timeout", "0",
	)

	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = dashboardServeEnvironment(configPathFromContext(ctx), s.token, s.testEnv)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		s.setStopped(endpoint, err)
		return err
	}
	s.setStarted(endpoint, cmd.Process.Pid)
	if s.logf != nil {
		s.logf("codexbar-dashboard event=child-started endpoint=%s pid=%d refreshInterval=%s\n", endpoint, cmd.Process.Pid, s.refreshInterval)
	}

	waitc := make(chan error, 1)
	go func() {
		waitc <- cmd.Wait()
	}()

	ticker := time.NewTicker(s.healthInterval)
	defer ticker.Stop()
	healthFailures := 0
	checkHealth := func() bool {
		if s.checkHealth(ctx, endpoint) {
			healthFailures = 0
			return false
		}
		healthFailures++
		return healthFailures >= dashboardServeMaxHealthFailures
	}
	if checkHealth() {
		return s.stopUnhealthyDashboardServeChild(endpoint, cmd, waitc)
	}
	for {
		select {
		case err := <-waitc:
			if ctx.Err() != nil {
				s.setStopped(endpoint, ctx.Err())
				return ctx.Err()
			}
			s.setStopped(endpoint, err)
			if err == nil {
				return errors.New("codexbar serve exited")
			}
			return err
		case <-ticker.C:
			if checkHealth() {
				return s.stopUnhealthyDashboardServeChild(endpoint, cmd, waitc)
			}
		case <-ctx.Done():
			select {
			case err := <-waitc:
				s.setStopped(endpoint, err)
				return err
			default:
			}
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			<-waitc
			s.setStopped(endpoint, ctx.Err())
			return ctx.Err()
		}
	}
}

func (s *DashboardServeSupervisor) stopUnhealthyDashboardServeChild(endpoint string, cmd *exec.Cmd, waitc <-chan error) error {
	if s.logf != nil {
		s.logf("codexbar-dashboard event=child-unhealthy failures=%d\n", dashboardServeMaxHealthFailures)
	}
	if cmd.Process != nil {
		if err := cmd.Process.Kill(); err != nil {
			err = fmt.Errorf("stop unhealthy codexbar serve: %w", err)
			s.setStopped(endpoint, err)
			return err
		}
	}
	err := <-waitc
	s.setStopped(endpoint, err)
	if err != nil {
		return err
	}
	return errors.New("unhealthy codexbar serve exited")
}

func (s *DashboardServeSupervisor) checkHealth(ctx context.Context, endpoint string) bool {
	if s == nil || s.client == nil {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+dashboardServeHealthPath, nil)
	if err != nil {
		s.setHealth(false, err)
		return false
	}
	resp, err := s.client.Do(req)
	if err != nil {
		s.setHealth(false, err)
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		s.setHealth(false, fmt.Errorf("GET /health returned HTTP %d", resp.StatusCode))
		return false
	}
	s.setHealth(true, nil)
	return true
}

func (s *DashboardServeSupervisor) setStarted(endpoint string, pid int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.info.Endpoint = endpoint
	s.info.PID = pid
	s.info.Running = true
	s.info.Healthy = false
	s.info.LastError = ""
	s.info.RefreshInterval = s.refreshInterval
}

func (s *DashboardServeSupervisor) setStopped(endpoint string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if endpoint != "" {
		s.info.Endpoint = endpoint
	}
	s.info.PID = 0
	s.info.Running = false
	s.info.Healthy = false
	if err != nil && !errors.Is(err, context.Canceled) {
		s.info.LastError = err.Error()
	}
	s.info.RefreshInterval = s.refreshInterval
}

func (s *DashboardServeSupervisor) setHealth(healthy bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.info.Healthy = healthy
	s.info.LastHealthAt = time.Now().UTC()
	if err != nil {
		s.info.LastError = err.Error()
	} else if healthy {
		s.info.LastError = ""
	}
}

func dashboardServeEnvironment(configPath, token string, extra []string) []string {
	env := commandEnvironment(configPath)
	filtered := make([]string, 0, len(env)+len(extra)+1)
	for _, entry := range env {
		if strings.HasPrefix(entry, dashboardServeTokenEnv+"=") {
			continue
		}
		filtered = append(filtered, entry)
	}
	for _, entry := range extra {
		if strings.HasPrefix(entry, dashboardServeTokenEnv+"=") {
			continue
		}
		filtered = append(filtered, entry)
	}
	return append(filtered, dashboardServeTokenEnv+"="+token)
}

func allocateDashboardServePort() (int, error) {
	for range 20 {
		listener, err := net.Listen("tcp", net.JoinHostPort(DashboardServeHost, "0"))
		if err != nil {
			return 0, err
		}
		tcpAddr, ok := listener.Addr().(*net.TCPAddr)
		port := 0
		if ok && tcpAddr != nil {
			port = tcpAddr.Port
		}
		closeErr := listener.Close()
		if closeErr != nil {
			return 0, closeErr
		}
		if port > 0 && port != 8080 {
			return port, nil
		}
	}
	return 0, errors.New("could not allocate a non-8080 dashboard port")
}

func randomDashboardToken() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}

func durationSecondsCeil(d time.Duration) int {
	if d <= 0 {
		return 0
	}
	seconds := d / time.Second
	if d%time.Second != 0 {
		seconds++
	}
	if seconds < 1 {
		seconds = 1
	}
	return int(seconds)
}

type dashboardServeBackoff struct {
	base    time.Duration
	max     time.Duration
	current time.Duration
}

func (b *dashboardServeBackoff) Next() time.Duration {
	if b.current <= 0 {
		b.current = b.base
		return b.current
	}
	next := b.current * 2
	if next > b.max {
		next = b.max
	}
	b.current = next
	return b.current
}

func (b *dashboardServeBackoff) Peek() time.Duration {
	if b.current <= 0 {
		return b.base
	}
	next := b.current * 2
	if next > b.max {
		next = b.max
	}
	return next
}
