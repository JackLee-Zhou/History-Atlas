import type { AncientPlace, ModernPlace } from "@/lib/schema";
import { loadGazetteer } from "./loader";
import { aliasVariants } from "./normalize";
import type {
  GazetteerData,
  ScanCandidate,
  ScanGazetteerOptions,
} from "./types";

interface AliasEntry {
  kind: "gazetteer" | "modern";
  placeId: string;
  canonicalName: string;
  matchedAlias: string;
  category: ScanCandidate["category"];
  modernName?: string;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  entries: AliasEntry[];
}

interface RawMatch extends AliasEntry {
  start: number;
  end: number;
  matchedText: string;
}

const MAX_ALIAS_LENGTH = 40;

function createNode(): TrieNode {
  return { children: new Map(), entries: [] };
}

function insert(root: TrieNode, variant: string, entry: AliasEntry): void {
  let node = root;
  for (const char of variant) {
    let child = node.children.get(char);
    if (!child) {
      child = createNode();
      node.children.set(char, child);
    }
    node = child;
  }
  node.entries.push(entry);
}

function buildTrie(
  gazetteer: GazetteerData,
  includeModern: boolean,
): { root: TrieNode; maxDepth: number } {
  const root = createNode();
  let maxDepth = 0;

  const addPlace = (place: AncientPlace | ModernPlace, isAncient: boolean): void => {
    const aliases = [
      place.name,
      ...(Array.isArray(place.aliases) ? place.aliases : []),
    ];
    for (const alias of aliases) {
      const variants = aliasVariants(alias);
      for (const variant of variants) {
        maxDepth = Math.max(maxDepth, variant.length);
        insert(root, variant, {
          kind: isAncient ? "gazetteer" : "modern",
          placeId: place.id,
          canonicalName: place.name,
          matchedAlias: alias,
          category: isAncient
            ? (place as AncientPlace).category
            : "other",
          modernName: isAncient ? (place as AncientPlace).modernName : undefined,
        });
      }
    }
  };

  for (const place of gazetteer.ancient) addPlace(place, true);
  if (includeModern) {
    for (const place of gazetteer.modern) addPlace(place, false);
  }

  return { root, maxDepth: Math.min(maxDepth, MAX_ALIAS_LENGTH) };
}

function collectMatches(
  text: string,
  root: TrieNode,
  maxDepth: number,
): RawMatch[] {
  const matches: RawMatch[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (/\s/.test(text[start] ?? "")) continue;
    let node = root;
    const maxEnd = Math.min(text.length, start + maxDepth);
    for (let index = start; index < maxEnd; index += 1) {
      const char = text[index] ?? "";
      const child = node.children.get(char);
      if (!child) break;
      node = child;
      if (node.entries.length > 0) {
        for (const entry of node.entries) {
          matches.push({
            ...entry,
            start,
            end: index + 1,
            matchedText: text.slice(start, index + 1),
          });
        }
      }
    }
  }
  return matches;
}

function dedupeAndFilter(matches: RawMatch[], limit: number): RawMatch[] {
  const sorted = matches.slice().sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return b.end - a.end;
    if (a.kind !== b.kind) return a.kind === "gazetteer" ? -1 : 1;
    return a.canonicalName.localeCompare(b.canonicalName);
  });

  const kept: RawMatch[] = [];
  const seen = new Set<string>();
  const exactSpans = new Set(
    sorted
      .filter((match) => match.matchedText === match.canonicalName)
      .map((match) => `${match.start}|${match.end}`),
  );
  for (const match of sorted) {
    const key = `${match.kind}|${match.canonicalName}|${match.start}|${match.end}`;
    if (seen.has(key)) continue;
    // An exact canonical-name hit is stronger than an alias on the same span
    // (e.g. 江陵 also being an alias of 荆州).
    if (
      match.matchedText !== match.canonicalName &&
      exactSpans.has(`${match.start}|${match.end}`)
    ) {
      continue;
    }
    // Prefer the longest match starting at the same position, and drop
    // candidates fully contained in an earlier longer one (江陵 inside 江陵县).
    const contained = kept.some(
      (existing) =>
        existing.start <= match.start &&
        match.end <= existing.end &&
        (existing.start < match.start || existing.end > match.end),
    );
    if (contained) continue;
    seen.add(key);
    kept.push(match);
    if (kept.length >= limit) break;
  }
  return kept;
}

/**
 * Recall place candidates from text using the bundled gazetteer.
 *
 * The scanner is a trie walk: O(text length × max alias length) rather than a
 * per-entry regex sweep, which is fine for 100–2000 dictionary entries.
 * It never calls an LLM and never invents locations.
 */
export async function scanGazetteer(
  text: string,
  options: ScanGazetteerOptions = {},
): Promise<ScanCandidate[]> {
  if (!text.trim()) return [];
  const gazetteer =
    options.gazetteer ??
    (await loadGazetteer({ directory: options.directory }));
  if (gazetteer.ancient.length === 0 && gazetteer.modern.length === 0) {
    return [];
  }

  const includeModern = options.includeModern === true;
  const limit = Math.max(1, options.limit ?? 200);
  const { root, maxDepth } = buildTrie(gazetteer, includeModern);
  const kept = dedupeAndFilter(collectMatches(text, root, maxDepth), limit);

  return kept.map((match) => ({
    name: match.canonicalName,
    quote: text.slice(match.start, match.end),
    offset: match.start,
    end: match.end,
    matchedText: match.matchedText,
    category: match.category,
    ancientPlaceId: match.kind === "gazetteer" ? match.placeId : undefined,
    modernPlaceId: match.kind === "modern" ? match.placeId : undefined,
    modernName: match.modernName,
    source: match.kind,
    matchedBy:
      match.matchedText === match.canonicalName ? "exact" : "alias",
  }));
}
