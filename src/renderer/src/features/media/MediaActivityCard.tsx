// RiuPlay: video, manga and audio activity from the unified library, so Profile and History don't
// show only what was watched from an anime source. Counts only: progress is stored in different
// units per type (milliseconds, seconds, pages), so no "hours" are invented from it.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { MediaType } from "@shared/media";
import { hibiki } from "@/lib/hibiki";
import { MEDIA_TYPE_ICONS } from "@/lib/media";

const UNIT: Record<MediaType, { done: string; started: string }> = {
  video: { done: "episodes finished", started: "episodes started" },
  manga: { done: "chapters read", started: "chapters opened" },
  audio: { done: "tracks finished", started: "tracks started" },
};

export function MediaActivityCard({ title }: { title?: string }) {
  const { t } = useTranslation();
  const getStats = hibiki.media.stats;
  const stats = useQuery({ queryKey: ["media", "stats"], queryFn: () => getStats!(), enabled: Boolean(getStats), staleTime: 0 });
  if (!stats.data) return null;
  const types: MediaType[] = ["video", "manga", "audio"];
  const any = types.some((type) => stats.data!.byType[type].titles > 0);
  return (
    <section className="rounded-2xl border border-border bg-text/[.03] p-4" data-testid="media-activity">
      <h2 className="text-sm font-bold text-text">{title ?? "Your media"}</h2>
      {!any ? (
        <p className="mt-1 text-xs text-muted">Nothing in your library yet. Add files, links or a server title from the Video, Manga and Audio sections.</p>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-3 mobile:grid-cols-1">
          {types.map((type) => {
            const s = stats.data!.byType[type];
            const Icon = MEDIA_TYPE_ICONS[type];
            return (
              <div key={type} className="rounded-xl bg-text/[.04] p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-text">
                  <Icon className="h-4 w-4 text-muted" />
                  {t(`media.type.${type}`)}
                </div>
                <p className="mt-2 text-lg font-bold tabular-nums text-text">{s.titles}</p>
                <p className="text-[11px] text-muted">titles · {s.inLibrary} in library · {s.favorites} favourites</p>
                <p className="mt-1 text-[11px] text-muted">
                  {s.unitsCompleted} {UNIT[type].done} · {s.unitsStarted} {UNIT[type].started}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
