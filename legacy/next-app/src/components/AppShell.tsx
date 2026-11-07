"use client";

import type { ReactNode } from "react";
import { AppDataProvider } from "@/components/AppContext";
import { AudioPlayerProvider } from "@/components/AudioPlayerContext";
import { ToastProvider } from "@/components/ui";
import { Sidebar } from "@/components/Sidebar";
import { MiniPlayerBar } from "@/components/MiniPlayerBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AppDataProvider>
        <AudioPlayerProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 min-w-0 pb-20">{children}</main>
          </div>
          <MiniPlayerBar />
        </AudioPlayerProvider>
      </AppDataProvider>
    </ToastProvider>
  );
}
