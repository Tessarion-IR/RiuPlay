// RiuPlay M4/M5: inside the Manga and Audio sections - browse the user's own Suwayomi / Kikoeru
// server and add titles to the unified library. Once added, a title is an ordinary RiuPlay title:
// progress, Continue Reading/Listening, favourites, collections and search all work as for local
// media. Covers and pages load from riuplay-media://remote..., which the main process fetches with
// the server's credentials.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import type { ServerKind } from "@shared/types";
import { hibiki } from "@/lib/hibiki";
import { cn } from "@/lib/cn";
import { mediaKeys } from "@/lib/media";
import { cleanIpcError, useConnections } from "./ServerConnectionsPanel";

type Mode = "POPULAR" | "LATEST" | "SEARCH";

export function FromServers({ type }: { type: "manga" | "audio" }) {
  const { t } = useTranslation();
  const kind: ServerKind = type === "manga" ? "suwayomi" : "kikoeru";
  const connections = useConnections(kind);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("POPULAR");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const active = connections.data.find((c) => c.id === connectionId) ?? connections.data[0] ?? null;
  const sources = useQuery({
    queryKey: ["serverSources", active?.id],
    queryFn: () => hibiki.connections!.suwayomiSources(active!.id),
    enabled: Boolean(active && kind === "suwayomi"),
    retry: false,
  });
  const source = sourceId ?? sources.data?.[0]?.id ?? null;
  const results = useQuery({
    queryKey: ["serverBrowse", active?.id, source, mode, query, page],
    queryFn: () =>
      kind === "suwayomi" ? hibiki.connections!.suwayomiBrowse(active!.id, source!, query ? "SEARCH" : mode, page, query || undefined) : hibiki.connections!.kikoeruBrowse(active!.id, page, query || undefined),
    enabled: Boolean(active && (kind === "kikoeru" || source)),
    retry: false,
  });
  const add = useMutation({
    mutationFn: (ref: string) => hibiki.connections!.addToLibrary(active!.id, ref),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: mediaKeys.all });
      void navigate({ to: "/media/$mediaId", params: { mediaId: String(result.item.id) } });
    },
  });

  if (!connections.available) return null;
  if (connections.data.length === 0) {
    return (
      <section className="mb-10" data-testid="from-servers">
        <h2 className="mb-1 text-lg font-bold text-text">{t(`servers.from.${type}`)}</h2>
        <p className="text-sm text-muted">
          {t(`servers.none.${type}`)}{" "}
          <Link to="/settings" className="font-semibold text-accent-text hover:underline">{t("servers.openSettings")}</Link>
        </p>
      </section>
    );
  }
  const error = sources.error ?? results.error ?? add.error;
  return (
    <section className="mb-10" data-testid="from-servers">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-lg font-bold text-text">{t(`servers.from.${type}`)}</h2>
        {connections.data.length > 1 && (
          <select className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text" value={active?.id} onChange={(e) => { setConnectionId(Number(e.target.value)); setSourceId(null); setPage(1); }} aria-label={t("servers.title")}>
            {connections.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {kind === "suwayomi" && (sources.data?.length ?? 0) > 0 && (
          <select className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text" value={source ?? ""} onChange={(e) => { setSourceId(e.target.value); setPage(1); }} aria-label={t("servers.source")}>
            {sources.data!.map((s) => <option key={s.id} value={s.id}>{s.name}{s.lang ? ` (${s.lang})` : ""}</option>)}
          </select>
        )}
        {kind === "suwayomi" && !query && (["POPULAR", "LATEST"] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setPage(1); }} className={cn("rounded-full px-3 py-1 text-xs font-semibold", mode === m ? "bg-accent text-accent-fg" : "bg-text/[.06] text-muted hover:text-text")}>
            {t(`servers.mode.${m}`)}
          </button>
        ))}
        <form className="ml-auto flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5" onSubmit={(e) => { e.preventDefault(); setQuery(draft.trim()); setPage(1); }}>
          <Search className="h-4 w-4 text-muted" />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("servers.searchPlaceholder", { server: active?.name ?? "" })} aria-label={t("servers.search")} className="w-48 bg-transparent text-sm text-text outline-none placeholder:text-muted/70" />
        </form>
      </div>
      <p className="mb-3 text-xs text-muted">{t("servers.origin", { server: active?.name ?? "", address: active?.baseUrl ?? "" })}</p>
      {error ? (
        <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{t("servers.unreachableBrowse", { error: cleanIpcError(error) })}</p>
      ) : results.isPending ? (
        <div className="grid grid-cols-6 gap-4 mobile:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-text/[.06]" />)}</div>
      ) : (results.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted">{t("servers.noResults")}</p>
      ) : (
        <>
          <div className="grid grid-cols-6 gap-x-4 gap-y-6 mobile:grid-cols-3">
            {results.data!.items.map((item) => (
              <div key={item.ref} className="group">
                <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-text/[.06]">
                  <img src={item.cover} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                  <button type="button" disabled={add.isPending} onClick={() => add.mutate(item.ref)} className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-xs font-semibold text-white opacity-0 transition-opacity hover:bg-black/90 group-hover:opacity-100 focus:opacity-100">
                    <Plus className="h-3.5 w-3.5" />{t("servers.addToLibrary")}
                  </button>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-semibold text-text">{item.title}</p>
                {item.subtitle && <p className="truncate text-xs text-muted">{item.subtitle}</p>}
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text disabled:opacity-40">{t("servers.previous")}</button>
            <button type="button" disabled={!results.data!.hasNextPage} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text disabled:opacity-40">{t("servers.next")}</button>
          </div>
        </>
      )}
    </section>
  );
}
