package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestDaemonJobHelper(t *testing.T) {
	switch os.Getenv("VIBETV_JOB_HELPER") {
	case "parent":
		if err := protectDaemonProcessTree(); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(os.Args[0], "-test.run=^TestDaemonJobHelper$")
		cmd.Env = append(os.Environ(), "VIBETV_JOB_HELPER=child")
		if err := cmd.Run(); err != nil {
			t.Fatal(err)
		}
	case "child":
		if err := os.WriteFile(os.Getenv("VIBETV_JOB_PID_FILE"), []byte(strconv.Itoa(os.Getpid())), 0600); err != nil {
			t.Fatal(err)
		}
		for {
			time.Sleep(time.Hour)
		}
	}
}

func TestDaemonJobKillsChildWhenParentIsTerminated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "child.pid")
	cmd := exec.Command(os.Args[0], "-test.run=^TestDaemonJobHelper$")
	cmd.Env = append(os.Environ(), "VIBETV_JOB_HELPER=parent", "VIBETV_JOB_PID_FILE="+path)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	var pid int
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil {
			pid, _ = strconv.Atoi(string(data))
			if pid > 0 {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	if pid == 0 {
		t.Fatal("child did not start")
	}
	child, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = windows.TerminateProcess(child, 1); _ = windows.CloseHandle(child) })
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	status, err := windows.WaitForSingleObject(child, 5000)
	if err != nil || status != windows.WAIT_OBJECT_0 {
		t.Fatalf("child survived parent termination: wait=%d err=%v", status, err)
	}
}
