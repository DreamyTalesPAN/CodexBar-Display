package runtimeconfig

import "testing"

func TestClearThemeValueTreatsOnlyResetWordsAsClear(t *testing.T) {
	for input, want := range map[string]bool{
		"":         true,
		"   ":      true,
		"none":     true,
		" OFF ":    true,
		"Auto":     true,
		"default":  true,
		"mini":     false,
		"random":   false,
		"none-ish": false,
	} {
		if got := ClearThemeValue(input); got != want {
			t.Fatalf("ClearThemeValue(%q)=%v, expected %v", input, got, want)
		}
	}
}
