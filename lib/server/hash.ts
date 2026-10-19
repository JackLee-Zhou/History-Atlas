import "server-only";

import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function analysisCacheKey(input: {
  bookId: string;
  chapterId: string;
  text: string;
  scope: string;
  promptVersion: string;
  provider: string;
  model: string;
}): string {
  return sha256(
    [
      input.bookId,
      input.chapterId,
      input.text,
      input.scope,
      input.promptVersion,
      input.provider,
      input.model,
    ].join("\u0000"),
  );
}
