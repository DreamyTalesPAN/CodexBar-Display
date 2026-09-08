// mock-codexbar implements only the CLI/dashboard contract used by the simulation.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const usage = `[{"provider":"codex","source":"oauth","usage":{"secondary":{"usedPercent":42,"windowMinutes":10080}}}]`

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		os.Exit(2)
	}
	switch args[0] {
	case "serve":
		port := ""
		for i := 1; i+1 < len(args); i++ {
			if args[i] == "--port" {
				port = args[i+1]
			}
		}
		if port == "" {
			os.Exit(2)
		}
		mux := http.NewServeMux()
		mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{}`) })
		mux.HandleFunc("/usage", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, usage) })
		mux.HandleFunc("/dashboard/v1/snapshot", func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+os.Getenv("CODEXBAR_DASHBOARD_TOKEN") {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			now := time.Now().UTC()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"schemaVersion": 1, "generatedAt": now.Format(time.RFC3339), "staleAfterSeconds": 180,
				"providers": []any{map[string]any{
					"id": "codex", "name": "Codex", "error": nil, "updatedAt": now.Format(time.RFC3339),
					"windows": []any{map[string]any{"kind": "weekly", "label": "Weekly", "usedPercent": 42,
						"resetAt": now.Add(72 * time.Hour).Format(time.RFC3339)}},
				}},
			})
		})
		// A parent-owned lease closes even when Windows kills the daemon without
		// delivering a signal. This prevents orphan dashboard children on failure.
		lease := os.Getenv("VIBETV_SIMULATION_LEASE")
		if lease == "" {
			os.Exit(2)
		}
		go func() {
			for {
				if _, err := os.Stat(lease); err != nil {
					os.Exit(0)
				}
				time.Sleep(100 * time.Millisecond)
			}
		}()
		if err := http.ListenAndServe("127.0.0.1:"+port, mux); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "usage":
		fmt.Println(usage)
	case "config":
		if len(args) < 2 {
			os.Exit(2)
		}
		switch args[1] {
		case "dump":
			fmt.Println(`{"version":1,"providers":[{"id":"codex","enabled":true}]}`)
		case "providers":
			fmt.Println(`[{"provider":"codex","enabled":true}]`)
		case "validate":
			fmt.Println(`{}`)
		case "enable":
			fmt.Println(`{"enabled":true}`)
		default:
			os.Exit(2)
		}
	case "--version", "version":
		fmt.Println("codexbar-stub 0.46.0")
	default:
		fmt.Fprintln(os.Stderr, "unsupported fixture command:", strings.Join(args, " "))
		os.Exit(2)
	}
}
