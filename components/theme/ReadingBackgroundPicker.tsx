"use client";

import { useState } from "react";
import { Check, Palette, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  READING_BACKGROUND_OPTIONS,
  useReadingBackground,
} from "./ReadingBackgroundProvider";

export function ReadingBackgroundPicker() {
  const { optionId, setOption, reset } = useReadingBackground();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-paper/70"
          aria-label="选择阅读背景色"
          title="选择阅读背景色（全局生效）"
        >
          <Palette className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">背景</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="font-serif text-sm text-ink">阅读背景</p>
        <p className="mt-1 text-[11px] leading-5 text-ink-faint">
          全局生效并记住选择；夜间模式会同时切换文字、边框和面板颜色。
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {READING_BACKGROUND_OPTIONS.map((option) => {
            const active = optionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setOption(option);
                  setOpen(false);
                }}
                className={cn(
                  "group flex flex-col items-center gap-1 rounded-sm border p-1.5 transition-colors",
                  active
                    ? "border-cinnabar/60 bg-cinnabar/5"
                    : "border-line/60 hover:border-cinnabar/35",
                )}
                aria-label={`选择${option.label}背景`}
                aria-pressed={active}
              >
                <span
                  className="relative flex h-9 w-full items-center justify-center rounded-[2px] border border-black/5"
                  style={{ background: option.color }}
                >
                  {active ? (
                    <Check
                      className={cn(
                        "h-3.5 w-3.5",
                        option.dark ? "text-[#ece6da]" : "text-cinnabar",
                      )}
                      aria-hidden
                    />
                  ) : null}
                </span>
                <span className="text-[10px] text-ink-soft">{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line/60 pt-3">
          <span className="text-[10px] text-ink-faint">
            宣纸 / 米白 / 月白适合白天，夜间适合暗光
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            恢复默认
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
