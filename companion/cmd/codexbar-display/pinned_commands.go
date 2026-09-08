package main

import (
	"context"
	"flag"
	"fmt"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

func runPinnedCodexBar(args []string, validate bool) error {
	flags := flag.NewFlagSet("pinned-codexbar", flag.ContinueOnError)
	archive := flags.String("archive", "", "bundled CodexBar archive")
	app := flags.String("app", "", "CodexBar app to validate")
	running := flags.Bool("reuse-running", false, "exact private target is already running")
	if err := flags.Parse(args); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var bin string
	var err error
	if validate {
		bin, err = codexbar.ValidatePinnedCLI(ctx, *app)
	} else {
		bin, err = codexbar.PreparePinnedCLI(ctx, *archive, *running)
	}
	if err != nil {
		return err
	}
	fmt.Println(bin)
	return nil
}
