#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(
  root,
  "node_modules",
  "maplibre-gl",
  "dist",
  "maplibre-gl-worker.mjs",
);
const targetDir = path.join(root, "public", "maplibre");
const target = path.join(targetDir, "maplibre-gl-worker.mjs");

if (!fs.existsSync(source)) {
  console.error(
    "copy-maplibre-worker: node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs 不存在，请先 npm install。",
  );
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(
  `copy-maplibre-worker: ${path.relative(root, target)} (${fs.statSync(target).size} bytes)`,
);
