"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  Compass,
  Clapperboard,
  BookOpen,
  Headphones,
  Library,
  History,
  Download,
  Puzzle,
  Settings as SettingsIcon,
  ChevronsLeft,
  ChevronsRight,
  PlaySquare,
} from "lucide-react";
import { useAppData } from "@/components/AppContext";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/anime", label: "Anime & Video", icon: Clapperboard },
  { href: "/manga", label: "Manga & Manhwa", icon: BookOpen },
  { href: "/audio", label: "ASMR & Audio", icon: Headphones },
  { href: "/library", label: "My Library", icon: Library },
  { href: "/history", label: "History", icon: History },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/extensions", label: "Extensions & Sources", icon: Puzzle },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const { profile } = useAppData();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`shrink-0 h-screen sticky top-0 surface border-r flex flex-col transition-all duration-200 ${collapsed ? "w-[72px]" : "w-64"}`}
    >
      <div className="flex items-center gap-2.5 px-4 h-16 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="w-8 h-8 rounded-lg accent-bg flex items-center justify-center shrink-0">
          <PlaySquare size={18} className="text-white" />
        </div>
        {!collapsed && <span className="font-semibold tracking-tight">RiuPlay</span>}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2.5 flex flex-col gap-0.5" aria-label="Main navigation">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`focus-ring group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                active ? "accent-bg text-white" : "hover:bg-[var(--surface-2)] text-dim hover:text-[var(--text)]"
              }`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-2.5 border-t flex flex-col gap-2" style={{ borderColor: "var(--border)" }}>
        <Link
          href="/settings"
          className={`focus-ring flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-[var(--surface-2)] transition-colors`}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
            style={{ background: profile?.avatarColor ?? "#7c5cff" }}
          >
            {profile?.avatarEmoji ?? "🎬"}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{profile?.name ?? "Player One"}</p>
              <p className="text-[11px] text-dim">Local profile</p>
            </div>
          )}
        </Link>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="focus-ring flex items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-dim hover:bg-[var(--surface-2)] text-xs"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
