#!/usr/bin/env node
// Encode approved native pixels, keeping existing working/idle source assets exact.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(
  path.join(root, "apps/control-center/package.json"),
);
const sharp = require("sharp");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const keys = ["idle", "coding", "needs_you", "done", "error"];
function decode(text) {
  const lines = text.trim().split("\n"),
    animated = lines.shift() === "CBA1";
  const [w, h, count = 1, fps = 0] = lines.shift().split(" ").map(Number),
    n = Number(lines.shift());
  const palette = lines.splice(0, n);
  const pixels = [];
  for (const row of lines)
    for (const m of row.matchAll(/(\d*)([a-z])/g))
      pixels.push(
        ...Array(Number(m[1] || 1)).fill(palette[m[2].charCodeAt(0) - 97]),
      );
  assert.equal(pixels.length, w * h * (animated ? count : 1));
  return {
    w,
    h,
    fps,
    frames: Array.from({ length: animated ? count : 1 }, (_, i) =>
      pixels.slice(i * w * h, (i + 1) * w * h),
    ),
  };
}
function encode(w, h, frames, fps, orderedPalette) {
  const palette = orderedPalette || [...new Set(frames.flat().filter((color) => color !== "."))];
  assert(palette.length <= 26);
  const rows = [];
  for (const frame of frames)
    for (let y = 0; y < h; y++) {
      let row = "";
      for (let x = 0; x < w; ) {
        let n = 1;
        while (x + n < w && frame[y * w + x + n] === frame[y * w + x]) n++;
        const color = frame[y * w + x];
        row +=
          (n > 1 ? String(n) : "") +
          (color === "."
            ? "."
            : String.fromCharCode(97 + palette.indexOf(color)));
        x += n;
      }
      rows.push(row);
    }
  return [
    frames.length > 1 ? "CBA1" : "CBI1",
    `${w} ${h}${frames.length > 1 ? ` ${frames.length} ${fps}` : ""}`,
    String(palette.length),
    ...palette,
    ...rows,
    "",
  ].join("\n");
}
function crop(frame, width, x, y, w, h) {
  return Array.from({ length: h }, (_, r) =>
    frame.slice((y + r) * width + x, (y + r) * width + x + w),
  ).flat();
}
async function pngFrames(theme, state, count, w, h) {
  const raws = [];
  for (let i = 0; i < count; i++) {
    const { data, info } = await sharp(
      path.join(root, `docs/assets/agent-states/${theme}/${state}-${i}.png`),
    )
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, w);
    assert.equal(info.height, h);
    raws.push(data);
  }
  return paletteFrames(raws, w, h);
}
async function paletteFrames(raws, w, h) {
  const count = raws.length;
  // One palette across the whole loop, no dithering or grid resampling.
  const indexed = await sharp(Buffer.concat(raws), {
    raw: { width: w, height: h * count, channels: 3 },
  })
    .png({ palette: true, colours: 26, dither: 0, effort: 10 })
    .toBuffer();
  const data = await sharp(indexed).removeAlpha().raw().toBuffer();
  const pixels = Array.from(
    { length: w * h * count },
    (_, i) =>
      "#" +
      data
        .subarray(i * 3, i * 3 + 3)
        .toString("hex")
        .toUpperCase(),
  );
  return Array.from({ length: count }, (_, i) =>
    pixels.slice(i * w * h, (i + 1) * w * h),
  );
}
async function clawdTankFrames(name) {
  const source = await readFile(
    path.join(root, `docs/assets/agent-states/claude-creature/clawd-tank/sprite_${name}.h`),
    "utf8",
  );
  const define = (field) => Number(
    source.match(new RegExp(`#define ${name.toUpperCase()}_${field}\\s+(0x[0-9A-Fa-f]+|\\d+)`))?.[1],
  );
  const numbers = (field) => {
    const block = source.match(new RegExp(`${name}_${field}\\[[^\\]]*\\] = \\{([\\s\\S]*?)\\};`))?.[1];
    assert(block, `Missing ${name}_${field}`);
    return [...block.matchAll(/0x[0-9A-Fa-f]+|\d+/g)].map(([value]) => Number(value));
  };
  const width = define("WIDTH"), height = define("HEIGHT");
  const count = define("FRAME_COUNT"), transparent = define("TRANSPARENT_KEY");
  const offsets = numbers("frame_offsets"), data = numbers("rle_data");
  assert.equal(offsets.length, count + 1);
  assert.equal(offsets.at(-1), data.length);
  const raws = [];
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let frame = 0; frame < count; frame++) {
    const rgb = Buffer.alloc(width * height * 3);
    let pixel = 0;
    for (let index = offsets[frame]; index < offsets[frame + 1]; index += 2) {
      const color = data[index], length = data[index + 1];
      const red = color === transparent ? 0 : Math.round(((color >> 11) & 31) * 255 / 31);
      const green = color === transparent ? 0 : Math.round(((color >> 5) & 63) * 255 / 63);
      const blue = color === transparent ? 0 : Math.round((color & 31) * 255 / 31);
      for (let run = 0; run < length; run++, pixel++) {
        const x = pixel % width, y = Math.floor(pixel / width);
        if (color !== transparent) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        rgb[pixel * 3] = red;
        rgb[pixel * 3 + 1] = green;
        rgb[pixel * 3 + 2] = blue;
      }
    }
    assert.equal(pixel, width * height, `${name} frame ${frame}`);
    raws.push(rgb);
  }
  // One crop for the entire authored motion, preserving every visible pixel.
  const bounds = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const fitted = await Promise.all(raws.map((rgb) =>
    sharp(rgb, { raw: { width, height, channels: 3 } })
      .extract(bounds)
      .resize(77, 77, { fit: "contain", kernel: "nearest", background: "#000000" })
      .raw()
      .toBuffer(),
  ));
  const frames = await paletteFrames(fitted, 77, 77);
  const background = frames[0][0];
  return frames.map((frame) => frame.map((color) => color === background ? "#000000" : color));
}
async function clippyFrames(name, count) {
  const side = 74;
  const source = path.join(root, `docs/assets/agent-states/clippy/${name}.png`);
  const { data: rgba, info } = await sharp(source)
    .resize(count * side, side, { kernel: "nearest" })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const metadata = await sharp(source).metadata();
  assert.equal(metadata.width, count * side * 2);
  assert.equal(metadata.height, side * 2);
  const rgb = Buffer.alloc(info.width * info.height * 3);
  const visible = Buffer.alloc(info.width * info.height);
  const background = [0xC6, 0xC3, 0xBD];
  for (let pixel = 0; pixel < visible.length; pixel++) {
    const alpha = rgba[pixel * 4 + 3];
    visible[pixel] = alpha > 0 ? 1 : 0;
    for (let channel = 0; channel < 3; channel++)
      rgb[pixel * 3 + channel] = Math.round(
        (rgba[pixel * 4 + channel] * alpha + background[channel] * (255 - alpha)) / 255,
      );
  }
  const indexed = await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png({ palette: true, colours: 26, dither: 0, effort: 10 }).toBuffer();
  const quantized = await sharp(indexed).removeAlpha().raw().toBuffer();
  const palette = [];
  for (let index = 0; index < visible.length; index++) {
    if (!visible[index]) continue;
    const color = `#${quantized.subarray(index * 3, index * 3 + 3).toString("hex").toUpperCase()}`;
    if (!palette.includes(color)) palette.push(color);
  }
  const frames = Array.from({ length: count }, (_, frame) => Array.from({ length: side * side }, (_, pixel) => {
    const x = frame * side + pixel % side, y = Math.floor(pixel / side);
    const index = y * info.width + x;
    return visible[index]
      ? `#${quantized.subarray(index * 3, index * 3 + 3).toString("hex").toUpperCase()}`
      : ".";
  }));
  return { frames, palette };
}
async function finish(id, spec, version, generated) {
  const dir = path.join(root, "theme-packs", id),
    manifest = JSON.parse(await readFile(path.join(dir, "manifest.json")));
  const raw = JSON.stringify(spec) + "\n";
  assert(Buffer.byteLength(raw) <= 4096);
  await writeFile(path.join(dir, "theme.json"), raw);
  for (const [name, data] of Object.entries(generated))
    await writeFile(path.join(dir, "assets", name), data);
  const refs = new Set(
    spec.p
      .flatMap((p) => [
        p.a,
        ...Object.values(p.sa || {}),
        ...Object.values(p.pa || {}),
      ])
      .filter(Boolean),
  );
  const assets = [];
  for (const ref of refs) {
    const name = path.basename(ref),
      file =
        manifest.assets.find((a) => a.path === ref)?.file || `assets/${name}`,
      data = await readFile(path.join(dir, file));
    assets.push({
      path: ref,
      file,
      bytes: data.length,
      sha256: hash(data),
      contentType: name.endsWith(".gif") ? "image/gif" : "text/plain",
    });
  }
  manifest.version = version;
  if (spec.p.some((p) => p.va && p.va !== "top")) {
    manifest.minFirmware = "1.0.42";
    manifest.requiredCapabilities = [
      ...new Set([...(manifest.requiredCapabilities || []), "text-valign-v1"]),
    ];
  }
  manifest.requiredCapabilities = [
    ...new Set([
      ...(manifest.requiredCapabilities || []),
      "agent-theme-states-v1",
    ]),
  ];
  manifest.themeSpec = {
    path: `/themes/u/${{ "tiny-office": "to", "mini-classic": "mini-cl", "claude-creature": "claude", clippy: "clippy", synthwave: "synthwa", "pixel-battery": "pba" }[id]}-${spec.rev}-${hash(raw).slice(0, 6)}.json`,
    file: "theme.json",
    bytes: Buffer.byteLength(raw),
    sha256: hash(raw),
    contentType: "application/json",
  };
  manifest.assets = assets;
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `${id}: ${Buffer.byteLength(raw)} bytes, ${spec.p.length} primitives, ${assets.length} assets`,
  );
}
// Tile the entire scene into 80x54 draw boxes. Static tiles stay CBI; motion
// tiles share one RGB565 buffer. Original baseline pixels and cadence survive.
const officeDir = path.join(root, "theme-packs/tiny-office");
const office = JSON.parse(await readFile(path.join(officeDir, "theme.json")));
const scenes = {};
for (const [key, baseName, animName] of [
  ["idle", "to-i.cbi", "to-ia.cba"],
  ["coding", "to-c.cbi", "to-ca.cba"],
]) {
  const base = decode(
    await readFile(path.join(officeDir, "assets", baseName), "utf8"),
  );
  const anim = decode(
    await readFile(path.join(officeDir, "assets", animName), "utf8"),
  );
  const frames = anim.frames.map((f) => {
    const out = base.frames[0].slice();
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 40; x++) out[(y + 8) * 120 + x + 40] = f[y * 40 + x];
    return out;
  });
  scenes[key] = { frames, fps: anim.fps };
}
for (const [key, name, count, fps] of [
  ["needs_you", "needs", 2, 2],
  ["done", "finished", 3, 2],
  ["error", "error", 3, 3],
])
  scenes[key] = {
    frames: await pngFrames("tiny-office", name, count, 120, 54),
    fps,
  };
