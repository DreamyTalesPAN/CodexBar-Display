package themepack

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

var blockedRemotePrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("198.18.0.0/15"),
}

func secureRemoteClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, fmt.Errorf("parse remote address: %w", err)
			}
			addresses, err := resolvePublicAddresses(ctx, host)
			if err != nil {
				return nil, err
			}
			var lastErr error
			for _, address := range addresses {
				conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(address.String(), port))
				if dialErr == nil {
					return conn, nil
				}
				lastErr = dialErr
			}
			return nil, fmt.Errorf("connect to validated remote host: %w", lastErr)
		},
		TLSHandshakeTimeout: 10 * time.Second,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many remote redirects")
			}
			return validatePublicHTTPSURL(req.URL)
		},
	}
}

func validatePublicHTTPSReference(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("parse remote URL: %w", err)
	}
	return validatePublicHTTPSURL(parsed)
}

func validatePublicHTTPSURL(parsed *url.URL) error {
	if parsed == nil || !strings.EqualFold(parsed.Scheme, "https") {
		return errors.New("remote theme downloads require HTTPS")
	}
	if parsed.User != nil || strings.TrimSpace(parsed.Hostname()) == "" {
		return errors.New("remote theme URL must not contain credentials and must include a host")
	}
	if ip, err := netip.ParseAddr(parsed.Hostname()); err == nil && !isPublicRemoteAddress(ip) {
		return fmt.Errorf("remote theme URL resolves to blocked address %s", ip)
	}
	return nil
}

func resolvePublicAddresses(ctx context.Context, host string) ([]netip.Addr, error) {
	if ip, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		if !isPublicRemoteAddress(ip) {
			return nil, fmt.Errorf("remote theme URL resolves to blocked address %s", ip)
		}
		return []netip.Addr{ip}, nil
	}
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("resolve remote theme host: %w", err)
	}
	if len(addresses) == 0 {
		return nil, errors.New("remote theme host has no addresses")
	}
	public := make([]netip.Addr, 0, len(addresses))
	for _, address := range addresses {
		address = address.Unmap()
		if !isPublicRemoteAddress(address) {
			return nil, fmt.Errorf("remote theme host includes blocked address %s", address)
		}
		public = append(public, address)
	}
	return public, nil
}

func isPublicRemoteAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsValid() || !address.IsGlobalUnicast() || address.IsPrivate() ||
		address.IsLoopback() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() ||
		address.IsMulticast() || address.IsUnspecified() {
		return false
	}
	for _, prefix := range blockedRemotePrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}
