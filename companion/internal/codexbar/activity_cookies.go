package codexbar

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func latestKimiCookieActivityAt(home string) (time.Time, bool) {
	return latestChromiumCookieActivityAt(home, chromiumCookieActivityQuerySpec{
		Domains:    []string{"kimi.com", "www.kimi.com"},
		ExactNames: []string{"kimi-auth"},
	})
}

func latestOllamaCookieActivityAt(home string) (time.Time, bool) {
	return latestChromiumCookieActivityAt(home, chromiumCookieActivityQuerySpec{
		Domains: []string{"ollama.com", "www.ollama.com"},
		ExactNames: []string{
			"session",
			"ollama_session",
			"__Host-ollama_session",
			"__Secure-next-auth.session-token",
			"next-auth.session-token",
		},
		PrefixNames: []string{
			"__Secure-next-auth.session-token.",
			"next-auth.session-token.",
		},
	})
}

type chromiumCookieActivityQuerySpec struct {
	Domains     []string
	ExactNames  []string
	PrefixNames []string
}

const chromeEpochMicros int64 = 11644473600000000

func latestChromiumCookieActivityAt(home string, spec chromiumCookieActivityQuerySpec) (time.Time, bool) {
	if len(spec.Domains) == 0 {
		return time.Time{}, false
	}
	if len(spec.ExactNames) == 0 && len(spec.PrefixNames) == 0 {
		return time.Time{}, false
	}

	sqliteBin, err := resolveSQLite3Binary()
	if err != nil {
		return time.Time{}, false
	}

	query := chromiumCookieActivityQuery(spec)

	var latest time.Time
	for _, dbPath := range chromiumCookieDBPaths(home) {
		t, ok := chromiumCookieDBActivityAt(dbPath, query, sqliteBin)
		if !ok {
			continue
		}
		latest = newerTime(latest, t)
	}
	return latest, !latest.IsZero()
}

func resolveSQLite3Binary() (string, error) {
	bin := envOrDefault("CODEXBAR_DISPLAY_SQLITE3_BIN", "sqlite3")
	return exec.LookPath(bin)
}

func chromiumCookieDBPaths(home string) []string {
	if raw := strings.TrimSpace(os.Getenv("CODEXBAR_DISPLAY_CHROMIUM_COOKIE_DB_PATHS")); raw != "" {
		return splitAndResolvePaths(home, raw)
	}

	patterns := []string{
		"~/Library/Application Support/Google/Chrome/*/Cookies",
		"~/Library/Application Support/Google/Chrome/*/Network/Cookies",
		"~/Library/Application Support/Google/Chrome Beta/*/Cookies",
		"~/Library/Application Support/Google/Chrome Beta/*/Network/Cookies",
		"~/Library/Application Support/Google/Chrome Canary/*/Cookies",
		"~/Library/Application Support/Google/Chrome Canary/*/Network/Cookies",
		"~/Library/Application Support/Chromium/*/Cookies",
		"~/Library/Application Support/Chromium/*/Network/Cookies",
		"~/Library/Application Support/BraveSoftware/Brave-Browser/*/Cookies",
		"~/Library/Application Support/BraveSoftware/Brave-Browser/*/Network/Cookies",
		"~/Library/Application Support/Microsoft Edge/*/Cookies",
		"~/Library/Application Support/Microsoft Edge/*/Network/Cookies",
		"~/Library/Application Support/Arc/*/*/Cookies",
		"~/Library/Application Support/Arc/*/*/Network/Cookies",
		"~/.config/google-chrome/*/Cookies",
		"~/.config/google-chrome/*/Network/Cookies",
		"~/.config/chromium/*/Cookies",
		"~/.config/chromium/*/Network/Cookies",
		"~/.config/BraveSoftware/Brave-Browser/*/Cookies",
		"~/.config/BraveSoftware/Brave-Browser/*/Network/Cookies",
		"~/.config/microsoft-edge/*/Cookies",
		"~/.config/microsoft-edge/*/Network/Cookies",
	}

	var paths []string
	for _, pattern := range patterns {
		matches, err := filepath.Glob(withHome(home, pattern))
		if err != nil || len(matches) == 0 {
			continue
		}
		paths = append(paths, matches...)
	}
	return dedupeStrings(paths)
}

func chromiumCookieActivityQuery(spec chromiumCookieActivityQuerySpec) string {
	domainClauses := make([]string, 0, len(spec.Domains))
	for _, domain := range spec.Domains {
		domain = strings.TrimSpace(domain)
		if domain == "" {
			continue
		}
		domainClauses = append(domainClauses, fmt.Sprintf("host_key LIKE '%%%s%%'", escapeSQLiteString(domain)))
	}

	nameClauses := make([]string, 0, len(spec.ExactNames)+len(spec.PrefixNames))
	for _, name := range spec.ExactNames {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		nameClauses = append(nameClauses, fmt.Sprintf("name = '%s'", escapeSQLiteString(name)))
	}
	for _, prefix := range spec.PrefixNames {
		prefix = strings.TrimSpace(prefix)
		if prefix == "" {
			continue
		}
		nameClauses = append(nameClauses, fmt.Sprintf("name LIKE '%s%%'", escapeSQLiteString(prefix)))
	}

	domainExpr := strings.Join(domainClauses, " OR ")
	nameExpr := strings.Join(nameClauses, " OR ")
	return fmt.Sprintf(
		"SELECT MAX(CASE WHEN COALESCE(last_access_utc,0) > COALESCE(creation_utc,0) THEN COALESCE(last_access_utc,0) ELSE COALESCE(creation_utc,0) END) FROM cookies WHERE (%s) AND (%s)",
		domainExpr,
		nameExpr,
	)
}

func chromiumCookieDBActivityAt(path, query, sqliteBin string) (time.Time, bool) {
	cmd := exec.Command(sqliteBin, "-readonly", path, query)
	out, err := cmd.Output()
	if err != nil {
		return time.Time{}, false
	}

	raw := strings.TrimSpace(string(out))
	if raw == "" || raw == "0" {
		return time.Time{}, false
	}

	micros, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || micros <= 0 {
		return time.Time{}, false
	}
	if micros > chromeEpochMicros {
		micros -= chromeEpochMicros
	}
	if micros <= 0 {
		return time.Time{}, false
	}
	return time.UnixMicro(micros), true
}

func escapeSQLiteString(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}
