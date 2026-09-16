package companionapi

import (
	"context"
	"errors"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"sync"
	"time"
)

// The preview deliberately has no device/runtime/configuration dependencies.
type aiThemeServer struct{ aiTheme *aiThemeState }

func NewAIThemePreviewHandler() http.Handler {
	s := &aiThemeServer{aiTheme: newAIThemeState(nil, nil)}
	mux := http.NewServeMux()
	s.registerAIThemeRoutes(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}

var ErrSecretNotFound = errors.New("credential not configured")

type SecretStore interface {
	Get(string) (string, error)
	Set(string, string) error
	Delete(string) error
}
type memoryAIThemeSecrets struct {
	mu  sync.Mutex
	key string
}

func (s *memoryAIThemeSecrets) Get(provider string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if provider != "openai" || s.key == "" {
		return "", ErrSecretNotFound
	}
	return s.key, nil
}
func (s *memoryAIThemeSecrets) Set(provider, key string) error {
	if provider != "openai" {
		return ErrSecretNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.key = key
	return nil
}
func (s *memoryAIThemeSecrets) Delete(provider string) error {
	if provider != "openai" {
		return ErrSecretNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.key = ""
	return nil
}

type aiThemeTransport struct{ transport *http.Transport }

func (t aiThemeTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme != "https" || r.URL.Host != "api.openai.com" || r.URL.User != nil || r.URL.RawQuery != "" || r.URL.Fragment != "" {
		return nil, errors.New("provider destination rejected")
	}
	switch r.URL.Path {
	case "/v1/responses", "/v1/images/generations", "/v1/images/edits", "/v1/models/" + openAIImageModel:
	default:
		return nil, errors.New("provider path rejected")
	}
	return t.transport.RoundTrip(r)
}

func newAIThemeTransport() http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil // Never send credentials through an inherited proxy.
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil || host != "api.openai.com" || port != "443" {
			return nil, errors.New("provider destination rejected")
		}
		addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(addresses) == 0 {
			return nil, errors.New("provider resolution failed")
		}
		for _, ip := range addresses {
			if !aiThemePublicIP(ip) {
				return nil, errors.New("provider address rejected")
			}
		}
		dialer := net.Dialer{Timeout: 10 * time.Second}
		for _, ip := range addresses {
			conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if dialErr == nil {
				return conn, nil
			}
		}
		return nil, errors.New("provider connection failed")
	}
	return aiThemeTransport{transport}
}

func aiThemePublicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "64:ff9b::/96", "64:ff9b:1::/48"} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return true
}

func aiThemeJSONContentType(value string) bool {
	kind, _, err := mime.ParseMediaType(value)
	return err == nil && kind == "application/json"
}
