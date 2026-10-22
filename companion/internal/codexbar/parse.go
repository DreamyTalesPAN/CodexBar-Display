package codexbar

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func parseAllProviders(raw []byte) ([]ParsedFrame, error) {
	providers, err := extractProvidersFromRawJSON(raw)
	if err != nil {
		return nil, err
	}
	if len(providers) == 0 {
		return nil, ErrNoProviders
	}

	var result []ParsedFrame
	var globalCLIError bool
	for _, providerAny := range providers {
		payload, ok := providerAny.(map[string]any)
		if !ok {
			continue
		}
		parsed, err := parseProviderPayload(payload)
		if err != nil {
			if errors.Is(err, errGlobalCLI) {
				globalCLIError = true
			}
			continue
		}
		result = append(result, parsed)
	}

	if len(result) == 0 {
		if globalCLIError {
			return nil, errGlobalCLI
		}
		return nil, ErrUnexpectedProviderShape
	}
	return result, nil
}

func parseProviderPayload(payload map[string]any) (ParsedFrame, error) {
	if providerPayloadHasError(payload) {
		provider := strings.TrimSpace(strings.ToLower(firstString(payload, "provider", "id", "slug", "name")))
		source := strings.TrimSpace(strings.ToLower(firstString(payload, "source")))
		if provider == "cli" && source == "cli" {
			return ParsedFrame{}, errGlobalCLI
		}
		if provider == "" {
			return ParsedFrame{}, errors.New("provider error payload has no identity")
		}
		label := firstString(payload, "label", "displayName")
		if label == "" {
			label = HumanLabel(provider)
		}
		return ParsedFrame{
			Frame: protocol.Frame{
				V:                1,
				Provider:         provider,
				Label:            label,
				UsageUnavailable: true,
			},
			Provider: provider,
			Source:   source,
			Stale:    true,
			Terminal: providerErrorIsTerminal(providerHealthErrorText(payload["error"])),
		}, nil
	}

	provider := firstString(payload, "provider", "id", "slug", "name")
	source := firstString(payload, "source")
	label := HumanLabel(provider)
	if l := firstString(payload, "label", "displayName", "name"); l != "" {
		label = l
	}

	session, sessionKnown := knownUsagePercentAtPaths(payload,
		"usage.primary",
		"primary",
		"session",
		"openaiDashboard.primaryLimit",
	)
	weekly, weeklyKnown := knownUsagePercentAtPaths(payload,
		"usage.secondary",
		"secondary",
		"weekly",
		"openaiDashboard.secondaryLimit",
	)

	resetWindow := "primary"
	resetAt := firstStringAtPaths(payload,
		"usage.primary.resetsAt",
		"primary.resetsAt",
	)
	if resetAt == "" {
		resetWindow = "secondary"
		resetAt = firstStringAtPaths(payload, "usage.secondary.resetsAt")
	}
	resetSecs := int64(0)
	if resetAt != "" {
		if t, err := time.Parse(time.RFC3339, resetAt); err == nil {
			if d := time.Until(t); d > 0 {
				resetSecs = int64(d.Seconds())
			}
		}
	}
	resetSource := ""
	if resetSecs > 0 {
		resetSource = protocol.ResetSourceKey(provider, resetWindow)
	}

	activityObservedAt := firstRFC3339AtPaths(payload,
		"usage.updatedAt",
		"openaiDashboard.updatedAt",
		"credits.updatedAt",
		"updatedAt",
	)

	if provider == "" && label == "" {
		return ParsedFrame{}, errors.New("provider identity missing in codexbar output")
	}
	if label == "" {
		label = "Provider"
	}

	meta := parseProviderUsageMeta(payload)
	usageWindows := usageWindowsFromWindows(meta.Windows, meta.Pace)
	if len(usageWindows) > 0 {
		session = usageWindows[0].Percent
		resetSecs = usageWindows[0].ResetSec
	}
	if len(usageWindows) > 1 {
		weekly = usageWindows[1].Percent
	}
	frame := protocol.Frame{
		V:                  protocol.ProtocolVersionV2,
		Provider:           provider,
		Label:              label,
		Session:            session,
		Weekly:             weekly,
		ResetSec:           resetSecs,
		ResetSource:        resetSource,
		UsageWindows:       usageWindows,
		UsageUnavailable:   !sessionKnown && !weeklyKnown && len(usageWindows) == 0,
		SessionUnavailable: !sessionKnown,
		WeeklyUnavailable:  !weeklyKnown,
	}.Normalize()
	return ParsedFrame{
		Frame:              frame,
		Provider:           provider,
		Source:             source,
		Meta:               meta,
		ActivityObservedAt: activityObservedAt,
	}, nil
}

