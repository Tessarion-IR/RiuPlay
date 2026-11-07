// RiuPlay: "Add to collection" for any title - a local video/manga/audio title or one from an
// extension source - so collections gather everything the user follows in one place.
import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, FolderPlus } from "lucide-react";
import type { MediaRef } from "@shared/media";
import { Modal } from "@/components/Modal";
import { hibiki } from "@/lib/hibiki";
import { cn } from "@/lib/cn";
import { mediaKeys } from "@/lib/media";

const field = "w-full rounded-xl border border-border bg-app-bg px-3 py-2 text-sm text-text outline-none focus:border-accent";
const ipcMessage = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error));

export function CollectionsButton({ titleRef, className }: { titleRef: MediaRef; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const memberKey = ["collections", "of", titleRef.sourceId, titleRef.titleId];
  const member = useQuery({ queryKey: memberKey, queryFn: () => hibiki.media.collections.of(titleRef) });
  const collections = useQuery({ queryKey: mediaKeys.collections, queryFn: () => hibiki.media.collections.list(), enabled: open });
  const memberOf = member.data ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: mediaKeys.collections });
    await queryClient.invalidateQueries({ queryKey: mediaKeys.all });
  };
  const toggle = useMutation({
    mutationFn: (id: number) => (memberOf.includes(id) ? hibiki.media.collections.removeItem(id, titleRef) : hibiki.media.collections.addItem(id, titleRef)),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: async () => {
      const created = await hibiki.media.collections.create(name.trim());
      await hibiki.media.collections.addItem(created.id, titleRef);
    },
    onSuccess: async () => {
      setName("");
      await refresh();
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-text/[.05]", className)}
      >
        <FolderPlus className="h-4 w-4" />
        {memberOf.length ? t("media.detail.inCollections", { count: memberOf.length }) : t("media.detail.addToCollection")}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <Modal onDismiss={() => setOpen(false)}>
              <h2 className="text-base font-bold text-text">{t("media.detail.collectionsTitle")}</h2>
              <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
                {(collections.data ?? []).map((c) => {
                  const inIt = memberOf.includes(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => toggle.mutate(c.id)} aria-pressed={inIt} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-text hover:bg-text/[.05]">
                      {inIt ? <CheckCircle2 className="h-4 w-4 text-accent-text" /> : <Circle className="h-4 w-4 text-muted" />}
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-muted">{c.itemCount}</span>
                    </button>
                  );
                })}
                {collections.isSuccess && collections.data.length === 0 && <p className="px-2 py-2 text-sm text-muted">{t("media.collections.none")}</p>}
              </div>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) create.mutate();
                }}
              >
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("media.collections.newName")} aria-label={t("media.collections.newName")} className={field} maxLength={120} />
                <button type="submit" disabled={!name.trim() || create.isPending} className="shrink-0 rounded-xl bg-accent px-3 text-sm font-bold text-accent-fg disabled:opacity-50">{t("media.collections.create")}</button>
              </form>
              {(toggle.error ?? create.error) && <p className="mt-2 text-xs text-rose-500">{ipcMessage(toggle.error ?? create.error)}</p>}
            </Modal>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
