package transport

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSerializedDeviceHTTPClientsShareOneRequestPerHost(t *testing.T) {
	var active int32
	var maximum int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		current := atomic.AddInt32(&active, 1)
		defer atomic.AddInt32(&active, -1)
		for {
			observed := atomic.LoadInt32(&maximum)
			if current <= observed || atomic.CompareAndSwapInt32(&maximum, observed, current) {
				break
			}
		}
		time.Sleep(40 * time.Millisecond)
		_, _ = io.WriteString(w, "ok")
	}))
	defer server.Close()

	clients := []*http.Client{
		SerializeDeviceHTTPClient(server.Client()),
		SerializeDeviceHTTPClient(server.Client()),
	}
	var wait sync.WaitGroup
	for _, client := range clients {
		wait.Add(1)
		go func(client *http.Client) {
			defer wait.Done()
			response, err := client.Get(server.URL + "/health")
			if err != nil {
				t.Errorf("request failed: %v", err)
				return
			}
			_, _ = io.Copy(io.Discard, response.Body)
			_ = response.Body.Close()
		}(client)
	}
	wait.Wait()

	if got := atomic.LoadInt32(&maximum); got != 1 {
		t.Fatalf("maximum concurrent requests = %d, want 1", got)
	}
}
