package companionapi

// Padding is a technical constraint, not a semantic choice. The AI still
// chooses the actual subject and action; all generated poses must fit this crop.
func aiPadSceneRegion(r aiSceneRegion) aiSceneRegion {
	w, h := min(64, r.Width+24), min(64, r.Height+24)
	r.X = max(0, min(240-w, r.X-(w-r.Width)/2))
	r.Y = max(0, min(128-h, r.Y-(h-r.Height)/2))
	r.Width, r.Height = w, h
	return r
}
