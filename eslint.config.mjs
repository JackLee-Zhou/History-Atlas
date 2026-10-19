import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-dev/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "node_modules/**",
    ".data/**",
    ".data-e2e/**",
    ".npm-cache/**",
    "public/basemap/**",
    "public/maplibre/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
