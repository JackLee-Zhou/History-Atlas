/**
 * Small, dependency-free helpers for coaxing JSON out of model output.
 *
 * The pipeline never trusts the first parse: it tries the raw string, then a
 * brace-delimited slice, then asks the model once to repair the payload.
 * These helpers intentionally do not validate shape; Zod is applied later.
 */

export type JsonParseResult =
  | { ok: true; value: unknown; strategy: "direct" | "braces" }
  | { ok: false; error: string; candidate?: string };

function tryParse(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown, strategy: "direct" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "JSON.parse 失败",
    };
  }
}

/** Strip a Markdown code fence if the model wrapped its answer in one. */
export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fence?.[1]?.trim() ?? trimmed;
}

/** Slice from the first `{` to the last `}` (models often add prose). */
export function sliceBracedObject(raw: string): string | null {
  const text = stripCodeFence(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parse a JSON object from arbitrary model text.
 * Returns a structured failure instead of throwing so callers can repair once.
 */
export function parseJsonLoose(raw: string): JsonParseResult {
  const direct = tryParse(stripCodeFence(raw));
  if (direct.ok) return direct;

  const braced = sliceBracedObject(raw);
  if (braced) {
    const parsed = tryParse(braced);
    if (parsed.ok) {
      return { ok: true, value: parsed.value, strategy: "braces" };
    }
    return { ...parsed, error: parsed.error, candidate: braced };
  }

  return { ...direct, error: direct.error };
}

/**
 * Best-effort duplicate of parseJsonLoose for code paths that only need a
 * value or null (for example embedding a prior answer into a repair prompt).
 */
export function parseJsonOrNull(raw: string): unknown | null {
  const parsed = parseJsonLoose(raw);
  return parsed.ok ? parsed.value : null;
}
