package codexbar

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type dashboardServeHelperRecord struct {
	Args     []string `json:"args"`
	EnvToken string   `json:"envToken"`
	PID      int      `json:"pid"`
}

type dashboardServeRoundTripper func(*http.Request) (*http.Response, error)

func (fn dashboardServeRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestDashboardServeSupervisorStartsPrivateLoopbackChild(t *testing.T) {
	listener8080, err := net.Listen("tcp", net.JoinHostPort(DashboardServeHost, "8080"))
	if err != nil {
		t.Skipf("127.0.0.1:8080 is unavailable for the untouched-listener check: %v", err)
	}
	defer listener8080.Close()

	recordPath := t.TempDir() + "/dashboard-helper.jsonl"
	supervisor := newTestDashboardServeSupervisor(t, "serve", recordPath, 5*time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		supervisor.Run(ctx)
		close(done)
	}()
	defer func() {
		cancel()
		waitForDashboardSupervisorDone(t, done)
	}()

	info := waitForDashboardServeHealthy(t, supervisor)
	if info.Endpoint == "" || !strings.HasPrefix(info.Endpoint, "http://127.0.0.1:") {
		t.Fatalf("expected loopback endpoint, got %#v", info)
	}
	if endpointPort(t, info.Endpoint) == 8080 {
		t.Fatalf("supervisor must never use port 8080: %#v", info)
	}
	if info.Token == "" {
		t.Fatalf("expected generated bearer token in local supervisor info")
	}
	if info.RefreshInterval < DashboardServeMinimumRefreshInterval {
		t.Fatalf("refresh interval must be at least 60s, got %s", info.RefreshInterval)
	}

	records := waitForDashboardServeRecords(t, recordPath, 1)
	record := records[0]
	joinedArgs := strings.Join(record.Args, " ")
	for _, forbidden := range []string{
		"--allow-plain-http",
		"--dashboard-token",
		info.Token,
	} {
		if strings.Contains(joinedArgs, forbidden) {
			t.Fatalf("child argv leaked forbidden value %q: %v", forbidden, record.Args)
		}
	}
	if record.EnvToken != info.Token {
		t.Fatalf("expected token only through CODEXBAR_DASHBOARD_TOKEN, env=%q info=%q", record.EnvToken, info.Token)
	}
	if got := argValue(record.Args, "--host"); got != DashboardServeHost {
		t.Fatalf("expected loopback host arg, got %q in %v", got, record.Args)
	}
	if got := argValue(record.Args, "--port"); got == "" || got == "8080" {
		t.Fatalf("expected non-8080 port arg, got %q in %v", got, record.Args)
	}
	if got := argValue(record.Args, "--refresh-interval"); got != "60" {
		t.Fatalf("expected refresh interval to clamp to 60 seconds, got %q in %v", got, record.Args)
	}
	if got := argValue(record.Args, "--request-timeout"); got != "0" {
		t.Fatalf("expected request timeout to be disabled, got %q in %v", got, record.Args)
	}
}

func TestDashboardServeSupervisorRestartsCrashedChildWithBackoff(t *testing.T) {
	recordPath := t.TempDir() + "/dashboard-helper.jsonl"
	supervisor := newTestDashboardServeSupervisor(t, "crash", recordPath, 60*time.Second)
	supervisor.backoffBase = 10 * time.Millisecond
	supervisor.backoffMax = 25 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		supervisor.Run(ctx)
		close(done)
	}()
	defer func() {
		cancel()
		waitForDashboardSupervisorDone(t, done)
	}()

	records := waitForDashboardServeRecords(t, recordPath, 2)
	if records[0].EnvToken == "" || records[0].EnvToken != records[1].EnvToken {
		t.Fatalf("expected one daemon-start token across crash restarts, got %#v", records)
	}
	for _, record := range records[:2] {
		if strings.Contains(strings.Join(record.Args, " "), record.EnvToken) {
			t.Fatalf("restart argv leaked bearer token: %v", record.Args)
		}
		if argValue(record.Args, "--port") == "8080" {
			t.Fatalf("restart used forbidden port 8080: %v", record.Args)
		}
	}
}

