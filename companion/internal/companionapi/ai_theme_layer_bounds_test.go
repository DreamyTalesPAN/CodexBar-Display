package companionapi

import "testing"

func TestAIThemePadsTightSemanticRegionsWithoutMovingTheirTarget(t *testing.T) {
	for _, r := range []aiSceneRegion{
		{X: 100, Y: 25, Width: 20, Height: 40},
		{X: 0, Y: 0, Width: 8, Height: 8},
		{X: 220, Y: 108, Width: 20, Height: 20},
		{X: 60, Y: 25, Width: 64, Height: 64},
	} {
		padded := aiPadSceneRegion(r)
		if padded.X > r.X || padded.Y > r.Y || padded.X+padded.Width < r.X+r.Width || padded.Y+padded.Height < r.Y+r.Height {
			t.Fatal("padding clipped target")
		}
		if padded.Width > 64 || padded.Height > 64 || padded.X < 0 || padded.Y < 0 || padded.X+padded.Width > 240 || padded.Y+padded.Height > 128 {
			t.Fatal("padding exceeds hardware bounds")
		}
	}
}
