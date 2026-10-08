// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";

import {
  markWhatsNewSeen,
  newestWhatsNew,
  seenWhatsNew,
  WHATS_NEW,
} from "./whats-new";

const KEY = "vibetv.controlCenter.seenWhatsNew";
const ids = (entries: { id: string }[]) => entries.map(({ id }) => id);

afterEach(() => window.localStorage.clear());

it("has entries with unique kebab-case ids", () => {
  expect(new Set(ids(WHATS_NEW)).size).toBe(WHATS_NEW.length);
  for (const { id } of WHATS_NEW) {
    expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

it("has nothing stored at first, then every entry as seen", () => {
  expect(seenWhatsNew()).toBeNull();
  expect(ids(newestWhatsNew(seenWhatsNew()))).toEqual(ids(WHATS_NEW).slice(-3));

  expect(markWhatsNewSeen()).toEqual(ids(WHATS_NEW));
  expect(seenWhatsNew()).toEqual(ids(WHATS_NEW));
  expect(newestWhatsNew(seenWhatsNew())).toEqual([]);
});

it("shows what was added since, in the order of the list", () => {
  const [first, ...later] = ids(WHATS_NEW);
  window.localStorage.setItem(KEY, JSON.stringify([first]));

  expect(ids(newestWhatsNew(seenWhatsNew()))).toEqual(later);
  // An id that is no longer in the list hides nothing.
  expect(ids(newestWhatsNew(["removed-entry"]))).toEqual(ids(WHATS_NEW).slice(-3));
});

it("reads anything else in storage as nothing stored", () => {
  window.localStorage.setItem(KEY, '{"not":"a list"}');
  expect(seenWhatsNew()).toBeNull();
  window.localStorage.setItem(KEY, "{");
  expect(seenWhatsNew()).toBeNull();
  window.localStorage.setItem(KEY, "[]");
  expect(seenWhatsNew()).toEqual([]);
});