func usageWindowsFromWindows(windows []UsageWindow, paces []ProviderPace) []protocol.UsageWindow {
	if len(windows) == 0 {
		return nil
	}
	out := make([]protocol.UsageWindow, 0, len(windows))
	for _, window := range windows {
		if strings.TrimSpace(window.ID) == "" || strings.TrimSpace(window.Label) == "" {
			continue
		}
		pace, _ := PaceForWindow(paces, window.ID)
		out = append(out, protocol.UsageWindow{
			ID:       window.ID,
			Label:    window.Label,
			Percent:  window.UsedPercent,
			ResetSec: window.ResetSec,
			Pace:     pace.Device(),
		})
	}
	return out
}

// CodexBar keys its pace by rate window: "primary" is the session window and
// "secondary" the weekly one. The dashboard path names the same windows
// "session" and "weekly". This is the one lookup for the device frame and the
// Usage API.
func PaceForWindow(paces []ProviderPace, windowID string) (ProviderPace, bool) {
	key := windowID
	switch windowID {
	case "session":
		key = "primary"
	case "weekly":
		key = "secondary"
	}
	for _, item := range paces {
		if item.Window == key {
			return item, true
		}
	}
	return ProviderPace{}, false
}

// paceStates is CodexBar's own grouping of its pace stages: the split its pace
// text makes between "On pace", "N% in deficit" and "N% in reserve".
var paceStates = map[string]string{
	"onTrack":        protocol.PaceOnPace,
	"slightlyAhead":  protocol.PaceDeficit,
	"ahead":          protocol.PaceDeficit,
	"farAhead":       protocol.PaceDeficit,
	"slightlyBehind": protocol.PaceReserve,
	"behind":         protocol.PaceReserve,
	"farBehind":      protocol.PaceReserve,
}

// Device is this pace as the device frame carries it. A stage CodexBar does
// not document, or a missing delta or expected use (the device derives its plan
// tick from both), leaves the pace unknown (the zero value).
func (p ProviderPace) Device() protocol.UsagePace {
	state := paceStates[p.Stage]
	if state == "" || !p.HasDeltaPercent || !p.HasExpectedUsedPercent {
		return protocol.UsagePace{}
	}
	out := protocol.UsagePace{Delta: p.DeltaPercent, State: state}
	// CodexBar says "Lasts until reset", or with an ETA that the quota runs
	// out first. Without either it projects nothing.
	if p.WillLastToReset || p.HasETA {
		lasts := p.WillLastToReset
		out.Lasts = &lasts
	}
	return out
}

func parseProviderUsageMeta(payload map[string]any) ProviderUsageMeta {
	meta := ProviderUsageMeta{
		Windows:  parseUsageWindows(payload),
		Pace:     parseProviderPace(payload),
		OverTime: parseUsageOverTime(payload),
	}
	if status, ok := parseProviderStatus(payload); ok {
		meta.Status = &status
	}
	if credits, ok := parseProviderCredits(payload); ok {
		meta.Credits = &credits
	}
	if resetCredits, ok := parseProviderResetCredits(payload); ok {
		meta.ResetCredits = &resetCredits
	}
	if spend, ok := parseProviderSpend(payload); ok {
		meta.Spend = &spend
	}
	return meta
}

