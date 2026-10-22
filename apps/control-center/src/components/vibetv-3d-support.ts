/**
 * True when the browser has a WebGL context on a real GPU. A software renderer
 * (SwiftShader, llvmpipe) or no context keeps the flat live preview: the 3D
 * case would only slow the page down there.
 */
export function hardwareWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : "";
    (gl.getExtension("WEBGL_lose_context") as WEBGL_lose_context | null)?.loseContext();
    // Windows WebView2 without a GPU reports the Basic Render Driver (WARP).
    return !/swiftshader|llvmpipe|software|basic render driver|\bwarp\b/i.test(renderer);
  } catch {
    return false;
  }
}
