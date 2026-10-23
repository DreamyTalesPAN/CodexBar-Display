// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildFrameData, ThemeSpecPreview, type ThemeRenderPack } from "./live-vibetv-preview";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.useFakeTimers();
  vi.setSystemTime(0);
  // jsdom has no SVG layout; report no measurement so firmware metrics apply.
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true, value: () => Number.NaN,
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(SVGElement.prototype, "getComputedTextLength");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function imageDocument(image: Element) {
  const uri = image.getAttribute("href")!;
  return new DOMParser().parseFromString(decodeURIComponent(uri.slice(uri.indexOf(",") + 1)), "image/svg+xml");
}

it("keeps a detailed background out of the live DOM while cycling cached transparent frames", () => {
  const pack: ThemeRenderPack = {
    spec: { primitives: [
      { type: "sprite", assetPath: "background", width: 240, height: 240 },
      { type: "sprite", assetPath: "cat", x: 38, y: 142, width: 48, height: 48 },
    ] },
    assets: {
      background: { encoding: "text", contentType: "text/plain", data: `CBI1\n240 240\n2\n#123456\n#ABCDEF\n${Array(240).fill("ab".repeat(120)).join("\n")}` },
      cat: { encoding: "text", contentType: "text/plain", data: "CBA1\n2 1 2 4\n2\n#FF0000\n#0000FF\na.\n.b" },
    },
  };
  const { container } = render(<ThemeSpecPreview pack={pack} status="ready" themeId="test" />);
  const [background, cat] = container.querySelectorAll("image");
  expect(container.querySelectorAll("*").length).toBeLessThan(12);
  expect(imageDocument(background).querySelectorAll("rect")).toHaveLength(57600);
  const backgroundHref = background.getAttribute("href");
  const firstFrame = cat.getAttribute("href");
  expect(imageDocument(cat).querySelectorAll("rect")).toHaveLength(1);
  expect(imageDocument(cat).querySelector("rect")?.getAttribute("fill")).toBe("#FF0000");
  act(() => { vi.advanceTimersByTime(250); });
  expect(background.getAttribute("href")).toBe(backgroundHref);
  expect(cat.getAttribute("href")).not.toBe(firstFrame);
  const pixel = imageDocument(cat).querySelector("rect")!;
  expect(pixel.getAttribute("fill")).toBe("#0000FF");
  expect(pixel.getAttribute("x")).toBe("24");
  expect(pixel.getAttribute("width")).toBe("24");
  expect(pixel.getAttribute("height")).toBe("48");
  act(() => { vi.advanceTimersByTime(250); });
  expect(cat.getAttribute("href")).toBe(firstFrame);
  expect(container.querySelectorAll("*").length).toBeLessThan(12);
});

it("reuses images when moved and refreshes them when resized or edited", () => {
  const pack: ThemeRenderPack = {
    spec: { primitives: [{ type: "sprite", assetPath: "art", x: 1, width: 3, height: 5 }] },
    assets: { art: { encoding: "text", contentType: "text/plain", data: "CBI1\n2 1\n1\n#123456\n.a" } },
  };
  const { container, rerender } = render(<ThemeSpecPreview animate={false} pack={pack} status="ready" themeId="test" />);
  const image = container.querySelector("image")!;
  const original = image.getAttribute("href");
  const encode = vi.spyOn(globalThis, "encodeURIComponent");
  // Geometry edits clone the complete editor document, including asset objects.
  const moved = structuredClone(pack);
  moved.spec!.primitives![0].x = 10;
  rerender(<ThemeSpecPreview animate={false} pack={moved} status="ready" themeId="test" />);
  expect(image.getAttribute("x")).toBe("10");
  expect(encode).not.toHaveBeenCalled();
  expect(image.getAttribute("href")).toBe(original);
  const pixel = imageDocument(image).querySelector("rect")!;
  expect(pixel.getAttribute("x")).toBe("1");
  expect(pixel.getAttribute("width")).toBe("2");
  const resized = { ...moved, spec: { primitives: [{ ...moved.spec!.primitives![0], width: 8 }] } };
  rerender(<ThemeSpecPreview animate={false} pack={resized} status="ready" themeId="test" />);
  expect(imageDocument(image).querySelector("rect")?.getAttribute("width")).toBe("4");
  const edited = { ...resized, assets: { art: { ...pack.assets!.art, data: "CBI1\n2 1\n1\n#654321\n.a" } } };
  rerender(<ThemeSpecPreview animate={false} pack={edited} status="ready" themeId="test" />);
  expect(imageDocument(image).querySelector("rect")?.getAttribute("fill")).toBe("#654321");
});

