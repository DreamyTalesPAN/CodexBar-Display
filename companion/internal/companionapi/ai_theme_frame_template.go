package companionapi

import (
	"fmt"
	"image"
)

// One enlarged resting reference. The model edits a single pose, not a grid.
func aiSceneFrameTemplate(crop image.Image) (string, string) {
	w, h := crop.Bounds().Dx(), crop.Bounds().Dy()
	scale := 1
	for (w*scale)%16 != 0 || (h*scale)%16 != 0 || w*h*scale*scale < 655360 {
		scale++
	}
	tileWidth, tileHeight := w*scale, h*scale
	sheet := image.NewRGBA(image.Rect(0, 0, tileWidth, tileHeight))
	for y := 0; y < sheet.Bounds().Dy(); y++ {
		for x := 0; x < sheet.Bounds().Dx(); x++ {
			sheet.Set(x, y, crop.At(crop.Bounds().Min.X+(x%tileWidth)/scale, crop.Bounds().Min.Y+(y%tileHeight)/scale))
		}
	}
	return aiEncodePNG(sheet), fmt.Sprintf("%dx%d", tileWidth, tileHeight)
}
