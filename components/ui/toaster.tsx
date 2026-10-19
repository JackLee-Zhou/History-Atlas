"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      toastOptions={{
        style: {
          background: "var(--surface)",
          border: "1px solid color-mix(in srgb, var(--line) 82%, transparent)",
          color: "var(--ink)",
          borderRadius: "4px",
          boxShadow: "0 16px 40px var(--panel-shadow)",
        },
      }}
    />
  );
}
