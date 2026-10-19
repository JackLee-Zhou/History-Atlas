import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Warning } from "@/lib/schema/common";

export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(values));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function formatConfidence(confidence: number): string {
  if (confidence >= 0.8) return "高";
  if (confidence >= 0.6) return "中";
  return "低";
}

export function confidenceTone(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

export function formatDistanceKm(km: number): string {
  if (km < 1) return "不足 1 公里";
  if (km < 10) return `${km.toFixed(1)} 公里`;
  return `${Math.round(km)} 公里`;
}

export function warning(
  code: string,
  message: string,
  severity: Warning["severity"] = "warning",
  refs: string[] = [],
): Warning {
  return { code, message, severity, refs };
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