const generated = {},
  tiles = [];
for (let row = 0; row < 2; row++)
  for (let col = 0; col < 3; col++) {
    const sa = {};
    for (const key of keys) {
      let frames = scenes[key].frames.map((f) =>
        crop(f, 120, col * 40, row * 27, 40, 27),
      );
      if (frames.every((f) => f.every((c, i) => c === frames[0][i])))
        frames = frames.slice(0, 1);
      const name = `to-${key === "needs_you" ? "n" : key[0]}${row * 3 + col}.${frames.length > 1 ? "cba" : "cbi"}`;
      generated[name] = encode(40, 27, frames, scenes[key].fps);
      sa[key] = `/themes/u/${name}`;
      // Conversion of approved baseline art must be lossless.
      if (key === "idle" || key === "coding")
        assert.deepEqual(decode(generated[name]).frames, frames);
    }
    tiles.push({
      t: "sp",
      x: col * 80,
      y: 20 + row * 54,
      w: 80,
      h: 54,
      bg: "#0E0C1E",
      sa,
    });
  }
office.p = office.p.filter(
  (p) => p.t !== "sp" || p.a === "/themes/u/to-bg.cbi",
);
office.p.splice(3, 0, ...tiles);
office.rev = 8;
await finish("tiny-office", office, "0.7.0", generated);
const mini = JSON.parse(
  await readFile(path.join(root, "theme-packs/mini-classic/theme.json")),
);
mini.p = mini.p.filter(
  (p) => !p.a?.startsWith("/themes/u/mi-") || p.a === "/themes/u/mi-eyes.cba",
);
mini.rev = 9;
const props = {},
  sa = { idle: "/themes/u/mi-blank.cbi" };
