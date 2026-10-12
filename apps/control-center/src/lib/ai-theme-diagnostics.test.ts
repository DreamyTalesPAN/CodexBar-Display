import { afterEach, expect, it, vi } from "vitest";
import { generateAIThemeConcept, verifyAIThemeCredential } from "./ai-theme";

it("explains model verification failures with safe upstream diagnostics", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: {code:"provider_model_unavailable",stage:"connection",providerStatus:404,providerCode:"model_not_found",model:"gpt-image-2.5-flare",reason:"The selected model is unavailable.",requestId:"req_123"},
  }), {status:502})));
  await expect(verifyAIThemeCredential("openai")).rejects.toThrow("Connection check. OpenAI HTTP 404 (model_not_found). The selected model is unavailable. Request: req_123");
});

it("does not blame the key for network or permission errors", async () => {
  for (const [code, message] of [["provider_unavailable","could not be reached"],["provider_permission_denied","permission"],["provider_quota_exhausted","billing"]]) {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code}}),{status:502})));
    await expect(verifyAIThemeCredential("openai")).rejects.toThrow(message);
  }
});

afterEach(() => vi.unstubAllGlobals());

it("explains that only an active request blocks another request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: {code:"generation_busy"},
  }), {status:409})));
  await expect(verifyAIThemeCredential("openai")).rejects.toThrow(
    "An AI request is already running. Wait for it to finish, then try again.",
  );
});

it("preserves the diagnostic stage and bounded AI assessment in the UI error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: {code:"animation_quality_failed", stage:"region", reason:"No suitable area fits the display.", assessment:true},
  }), {status:502})));
  await expect(generateAIThemeConcept({prompt:"Bring it to life",history:[],target:"auto"}))
    .rejects.toThrow("Motion area selection. AI assessment: No suitable area fits the display.");
});

it("does not display arbitrary provider details or unknown diagnostic stages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: {code:"provider_unavailable", stage:"unexpected", reason:"secret-raw-response"},
  }), {status:502})));
  try { await generateAIThemeConcept({prompt:"An office",history:[],target:"auto"}); }
  catch (error) { expect(String(error)).not.toContain("secret-raw-response"); return; }
  throw new Error("Expected a failed request");
});

it("bounds untrusted assessment text and removes control characters", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: {code:"animation_quality_failed",stage:"region",assessment:true,reason:"No suitable area.\u202e"+"x".repeat(2000)},
  }), {status:502})));
  try { await generateAIThemeConcept({prompt:"An office",history:[],target:"auto"}); }
  catch (error) {
    expect(String(error)).toContain("Motion area selection. AI assessment: No suitable area.");
    expect(String(error)).not.toContain("\u202e");
    expect(String(error).length).toBeLessThan(450);
    return;
  }
  throw new Error("Expected a failed request");
});
