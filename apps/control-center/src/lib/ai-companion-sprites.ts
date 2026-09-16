// Fixed-size cells and translation-only registration. No independently scaled
// poses, guessed body rigs or edits to the background.
export function registerCompanionFrames(frames: Uint8ClampedArray[], side = 80): Uint8ClampedArray[] {
  if (frames.length !== 8 || frames.some(p => p.length !== side * side * 4))
    throw new Error("A companion needs eight complete sprite frames.");
  const limit = Math.floor(side / 8), reference = frames[0];
  return frames.map((pixels, frame) => {
    let best = Infinity, shiftX = 0, shiftY = 0;
    for (let dy = -limit; dy <= limit; dy++) for (let dx = -limit; dx <= limit; dx++) {
      if (frame === 0 && (dx || dy)) continue;
      let score = 0, count = 0;
      for (let y = 4; y < side - 4; y += 2) for (let x = 4; x < side - 4; x += 2) {
        const a = (y * side + x) * 4;
        if (reference[a + 3] < 128) continue;
        count++;
        const xx = x - dx, yy = y - dy, b = (yy * side + xx) * 4;
        if (xx < 0 || yy < 0 || xx >= side || yy >= side || pixels[b + 3] < 128) { score++; continue; }
        score += Math.min(1, ((reference[a] - pixels[b]) ** 2 + (reference[a + 1] - pixels[b + 1]) ** 2 + (reference[a + 2] - pixels[b + 2]) ** 2) / 24000);
      }
      if (!count) throw new Error("The companion sprite is empty.");
      score = score / count + .0001 * (dx * dx + dy * dy);
      if (score < best) { best = score; shiftX = dx; shiftY = dy; }
    }
    const output = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const a = (y * side + x) * 4;
      if (!pixels[a + 3]) continue;
      const xx = x + shiftX, yy = y + shiftY;
      if (xx < 0 || yy < 0 || xx >= side || yy >= side)
        throw new Error("The generated companion needs more space around its poses. Your design is unchanged.");
      output.set(pixels.subarray(a, a + 4), (yy * side + xx) * 4);
    }
    return output;
  });
}

// Sample the matte where the prompt guarantees empty padding, then remove only
// matching pixels connected to that padding. Never flood via neighbor-to-neighbor
// color differences: that can walk through a gradient into the character.
export function removeCompanionBackground(input: Uint8ClampedArray, side: number, frame: number): Uint8ClampedArray {
  if (input.length !== side * side * 4 || side < 2) throw new Error("Invalid companion frame dimensions.");
  const pixels = input.slice();
  const edges: number[] = [];
  for (let x = 0; x < side; x++) edges.push(x, (side - 1) * side + x);
  for (let y = 1; y < side - 1; y++) edges.push(y * side, y * side + side - 1);
  const alphaEdge = edges.filter(p => pixels[p * 4 + 3] < 128).length / edges.length;
  const rgb = [0, 1, 2].map(channel => {
    const values = edges.map(p => pixels[p * 4 + channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
  const background = alphaEdge >= .95 ? "alpha" : `#${rgb.map(c => c.toString(16).padStart(2, "0")).join("")}`;
  const fail = (reason: string, fraction?: number): never => {
    throw new Error(`Sprite frame ${frame + 1}: ${reason} (background ${background}${fraction === undefined ? "" : `, ${Math.round(fraction * 100)}% transparent`}). Your design is unchanged.`);
  };
  if (alphaEdge >= .95) {
    // Existing real transparency is authoritative, regardless of subject hue.
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] < 128) pixels.fill(0, i, i + 4);
  } else {
    // Accept variations of the specified matte, not arbitrary scenery/white
    // backgrounds. The broad hue check applies ONLY to the sampled border.
    if (rgb[0] < 120 || rgb[2] < 120 || Math.min(rgb[0], rgb[2]) - rgb[1] < 50)
      fail("no recognizable transparent or magenta background");
    const matches = (p: number) => pixels[p * 4 + 3] < 128 || rgb.every((c, channel) => Math.abs(pixels[p * 4 + channel] - c) <= 24);
    if (edges.filter(matches).length / edges.length < .95) fail("background is not uniform or the subject touches the frame edge");
    const seen = new Uint8Array(side * side);
    const queue: number[] = [];
    const visit = (p: number) => {
      if (seen[p]) return;
      seen[p] = 1;
      if (matches(p)) queue.push(p);
    };
    edges.forEach(visit);
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head], x = p % side;
      if (x > 0) visit(p - 1);
      if (x < side - 1) visit(p + 1);
      if (p >= side) visit(p - side);
      if (p < side * (side - 1)) visit(p + side);
    }
    for (const p of queue) pixels.fill(0, p * 4, p * 4 + 4);
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] < 128) pixels.fill(0, i, i + 4);
  }
  let transparent = 0;
  for (let i = 3; i < pixels.length; i += 4) if (!pixels[i]) transparent++;
  const fraction = transparent / (side * side);
  if (fraction < .1 || fraction > .98) fail("no usable transparent background or subject", fraction);
  return pixels;
}

export function normalizeCompanionSheet(bitmap: ImageBitmap, size: number): Uint8ClampedArray[] {
  if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.width !== bitmap.height * 2)
    throw new Error("The companion sheet must use a 4-column, 2-row grid of square frames. Your design is unchanged.");
  const side = 80;
  const frames = Array.from({ length: 8 }, (_, frame) => {
    const canvas = document.createElement("canvas"); canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Image preparation is unavailable.");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, frame % 4 * bitmap.width / 4, Math.floor(frame / 4) * bitmap.height / 2, bitmap.width / 4, bitmap.height / 2, 0, 0, side, side);
    return removeCompanionBackground(ctx.getImageData(0, 0, side, side).data, side, frame);
  });
  return registerCompanionFrames(frames, side).map(pixels => {
    const output = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (Math.floor(y * side / size) * side + Math.floor(x * side / size)) * 4;
      output.set(pixels.subarray(i, i + 4), (y * size + x) * 4);
    }
    return output;
  });
}
