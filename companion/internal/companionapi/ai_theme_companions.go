package companionapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
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

// artHeight is the height of the picture the sprite stands on: 128, or 240 when
// the picture fills the whole display.
func validCompanionLayout(id string, x, y, size, fps, artHeight int) bool {
	return (id == "pet-1" || id == "pet-2") && size >= 16 && size <= 80 && x >= 0 && y >= 0 && x+size <= 240 && y+size <= artHeight && (fps == 0 || fps == 1 || fps == 2 || fps == 4 || fps == 8)
}
func validatePreviousCompanions(pets []aiCompanion) error {
	if len(pets) > 2 {
		return errors.New("previous_concept_invalid")
	}
	seen := map[string]bool{}
	for _, p := range pets {
		if seen[p.ID] || !validCompanionLayout(p.ID, p.X, p.Y, p.Size, p.FPS, 240) || p.FrameCount != 8 || p.KeyColor != "#FF00FF" {
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
		"id": map[string]any{"type": "string", "enum": []string{"pet-1", "pet-2"}}, "x": integer(0, 224), "y": integer(0, 224), "size": integer(16, 80),
		"fps": map[string]any{"type": "integer", "enum": []int{0, 1, 2, 4, 8}}, "reuse": map[string]any{"type": "boolean"},
		"subject": map[string]any{"type": "string", "minLength": 1, "maxLength": 700}, "motion": map[string]any{"type": "string", "minLength": 1, "maxLength": 300},
	}, "id", "x", "y", "size", "fps", "reuse", "subject", "motion")
	schema := aiObjectSchema(map[string]any{"style": styleSchema, "companions": map[string]any{"type": "array", "maxItems": 2, "items": petSchema}, "fullScreen": map[string]any{"type": "boolean"}, "showUsage": map[string]any{"type": "boolean"}}, "style", "companions", "fullScreen", "showUsage")
	content := []any{aiText("Customer request: " + req.Prompt)}
	for _, message := range req.History {
		content = append(content, aiText(message.Role+": "+message.Content))
	}
	old := map[string]aiCompanion{}
	var legacyAnimation []byte
	previousHeight := 0
	if req.Previous != nil {
		if config, e := png.DecodeConfig(bytes.NewReader(previous)); e == nil {
			previousHeight = config.Height
		}
		style, _ := json.Marshal(req.Previous.Style)
		content = append(content, aiText("Current style: "+string(style)), aiText(fmt.Sprintf("Current BACKGROUND layer, 240x%d:", previousHeight)), aiVisionImage(req.Previous.ImageBase64))
		if req.Previous.ReferenceImageBase64 != "" {
			if _, e := validateConceptImage(req.Previous.ReferenceImageBase64, "image/png"); e != nil {
				return result, e
			}
			content = append(content, aiText("Current composed scene:"), aiVisionImage(req.Previous.ReferenceImageBase64))
		}
		if len(req.Previous.Companions) == 0 && req.Previous.AnimationSheetBase64 != "" {
			legacyAnimation, err = validateConceptImage(req.Previous.AnimationSheetBase64, "image/png")
			if err != nil {
				return result, err
			}
			content = append(content, aiText("Existing legacy animated subject, all poses. Refine this subject as pet-1 with reuse=false when changing it:"), aiVisionImage(req.Previous.AnimationSheetBase64))
		}
		for _, p := range req.Previous.Companions {
			old[p.ID] = p
			content = append(content, aiText(fmt.Sprintf("Existing %s: x=%d y=%d size=%d fps=%d; keep this ID for this subject. All eight poses:", p.ID, p.X, p.Y, p.Size, p.FPS)), aiVisionImage(p.SheetBase64))
		}
	}
	content = append(content, aiThemeReferenceContent(req.ReferenceImages)...)
	raw, e := a.structuredAIReply(ctx, key, `You design a pixel-art scene for a tiny 240x240 display. The picture is either 240x128 (fullScreen=false): it fills the top of the display and the area below it stays free for live usage readouts; or 240x240 (fullScreen=true): it fills the whole display. Choose fullScreen=true when the customer asks for a full-screen, whole-display or larger picture, or when the design is not about usage, such as a virtual pet, a toy, a game-like scene or pure decoration. showUsage=true adds the standard session and weekly usage readouts; choose false when the customer does not want them or the design has nothing to do with usage limits. With fullScreen=true and showUsage=true the readouts are drawn directly over the lower half of the picture, so keep that half calm and dark enough for light text. When nothing indicates otherwise use fullScreen=false and showUsage=true. When refining an existing scene keep its picture size unless the customer asks to change it; preserveArtwork=true always keeps the existing size. Below, H means the picture height, 128 or 240. The background is ALWAYS STATIC. The customer has one free-text prompt, no technical settings. Choose ONE or TWO independently animated foreground sprites to best match their request; explicit requested counts take precedence. Animated elements need not be pets: small characters, floating objects or effects are fine. Two is not automatically better. For explicitly no animation choose zero companions and static; otherwise choose one or two and four_frame (legacy mode name; each actual sprite has eight frames). Do not choose scene_loop or animate a background crop. Never use a rig or video. Respect the customer's scene and art direction. Plan simple readable complete cyclic actions for tiny sprites, with fixed character size, body anchor and camera; do not promise complex physical interaction with scenery. Match palette, perspective, lighting and scale. Each sprite is a square DISPLAY size16..80 (stored animation frames remain at most64; the renderer scales them), x/y are TOP LEFT in the 240xH picture; keep all sprite rectangles inside it and non-overlapping. Grounded subjects need their feet at about 88 percent of sprite height on a visible ground surface; hovering subjects need clear space. artPrompt describes overall intent; environmentPrompt must describe only the static setting, NO duplicate animated subjects, and reserve clear space at the planned sprite locations. Describe protected static scenery and correct grounding. Preserve existing IDs, placement, sizes and unaffected sprites when refining unless requested otherwise. reuse=true means keep an existing sprite's exact drawings and motion; false generates/revises its eight-pose sheet. New IDs must use reuse=false. preserveArtwork=true means keep the exact existing BACKGROUND layer; never use the composed picture as background, which would duplicate the pets. Set false when changing scenery or replacing a legacy scene whose animated subject was painted into its background. Existing companion backgrounds are already clean and should normally be preserved for animation-only changes. Zero companions also means animationPrompt empty; otherwise animationPrompt briefly summarizes their actions. Notes plainly explain chosen subjects/actions, no claims of verified quality. Return only the strict schema.`, content, schema, "vibetv_companion_direction")
	if e != nil {
		return result, e
	}
	var plan struct {
		Style      aiThemeStyle      `json:"style"`
		Companions []aiCompanionPlan `json:"companions"`
		FullScreen bool              `json:"fullScreen"`
		ShowUsage  bool              `json:"showUsage"`
	}
	if json.Unmarshal([]byte(raw), &plan) != nil || validateAIThemeStyle(plan.Style) != nil || len(plan.Companions) > 2 {
		return result, errors.New("provider_malformed_response")
	}
	if (len(plan.Companions) == 0) != (plan.Style.AnimationMode == "static") || plan.Style.AnimationMode == "scene_loop" {
		return result, errors.New("provider_malformed_response")
	}
	if len(previous) == 0 {
		plan.Style.PreserveArtwork = false
	}
	if plan.Style.PreserveArtwork {
		plan.FullScreen = previousHeight == 240
	}
	artHeight, shape, imageSize := 128, "front-on 15:8 composition for a 240x128", openAIImageSize
	if plan.FullScreen {
		artHeight, shape, imageSize = 240, "front-on square 1:1 composition for a 240x240", "1024x1024"
	}
	seen := map[string]bool{}
	for i, p := range plan.Companions {
		if seen[p.ID] || !validCompanionLayout(p.ID, p.X, p.Y, p.Size, p.FPS, artHeight) || p.Subject == "" || p.Motion == "" {
			return result, errors.New("provider_malformed_response")
		}
		seen[p.ID] = true
		if _, ok := old[p.ID]; p.Reuse && !ok {
			// A legacy animation is not stored as a companion and cannot be kept
			// as it is; redraw it from its old sheet instead of failing the request.
			if p.ID != "pet-1" || len(legacyAnimation) == 0 {
				return result, errors.New("provider_malformed_response")
			}
			plan.Companions[i].Reuse = false
		}
		for _, q := range plan.Companions[:i] {
			if p.X < q.X+q.Size && q.X < p.X+p.Size && p.Y < q.Y+q.Size && q.Y < p.Y+p.Size {
				return result, errors.New("provider_malformed_response")
			}
		}
	}
	result = aiThemeConcept{Style: plan.Style, ImageContentType: "image/png", Companions: []aiCompanion{}, ArtHeight: artHeight, HideUsage: !plan.ShowUsage}
	result.ImageBase64 = base64.StdEncoding.EncodeToString(previous)
	if !plan.Style.PreserveArtwork {
		stage = "artwork"
		layout, _ := json.Marshal(plan.Companions)
		prompt := "Create only ONE beautiful STATIC BACKGROUND illustration, " + shape + " pixel-art display. Crisp large pixel clusters, limited cohesive palette. No UI, words, numbers, device or frame. Do NOT draw any of the animated subjects or duplicate characters: they will be added as separate foreground sprites. Reserve unobstructed space and appropriate ground contact for these planned sprite rectangles (coordinates are final picture pixels; subjects are NOT part of this image): " + string(layout) + ". Environment: " + plan.Style.EnvironmentPrompt
		if len(plan.Companions) == 0 {
			prompt = "Create ONE complete STATIC pixel-art scene, " + shape + " display. Crisp large pixel clusters, limited cohesive palette. No UI, words, numbers, device or frame. Include the subjects and scene described here: " + plan.Style.ArtPrompt + ". Environment: " + plan.Style.EnvironmentPrompt
		}
		if plan.FullScreen && plan.ShowUsage {
			prompt += " Keep the lower half calm and fairly dark: light text is drawn over it."
		}
		// A picture of another shape is drawn afresh; the old one would be stretched.
		reference := previous
		if previousHeight != artHeight {
			reference = nil
		}
		result.ImageBase64, e = a.createConceptImageSized(ctx, key, prompt, reference, imageSize)
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
			var identityReference []byte
			if prior, ok := old[p.ID]; ok {
				identityReference, _ = validateConceptImage(prior.SheetBase64, "image/png")
			} else if p.ID == "pet-1" {
				identityReference = legacyAnimation
			}
			if len(identityReference) > 0 {
				reference = identityReference
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
				repairPrompt := "REPAIR: The previous output was rejected: " + issue + ". Return ONLY an isolated sprite sheet, never an illustration or scene. " + prompt + " FINAL OUTPUT REQUIREMENT: exactly 4 columns by 2 rows of square cells; eight complete poses with empty padding on every edge. Every pixel outside the subject must be uniform #FF00FF. NO environment, floor, UI, text or extra poses."
				c.SheetBase64, e = a.createConceptImageSized(ctx, key, repairPrompt, identityReference, "1536x768")
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
