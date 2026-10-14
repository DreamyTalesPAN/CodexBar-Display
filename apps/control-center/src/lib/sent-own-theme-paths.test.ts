// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";

import {
  rememberSentOwnThemePath,
  sentOwnThemePaths,
} from "./sent-own-theme-paths";

afterEach(() => window.localStorage.clear());

it("keeps the paths that were sent, each once, the latest last", () => {
  expect(sentOwnThemePaths()).toEqual([]);
  rememberSentOwnThemePath("/themes/u/my-them-1-aaaaaa.json");
  rememberSentOwnThemePath("/themes/s/my-scre-1-bbbbbbbb.json");
  rememberSentOwnThemePath("/themes/u/my-them-1-aaaaaa.json");

  expect(sentOwnThemePaths()).toEqual([
    "/themes/s/my-scre-1-bbbbbbbb.json",
    "/themes/u/my-them-1-aaaaaa.json",
  ]);
});

it("keeps the last fifty and reads anything else in storage as nothing", () => {
  for (let sent = 0; sent < 60; sent += 1) {
    rememberSentOwnThemePath(`/themes/u/t-1-${sent}.json`);
  }
  expect(sentOwnThemePaths()).toHaveLength(50);
  expect(sentOwnThemePaths()[0]).toBe("/themes/u/t-1-10.json");

  window.localStorage.setItem(
    "vibetv.controlCenter.sentOwnThemePaths",
    '{"not":"a list"}',
  );
  expect(sentOwnThemePaths()).toEqual([]);
  window.localStorage.setItem("vibetv.controlCenter.sentOwnThemePaths", "{");
  expect(sentOwnThemePaths()).toEqual([]);
});
