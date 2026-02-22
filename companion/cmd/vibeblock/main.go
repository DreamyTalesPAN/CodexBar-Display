package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(2)
	}

	var err error
	switch os.Args[1] {
	case "daemon":
		err = runDaemon(os.Args[2:])
	case "doctor":
		err = runDoctor()
	case "setup":
		err = runSetup()
	default:
		printUsage()
		os.Exit(2)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("vibeblock commands:")
	fmt.Println("  vibeblock daemon [--port /dev/cu.usbmodem101] [--interval 60s] [--once]")
	fmt.Println("  vibeblock doctor")
	fmt.Println("  vibeblock setup")
}

func runDaemon(args []string) error {
	fs := flag.NewFlagSet("daemon", flag.ContinueOnError)
	port := fs.String("port", "", "serial port (auto-detect when empty)")
	interval := fs.Duration("interval", 60*time.Second, "poll interval")
	once := fs.Bool("once", false, "run one cycle and exit")
	if err := fs.Parse(args); err != nil {
		return err
	}

	opts := daemon.Options{
		Port:     strings.TrimSpace(*port),
		Interval: *interval,
		Once:     *once,
	}
	return daemon.Run(context.Background(), opts)
}

func runDoctor() error {
	bin, err := codexbar.FindBinary()
	if err != nil {
		fmt.Printf("CodexBar CLI: not found (%v)\n", err)
	} else {
		fmt.Printf("CodexBar CLI: %s\n", bin)
	}

	ports, err := usb.ListPorts()
	if err != nil {
		return fmt.Errorf("list serial ports: %w", err)
	}

	fmt.Println("Serial ports:")
	if len(ports) == 0 {
		fmt.Println("  (none)")
	} else {
		for _, p := range ports {
			fmt.Printf("  %s\n", p)
		}
	}

	if bin == "" {
		return errors.New("CodexBar CLI not found")
	}

	checkCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	frame, fetchErr := codexbar.FetchFirstFrame(checkCtx)
	if fetchErr != nil {
		fmt.Printf("Provider preview: failed (%v)\n", fetchErr)
	} else {
		fmt.Printf("Provider preview: %s session=%d%% weekly=%d%% reset=%ds\n",
			frame.Label, frame.Session, frame.Weekly, frame.ResetSec)
	}

	return nil
}

func runSetup() error {
	fmt.Println("vibeblock setup")
	if err := runDoctor(); err != nil {
		return err
	}
	fmt.Println("\nNext:")
	fmt.Println("1) Flash firmware:  cd firmware && pio run -t upload --upload-port /dev/cu.usbmodem101")
	fmt.Println("2) Start daemon:    cd companion && go run ./cmd/vibeblock daemon --port /dev/cu.usbmodem101")
	fmt.Println("3) Install launchd: companion/install/com.vibeblock.daemon.plist")
	return nil
}
