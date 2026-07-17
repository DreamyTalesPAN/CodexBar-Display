//go:build !darwin

package main

import (
	"context"
	"net"
	"time"
)

func dialFirmwareRawConnection(ctx context.Context, network, address string) (net.Conn, error) {
	return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, address)
}

func waitForFirmwareRawAck(_ context.Context, _ net.Conn, _ time.Duration) error {
	return nil
}
