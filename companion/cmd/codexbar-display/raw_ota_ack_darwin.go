//go:build darwin

package main

import (
	"context"
	"fmt"
	"net"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

func dialFirmwareRawConnection(ctx context.Context, network, address string) (net.Conn, error) {
	dialer := net.Dialer{
		Timeout: 10 * time.Second,
		Control: func(_, _ string, rawConn syscall.RawConn) error {
			var socketErr error
			if err := rawConn.Control(func(fd uintptr) {
				if err := unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_SNDBUF, otaRawWriteBufferBytes); err != nil {
					socketErr = err
					return
				}
				socketErr = unix.SetsockoptInt(int(fd), unix.IPPROTO_TCP, unix.TCP_NODELAY, 1)
			}); err != nil {
				return err
			}
			return socketErr
		},
	}
	return dialer.DialContext(ctx, network, address)
}

func waitForFirmwareRawAck(ctx context.Context, conn net.Conn, timeout time.Duration) error {
	tcpConn, ok := conn.(*net.TCPConn)
	if !ok {
		return nil
	}
	rawConn, err := tcpConn.SyscallConn()
	if err != nil {
		return err
	}
	deadline := time.Now().Add(timeout)
	for {
		var pending uint32
		var socketErr error
		if err := rawConn.Control(func(fd uintptr) {
			info, err := unix.GetsockoptTCPConnectionInfo(int(fd), unix.IPPROTO_TCP, unix.TCP_CONNECTION_INFO)
			if err != nil {
				socketErr = err
				return
			}
			pending = info.Snd_sbbytes
		}); err != nil {
			return err
		}
		if socketErr != nil {
			return socketErr
		}
		if pending == 0 {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for VibeTV to acknowledge firmware data (%d bytes pending)", pending)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Millisecond):
		}
	}
}
