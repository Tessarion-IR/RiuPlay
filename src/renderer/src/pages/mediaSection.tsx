// RiuPlay: the Video, Manga and Audio sections - one page, three content types, so they look and
// behave alike while keeping their own words. Each lists the user's titles of that type (from the
// unified media model), what to continue, and lets them add more. The Video section also carries
// what the user is watching from extension sources (hibiki), so anime from sources and local video
// live in one place rather than in two apps.
import { FromServers } from "@/features/servers/FromServers";
import { FromExtensions } from "@/features/media/FromExtensions";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { LIBRARY_STATUSES, type LibraryStatus, type MediaType } from "@shared/media";
import { hibiki } from "@/lib/hibiki";
import { useRefreshWhenShown } from "@/lib/useRefreshWhenShown";
import { cn } from "@/lib/cn";
import { MEDIA_TYPE_ICONS, continueTitleKey, mediaKeys, progressFraction, statusLabelKey, unitLabelKey, unitName } from "@/lib/media";
import { MediaCard } from "@/components/media/MediaCard";
import { AddMediaButton } from "@/components/media/AddMediaDialog";
import { ContinueWatchingRow } from "@/components/ContinueWatchingRow";
import { useContinueWatching } from "@/lib/continueWatching";

export function VideoSectionPage() {
  return <MediaSectionPage type="video" />;
}
export function MangaSectionPage() {
  return <MediaSectionPage type="manga" />;
}
export function AudioSectionPage() {
  return <MediaSectionPage type="audio" />;
}

type Filter = "all" | "library" | LibraryStatus;

export function MediaSectionPage({ type }: { type: MediaType }) {
  const { t } = useTranslation();
  const Icon = MEDIA_TYPE_ICONS[type];
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const listQuery = useQuery({ queryKey: mediaKeys.list({ type }), queryFn: () => hibiki.media.list({ type }) });
  const continueQuery = useQuery({ queryKey: mediaKeys.continue(type), queryFn: () => hibiki.media.continueList(type, 12) });

  const all = listQuery.data ?? [];
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((s) => {
      if (filter === "library" && !s.library) return false;
      if (filter !== "all" && filter !== "library" && s.library?.status !== filter) return false;
      if (!needle) return true;
      return s.item.title.toLowerCase().includes(needle) || s.item.altTitles.some((a) => a.toLowerCase().includes(needle));
    });
  }, [all, filter, search]);
  const continuing = continueQuery.data ?? [];
  useRefreshWhenShown([mediaKeys.all]);

  return (
    <div className="min-h-full bg-app-bg px-8 py-8 pb-16 mobile:px-4">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/15 text-accent-text">
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-[-.02em] text-text">{t(`media.section.${type}.title`)}</h1>
            <p className="mt-0.5 text-sm text-muted">{t(`media.section.${type}.subtitle`)}</p>
          </div>
        </div>
        <AddMediaButton type={type} />
      </header>

      {continuing.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-lg font-bold text-text">{t(continueTitleKey(type))}</h2>
          <div className="grid grid-cols-6 gap-x-4 gap-y-6 mobile:grid-cols-3">
            {continuing.map((entry) => (
              <MediaCard
                key={entry.item.id}
                item={entry.item}
                to={{ unitId: entry.unit.id }}
                progress={progressFraction(entry.progress, entry.unit.kind)}
                subtitle={unitName(entry.unit, t(unitLabelKey(type)))}
              />
            ))}
          </div>
        </section>
      )}

      <FromExtensions key={type} type={type} />
      {type === "video" && <FromSources />}
      {type !== "video" && <FromServers type={type} />}

      <section>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-lg font-bold text-text">{t(`media.section.${type}.yours`)}</h2>
          {(["all", "library", ...LIBRARY_STATUSES] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", filter === f ? "bg-accent text-accent-fg" : "bg-text/[.06] text-muted hover:text-text")}
            >
              {f === "all" ? t("media.filter.all") : f === "library" ? t("media.filter.inLibrary") : t(statusLabelKey(type, f))}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5">
            <Search className="h-4 w-4 text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("media.filter.search")} aria-label={t("media.filter.search")} className="w-48 bg-transparent text-sm text-text outline-none placeholder:text-muted/70" />
          </label>
        </div>

        {listQuery.isError ? (
          <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-500">{(listQuery.error as Error).message}</p>
        ) : listQuery.isPending ? (
          <div className="grid grid-cols-6 gap-4 mobile:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-text/[.06]" />)}</div>
        ) : all.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <Icon className="mx-auto h-8 w-8 text-muted" strokeWidth={1.5} />
            <p className="mt-3 text-base font-semibold text-text">{t(`media.section.${type}.emptyTitle`)}</p>
            <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">{t(`media.section.${type}.emptyText`)}</p>
            <AddMediaButton type={type} className="mt-5" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">{t("media.filter.noMatch")}</p>
        ) : (
          <div className="grid grid-cols-6 gap-x-4 gap-y-6 mobile:grid-cols-3">
            {visible.map((s) => (
              <MediaCard key={s.item.id} item={s.item} library={s.library} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** What the user is watching from extension sources (hibiki), shown inside the Video section. */
function FromSources() {
  const { t } = useTranslation();
  const { slots } = useContinueWatching();
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">{t("media.section.video.fromSources")}</h2>
        <Link to="/discover" className="text-sm font-semibold text-muted transition-colors hover:text-accent-text">{t("media.section.video.discover")} →</Link>
      </div>
      {slots.length > 0 ? <ContinueWatchingRow /> : <p className="text-sm text-muted">{t("media.section.video.fromSourcesEmpty")}</p>}
    </section>
  );
}
