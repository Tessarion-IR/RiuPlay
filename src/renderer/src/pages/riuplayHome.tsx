// RiuPlay's Home: one page across every content type - the original RiuPlay home (legacy/next-app
// src/app/page.tsx: Continue Watching / Reading / Listening, Favorites, Recently Added) rebuilt on the
// unified media model, with what the user watches from extension sources (hibiki) inside Continue
// Watching rather than on a separate screen. Browsing sources lives in Discover.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Compass, FolderHeart, Sparkles } from "lucide-react";
import { MEDIA_TYPES, type MediaType } from "@shared/media";
import { hibiki } from "@/lib/hibiki";
import { useRefreshWhenShown } from "@/lib/useRefreshWhenShown";
import { MEDIA_SECTION_PATH, MEDIA_TYPE_ICONS, continueTitleKey, mediaKeys, progressFraction, unitLabelKey, unitName } from "@/lib/media";
import { useContinueWatching } from "@/lib/continueWatching";
import { useProfileStore } from "@/stores/profileStore";
import { ContinueWatchingRow } from "@/components/ContinueWatchingRow";
import { MediaCard } from "@/components/media/MediaCard";
import { AddMediaButton } from "@/components/media/AddMediaDialog";

export function RiuPlayHomePage() {
  const { t } = useTranslation();
  const name = useProfileStore((state) => state.name);
  const recent = useQuery({ queryKey: mediaKeys.recent, queryFn: () => hibiki.media.recentlyAdded(12) });
  const favorites = useQuery({ queryKey: mediaKeys.list({ inLibrary: true }), queryFn: () => hibiki.media.list({ inLibrary: true }) });
  const collections = useQuery({ queryKey: mediaKeys.collections, queryFn: () => hibiki.media.collections.list() });
  const video = useQuery({ queryKey: mediaKeys.continue("video"), queryFn: () => hibiki.media.continueList("video", 12) });
  const manga = useQuery({ queryKey: mediaKeys.continue("manga"), queryFn: () => hibiki.media.continueList("manga", 12) });
  const audio = useQuery({ queryKey: mediaKeys.continue("audio"), queryFn: () => hibiki.media.continueList("audio", 12) });
  const { slots: fromSources } = useContinueWatching();
  useRefreshWhenShown([mediaKeys.all, mediaKeys.collections, ["recent-progress"]]);

  const continuing = { video: video.data ?? [], manga: manga.data ?? [], audio: audio.data ?? [] } satisfies Record<MediaType, unknown[]>;
  const favs = (favorites.data ?? []).filter((s) => s.library?.favorite);
  const loaded = recent.isSuccess && collections.isSuccess && video.isSuccess && manga.isSuccess && audio.isSuccess;
  const nothingYet = loaded && (recent.data ?? []).length === 0 && fromSources.length === 0 && (collections.data ?? []).length === 0;

  return (
    <div className="min-h-full bg-app-bg px-8 py-8 pb-16 mobile:px-4">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{t("media.home.welcome")}</p>
          <h1 className="text-3xl font-bold tracking-[-.02em] text-text">{name ? t("media.home.hello", { name }) : t("media.home.title")}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {MEDIA_TYPES.map((type) => <AddMediaButton key={type} type={type} className="bg-text/[.07] text-text hover:bg-text/[.1] hover:opacity-100" />)}
        </div>
      </header>

      {nothingYet && (
        <section className="mb-10 rounded-3xl border border-border bg-surface p-8">
          <Sparkles className="h-7 w-7 text-accent-text" />
          <h2 className="mt-3 text-xl font-bold text-text">{t("media.home.emptyTitle")}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{t("media.home.emptyText")}</p>
          <div className="mt-5 grid grid-cols-3 gap-3 mobile:grid-cols-1">
            {MEDIA_TYPES.map((type) => {
              const Icon = MEDIA_TYPE_ICONS[type];
              return (
                <Link key={type} to={MEDIA_SECTION_PATH[type]} className="rounded-2xl border border-border p-4 transition-colors hover:bg-text/[.04]">
                  <Icon className="h-5 w-5 text-accent-text" />
                  <p className="mt-2 text-sm font-bold text-text">{t(`media.section.${type}.title`)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{t(`media.home.sectionHint.${type}`)}</p>
                </Link>
              );
            })}
          </div>
          <Link to="/sources" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text"><Compass className="h-4 w-4" />{t("media.home.addSources")}</Link>
        </section>
      )}

      {(continuing.video.length > 0 || fromSources.length > 0) && (
        <Row title={t(continueTitleKey("video"))} to="/video">
          {continuing.video.length > 0 && (
            <div className="mb-5 grid grid-cols-6 gap-x-4 gap-y-6 mobile:grid-cols-3">
              {continuing.video.map((e) => (
                <MediaCard key={e.item.id} item={e.item} to={{ unitId: e.unit.id }} progress={progressFraction(e.progress, e.unit.kind)} subtitle={unitName(e.unit, t(unitLabelKey("video")))} />
              ))}
            </div>
          )}
          {fromSources.length > 0 && <ContinueWatchingRow />}
        </Row>
      )}

      {(["manga", "audio"] as const).map((type) =>
        continuing[type].length > 0 ? (
          <Row key={type} title={t(continueTitleKey(type))} to={MEDIA_SECTION_PATH[type]}>
            <div className="grid grid-cols-6 gap-x-4 gap-y-6 mobile:grid-cols-3">
              {continuing[type].map((e) => (
                <MediaCard key={e.item.id} item={e.item} to={{ unitId: e.unit.id }} progress={progressFraction(e.progress, e.unit.kind)} subtitle={unitName(e.unit, t(unitLabelKey(type)))} />
              ))}
            </div>
          </Row>
        ) : null,
      )}

      {favs.length > 0 && (
        <Row title={t("media.home.favorites")} to="/library">
          <div className="grid grid-cols-6 gap-x-4 gap-y-6 mobile:grid-cols-3">{favs.slice(0, 12).map((s) => <MediaCard key={s.item.id} item={s.item} library={s.library} />)}</div>
        </Row>
      )}

      {(recent.data ?? []).length > 0 && (
        <Row title={t("media.home.recentlyAdded")}>
          <div className="grid grid-cols-6 gap-x-4 gap-y-6 mobile:grid-cols-3">{(recent.data ?? []).map((s) => <MediaCard key={s.item.id} item={s.item} library={s.library} />)}</div>
        </Row>
      )}

      {(collections.data ?? []).length > 0 && (
        <Row title={t("media.collections.title")} to="/collections">
          <div className="flex flex-wrap gap-2">
            {(collections.data ?? []).map((c) => (
              <Link key={c.id} to="/collections" className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-text transition-colors hover:bg-text/[.04]">
                <FolderHeart className="h-4 w-4 text-accent-text" />
                {c.name}
                <span className="text-xs font-normal text-muted">{c.itemCount}</span>
              </Link>
            ))}
          </div>
        </Row>
      )}

      {!nothingYet && (
        <Link to="/discover" className="mt-2 flex items-center gap-3 rounded-2xl border border-border bg-surface p-5 transition-colors hover:bg-text/[.04]">
          <Compass className="h-5 w-5 text-accent-text" />
          <div>
            <p className="text-sm font-bold text-text">{t("media.home.discoverTitle")}</p>
            <p className="text-xs text-muted">{t("media.home.discoverText")}</p>
          </div>
        </Link>
      )}
    </div>
  );
}

function Row({ title, to, children }: { title: string; to?: "/video" | "/manga" | "/audio" | "/library" | "/collections"; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-[-.01em] text-text">{title}</h2>
        {to && <Link to={to} className="text-sm font-semibold text-muted transition-colors hover:text-accent-text">{t("media.home.seeAll")} →</Link>}
      </div>
      {children}
    </section>
  );
}
