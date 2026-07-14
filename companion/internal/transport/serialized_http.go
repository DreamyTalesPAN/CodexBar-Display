package transport

import (
	"context"
	"io"
	"net/http"
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
	gateKey := strings.ToLower(req.URL.Scheme + "://" + req.URL.Host)
	gateValue, _ := deviceRequestGates.LoadOrStore(gateKey, newDeviceRequestGate())
	release, err := gateValue.(*deviceRequestGate).acquire(req.Context())
	if err != nil {
		return nil, err
	}

	response, err := t.base.RoundTrip(req)
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
