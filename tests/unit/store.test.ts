import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-atlas-store-"));
process.env.DATA_DIR = tempDir;

type StoreModule = typeof import("@/lib/server/store");
type SeedModule = typeof import("@/lib/server/seed");
let store: StoreModule;
let seed: SeedModule;

beforeAll(async () => {
  store = await import("@/lib/server/store");
  seed = await import("@/lib/server/seed");
  await seed.seedDemo();
});

afterAll(() => {
  store.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("SQLite store", () => {
  it("seeds and reads a book with its latest analysis", async () => {
    const books = await store.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]?.id).toBe("demo-three-kingdoms");

    const stored = await store.getStoredBook("demo-three-kingdoms");
    expect(stored?.chapters.length).toBeGreaterThan(0);

    const analysis = await store.getLatestAnalysisForChapter(
      "demo-three-kingdoms",
      "chi-bi-50",
    );
    expect(analysis?.id).toBe("demo-chibi-analysis");
  });

  it("stores and returns a scoped cache row", async () => {
    const analysis = await store.getLatestAnalysisForChapter(
      "demo-three-kingdoms",
      "chi-bi-50",
    );
    if (!analysis) throw new Error("demo analysis missing");
    const key = "c".repeat(64);
    await store.setCachedAnalysis(key, analysis);
    const cached = await store.getCachedAnalysis(key);
    expect(cached?.id).toBe(analysis.id);
  });

  it("deletes a book, its analyses, and its cache rows", async () => {
    const analysis = await store.getLatestAnalysisForChapter(
      "demo-three-kingdoms",
      "chi-bi-50",
    );
    if (!analysis) throw new Error("demo analysis missing");
    const key = "d".repeat(64);
    await store.setCachedAnalysis(key, analysis);

    await store.deleteBook("demo-three-kingdoms");
    expect(await store.getStoredBook("demo-three-kingdoms")).toBeNull();
    expect(
      await store.getLatestAnalysisForChapter("demo-three-kingdoms", "chi-bi-50"),
    ).toBeNull();
    expect(await store.getCachedAnalysis(key)).toBeNull();
    expect((await store.getStoreCounts()).books).toBe(0);
  });

  it("never returns the stored API key in the settings view", async () => {
    await store.updateSettings({
      provider: "mock",
      geocoder: "none",
      autoAnalyze: false,
      apiKey: "local-store-test-key",
    });
    const view = await store.getSettingsView();
    expect(view.hasKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain("local-store-test-key");
    expect(view.keyMasked).toBeTruthy();
  });

  it("rejects private OpenAI endpoints and clears the old key when the endpoint changes", async () => {
    await expect(
      store.updateSettings({
        provider: "openai",
        baseUrl: "http://127.0.0.1:9/v1",
        model: "test",
        geocoder: "none",
        autoAnalyze: false,
      }),
    ).rejects.toThrow(/内网|本机/);

    await store.updateSettings({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "test",
      geocoder: "none",
      autoAnalyze: false,
    });
    expect((await store.getSettingsView()).hasKey).toBe(false);
  });
});
