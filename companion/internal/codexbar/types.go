package codexbar

import (
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

type ParsedFrame struct {
	Frame              protocol.Frame
	Provider           string
	Source             string
	Meta               ProviderUsageMeta
	CollectedAt        time.Time
	ActivityObservedAt time.Time
	// TokenStatsCollectedAt is when the last token scan for this provider
	// completed, with or without new tokens.
	TokenStatsCollectedAt time.Time
	// TokenHistoryGrowing is set until the token history has settled once
	// since the start: while it is first read in, the totals rise from scan
	// to scan without anyone working.
	TokenHistoryGrowing bool
	Stale               bool
	// Terminal marks a provider error CodexBar states as permanent (see
	// providerErrorIsTerminal): retained quota for that provider is void.
	Terminal bool
}

type ProviderUsageMeta struct {
	Windows      []UsageWindow
	Status       *ProviderStatus
	Credits      *ProviderCredits
	ResetCredits *ProviderResetCredits
	Cost         *ProviderCostUsage
	Pace         []ProviderPace
	OverTime     []UsageOverTimePoint
	// Plan is the account plan name CodexBar reports, as it reports it.
	Plan  string
	Spend *ProviderSpend
}

// ProviderSpend is the spending cap CodexBar reports for extra usage
// (usage.providerCost). Only a cap above zero is passed on.
type ProviderSpend struct {
	Limit    float64
	Used     float64
	Currency string
	Period   string
}

type UsageWindow struct {
	ID            string
	Label         string
	UsedPercent   int
	ResetSec      int64
	WindowMinutes int
}

type ProviderStatus struct {
	Indicator   string
	Description string
	UpdatedAt   time.Time
	URL         string
}

type ProviderCredits struct {
	Remaining float64
	UpdatedAt time.Time
}

type ProviderResetCredits struct {
	AvailableCount int
	NextExpiresAt  time.Time
	UpdatedAt      time.Time
}

type ProviderCostUsage struct {
	CurrencyCode      string
	UpdatedAt         time.Time
	TodayCostUSD      float64
	Last30DaysCostUSD float64
	Last30DaysTokens  int64
	LatestTokens      int64
	TopModel          string
	Daily             []ProviderCostDay
	// KnownZero marks a complete scan that found no usage at all. An
	// all-zero result is otherwise indistinguishable from "nothing known".
	KnownZero bool
}

type ProviderCostDay struct {
	Day          string
	TotalCostUSD float64
	TotalTokens  int64
	Models       []ProviderCostModel
}

type ProviderCostModel struct {
	Name        string
	TotalTokens int64
	CostUSD     float64
}

type ProviderPace struct {
	Window              string
	Stage               string
	DeltaPercent        int
	ExpectedUsedPercent int
	// Whether CodexBar sent the two numbers above; a missing one is not a 0.
	HasDeltaPercent        bool
	HasExpectedUsedPercent bool
	WillLastToReset        bool
	ETASeconds             int64
	// HasETA tells a zero ETA ("Runs out now") from none at all.
	HasETA  bool
	Summary string
}

type UsageOverTimePoint struct {
	Day              string
	TotalCreditsUsed float64
	Services         []UsageServiceUsage
}

type UsageServiceUsage struct {
	Service     string
	CreditsUsed float64
}
