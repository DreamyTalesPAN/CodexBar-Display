// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeSpecPreview, type ThemeRenderPack } from "./live-vibetv-preview";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
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