// parseProviderSpend reads CodexBar's extra-usage cap. A missing cap, a cap of
// zero and a cap without currency are all "no cap": nothing is shown.
// finiteAmount rejects NaN and Inf, which strconv accepts and JSON cannot encode.
func finiteAmount(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

func parseProviderSpend(payload map[string]any) (ProviderSpend, bool) {
	costAny, ok := getPath(payload, "usage.providerCost")
	if !ok {
		return ProviderSpend{}, false
	}
	costMap, ok := costAny.(map[string]any)
	if !ok {
		return ProviderSpend{}, false
	}
	limit, ok := floatAtPaths(costMap, "limit")
	currency := strings.TrimSpace(firstString(costMap, "currencyCode"))
	used, usedOK := floatAtPaths(costMap, "used")
	if !ok || !usedOK || currency == "" || !finiteAmount(limit) || !finiteAmount(used) || limit <= 0 {
		return ProviderSpend{}, false
	}
	return ProviderSpend{
		Limit:    limit,
		Used:     used,
		Currency: currency,
		Period:   strings.TrimSpace(firstString(costMap, "period")),
	}, true
}

func parseUsageOverTime(payload map[string]any) []UsageOverTimePoint {
	for _, path := range []string{
		"openaiDashboard.usageBreakdown",
		"openaiDashboard.dailyBreakdown",
		"openaiDashboard.creditEvents",
		"usageBreakdown",
		"dailyBreakdown",
		"creditEvents",
		"usage.overTime",
		"usage.history",
		"credits.events",
	} {
		raw, ok := getPath(payload, path)
		if !ok {
			continue
		}
		if points := parseUsageOverTimePoints(raw); len(points) > 0 {
			return points
		}
	}
	return nil
}

func parseUsageOverTimePoints(raw any) []UsageOverTimePoint {
	items, ok := raw.([]any)
	if !ok || len(items) == 0 {
		return nil
	}

	points := make([]UsageOverTimePoint, 0, len(items))
	for _, item := range items {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		point, ok := parseUsageOverTimePoint(itemMap)
		if ok {
			points = append(points, point)
		}
	}
	if len(points) == 0 {
		return nil
	}
	points = mergeUsageOverTimePoints(points)
	sort.Slice(points, func(i, j int) bool {
		return points[i].Day < points[j].Day
	})
	const maxUsageOverTimeDays = 30
	if len(points) > maxUsageOverTimeDays {
		points = points[len(points)-maxUsageOverTimeDays:]
	}
	return points
}

func parseUsageOverTimePoint(item map[string]any) (UsageOverTimePoint, bool) {
	day := usageDayKey(firstString(item, "day", "date", "dayKey"))
	if day == "" {
		return UsageOverTimePoint{}, false
	}

	services := parseUsageServiceUsageList(item["services"])
	total, ok := floatAtPaths(item, "totalCreditsUsed", "total", "creditsUsed")
	if len(services) == 0 {
		if service := firstString(item, "service", "label", "name"); service != "" && ok {
			services = append(services, UsageServiceUsage{
				Service:     service,
				CreditsUsed: total,
			})
		}
	}
	if !ok {
		for _, service := range services {
			total += service.CreditsUsed
		}
	}
	if total < 0 {
		total = 0
	}
	if total == 0 && len(services) == 0 {
		return UsageOverTimePoint{}, false
	}

	return UsageOverTimePoint{
		Day:              day,
		TotalCreditsUsed: total,
		Services:         services,
	}, true
}

func mergeUsageOverTimePoints(points []UsageOverTimePoint) []UsageOverTimePoint {
	type dayUsage struct {
		total    float64
		services map[string]float64
	}

	byDay := map[string]*dayUsage{}
	for _, point := range points {
		day := strings.TrimSpace(point.Day)
		if day == "" {
			continue
		}
		usage := byDay[day]
		if usage == nil {
			usage = &dayUsage{services: map[string]float64{}}
			byDay[day] = usage
		}
		if point.TotalCreditsUsed > 0 {
			usage.total += point.TotalCreditsUsed
		}
		for _, service := range point.Services {
			name := strings.TrimSpace(service.Service)
			if name == "" || service.CreditsUsed <= 0 {
				continue
			}
			usage.services[name] += service.CreditsUsed
		}
	}
	if len(byDay) == 0 {
		return nil
	}

	days := make([]string, 0, len(byDay))
	for day := range byDay {
		days = append(days, day)
	}
	sort.Strings(days)

	merged := make([]UsageOverTimePoint, 0, len(days))
	for _, day := range days {
		usage := byDay[day]
		services := make([]UsageServiceUsage, 0, len(usage.services))
		for name, credits := range usage.services {
			if credits <= 0 {
				continue
			}
			services = append(services, UsageServiceUsage{
				Service:     name,
				CreditsUsed: credits,
			})
		}
		sort.SliceStable(services, func(i, j int) bool {
			if services[i].CreditsUsed == services[j].CreditsUsed {
				return strings.ToLower(services[i].Service) < strings.ToLower(services[j].Service)
			}
			return services[i].CreditsUsed > services[j].CreditsUsed
		})
		if len(services) > maxUsageOverTimeServices {
			services = services[:maxUsageOverTimeServices]
		}
		merged = append(merged, UsageOverTimePoint{
			Day:              day,
			TotalCreditsUsed: usage.total,
			Services:         services,
		})
	}
	return merged
}

const maxUsageOverTimeServices = 8

func parseUsageServiceUsageList(raw any) []UsageServiceUsage {
	appendService := func(out []UsageServiceUsage, service string, credits float64) []UsageServiceUsage {
		service = strings.TrimSpace(service)
		if service == "" || credits <= 0 {
			return out
		}
		out = append(out, UsageServiceUsage{
			Service:     service,
			CreditsUsed: credits,
		})
		return out
	}

	var out []UsageServiceUsage
	switch v := raw.(type) {
	case []any:
		out = make([]UsageServiceUsage, 0, len(v))
		for _, item := range v {
			itemMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			credits, ok := floatAtPaths(itemMap, "creditsUsed", "credits", "usage")
			if !ok {
				continue
			}
			out = appendService(out, firstString(itemMap, "service", "label", "name"), credits)
		}
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out = make([]UsageServiceUsage, 0, len(keys))
		for _, key := range keys {
			credits, ok := anyToFloat(v[key])
			if !ok {
				continue
			}
			out = appendService(out, key, credits)
		}
	}

	if len(out) == 0 {
		return nil
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreditsUsed == out[j].CreditsUsed {
			return strings.ToLower(out[i].Service) < strings.ToLower(out[j].Service)
		}
		return out[i].CreditsUsed > out[j].CreditsUsed
	})
	if len(out) > maxUsageOverTimeServices {
		out = out[:maxUsageOverTimeServices]
	}
	return out
}