// These real-pack checks run even when the browser has no hardware WebGL.
// They test the screen renderer directly, without faking GPU capability.
function catalogPack(theme: string, revision: string): ThemeRenderPack {
  return JSON.parse(readFileSync(resolve(
    process.cwd(), `../../dist/theme-packs/render/${theme}/${revision}.json`,
  ), "utf8"));
}

it("renders the Overview's real zero and long usage labels at readable sizes", () => {
  const frame = buildFrameData(undefined, {
    v: 1, provider: "codex", label: "Codex", sessionUnavailable: true,
    weekly: 63, resetSecs: 5400, usageMode: "used", activity: "coding",
    usageSlots: [
      { id: "primary", label: "Weekly", percent: 0, resetSecs: 5400 },
      { id: "secondary", label: "Codex Spark Weekly", percent: 63, resetSecs: 0 },
    ],
  });
  const { container } = render(<ThemeSpecPreview
    pack={catalogPack("synthwave", "synthwa-3-619665")} status="ready"
    themeId="synthwave" frame={frame} />);
  const texts = [...container.querySelectorAll("text")];
  const text = (value: string) => texts.find((node) => node.textContent === value);
  expect(text("USAGE")).toBeTruthy();
  for (const label of ["Weekly used", "Codex Spark Weekly used"]) {
    expect(text(label)?.getAttribute("font-size")).toBe("16");
  }
  expect(text("0%")).toBeTruthy();
  expect(text("63%")).toBeTruthy();
  expect(text("VIBETV")).toBeUndefined();
});

it.each([
  ["mini-classic", "mini-cl-3-47fe90", "gif", "Codex"],
  ["clippy", "clippy-3-fe3fd4", "animated-sprite", "Codex"],
  ["cozy-meadow", "cm-3-1ed79c", "static-sprite", "Session"],
  ["synthwave", "synthwa-3-619665", "static-sprite", "Codex"],
  ["claude-creature", "claude--3-afab9c", "animated-sprite", "Codex"],
])("renders the live %s pack and its actual asset types", (theme, revision, kind, label) => {
  const frame = buildFrameData(undefined, {
    v: 1, provider: "codex", label: "Codex", session: 27, weekly: 63,
    resetSecs: 5400, usageMode: "used", activity: "coding",
    usageSlots: [
      { id: "primary", label: "Session", percent: 27, resetSecs: 5400 },
      { id: "secondary", label: "Weekly", percent: 63, resetSecs: 5400 },
    ],
  });
  const { container, queryByText } = render(<ThemeSpecPreview
    pack={catalogPack(theme, revision)} status="ready" themeId={theme} frame={frame} />);
  expect([...container.querySelectorAll("text")].some((node) => node.textContent === label)).toBe(true);
  expect(queryByText("ThemeSpec not available")).toBeNull();
  const images = [...container.querySelectorAll("image")];
  if (kind === "gif") {
    expect(images.length).toBeGreaterThanOrEqual(1);
  } else {
    const pixels = images.filter((image) => image.getAttribute("href")?.startsWith("data:image/svg+xml,"))
      .reduce((count, image) => count + imageDocument(image).querySelectorAll("rect").length, 0);
    expect(pixels).toBeGreaterThan(10);
  }
  if (kind === "animated-sprite") {
    const before = container.innerHTML;
    act(() => { vi.advanceTimersByTime(650); });
    expect(container.innerHTML).not.toBe(before);
  }
});
