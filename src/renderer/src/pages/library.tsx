import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Bookmark, Trash2, TriangleAlert } from "lucide-react";
import { hibiki } from "@/lib/hibiki";
import { useRefreshWhenShown } from "@/lib/useRefreshWhenShown";
import { AnimeCard, type AnimeCardSource } from "@/components/AnimeCard";
import { usePopoverTheme } from "@/lib/usePopoverTheme";
import { cn } from "@/lib/cn";
import { isMobile } from "@/lib/mobile";
import { LibrarySegments } from "@/components/MobilePageHeader";
import type { LibraryCategory, LibraryEntry } from "@shared/types";
import { LIBRARY_STATUSES, MEDIA_TYPES, type LibraryStatus, type MediaSummary, type MediaType } from "@shared/media";
import { MEDIA_TYPE_ICONS, mediaKeys, statusLabelKey } from "@/lib/media";
import { MediaCard } from "@/components/media/MediaCard";

// Rendered persistently from __root.tsx instead - see index.tsx for why.
//
// RiuPlay: one library for every content type. Titles followed from extension sources (hibiki's
// library, video/anime) and the user's own video, manga and audio (the unified media model) are
// listed together and filtered the same way - by type, then by status - instead of living in two
// separate libraries.
type TypeFilter = "all" | MediaType;
type StatusFilter = "all" | LibraryStatus | "favorite";

/** hibiki's categories, read as RiuPlay's statuses (hibiki keeps "favorite" as a category of its own). */
const STATUS_OF_CATEGORY: Record<LibraryCategory, LibraryStatus | "favorite"> = {
  watching: "active",
  planned: "planned",
  completed: "completed",
  dropped: "dropped",
  on_hold: "on_hold",
  favorite: "favorite",
};

type Row =
  | { kind: "source"; key: string; at: number; status: LibraryStatus | "favorite"; entry: LibraryEntry }
  | { kind: "local"; key: string; at: number; status: LibraryStatus; favorite: boolean; summary: MediaSummary };

