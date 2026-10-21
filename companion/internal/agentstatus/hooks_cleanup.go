package agentstatus

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"unicode/utf16"
)

// The engine installs Claude Code hooks that call the observer inside the app
// bundle. Uninstalling VibeTV, or replacing it with a build that has no
// agent-engine, leaves those hooks pointing at nothing (#851). These helpers
// remove only such VibeTV entries; every other hook and setting stays as is.

const observerSuffix = "/agent-engine/src/vibetv-observe.cjs"

var (
	encodedCommand = regexp.MustCompile(`(?i)(?:^|\s)-(?:EncodedCommand|enc|e)\s+([A-Za-z0-9+/=]+)`)
	// Single-quoted words in POSIX ('\'' escapes a quote) and PowerShell ('').
	quotedWord = regexp.MustCompile(`'((?:[^']|''|'\\'')*)'`)
)

// ClaudeSettingsPath is where Claude Code and the engine keep hooks.
func ClaudeSettingsPath(home string) string {
	if dir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); dir != "" {
		return filepath.Join(dir, "settings.json")
	}
	return filepath.Join(home, ".claude", "settings.json")
}

// BundleMissing reports whether this build cannot run the observer, so the
// engine will never start and never clean up its hooks itself.
func BundleMissing(directory string) bool {
	binary := "node"
	if runtime.GOOS == "windows" {
		binary = "node.exe"
	}
	for _, file := range []string{filepath.Join(directory, binary), filepath.Join(directory, "src", "vibetv-observe.cjs")} {
		if _, err := os.Stat(file); errors.Is(err, fs.ErrNotExist) {
			return true
		}
	}
	return false
}

// observerPath returns the observer a VibeTV hook command runs, or "" for any
// other command.
func observerPath(command string) string {
	texts := []string{command}
	if match := encodedCommand.FindStringSubmatch(command); match != nil {
		if decoded, ok := decodeUTF16LE(match[1]); ok {
			texts = append(texts, decoded)
		}
	}
	for _, text := range texts {
		for _, match := range quotedWord.FindAllStringSubmatch(text, -1) {
			word := strings.ReplaceAll(strings.ReplaceAll(match[1], `'\''`, "'"), "''", "'")
			if strings.HasSuffix(strings.ReplaceAll(word, "\\", "/"), observerSuffix) {
				return word
			}
		}
	}
	return ""
}

func decodeUTF16LE(value string) (string, bool) {
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(data)%2 != 0 {
		return "", false
	}
	units := make([]uint16, len(data)/2)
	for i := range units {
		units[i] = binary.LittleEndian.Uint16(data[2*i:])
	}
	return string(utf16.Decode(units)), true
}

func samePath(a, b string) bool {
	clean := func(value string) string { return filepath.Clean(strings.ReplaceAll(value, "\\", "/")) }
	if runtime.GOOS == "windows" {
		return strings.EqualFold(clean(a), clean(b))
	}
	return clean(a) == clean(b)
}

// obsolete reports whether command is a VibeTV hook whose observer is gone or
// belongs to the installation in removedDirectory.
func obsolete(command, removedDirectory string) bool {
	observer := observerPath(command)
	if observer == "" {
		return false
	}
	if removedDirectory != "" && samePath(observer, filepath.Join(removedDirectory, "src", "vibetv-observe.cjs")) {
		return true
	}
	_, err := os.Stat(observer)
	return errors.Is(err, fs.ErrNotExist)
}

