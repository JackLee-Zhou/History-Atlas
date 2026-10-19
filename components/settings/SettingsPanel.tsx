"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { fetchJson, errorMessage } from "@/lib/client/http";
import type {
  Geocoder,
  Provider,
  SettingsTestResult,
  SettingsUpdate,
  SettingsView,
} from "@/lib/schema";
import { PROVIDER_LABELS, PROVIDER_PRESETS } from "@/lib/constants";
import { cn } from "@/lib/utils";

type PresetKey = "rule" | "mock" | "deepseek" | "openai" | "ollama" | "custom";

type FormState = {
  preset: PresetKey;
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey: string;
  geocoder: Geocoder;
  autoAnalyze: boolean;
};

function detectPreset(view: SettingsView): PresetKey {
  if (view.provider === "rule") return "rule";
  if (view.provider === "mock") return "mock";
  if (view.provider === "ollama") return "ollama";
  const base = view.baseUrl ?? "";
  if (base.includes("deepseek")) return "deepseek";
  if (base.includes("openai.com")) return "openai";
  return "custom";
}

const PRESET_LABELS: Record<PresetKey, string> = {
  rule: "规则模式（无需 key）",
  mock: "演示模式（测试用）",
  deepseek: "DeepSeek（推荐）",
  openai: "OpenAI",
  ollama: "Ollama 本地",
  custom: "自定义 OpenAI 兼容",
};

function stateFromView(view: SettingsView): FormState {
  return {
    preset: detectPreset(view),
    provider: view.provider,
    baseUrl: view.baseUrl ?? "",
    model: view.model ?? "",
    apiKey: "",
    geocoder: view.geocoder,
    autoAnalyze: view.autoAnalyze,
  };
}

