import { afterEach, expect, it, vi } from "vitest";
import { normalizeCompanionSheet, removeCompanionBackground } from "./ai-companion-sprites";

afterEach(() => vi.unstubAllGlobals());

function sheet(subject: number[], background = [255, 0, 255, 255], edit?: (pixels: Uint8ClampedArray) => void) {
  const pixels = new Uint8ClampedArray(80 * 80 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(background, i);
  for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) pixels.set(subject, (y * 80 + x) * 4);
  edit?.(pixels);
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({
    drawImage: () => {}, getImageData: () => ({ data: pixels.slice() }),
  }) }) });
  return { width: 320, height: 160 } as ImageBitmap;
}

it.each([[255, 80, 180, 255], [190, 60, 190, 255]])("keeps pink and purple subjects opaque", (...color) => {
  const frames = normalizeCompanionSheet(sheet(color), 40);
  expect(Array.from(frames[0].slice((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 4))).toEqual(color);
  expect(frames[0][3]).toBe(0);
});

it.each([[240, 45, 229, 255], [201, 22, 219, 255], [250, 70, 230, 255]])("recognizes the actual magenta backdrop instead of a fixed RGB cutoff", (...background) => {
  const frames = normalizeCompanionSheet(sheet([255, 80, 180, 255], background), 40);
  expect(frames[0][3]).toBe(0);
  expect(Array.from(frames[0].slice((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 4))).toEqual([255, 80, 180, 255]);
});

it("does not erase enclosed foreground details even when they equal the background color", () => {
  const frames = normalizeCompanionSheet(sheet([20, 20, 20, 255], undefined, pixels => {
    for (let y = 25; y < 55; y++) for (let x = 25; x < 55; x++) pixels.set([255, 0, 255, 255], (y * 80 + x) * 4);
  }), 40);
  expect(Array.from(frames[0].slice((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 4))).toEqual([255, 0, 255, 255]);
});

it("rejects a nonuniform edge instead of guessing a background", () => {
  expect(() => normalizeCompanionSheet(sheet([20, 20, 20, 255], undefined, pixels => {
    for (let y = 0; y < 80; y++) for (let x = 0; x < 20; x++) pixels.set([0, 150, 80, 255], (y * 80 + x) * 4);
  }), 40)).toThrow();
});

it("reports the failing frame and measured background for an unusable sheet", () => {
  expect(() => normalizeCompanionSheet(sheet([255, 0, 255, 255]), 40)).toThrow(/frame 1.*background/i);
});

it("tolerates small matte noise without leaving an opaque fringe", () => {
  const frames = normalizeCompanionSheet(sheet([255, 90, 170, 255], [240, 45, 229, 255], pixels => {
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
      if (x >= 20 && x < 60 && y >= 20 && y < 60) continue;
      const noise = (x * 3 + y * 7) % 11 - 5;
      pixels.set([240 + noise, 45 + noise, 229 + noise, 255], (y * 80 + x) * 4);
    }
  }), 40);
  expect(frames[0].filter((_, i) => i % 4 === 3 && frames[0][i] > 0)).toHaveLength(400);
});

it("never walks through a color gradient into the subject and never mutates source pixels", () => {
  const pixels = new Uint8ClampedArray(20 * 20 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([240, 45, 229, 255], i);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) pixels.set([240, 65 + (x - 5) * 10, 229, 255], (y * 20 + x) * 4);
  const before = pixels.slice();
  const result = removeCompanionBackground(pixels, 20, 0);
  expect(result[(10 * 20 + 10) * 4 + 3]).toBe(255);
  expect(result[(10 * 20 + 5) * 4 + 3]).toBe(0);
  expect(pixels).toEqual(before);
});

it("never keeps an unusable frame: it repeats the neighbouring clean pose instead of failing the design", () => {
  const good = new Uint8ClampedArray(80 * 80 * 4);
  for (let i = 0; i < good.length; i += 4) good.set([240, 45, 229, 255], i);
  for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) good.set([80, 40, 20, 255], (y * 80 + x) * 4);
  let frame = 0;
  vi.stubGlobal("document", {createElement: () => ({getContext: () => ({
    drawImage: () => {}, getImageData: () => ({data: ++frame === 6 ? new Uint8ClampedArray(good.length) : good.slice()}),
  })})});
  const frames = normalizeCompanionSheet({width:320, height:160} as ImageBitmap, 40);
  expect(frames).toHaveLength(8);
  expect(frames[5]).toEqual(frames[4]);
  expect(frames[5].filter((_, i) => i % 4 === 3 && frames[5][i] > 0)).toHaveLength(400);
});

it("rejects a wrong sheet aspect ratio instead of cutting through poses", () => {
  const bitmap = sheet([20, 30, 40, 255]);
  expect(() => normalizeCompanionSheet({...bitmap, width:160} as ImageBitmap, 40)).toThrow(/4.column.*2.row/i);
});

it("preserves magenta subject pixels when the sheet already has real transparency", () => {
  const frames = normalizeCompanionSheet(sheet([255, 0, 255, 255], [0, 0, 0, 0]), 40);
  expect(frames[0][(20 * 40 + 20) * 4 + 3]).toBe(255);
});

it("still rejects opaque backgrounds and empty sheets", () => {
  expect(() => normalizeCompanionSheet(sheet([20, 30, 40, 255], [255, 255, 255, 255]), 40)).toThrow(/transparent/);
  expect(() => normalizeCompanionSheet(sheet([255, 0, 255, 255]), 40)).toThrow(/transparent/);
});

// Paul's Mac test 2026-10-16: a pose whose body sits lower in its cell while an
// arm reaches up. Aligning the body to frame 1 would push the arm out of the
// cell, and the whole design used to fail with "needs more space around its poses".
function stubFrames(frames: Uint8ClampedArray[]) {
  let frame = 0;
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({
    drawImage: () => {}, getImageData: () => ({ data: frames[frame++ % frames.length].slice() }),
  }) }) });
  return { width: 320, height: 160 } as ImageBitmap;
}