func usageDayKey(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) >= len("2006-01-02") {
		raw = raw[:len("2006-01-02")]
	}
	if _, err := time.Parse("2006-01-02", raw); err != nil {
		return ""
	}
	return raw
}

func parseUsageWindows(payload map[string]any) []UsageWindow {
	windows := []UsageWindow{}
	for _, spec := range []struct {
		id    string
		label string
		paths []string
	}{
		{id: "primary", label: "Session", paths: []string{"usage.primary", "primary", "openaiDashboard.primaryLimit"}},
		{id: "secondary", label: "Weekly", paths: []string{"usage.secondary", "secondary", "openaiDashboard.secondaryLimit"}},
		{id: "tertiary", label: "Tertiary", paths: []string{"usage.tertiary", "tertiary", "openaiDashboard.tertiaryLimit"}},
	} {
		if window, ok := usageWindowAtPaths(payload, spec.id, spec.label, spec.paths...); ok {
			windows = append(windows, window)
		}
	}

	extra, ok := getPath(payload, "usage.extra")
	if !ok {
		extra, ok = payload["extra"]
	}
	if !ok {
		extra, ok = getPath(payload, "usage.extraRateWindows")
	}
	if !ok {
		extra, ok = payload["extraRateWindows"]
	}
	if ok {
		windows = append(windows, parseExtraUsageWindows(extra)...)
	}
	return windows
}

