// RiuPlay: a title's page, for every content type - what it is, where the user is in it, its place in
// the library and in collections, and its episodes/chapters/tracks. The prototype's media detail
// page (legacy/next-app: anime/manga/audio [id] routes, never finished there) built on the unified
// model, with each type's own words and its own way in (play / read / listen).
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Heart, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { LIBRARY_STATUSES, LOCAL_SOURCE_ID, type LibraryStatus, type MediaDetails, type MediaUnit, type UnitProgress } from "@shared/media";
import { hibiki } from "@/lib/hibiki";
import { cn } from "@/lib/cn";
import { MEDIA_SECTION_PATH, MEDIA_TYPE_ICONS, formatClock, mediaKeys, parseUnitLines, progressFraction, statusLabelKey, unitLabelKey, unitName } from "@/lib/media";
import { Modal } from "@/components/Modal";
import { SmoothImage } from "@/components/SmoothImage";
import { UnitLink } from "@/components/media/MediaCard";
import { CollectionsButton } from "@/components/media/CollectionsButton";

const ipcMessage = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error));
const field = "w-full rounded-xl border border-border bg-app-bg px-3 py-2 text-sm text-text outline-none focus:border-accent";

/** The unit to open from the big button: the first one not finished, else the first. */
function nextUp(details: MediaDetails): MediaUnit | null {
  const done = new Set(details.progress.filter((p) => p.completed).map((p) => p.unitId));
  return details.units.find((u) => !done.has(u.id)) ?? details.units[0] ?? null;
}

export function MediaDetailsPage({ mediaId }: { mediaId: number }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: mediaKeys.detail(mediaId), queryFn: () => hibiki.media.get(mediaId) });

  if (query.isPending) return <div className="p-8"><div className="h-64 animate-pulse rounded-2xl bg-text/[.06]" /></div>;
  if (query.isError) return <p className="m-8 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-500">{ipcMessage(query.error)}</p>;
  if (!query.data) {
    return (
      <div className="p-8 text-center">
        <p className="text-base font-semibold text-text">{t("media.detail.notFound")}</p>
        <Link to="/" className="mt-3 inline-block text-sm font-semibold text-accent-text">{t("media.detail.home")}</Link>
      </div>
    );
  }
  return <Details details={query.data} />;
}

function Details({ details }: { details: MediaDetails }) {
  const { t } = useTranslation();
  const { item, units, library } = details;
  const Icon = MEDIA_TYPE_ICONS[item.type];
  const up = nextUp(details);
  const progressByUnit = useMemo(() => new Map(details.progress.map((p) => [p.unitId, p])), [details.progress]);
  const started = up ? progressByUnit.has(up.id) : false;
  const doneCount = details.progress.filter((p) => p.completed).length;

  return (
    <div className="min-h-full bg-app-bg px-8 py-6 pb-16 mobile:px-4">
      <Link to={MEDIA_SECTION_PATH[item.type]} className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-text">
        <ArrowLeft className="h-4 w-4" />
        {t(`media.section.${item.type}.title`)}
      </Link>

      <div className="flex gap-8 mobile:flex-col">
        <div className={cn("w-56 shrink-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-border mobile:w-40", item.type === "audio" ? "aspect-square" : "aspect-[2/3]")}>
          {item.cover ? <SmoothImage src={item.cover} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted"><Icon className="h-12 w-12" strokeWidth={1.25} /></div>}
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            <Icon className="h-3.5 w-3.5" />
            {t(`media.type.${item.type}`)} · {t(`media.origin.${item.origin}`)}
          </p>
          <h1 className="mt-1 select-text text-3xl font-bold tracking-[-.02em] text-text">{item.title}</h1>
          {item.altTitles.length > 0 && <p className="mt-1 select-text text-sm text-muted">{item.altTitles.join(" · ")}</p>}
          <p className="mt-2 text-sm text-muted">
            {[item.releaseInfo, t(`media.count.${item.type}`, { count: units.length }), units.length ? t("media.detail.finished", { done: doneCount, total: units.length }) : null].filter(Boolean).join(" · ")}
          </p>
          {item.genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.genres.map((g) => <span key={g} className="rounded-md bg-text/[.07] px-2 py-0.5 text-xs font-medium text-text/80">{g}</span>)}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {up && (
              <UnitLink type={item.type} mediaId={item.id} unitId={up.id} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-fg transition-opacity hover:opacity-90">
                <Play className="h-4 w-4 fill-current" />
                {t(`media.detail.${started ? "continue" : "start"}.${item.type}`)} · {unitName(up, t(unitLabelKey(item.type)))}
              </UnitLink>
            )}
            <LibraryControls details={details} />
            <CollectionsButton titleRef={{ sourceId: LOCAL_SOURCE_ID, titleId: String(item.id) }} />
            <EditButton details={details} />
            <DeleteButton details={details} />
          </div>
          {library && <p className="mt-2 text-xs text-muted">{t("media.detail.inLibrarySince", { date: new Date(library.addedAt).toLocaleDateString() })}</p>}

          {item.description && <p className="mt-5 max-w-3xl select-text whitespace-pre-line text-sm leading-relaxed text-text/85">{item.description}</p>}
        </div>
      </div>

      <UnitsSection details={details} progressByUnit={progressByUnit} />
    </div>
  );
}

function useMediaMutation<A>(fn: (arg: A) => Promise<unknown>, mediaId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mediaKeys.all });
      await queryClient.invalidateQueries({ queryKey: mediaKeys.collections });
      void mediaId;
    },
  });
}