function pose(bodyTop: number, armTop?: number) {
  const pixels = new Uint8ClampedArray(80 * 80 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([255, 0, 255, 255], i);
  for (let y = bodyTop; y < bodyTop + 40; y++) for (let x = 20; x < 60; x++) pixels.set([80, 40, 20, 255], (y * 80 + x) * 4);
  if (armTop !== undefined) for (let y = armTop; y < bodyTop; y++) for (let x = 30; x < 34; x++) pixels.set([80, 40, 20, 255], (y * 80 + x) * 4);
  return pixels;
}

const opaque = (pixels: Uint8ClampedArray) => pixels.filter((_, i) => i % 4 === 3 && pixels[i] > 0).length;

it("keeps a pose that cannot be fully aligned inside its cell instead of failing the design", () => {
  const raised = pose(28, 2);
  const frames = normalizeCompanionSheet(stubFrames([pose(20), ...Array.from({ length: 7 }, () => raised)]), 80);
  expect(frames).toHaveLength(8);
  for (const frame of frames.slice(1)) {
    expect(opaque(frame)).toBe(40 * 40 + 4 * 26);
    expect(frame[(0 * 80 + 31) * 4 + 3]).toBe(255);
    expect(frame[(65 * 80 + 40) * 4 + 3]).toBe(255);
    expect(frame[(66 * 80 + 40) * 4 + 3]).toBe(0);
  }
});

it("still aligns a shifted pose exactly when the cell has room", () => {
  const frames = normalizeCompanionSheet(stubFrames([pose(20), ...Array.from({ length: 7 }, () => pose(28))]), 80);
  for (const frame of frames) expect(frame).toEqual(frames[0]);
});

// The "Sprite frame N: …" errors stopped a design when the AI drew a single cell
// with scenery behind the subject. That cell now repeats the clean pose before it.
it("replaces a frame drawn on scenery with the pose before it in the loop", () => {
  const scenery = pose(20);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 20; x++) scenery.set([0, 150, 80, 255], (y * 80 + x) * 4);
  const poses = [scenery, pose(22), pose(24), scenery, pose(26), pose(26), pose(24), pose(22)];
  expect(() => removeCompanionBackground(scenery, 80, 0)).toThrow(/Sprite frame 1/);
  const frames = normalizeCompanionSheet(stubFrames(poses), 80);
  expect(frames).toHaveLength(8);
  expect(frames[0]).toEqual(frames[7]);
  expect(frames[3]).toEqual(frames[2]);
  for (const frame of frames) expect(opaque(frame)).toBe(40 * 40);
});
