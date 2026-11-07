// RiuPlay: adding a title of any type - by URL, from local files, or by hand. The original RiuPlay's
// AddMediaModal (legacy/next-app/src/components/AddMediaModal.tsx), rebuilt on the desktop app:
// local files come from the native picker instead of a browser upload, and nothing is copied.
import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FolderOpen, Link2, Loader2, PencilLine } from "lucide-react";
import { LIBRARY_STATUSES, type LibraryStatus, type MediaType } from "@shared/media";
import { Modal } from "@/components/Modal";
import { hibiki } from "@/lib/hibiki";
import { cn } from "@/lib/cn";
import { mediaKeys, parseUnitLines, statusLabelKey, titleFromUrl } from "@/lib/media";

type Mode = "url" | "files" | "manual";

const input = "w-full rounded-xl border border-border bg-app-bg px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-muted/70 focus:border-accent";
const label = "mb-1 block text-xs font-semibold text-muted";

export function AddMediaButton({ type, className }: { type: MediaType; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-fg transition-opacity hover:opacity-90", className)}>
        {t(`media.add.button.${type}`)}
      </button>
      {createPortal(<AnimatePresence>{open && <AddMediaDialog type={type} onClose={() => setOpen(false)} />}</AnimatePresence>, document.body)}
    </>
  );
}

export function AddMediaDialog({ type, onClose }: { type: MediaType; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("url");
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState("");
  const [cover, setCover] = useState("");
  const [description, setDescription] = useState("");
  const [genres, setGenres] = useState("");
  const [status, setStatus] = useState<LibraryStatus | "">("planned");
  const [paths, setPaths] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const parsed = parseUnitLines(type, lines);
  const pickMode = type === "manga" ? "folder" : "files";

  const add = useMutation({
    mutationFn: async () => {
      const libraryStatus = status || undefined;
      const meta = {
        description: description.trim() || undefined,
        cover: cover.trim() || undefined,
        genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
      };
      if (mode === "files") return hibiki.media.addFiles({ type, paths, title: title.trim() || undefined, libraryStatus });
      if (mode === "url") {
        const first = parsed.units[0]?.url ?? parsed.units[0]?.pages?.[0] ?? "";
        return hibiki.media.add({ type, origin: "direct", title: title.trim() || titleFromUrl(first), units: parsed.units, libraryStatus, ...meta });
      }
      return hibiki.media.add({ type, origin: "manual", title: title.trim(), units: parsed.units, libraryStatus, ...meta });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: mediaKeys.all });
      if (result.existed) {
        setNotice(t("media.add.existed", { title: result.item.title }));
        return;
      }
      onClose();
      void navigate({ to: "/media/$mediaId", params: { mediaId: String(result.item.id) } });
    },
  });

  const pick = async () => {
    const chosen = await hibiki.media.pickFiles(type, pickMode);
    if (chosen.length) setPaths(chosen);
  };

  const canSubmit =
    !add.isPending &&
    (mode === "files" ? paths.length > 0 : mode === "url" ? parsed.units.length > 0 && parsed.invalid.length === 0 : title.trim().length > 0 && parsed.invalid.length === 0);

  const tabs: Array<{ id: Mode; icon: typeof Link2 }> = [
    { id: "url", icon: Link2 },
    { id: "files", icon: FolderOpen },
    { id: "manual", icon: PencilLine },
  ];

  return (
    <Modal onDismiss={onClose} wide>
      <h2 className="text-base font-bold text-text">{t(`media.add.title.${type}`)}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">{t("media.add.honest")}</p>

      <div role="tablist" className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-text/[.05] p-1">
        {tabs.map(({ id, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            type="button"
            onClick={() => {
              setMode(id);
              setNotice(null);
              add.reset();
            }}
            className={cn("flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors", mode === id ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text")}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {t(`media.add.mode.${id}`)}
          </button>
        ))}
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) add.mutate();
        }}
      >
        <div>
          <label className={label} htmlFor="add-media-title">
            {t(mode === "manual" ? "media.add.titleRequired" : "media.add.titleOptional")}
          </label>
          <input id="add-media-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} autoFocus />
        </div>

        {mode === "files" ? (
          <div>
            <p className={label}>{t(`media.add.filesHint.${type}`)}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void pick()} className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text transition-colors hover:bg-text/[.05]">
                {t(pickMode === "folder" ? "media.add.chooseFolder" : "media.add.chooseFiles")}
              </button>
              <p className="min-w-0 truncate text-xs text-muted">{paths.length ? t("media.add.chosen", { count: paths.length, first: paths[0] }) : t("media.add.noneChosen")}</p>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{t("media.add.filesReferenced")}</p>
          </div>
        ) : (
          <div>
            <label className={label} htmlFor="add-media-lines">
              {t(mode === "manual" ? `media.add.linesOptional.${type}` : `media.add.lines.${type}`)}
            </label>
            <textarea id="add-media-lines" className={cn(input, "h-28 resize-y font-mono text-xs")} value={lines} onChange={(e) => setLines(e.target.value)} spellCheck={false} />
            <p className="mt-1 text-[11px] text-muted">
              {t(`media.add.parsed.${type}`, { count: parsed.units.length })}
              {parsed.invalid.length > 0 && <span className="text-rose-500"> · {t("media.add.invalidLines", { count: parsed.invalid.length })}</span>}
            </p>
          </div>
        )}

        {mode !== "files" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={label} htmlFor="add-media-cover">{t("media.add.cover")}</label>
              <input id="add-media-cover" className={input} value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://" />
            </div>
            <div className="col-span-2">
              <label className={label} htmlFor="add-media-description">{t("media.add.description")}</label>
              <textarea id="add-media-description" className={cn(input, "h-16 resize-y")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} />
            </div>
            <div className="col-span-2">
              <label className={label} htmlFor="add-media-genres">{t("media.add.genres")}</label>
              <input id="add-media-genres" className={input} value={genres} onChange={(e) => setGenres(e.target.value)} />
            </div>
          </div>
        )}

        <div>
          <label className={label} htmlFor="add-media-status">{t("media.add.library")}</label>
          <select id="add-media-status" className={input} value={status} onChange={(e) => setStatus(e.target.value as LibraryStatus | "")}>
            <option value="">{t("media.add.notInLibrary")}</option>
            {LIBRARY_STATUSES.map((s) => (
              <option key={s} value={s}>{t(statusLabelKey(type, s))}</option>
            ))}
          </select>
        </div>

        {add.error instanceof Error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-500">{add.error.message.replace(/^Error invoking remote method '[^']+': /, "")}</p>}
        {notice && <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs leading-relaxed text-text">{notice}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-muted transition-colors hover:text-text">{t("common.cancel")}</button>
          <button type="submit" disabled={!canSubmit} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-accent-fg disabled:opacity-50">
            {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("media.add.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
