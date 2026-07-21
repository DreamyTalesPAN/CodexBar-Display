import { describe, expect, it } from "vitest";
import {
  AI_THEME_LOCAL_HISTORY_LIMIT,
  loadAIThemeHistory,
  saveAIThemeHistory,
  type AIThemeMessage,
} from "./ai-theme";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("AI theme history", () => {
  it("keeps only 20 non-secret chat messages per theme", () => {
    const storage = new MemoryStorage();
    const history: AIThemeMessage[] = Array.from({ length: 24 }, (_, index) => ({
      content: `message-${index}`,
      createdAt: new Date(index * 1000).toISOString(),
      role: index % 2 ? "assistant" : "user",
    }));
    saveAIThemeHistory("theme-a", history, storage as Storage);
    expect(loadAIThemeHistory("theme-a", storage as Storage)).toHaveLength(
      AI_THEME_LOCAL_HISTORY_LIMIT,
    );
    expect([...storage.values.values()].join(" ")).not.toContain("apiKey");
  });

  it("isolates history by theme id", () => {
    const storage = new MemoryStorage();
    saveAIThemeHistory("one", [{ content: "one", createdAt: "now", role: "user" }], storage as Storage);
    expect(loadAIThemeHistory("two", storage as Storage)).toEqual([]);
  });
});
