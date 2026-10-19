import type { Metadata, Viewport } from "next";
import { APP_DESCRIPTION, APP_NAME, APP_SUBTITLE } from "@/lib/constants";
import {
  BACKGROUND_STORAGE_KEY,
  NIGHT_THEME_VARS,
} from "@/lib/theme/background";
import { Providers } from "./providers";
import "@fontsource-variable/noto-serif-sc";
import "./globals.css";
import "./reading-room.css";
import "./shelf-home.css";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} · ${APP_SUBTITLE}`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  authors: [{ name: "history-atlas" }],
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f1e3",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="min-h-dvh">
        <script
          // Apply the persisted dark theme before first paint to avoid a
          // full-page white flash for night readers.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var id=localStorage.getItem(${JSON.stringify(
              BACKGROUND_STORAGE_KEY,
            )});if(id==='night'){var r=document.documentElement;r.dataset.theme='dark';r.style.colorScheme='dark';var v=${JSON.stringify(
              NIGHT_THEME_VARS,
            )};for(var k in v)r.style.setProperty(k,v[k]);}}catch(e){}})();`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
