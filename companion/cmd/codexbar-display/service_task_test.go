package main

import (
	"testing"
	"time"
)

func TestTaskDaemonLastGoodMaxAgeArgument(t *testing.T) {
	opts, err := parseDaemonCommandOptions([]string{"--transport", "usb", "--last-good-max-age", "168h"})
	if err != nil || opts.LastGoodMaxAge != 168*time.Hour || opts.Daemon.Transport != "usb" {
		t.Fatalf("opts=%+v err=%v", opts, err)
	}
	if _, err := parseDaemonCommandOptions([]string{"--last-good-max-age", "-1h"}); err == nil {
		t.Fatal("negative max age accepted")
	}
}

func TestDoctorTaskRuntimeConfigReadsUSBArguments(t *testing.T) {
	config, err := doctorTaskRuntimeConfig(t.TempDir(), "test-only", []string{"daemon", "--transport", "usb", "--port", "COM12"})
	if err != nil || !config.configured || config.transport != "usb" || config.port != "COM12" {
		t.Fatalf("config=%+v err=%v", config, err)
	}
}
