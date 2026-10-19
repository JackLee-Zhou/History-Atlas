import { notFound } from "next/navigation";
import { WorkspaceClient } from "@/components/workspace/WorkspaceClient";
import { MissingBook } from "@/components/workspace/MissingBook";
import { DEMO_BOOK_ID } from "@/lib/constants";
import {
  getStoredBook,
  getAnalysis,
  getLatestAnalysisForChapter,
} from "@/lib/server/store";
import type { Analysis } from "@/lib/schema";

export const dynamic = "force-dynamic";

export default async function BookChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string; chapterId: string }>;
  searchParams: Promise<{ analysis?: string }>;
}) {
  const { bookId, chapterId } = await params;
  const { analysis: analysisId } = await searchParams;

  const stored = await getStoredBook(bookId);
  if (!stored) {
    if (bookId === DEMO_BOOK_ID) {
      return <MissingBook bookId={bookId} seedable />;
    }
    notFound();
  }

  const chapter = stored.chapters.find((item) => item.id === chapterId);
  if (!chapter) notFound();

  let initialAnalysis: Analysis | null = null;
  if (analysisId && /^[A-Za-z0-9_-]{1,200}$/.test(analysisId)) {
    const candidate = await getAnalysis(analysisId);
    if (
      candidate &&
      candidate.bookId === stored.book.id &&
      candidate.chapterId === chapter.id
    ) {
      initialAnalysis = candidate;
    }
  }
  // Without an explicit ?analysis=, reopen the most recent analysis for this
  // chapter so the map can follow the reader immediately.
  if (!initialAnalysis) {
    initialAnalysis = await getLatestAnalysisForChapter(
      stored.book.id,
      chapter.id,
    );
  }

  return (
    <WorkspaceClient
      book={stored.book}
      chapter={chapter}
      initialAnalysis={initialAnalysis}
    />
  );
}
