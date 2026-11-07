// RiuPlay: the poster card for a title of any content type, in the same visual language as hibiki's
// AnimeCard (aspect, ring, hover reveal), so local video, manga and audio sit naturally beside titles
// from sources. Audio covers are square, as album art is.
import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import type { MediaItem, MediaLibraryState, MediaType } from "@shared/media";
import { SmoothImage } from "@/components/SmoothImage";
import { cn } from "@/lib/cn";
import { MEDIA_TYPE_ICONS, statusLabelKey } from "@/lib/media";

export const MediaCard = memo(function MediaCard({
  item,
  library,
  subtitle,
  progress,
  to,
}: {
  item: MediaItem;
  library?: MediaLibraryState | null;
  /** The line under the title; defaults to the type and status. */
  subtitle?: string;
  /** 0..1, shown as a bar at the bottom of the cover. */
  progress?: number;
  /** Where the card leads; defaults to the title's page. */
  to?: { unitId: number };
}) {
  const { t } = useTranslation();
  const Icon = MEDIA_TYPE_ICONS[item.type];
  const line = subtitle ?? [t(`media.type.${item.type}`), library ? t(statusLabelKey(item.type, library.status)) : null].filter(Boolean).join(" · ");
  const cover = (
    <div className={cn("relative overflow-hidden rounded-xl bg-surface ring-1 ring-border", item.type === "audio" ? "aspect-square" : "aspect-[2/3]")}>
      {item.cover ? (
        <SmoothImage src={item.cover} alt={item.title} className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-muted">
          <Icon className="h-8 w-8" strokeWidth={1.5} />
          <span className="line-clamp-3 text-sm font-semibold text-text/80">{item.title}</span>
        </div>
      )}
      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        <Icon className="h-3 w-3" strokeWidth={2.2} />
        {t(`media.type.${item.type}`)}
      </span>
      {library?.favorite && <Heart className="absolute right-2 top-2 h-4 w-4 fill-rose-500 text-rose-500 drop-shadow" />}
      {progress !== undefined && progress > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
          <div className="h-full bg-accent" style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }} />
        </div>
      )}
    </div>
  );
  const body = (
    <>
      {cover}
      <p className="mt-3 line-clamp-2 select-text text-base font-semibold leading-snug tracking-[-.01em] text-text/90 transition-colors group-hover:text-text">{item.title}</p>
      <p className="mt-1 line-clamp-1 text-sm text-muted">{line}</p>
    </>
  );
  return to ? (
    <UnitLink type={item.type} mediaId={item.id} unitId={to.unitId} className="group block w-full">
      {body}
    </UnitLink>
  ) : (
    <Link to="/media/$mediaId" params={{ mediaId: String(item.id) }} className="group block w-full">
      {body}
    </Link>
  );
});

/** A link that opens a unit the way its type is consumed: played, read or listened to. */
export function UnitLink({ type, mediaId, unitId, className, children, title }: { type: MediaType; mediaId: number; unitId: number; className?: string; children: React.ReactNode; title?: string }) {
  const params = { mediaId: String(mediaId), unitId: String(unitId) };
  if (type === "manga") return <Link to="/read/$mediaId/$unitId" params={params} className={className} title={title}>{children}</Link>;
  if (type === "audio") return <Link to="/listen/$mediaId/$unitId" params={params} className={className} title={title}>{children}</Link>;
  return <Link to="/play/$mediaId/$unitId" params={params} className={className} title={title}>{children}</Link>;
}
