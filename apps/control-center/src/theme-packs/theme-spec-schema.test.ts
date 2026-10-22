import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "../..");
const read = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const validate = new Ajv2020({ strict: false }).compile(read("protocol/theme_spec_v1.schema.json"));
const stops = [{ gte: 100, c: "#C9F26B" }, { gte: 0, c: "#E7A3AC" }];
const specWith = (primitive: Record<string, unknown>) => ({
  v: 1, id: "test-theme", rev: 1, bg: "#000000", p: [{ x: 0, y: 0, w: 10, h: 10, c: "#FFFFFF", ...primitive }],
});

describe("theme_spec_v1.schema.json", () => {
  it.each(readdirSync(path.join(root, "theme-packs")))("accepts the shipped theme %s", (id) => {
    expect(validate(read(`theme-packs/${id}/theme.json`)), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    ["text", { t: "tx", b: "usageSlot1PaceText", cs: stops }],
    ["text", { type: "text", binding: "usageSlot2PaceShort", colorStops: stops }],
  ])("accepts colour stops on %s bound to a pace key", (_, primitive) => {
    expect(validate(specWith(primitive)), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    ["text bound to another key", { t: "tx", b: "usageSlot1Percent", cs: stops }],
    ["text without a binding", { t: "tx", v: "{usageSlot1PaceText}", cs: stops }],
    ["rect", { t: "r", cs: stops }],
  ])("still rejects colour stops on %s", (_, primitive) => {
    expect(validate(specWith(primitive))).toBe(false);
  });
});
