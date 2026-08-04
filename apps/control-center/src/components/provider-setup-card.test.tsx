import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderSetupCard } from "./provider-setup-card";

describe("ProviderSetupCard", () => {
  it("uses reconciled ready status instead of stale setup copy", () => {
    const html = renderToStaticMarkup(
      <ProviderSetupCard
        providerSetup={{
          status: "ready",
          engine: { status: "ready" },
          providers: [
            {
              id: "codex",
              label: "Codex",
              enabled: true,
              status: "ready",
            },
            {
              id: "claude",
              label: "Claude",
              enabled: true,
              status: "auth_required",
              detail: "This provider needs an active sign-in.",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Codex is ready.");
    expect(html).not.toContain("Connect an AI provider");
    expect(html).not.toContain("Usage service needs attention");
    expect(html).not.toContain("This provider needs an active sign-in.");
  });
});
