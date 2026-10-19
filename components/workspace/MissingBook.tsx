"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetchJson, errorMessage } from "@/lib/client/http";
import type { Analysis, Book } from "@/lib/schema";

export function MissingBook({
  bookId,
  seedable,
}: {
  bookId: string;
  seedable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function seed() {
    setBusy(true);
    try {
      const result = await fetchJson<{ book: Book; analysis?: Analysis }>(
        "/api/demo/seed",
        { method: "POST" },
      );
      const chapterId =
        result.analysis?.chapterId ?? result.book.chapters[0]?.id;
      if (!chapterId) {
        toast.error("示例数据不完整，请重试");
        return;
      }
      const query = result.analysis
        ? `?analysis=${encodeURIComponent(result.analysis.id)}`
        : "";
      router.push(
        `/book/${result.book.id}/${chapterId}${query}`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-4 pb-12 sm:px-6">
      <AppHeader title="书未载入" backHref="/" />
      <div className="paper-panel mt-8 flex flex-col items-center gap-4 rounded-sm p-8 text-center">
        <span className="seal h-12 w-12">
          <BookOpen className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="font-serif text-xl">没有找到这本书</h1>
        <p className="max-w-md text-sm leading-7 text-ink-soft">
          {seedable
            ? "这个链接指向内置的赤壁示例，但示例书还没有载入本机。点一下即可导入公版节选和样板分析。"
            : "书目可能已被删除，或这个链接来自另一个本地实例。"}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {seedable ? (
            <Button variant="primary" onClick={() => void seed()} disabled={busy}>
              {busy ? (
                <Spinner className="h-4 w-4" label="载入示例" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              载入赤壁示例
            </Button>
          ) : null}
          <Link className="btn" href="/">
            返回书库
          </Link>
        </div>
        <p className="text-[10px] text-ink-faint">bookId: {bookId}</p>
      </div>
    </main>
  );
}
