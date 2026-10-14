package main

import "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"

// Short forms of production functions that only the tests call.

func parseDaemonOptions(args []string) (daemon.Options, error) {
	opts, err := parseDaemonCommandOptions(args)
	return opts.Daemon, err
}