func usageWindowAtPaths(payload map[string]any, id string, label string, paths ...string) (UsageWindow, bool) {
	for _, path := range paths {
		raw, ok := getPath(payload, path)
		if !ok {
			continue
		}
		windowMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		window, ok := parseUsageWindowMap(windowMap, id, label)
		if ok {
			return window, true
		}
	}
	return UsageWindow{}, false
}

func parseExtraUsageWindows(raw any) []UsageWindow {
	switch v := raw.(type) {
	case []any:
		out := make([]UsageWindow, 0, len(v))
		for i, item := range v {
			itemMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			id := firstString(itemMap, "id", "key", "name")
			if id == "" {
				id = fmt.Sprintf("extra-%d", i+1)
			}
			label := firstString(itemMap, "label", "title", "name")
			if label == "" {
				label = HumanLabel(id)
			}
			windowMap := itemMap
			if nested, ok := itemMap["window"].(map[string]any); ok {
				windowMap = nested
			}
			if window, ok := parseUsageWindowMap(windowMap, id, label); ok {
				out = append(out, window)
			}
		}
		return out
	case map[string]any:
		out := make([]UsageWindow, 0, len(v))
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			itemMap, ok := v[key].(map[string]any)
			if !ok {
				continue
			}
			label := firstString(itemMap, "label", "title", "name")
			if label == "" {
				label = HumanLabel(key)
			}
			if window, ok := parseUsageWindowMap(itemMap, key, label); ok {
				out = append(out, window)
			}
		}
		return out
	default:
		return nil
	}
}

func parseUsageWindowMap(windowMap map[string]any, id string, label string) (UsageWindow, bool) {
	used, known := knownUsagePercentAtPaths(windowMap, "usedPercent", "used_percent", "percent", "usagePercent")
	if !known {
		return UsageWindow{}, false
	}
	resetSec, _ := resetSecondsFromWindowMap(windowMap)
	windowMinutes, _ := intAtPathsWithPresence(windowMap, "windowMinutes", "window_minutes")
	return UsageWindow{
		ID:            strings.TrimSpace(strings.ToLower(id)),
		Label:         strings.TrimSpace(label),
		UsedPercent:   used,
		ResetSec:      resetSec,
		WindowMinutes: windowMinutes,
	}, true
}

func resetSecondsFromWindowMap(windowMap map[string]any) (int64, bool) {
	if n, ok := intAtPathsWithPresence(
		windowMap,
		"resetSecs",
		"resetSeconds",
		"reset_after_seconds",
	); ok {
		if n < 0 {
			n = 0
		}
		return int64(n), true
	}
	resetAt := firstStringAtPaths(windowMap, "resetsAt", "resetAt", "resets_at")
	if resetAt == "" {
		return 0, false
	}
	t, err := time.Parse(time.RFC3339, resetAt)
	if err != nil {
		return 0, false
	}
	if d := time.Until(t); d > 0 {
		return int64(d.Seconds()), true
	}
	return 0, true
}

