package usb

import (
	"errors"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	serial "go.bug.st/serial"
)

type serialOpener struct {
	openFn func(string, *serial.Mode) (serial.Port, error)
}

func (o serialOpener) Open(path string, mode *serial.Mode) (SerialPort, error) {
	if o.openFn == nil {
		return nil, errors.New("serial opener is not configured")
	}
	return o.openFn(path, mode)
}

func ProbePort(path string) error {
	opener := serialOpener{openFn: serialOpen}
	port, err := opener.Open(path, openMode())
	if err != nil {
		return wrapTransportError(
			errcode.TransportSerialProbe,
			"probe-open",
			path,
			"Release the serial port (`lsof <port>`), reconnect device, and retry setup.",
			err,
		)
	}
	setControlLinesLow(port)
	if err := closePortBestEffort(port, path, closeTimeout); err != nil {
		return err
	}
	return nil
}

func writeWithTimeout(port SerialPort, payload []byte, timeout time.Duration) error {
	if port == nil {
		return errors.New("serial port is nil")
	}
	if timeout <= 0 {
		_, err := port.Write(payload)
		return err
	}

	done := make(chan error, 1)
	go func() {
		_, err := port.Write(payload)
		done <- err
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case err := <-done:
		return err
	case <-timer.C:
		return errors.New("serial write timeout")
	}
}

func openMode() *serial.Mode {
	return &serial.Mode{
		BaudRate: serialBaudRate,
		InitialStatusBits: &serial.ModemOutputBits{
			RTS: false,
			DTR: false,
		},
	}
}

func setControlLinesLow(port SerialPort) {
	if port == nil {
		return
	}
	_ = port.SetDTR(false)
	_ = port.SetRTS(false)
}

func closePortBestEffort(port SerialPort, path string, timeout time.Duration) error {
	if port == nil {
		return nil
	}
	if timeout <= 0 {
		timeout = closeTimeout
	}

	done := make(chan error, 1)
	go func() {
		done <- port.Close()
	}()

	select {
	case err := <-done:
		if err == nil {
			return nil
		}
		return wrapTransportError(
			errcode.TransportSerialCloseTimeout,
			"close-port",
			path,
			"Retry; if close keeps failing restart the daemon to reset serial state.",
			err,
		)
	case <-time.After(timeout):
		return wrapTransportError(
			errcode.TransportSerialCloseTimeout,
			"close-port-timeout",
			path,
			"Retry; if close keeps timing out restart the daemon to reset serial state.",
			errors.New("serial close timeout"),
		)
	}
}
