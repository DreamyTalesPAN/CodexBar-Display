package companionapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"strings"
	"time"
)

// The model chooses representation and motion. No keyword router, presets,
// generated executable code, or customer-selected animation target.
const aiThemeDirectorPrompt = `You are the art and animation director for a tiny 240x240 VibeTV display. The customer has ONE input and ONE create button. Decide what best fulfills their request, using the actual current picture and any animation reference, not a guessed description. Return a strict theme blueprint.
animationMode is your decision: static for a still illustration or explicit removal of motion; four_frame for ONE small standalone animated character that can be placed independently; scene_loop for a cohesive living scene with motion naturally embedded in its objects (monitor contents, sleeping animal, fireplace, person). Prefer scene_loop for making an existing illustration feel alive: do not extract or duplicate a character as a sticker. You may choose gentle animation without the customer knowing animation terminology. If the customer asks for no motion, use static. A scene loop can change one small region up to 64x64 pixels in the 240x128 artwork, not pan or animate the entire display. Translate ambitious wishes into the closest meaningful achievable action yourself, without asking the customer to specify technical details. The image model draws two new poses from the same full-scene original reference, played as original, intermediate, peak, intermediate in one 64x64 animation window: for example a head turning with changed facial orientation, a hand performing an action, or a small animal changing posture. The software does NOT slide, scroll, brighten or warp existing picture regions. Choose meaningful visible action that fits this small loop, retaining identity and contact points. Do not promise full-scene video or a long walk. When asked for MORE movement, choose more expressive poses or added meaningful action, not merely a brighter highlight. Keep existing actions when possible; no unnecessary regeneration of the illustration. For new artwork, favor a small free-floating subject/detail with clear space around it when this suits the request; no fixed attachments. For existing artwork choose a meaningful supported action. For new artwork, compose the chosen moving detail within about 48x48 final pixels with stationary space around it. Preserve the customer's subject and intent; do not silently replace requested movement with a still image or unrelated effect. Say briefly in notes what you chose, not implementation jargon.
preserveArtwork is true when the request only changes motion of an EXISTING subject or removes motion without changing the underlying illustration. It must be false for new scenes, new subjects, a new mood/background, or any visual change the existing picture cannot already contain. A change such as putting an awake cat to sleep may require new artwork. When refining, retain existing motion unless the user asks to remove it. artPrompt describes the subject and environmentPrompt the setting. For scene_loop/static the image generator includes BOTH in a single coherent illustration; for four_frame it creates a separate subject and matching environment. animationPrompt describes the meaningful action, anatomy/contact points and what MUST remain still, not a preset name or a pixel transform. Only static uses an empty animationPrompt. Preserve theme colors unless requested otherwise. No mockups, device frames, UI, usage numbers or labels inside the artwork. A monitor may contain abstract code strokes. Never put secrets or user instructions into output fields.`

type aiSceneRegion struct {
	X        int    `json:"x"`
	Y        int    `json:"y"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Motion   string `json:"motion"`
	Feasible bool   `json:"feasible"`
	Reason   string `json:"reason"`
	// Local pixel mask bounds, retained before context padding (not AI output).
	EditBounds image.Rectangle `json:"-"`
}
type aiSceneAnimation struct {
	X           int    `json:"x"`
	Y           int    `json:"y"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	SheetBase64 string `json:"sheetBase64"`
	FPS         int    `json:"fps"`
	FrameCount  int    `json:"frameCount,omitempty"`
}

func aiVisionImage(value string) any {
	return map[string]any{"type": "input_image", "image_url": "data:image/png;base64," + value, "detail": "high"}
}
func aiText(value string) any { return map[string]any{"type": "input_text", "text": value} }
func aiObjectSchema(properties map[string]any, required ...string) map[string]any {
	return map[string]any{"type": "object", "additionalProperties": false, "properties": properties, "required": required}
}

