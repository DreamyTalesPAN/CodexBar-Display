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
	reopenSettleDuration = 50 * time.Millisecond
	writeTimeout         = 2 * time.Second
	// Opening the supplier CH340 can restart the ESP8266. Behind the D6000 dock
	// the first full 1161-byte hello then arrived after 1103 ms, while later
	// requests took 111-162 ms. Identity resolution is a one-shot operation, so
	// keep enough bounded room for that real first response.
	helloReadWindow      = 2 * time.Second
	helloReadStepTimeout = 80 * time.Millisecond
	helloReadBufferBytes = 2048
)

var helloRequestLine = []byte("{\"kind\":\"request\",\"op\":\"hello\"}\n")

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
