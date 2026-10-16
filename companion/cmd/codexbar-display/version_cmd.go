package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/versioning"
)

func runVersion(args []string) error {
	fs := flag.NewFlagSet("version", flag.ContinueOnError)
	short := fs.Bool("short", false, "print version only")
	jsonOut := fs.Bool("json", false, "print detailed JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}

	version := buildinfo.NormalizedVersion()
	if *short {
		fmt.Println(version)
		return nil
	}

	if *jsonOut {
		payload := struct {
			Version       string                         `json:"version"`
			Commit        string                         `json:"commit"`
			Date          string                         `json:"date"`
			Compatibility []versioning.CompatibilityRule `json:"compatibility"`
		}{
			Version:       version,
			Commit:        strings.TrimSpace(buildinfo.Commit),
			Date:          strings.TrimSpace(buildinfo.Date),
			Compatibility: versioning.DefaultCompatibilityMatrix(),
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(payload)
	}

	fmt.Printf("codexbar-display companion %s\n", version)
	if strings.TrimSpace(buildinfo.Commit) != "" {
		fmt.Printf("commit: %s\n", strings.TrimSpace(buildinfo.Commit))
	}
	if strings.TrimSpace(buildinfo.Date) != "" {
		fmt.Printf("date: %s\n", strings.TrimSpace(buildinfo.Date))
	}
	fmt.Println("compatibility:")
	for _, rule := range versioning.DefaultCompatibilityMatrix() {
		fmt.Printf("  - %s: companion %s..%s firmware %s..%s protocol=%d\n",
			rule.Name,
			rule.CompanionMin,
			rule.CompanionMaxExclusive,
			rule.FirmwareMin,
			rule.FirmwareMaxExclusive,
			rule.ProtocolVersion,
		)
	}
	return nil
}
