import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="font-serif text-6xl text-cinnabar/70">404</p>
      <h1 className="mt-4 font-serif text-2xl">此页不在舆图之中</h1>
      <p className="mt-3 text-sm leading-7 text-ink-soft">
        链接可能已失效，或对应的书与章节已被删除。
      </p>
      <Link className="btn btn-primary mt-6" href="/">
        返回书库
      </Link>
    </main>
  );
}
