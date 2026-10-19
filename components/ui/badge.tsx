import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  children,
  tone = "default",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "default" | "solid" | "high" | "medium" | "low" | "muted";
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "chip",
        tone === "solid" && "chip-solid",
        tone === "high" && "border-moss/25 bg-moss/10 text-moss",
        tone === "medium" && "border-gold/30 bg-gold/10 text-gold",
        tone === "low" && "border-cinnabar/25 bg-cinnabar/8 text-cinnabar",
        tone === "muted" && "text-ink-faint",
        className,
      )}
    >
      {children}
    </span>
  );
}
