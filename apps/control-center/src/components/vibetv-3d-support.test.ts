// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hardwareWebGLAvailable } from "./vibetv-3d-support";

function fakeContext(renderer: string) {
  return {
    getExtension: (name: string) =>
      name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 1 } : null,
    getParameter: () => renderer,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hardwareWebGLAvailable", () => {
  it("is true on a hardware GPU", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      fakeContext("ANGLE (Apple, Apple M2, OpenGL 4.1)") as never,
    );
    expect(hardwareWebGLAvailable()).toBe(true);
  });

  it("is false on a software renderer", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      fakeContext("Google SwiftShader") as never,
    );
    expect(hardwareWebGLAvailable()).toBe(false);
  });

  it("is false on the Windows Basic Render Driver (WARP)", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      fakeContext("Microsoft Basic Render Driver") as never,
    );
    expect(hardwareWebGLAvailable()).toBe(false);
  });

  it("is false without a WebGL context", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(hardwareWebGLAvailable()).toBe(false);
  });
});
