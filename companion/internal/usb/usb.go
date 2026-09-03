package usb

import (
	"context"
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
	wifiScanReadWindow   = 12 * time.Second
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

// CurrentDeviceHello returns the identity already collected by the running
// Cable worker. It never opens or writes to the serial port.
func CurrentDeviceHello() (protocol.DeviceHello, bool) {
	return defaultSender.CurrentHello()
}

func SetConnectionMode(port, deviceID, mode string) error {
	return defaultSender.SetConnectionMode(port, deviceID, mode)
}

func ConfirmConnectionMode(port, deviceID string) error {
	return defaultSender.ConfirmConnectionMode(port, deviceID)
}

func PairDevice(port, deviceID string) (string, error) {
	return defaultSender.PairDevice(port, deviceID)
}

func ReadSettings(port, deviceID string) (protocol.DeviceSettings, error) {
	return defaultSender.ReadSettings(port, deviceID)
}

func ReadHealth(port, deviceID string) ([]byte, error) {
	return defaultSender.ReadHealth(port, deviceID)
}

func WriteSettings(port, deviceID string, patch protocol.DeviceSettingsPatch) (protocol.DeviceSettings, error) {
	return defaultSender.WriteSettings(port, deviceID, patch)
}

func ConfigureWiFi(port, deviceID, ssid, password string) error {
	return defaultSender.ConfigureWiFi(port, deviceID, ssid, password)
}

func ScanWiFi(port, deviceID string) ([]protocol.WiFiNetwork, error) {
	return defaultSender.ScanWiFi(port, deviceID)
}

func TransferAsset(ctx context.Context, port, deviceID, token, destination, activation string, payload []byte) error {
	return defaultSender.Transfer(ctx, port, deviceID, token, TransferSinkAsset, destination, activation, payload)
}

func TransferFirmware(ctx context.Context, port, deviceID, token string, payload []byte) error {
	return defaultSender.Transfer(ctx, port, deviceID, token, TransferSinkFirmware, "", "", payload)
}

func CloseDefaultSender() {
	defaultSender.Close()
}
