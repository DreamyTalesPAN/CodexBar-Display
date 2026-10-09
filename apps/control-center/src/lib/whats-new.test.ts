// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

import {
  markWhatsNewSeen,
  newestWhatsNew,
  seenWhatsNew,
  WHATS_NEW,
} from "./whats-new";

const KEY = "vibetv.controlCenter.seenWhatsNew";
const ids = (entries: { id: string }[]) => entries.map(({ id }) => id);
const themes = WHATS_NEW.filter(({ theme }) => theme);
const others = WHATS_NEW.filter(({ theme }) => !theme);
// What a customer who has seen none of it is told.
const told = [...ids(themes).slice(-3), ...ids(others).slice(-3)];

// The live themes the catalog held before the notice existed. A theme added
// since is new to customers who update, and has to be told. When an old theme
// entry is taken off the list, its theme id moves here.
const THEMES_BEFORE_THE_NOTICE = [
  "claude-creature",
  "clippy",
  "mini-classic",
  "pixel-battery",
  "synthwave",
  "tiny-office",
];

afterEach(() => window.localStorage.clear());

it("has entries with unique kebab-case ids", () => {
  expect(new Set(ids(WHATS_NEW)).size).toBe(WHATS_NEW.length);
  for (const { id } of WHATS_NEW) {
    expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

// A new theme must not reach customers without a word about it, and no entry
// may announce a theme the catalog does not hold.
it("has an entry for every theme added to the catalog, and for no other", () => {
  const catalog = JSON.parse(
    readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../dist/theme-packs/vibetv-theme-packs-v2.json",
      ),
      "utf8",
    ),
  ) as { themes: { id: string; usage?: string }[] };
  const added = catalog.themes
    .filter(({ id, usage }) => (usage || "live") === "live" && !THEMES_BEFORE_THE_NOTICE.includes(id))
    .map(({ id }) => id);

  expect(themes.map(({ theme }) => theme).sort()).toEqual(added.sort());
  for (const { title } of themes) {
    expect(title).toMatch(/^New theme: /);
  }
});

it("tells new themes first, then the newest three of the rest", () => {
  expect(themes.length).toBeGreaterThan(0);
  expect(ids(newestWhatsNew())).toEqual(told);
  expect(newestWhatsNew()[0].theme).toBeTruthy();
});

it("has nothing stored at first, then every entry as seen", () => {
  expect(seenWhatsNew()).toBeNull();
  expect(ids(newestWhatsNew(seenWhatsNew()))).toEqual(told);

  expect(markWhatsNewSeen()).toEqual(ids(WHATS_NEW));
  expect(seenWhatsNew()).toEqual(ids(WHATS_NEW));
  expect(newestWhatsNew(seenWhatsNew())).toEqual([]);
});

it("shows what was added since, in the order of the list", () => {
  const [first, ...later] = ids(others);
  window.localStorage.setItem(KEY, JSON.stringify([...ids(themes), first]));

  expect(ids(newestWhatsNew(seenWhatsNew()))).toEqual(later);
  // An id that is no longer in the list hides nothing.
  expect(ids(newestWhatsNew(["removed-entry"]))).toEqual(told);
});

it("reads anything else in storage as nothing stored", () => {
  window.localStorage.setItem(KEY, '{"not":"a list"}');
  expect(seenWhatsNew()).toBeNull();
  window.localStorage.setItem(KEY, "{");
  expect(seenWhatsNew()).toBeNull();
  window.localStorage.setItem(KEY, "[]");
  expect(seenWhatsNew()).toEqual([]);
});
