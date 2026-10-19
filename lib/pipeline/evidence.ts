import { toSimplified } from "@/lib/gazetteer/normalize";
import type { Citation } from "@/lib/schema";

/**
 * Evidence handling.
 *
 * `Chapter.text` is the single offset base for every citation. Quotes are
 * located after whitespace normalization but the stored quote is always the
 * original slice of the source text, never the model's rewritten string.
 */

export interface QuoteIndex {
  /** Original text this index was built for (the excerpt / chapter window). */
  text: string;
  /** Absolute offset of `text[0]` in the chapter. */
  baseOffset: number;
  /** Whitespace-collapsed text used for searching. */
  normalized: string;
  /** normalized index -> local index in `text`. */
  map: number[];
}

export interface LocatedQuote {
  start: number;
  end: number;
  quote: string;
}

// Evidence matching is intentionally tolerant of the differences models
// introduce when quoting: whitespace, Chinese/ASCII punctuation, and
// traditional/simplified characters. The stored citation is still the original
// slice of the source text.
const SKIP_FOR_MATCH_RE =
  /[\s，。；、：·・\-—_（）()《》「」『』“”‘’"'!！?？〈〉【】\[\]{}]/;

export function normalizeQuoteText(text: string): string {
  let normalized = "";
  for (const char of toSimplified(text)) {
    if (SKIP_FOR_MATCH_RE.test(char)) continue;
    normalized += char;
  }
  return normalized;
}

/** Strip a single pair of wrapping quotes, keeping the inner text verbatim. */
export function unwrapQuote(text: string): string {
  const trimmed = text.trim();
  const pairs: Array<[string, string]> = [
    ["“", "”"],
    ["「", "」"],
    ['"', '"'],
    ["'", "'"],
    ["『", "』"],
  ];
  for (const [left, right] of pairs) {
    if (
      trimmed.length >= 2 &&
      trimmed.startsWith(left) &&
      trimmed.endsWith(right) &&
      !trimmed.slice(1, -1).includes(left)
    ) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

export function createQuoteIndex(text: string, baseOffset = 0): QuoteIndex {
  const map: number[] = [];
  let normalized = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (SKIP_FOR_MATCH_RE.test(char)) continue;
    const simplified = toSimplified(char);
    normalized += simplified.length === 1 ? simplified : char;
    map.push(index);
  }
  return { text, baseOffset, normalized, map };
}

/**
 * Find a verbatim (whitespace-tolerant) quote inside the indexed text.
 * Returns absolute chapter offsets.
 */
export function locateQuote(
  index: QuoteIndex,
  rawQuote: string,
): LocatedQuote | null {
  const unwrapped = unwrapQuote(rawQuote);
  let needle = normalizeQuoteText(unwrapped);
  if (!needle) return null;
  if (needle.length > 1000) needle = needle.slice(0, 1000);

  const normalizedIndex = index.normalized.indexOf(needle);
  if (normalizedIndex < 0) return null;
  const startLocal = index.map[normalizedIndex];
  const endNormalizedIndex = normalizedIndex + needle.length - 1;
  const lastLocal = index.map[endNormalizedIndex];
  if (startLocal === undefined || lastLocal === undefined) return null;

  const start = startLocal;
  let end = lastLocal + 1;
  if (end <= start) return null;
  if (end - start > 1000) end = start + 1000;

  return {
    start: index.baseOffset + start,
    end: index.baseOffset + end,
    quote: index.text.slice(start, end),
  };
}

export function citationIdFor(start: number, end: number): string {
  return `c-${start}-${end}`;
}

export interface CitationRegistry {
  add(rawQuote: string): Citation | null;
  get(id: string): Citation | undefined;
  has(id: string): boolean;
  all(): Citation[];
}

/** Creates citation records on demand; invalid quotes are simply rejected. */
export function createCitationRegistry(index: QuoteIndex): CitationRegistry {
  const byId = new Map<string, Citation>();

  return {
    add(rawQuote: string): Citation | null {
      const located = locateQuote(index, rawQuote);
      if (!located) return null;
      const id = citationIdFor(located.start, located.end);
      const existing = byId.get(id);
      if (existing) return existing;
      const citation: Citation = {
        id,
        quote: located.quote,
        start: located.start,
        end: located.end,
      };
      byId.set(id, citation);
      return citation;
    },
    get(id: string): Citation | undefined {
      return byId.get(id);
    },
    has(id: string): boolean {
      return byId.has(id);
    },
    all(): Citation[] {
      return [...byId.values()].sort((a, b) => a.start - b.start || a.end - b.end);
    },
  };
}

/**
 * Model evidence is normally `string[]`; accept `{quote}` objects too so
 * small prompt deviations degrade gracefully instead of dropping everything.
 */
export function quotesFromEvidence(value: unknown): string[] {
  const quotes: string[] = [];
  const visit = (item: unknown, depth: number): void => {
    if (depth > 2 || item === null || item === undefined) return;
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) quotes.push(trimmed);
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry, depth + 1);
      return;
    }
    if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      for (const key of ["quote", "text", "evidence", "quotes"]) {
        if (key in record) {
          visit(record[key], depth + 1);
        }
      }
    }
  };
  visit(value, 0);
  return [...new Set(quotes)];
}
