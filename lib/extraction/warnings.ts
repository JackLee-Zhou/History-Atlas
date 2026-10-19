import type { Warning } from "@/lib/schema";

export function extractionWarning(
  code: string,
  message: string,
  severity: Warning["severity"] = "warning",
): Warning {
  return { code, message, severity, refs: [] };
}
