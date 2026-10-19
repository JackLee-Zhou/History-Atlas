import { z } from "zod";
import { warningSchema } from "./common";

export const bookFormatSchema = z.enum(["epub", "pdf", "txt", "paste"]);

export const paragraphSchema = z.object({
  start: z.number().int().min(0),
  text: z.string(),
});

export const pageSchema = z.object({
  number: z.number().int().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});

export const chapterMetaSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(0),
  title: z.string().min(1),
  charCount: z.number().int().min(0),
  pageStart: z.number().int().min(1).optional(),
  pageEnd: z.number().int().min(1).optional(),
});

export const bookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().max(200).optional(),
  format: bookFormatSchema,
  importedAt: z.string().datetime(),
  chapters: z.array(chapterMetaSchema),
  warnings: z.array(warningSchema).default([]),
});

export const chapterSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  title: z.string().min(1),
  text: z.string(),
  paragraphs: z.array(paragraphSchema),
  pages: z.array(pageSchema).default([]),
  needsOCR: z.boolean().default(false),
});

export const bookImportResultSchema = z.object({
  book: bookSchema,
});

export type BookFormat = z.infer<typeof bookFormatSchema>;
export type Book = z.infer<typeof bookSchema>;
export type ChapterMeta = z.infer<typeof chapterMetaSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Paragraph = z.infer<typeof paragraphSchema>;
export type PageRange = z.infer<typeof pageSchema>;
