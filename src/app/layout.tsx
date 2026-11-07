import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "RiuPlay — Anime, Manga & Audio Hub",
  description: "A unified local-first hub for anime, manga/manhwa, and ASMR/audio.",
};

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var theme = localStorage.getItem('riuplay-theme') || 'system';
    var accent = localStorage.getItem('riuplay-accent') || '#7c5cff';
    var resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    if (resolved === 'dark') document.documentElement.classList.add('dark');
    document.documentElement.style.setProperty('--accent', accent);
    var hex = accent.replace('#', '');
    var r = parseInt(hex.substring(0,2), 16), g = parseInt(hex.substring(2,4), 16), b = parseInt(hex.substring(4,6), 16);
    document.documentElement.style.setProperty('--accent-rgb', r + ', ' + g + ', ' + b);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