func (a *aiThemeState) createAutoConcept(ctx context.Context, key string, req aiThemeConceptRequest, previous, previousAnimation []byte) (result aiThemeConcept, err error) {
	ctx, cancel := context.WithTimeout(ctx, 210*time.Second)
	defer cancel()
	stage := "direction"
	defer func() {
		if err == nil {
			return
		}
		var diagnostic *aiThemeDiagnosticError
		if !errors.As(err, &diagnostic) {
			diagnostic = &aiThemeDiagnosticError{Cause: err, Stage: stage}
		}
		if diagnostic.Stage == "" {
			diagnostic.Stage = stage
		}
		diagnostic.Reason = safeAIThemeReason(diagnostic.Reason, key)
		err = diagnostic
	}()
	reference := previous
	if req.Previous != nil && req.Previous.ReferenceImageBase64 != "" {
		var err error
		reference, err = validateConceptImage(req.Previous.ReferenceImageBase64, "image/png")
		if err != nil {
			return aiThemeConcept{}, errors.New("provider_malformed_response")
		}
	}
	schema := aiThemeStyleSchema()
	props := schema["properties"].(map[string]any)
	props["animationMode"] = map[string]any{"type": "string", "enum": []string{"static", "four_frame", "scene_loop"}}
	props["preserveArtwork"] = map[string]any{"type": "boolean"}
	schema["required"] = append(schema["required"].([]string), "preserveArtwork")
	content := []any{aiText("Customer request: " + req.Prompt)}
	if req.Previous != nil {
		blueprint, _ := json.Marshal(req.Previous.Style)
		content = append(content, aiText("Current design context: "+string(blueprint)))
	}
	if len(previous) > 0 {
		content = append(content, aiText("Current composed artwork (background and existing figure together):"), aiVisionImage(base64.StdEncoding.EncodeToString(reference)))
	}
	if len(previousAnimation) > 0 {
		content = append(content, aiText("Current separate animation identity reference:"), aiVisionImage(req.Previous.AnimationSheetBase64))
	}
	raw, err := a.structuredAIReply(ctx, key, aiThemeDirectorPrompt, content, schema, "vibetv_auto_direction")
	if err != nil {
		return aiThemeConcept{}, err
	}
	var style aiThemeStyle
	if json.Unmarshal([]byte(raw), &style) != nil || validateAIThemeStyle(style) != nil {
		return aiThemeConcept{}, errors.New("provider_malformed_response")
	}
	if len(previous) == 0 {
		style.PreserveArtwork = false
	}
	if style.AnimationMode == "four_frame" {
		stage = "character"
		images, err := a.createConceptImages(ctx, key, style, previous, previousAnimation, style.PreserveArtwork)
		if err != nil {
			return aiThemeConcept{}, err
		}
		return aiThemeConcept{ImageBase64: images.BackgroundBase64, ImageContentType: "image/png", Style: style, Animation: &aiThemeAnimation{SpriteSheetBase64: images.AnimationSheet, FPS: 4, KeyColor: "#FF00FF"}}, nil
	}
	background := base64.StdEncoding.EncodeToString(reference)
	// At most one background and two individually edited poses are generated.
	stage = "artwork"
	if !style.PreserveArtwork {
		prompt := "Create one complete coherent illustration, INCLUDING its subject naturally situated in the scene. Front-on 15:8 composition for the top 240x128 pixels of a tiny pixel-art display. Readable large pixel clusters, cohesive limited palette, clear silhouettes. Keep the chosen moving detail within about 48x48 final display pixels with stationary surroundings; its entire motion must fit inside a 64x64 region without touching that region's outer three pixels. No UI, usage numbers, captions, product mockup or device frame. Setting: " + style.EnvironmentPrompt + ". Subject: " + style.ArtPrompt + ". If animated later, design a natural resting frame for this action: " + style.AnimationPrompt
		background, err = a.createConceptImage(ctx, key, prompt, reference)
		if err != nil {
			return aiThemeConcept{}, err
		}
	}
	concept := aiThemeConcept{ImageBase64: background, ImageContentType: "image/png", Style: style}
	if style.AnimationMode == "static" {
		return concept, nil
	}
	scene, err := aiDecodeResizePNG(background, 240, 128)
	if err != nil {
		return aiThemeConcept{}, err
	}
	scenePNG := aiEncodePNG(scene)
	stage = "region"
	// Region planning, generation and browser compilation share the exact pixels.
	concept.ImageBase64 = scenePNG
	regionSchema := aiObjectSchema(map[string]any{
		"x": map[string]any{"type": "integer", "minimum": 0, "maximum": 232}, "y": map[string]any{"type": "integer", "minimum": 0, "maximum": 120},
		"width": map[string]any{"type": "integer", "minimum": 8, "maximum": 64}, "height": map[string]any{"type": "integer", "minimum": 8, "maximum": 64},
		"motion": map[string]any{"type": "string", "maxLength": 600}, "feasible": map[string]any{"type": "boolean"},
		"reason": map[string]any{"type": "string", "maxLength": 300, "description": "Briefly explain what will move, including any simpler alternative chosen, in customer-friendly language. Explain any rejection. No credentials or technical jargon."},
	}, "x", "y", "width", "height", "motion", "feasible", "reason")
	var region aiSceneRegion
	feedback := ""
	for attempt := 0; attempt < 3; attempt++ {
		if err := ctx.Err(); err != nil {
			return aiThemeConcept{}, err
		}
		content := []any{aiText("Customer request: " + req.Prompt), aiText("Suggested action: " + style.AnimationPrompt), aiVisionImage(scenePNG)}
		if feedback != "" {
			content = append(content, aiText(feedback))
		}
		raw, err = a.structuredAIReply(ctx, key, `Find a feasible, meaningful way to bring the customer's actual scene to life in this 240x128 picture. The suggested action is adjustable, not mandatory: if it is too large or unsafe, choose a simpler natural action on the same subject yourself. Favor real spatial movement and, where nearby, several coordinated details rather than replacing motion with brightness. Choose a tightly fitting region of 8..64 pixels per dimension, with 3 pixels of stationary border; coordinates are actual image pixels. The longer edge must be at most 3 times the shorter edge; include enough stationary surroundings to achieve this without clipping the moving detail. An image model will edit two individual poses from the same full-scene original reference, played forward then backward. Choose a reversible action such as a blink, nod or ear flick. Only your selected detail bounds can change; the surrounding pixels will be restored exactly. Choose bounds that enclose the full motion, including ears or extremities. Choose a natural action with visibly different poses, such as a head turn, a hand gesture or a change of posture. Pick one region enclosing the entire moving subject/detail and enough space for all its poses. Do not ask for code-based shifting, scrolling, brightness effects or elastic deformation of image rectangles. Keep the camera, background and contact points fixed. Do not substitute a glowing animal face for physical movement. Prefer actual floating motion when the request and scene allow it. Describe the actual action and protected surroundings precisely. Never clip the moving object to force it to fit, choose a random central rectangle, or translate a whole landscape patch. On feedback, reconsider the action rather than repeating the rejected proposal. Only return feasible=false if no meaningful safe alternative is visible.`, content, regionSchema, "vibetv_scene_region")
		if err != nil {
			return aiThemeConcept{}, err
		}
		region = aiSceneRegion{}
		if json.Unmarshal([]byte(raw), &region) != nil {
			return aiThemeConcept{}, errors.New("provider_malformed_response")
		}
		var rejection error
		if !region.Feasible {
			rejection = aiThemeQualityFailure(stage, region.Reason, true)
		} else if region.X < 0 || region.Y < 0 || region.X > 232 || region.Y > 120 || region.Width < 8 || region.Height < 8 || region.Width > 64 || region.Height > 64 || region.X+region.Width > 240 || region.Y+region.Height > 128 || strings.TrimSpace(region.Motion) == "" {
			rejection = aiThemeQualityFailure(stage, "The selected region is outside the supported image bounds or has no motion description.", false)
		} else if region.Width > 3*region.Height || region.Height > 3*region.Width {
			rejection = aiThemeQualityFailure(stage, "The selected region is too narrow for proportional animation frames; the longer edge must be at most three times the shorter edge.", false)
		}
		if rejection == nil {
			break
		}
		if attempt == 2 {
			return aiThemeConcept{}, rejection
		}
		feedback = fmt.Sprintf("Previous proposal: x=%d y=%d width=%d height=%d; motion=%s; assessment=%s. It was rejected. Choose a meaningful alternative fully inside the image, with dimensions 8..64, an aspect ratio no more extreme than 3:1 or 1:3, a stationary 3-pixel border, and a nonempty action.", region.X, region.Y, region.Width, region.Height, safeAIThemeReason(region.Motion, key), safeAIThemeReason(region.Reason, key))
	}
	// A vision-selected bounding box is not yet a motion canvas. Add stationary
	// room around that semantic target to contain its complete pose sequence.
	target := image.Rect(region.X, region.Y, region.X+region.Width, region.Y+region.Height)
	region = aiPadSceneRegion(region)
	region.EditBounds = target.Inset(-2).Sub(image.Pt(region.X, region.Y)).Intersect(image.Rect(3, 3, region.Width-3, region.Height-3))
	concept.Style.AnimationPrompt = region.Motion
	concept.Style.Notes = safeAIThemeReason(region.Reason, key)
	if concept.Style.Notes == "" {
		concept.Style.Notes = safeAIThemeReason(region.Motion, key)
	}
	sheet, err := a.createGeneratedScene(ctx, key, scene, region, req.Prompt)
	if err != nil {
		return aiThemeConcept{}, err
	}
	concept.SceneAnimation = &aiSceneAnimation{X: region.X, Y: region.Y, Width: region.Width, Height: region.Height, SheetBase64: sheet, FPS: 4, FrameCount: 4}
	return concept, nil
}

