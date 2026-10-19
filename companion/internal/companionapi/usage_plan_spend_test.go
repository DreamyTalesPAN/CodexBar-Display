package companionapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

// The plan name and the extra-usage cap reach /v1/usage as CodexBar sent them,
// and are left out when CodexBar sent none.
func TestUsagePlanAndSpendPassThrough(t *testing.T) {
	snapshot := func(meta codexbar.ProviderUsageMeta) daemon.ProviderUsageSnapshot {
		return daemon.ProviderUsageSnapshot{
			Provider:    "claude",
			CollectedAt: time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC),
			Frame: protocol.Frame{
				V:            protocol.ProtocolVersionV2,
				Provider:     "claude",
				Label:        "Claude",
				Session:      5,
				Weekly:       10,
				UsageWindows: []protocol.UsageWindow{{ID: "session", Label: "Session", Percent: 5}},
			},
			Meta: meta,
		}
	}

	with, ok := usageProviderFromSnapshot(snapshot(codexbar.ProviderUsageMeta{
		Plan:  "Max 20x",
		Spend: &codexbar.ProviderSpend{Limit: 100, Used: 0, Currency: "EUR", Period: "Monthly cap"},
	}))
	if !ok {
		t.Fatal("usage provider not built")
	}
	if with.Plan != "Max 20x" || with.Spend == nil || with.Spend.Limit != 100 || with.Spend.Currency != "EUR" || with.Spend.Period != "Monthly cap" {
		t.Fatalf("plan and spend not passed on: %+v / %+v", with.Plan, with.Spend)
	}
	raw, err := json.Marshal(with)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"plan":"Max 20x"`, `"spend":{"limit":100,"used":0,"currency":"EUR","period":"Monthly cap"}`} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("usage JSON lacks %s: %s", want, raw)
		}
	}

	without, ok := usageProviderFromSnapshot(snapshot(codexbar.ProviderUsageMeta{}))
	if !ok {
		t.Fatal("usage provider not built")
	}
	raw, err = json.Marshal(without)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"plan"`) || strings.Contains(string(raw), `"spend"`) {
		t.Fatalf("plan or spend sent though CodexBar sent none: %s", raw)
	}
}