export function LibraryPage() {
  const { t } = useTranslation();
  const libraryQuery = useQuery({ queryKey: ["library"], queryFn: () => hibiki.library.list() });
  const localQuery = useQuery({ queryKey: mediaKeys.list({ inLibrary: true }), queryFn: () => hibiki.media.list({ inLibrary: true }) });
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: () => hibiki.sources.list() });
  const [type, setType] = useState<TypeFilter>("all");
  useRefreshWhenShown([mediaKeys.all, ["library"]]);
  const [status, setStatus] = useState<StatusFilter>("all");

  const sourceById = useMemo(() => new Map((sourcesQuery.data ?? []).map((s) => [s.id, s])), [sourcesQuery.data]);
  const rows = useMemo<Row[]>(() => {
    const fromSources: Row[] = (libraryQuery.data ?? []).map((entry) => ({
      kind: "source",
      key: `s:${entry.sourceId}:${entry.animeId}`,
      at: entry.addedAt,
      status: STATUS_OF_CATEGORY[entry.category],
      entry,
    }));
    const local: Row[] = (localQuery.data ?? [])
      .filter((s) => s.library)
      .map((summary) => ({ kind: "local", key: `l:${summary.item.id}`, at: summary.library!.updatedAt, status: summary.library!.status, favorite: summary.library!.favorite, summary }));
    return [...fromSources, ...local].sort((a, b) => b.at - a.at);
  }, [libraryQuery.data, localQuery.data]);

  const typeOf = (row: Row): MediaType => (row.kind === "source" ? "video" : row.summary.item.type);
  const ofType = rows.filter((row) => type === "all" || typeOf(row) === type);
  const matchesStatus = (row: Row, f: StatusFilter) => f === "all" || (f === "favorite" ? row.status === "favorite" || (row.kind === "local" && row.favorite) : row.status === f);
  const visible = ofType.filter((row) => matchesStatus(row, status));
  const statusWordType: MediaType = type === "all" ? "video" : type;

  return (
    <div className="min-h-full bg-app-bg px-8 py-8 pb-16 mobile:px-4 mobile:pb-6 mobile:pt-4">
      {isMobile && <LibrarySegments active="/library" />}
      {(libraryQuery.isError || localQuery.isError) && <ErrorBanner message={((libraryQuery.error ?? localQuery.error) as Error).message} />}
      <div className="mb-3 flex flex-wrap gap-2">
        {(["all", ...MEDIA_TYPES] as TypeFilter[]).map((f) => {
          const Icon = f === "all" ? Bookmark : MEDIA_TYPE_ICONS[f];
          return (
            <CategoryChip key={f} active={type === f} onClick={() => setType(f)} label={f === "all" ? t("library.filterAll") : t(`media.type.${f}`)} count={f === "all" ? rows.length : rows.filter((r) => typeOf(r) === f).length} icon={Icon} />
          );
        })}
      </div>
      <div className="mb-6 flex flex-wrap gap-2 mobile:[scrollbar-width:none] mobile:-mx-4 mobile:mb-4 mobile:flex-nowrap mobile:overflow-x-auto mobile:px-4">
        {(["all", ...LIBRARY_STATUSES, "favorite"] as StatusFilter[]).map((f) => (
          <CategoryChip
            key={f}
            active={status === f}
            onClick={() => setStatus(f)}
            label={f === "all" ? t("media.filter.anyStatus") : f === "favorite" ? t("library.categories.favorite") : type === "all" && f === "active" ? t("media.status.active.any") : t(statusLabelKey(statusWordType, f))}
            count={ofType.filter((row) => matchesStatus(row, f)).length}
          />
        ))}
      </div>
      {visible.length === 0 ? (
        <EmptyState text={rows.length === 0 ? t("media.library.empty") : t("library.categoryEmpty")} />
      ) : (
        <div className="grid grid-cols-5 gap-x-4 gap-y-6 mobile:grid-cols-3 mobile:gap-x-3 mobile:gap-y-5">
          {visible.map((row) =>
            row.kind === "source" ? (
              <LibraryCard key={row.key} entry={row.entry} source={sourceById.get(row.entry.sourceId)} />
            ) : (
              <MediaCard key={row.key} item={row.summary.item} library={row.summary.library} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// A right-click menu for removing a title from the library, matching the one the continue-watching
// and history cards already have (see WatchFrameCard) - previously the only way out of the library
// was to open the title's own page and toggle it off there.
function LibraryCard({ entry, source }: { entry: LibraryEntry; source?: AnimeCardSource }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const popoverTheme = usePopoverTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const onRemove = async () => {
    await hibiki.library.remove(entry.sourceId, entry.animeId);
    queryClient.invalidateQueries({ queryKey: ["library"] });
  };

  return (
    <ContextMenu.Root onOpenChange={setMenuOpen}>
      <ContextMenu.Trigger asChild>
        <div>
          <AnimeCard anime={entry.anime} source={source} />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal forceMount>
        <AnimatePresence>
          {menuOpen && (
            <ContextMenu.Content asChild forceMount>
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ type: "spring", stiffness: 500, damping: 45 }}
                style={popoverTheme}
                className="z-50 w-56 overflow-hidden rounded-xl border border-border bg-app-popover shadow-2xl"
              >
                <ContextMenu.Item
                  onSelect={onRemove}
                  className="flex cursor-default items-center gap-2.5 px-3.5 py-2.5 text-sm text-rose-300 outline-none transition-colors data-[highlighted]:bg-text/[.06]"
                >
                  <Trash2 className="h-4 w-4 shrink-0" strokeWidth={2} />
                  {t("detail.removeFromLibrary")}
                </ContextMenu.Item>
              </motion.div>
            </ContextMenu.Content>
          )}
        </AnimatePresence>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
  count,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: typeof Bookmark;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors mobile:shrink-0 mobile:rounded-full mobile:px-3.5 mobile:py-2",
        active ? "bg-accent text-accent-fg" : "bg-text/[.05] text-muted hover:bg-text/[.08] hover:text-text",
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
      {label}
      <span className={cn("text-xs", active ? "text-accent-fg/70" : "text-muted")}>{count}</span>
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[calc(100vh-220px)] items-center justify-center mobile:min-h-[40vh]">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-text/[.06]">
          <Bookmark className="h-6 w-6 text-muted" strokeWidth={1.75} />
        </div>
        <p className="text-sm leading-6 text-muted">{text}</p>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  const { t } = useTranslation();
  return <div className="flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/5 dark:text-rose-200"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} /><span>{t("common.loadFailed", { message })}</span></div>;
}