func TestDashboardServeSupervisorRestartsChildAfterConsecutiveHealthFailures(t *testing.T) {
	recordPath := t.TempDir() + "/dashboard-helper.jsonl"
	supervisor := newTestDashboardServeSupervisor(t, "serve", recordPath, 60*time.Second)
	supervisor.client = &http.Client{Transport: dashboardServeRoundTripper(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("health unavailable")
	})}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		supervisor.Run(ctx)
		close(done)
	}()
	defer func() {
		cancel()
		waitForDashboardSupervisorDone(t, done)
	}()

	records := waitForDashboardServeRecords(t, recordPath, 2)
	if records[0].PID == records[1].PID {
		t.Fatalf("expected a new child after repeated failed health checks, got %#v", records)
	}
}

func TestDashboardServeSupervisorHealthSuccessResetsFailureCount(t *testing.T) {
	recordPath := t.TempDir() + "/dashboard-helper.jsonl"
	supervisor := newTestDashboardServeSupervisor(t, "serve", recordPath, 60*time.Second)
	responses := []bool{false, false, true, false, false, true}
	checks := 0
	var checksMu sync.Mutex
	supervisor.client = &http.Client{Transport: dashboardServeRoundTripper(func(req *http.Request) (*http.Response, error) {
		checksMu.Lock()
		defer checksMu.Unlock()
		checks++
		healthy := checks > len(responses) || responses[checks-1]
		if !healthy {
			return nil, errors.New("health unavailable")
		}
		return &http.Response{
			StatusCode: http.StatusNoContent,
			Body:       io.NopCloser(strings.NewReader("")),
			Request:    req,
		}, nil
	})}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		supervisor.Run(ctx)
		close(done)
	}()
	defer func() {
		cancel()
		waitForDashboardSupervisorDone(t, done)
	}()

	waitForDashboardServeRecords(t, recordPath, 1)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		checksMu.Lock()
		completed := checks >= len(responses)
		checksMu.Unlock()
		if completed {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	checksMu.Lock()
	completed := checks >= len(responses)
	checkCount := checks
	checksMu.Unlock()
	if !completed {
		t.Fatalf("expected %d health checks, got %d", len(responses), checkCount)
	}
	if records := readDashboardServeRecords(t, recordPath); len(records) != 1 {
		t.Fatalf("a successful health check must reset failures, got %#v", records)
	}
}

func TestDashboardServeSupervisorGeneratesRandomTokenPerInstance(t *testing.T) {
	first, err := NewDashboardServeSupervisor(DashboardServeConfig{Binary: os.Args[0]})
	if err != nil {
		t.Fatalf("new first supervisor: %v", err)
	}
	second, err := NewDashboardServeSupervisor(DashboardServeConfig{Binary: os.Args[0]})
	if err != nil {
		t.Fatalf("new second supervisor: %v", err)
	}
	if first.Info().Token == "" || first.Info().Token == second.Info().Token {
		t.Fatalf("expected distinct random tokens, got first=%q second=%q", first.Info().Token, second.Info().Token)
	}
}

func TestDashboardServeHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_DASHBOARD_SERVE_HELPER") != "1" {
		return
	}
	runDashboardServeHelperProcess()
	os.Exit(0)
}

func newTestDashboardServeSupervisor(t *testing.T, mode, recordPath string, refreshInterval time.Duration) *DashboardServeSupervisor {
	t.Helper()
	supervisor, err := NewDashboardServeSupervisor(DashboardServeConfig{
		Binary:          os.Args[0],
		RefreshInterval: refreshInterval,
		HealthInterval:  10 * time.Millisecond,
		BackoffBase:     10 * time.Millisecond,
		BackoffMax:      25 * time.Millisecond,
		testArgsPrefix:  []string{"-test.run=TestDashboardServeHelperProcess", "--"},
		testEnv: []string{
			"GO_WANT_DASHBOARD_SERVE_HELPER=1",
			"DASHBOARD_SERVE_HELPER_MODE=" + mode,
			"DASHBOARD_SERVE_HELPER_RECORD=" + recordPath,
		},
	})
	if err != nil {
		t.Fatalf("new supervisor: %v", err)
	}
	return supervisor
}

