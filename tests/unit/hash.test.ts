import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { analysisCacheKey } from "@/lib/server/hash";

const base = {
  text: "同一段原文",
  scope: "selection",
  promptVersion: "p17",
  provider: "mock",
  model: "fake",
};

describe("analysisCacheKey", () => {
  it("scopes cache entries by book and chapter", () => {
    const first = analysisCacheKey({
      ...base,
      bookId: "book-a",
      chapterId: "ch-1",
    });
    const secondBook = analysisCacheKey({
      ...base,
      bookId: "book-b",
      chapterId: "ch-1",
    });
    const secondChapter = analysisCacheKey({
      ...base,
      bookId: "book-a",
      chapterId: "ch-2",
    });
    expect(first).not.toBe(secondBook);
    expect(first).not.toBe(secondChapter);
  });
});
