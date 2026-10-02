package companionapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type aiCompanion struct {
	ID          string `json:"id"`
	X           int    `json:"x"`
	Y           int    `json:"y"`
	Size        int    `json:"size"`
	FPS         int    `json:"fps"`
	FrameCount  int    `json:"frameCount"`
	KeyColor    string `json:"keyColor"`
	SheetBase64 string `json:"sheetBase64"`
	Reuse       bool   `json:"reuse"`
}
type aiCompanionPlan struct {
	ID      string `json:"id"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	Size    int    `json:"size"`
	FPS     int    `json:"fps"`
	Reuse   bool   `json:"reuse"`
	Subject string `json:"subject"`
	Motion  string `json:"motion"`
}

func validCompanionLayout(id string, x, y, size, fps int) bool {
	return (id == "pet-1" || id == "pet-2") && size >= 16 && size <= 80 && x >= 0 && y >= 0 && x+size <= 240 && y+size <= 128 && (fps == 0 || fps == 1 || fps == 2 || fps == 4 || fps == 8)
}
func validatePreviousCompanions(pets []aiCompanion) error {
	if len(pets) > 2 {
		return errors.New("previous_concept_invalid")
	}
	seen := map[string]bool{}
	for _, p := range pets {
		if seen[p.ID] || !validCompanionLayout(p.ID, p.X, p.Y, p.Size, p.FPS) || p.FrameCount != 8 || p.KeyColor != "#FF00FF" {
			return errors.New("previous_concept_invalid")
		}
		if _, err := validateConceptImage(p.SheetBase64, "image/png"); err != nil {
			return err
		}
		seen[p.ID] = true
	}
	return nil
}

// One fixed background and up to two independent sprites. The model owns the
// count, subjects, motion and placement; no customer-facing representation menu.
func (a *aiThemeState) createCompanionConcept(ctx context.Context, key string, req aiThemeConceptRequest, previous []byte) (result aiThemeConcept, err error) {
	ctx, cancel := context.WithTimeout(ctx, 240*time.Second)
	defer cancel()
	stage := "direction"
	defer func() {
		if err != nil {
			err = aiThemeErrorAtStage(err, stage)
		}
	}()
	styleSchema := aiThemeStyleSchema()
	styleSchema["properties"].(map[string]any)["preserveArtwork"] = map[string]any{"type": "boolean"}
	styleSchema["required"] = append(styleSchema["required"].([]string), "preserveArtwork")
	integer := func(min, max int) any { return map[string]any{"type": "integer", "minimum": min, "maximum": max} }
	petSchema := aiObjectSchema(map[string]any{
		"id": map[string]any{"type": "string", "enum": []string{"pet-1", "pet-2"}}, "x": integer(0, 224), "y": integer(0, 112), "size": integer(16, 80),
		"fps": map[string]any{"type": "integer", "enum": []int{0, 1, 2, 4, 8}}, "reuse": map[string]any{"type": "boolean"},
		"subject": map[string]any{"type": "string", "minLength": 1, "maxLength": 700}, "motion": map[string]any{"type": "string", "minLength": 1, "maxLength": 300},
	}, "id", "x", "y", "size", "fps", "reuse", "subject", "motion")
	schema := aiObjectSchema(map[string]any{"style": styleSchema, "companions": map[string]any{"type": "array", "maxItems": 2, "items": petSchema}}, "style", "companions")
	content := []any{aiText("Customer request: " + req.Prompt)}
	old := map[string]aiCompanion{}
	if req.Previous != nil {
		style, _ := json.Marshal(req.Previous.Style)
		content = append(content, aiText("Current style: "+string(style)), aiText("Current BACKGROUND layer:"), aiVisionImage(req.Previous.ImageBase64))
		if req.Previous.ReferenceImageBase64 != "" {
			if _, e := validateConceptImage(req.Previous.ReferenceImageBase64, "image/png"); e != nil {
				return result, e
			}
			content = append(content, aiText("Current composed scene:"), aiVisionImage(req.Previous.ReferenceImageBase64))
		}
		for _, p := range req.Previous.Companions {
			old[p.ID] = p
			content = append(content, aiText(fmt.Sprintf("Existing %s: x=%d y=%d size=%d fps=%d; keep this ID for this subject. All eight poses:", p.ID, p.X, p.Y, p.Size, p.FPS)), aiVisionImage(p.SheetBase64))
		}
	}
	raw, e := a.structuredAIReply(ctx, key, `You design a 240x128 pixel-art scene for a tiny display. The background is ALWAYS STATIC. The customer has one free-text prompt, no technical settings. Choose ONE or TWO independently animated foreground sprites to best match their request; explicit requested counts take precedence. Animated elements need not be pets: small characters, floating objects or effects are fine. Two is not automatically better. For explicitly no animation choose zero companions and static; otherwise choose one or two and four_frame (legacy mode name; each actual sprite has eight frames). Do not choose scene_loop or animate a background crop. Never use a rig or video. Respect the customer's scene and art direction. Plan simple readable complete cyclic actions for tiny sprites, with fixed character size, body anchor and camera; do not promise complex physical interaction with scenery. Match palette, perspective, lighting and scale. Each sprite is a square DISPLAY size16..80 (stored animation frames remain at most64; the renderer scales them), x/y are TOP LEFT in the 240x128 image; keep all sprite rectangles inside and non-overlapping. Grounded subjects need their feet at about 88 percent of sprite height on a visible ground surface; hovering subjects need clear space. artPrompt describes overall intent; environmentPrompt must describe only the static setting, NO duplicate animated subjects, and reserve clear space at the planned sprite locations. Describe protected static scenery and correct grounding. Preserve existing IDs, placement, sizes and unaffected sprites when refining unless requested otherwise. reuse=true means keep an existing sprite's exact drawings and motion; false generates/revises its eight-pose sheet. New IDs must use reuse=false. preserveArtwork=true means keep the exact existing BACKGROUND layer; never use the composed picture as background, which would duplicate the pets. Set false when changing scenery or replacing a legacy scene whose animated subject was painted into its background. Existing companion backgrounds are already clean and should normally be preserved for animation-only changes. Zero companions also means animationPrompt empty; otherwise animationPrompt briefly summarizes their actions. Notes plainly explain chosen subjects/actions, no claims of verified quality. Return only the strict schema.`, content, schema, "vibetv_companion_direction")
	if e != nil {
		return result, e
	}
	var plan struct {
		Style      aiThemeStyle      `json:"style"`
		Companions []aiCompanionPlan `json:"companions"`
	}
	if json.Unmarshal([]byte(raw), &plan) != nil || validateAIThemeStyle(plan.Style) != nil || len(plan.Companions) > 2 {
		return result, errors.New("provider_malformed_response")
	}
	if (len(plan.Companions) == 0) != (plan.Style.AnimationMode == "static") || plan.Style.AnimationMode == "scene_loop" {
		return result, errors.New("provider_malformed_response")
	}
	seen := map[string]bool{}
	for i, p := range plan.Companions {
		if seen[p.ID] || !validCompanionLayout(p.ID, p.X, p.Y, p.Size, p.FPS) || p.Subject == "" || p.Motion == "" {
			return result, errors.New("provider_malformed_response")
		}
		seen[p.ID] = true
		if p.Reuse {
			if _, ok := old[p.ID]; !ok {
				return result, errors.New("provider_malformed_response")
			}
		}
		for _, q := range plan.Companions[:i] {
			if p.X < q.X+q.Size && q.X < p.X+p.Size && p.Y < q.Y+q.Size && q.Y < p.Y+p.Size {
				return result, errors.New("provider_malformed_response")
			}
		}
	}
	if len(previous) == 0 {
		plan.Style.PreserveArtwork = false
	}
	result = aiThemeConcept{Style: plan.Style, ImageContentType: "image/png", Companions: []aiCompanion{}}
	result.ImageBase64 = base64.StdEncoding.EncodeToString(previous)
	if !plan.Style.PreserveArtwork {
		stage = "artwork"
		layout, _ := json.Marshal(plan.Companions)
		prompt := "Create only ONE beautiful STATIC BACKGROUND illustration, front-on 15:8 composition for a 240x128 pixel-art display. Crisp large pixel clusters, limited cohesive palette. No UI, words, numbers, device or frame. Do NOT draw any of the animated subjects or duplicate characters: they will be added as separate foreground sprites. Reserve unobstructed space and appropriate ground contact for these planned sprite rectangles (coordinates are final 240x128 pixels; subjects are NOT part of this image): " + string(layout) + ". Environment: " + plan.Style.EnvironmentPrompt
		result.ImageBase64, e = a.createConceptImage(ctx, key, prompt, previous)
		if e != nil {
			return result, e
		}
	}
	background, e := validateConceptImage(result.ImageBase64, "image/png")
	if e != nil {
		return result, e
	}
	for _, p := range plan.Companions {
		stage = "frames"
		c := aiCompanion{ID: p.ID, X: p.X, Y: p.Y, Size: p.Size, FPS: p.FPS, FrameCount: 8, KeyColor: "#FF00FF", Reuse: p.Reuse}
		if p.Reuse {
			c.SheetBase64 = old[p.ID].SheetBase64
		} else {
			reference := background
			identity := "The supplied background is ONLY a style, palette and lighting reference. Do not include any scenery."
			if prior, ok := old[p.ID]; ok {
				reference, _ = validateConceptImage(prior.SheetBase64, "image/png")
				identity = "The supplied existing sprite sheet is the identity reference. Apply the requested appearance, color or motion changes to this subject; preserve only the traits the customer did not ask to change. A requested new fur/body color must replace the old color, not just recolor an accessory. Keep its lighting and pixel-art style, but never draw an environment."
			}
			prompt := fmt.Sprintf("%s Create ONE sprite sheet with EXACTLY EIGHT animation frames in a regular 4-COLUMN, 2-ROW grid of equal SQUARE cells, aspect ratio 2:1. Each cell contains the SAME complete isolated subject at identical scale and body anchor. Generous padding; no clipping. Draw one continuous cyclic action in reading order, frame8 returning smoothly to frame1. Keep body size, face, markings and ground/hover anchor consistent; only intended body parts change pose. Chunky crisp pixel art readable at %dx%d display pixels. Use perfectly flat opaque pure magenta RGB(255,0,255) #FF00FF everywhere outside the subject, including holes between limbs. NO checkerboard, scenery, floor, shadows, captions, borders or grid lines. Do not use magenta in the subject. For grounded subjects keep feet at the same baseline around 88%% cell height. Subject: %s. Motion: %s.", identity, p.Size, p.Size, p.Subject, p.Motion)
			prompt += " Customer change request: " + req.Prompt
			c.SheetBase64, e = a.createConceptImageSized(ctx, key, prompt, reference, "1536x768")
			if e != nil {
				return result, e
			}
			if err := ctx.Err(); err != nil {
				return result, err
			}
			if issue := companionSheetIssue(c.SheetBase64); issue != "" {
				// Repair this sprite once. Never send the rejected scene back as an
				// identity reference, and never regenerate other layers here.
				var repairReference []byte
				if prior, ok := old[p.ID]; ok {
					repairReference, _ = validateConceptImage(prior.SheetBase64, "image/png")
				}
				repairPrompt := "REPAIR: The previous output was rejected: " + issue + ". Return ONLY an isolated sprite sheet, never an illustration or scene. " + prompt + " FINAL OUTPUT REQUIREMENT: exactly 4 columns by 2 rows of square cells; eight complete poses with empty padding on every edge. Every pixel outside the subject must be uniform #FF00FF. NO environment, floor, UI, text or extra poses."
				c.SheetBase64, e = a.createConceptImageSized(ctx, key, repairPrompt, repairReference, "1536x768")
				if e != nil {
					return result, e
				}
				if err := ctx.Err(); err != nil {
					return result, err
				}
				if issue = companionSheetIssue(c.SheetBase64); issue != "" {
					return result, aiThemeQualityFailure("frames", "Companion "+p.ID+" failed after one correction: "+issue, false)
				}
			}
		}
		result.Companions = append(result.Companions, c)
	}
	return result, nil
}