func runDashboardServeHelperProcess() {
	args := argsAfterDoubleDash(os.Args)
	if len(args) == 0 || args[0] != "serve" {
		helperExit("expected serve command, got %v", args)
	}
	host := argValue(args, "--host")
	port := argValue(args, "--port")
	if host == "" || port == "" {
		helperExit("missing host/port args: %v", args)
	}
	record := dashboardServeHelperRecord{
		Args:     args,
		EnvToken: os.Getenv(dashboardServeTokenEnv),
		PID:      os.Getpid(),
	}
	recordPath := os.Getenv("DASHBOARD_SERVE_HELPER_RECORD")
	if recordPath != "" {
		file, err := os.OpenFile(recordPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			helperExit("open record file: %v", err)
		}
		if err := json.NewEncoder(file).Encode(record); err != nil {
			_ = file.Close()
			helperExit("write record file: %v", err)
		}
		if err := file.Close(); err != nil {
			helperExit("close record file: %v", err)
		}
	}
	if os.Getenv("DASHBOARD_SERVE_HELPER_MODE") == "crash" {
		os.Exit(42)
	}
	mux := http.NewServeMux()
	mux.HandleFunc(dashboardServeHealthPath, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	if err := http.ListenAndServe(net.JoinHostPort(host, port), mux); err != nil {
		helperExit("listen: %v", err)
	}
}

func argsAfterDoubleDash(args []string) []string {
	for i, arg := range args {
		if arg == "--" && i+1 < len(args) {
			return args[i+1:]
		}
	}
	return nil
}

func helperExit(format string, args ...any) {
	_, _ = fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(2)
}

func waitForDashboardServeHealthy(t *testing.T, supervisor *DashboardServeSupervisor) DashboardServeInfo {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		info := supervisor.Info()
		if info.Running && info.Healthy {
			return info
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("dashboard serve did not become healthy, last info: %#v", supervisor.Info())
	return DashboardServeInfo{}
}

func waitForDashboardServeRecords(t *testing.T, path string, want int) []dashboardServeHelperRecord {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		records := readDashboardServeRecords(t, path)
		if len(records) >= want {
			return records
		}
		time.Sleep(10 * time.Millisecond)
	}
	records := readDashboardServeRecords(t, path)
	t.Fatalf("expected %d helper records, got %d: %#v", want, len(records), records)
	return nil
}

func readDashboardServeRecords(t *testing.T, path string) []dashboardServeHelperRecord {
	t.Helper()
	file, err := os.Open(path)
	if errorsIsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatalf("open helper records: %v", err)
	}
	defer file.Close()
	var records []dashboardServeHelperRecord
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var record dashboardServeHelperRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			t.Fatalf("decode helper record %q: %v", scanner.Text(), err)
		}
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan helper records: %v", err)
	}
	return records
}

func waitForDashboardSupervisorDone(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("dashboard supervisor did not stop")
	}
}

func endpointPort(t *testing.T, endpoint string) int {
	t.Helper()
	hostPort := strings.TrimPrefix(endpoint, "http://")
	_, portRaw, err := net.SplitHostPort(hostPort)
	if err != nil {
		t.Fatalf("parse endpoint %q: %v", endpoint, err)
	}
	port, err := strconv.Atoi(portRaw)
	if err != nil {
		t.Fatalf("parse endpoint port %q: %v", portRaw, err)
	}
	return port
}

func argValue(args []string, name string) string {
	for i, arg := range args {
		if arg == name && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

func errorsIsNotExist(err error) bool {
	return err != nil && os.IsNotExist(err)
}