func parseProviderStatus(payload map[string]any) (ProviderStatus, bool) {
	statusAny, ok := payload["status"]
	if !ok {
		return ProviderStatus{}, false
	}
	statusMap, ok := statusAny.(map[string]any)
	if !ok {
		return ProviderStatus{}, false
	}
	status := ProviderStatus{
		Indicator:   firstString(statusMap, "indicator", "status"),
		Description: firstString(statusMap, "description", "summary", "message"),
		URL:         firstString(statusMap, "url", "statusPageURL", "statusLinkURL"),
	}
	if updatedAt := firstRFC3339AtPaths(statusMap, "updatedAt"); !updatedAt.IsZero() {
		status.UpdatedAt = updatedAt
	}
	if status.Indicator == "" && status.Description == "" && status.URL == "" {
		return ProviderStatus{}, false
	}
	return status, true
}

func parseProviderCredits(payload map[string]any) (ProviderCredits, bool) {
	creditsAny, ok := payload["credits"]
	if !ok {
		return ProviderCredits{}, false
	}
	creditsMap, ok := creditsAny.(map[string]any)
	if !ok {
		return ProviderCredits{}, false
	}
	remaining, ok := floatAtPaths(creditsMap, "remaining", "remainingCredits", "balance")
	if !ok {
		return ProviderCredits{}, false
	}
	credits := ProviderCredits{Remaining: remaining}
	if updatedAt := firstRFC3339AtPaths(creditsMap, "updatedAt"); !updatedAt.IsZero() {
		credits.UpdatedAt = updatedAt
	}
	return credits, true
}

func parseProviderResetCredits(payload map[string]any) (ProviderResetCredits, bool) {
	resetAny, ok := getPath(payload, "usage.codexResetCredits")
	if !ok {
		resetAny, ok = getPath(payload, "codexResetCredits")
	}
	if !ok {
		return ProviderResetCredits{}, false
	}
	resetMap, ok := resetAny.(map[string]any)
	if !ok {
		return ProviderResetCredits{}, false
	}

	availableCount := intAtPaths(resetMap, "availableCount", "available_count")
	if availableCount < 0 {
		availableCount = 0
	}

	var nextExpiresAt time.Time
	if creditsAny, ok := resetMap["credits"]; ok {
		if credits, ok := creditsAny.([]any); ok {
			counted := 0
			for _, creditAny := range credits {
				credit, ok := creditAny.(map[string]any)
				if !ok {
					continue
				}
				status := strings.TrimSpace(strings.ToLower(firstString(credit, "status")))
				if status != "" && status != "available" {
					continue
				}
				counted++
				expiresAt := firstRFC3339AtPaths(credit, "expires_at", "expiresAt")
				if expiresAt.IsZero() {
					continue
				}
				if nextExpiresAt.IsZero() || expiresAt.Before(nextExpiresAt) {
					nextExpiresAt = expiresAt.UTC()
				}
			}
			if availableCount == 0 {
				availableCount = counted
			}
		}
	}

	updatedAt := firstRFC3339AtPaths(resetMap, "updatedAt", "updated_at")
	if availableCount == 0 && nextExpiresAt.IsZero() && updatedAt.IsZero() {
		return ProviderResetCredits{}, false
	}

	return ProviderResetCredits{
		AvailableCount: availableCount,
		NextExpiresAt:  nextExpiresAt,
		UpdatedAt:      updatedAt,
	}, true
}

// CodexBar 0.75.0 CLIRenderer.pacePayload rounds these before JSON encoding.
// Our JSON decoder supplies float64; strings and fractional values are not pace.
func parsePacePercent(value any, minimum float64) (int, bool) {
	n, ok := value.(float64)
	if !ok || !finiteAmount(n) || n < minimum || n > 100 || math.Trunc(n) != n {
		return 0, false
	}
	return int(n), true
}

