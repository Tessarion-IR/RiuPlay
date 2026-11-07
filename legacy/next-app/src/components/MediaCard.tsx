"use client";

import Link from "next/link";
import { Clapperboard, BookOpen, Headphones, Star } from "lucide-react";
import type { MediaItem } from "@/lib/client-api";

const TYPE_ICON = { anime: Clapperboard, manga: BookOpen, audio: Headphones };
const TYPE_PATH = { anime: "anime", manga: "manga", audio: "audio" };

export function MediaCard({
  media,
  progress,
  favorite,
  subtitle,
}: {
  media: MediaItem;
  progress?: number;
  favorite?: boolean;
  subtitle?: string;
}) {
  const Icon = TYPE_ICON[media.contentType];
  return (
    <Link
      href={`/${TYPE_PATH[media.contentType]}/${media.id}`}
      className="focus-ring group block w-40 shrink-0"
    >
      <div className="relative w-40 h-56 rounded-xl overflow-hidden surface-2">
        {media.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.cover}
            alt=""
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-dim">
            <Icon size={32} />
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 surface rounded-full p-1 opacity-90">
          <Icon size={12} />
        </div>
        {favorite && (
          <div className="absolute top-1.5 right-1.5 bg-amber-400 rounded-full p-1">
            <Star size={11} className="text-white" fill="white" />
          </div>
        )}
        {typeof progress === "number" && progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
            <div className="h-full accent-bg" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </div>
      <p className="mt-2 text-sm font-medium line-clamp-2 leading-snug">{media.title}</p>
      {subtitle && <p className="text-xs text-dim mt-0.5 truncate">{subtitle}</p>}
    </Link>
  );
}

export function MediaRow({ title, children, emptyHint }: { title: string; children: React.ReactNode; emptyHint?: string }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3 px-1">{title}</h2>
      {hasChildren ? (
        <div className="flex gap-4 overflow-x-auto pb-2 px-1 -mx-1">{children}</div>
      ) : (
        <p className="text-sm text-dim px-1">{emptyHint ?? "Nothing here yet."}</p>
      )}
    </section>
  );
}
