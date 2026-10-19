"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { BACKGROUND_STORAGE_KEY } from "@/lib/theme/background";

export interface ReadingBackgroundOption {
  id: string;
  label: string;
  color: string;
  deep: string;
  dark?: boolean;
}

export const READING_BACKGROUND_OPTIONS: ReadingBackgroundOption[] = [
  { id: "xuan", label: "宣纸", color: "#fbfbfa", deep: "#f2f2ef" },
  { id: "mi", label: "米白", color: "#fcf8ef", deep: "#f0e7d8" },
  { id: "yue", label: "月白", color: "#eef2f7", deep: "#dce5ef" },
  { id: "tao", label: "陶土", color: "#f4e4d1", deep: "#e8d0b8" },
  { id: "zhu", label: "竹青", color: "#e8efe1", deep: "#d7e2cc" },
  {
    id: "night",
    label: "夜间",
    color: "#171716",
    deep: "#0f0f0e",
    dark: true,
  },
];

const STORAGE_KEY = BACKGROUND_STORAGE_KEY;
const DEFAULT_OPTION = READING_BACKGROUND_OPTIONS[0]!;

const LIGHT_PALETTE = {
  ink: "#1a1a1a",
  inkSoft: "#6b6b68",
  inkFaint: "#8c8c88",
  line: "#e2e2de",
  surface: "#ffffff",
  surfaceSoft: "#f4f4f1",
  cinnabar: "#a6382b",
  cinnabarSoft: "#b95645",
  gold: "#9a824c",
  moss: "#2f6b4f",
  indigo: "#2c5282",
  panelInset: "rgba(255,255,255,0.65)",
  shadow: "rgba(66,53,33,0.08)",
};

const DARK_PALETTE = {
  ink: "#ece6da",
  inkSoft: "#c9c0b0",
  inkFaint: "#988f7f",
  line: "#4b4439",
  surface: "#24211d",
  surfaceSoft: "#2e2a24",
  cinnabar: "#d46c5f",
  cinnabarSoft: "#e08b80",
  gold: "#d2a44c",
  moss: "#7fb69a",
  indigo: "#8fb0d8",
  panelInset: "rgba(255,255,255,0.04)",
  shadow: "rgba(0,0,0,0.35)",
};

function applyOption(option: ReadingBackgroundOption): void {
  const root = document.documentElement;
  const palette = option.dark ? DARK_PALETTE : LIGHT_PALETTE;
  const paperDark = option.dark ? "#0b0b0a" : "#e4d5b7";

  root.style.colorScheme = option.dark ? "dark" : "light";
  root.dataset.theme = option.dark ? "dark" : "light";

  const set = (name: string, value: string) => {
    root.style.setProperty(name, value);
  };

  set("--paper", option.color);
  set("--color-paper", option.color);
  set("--paper-deep", option.deep);
  set("--color-paper-deep", option.deep);
  set("--paper-dark", paperDark);
  set("--color-paper-dark", paperDark);

  set("--ink", palette.ink);
  set("--color-ink", palette.ink);
  set("--ink-soft", palette.inkSoft);
  set("--color-ink-soft", palette.inkSoft);
  set("--ink-faint", palette.inkFaint);
  set("--color-ink-faint", palette.inkFaint);
  set("--line", palette.line);
  set("--color-line", palette.line);

  set("--surface", palette.surface);
  set("--color-surface", palette.surface);
  set("--surface-soft", palette.surfaceSoft);
  set("--color-surface-soft", palette.surfaceSoft);

  set("--cinnabar", palette.cinnabar);
  set("--color-cinnabar", palette.cinnabar);
  set("--cinnabar-soft", palette.cinnabarSoft);
  set("--color-cinnabar-soft", palette.cinnabarSoft);
  set("--gold", palette.gold);
  set("--color-gold", palette.gold);
  set("--moss", palette.moss);
  set("--color-moss", palette.moss);
  set("--indigo", palette.indigo);
  set("--color-indigo", palette.indigo);

  set("--panel-inset", palette.panelInset);
  set("--panel-shadow", palette.shadow);
}

interface ReadingBackgroundContextValue {
  optionId: string;
  setOption(option: ReadingBackgroundOption): void;
  reset(): void;
}

const ReadingBackgroundContext =
  createContext<ReadingBackgroundContextValue | null>(null);

export function useReadingBackground(): ReadingBackgroundContextValue {
  const context = useContext(ReadingBackgroundContext);
  if (!context) {
    throw new Error("useReadingBackground must be used inside its provider");
  }
  return context;
}

export function ReadingBackgroundProvider({ children }: { children: ReactNode }) {
  const [option, setOptionState] = useState(DEFAULT_OPTION);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const storedId = window.localStorage.getItem(STORAGE_KEY);
      const stored = READING_BACKGROUND_OPTIONS.find(
        (candidate) => candidate.id === storedId,
      );
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe local preference
        setOptionState(stored);
        applyOption(stored);
        setHydrated(true);
        return;
      }
    } catch {
      // storage is optional; fall back to the default paper
    }
    setHydrated(true);
    applyOption(DEFAULT_OPTION);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, option.id);
    } catch {
      // storage is optional
    }
  }, [hydrated, option]);

  const setOption = useCallback((next: ReadingBackgroundOption) => {
    setOptionState(next);
    applyOption(next);
  }, []);

  const reset = useCallback(() => {
    setOptionState(DEFAULT_OPTION);
    applyOption(DEFAULT_OPTION);
  }, []);

  const value = useMemo(
    () => ({ optionId: option.id, setOption, reset }),
    [option.id, setOption, reset],
  );

  return (
    <ReadingBackgroundContext.Provider value={value}>
      {children}
    </ReadingBackgroundContext.Provider>
  );
}
