package companionapi

import (
	"bytes"
	"fmt"
	"image/color"
	"image/png"
	"sort"
)

// This gate mirrors the browser's 80px matte sampling/flood fill. It validates
// generated sheets before returning them, so only a defective companion needs
// a bounded repair. Real alpha wins; closed foreground details are not keyed.
func companionSheetIssue(encoded string) string {
	raw, err := validateConceptImage(encoded, "image/png")
	if err != nil {
		return "invalid sprite PNG"
	}
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return "invalid sprite PNG"
	}
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	if w != 2*h || w%4 != 0 || h%2 != 0 {
		return "expected a 4-column, 2-row square-frame grid"
	}
	const side = 80
	edges := []int{}
	for x := 0; x < side; x++ {
		edges = append(edges, x, (side-1)*side+x)
	}
	for y := 1; y < side-1; y++ {
		edges = append(edges, y*side, y*side+side-1)
	}
	for frame := 0; frame < 8; frame++ {
		pixels := make([]color.NRGBA, side*side)
		for y := 0; y < side; y++ {
			for x := 0; x < side; x++ {
				sx := frame%4*(w/4) + (2*x+1)*(w/4)/(side*2)
				sy := frame/4*(h/2) + (2*y+1)*(h/2)/(side*2)
				pixels[y*side+x] = color.NRGBAModel.Convert(img.At(sx, sy)).(color.NRGBA)
			}
		}
		channels := [3][]int{}
		alphaEdges := 0
		for _, p := range edges {
			c := pixels[p]
			if c.A < 128 {
				alphaEdges++
			}
			channels[0] = append(channels[0], int(c.R))
			channels[1] = append(channels[1], int(c.G))
			channels[2] = append(channels[2], int(c.B))
		}
		for _, values := range channels {
			sort.Ints(values)
		}
		r, g, b := channels[0][len(edges)/2], channels[1][len(edges)/2], channels[2][len(edges)/2]
		background := "alpha"
		if float64(alphaEdges)/float64(len(edges)) < .95 {
			background = fmt.Sprintf("#%02x%02x%02x", r, g, b)
			if r < 120 || b < 120 || min(r, b)-g < 50 {
				return fmt.Sprintf("frame %d: background %s is neither alpha nor a magenta matte", frame+1, background)
			}
			close := func(a, b int) bool { return a-b <= 24 && b-a <= 24 }
			matches := func(p int) bool {
				c := pixels[p]
				return c.A < 128 || (close(int(c.R), r) && close(int(c.G), g) && close(int(c.B), b))
			}
			matchingEdges := 0
			for _, p := range edges {
				if matches(p) {
					matchingEdges++
				}
			}
			if float64(matchingEdges)/float64(len(edges)) < .95 {
				return fmt.Sprintf("frame %d: uneven background %s or clipped subject", frame+1, background)
			}
			seen := make([]bool, side*side)
			queue := []int{}
			visit := func(p int) {
				if !seen[p] {
					seen[p] = true
					if matches(p) {
						queue = append(queue, p)
					}
				}
			}
			for _, p := range edges {
				visit(p)
			}
			for head := 0; head < len(queue); head++ {
				p := queue[head]
				if p%side > 0 {
					visit(p - 1)
				}
				if p%side < side-1 {
					visit(p + 1)
				}
				if p >= side {
					visit(p - side)
				}
				if p < side*(side-1) {
					visit(p + side)
				}
			}
			for _, p := range queue {
				pixels[p].A = 0
			}
		}
		transparent := 0
		for _, c := range pixels {
			if c.A < 128 {
				transparent++
			}
		}
		if transparent < side*side/10 || transparent > side*side*98/100 {
			return fmt.Sprintf("frame %d: no usable subject/matte (background %s, %d%% transparent)", frame+1, background, transparent*100/(side*side))
		}
	}
	return ""
}
