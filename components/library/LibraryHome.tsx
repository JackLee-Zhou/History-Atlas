"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { BookCover, coverStyleFor } from "@/components/library/BookCover";
import { DeleteBookDialog } from "@/components/library/DeleteBookDialog";
import { fetchJson, errorMessage } from "@/lib/client/http";
import type { Analysis, Book } from "@/lib/schema";

type BooksResponse = { books: Book[] };
type SeedResponse = { book: Book; analysis?: Analysis };
type LastRead = { bookId: string; chapterId: string };
type BusyAction = "import" | "delete" | "seed" | null;

const LAST_READ_KEY = "history-atlas.last-read";
const ACCEPT = ".epub,.pdf,.txt,application/epub+zip,application/pdf,text/plain";

function readLastRead(): LastRead | null {
  try {
    const raw = window.localStorage.getItem(LAST_READ_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastRead>;
    if (
      typeof parsed.bookId === "string" &&
      typeof parsed.chapterId === "string"
    ) {
      return { bookId: parsed.bookId, chapterId: parsed.chapterId };
    }
  } catch {
    // localStorage is optional
  }
  return null;
}

function BookTile({
  book,
  index,
  onOpen,
  onDelete,
}: {
  book: Book;
  index: number;
  onOpen(book: Book, origin: DOMRect): void;
  onDelete(book: Book): void;
}) {
  const style = coverStyleFor(book);
  return (
    <article className="book-tile">
      <div className="book-tile__cover-wrap">
        <button
          type="button"
          className="book-tile__open"
          onClick={(event) =>
            onOpen(book, event.currentTarget.getBoundingClientRect())
          }
          aria-label={`启卷阅读《${book.title}》`}
          style={{ "--cover": style.background } as CSSProperties}
        >
          <BookCover book={book} />
        </button>
        <button
          type="button"
          className="book-tile__delete"
          onClick={() => onDelete(book)}
          aria-label={`移出《${book.title}》`}
          title="移出书架"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="book-tile__meta">
        <h3>{book.title}</h3>
        <p>{book.author || "佚名"}</p>
      </div>
      <span className="sr-only">
        第 {index + 1} 本，共 {book.chapters.length} 章
      </span>
    </article>
  );
}

export function LibraryHome() {
  const router = useRouter();
  const [lastRead, setLastRead] = useState<LastRead | null>(null);
  const [sortMode, setSortMode] = useState<"recent" | "imported">("recent");
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [opening, setOpening] = useState<{
    url: string;
    rect: { left: number; top: number; width: number; height: number };
    coverColor: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef<BusyAction>(null);
  const openingTimer = useRef<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is unavailable during SSR
    setLastRead(readLastRead());
  }, []);

  useEffect(
    () => () => {
      if (openingTimer.current !== null) {
        window.clearTimeout(openingTimer.current);
      }
    },
    [],
  );

  const {
    data: booksData,
    error,
    isLoading,
    mutate,
  } = useSWR<BooksResponse>("/api/books", fetchJson);
  const books = useMemo(() => booksData?.books ?? [], [booksData?.books]);

  const currentBook = useMemo(() => {
    const preferred = lastRead
      ? books.find((book) => book.id === lastRead.bookId)
      : undefined;
    return preferred ?? books[0] ?? null;
  }, [books, lastRead]);

  const currentChapter = useMemo(() => {
    if (!currentBook) return null;
    if (lastRead?.bookId === currentBook.id) {
      const match = currentBook.chapters.find(
        (chapter) => chapter.id === lastRead.chapterId,
      );
      if (match) return match;
    }
    return currentBook.chapters[0] ?? null;
  }, [currentBook, lastRead]);

  const chapterIndex = currentBook?.chapters.findIndex(
    (chapter) => chapter.id === currentChapter?.id,
  );
  const progress =
    lastRead &&
    currentBook &&
    currentBook.chapters.length > 0 &&
    chapterIndex !== undefined
      ? Math.max(
          1,
          Math.round(
            ((Math.max(0, chapterIndex) + 1) / currentBook.chapters.length) *
              100,
          ),
        )
      : 0;
  const continueHref =
    currentBook && currentChapter
      ? `/book/${currentBook.id}/${currentChapter.id}`
      : null;

  const showAddTile = books.length < 5;

  const sortedBooks = useMemo(() => {
    const copy = [...books];
    copy.sort((a, b) => {
      if (sortMode === "recent") {
        const aCurrent = a.id === lastRead?.bookId ? 1 : 0;
        const bCurrent = b.id === lastRead?.bookId ? 1 : 0;
        if (aCurrent !== bCurrent) return bCurrent - aCurrent;
      }
      return b.importedAt.localeCompare(a.importedAt);
    });
    return copy;
  }, [books, lastRead?.bookId, sortMode]);

  const withBusy = useCallback(
    async (
      action: Exclude<BusyAction, null>,
      task: () => Promise<void>,
      successMessage: string,
    ): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = action;
      setBusy(action);
      try {
        await task();
        toast.success(successMessage);
        return true;
      } catch (taskError) {
        toast.error(errorMessage(taskError));
        return false;
      } finally {
        busyRef.current = null;
        setBusy(null);
      }
    },
    [],
  );

  const remember = useCallback((bookId: string, chapterId: string) => {
    try {
      window.localStorage.setItem(
        LAST_READ_KEY,
        JSON.stringify({ bookId, chapterId }),
      );
    } catch {
      // localStorage is optional
    }
  }, []);

  const handleImportFile = useCallback(
    async (file: File): Promise<void> => {
      const form = new FormData();
      form.append("file", file, file.name);
      const result = await fetchJson<{ book: Book }>("/api/books", {
        method: "POST",
        body: form,
      });
      await mutate();
      const chapter = result.book.chapters[0];
      if (chapter) {
        remember(result.book.id, chapter.id);
        router.push(`/book/${result.book.id}/${chapter.id}`);
      }
    },
    [mutate, remember, router],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      await fetchJson<{ ok: true }>(`/api/books/${id}`, { method: "DELETE" });
      await mutate();
    },
    [mutate],
  );

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await withBusy(
      "import",
      () => handleImportFile(file),
      `《${file.name}》已收入书架`,
    );
  };

  const handleDeleteConfirm = async (book: Book): Promise<void> => {
    const success = await withBusy(
      "delete",
      () => handleDelete(book.id),
      `《${book.title}》已移出书架`,
    );
    if (success) setDeleteTarget(null);
  };

  const handleSeedDemo = async (): Promise<void> => {
    const success = await withBusy(
      "seed",
      async () => {
        const result = await fetchJson<SeedResponse>("/api/demo/seed", {
          method: "POST",
        });
        await mutate();
        const chapterId =
          result.analysis?.chapterId ?? result.book.chapters[0]?.id;
        if (!chapterId) throw new Error("示例数据不完整");
        remember(result.book.id, chapterId);
        const query = result.analysis
          ? `?analysis=${encodeURIComponent(result.analysis.id)}`
          : "";
        router.push(`/book/${result.book.id}/${chapterId}${query}`);
      },
      "赤壁样板已收入书架",
    );
    if (!success) return;
  };

  const handleOpen = useCallback(
    (book: Book, origin: DOMRect) => {
      const chapter = book.chapters[0];
      if (!chapter) {
        toast.error("这本书还没有可阅读的章节");
        return;
      }
      remember(book.id, chapter.id);
      const url = `/book/${book.id}/${chapter.id}`;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.push(url);
        return;
      }
      setOpening({
        url,
        rect: {
          left: origin.left,
          top: origin.top,
          width: origin.width,
          height: origin.height,
        },
        coverColor: coverStyleFor(book).background,
      });
      if (openingTimer.current !== null) {
        window.clearTimeout(openingTimer.current);
      }
      openingTimer.current = window.setTimeout(() => {
        router.push(url);
      }, 560);
    },
    [remember, router],
  );

  return (
    <main className="shelf-page">
      <header className="shelf-header">
        <div className="shelf-header__inner">
          <Link href="/" className="shelf-seal" aria-label="书架首页">
            阅
          </Link>
          <div className="shelf-header__tools">
            <Link
              href="/settings"
              className="shelf-icon-button"
              aria-label="设置"
              title="设置"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <div className="shelf-container">
        <section className="shelf-hero" aria-labelledby="shelf-title">
          <div>
            <h1 id="shelf-title">我的书架</h1>
            <p>在书页之间，留一点时间给自己。</p>
          </div>
          <div className="shelf-hero__actions">
            <button
              type="button"
              className="shelf-import"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy !== null}
            >
              <Plus className="h-4 w-4" aria-hidden />
              导入书籍
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(event) => void handleFileChange(event)}
            />
          </div>
        </section>

        {currentBook && continueHref ? (
          <section className="shelf-continue" aria-label="继续阅读">
            <span className="shelf-continue__label">继续阅读</span>
            <div className="shelf-continue__mini" aria-hidden>
              <BookCover book={currentBook} compact />
            </div>
            <div className="shelf-continue__info">
              <p>{currentBook.title}</p>
              <span>
                {lastRead
                  ? `上次读到 ${progress}%`
                  : "尚未开卷，从这一页开始"}
              </span>
            </div>
            <div className="shelf-continue__progress" aria-hidden>
              <span className="shelf-progress">
                <i style={{ width: `${progress}%` }} />
              </span>
              <em>{progress}%</em>
            </div>
            <Link href={continueHref} className="shelf-continue__action">
              接着读
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </section>
        ) : null}

        <div className="shelf-tabs">
          <span className="shelf-tab is-active">
            全部
            <em>{books.length} 种</em>
          </span>
          <button
            type="button"
            className="shelf-sort"
            onClick={() =>
              setSortMode((current) =>
                current === "recent" ? "imported" : "recent",
              )
            }
            aria-label={
              sortMode === "recent" ? "按最近阅读排序" : "按最近导入排序"
            }
          >
            {sortMode === "recent" ? "最近阅读" : "最近导入"}
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        {error ? (
          <div className="shelf-error">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            书库读取失败：{errorMessage(error)}
            <button type="button" onClick={() => void mutate()}>
              重试
            </button>
          </div>
        ) : null}

        {isLoading && books.length === 0 ? (
          <div className="book-grid" aria-label="正在载入书架">
            {[0, 1, 2, 3, 4].map((item) => (
              <div className="book-skeleton" key={item}>
                <span />
                <i />
                <i />
              </div>
            ))}
          </div>
        ) : sortedBooks.length === 0 ? (
          <div className="shelf-empty">
            <p>书架还空着。</p>
            <div>
              <button
                type="button"
                className="shelf-import"
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus className="h-4 w-4" aria-hidden />
                导入第一本书
              </button>
              <button
                type="button"
                className="shelf-empty__demo"
                onClick={() => void handleSeedDemo()}
                disabled={busy !== null}
              >
                放入赤壁示例
              </button>
            </div>
          </div>
        ) : (
          <div className="book-grid">
            {sortedBooks.map((book, index) => (
              <BookTile
                key={book.id}
                book={book}
                index={index}
                onOpen={handleOpen}
                onDelete={setDeleteTarget}
              />
            ))}
            {showAddTile ? (
              <button
                type="button"
                className="book-tile book-tile--add"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy !== null}
              >
                <span className="book-add-cover">
                  <Plus className="h-5 w-5" aria-hidden />
                  <span>导入书籍</span>
                </span>
                <span className="book-tile__meta">
                  <span>EPUB · PDF · TXT</span>
                </span>
              </button>
            ) : null}
          </div>
        )}
      </div>

      <DeleteBookDialog
        book={deleteTarget}
        busy={busy === "delete"}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={handleDeleteConfirm}
      />

      {opening ? (
        <div
          className="book-opening"
          aria-hidden
          style={
            {
              "--open-x": `${opening.rect.left + opening.rect.width / 2 - window.innerWidth / 2}px`,
              "--open-y": `${opening.rect.top + opening.rect.height / 2 - window.innerHeight / 2}px`,
              "--open-sx": opening.rect.width / window.innerWidth,
              "--open-sy": opening.rect.height / window.innerHeight,
              "--open-cover": opening.coverColor,
            } as CSSProperties
          }
        >
          <div className="book-opening__sheet">
            <span className="book-opening__seal">阅</span>
            <span className="book-opening__rod book-opening__rod--top" />
            <span className="book-opening__rod book-opening__rod--bottom" />
          </div>
        </div>
      ) : null}
    </main>
  );
}
