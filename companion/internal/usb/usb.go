package usb

import (
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	serial "go.bug.st/serial"
)

var serialOpen = serial.Open
var defaultDiscoverer PortDiscoverer = systemDiscoverer{}
var defaultSender = NewSender()

const (
	serialBaudRate       = 115200
	closeTimeout         = 200 * time.Millisecond
	resetPulseDuration   = 120 * time.Millisecond
	reopenSettleDuration = 1200 * time.Millisecond
	writeTimeout         = 2 * time.Second
	helloReadWindow      = 300 * time.Millisecond
	helloReadStepTimeout = 80 * time.Millisecond
	helloReadBufferBytes = 1024
)

type PortDiscoverer interface {
	Discover() ([]string, error)
}

type SerialPort interface {
	Read([]byte) (int, error)
	Write([]byte) (int, error)
	Close() error
	SetReadTimeout(time.Duration) error
	ResetInputBuffer() error
	SetDTR(bool) error
	SetRTS(bool) error
}

type PortOpener interface {
	Open(path string, mode *serial.Mode) (SerialPort, error)
}

type LineSender interface {
	Send(path string, line []byte) error
}

type HelloReader interface {
	ReadHello(path string) (protocol.DeviceHello, error)
}

type CapabilitiesReader interface {
	ReadCapabilities(path string) (protocol.DeviceCapabilities, error)
}

func SendLine(port string, line []byte) error {
	if len(line) == 0 || line[len(line)-1] != '\n' {
		line = append(line, '\n')
	}

	return defaultSender.Send(port, line)
}

func ReadDeviceHello(port string) (protocol.DeviceHello, error) {
	return defaultSender.ReadHello(port)
}

func GetDeviceCapabilities(port string) (protocol.DeviceCapabilities, error) {
	return defaultSender.ReadCapabilities(port)
}

func CloseDefaultSender() {
	defaultSender.Close()
}
