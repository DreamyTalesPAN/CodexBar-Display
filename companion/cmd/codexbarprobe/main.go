package main

import (
  "context"
  "fmt"
  "time"

  "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

func main() {
  selector := codexbar.NewProviderSelector()
  for i := 1; i <= 8; i++ {
    ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
    all, err := codexbar.FetchAllProviders(ctx)
    cancel()

    fmt.Printf("\n=== cycle %d @ %s ===\n", i, time.Now().Format(time.RFC3339))
    if err != nil {
      fmt.Printf("fetch error: %v\n", err)
      continue
    }

    for idx, p := range all {
      fmt.Printf("[%d] provider=%q frameProvider=%q source=%q session=%d weekly=%d reset=%d\n",
        idx, p.Provider, p.Frame.Provider, p.Source, p.Frame.Session, p.Frame.Weekly, p.Frame.ResetSec)
    }

    dec, ok := selector.SelectWithDecision(all)
    if !ok {
      fmt.Println("select: no provider")
    } else {
      fmt.Printf("selected: provider=%q label=%q session=%d weekly=%d reason=%s detail=%s\n",
        dec.Selected.Frame.Provider, dec.Selected.Frame.Label, dec.Selected.Frame.Session, dec.Selected.Frame.Weekly, dec.Reason, dec.Detail)
    }

    time.Sleep(2 * time.Second)
  }
}
