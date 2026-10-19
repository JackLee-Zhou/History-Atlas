"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { errorMessage, fetchJson, readNdjson } from "@/lib/client/http";
import type {
  Analysis,
  AnalysisInput,
  AnalysisStreamEvent,
} from "@/lib/schema";

export type AnalysisRunnerState = {
  analysis: Analysis | null;
  busy: boolean;
  error: string | null;
};

function analysisStorageKey(chapterId: string): string {
  return `history-atlas:analysis:${chapterId}`;
}

function readSavedAnalysisId(chapterId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(analysisStorageKey(chapterId));
  } catch {
    return null;
  }
}

export function useAnalysisRunner(options: {
  bookId: string;
  chapterId: string;
  initialAnalysis?: Analysis | null;
  onResult?: (analysis: Analysis) => void;
}) {
  const { bookId, chapterId, initialAnalysis, onResult } = options;
  const [localAnalysis, setLocalAnalysis] = useState<Analysis | null>(
    initialAnalysis ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [savedId] = useState<string | null>(() =>
    readSavedAnalysisId(chapterId),
  );

  const { data: restored, isLoading: restoring } = useSWR<{
    analysis: Analysis;
  }>(savedId ? `/api/analyses/${savedId}` : null, fetchJson, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const restoredAnalysis =
    restored?.analysis &&
    restored.analysis.bookId === bookId &&
    restored.analysis.chapterId === chapterId
      ? restored.analysis
      : null;

  // Precedence: a result produced in this session (or a user correction) wins,
  // then an explicit ?analysis= from the URL, then the chapter's last analysis.
  const analysis = localAnalysis ?? initialAnalysis ?? restoredAnalysis;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (mountedRef.current) setBusy(false);
  }, []);

  const run = useCallback(
    async (input: AnalysisInput): Promise<Analysis | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);

      try {
        const response = await fetch("/api/analyses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson",
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        });

        let result: Analysis | null = null;
        for await (const event of readNdjson<AnalysisStreamEvent>(
          response,
          controller.signal,
        )) {
          if (!mountedRef.current) return result;
          if (event.type === "result") {
            result = event.analysis;
            setLocalAnalysis(event.analysis);
            try {
              window.localStorage.setItem(
                analysisStorageKey(chapterId),
                event.analysis.id,
              );
            } catch {
              // storage may be disabled; the analysis is still persisted server-side
            }
            onResult?.(event.analysis);
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
        if (!result) {
          throw new Error("分析没有返回结果，请重试。");
        }
        return result;
      } catch (caught) {
        if (controller.signal.aborted) return null;
        const message = errorMessage(caught);
        if (mountedRef.current) setError(message);
        toast.error(message);
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (mountedRef.current) setBusy(false);
      }
    },
    [chapterId, onResult],
  );

  const replaceAnalysis = useCallback((next: Analysis | null) => {
    setLocalAnalysis(next);
  }, []);

  return {
    analysis,
    busy,
    error,
    restoring,
    run,
    cancel,
    replaceAnalysis,
    setAnalysis: setLocalAnalysis,
  };
}