props["mi-blank.cbi"] = encode(1, 1, [["#000000"]], 0);
for (const [key, name, repeats] of [
  ["coding", "working", 11],
  ["needs_you", "needs", 9],
  ["done", "finished", 13],
  ["error", "error", 12],
]) {
  const frames = await pngFrames("mini", name, 2, 32, 32),
    asset = `mi-${name}.cba`;
  props[asset] = encode(
    32,
    32,
    frames.flatMap((f) => Array(repeats).fill(f)),
    20,
  );
  sa[key] = `/themes/u/${asset}`;
}
const eyes = mini.p.find(
  (p) => p.t === "gif" || p.t === "g" || p.a === "/themes/u/mi-eyes.cba",
);
assert(eyes);
// A GIF decoder plus the 64x64 prop buffer exhausts the ESP8266 heap.
// Use the existing eye artwork in the shared CBA renderer instead. The
// original 14-second loop becomes 56 frames at 4 fps, within CBA's 64 limit.
const eyeGif = sharp(path.join(root, "theme-packs/mini-classic/assets/mini.gif"), {
  animated: true,
});
const eyeMeta = await eyeGif.metadata();
const eyeRaw = await eyeGif
  .flatten({ background: "#000000" })
  .removeAlpha()
  .raw()
  .toBuffer();
