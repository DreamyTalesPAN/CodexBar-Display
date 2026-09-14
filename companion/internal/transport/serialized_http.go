package transport

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

var deviceRequestGates sync.Map

type deviceRequestGate struct {
	token chan struct{}
}

func newDeviceRequestGate() *deviceRequestGate {
	return &deviceRequestGate{token: make(chan struct{}, 1)}
}

func (g *deviceRequestGate) acquire(ctx context.Context) (func(), error) {
	select {
	case g.token <- struct{}{}:
		return func() { <-g.token }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type serializedDeviceRoundTripper struct {
	base http.RoundTripper
}

func (t *serializedDeviceRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	release, err := AcquireDeviceHTTPGate(req.Context(), req.URL)
	if err != nil {
		return nil, err
	}

	freshRequest := req.Clone(req.Context())
	freshRequest.Close = true
	response, err := t.base.RoundTrip(freshRequest)
	if err != nil {
		release()
		return nil, err
	}
	if response.Body == nil || response.Body == http.NoBody {
		release()
		return response, nil
	}
	response.Body = &serializedDeviceResponseBody{
		ReadCloser: response.Body,
		release:    release,
	}
	return response, nil
}

// AcquireDeviceHTTPGate drains the current request and excludes local HTTP
// traffic until release. A parent may hold it while a separate OTA process
// owns the device; do not issue serialized HTTP requests while holding it.
func AcquireDeviceHTTPGate(ctx context.Context, target *url.URL) (func(), error) {
	gateKey := strings.ToLower(target.Scheme + "://" + target.Host)
	gateValue, _ := deviceRequestGates.LoadOrStore(gateKey, newDeviceRequestGate())
	return gateValue.(*deviceRequestGate).acquire(ctx)
}

// CloseIdleConnections delegates to the wrapped transport so
// http.Client.CloseIdleConnections keeps working through the serializer.
// Without this, idle keep-alive sockets to the device survive an OTA start.
func (t *serializedDeviceRoundTripper) CloseIdleConnections() {
	if closer, ok := t.base.(interface{ CloseIdleConnections() }); ok {
		closer.CloseIdleConnections()
	}
}

type serializedDeviceResponseBody struct {
	io.ReadCloser
	once    sync.Once
	release func()
}

func (b *serializedDeviceResponseBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(b.release)
	return err
}

// SerializeDeviceHTTPClient returns a copy of client whose requests are
// serialized per VibeTV host. ESP8266 devices serve one HTTP request at a time;
// this prevents display streaming, repair, and theme installation from racing.
func SerializeDeviceHTTPClient(client *http.Client) *http.Client {
	if client == nil {
		client = &http.Client{}
	}
	clone := *client
	base := clone.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	if _, alreadySerialized := base.(*serializedDeviceRoundTripper); !alreadySerialized {
		clone.Transport = &serializedDeviceRoundTripper{base: base}
	}
	return &clone
}
