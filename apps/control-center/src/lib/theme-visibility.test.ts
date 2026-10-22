import { describe, expect, it } from "vitest";
import { listedThemes } from "./theme-visibility";
import type { ThemeProduct } from "./themes";

function theme(themeId: string, listed?: boolean): ThemeProduct {
  return {
    id: themeId,
    title: themeId,
    priceLabel: "Kostenlos",
    isFree: true,
    themeId,
    source: "github-catalog",
    ...(listed === undefined ? {} : { listed }),
  };
}

const themes = [theme("clippy"), theme("acme", false), theme("synthwave", true)];

describe("listedThemes", () => {
  it("hides an unlisted theme nobody chose or installed", () => {
    expect(listedThemes(themes, []).map((t) => t.themeId)).toEqual([
      "clippy",
      "synthwave",
    ]);
  });

  it("shows an unlisted theme while it is linked, selected or installed", () => {
    expect(
      listedThemes(themes, [undefined, "acme", null]).map((t) => t.themeId),
    ).toEqual(["clippy", "acme", "synthwave"]);
  });

  it("keeps every theme of a catalog without the flag", () => {
    const plain = [theme("clippy"), theme("synthwave")];
    expect(listedThemes(plain, [])).toEqual(plain);
  });
});
