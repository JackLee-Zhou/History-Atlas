import type {
  Book,
  BookFormat,
  Chapter,
  PageRange,
  Paragraph,
  Warning,
} from "@/lib/schema";

/** Input accepted by the unified extraction entry point. */
export interface ExtractInput {
  buffer: Uint8Array;
  filename: string;
  /**
   * Optional explicit hint. Only `"paste"` changes behavior (JSON-pasted text is
   * already UTF-8); binary formats are always identified from magic bytes.
   */
  format?: BookFormat;
  /** Optional display title override (otherwise taken from metadata / filename). */
  title?: string;
}

/** Result of extracting a book: the stored-level book plus full chapters. */
export interface ExtractResult {
  book: Book;
  chapters: Chapter[];
  warnings: Warning[];
}

/** A chapter before it is bound to a book id. */
export interface RawChapter {
  id: string;
  title: string;
  text: string;
  paragraphs: Paragraph[];
  pages: PageRange[];
  needsOCR: boolean;
}

/** Format-specific extraction output consumed by the orchestrator. */
export interface ExtractionOutput {
  format: BookFormat;
  title: string;
  author?: string;
  chapters: RawChapter[];
  warnings: Warning[];
}
