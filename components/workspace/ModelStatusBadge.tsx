"use client";

import Link from "next/link";
import useSWR from "swr";
import { Cpu, KeyRound, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchJson } from "@/lib/client/http";
import type { SettingsView } from "@/lib/schema";
import { PROVIDER_LABELS } from "@/lib/constants";

type StatusResponse = {
  settings: SettingsView;
  counts: {
    books: number;
    analyses: number;
    corrections: number;
    cacheBytes: number;
  };
};

export function ModelStatusBadge({ className }: { className?: string }) {
  const { data } = useSWR<StatusResponse>("/api/status", fetchJson, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  const settings = data?.settings;
  const configured =
    settings?.provider === "mock" ||
    settings?.provider === "rule" ||
    Boolean(settings?.hasKey);

  return (
    <Link
      href="/settings"
      className={className}
      aria-label="模型设置"
      title="打开模型设置"
    >
      <Badge tone={configured ? "high" : "muted"}>
        {settings?.provider === "rule" ? (
          <>
            <ShieldQuestion className="h-3 w-3" /> 规则模式
          </>
        ) : settings?.provider === "mock" ? (
          <>
            <Cpu className="h-3 w-3" /> 演示模式
          </>
        ) : settings?.hasKey ? (
          <>
            <Cpu className="h-3 w-3" />
            {settings.model ? `已连接 · ${settings.model}` : PROVIDER_LABELS[settings.provider]}
          </>
        ) : (
          <>
            <KeyRound className="h-3 w-3" /> 未配置模型
          </>
        )}
      </Badge>
    </Link>
  );
}
