// RiuPlay: collections - the original RiuPlay's custom collections, holding local video, manga and
// audio and titles from extension sources side by side. Later phases build KikoFlu-style playlists
// and Suwayomi-style update categories on the same tables.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FolderHeart, Pencil, Plus, Trash2, X } from "lucide-react";
import type { CollectionItem } from "@shared/media";
import { hibiki } from "@/lib/hibiki";
import { useRefreshWhenShown } from "@/lib/useRefreshWhenShown";
import { cn } from "@/lib/cn";
import { mediaKeys } from "@/lib/media";
import { MediaCard } from "@/components/media/MediaCard";
import { SmoothImage } from "@/components/SmoothImage";

const field = "w-full rounded-xl border border-border bg-app-bg px-3 py-2 text-sm text-text outline-none focus:border-accent";
const ipcMessage = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error));

export function CollectionsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: mediaKeys.collections, queryFn: () => hibiki.media.collections.list() });
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState("");
  const collections = list.data ?? [];
  useRefreshWhenShown([mediaKeys.collections]);
  const current = collections.find((c) => c.id === selected) ?? collections[0] ?? null;

  useEffect(() => {
    if (selected !== null && !collections.some((c) => c.id === selected)) setSelected(null);
  }, [collections, selected]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: mediaKeys.collections });
  const create = useMutation({
    mutationFn: () => hibiki.media.collections.create(name.trim()),
    onSuccess: async (created) => {
      setName("");
      setSelected(created.id);
      await refresh();
    },
  });

  return (
    <div className="min-h-full bg-app-bg px-8 py-8 pb-16 mobile:px-4">
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/15 text-accent-text"><FolderHeart className="h-5 w-5" /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-[-.02em] text-text">{t("media.collections.title")}</h1>
          <p className="mt-0.5 text-sm text-muted">{t("media.collections.subtitle")}</p>
        </div>
      </header>

      <div className="flex gap-6 mobile:flex-col">
        <aside className="w-64 shrink-0 mobile:w-full">
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("media.collections.newName")} aria-label={t("media.collections.newName")} className={field} maxLength={120} />
            <button type="submit" disabled={!name.trim() || create.isPending} aria-label={t("media.collections.create")} className="flex w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg disabled:opacity-50"><Plus className="h-4 w-4" /></button>
          </form>
          {create.error && <p className="mb-2 text-xs text-rose-500">{ipcMessage(create.error)}</p>}
          <nav className="space-y-1">
            {collections.map((c) => (
              <button key={c.id} type="button" onClick={() => setSelected(c.id)} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors", current?.id === c.id ? "bg-accent/15 font-semibold text-text" : "text-muted hover:bg-text/[.05] hover:text-text")}>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-xs text-muted">{c.itemCount}</span>
              </button>
            ))}
          </nav>
          {list.isSuccess && collections.length === 0 && <p className="mt-2 text-sm leading-relaxed text-muted">{t("media.collections.emptyList")}</p>}
        </aside>

        <main className="min-w-0 flex-1">{current ? <CollectionView key={current.id} id={current.id} name={current.name} description={current.description} /> : null}</main>
      </div>
    </div>
  );
}

function CollectionView({ id, name, description }: { id: number; name: string; description: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: mediaKeys.collectionItems(id), queryFn: () => hibiki.media.collections.items(id) });
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: mediaKeys.collections });
  };
  const save = useMutation({ mutationFn: () => hibiki.media.collections.update(id, { name: draftName.trim(), description: draftDescription.trim() }), onSuccess: async () => { setEditing(false); await refresh(); } });
  const remove = useMutation({ mutationFn: () => hibiki.media.collections.remove(id), onSuccess: refresh });
  const removeItem = useMutation({ mutationFn: (item: CollectionItem) => hibiki.media.collections.removeItem(id, { sourceId: item.sourceId, titleId: item.titleId }), onSuccess: refresh });

  return (
    <section>
      {editing ? (
        <form className="mb-5 space-y-2" onSubmit={(e) => { e.preventDefault(); if (draftName.trim()) save.mutate(); }}>
          <input aria-label={t("media.collections.newName")} className={field} value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={120} />
          <textarea aria-label={t("media.add.description")} className={cn(field, "h-16")} value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} placeholder={t("media.add.description")} />
          {save.error && <p className="text-xs text-rose-500">{ipcMessage(save.error)}</p>}
          <div className="flex gap-2">
            <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-accent-fg">{t("media.detail.save")}</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-xl px-4 py-2 text-sm font-semibold text-muted">{t("common.cancel")}</button>
          </div>
        </form>
      ) : (
        <div className="mb-5 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-text">{name}</h2>
            {description && <p className="mt-1 whitespace-pre-line text-sm text-muted">{description}</p>}
          </div>
          <button type="button" onClick={() => setEditing(true)} title={t("media.detail.edit")} className="rounded-lg p-2 text-muted hover:bg-text/[.05] hover:text-text"><Pencil className="h-4 w-4" /></button>
          {confirmDelete ? (
            <span className="flex items-center gap-2 text-xs text-muted">
              {t("media.collections.deleteConfirm")}
              <button type="button" onClick={() => remove.mutate()} className="rounded-lg bg-rose-500 px-2.5 py-1 font-bold text-white">{t("media.detail.deleteConfirm")}</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg px-2 py-1">{t("common.cancel")}</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} title={t("media.collections.delete")} className="rounded-lg p-2 text-muted hover:bg-rose-500/10 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
          )}
        </div>
      )}

      {items.isSuccess && items.data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm leading-relaxed text-muted">{t("media.collections.emptyItems")}</p>
      ) : (
        <div className="grid grid-cols-5 gap-x-4 gap-y-6 mobile:grid-cols-3">
          {(items.data ?? []).map((item) => (
            <div key={`${item.sourceId}:${item.titleId}`} className="group relative">
              {item.local ? (
                <MediaCard item={item.local} />
              ) : (
                <Link to="/anime/$sourceId/$animeId" params={{ sourceId: item.sourceId, animeId: item.titleId }} className="block">
                  <div className="aspect-[2/3] overflow-hidden rounded-xl bg-surface ring-1 ring-border">
                    {item.remote?.cover ? <SmoothImage src={item.remote.cover} alt={item.remote.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted">{item.remote?.title ?? item.titleId}</div>}
                  </div>
                  <p className="mt-3 line-clamp-2 text-base font-semibold text-text/90">{item.remote?.title ?? item.titleId}</p>
                  <p className="mt-1 text-sm text-muted">{t("media.collections.fromSource", { source: item.sourceId })}</p>
                </Link>
              )}
              <button type="button" onClick={() => removeItem.mutate(item)} title={t("media.collections.removeItem")} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
