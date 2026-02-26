package health

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

const (
	launchAgentLabel = "com.vibeblock.daemon"
	defaultOutLog    = "/tmp/vibeblock-daemon.out.log"
	defaultErrLog    = "/tmp/vibeblock-daemon.err.log"
)

type deps struct {
	stdout      io.Writer
	uid         func() int
	runCommand  func(context.Context, string, ...string) (string, error)
	resolvePort func(string) (string, error)
	readFile    func(string) ([]byte, error)
}

func (d deps) withDefaults() deps {
	if d.stdout == nil {
		d.stdout = os.Stdout
	}
	if d.uid == nil {
		d.uid = os.Getuid
	}
	if d.runCommand == nil {
		d.runCommand = runSystemCommand
	}
	if d.resolvePort == nil {
		d.resolvePort = usb.ResolvePort
	}
	if d.readFile == nil {
		d.readFile = os.ReadFile
	}
	return d
}

type logEvent struct {
	Line      string
	Timestamp time.Time
}

func Run(ctx context.Context) error {
	return runWithDeps(ctx, deps{})
}

func runWithDeps(ctx context.Context, d deps) error {
	d = d.withDefaults()

	service := fmt.Sprintf("gui/%d/%s", d.uid(), launchAgentLabel)
	launchctlOut, launchctlErr := d.runCommand(ctx, "launchctl", "print", service)
	state, pid := parseLaunchctlStatus(launchctlOut)
	if state == "" {
		state = "unknown"
	}

	detectedPort, portErr := d.resolvePort("")
	lastSent := findLastSentFrameEvent(defaultOutLog, d.readFile)
	lastOutError := findLastOutErrorEvent(defaultOutLog, d.readFile)
	lastErrLogLine := findLastNonEmptyEvent(defaultErrLog, d.readFile)
	lastError := latestEvent(lastOutError, lastErrLogLine)

	fmt.Fprintln(d.stdout, "vibeblock health")
	fmt.Fprintf(d.stdout, "launchagent: %s", state)
	if pid != "" {
		fmt.Fprintf(d.stdout, " pid=%s", pid)
	}
	if launchctlErr != nil {
		fmt.Fprintf(d.stdout, " (launchctl error: %v)", launchctlErr)
	}
	fmt.Fprintln(d.stdout)

	if portErr != nil {
		fmt.Fprintf(d.stdout, "detected port: unavailable (%v)\n", portErr)
	} else {
		fmt.Fprintf(d.stdout, "detected port: %s\n", detectedPort)
	}

	if lastSent.Line == "" {
		fmt.Fprintf(d.stdout, "last sent frame: none (%s)\n", defaultOutLog)
	} else {
		when := formatTimestamp(lastSent.Timestamp)
		port := extractSentFramePort(lastSent.Line)
		if port == "" {
			fmt.Fprintf(d.stdout, "last sent frame: %s\n", when)
		} else {
			fmt.Fprintf(d.stdout, "last sent frame: %s port=%s\n", when, port)
		}
	}

	if lastError.Line == "" {
		fmt.Fprintln(d.stdout, "last error: none")
	} else {
		fmt.Fprintf(d.stdout, "last error: %s %s\n", formatTimestamp(lastError.Timestamp), strings.TrimSpace(lastError.Line))
	}

	return nil
}

func runSystemCommand(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func parseLaunchctlStatus(output string) (state, pid string) {
	lines := strings.Split(output, "\n")
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "state =") {
			state = strings.TrimSpace(strings.TrimPrefix(line, "state ="))
		}
		if strings.HasPrefix(line, "pid =") {
			pid = strings.TrimSpace(strings.TrimPrefix(line, "pid ="))
			if _, err := strconv.Atoi(pid); err != nil {
				pid = ""
			}
		}
	}
	return state, pid
}

func findLastSentFrameEvent(path string, readFile func(string) ([]byte, error)) logEvent {
	return findLastMatchingEvent(path, readFile, func(line string) bool {
		return strings.Contains(line, "sent frame ->")
	})
}

func findLastOutErrorEvent(path string, readFile func(string) ([]byte, error)) logEvent {
	return findLastMatchingEvent(path, readFile, func(line string) bool {
		return strings.Contains(line, "cycle error:")
	})
}

func findLastNonEmptyEvent(path string, readFile func(string) ([]byte, error)) logEvent {
	return findLastMatchingEvent(path, readFile, func(line string) bool {
		return strings.TrimSpace(line) != ""
	})
}

func findLastMatchingEvent(path string, readFile func(string) ([]byte, error), predicate func(string) bool) logEvent {
	if readFile == nil || predicate == nil {
		return logEvent{}
	}
	data, err := readFile(path)
	if err != nil {
		return logEvent{}
	}

	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if !predicate(line) {
			continue
		}
		return logEvent{
			Line:      line,
			Timestamp: parseLogTimestamp(line),
		}
	}
	return logEvent{}
}

func latestEvent(a, b logEvent) logEvent {
	if strings.TrimSpace(a.Line) == "" {
		return b
	}
	if strings.TrimSpace(b.Line) == "" {
		return a
	}
	if !a.Timestamp.IsZero() && !b.Timestamp.IsZero() {
		if b.Timestamp.After(a.Timestamp) {
			return b
		}
		return a
	}
	if !b.Timestamp.IsZero() {
		return b
	}
	return a
}

func parseLogTimestamp(line string) time.Time {
	fields := strings.Fields(strings.TrimSpace(line))
	if len(fields) == 0 {
		return time.Time{}
	}
	first := fields[0]
	if ts, err := time.Parse(time.RFC3339Nano, first); err == nil {
		return ts
	}
	if ts, err := time.Parse(time.RFC3339, first); err == nil {
		return ts
	}
	return time.Time{}
}

func extractSentFramePort(line string) string {
	idx := strings.Index(line, "sent frame ->")
	if idx == -1 {
		return ""
	}
	rest := strings.TrimSpace(line[idx+len("sent frame ->"):])
	if rest == "" {
		return ""
	}
	fields := strings.Fields(rest)
	if len(fields) == 0 {
		return ""
	}
	port := strings.TrimSpace(fields[0])
	if strings.Contains(port, "provider=") {
		return ""
	}
	return port
}

func formatTimestamp(ts time.Time) string {
	if ts.IsZero() {
		return "unknown-time"
	}
	return ts.UTC().Format(time.RFC3339)
}
