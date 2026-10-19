import * as OpenCC from "opencc-js";

/**
 * Conversion is only applied to comparison keys and scanner variants.
 * Original text is never rewritten.
 */
let toSimplifiedConverter: ((text: string) => string) | undefined;
let toTraditionalConverter: ((text: string) => string) | undefined;

function simplifiedConverter(): (text: string) => string {
  toSimplifiedConverter ??= OpenCC.Converter({ from: "tw", to: "cn" });
  return toSimplifiedConverter;
}

function traditionalConverter(): (text: string) => string {
  toTraditionalConverter ??= OpenCC.Converter({ from: "cn", to: "tw" });
  return toTraditionalConverter;
}

export function toSimplified(text: string): string {
  try {
    return simplifiedConverter()(text);
  } catch {
    return text;
  }
}

export function toTraditional(text: string): string {
  try {
    return traditionalConverter()(text);
  } catch {
    return text;
  }
}

const PUNCTUATION_RE =
  /[\s，。；、：·・\-—_（）()《》「」『』“”‘’"'!！?？〈〉【】\[\]{}]/g;

/** Comparison key: simplified, whitespace/punctuation free. */
export function normalizeName(name: string): string {
  return toSimplified(name).replace(PUNCTUATION_RE, "");
}

/** Whitespace/punctuation-free variant used by the scanner. */
export function scanKey(text: string): string {
  return text.replace(PUNCTUATION_RE, "");
}

/** All forms of a dictionary alias that should match either script. */
export function aliasVariants(alias: string): string[] {
  const trimmed = alias.trim();
  if (!trimmed) return [];
  const variants = new Set<string>();
  for (const value of [trimmed, toSimplified(trimmed), toTraditional(trimmed)]) {
    const key = scanKey(value);
    if (key.length >= 2) variants.add(key);
  }
  return [...variants];
}

/**
 * Extract a "今…" modern-location hint from a sentence.
 * Example: "赤壁，今湖北赤壁市西北" -> "湖北赤壁市西北".
 */
export function extractModernHint(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = /今\s*([^。；;！？\n]{2,40})/.exec(text);
  const hint = match?.[1]?.trim();
  if (!hint) return undefined;
  // Drop trailing directional / discourse tails that are not place names.
  return hint.replace(/[，,、].*$/, "").trim() || undefined;
}

/** Whether two period labels can refer to the same era ("东汉" / "东汉末年"). */
export function labelsCompatible(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return true;
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return true;
  return left.includes(right) || right.includes(left);
}

/** Expand common directional modifiers from a modern hint. */
export function stripModernDirection(text: string): string {
  return text.replace(
    /(以东|以西|以南|以北|东北|西北|东南|西南|附近|一带|境内|之?[东南西北]?[东南西北]?[一二三四五六七八九十数]?里?)$/,
    "",
  );
}