function LibraryControls({ details }: { details: MediaDetails }) {
  const { t } = useTranslation();
  const { item, library } = details;
  const setStatus = useMediaMutation((status: LibraryStatus | "") => hibiki.media.setLibrary(item.id, status ? { status } : null), item.id);
  const favorite = useMediaMutation((next: boolean) => hibiki.media.setFavorite(item.id, next), item.id);
  return (
    <>
      <label className="sr-only" htmlFor="library-status">{t("media.detail.libraryStatus")}</label>
      <select
        id="library-status"
        value={library?.status ?? ""}
        onChange={(e) => setStatus.mutate(e.target.value as LibraryStatus | "")}
        className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-text outline-none focus:border-accent"
      >
        <option value="">{t("media.detail.addToLibrary")}</option>
        {LIBRARY_STATUSES.map((s) => <option key={s} value={s}>{t(statusLabelKey(item.type, s))}</option>)}
      </select>
      <button
        type="button"
        onClick={() => favorite.mutate(!library?.favorite)}
        aria-pressed={!!library?.favorite}
        title={t(library?.favorite ? "media.detail.unfavorite" : "media.detail.favorite")}
        className={cn("flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface transition-colors hover:bg-text/[.05]", library?.favorite && "text-rose-500")}
      >
        <Heart className={cn("h-4 w-4", library?.favorite && "fill-current")} />
      </button>
    </>
  );
}

