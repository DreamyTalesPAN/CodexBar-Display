// An opt-in AI-only development helper. No customer Mac App or device state.
package main

import (
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/companionapi"
	"log"
	"net/http"
	"time"
)

func main() {
	server := &http.Server{
		Addr:              "127.0.0.1:47852",
		Handler:           companionapi.NewAIThemePreviewHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       30 * time.Second,
		WriteTimeout:      5 * time.Minute,
		MaxHeaderBytes:    8 << 10,
	}
	log.Print("AI-only preview listening on 127.0.0.1:47852; credentials are session-only")
	log.Fatal(server.ListenAndServe())
}
