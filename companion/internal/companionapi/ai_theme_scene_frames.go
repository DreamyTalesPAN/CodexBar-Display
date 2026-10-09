package companionapi

import (
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
)

// Technical edit bounds, not a guessed subject silhouette or a quality gate.
func aiSceneEditable(r aiSceneRegion, x, y int) bool {
	b := r.EditBounds
	if b.Empty() {
		b = image.Rect(3, 3, r.Width-3, r.Height-3)
	}
	if x < 3 || y < 3 || x >= r.Width-3 || y >= r.Height-3 || !image.Pt(x, y).In(b) {
		return false
	}
	return true
}

// Edit the full original scene so the subject retains its visual context.
// A-B-C-B uses a real drawn intermediate pose on both legs of the loop instead
// of inventing a third, potentially inconsistent return pose.
func (a *aiThemeState) createGeneratedScene(ctx context.Context, key string, scene *image.RGBA, region aiSceneRegion, request string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	template, size := aiSceneFrameTemplate(scene)
	reference, _ := base64.StdEncoding.DecodeString(template)
	var width, height int
	_, _ = fmt.Sscanf(size, "%dx%d", &width, &height)
	mask := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			if !aiSceneEditable(region, x*scene.Bounds().Dx()/width-region.X, y*scene.Bounds().Dy()/height-region.Y) {
				mask.SetNRGBA(x, y, color.NRGBA{A: 255})
			}
		}
	}
	maskBytes, _ := base64.StdEncoding.DecodeString(aiEncodePNG(mask))
	sheet := image.NewRGBA(image.Rect(0, 0, region.Width*2, region.Height*2))
	for y := 0; y < region.Height; y++ {
		for x := 0; x < region.Width; x++ {
			sheet.SetRGBA(x, y, scene.RGBAAt(region.X+x, region.Y+y))
		}
	}
	phases := []string{
		"Begin the action: a small but legible change away from the resting pose.",
		"The peak of the SAME action: a clearly different expressive pose, not a new action.",
	}
	for n, phase := range phases {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		prompt := fmt.Sprintf("Edit this ONE complete scene into ONE animation pose, not a sheet, collage, close-up or grid. Return the ENTIRE scene at exactly the original framing. The supplied image is the ORIGINAL resting reference for every pose. Keep subject scale, position, identity, anatomy, palette, linework and background. Change only the smallest details needed for the action; do not redraw the whole subject. Do not center, shrink, enlarge or recompose it. Only edit inside the transparent mask; outside it is protected context. Draw physical motion, not a pasted copy, camera move, lighting pulse or sliding patch. This is pose %d: the loop plays original, intermediate, peak, SAME intermediate, original. %s Customer request: %s. The same reversible action for both poses: %s.", n+2, phase, request, region.Motion)
		generated, err := a.createConceptImageMasked(ctx, key, prompt, reference, maskBytes, size)
		if err != nil {
			return "", aiThemeErrorAtStage(err, "frames")
		}
		if err := ctx.Err(); err != nil {
			return "", err
		}
		pose, err := aiDecodeResizePNG(generated, scene.Bounds().Dx(), scene.Bounds().Dy())
		if err != nil {
			return "", aiThemeErrorAtStage(err, "frames")
		}
		for y := 0; y < region.Height; y++ {
			for x := 0; x < region.Width; x++ {
				pixel := scene.RGBAAt(region.X+x, region.Y+y)
				if aiSceneEditable(region, x, y) {
					pixel = pose.RGBAAt(region.X+x, region.Y+y)
				}
				sheet.SetRGBA((n+1)%2*region.Width+x, (n+1)/2*region.Height+y, pixel)
				if n == 0 {
					sheet.SetRGBA(region.Width+x, region.Height+y, pixel)
				}
			}
		}
	}
	return aiEncodePNG(sheet), nil
}
