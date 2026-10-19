#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const skipDirs = new Set([
  "node_modules",
  ".next",
  ".next-dev",
  ".next-e2e",
  ".data",
  ".data-e2e",
  ".npm-cache",
  ".git",
  "playwright-report",
  "test-results",
  "coverage",
  "public/basemap",
]);
const scanExt = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".sh",
  ".css",
  ".html",
]);

const patterns = [
  { name: "OpenAI/DeepSeek key", re: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{30,}/g },
  { name: "GitHub token", re: /ghp_[A-Za-z0-9]{30,}/g },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  {
    name: "Private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "Client-exposed secret name",
    re: /NEXT_PUBLIC_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\s*[:=]/g,
  },
];

const findings = [];

function mask(value) {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…(${value.length} chars)`;
}

function scanFile(file) {
  let text;
  try {
    const stat = fs.statSync(file);
    if (stat.size > 2 * 1024 * 1024) return;
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(text)) !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({
        file: path.relative(root, file),
        line,
        name: pattern.name,
        sample: mask(match[0]),
      });
    }
  }
}

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name) || skipDirs.has(rel)) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!scanExt.has(path.extname(entry.name))) continue;
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
    scanFile(full);
  }
}

walk(root);

try {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  });
  for (const line of tracked.split("\n")) {
    const file = line.trim();
    if (!file) continue;
    if (file === ".env" || file.startsWith(".env.")) {
      if (file !== ".env.example") {
        findings.push({
          file,
          line: 0,
          name: "环境文件被 git 跟踪",
          sample: "删除并加入 .gitignore",
        });
      }
    }
    if (file.startsWith(".data/")) {
      findings.push({
        file,
        line: 0,
        name: "运行时数据被 git 跟踪",
        sample: "删除并加入 .gitignore",
      });
    }
  }
} catch {
  // not a git repo yet; filesystem scan still applies
}

if (findings.length > 0) {
  console.error(`发现 ${findings.length} 处潜在密钥/敏感文件问题：`);
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.name}] ${finding.sample}`);
  }
  process.exit(1);
}

console.log("check-secrets: 未发现真实密钥或不应提交的敏感文件。");
