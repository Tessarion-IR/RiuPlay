"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Profile, type Settings } from "@/lib/client-api";

interface AppContextValue {
  profile: Profile | null;
  settings: Settings | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;
  updateProfile: (patch: Partial<Pick<Profile, "name" | "avatarEmoji" | "avatarColor">>) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function applyTheme(theme: Settings["theme"], accent: string) {
  const root = document.documentElement;
  const resolved =
    theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  root.classList.toggle("dark", resolved === "dark");
  root.style.setProperty("--accent", accent);
  const hex = accent.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  root.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
  try {
    localStorage.setItem("riuplay-theme", theme);
    localStorage.setItem("riuplay-accent", accent);
  } catch {
    /* ignore storage errors (e.g. private mode) */
  }
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([
      api.get<{ profile: Profile }>("/api/profile"),
      api.get<{ settings: Settings }>("/api/settings"),
    ]);
    setProfile(p.profile);
    setSettings(s.settings);
    applyTheme(s.settings.theme, s.settings.accentColor);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!settings || settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(settings.theme, settings.accentColor);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings]);

  const updateSettings = useCallback(async (patch: Record<string, unknown>) => {
    const res = await api.patch<{ settings: Settings }>("/api/settings", patch);
    setSettings(res.settings);
    applyTheme(res.settings.theme, res.settings.accentColor);
  }, []);

  const updateProfile = useCallback(
    async (patch: Partial<Pick<Profile, "name" | "avatarEmoji" | "avatarColor">>) => {
      const res = await api.patch<{ profile: Profile }>("/api/profile", patch);
      setProfile(res.profile);
    },
    [],
  );

  const value = useMemo(
    () => ({ profile, settings, loading, refresh, updateSettings, updateProfile }),
    [profile, settings, loading, refresh, updateSettings, updateProfile],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
