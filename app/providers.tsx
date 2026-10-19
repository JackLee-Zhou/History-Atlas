"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { ReadingBackgroundProvider } from "@/components/theme/ReadingBackgroundProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={180}>
      <ReadingBackgroundProvider>
        {children}
        <Toaster />
      </ReadingBackgroundProvider>
    </TooltipProvider>
  );
}
