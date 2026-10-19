import Link from "next/link";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { getSettingsView } from "@/lib/server/store";
import { AppHeader } from "@/components/layout/AppHeader";

export const metadata = { title: "设置" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettingsView();
  return (
    <main className="library-room min-h-dvh">
      <AppHeader
        contained
        title="设置"
        subtitle="模型、地名补全与自动生成"
        eyebrow="史地舆图 · 书斋"
        backHref="/"
        right={
          <Link className="btn btn-ghost text-xs" href="/">
            返回书斋
          </Link>
        }
      />
      <div className="library-shell pt-7">
        <SettingsPanel initialSettings={settings} />
        <p className="mt-8 text-center text-[10px] tracking-[0.04em] text-ink-faint">
          底图 Natural Earth · 地名 GeoNames
        </p>
      </div>
    </main>
  );
}
