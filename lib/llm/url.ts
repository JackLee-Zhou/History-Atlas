import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError, ERROR_CODES } from "@/lib/server/http";
import type { Provider } from "@/lib/schema";

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version !== 6) return true;
  const normalized = ip.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:") ||
    normalized.startsWith("2001:db8")
  );
}

/**
 * Validate the user-configured OpenAI-compatible endpoint before storing it or
 * sending a key to it. Private/loopback targets are allowed only for Ollama
 * (the intended local runtime) or when explicitly opted in.
 */
export async function normalizeLlmBaseUrl(
  raw: string | undefined,
  provider: Provider,
): Promise<string> {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Base URL 格式不正确。", {
      status: 400,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Base URL 必须使用 HTTP 或 HTTPS。", {
      status: 400,
    });
  }
  if (url.username || url.password) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Base URL 不能包含用户名或密码。", {
      status: 400,
    });
  }

  const hostname = url.hostname.toLowerCase();
  const allowPrivate =
    provider === "ollama" || process.env.ALLOW_PRIVATE_LLM === "1";

  if (!allowPrivate) {
    const localHost =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".lan");
    const ipVersion = isIP(hostname);
    if (localHost || (ipVersion !== 0 && isPrivateIp(hostname))) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "出于安全考虑，Base URL 不能指向本机或内网地址；Ollama 本地服务除外，自定义内网服务请设置 ALLOW_PRIVATE_LLM=1。",
        { status: 400 },
      );
    }

    if (ipVersion === 0) {
      let records: Awaited<ReturnType<typeof lookup>>[];
      try {
        records = await lookup(hostname, { all: true, verbatim: true });
      } catch {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Base URL 域名无法解析。", {
          status: 400,
        });
      }
      if (records.some((record) => isPrivateIp(record.address))) {
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          "Base URL 解析到了内网地址，已拒绝。",
          { status: 400 },
        );
      }
    }
  }

  return url.toString().replace(/\/+$/, "");
}