func parseProviderPace(payload map[string]any) []ProviderPace {
	paceAny, ok := payload["pace"]
	if !ok {
		return nil
	}
	paceMap, ok := paceAny.(map[string]any)
	if !ok {
		return nil
	}
	keys := make([]string, 0, len(paceMap))
	for key := range paceMap {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	out := make([]ProviderPace, 0, len(keys))
	for _, key := range keys {
		itemMap, ok := paceMap[key].(map[string]any)
		if !ok {
			continue
		}
		pace := ProviderPace{
			Window:          strings.TrimSpace(strings.ToLower(key)),
			Stage:           firstString(itemMap, "stage"),
			WillLastToReset: boolAtPaths(itemMap, "willLastToReset"),
			Summary:         firstString(itemMap, "summary"),
		}
		eta, hasETA := intAtPathsWithPresence(itemMap, "etaSeconds")
		pace.ETASeconds, pace.HasETA = int64(eta), hasETA
		pace.DeltaPercent, pace.HasDeltaPercent = parsePacePercent(itemMap["deltaPercent"], -100)
		pace.ExpectedUsedPercent, pace.HasExpectedUsedPercent = parsePacePercent(itemMap["expectedUsedPercent"], 0)
		if pace.Stage == "" && pace.Summary == "" {
			continue
		}
		out = append(out, pace)
	}
	return out
}

func providerPayloadHasError(payload map[string]any) bool {
	raw, ok := payload["error"]
	if !ok || raw == nil {
		return false
	}

	switch v := raw.(type) {
	case string:
		return strings.TrimSpace(v) != ""
	case map[string]any:
		if len(v) == 0 {
			return false
		}
		// Non-empty provider error payloads are not usable usage frames.
		return true
	default:
		return true
	}
}

// providerErrorIsTerminal reports CodexBar's own end-of-support statement for
// a provider. CodexBar exports provider failures as {code, kind, message}
// without a typed reason, so the one central classification decides: whatever
// classifyProviderError calls unsupported (today both Gemini CLI OAuth
// shutdown sentences) voids the retained quota. Every other error is transient
// here and keeps the bounded last-good quota.
func providerErrorIsTerminal(detail string) bool {
	return classifyProviderError(detail) == ProviderUnsupported
}

func extractProviderList(root any) []any {
	switch v := root.(type) {
	case []any:
		return v
	case map[string]any:
		for _, key := range []string{"providers", "items", "data", "results"} {
			if arr, ok := v[key].([]any); ok {
				return arr
			}
		}
	}
	return nil
}

func extractProvidersFromRawJSON(raw []byte) ([]any, error) {
	providers, err := decodeProvidersFromRaw(raw)
	if err == nil || len(providers) > 0 {
		return providers, err
	}

	// CodexBar can occasionally prefix stderr-like text before JSON while still
	// emitting a valid provider payload later in stdout. In that case, retry
	// decode from the first JSON token start.
	remainder := raw
	for len(remainder) > 0 {
		idx := bytes.IndexAny(remainder, "[{")
		if idx == -1 {
			break
		}

		candidate := remainder[idx:]
		parsed, parseErr := decodeProvidersFromRaw(candidate)
		if parseErr == nil || len(parsed) > 0 {
			return parsed, parseErr
		}

		remainder = candidate[1:]
	}

	return nil, err
}

func decodeProvidersFromRaw(raw []byte) ([]any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	var providers []any

	for {
		var value any
		err := dec.Decode(&value)
		if err == io.EOF {
			break
		}
		if err != nil {
			// Keep already decoded provider payloads if trailing data is malformed.
			if len(providers) > 0 {
				break
			}
			return nil, fmt.Errorf("parse codexbar json: %w", err)
		}

		if parsed := extractProviderList(value); len(parsed) > 0 {
			providers = append(providers, parsed...)
		}
	}

	return providers, nil
}

func HumanLabel(provider string) string {
	p := strings.TrimSpace(strings.ToLower(provider))
	switch p {
	case "":
		return "Provider"
	case "codex":
		return "Codex"
	case "claude":
		return "Claude"
	case "cursor":
		return "Cursor"
	case "copilot":
		return "Copilot"
	case "gemini":
		return "Gemini"
	default:
		return strings.ToUpper(p[:1]) + p[1:]
	}
}
