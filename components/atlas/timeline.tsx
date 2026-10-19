"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { Scene } from "@/lib/schema";

export interface AtlasTimelineProps {
  scenes: Scene[];
  activeIndex: number;
  onIndexChange(index: number): void;
  /** Controlled playback state; when omitted the timeline manages its own. */
  playing?: boolean;
  onPlayingChange?(playing: boolean): void;
  className?: string;
}

const PLAYBACK_INTERVAL_MS = 3200;

export function AtlasTimeline({
  scenes,
  activeIndex,
  onIndexChange,
  playing: playingProp,
  onPlayingChange,
  className,
}: AtlasTimelineProps) {
  const [internalPlaying, setInternalPlaying] = useState(false);
  const isPlaying = playingProp ?? internalPlaying;
  const sceneCount = scenes.length;
  const maxIndex = Math.max(0, sceneCount - 1);
  const safeIndex = Math.min(Math.max(0, activeIndex), maxIndex);
  const currentScene = scenes[safeIndex];

  const callbacks = useRef({ onIndexChange, onPlayingChange });
  useEffect(() => {
    callbacks.current = { onIndexChange, onPlayingChange };
  });

  useEffect(() => {
    if (!isPlaying || sceneCount < 2) return;

    const timer = window.setTimeout(() => {
      if (safeIndex >= sceneCount - 1) {
        if (callbacks.current.onPlayingChange) {
          callbacks.current.onPlayingChange(false);
        } else {
          setInternalPlaying(false);
        }
        return;
      }
      callbacks.current.onIndexChange(safeIndex + 1);
    }, PLAYBACK_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [isPlaying, safeIndex, sceneCount]);

  const changePlaying = (next: boolean) => {
    if (onPlayingChange) {
      onPlayingChange(next);
    } else {
      setInternalPlaying(next);
    }
  };

  if (sceneCount === 0) {
    return (
      <p className={cn("text-xs text-ink-faint", className)}>
        这次分析没有分幕，整段态势显示在同一张图上。
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="上一幕"
            title="上一幕"
            disabled={safeIndex <= 0}
            onClick={() => onIndexChange(safeIndex - 1)}
          >
            <SkipBack className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant={isPlaying ? "primary" : "outline"}
            size="icon"
            aria-label={isPlaying ? "暂停播放" : "播放时间轴"}
            title={isPlaying ? "暂停播放" : "播放时间轴"}
            disabled={sceneCount < 2}
            onClick={() => changePlaying(!isPlaying)}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="下一幕"
            title="下一幕"
            disabled={safeIndex >= maxIndex}
            onClick={() => onIndexChange(safeIndex + 1)}
          >
            <SkipForward className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-sm text-ink">
            {currentScene?.title ?? "全篇"}
          </p>
          <p className="truncate text-[11px] text-ink-soft">
            {currentScene?.timeLabel ?? "未标注时间"}
          </p>
        </div>

        <span className="chip shrink-0">
          第 {safeIndex + 1} / {sceneCount} 幕
        </span>
      </div>

      <Slider
        value={[safeIndex]}
        min={0}
        max={maxIndex}
        step={1}
        disabled={sceneCount < 2}
        aria-label="时间幕"
        onValueChange={(values) => {
          const next = values[0];
          if (next !== undefined && next !== safeIndex) onIndexChange(next);
        }}
      />

      <div className="flex items-center justify-between text-[11px] text-ink-faint">
        <span>拖动时间轴查看态势演变</span>
        <span className="hidden sm:inline">键盘 ← →</span>
      </div>
    </div>
  );
}