function EditButton({ details }: { details: MediaDetails }) {
  const { t } = useTranslation();
  const { item } = details;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [cover, setCover] = useState(item.origin === "file" && item.cover.startsWith("riuplay-media:") ? "" : item.cover);
  const [genres, setGenres] = useState(item.genres.join(", "));
  const [releaseInfo, setReleaseInfo] = useState(item.releaseInfo);
  const save = useMediaMutation(
    () =>
      hibiki.media.update(item.id, {
        title: title.trim(),
        description: description.trim(),
        genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
        releaseInfo: releaseInfo.trim(),
        ...(item.origin === "file" && !cover.trim() ? {} : { cover: cover.trim() }),
      }),
    item.id,
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={t("media.detail.edit")} className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:bg-text/[.05] hover:text-text">
        <Pencil className="h-4 w-4" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <Modal onDismiss={() => setOpen(false)} wide>
              <h2 className="text-base font-bold text-text">{t("media.detail.edit")}</h2>
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate(undefined, { onSuccess: () => setOpen(false) });
                }}
              >
                <input aria-label={t("media.add.titleRequired")} className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
                <input aria-label={t("media.add.cover")} className={field} value={cover} onChange={(e) => setCover(e.target.value)} placeholder={item.origin === "file" ? t("media.detail.keepFileCover") : "https://"} />
                <textarea aria-label={t("media.add.description")} className={cn(field, "h-24")} value={description} onChange={(e) => setDescription(e.target.value)} />
                <input aria-label={t("media.add.genres")} className={field} value={genres} onChange={(e) => setGenres(e.target.value)} placeholder={t("media.add.genres")} />
                <input aria-label={t("media.detail.releaseInfo")} className={field} value={releaseInfo} onChange={(e) => setReleaseInfo(e.target.value)} placeholder={t("media.detail.releaseInfo")} maxLength={120} />
                {save.error && <p className="text-xs text-rose-500">{ipcMessage(save.error)}</p>}
                <div className="flex justify-end">
                  <button type="submit" disabled={!title.trim() || save.isPending} className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-accent-fg disabled:opacity-50">{t("media.detail.save")}</button>
                </div>
              </form>
            </Modal>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function DeleteButton({ details }: { details: MediaDetails }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => hibiki.media.remove(details.item.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: mediaKeys.detail(details.item.id) });
      await queryClient.invalidateQueries({ queryKey: mediaKeys.all });
      await queryClient.invalidateQueries({ queryKey: mediaKeys.collections });
      void navigate({ to: MEDIA_SECTION_PATH[details.item.type] });
    },
  });
  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} title={t("media.detail.delete")} className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:bg-rose-500/10 hover:text-rose-500">
        <Trash2 className="h-4 w-4" />
      </button>
      {createPortal(
        <AnimatePresence>
          {confirming && (
            <Modal onDismiss={() => setConfirming(false)}>
              <h2 className="text-base font-bold text-text">{t("media.detail.deleteTitle")}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(details.item.origin === "file" ? "media.detail.deleteTextFiles" : "media.detail.deleteText", { title: details.item.title })}</p>
              {remove.error && <p className="mt-2 text-xs text-rose-500">{ipcMessage(remove.error)}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="rounded-xl px-4 py-2 text-sm font-semibold text-muted hover:text-text">{t("common.cancel")}</button>
                <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{t("media.detail.deleteConfirm")}</button>
              </div>
            </Modal>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function UnitsSection({ details, progressByUnit }: { details: MediaDetails; progressByUnit: Map<number, UnitProgress> }) {
  const { t } = useTranslation();
  const { item, units } = details;
  const kindLabel = t(unitLabelKey(item.type));
  const setCompleted = useMediaMutation(({ unitId, completed }: { unitId: number; completed: boolean }) => hibiki.media.setUnitCompleted(unitId, completed), item.id);
  const removeUnit = useMediaMutation((unitId: number) => hibiki.media.removeUnit(unitId), item.id);

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-bold text-text">{t(`media.units.${item.type}`)}</h2>
      {units.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{t(`media.units.empty.${item.type}`)}</p>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {units.map((unit) => {
            const progress = progressByUnit.get(unit.id);
            const fraction = progressFraction(progress, unit.kind);
            const detail =
              unit.kind === "chapter"
                ? t("media.units.pages", { count: unit.pages.length })
                : progress && progress.duration > 0
                  ? `${formatClock(progress.position)} / ${formatClock(progress.duration)}`
                  : unit.durationMs
                    ? formatClock(unit.durationMs)
                    : "";
            return (
              <li key={unit.id} className="group flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setCompleted.mutate({ unitId: unit.id, completed: !progress?.completed })}
                  aria-pressed={!!progress?.completed}
                  title={t(progress?.completed ? "media.units.markUnfinished" : "media.units.markFinished")}
                  className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border", progress?.completed ? "border-accent bg-accent text-accent-fg" : "border-border text-transparent hover:text-muted")}
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </button>
                <UnitLink type={item.type} mediaId={item.id} unitId={unit.id} className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", progress?.completed ? "text-muted" : "text-text")}>{unitName(unit, kindLabel)}</p>
                  <div className="mt-1 flex items-center gap-2">
                    {fraction > 0 && fraction < 1 && (
                      <div className="h-1 w-24 overflow-hidden rounded-full bg-text/10"><div className="h-full bg-accent" style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
                    )}
                    {detail && <span className="text-xs text-muted">{detail}</span>}
                    {unit.subtitleUrl && <span className="rounded bg-text/[.07] px-1 text-[10px] font-bold uppercase text-muted">{t(item.type === "audio" ? "media.units.lyrics" : "media.units.subtitles")}</span>}
                  </div>
                </UnitLink>
                <button type="button" onClick={() => removeUnit.mutate(unit.id)} title={t("media.units.remove")} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100 focus:opacity-100">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {item.origin !== "file" && <AddUnits details={details} />}
    </section>
  );
}

function AddUnits({ details }: { details: MediaDetails }) {
  const { t } = useTranslation();
  const { item } = details;
  const [text, setText] = useState("");
  const parsed = parseUnitLines(item.type, text);
  const add = useMediaMutation(async () => {
    for (const unit of parsed.units) await hibiki.media.addUnit(item.id, unit);
  }, item.id);
  return (
    <form
      className="mt-4 rounded-2xl border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate(undefined, { onSuccess: () => setText("") });
      }}
    >
      <label htmlFor="add-units" className="mb-1 block text-xs font-semibold text-muted">{t(`media.add.lines.${item.type}`)}</label>
      <textarea id="add-units" className={cn(field, "h-20 font-mono text-xs")} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {t(`media.add.parsed.${item.type}`, { count: parsed.units.length })}
          {parsed.invalid.length > 0 && <span className="text-rose-500"> · {t("media.add.invalidLines", { count: parsed.invalid.length })}</span>}
        </p>
        <button type="submit" disabled={!parsed.units.length || parsed.invalid.length > 0 || add.isPending} className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-sm font-bold text-accent-fg disabled:opacity-50">
          <Plus className="h-4 w-4" />
          {t(`media.units.add.${item.type}`)}
        </button>
      </div>
      {add.error && <p className="mt-2 text-xs text-rose-500">{ipcMessage(add.error)}</p>}
    </form>
  );
}