const eyeDuration = eyeMeta.delay.reduce((sum, delay) => sum + delay, 0);
const eyeFrames = [];
for (let ms = 125; ms < eyeDuration; ms += 250) {
  let index = 0,
    end = eyeMeta.delay[0];
  while (end <= ms && index + 1 < eyeMeta.pages) end += eyeMeta.delay[++index];
  const start = index * eyeMeta.width * eyeMeta.pageHeight * 3;
  eyeFrames.push(
    await sharp(
      eyeRaw.subarray(start, start + eyeMeta.width * eyeMeta.pageHeight * 3),
      { raw: { width: eyeMeta.width, height: eyeMeta.pageHeight, channels: 3 } },
    )
      .resize(40, 40, { kernel: "nearest" })
      .raw()
      .toBuffer(),
  );
}
assert(eyeFrames.length <= 64);
props["mi-eyes.cba"] = encode(40, 40, await paletteFrames(eyeFrames, 40, 40), 4);
Object.assign(eyes, {
  t: "sp",
  a: "/themes/u/mi-eyes.cba",
  x: 62,
  y: 140,
  w: 40,
  h: 40,
  bg: "#000000",
});
mini.p.push({
  t: "sp",
  x: 114,
  y: 128,
  w: 64,
  h: 64,
  bg: "#000000",
  a: sa.idle,
  sa,
});
await finish("mini-classic", mini, "1.2.2", props);

// Keep the original animated Creature poses for idle and coding. The three
// additional states use authored clawd-tank RLE frames and cadence.
const creature = JSON.parse(
  await readFile(path.join(root, "theme-packs/claude-creature/theme.json")),
);
const creatureAssets = {},
  creatureStates = {
    idle: "/themes/u/cld-i.cba",
    coding: "/themes/u/cld-c.cba",
  };
for (const [key, name, fps] of [
  ["needs_you", "alert", 10],
  ["done", "happy", 10],
  ["error", "dizzy", 8],
]) {
  const frames = await clawdTankFrames(name);
  const file = `cld-${key === "needs_you" ? "n" : key[0]}4.cba`;
  creatureAssets[file] = encode(77, 77, frames, fps);
  creatureStates[key] = `/themes/u/${file}`;
}
const creatureSprite = creature.p.find((p) => p.t === "sp");
creatureSprite.a = creatureStates.idle;
creatureSprite.sa = creatureStates;
creature.rev = 10;
await finish("claude-creature", creature, "1.3.3", creatureAssets);

const clippy = JSON.parse(
  await readFile(path.join(root, "theme-packs/clippy/theme.json")),
);
const clippySprite = clippy.p.find((primitive) => primitive.t === "sp" && primitive.sa);
assert(clippySprite);
clippySprite.a = "/themes/u/cp-i6.cba";
clippySprite.sa = {
  idle: "/themes/u/cp-i6.cba",
  coding: "/themes/u/cp-c6.cba",
  needs_you: "/themes/u/cp-n6.cba",
  done: "/themes/u/cp-d6.cba",
  error: "/themes/u/cp-e6.cba",
};
clippy.rev = 6;
const clippyAssets = {};
for (const [source, file, count, fps] of [
  ["asleep", "cp-i6.cba", 10, 3],
  ["working", "cp-c6.cba", 8, 7],
  ["needs", "cp-n6.cba", 8, 8],
  ["finished", "cp-d6.cba", 10, 7],
  ["error", "cp-e6.cba", 9, 5],
]) {
  const { frames, palette } = await clippyFrames(source, count);
  clippyAssets[file] = encode(74, 74, frames, fps, palette);
}
await finish("clippy", clippy, "1.2.0", clippyAssets);

// The existing synthwave heading uses font 4 at its minimum size. Use font 2
// inside the same 198x23 slot so lifecycle text can fit without clipping.
const synthwave = JSON.parse(
  await readFile(path.join(root, "theme-packs/synthwave/theme.json")),
);
Object.assign(
  synthwave.p.find((p) => p.b === "l"),
  { f: 2, s: 1, h: 23, va: "middle" },
);
synthwave.rev = 6;
await finish("synthwave", synthwave, "1.2.0", {});

// Use four pixels of the existing empty right margin for long source names.
const battery = JSON.parse(
  await readFile(path.join(root, "theme-packs/pixel-battery/theme.json")),
);
battery.p.find((p) => p.b === "l").w = 160;
battery.rev = 17;
await finish("pixel-battery", battery, "1.17.0", {});
