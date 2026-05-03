package health

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

const (
	launchAgentLabel = "com.codexbar-display.daemon"
	defaultOutLog    = "/tmp/codexbar-display-daemon.out.log"
	defaultErrLog    = "/tmp/codexbar-display-daemon.err.log"
)

type deps struct {
	stdout      io.Writer
	uid         func() int
	homeDir     func() (string, error)
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
	if d.homeDir == nil {
		d.homeDir = os.UserHomeDir
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

type launchAgentConfig struct {
	Transport string
	Target    string
	Port      string
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

	config := readLaunchAgentConfig(d)
	lastSent := findLastSentFrameEvent(defaultOutLog, d.readFile)
	lastOutError := findLastOutErrorEvent(defaultOutLog, d.readFile)
	lastErrLogLine := findLastNonEmptyEvent(defaultErrLog, d.readFile)
	lastError := latestEvent(lastOutError, lastErrLogLine)
	errorRecovered := eventIsNotAfter(lastError, lastSent)
	if errorRecovered {
		lastError = logEvent{}
	}

	fmt.Fprintln(d.stdout, "codexbar-display health")
	fmt.Fprintf(d.stdout, "launchagent: %s", state)
	if pid != "" {
		fmt.Fprintf(d.stdout, " pid=%s", pid)
	}
	if launchctlErr != nil {
		fmt.Fprintf(d.stdout, " (launchctl error: %v)", launchctlErr)
	}
	fmt.Fprintln(d.stdout)

	if config.Transport == "wifi" {
		fmt.Fprintln(d.stdout, "transport: wifi")
		if config.Target == "" {
			fmt.Fprintln(d.stdout, "device target: unavailable (rerun setup)")
		} else {
			fmt.Fprintf(d.stdout, "device target: %s\n", config.Target)
		}
	} else {
		detectedPort, portErr := d.resolvePort("")
		fmt.Fprintln(d.stdout, "transport: usb")
		if portErr != nil {
			fmt.Fprintf(d.stdout, "detected port: unavailable (%v)\n", portErr)
		} else {
			fmt.Fprintf(d.stdout, "detected port: %s\n", detectedPort)
		}
	}

	if lastSent.Line == "" {
		fmt.Fprintf(d.stdout, "last sent frame: none (%s)\n", defaultOutLog)
	} else {
		when := formatTimestamp(lastSent.Timestamp)
		port := extractSentFramePort(lastSent.Line)
		if port == "" {
			fmt.Fprintf(d.stdout, "last sent frame: %s\n", when)
		} else if config.Transport == "wifi" {
			fmt.Fprintf(d.stdout, "last sent frame: %s target=%s\n", when, port)
		} else {
			fmt.Fprintf(d.stdout, "last sent frame: %s port=%s\n", when, port)
		}
	}

	if lastError.Line == "" {
		if errorRecovered {
			fmt.Fprintln(d.stdout, "last error: none since last sent frame")
		} else {
			fmt.Fprintln(d.stdout, "last error: none")
		}
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

func readLaunchAgentConfig(d deps) launchAgentConfig {
	if d.homeDir == nil || d.readFile == nil {
		return launchAgentConfig{}
	}
	home, err := d.homeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return launchAgentConfig{}
	}
	path := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	data, err := d.readFile(path)
	if err != nil {
		return launchAgentConfig{}
	}
	return parseLaunchAgentConfig(data)
}

func parseLaunchAgentConfig(data []byte) launchAgentConfig {
	args := plistStringValues(data)
	config := launchAgentConfig{}
	for i, arg := range args {
		switch strings.TrimSpace(arg) {
		case "--transport":
			if i+1 < len(args) {
				config.Transport = strings.ToLower(strings.TrimSpace(args[i+1]))
			}
		case "--target":
			if i+1 < len(args) {
				config.Target = strings.TrimSpace(args[i+1])
			}
		case "--port":
			if i+1 < len(args) {
				config.Port = strings.TrimSpace(args[i+1])
			}
		}
	}
	if config.Transport == "" {
		if config.Target != "" {
			config.Transport = "wifi"
		} else {
			config.Transport = "usb"
		}
	}
	return config
}

func plistStringValues(data []byte) []string {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	values := []string{}
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "string" {
			continue
		}
		var value string
		if err := decoder.DecodeElement(&value, &start); err != nil {
			break
		}
		values = append(values, value)
	}
	return values
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

func eventIsNotAfter(event, reference logEvent) bool {
	if strings.TrimSpace(event.Line) == "" || strings.TrimSpace(reference.Line) == "" {
		return false
	}
	if event.Timestamp.IsZero() || reference.Timestamp.IsZero() {
		return false
	}
	return !event.Timestamp.After(reference.Timestamp)
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
