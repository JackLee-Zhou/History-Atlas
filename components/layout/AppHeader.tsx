import Link from "next/link";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function AppHeader({
  title,
  subtitle,
  eyebrow,
  backHref,
  right,
  contained = false,
  className,
}: {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  backHref?: string;
  right?: ReactNode;
  contained?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "app-header border-b border-line/70",
        contained ? "px-0" : "px-4 py-3 sm:px-6",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3",
          contained &&
            "mx-auto w-full max-w-[1180px] px-4 py-3 sm:px-6",
        )}
      >
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="seal shrink-0" aria-label={`${APP_NAME} 书库`}>
          史
        </Link>
        <div className="min-w-0">
          {eyebrow ? (
            <p className="truncate text-[10px] tracking-[0.22em] text-ink-faint">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex min-w-0 items-baseline gap-2">
            {backHref ? (
              <Link
                href={backHref}
                className="shrink-0 text-xs text-ink-soft underline-offset-4 hover:text-cinnabar hover:underline"
              >
                返回
              </Link>
            ) : null}
            <h1 className="truncate font-serif text-lg tracking-wide">
              {title ?? APP_NAME}
            </h1>
            {subtitle ? (
              <span className="hidden truncate text-xs text-ink-soft sm:inline">
                {subtitle}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
      </div>
    </header>
  );
}
