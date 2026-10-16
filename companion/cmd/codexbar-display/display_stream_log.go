package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

var displayStreamSensitiveQueryPattern = regexp.MustCompile(`(?i)([?&](?:token|auth|key|secret)=)[^&\s"]+`)

var displayStreamSensitiveUserInfoPattern = regexp.MustCompile(`(?i)(https?://)[^/@\s]+@`)

type displayStreamLogWriter struct {
	mu               sync.Mutex
	path             string
	maxBytes         int64
	now              func() time.Time
	sessionMarker    []byte
	activeFileInfo   os.FileInfo
	lastObservedSize int64
	lastMarkerSize   int64
}

func newDisplayStreamFileLogger(home string) (*displayStreamLogWriter, string, error) {
	logPath := runtimepaths.DisplayStreamOutLog(home)
	if strings.TrimSpace(logPath) == "" {
		return nil, "", errors.New("resolve display stream log: home directory is empty")
	}
	logger := &displayStreamLogWriter{
		path:     logPath,
		maxBytes: runtimepaths.DisplayStreamLogMaxBytes,
		now:      time.Now,
	}
	if err := logger.ensureWritable(); err != nil {
		return nil, "", err
	}
	return logger, logPath, nil
}

func (l *displayStreamLogWriter) ensureWritable() error {
	file, err := l.openForAppend()
	if err != nil {
		return err
	}
	return file.Close()
}

func (l *displayStreamLogWriter) openForAppend() (*os.File, error) {
	if l == nil || strings.TrimSpace(l.path) == "" {
		return nil, errors.New("open display stream log: path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(l.path), 0o700); err != nil {
		return nil, fmt.Errorf("create display stream log directory: %w", err)
	}
	file, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open display stream log: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("protect display stream log: %w", err)
	}
	return file, nil
}

func (l *displayStreamLogWriter) startRuntimeSession(label string) error {
	if l == nil {
		return errors.New("start display stream runtime session: logger is nil")
	}
	label = strings.TrimSpace(label)
	if label == "" {
		return errors.New("start display stream runtime session: LaunchAgent label is empty")
	}
	now := l.now
	if now == nil {
		now = time.Now
	}
	marker := fmt.Sprintf(
		"%s runtime event=stream-start label=%q\n",
		now().UTC().Format(time.RFC3339Nano),
		label,
	)

	l.mu.Lock()
	defer l.mu.Unlock()
	l.sessionMarker = []byte(marker)
	l.activeFileInfo = nil
	l.lastObservedSize = 0
	l.lastMarkerSize = 0
	return l.append(nil)
}

func (l *displayStreamLogWriter) logf(format string, args ...any) {
	if l == nil || strings.TrimSpace(l.path) == "" {
		return
	}
	message := sanitizeDisplayStreamLogMessage(fmt.Sprintf(format, args...))
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}

	now := l.now
	if now == nil {
		now = time.Now
	}
	timestamp := now().UTC().Format(time.RFC3339Nano)
	var payload strings.Builder
	for _, rawLine := range strings.Split(message, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		_, _ = fmt.Fprintf(&payload, "%s %s\n", timestamp, line)
	}
	if payload.Len() == 0 {
		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	_ = l.append([]byte(payload.String()))
}

func (l *displayStreamLogWriter) append(payload []byte) error {
	maxBytes := l.maxBytes
	if maxBytes <= 0 {
		maxBytes = runtimepaths.DisplayStreamLogMaxBytes
	}
	maxRecordBytes := runtimepaths.DisplayStreamLogRecordMaxBytes
	if maxRecordBytes <= 0 || maxRecordBytes > maxBytes {
		maxRecordBytes = maxBytes
	}
	if markerBytes := int64(len(l.sessionMarker)); markerBytes > 0 && maxRecordBytes > maxBytes-markerBytes {
		maxRecordBytes = maxBytes - markerBytes
	}
	if maxRecordBytes < 0 {
		maxRecordBytes = 0
	}
	if int64(len(payload)) > maxRecordBytes {
		payload = payload[int64(len(payload))-maxRecordBytes:]
	}

	info, err := os.Stat(l.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat display stream log: %w", err)
	}
	markerNeeded := l.runtimeSessionMarkerNeeded(info, err)
	record := payload
	if markerNeeded {
		record = append(append([]byte(nil), l.sessionMarker...), payload...)
	}
	if err == nil && info.Size()+int64(len(record)) > maxBytes {
		if err := rotateDisplayStreamLog(l.path, maxBytes); err != nil {
			return err
		}
		if len(l.sessionMarker) > 0 && !markerNeeded {
			record = append(append([]byte(nil), l.sessionMarker...), payload...)
			markerNeeded = true
		}
	}
	file, err := l.openForAppend()
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Write(record); err != nil {
		return fmt.Errorf("append display stream log: %w", err)
	}
	updated, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat appended display stream log: %w", err)
	}
	l.activeFileInfo = updated
	l.lastObservedSize = updated.Size()
	if markerNeeded {
		l.lastMarkerSize = updated.Size()
	}
	return nil
}

func (l *displayStreamLogWriter) runtimeSessionMarkerNeeded(info os.FileInfo, statErr error) bool {
	if l == nil || len(l.sessionMarker) == 0 {
		return false
	}
	if errors.Is(statErr, os.ErrNotExist) || info == nil || l.activeFileInfo == nil {
		return true
	}
	if !os.SameFile(info, l.activeFileInfo) || info.Size() < l.lastObservedSize {
		return true
	}
	return info.Size()-l.lastMarkerSize >= runtimepaths.DisplayStreamMarkerRepeatBytes
}

func rotateDisplayStreamLog(logPath string, maxBytes int64) error {
	archivePath := runtimepaths.DisplayStreamOutLogArchive(logPath)
	if archivePath == "" {
		return errors.New("rotate display stream log: archive path is empty")
	}
	if err := os.Remove(archivePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove old display stream log archive: %w", err)
	}

	info, err := os.Stat(logPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("stat display stream log for rotation: %w", err)
	}
	if info.Size() <= maxBytes {
		if err := os.Rename(logPath, archivePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("rotate display stream log: %w", err)
		}
		return nil
	}

	tail, err := readFileTail(logPath, maxBytes)
	if err != nil {
		return fmt.Errorf("read oversized display stream log tail: %w", err)
	}
	if err := os.WriteFile(archivePath, tail, 0o600); err != nil {
		return fmt.Errorf("write bounded display stream log archive: %w", err)
	}
	if err := os.Remove(logPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("replace oversized display stream log: %w", err)
	}
	return nil
}

func readFileTail(path string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	start := info.Size() - maxBytes
	if start < 0 {
		start = 0
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	return io.ReadAll(io.LimitReader(file, maxBytes))
}

func sanitizeDisplayStreamLogMessage(message string) string {
	message = displayStreamSensitiveUserInfoPattern.ReplaceAllString(message, "${1}<redacted>@")
	return displayStreamSensitiveQueryPattern.ReplaceAllString(message, "${1}<redacted>")
}