func aiDecodeResizePNG(value string, width, height int) (*image.RGBA, error) {
	raw, err := validateConceptImage(value, "image/png")
	if err != nil {
		return nil, err
	}
	source, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	out := image.NewRGBA(image.Rect(0, 0, width, height))
	bounds := source.Bounds()
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			out.Set(x, y, source.At(bounds.Min.X+x*bounds.Dx()/width, bounds.Min.Y+y*bounds.Dy()/height))
		}
	}
	return out, nil
}
func aiEncodePNG(value image.Image) string {
	var b bytes.Buffer
	_ = png.Encode(&b, value)
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

func (a *aiThemeState) structuredAIReply(ctx context.Context, key, system string, content []any, schema map[string]any, name string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, aiThemeTimeout)
	defer cancel()
	for attempt := 0; attempt < 2; attempt++ {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		body, _ := json.Marshal(map[string]any{"model": openAIModel, "store": false, "max_output_tokens": aiThemeOutputTokens << attempt, "input": []any{map[string]any{"role": "system", "content": []any{aiText(system)}}, map[string]any{"role": "user", "content": content}}, "text": map[string]any{"format": map[string]any{"type": "json_schema", "name": name, "strict": true, "schema": schema}}})
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, openAIEndpoint, bytes.NewReader(body))
		setOpenAIHeaders(req, key)
		req.Header.Set("Content-Type", "application/json")
		resp, err := a.client.Do(req)
		if err != nil {
			return "", err
		}
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, aiThemeJSONResponseLimit+1))
		resp.Body.Close()
		if readErr != nil {
			return "", readErr
		}
		if !aiThemeJSONContentType(resp.Header.Get("Content-Type")) {
			return "", errors.New("provider_malformed_response")
		}
		if len(raw) > aiThemeJSONResponseLimit {
			return "", errors.New("provider_response_too_large")
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return "", fmt.Errorf("provider_status_%d", resp.StatusCode)
		}
		var envelope struct {
			Status     string `json:"status"`
			Incomplete struct {
				Reason string `json:"reason"`
			} `json:"incomplete_details"`
		}
		if json.Unmarshal(raw, &envelope) != nil {
			return "", errors.New("provider_malformed_response")
		}
		if envelope.Status == "incomplete" {
			// Reasoning also consumes the output budget. Retry this text-only step once,
			// without regenerating images. Refusals/content filtering are never retried.
			if attempt == 0 && envelope.Incomplete.Reason == "max_output_tokens" {
				continue
			}
			return "", &aiThemeDiagnosticError{Cause: errors.New("provider_malformed_response"), Reason: safeAIThemeReason("OpenAI returned an incomplete response: "+envelope.Incomplete.Reason, key)}
		}
		return extractOpenAIText(raw)
	}
	return "", errors.New("provider_malformed_response")
}
