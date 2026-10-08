//go:build !windows

package main

func protectDaemonProcessTree() error { return nil }