// RemoveObsoleteHooks deletes VibeTV hooks from a Claude Code settings file
// when their observer no longer exists or lives in removedDirectory (the
// installation being removed). Hooks of a VibeTV copy that is still installed
// elsewhere, and all other hooks, are kept. It reports whether it wrote.
func RemoveObsoleteHooks(settingsPath, removedDirectory string) (bool, error) {
	file, err := filepath.EvalSymlinks(settingsPath)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	info, err := os.Stat(file)
	if err != nil {
		return false, err
	}
	if info.Size() > 1<<20 {
		return false, errors.New("agent-settings-too-large")
	}
	original, err := os.ReadFile(file)
	if err != nil {
		return false, err
	}
	updated, changed, err := withoutObsoleteHooks(original, removedDirectory)
	if err != nil || !changed {
		return false, err
	}
	// Claude Code may have edited the file meanwhile; never overwrite that.
	if current, err := os.ReadFile(file); err != nil || !bytes.Equal(current, original) {
		return false, errors.New("agent-settings-changed")
	}
	// Same one-time backup the engine keeps before its first edit.
	backup, err := os.OpenFile(file+".vibetv-backup", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err == nil {
		_, err = backup.Write(original)
		if closeErr := backup.Close(); err == nil {
			err = closeErr
		}
	} else if errors.Is(err, fs.ErrExist) {
		err = nil
	}
	if err != nil {
		return false, err
	}
	temp, err := os.CreateTemp(filepath.Dir(file), "."+filepath.Base(file)+".*.tmp")
	if err != nil {
		return false, err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(updated); err != nil {
		temp.Close()
		return false, err
	}
	if err := temp.Close(); err != nil {
		return false, err
	}
	if err := os.Chmod(temp.Name(), 0o600); err != nil {
		return false, err
	}
	if err := os.Rename(temp.Name(), file); err != nil {
		return false, err
	}
	return true, nil
}

// withoutObsoleteHooks mirrors the engine's own removal: drop matching hook
// commands, then entries and events that become empty. Key order and all
// other values are preserved.
func withoutObsoleteHooks(data []byte, removedDirectory string) ([]byte, bool, error) {
	settings, err := decodeObject(data)
	if err != nil {
		return nil, false, fmt.Errorf("invalid-agent-settings: %w", err)
	}
	hooksRaw, ok := settings.get("hooks")
	if !ok || !isKind(hooksRaw, '{') {
		return nil, false, nil
	}
	hooks, err := decodeObject(hooksRaw)
	if err != nil {
		return nil, false, err
	}
	keepEmpty := len(hooks) == 0
	changed := false
	for i := 0; i < len(hooks); i++ {
		if !isKind(hooks[i].value, '[') {
			continue
		}
		entries, entriesChanged, err := cleanEntries(hooks[i].value, removedDirectory)
		if err != nil {
			return nil, false, err
		}
		if !entriesChanged {
			continue
		}
		changed = true
		if len(entries) == 0 {
			hooks = append(hooks[:i], hooks[i+1:]...)
			i--
			continue
		}
		hooks[i].value = encodeArray(entries)
	}
	if !changed {
		return nil, false, nil
	}
	if len(hooks) == 0 && !keepEmpty {
		settings.remove("hooks")
	} else {
		settings.set("hooks", hooks.encode())
	}
	var out bytes.Buffer
	if err := json.Indent(&out, settings.encode(), "", "  "); err != nil {
		return nil, false, err
	}
	if bytes.HasSuffix(bytes.TrimRight(data, " \t\r"), []byte("\n")) {
		out.WriteByte('\n')
	}
	return out.Bytes(), true, nil
}

func cleanEntries(raw json.RawMessage, removedDirectory string) ([]json.RawMessage, bool, error) {
	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, false, err
	}
	changed := false
	kept := []json.RawMessage{}
	for _, entryRaw := range entries {
		if !isKind(entryRaw, '{') {
			kept = append(kept, entryRaw)
			continue
		}
		entry, err := decodeObject(entryRaw)
		if err != nil {
			return nil, false, err
		}
		command, hasCommand := stringValue(entry, "command")
		if hasCommand && obsolete(command, removedDirectory) {
			changed = true
			continue
		}
		hooksRaw, ok := entry.get("hooks")
		if !ok || !isKind(hooksRaw, '[') {
			kept = append(kept, entryRaw)
			continue
		}
		var hooks []json.RawMessage
		if err := json.Unmarshal(hooksRaw, &hooks); err != nil {
			return nil, false, err
		}
		remaining := []json.RawMessage{}
		for _, hookRaw := range hooks {
			var hook struct {
				Command any `json:"command"`
			}
			if isKind(hookRaw, '{') && json.Unmarshal(hookRaw, &hook) == nil {
				if command, ok := hook.Command.(string); ok && obsolete(command, removedDirectory) {
					continue
				}
			}
			remaining = append(remaining, hookRaw)
		}
		if len(remaining) == len(hooks) {
			kept = append(kept, entryRaw)
			continue
		}
		changed = true
		if len(remaining) == 0 && !hasCommand {
			continue
		}
		entry.set("hooks", encodeArray(remaining))
		kept = append(kept, entry.encode())
	}
	return kept, changed, nil
}

type member struct {
	key   string
	value json.RawMessage
}

// object keeps JSON object members in their original order.
type object []member

func decodeObject(data []byte) (object, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return nil, errors.New("expected object")
	}
	result := object{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		key, ok := token.(string)
		if !ok {
			return nil, errors.New("expected key")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		result = append(result, member{key, value})
	}
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); err == nil {
		return nil, errors.New("trailing data")
	}
	return result, nil
}

func (o object) get(key string) (json.RawMessage, bool) {
	for _, m := range o {
		if m.key == key {
			return m.value, true
		}
	}
	return nil, false
}

func (o *object) set(key string, value json.RawMessage) {
	for i := range *o {
		if (*o)[i].key == key {
			(*o)[i].value = value
			return
		}
	}
	*o = append(*o, member{key, value})
}

func (o *object) remove(key string) {
	kept := object{}
	for _, m := range *o {
		if m.key != key {
			kept = append(kept, m)
		}
	}
	*o = kept
}

// encode writes compact JSON without escaping <, > and & in keys or values.
func (o object) encode() json.RawMessage {
	var out bytes.Buffer
	out.WriteByte('{')
	for i, m := range o {
		if i > 0 {
			out.WriteByte(',')
		}
		encoder := json.NewEncoder(&out)
		encoder.SetEscapeHTML(false)
		_ = encoder.Encode(m.key)
		out.Truncate(out.Len() - 1) // Encode appends a newline.
		out.WriteByte(':')
		_ = json.Compact(&out, m.value)
	}
	out.WriteByte('}')
	return out.Bytes()
}

func encodeArray(values []json.RawMessage) json.RawMessage {
	var out bytes.Buffer
	out.WriteByte('[')
	for i, value := range values {
		if i > 0 {
			out.WriteByte(',')
		}
		_ = json.Compact(&out, value)
	}
	out.WriteByte(']')
	return out.Bytes()
}

func stringValue(o object, key string) (string, bool) {
	raw, ok := o.get(key)
	if !ok {
		return "", false
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return "", false
	}
	return value, true
}

func isKind(raw json.RawMessage, kind byte) bool {
	trimmed := bytes.TrimLeft(raw, " \t\r\n")
	return len(trimmed) > 0 && trimmed[0] == kind
}