export function SettingsPanel({
  initialSettings,
}: {
  initialSettings: SettingsView;
}) {
  const [settings, setSettings] = useState<SettingsView>(initialSettings);
  const [form, setForm] = useState<FormState>(() =>
    stateFromView(initialSettings),
  );
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const pendingSavesRef = useRef(0);
  const saveQueueRef = useRef<Promise<SettingsView | null>>(
    Promise.resolve(null),
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SettingsTestResult | null>(null);
  const [clearing, setClearing] = useState(false);

  const isLocal = form.provider === "ollama";
  const needsCredentials =
    form.provider === "openai" || form.provider === "ollama";
  function buildUpdate(overrides: Partial<FormState> = {}): SettingsUpdate {
    const next = { ...form, ...overrides };
    return {
      provider: next.provider,
      // Empty string is meaningful: it clears a previously saved URL/model.
      baseUrl: next.baseUrl.trim(),
      model: next.model.trim(),
      geocoder: next.geocoder,
      autoAnalyze: next.autoAnalyze,
    };
  }

  async function enqueueSave(
    payload: SettingsUpdate,
  ): Promise<SettingsView | null> {
    pendingSavesRef.current += 1;
    setAutoSaving(true);
    const run = async (): Promise<SettingsView | null> => {
      try {
        return await fetchJson<SettingsView>("/api/settings", {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } catch (err) {
        toast.error(errorMessage(err));
        return null;
      } finally {
        pendingSavesRef.current -= 1;
        if (pendingSavesRef.current === 0) setAutoSaving(false);
      }
    };
    const task = saveQueueRef.current.then(run, run);
    saveQueueRef.current = task;
    return task;
  }

  async function autoSave(overrides: Partial<FormState> = {}) {
    const updated = await enqueueSave(buildUpdate(overrides));
    if (updated) setSettings(updated);
    return updated;
  }

  function applyPreset(preset: PresetKey) {
    let next = { ...form, preset };
    if (preset === "rule" || preset === "mock") {
      next = { ...next, provider: preset };
    } else if (preset === "ollama") {
      next = {
        ...next,
        provider: "ollama",
        baseUrl: PROVIDER_PRESETS.ollama.baseUrl,
        model: PROVIDER_PRESETS.ollama.model,
      };
    } else if (preset === "deepseek" || preset === "openai") {
      const target = PROVIDER_PRESETS[preset];
      next = {
        ...next,
        provider: "openai",
        baseUrl: target.baseUrl,
        model: target.model,
      };
    } else {
      next = { ...next, provider: "openai" };
    }
    setForm(next);
    setTestResult(null);
    void autoSave(next);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await fetchJson<SettingsTestResult>("/api/settings/test", {
        method: "POST",
        body: JSON.stringify({
          provider: form.provider,
          baseUrl: form.baseUrl.trim() || undefined,
          model: form.model.trim() || undefined,
          apiKey: form.apiKey.trim() || undefined,
        }),
      });
      setTestResult(result);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      const message = errorMessage(err);
      setTestResult({ ok: false, message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }

  async function saveKey() {
    const apiKey = form.apiKey.trim();
    if (!apiKey) return;
    setSaving(true);
    try {
      const updated = await enqueueSave({ ...buildUpdate(), apiKey });
      if (!updated) return;
      setSettings(updated);
      setForm((current) => ({
        ...current,
        apiKey: "",
        preset: detectPreset(updated),
        provider: updated.provider,
        baseUrl: updated.baseUrl ?? "",
        model: updated.model ?? "",
        geocoder: updated.geocoder,
        autoAnalyze: updated.autoAnalyze,
      }));
      toast.success("API Key 已保存");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    if (!window.confirm("清除已保存的 API key？之后将回到规则模式，直到重新填写。")) {
      return;
    }
    setClearing(true);
    try {
      const updated = await fetchJson<SettingsView>("/api/settings/key", {
        method: "DELETE",
      });
      setSettings(updated);
      setForm(stateFromView(updated));
      setTestResult(null);
      toast.success("已清除 key");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
      <section className="paper-panel rounded-sm p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl">模型服务</h2>
            <p className="mt-1 text-xs leading-6 text-ink-soft">
              key 只保存在本机服务端 SQLite，页面只会看到掩码。
            </p>
          </div>
          <Badge tone={settings.hasKey ? "high" : "muted"}>
            {settings.hasKey ? (
              <>
                <CheckCircle2 className="h-3 w-3" /> 已配置
              </>
            ) : (
              <>
                <Unplug className="h-3 w-3" /> 未配置
              </>
            )}
          </Badge>
        </div>

        <div className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-soft">
              服务预设
            </span>
            <Select
              value={form.preset}
              onChange={(event) => applyPreset(event.target.value as PresetKey)}
            >
              {(Object.keys(PRESET_LABELS) as PresetKey[]).map((key) => (
                <option key={key} value={key}>
                  {PRESET_LABELS[key]}
                </option>
              ))}
            </Select>
          </label>

          {needsCredentials ? (
            <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-soft">
                      Base URL
                    </span>
                    <Input
                      value={form.baseUrl}
                      onChange={(event) =>
                        setForm({ ...form, baseUrl: event.target.value })
                      }
                      onBlur={() => void autoSave()}
                      placeholder="https://api.deepseek.com/v1"
                      disabled={!needsCredentials}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-soft">
                      模型名
                    </span>
                    <Input
                      value={form.model}
                      onChange={(event) =>
                        setForm({ ...form, model: event.target.value })
                      }
                      onBlur={() => void autoSave()}
                      placeholder="deepseek-chat"
                      disabled={!needsCredentials}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1.5 flex items-center gap-2 text-xs font-medium tracking-wide text-ink-soft">
                    API Key
                    <span className="font-normal text-ink-faint">
                      {isLocal ? "（Ollama 通常无需填写）" : "（必填）"}
                    </span>
                  </span>
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={form.apiKey}
                      onChange={(event) =>
                        setForm({ ...form, apiKey: event.target.value })
                      }
                      placeholder={
                        settings.hasKey ? `已保存 ${settings.keyMasked ?? ""}，留空表示不修改` : "sk-..."
                      }
                      disabled={!needsCredentials}
                      autoComplete="new-password"
                      spellCheck={false}
                      className="pr-11"
                    />
                    <button
                      type="button"
                      className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
                      onClick={() => setShowKey((value) => !value)}
                      aria-label={showKey ? "隐藏 key" : "显示 key"}
                      tabIndex={needsCredentials ? 0 : -1}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-5 text-ink-faint">
                    不要把 key 发到聊天或截图里。保存后接口只返回掩码，不返回明文。
                  </p>
                </label>
            </>
          ) : (
            <div className="rounded-sm border border-dashed border-line/70 bg-paper-deep/30 p-3 text-xs leading-6 text-ink-soft">
              当前为规则/演示模式，不需要 Base URL、模型名或 API key。切换到 DeepSeek、OpenAI 或 Ollama 后再填写。
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-4">
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={!needsCredentials || testing}
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              测试连接
            </Button>
            {needsCredentials ? (
              <Button
                variant="primary"
                onClick={() => void saveKey()}
                disabled={!form.apiKey.trim() || saving}
                title="只保存 API Key；其他设置已自动保存"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                保存 Key
              </Button>
            ) : null}
            {settings.hasKey ? (
              <Button variant="danger" onClick={clearKey} disabled={clearing}>
                <Trash2 className="h-4 w-4" /> 清除 key
              </Button>
            ) : null}
            {autoSaving ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                正在自动保存…
              </span>
            ) : null}
            {testResult ? (
              <span
                className={cn(
                  "text-xs",
                  testResult.ok ? "text-moss" : "text-cinnabar",
                )}
              >
                {testResult.message}
                {testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-8 border-t border-line/60 pt-5">
          <h2 className="font-serif text-xl">其他偏好</h2>
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-soft">
                地名补全
              </span>
              <Select
                value={form.geocoder}
                onChange={(event) => {
                  const geocoder = event.target.value as Geocoder;
                  setForm({ ...form, geocoder });
                  void autoSave({ geocoder });
                }}
              >
                <option value="none">关闭（仅用内置地名库）</option>
                <option value="nominatim">Nominatim（尚未接入，当前不生效）</option>
              </Select>
              <p className="mt-1.5 text-[11px] leading-5 text-ink-faint">
                当前版本只使用内置现代地名库；联网地理编码（Nominatim）尚未接入，选择后暂不生效。
              </p>
            </label>

            <div className="flex items-start justify-between gap-4 rounded-sm border border-line/60 bg-paper-deep/30 p-3">
              <div>
                <p className="text-sm">阅读时自动生成态势</p>
                <p className="mt-1 text-[11px] leading-5 text-ink-soft">
                  切换即保存。开启后打开章节或开始滚动会自动按章生成，结果会缓存。
                </p>
              </div>
              <Switch
                checked={form.autoAnalyze}
                onCheckedChange={(checked) => {
                  setForm({ ...form, autoAnalyze: checked });
                  void autoSave({ autoAnalyze: checked });
                }}
                aria-label="打开章节时自动生成态势"
              />
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="paper-panel rounded-sm p-4 text-xs leading-6 text-ink-soft">
          <p className="font-serif text-base text-ink">当前模式</p>
          <p className="mt-2">
            {PROVIDER_LABELS[form.provider]}
            {form.provider === "rule"
              ? "：只做词典地名标注，不生成态势叙述。"
              : form.provider === "mock"
                ? "：返回固定演示数据，不要用于真实分析。"
                : settings.hasKey
                  ? "：选段将发送到该服务商生成态势。"
                  : "：尚未配置 key。"}
          </p>
        </div>
        <div className="rounded-sm border border-gold/25 bg-gold/8 p-4 text-xs leading-6 text-ink-soft">
          <p className="font-serif text-base text-ink">费用与隐私</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>模型服务按 token 计费，一次选段通常几分钱以内。</li>
            <li>选中原文会发送到你配置的服务商；不配置则不出本机。</li>
            <li>应用不代持、不转售 key；请勿提交到仓库或聊天。</li>
          </ul>
        </div>
        <div className="rounded-sm border border-line/60 p-4 text-[11px] leading-5 text-ink-faint">
          首次使用可先不填 key，回书库载入“赤壁”示例；之后再回来配置。
        </div>
      </aside>
    </div>
  );
}
