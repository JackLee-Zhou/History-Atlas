"use client";

import type { CSSProperties } from "react";
import type { Book } from "@/lib/schema";

const COVER_STYLES = [
  {
    key: "vermilion",
    background: "#8d342b",
    ink: "#f5e9d3",
    accent: "#d8b47a",
  },
  {
    key: "orbit",
    background: "#1b2634",
    ink: "#ece7da",
    accent: "#92b2c5",
  },
  {
    key: "paper",
    background: "#e7e0d2",
    ink: "#26221c",
    accent: "#a64a3c",
  },
  {
    key: "archive",
    background: "#252a26",
    ink: "#eee8d8",
    accent: "#b8a16b",
  },
  {
    key: "mist",
    background: "#55675d",
    ink: "#f2ebdc",
    accent: "#c5cbb8",
  },
] as const;

type CoverStyle = (typeof COVER_STYLES)[number];

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function coverStyleFor(book: Book): CoverStyle {
  return COVER_STYLES[hashText(book.id || book.title) % COVER_STYLES.length]!;
}

function sealCharacter(title: string): string {
  return (
    Array.from(title.trim()).find((char) => /[\u3400-\u9fff]/.test(char)) ??
    "阅"
  );
}

function CoverArt({ kind }: { kind: CoverStyle["key"] }) {
  if (kind === "vermilion") {
    return (
      <svg viewBox="0 0 300 450" aria-hidden>
        <circle cx="220" cy="118" r="66" fill="currentColor" opacity=".35" />
        <path d="M0 365c54-26 96-69 144-64 55 6 92 54 156 40v109H0Z" fill="currentColor" opacity=".23" />
        <path d="M132 365c-3-68 8-131 30-184M147 260c-18-8-30-20-37-38M151 226c18-7 31-18 41-34M158 190c-12-7-20-16-27-31" fill="none" stroke="currentColor" strokeWidth="2" opacity=".55" />
        <path d="M72 410c36-18 86-24 156-10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".3" />
      </svg>
    );
  }

  if (kind === "orbit") {
    return (
      <svg viewBox="0 0 300 450" aria-hidden>
        <circle cx="178" cy="228" r="76" fill="currentColor" opacity=".3" />
        <circle cx="178" cy="228" r="104" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".4" />
        <path d="M24 324c84-32 188-32 270 0" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".32" />
        <circle cx="72" cy="98" r="2.4" fill="currentColor" opacity=".65" />
        <circle cx="244" cy="76" r="1.8" fill="currentColor" opacity=".5" />
        <circle cx="212" cy="130" r="1.2" fill="currentColor" opacity=".45" />
        <circle cx="92" cy="170" r="1.4" fill="currentColor" opacity=".35" />
      </svg>
    );
  }

  if (kind === "paper") {
    return (
      <svg viewBox="0 0 300 450" aria-hidden>
        <g fill="none" stroke="currentColor" strokeWidth="5" opacity=".82">
          <ellipse cx="172" cy="207" rx="58" ry="82" transform="rotate(18 172 207)" />
          <ellipse cx="172" cy="207" rx="43" ry="67" transform="rotate(12 172 207)" />
          <ellipse cx="172" cy="207" rx="28" ry="52" transform="rotate(7 172 207)" />
          <ellipse cx="172" cy="207" rx="14" ry="37" transform="rotate(2 172 207)" />
          <path d="M172 169c18 0 37 16 40 38 3 22-10 43-31 47-20 4-40-9-44-29-4-19 8-39 27-45 16-5 33 5 38 20 5 15-4 31-19 35-13 4-27-4-30-17-3-12 5-24 17-27" />
        </g>
      </svg>
    );
  }

  if (kind === "mist") {
    return (
      <svg viewBox="0 0 300 450" aria-hidden>
        <path d="M0 268c60-48 108-22 154-42 41-18 84-28 146-8v232H0Z" fill="currentColor" opacity=".22" />
        <path d="M0 318c54-25 97-10 148-28 54-19 96-22 152-5v165H0Z" fill="currentColor" opacity=".32" />
        <path d="M72 330v-88m0 42-24-31m24 19 25-38m-25 64-17-24m17 12 17-24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".6" />
        <path d="M214 348v-118m0 58-28-36m28 18 32-43m-32 82-20-28m20 12 22-28" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity=".48" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 300 450" aria-hidden>
      <circle cx="222" cy="106" r="38" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".45" />
      <path d="M0 328c44-44 78-26 118-44 46-21 82-38 182-12v178H0Z" fill="currentColor" opacity=".18" />
      <path d="M0 374c58-30 107-14 157-30 46-15 92-12 143 6v100H0Z" fill="currentColor" opacity=".28" />
      <path d="M100 360v-78m0 35-22-28m22 16 23-35m-23 58-16-22m16 10 18-24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity=".56" />
      <path d="M32 390c70-20 168-22 236-4M42 410c76-18 154-18 218-2" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".28" />
    </svg>
  );
}

export interface BookCoverProps {
  book: Book;
  compact?: boolean;
  className?: string;
}

export function BookCover({ book, compact = false, className }: BookCoverProps) {
  const style = coverStyleFor(book);
  const coverTitle = book.title.replace(/（[^）]*）|\([^)]*\)/g, "").trim() || book.title;
  const titleLength = Array.from(coverTitle.replace(/\s/g, "")).length;
  const titleClass =
    titleLength >= 14
      ? "is-tiny"
      : titleLength >= 11
        ? "is-long"
        : titleLength >= 8
          ? "is-medium"
          : "";
  const css = {
    "--cover-bg": style.background,
    "--cover-ink": style.ink,
    "--cover-accent": style.accent,
  } as CSSProperties;

  return (
    <div
      className={`book-cover book-cover--${style.key} ${titleClass}${compact ? " book-cover--compact" : ""}${className ? ` ${className}` : ""}`}
      style={css}
      aria-hidden={compact || undefined}
    >
      <span className="book-cover__art">
        <CoverArt kind={style.key} />
      </span>
      <span className="book-cover__wash" aria-hidden />
      <span className="book-cover__title">{coverTitle}</span>
      {!compact && book.author ? (
        <span className="book-cover__author">{book.author}</span>
      ) : null}
      {!compact ? (
        <span className="book-cover__seal">{sealCharacter(book.title)}</span>
      ) : null}
    </div>
  );
}
