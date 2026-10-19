"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render error", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="font-serif text-5xl text-cinnabar/70">出错</p>
      <h1 className="mt-4 font-serif text-2xl">这一步没能走通</h1>
      <p className="mt-3 max-w-md text-sm leading-7 text-ink-soft">
        页面渲染时发生错误。可以重试；若反复出现，请检查服务端日志。
      </p>
      <div className="mt-6 flex gap-3">
        <button className="btn btn-primary" onClick={reset}>
          重试
        </button>
        <Link className="btn" href="/">
          返回书库
        </Link>
      </div>
    </main>
  );
}
