import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a minimal server bundle only for the Docker build. Keeping local
  // builds in the standard output mode preserves `next start` for development.
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  // Keep the dev compiler cache separate from production `next build`.
  // Sharing `.next` between `next dev` and `next build` can leave Turbopack's
  // hot-reload cache inconsistent and cause a full-page reload loop.
  distDir:
    process.env.NEXT_DIST_DIR?.trim() ||
    (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  poweredByHeader: false,
  // Keep Turbopack scoped to this repo (the parent workspace has unrelated locks).
  turbopack: { root: process.cwd() },
  // The UI and Playwright are often opened via 127.0.0.1; Next dev otherwise
  // blocks its dev resources/HMR on that host and client hydration stalls.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Hide Next.js's floating "N" dev indicator; it is noise in the reading UI.
  devIndicators: false,
  // pdfjs-dist ships its own worker/legacy builds; keep it out of the bundler.
  serverExternalPackages: ["pdfjs-dist"],
  // Seed JSON is imported statically; user data lives under .data at runtime.
  outputFileTracingIncludes: {
    "/api/**/*": ["./assets/**/*"],
  },
  // Never allow dynamic data reads to pull the local database (and API key)
  // into a standalone build artifact.
  outputFileTracingExcludes: {
    "/**/*": [
      ".data/**/*",
      ".data-e2e/**/*",
      ".next-e2e/**/*",
      ".env",
      ".env.*",
    ],
  },
};

export default nextConfig;
