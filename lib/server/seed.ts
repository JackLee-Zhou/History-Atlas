import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  analysisSchema,
  bookSchema,
  chapterSchema,
  type Analysis,
  type Book,
} from "@/lib/schema";
import { AppError, ERROR_CODES } from "@/lib/server/http";
import { seedAssetsDir } from "@/lib/server/paths";
import {
  getAnalysis,
  getStoredBook,
  saveAnalysis,
  saveStoredBook,
} from "@/lib/server/store";

/**
 * 内置演示数据的加载与落库。
 *
 * 演示书与分析是仓库内的静态资产，只读；运行时第一次调用会把它们写入
 * `.data/`，之后复用已存在的记录。重复调用结果一致（幂等）。
 */

const demoBookAssetSchema = z.object({
  book: bookSchema,
  chapters: z.array(chapterSchema).min(1),
});

const DEMO_BOOK_PATH = path.join("demo", "books", "three-kingdoms.json");
const DEMO_ANALYSIS_PATH = path.join("demo", "analyses", "chibi.json");

async function readDemoJson(relativePath: string): Promise<unknown> {
  const file = path.join(seedAssetsDir(), relativePath);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      `内置示例数据读取失败：${relativePath}`,
      { status: 500, cause: error },
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      `内置示例数据不是合法 JSON：${relativePath}`,
      { status: 500, cause: error },
    );
  }
}

function validationError(relativePath: string, cause: unknown): AppError {
  return new AppError(
    ERROR_CODES.INTERNAL,
    `内置示例数据校验失败：${relativePath}`,
    { status: 500, cause },
  );
}

export async function seedDemo(): Promise<{
  book: Book;
  analysis: Analysis;
  seeded: boolean;
}> {
  try {
    const bookAsset = demoBookAssetSchema.safeParse(
      await readDemoJson(DEMO_BOOK_PATH),
    );
    if (!bookAsset.success) {
      throw validationError(DEMO_BOOK_PATH, bookAsset.error);
    }

    const analysisAsset = analysisSchema.safeParse(
      await readDemoJson(DEMO_ANALYSIS_PATH),
    );
    if (!analysisAsset.success) {
      throw validationError(DEMO_ANALYSIS_PATH, analysisAsset.error);
    }

    const { book: demoBook, chapters } = bookAsset.data;
    const demoAnalysis = analysisAsset.data;

    if (demoAnalysis.bookId !== demoBook.id) {
      throw new AppError(
        ERROR_CODES.INTERNAL,
        "内置示例分析的 bookId 与示例书不一致",
        { status: 500 },
      );
    }
    if (!chapters.some((chapter) => chapter.id === demoAnalysis.chapterId)) {
      throw new AppError(
        ERROR_CODES.INTERNAL,
        `内置示例分析引用了不存在的章节：${demoAnalysis.chapterId}`,
        { status: 500 },
      );
    }

    let seeded = false;

    const existingBook = await getStoredBook(demoBook.id);
    let book: Book;
    if (existingBook) {
      // 已存在就复用，避免覆盖用户阅读进度或修正。
      book = existingBook.book;
      if (!existingBook.chapters.some((chapter) => chapter.id === demoAnalysis.chapterId)) {
        throw new AppError(
          ERROR_CODES.INTERNAL,
          `已存在的示例书缺少章节：${demoAnalysis.chapterId}`,
          { status: 500 },
        );
      }
    } else {
      await saveStoredBook({ book: demoBook, chapters });
      book = demoBook;
      seeded = true;
    }

    const existingAnalysis = await getAnalysis(demoAnalysis.id);
    let analysis: Analysis;
    if (existingAnalysis) {
      analysis = existingAnalysis;
    } else {
      await saveAnalysis(demoAnalysis);
      analysis = demoAnalysis;
      seeded = true;
    }

    return { book, analysis, seeded };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(ERROR_CODES.INTERNAL, "内置示例初始化失败", {
      status: 500,
      cause: error,
    });
  }
}
