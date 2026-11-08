// RiuPlay M8: inside the Video, Manga and Audio sections - the installed extensions that provide
// this media type, browsable and searchable right here. Opening a title stores it as an ordinary
// RiuPlay title (origin "extension"): its title page, the native player/reader, progress,
// favourites, collections and Continue Watching/Reading/Listening then work as for any title.
// Nothing to configure: installing an extension in Sources is enough for it to appear.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass, Search } from "lucide-react";
import type { MediaType } from "@shared/media";
import { hibiki } from "@/lib/hibiki";
import { cn } from "@/lib/cn";
import { mediaKeys } from "@/lib/media";

export const PROVIDERS_KEY = ["mediaProviders"] as const;

const cleanError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "");

export function FromExtensions({ type }: { type: MediaType }) {
  const { t } = useTranslation();
  const api = hibiki.mediaProviders;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  // A source installed, updated, disabled or removed anywhere shows up here at once.
  useEffect(() => hibiki.sources.onChanged(() => void queryClient.invalidateQueries({ queryKey: PROVIDERS_KEY })), [queryClient]);

  const sources = useQuery({ queryKey: [...PROVIDERS_KEY, "sources", type], queryFn: () => api!.sources(type), enabled: Boolean(api) });
  const active = sources.data?.find((s) => s.id === chosen) ?? sources.data?.[0] ?? null;
  const results = useQuery({
    queryKey: [...PROVIDERS_KEY, "browse", type, active?.id, query],
    queryFn: () => api!.browse(type, active!.id, query, 0),
    enabled: Boolean(api && active),
    retry: 1,
    staleTime: 5 * 60_000,
  });
  const open = useMutation({
    mutationFn: (titleId: string) => api!.open(active!.id, titleId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: mediaKeys.all });
      void navigate({ to: "/media/$mediaId", params: { mediaId: String(result.item.id) } });
    },
  });

  if (!api || sources.isPending) return null;
  if (!sources.data?.length) {
    return (
      <section className="mb-10 rounded-2xl border border-border bg-text/[.03] p-5" data-testid="from-extensions-empty">
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5 text-muted" />
          <h2 className="text-lg font-bold text-text">{t(`media.providers.title.${type}`)}</h2>
        </div>
        <p className="mt-1 text-sm text-muted">{t(`media.providers.none.${type}`)}</p>
        <Link to="/sources" className="mt-3 inline-block rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg">{t("media.providers.install")}</Link>
      </section>
    );
  }

  const error = results.error ?? open.error;
  return (
    <section className="mb-10" data-testid="from-extensions">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-lg font-bold text-text">{t(`media.providers.title.${type}`)}</h2>
        {sources.data.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid="provider-chip"
            onClick={() => setChosen(s.id)}
            className={cn("rounded-full px-3 py-1 text-xs font-semibold", active?.id === s.id ? "bg-accent text-accent-fg" : "bg-text/[.06] text-muted hover:text-text")}
          >
            {s.name}
          </button>
        ))}
        <form className="ml-auto flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5" onSubmit={(e) => { e.preventDefault(); setQuery(draft.trim()); }}>
          <Search className="h-4 w-4 text-muted" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("media.providers.searchPlaceholder", { source: active?.name ?? "" })}
            aria-label={t("media.providers.search")}
            data-testid="provider-search"
            className="w-56 bg-transparent text-sm text-text outline-none placeholder:text-muted/70"
          />
        </form>
      </div>
      {error ? (
        <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{t("media.providers.error", { error: cleanError(error) })}</p>
      ) : results.isPending ? (
        <div className="grid grid-cols-6 gap-4 mobile:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-text/[.06]" />)}</div>
      ) : (results.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted">{t("media.providers.noResults")}</p>
      ) : (
        <div className="grid grid-cols-6 gap-x-4 gap-y-6 mobile:grid-cols-3">
          {results.data!.map((item) => (
            <button
              key={`${item.sourceId}:${item.id}`}
              type="button"
              data-testid="provider-title"
              disabled={open.isPending}
              onClick={() =>
                // A hibiki-format anime source opens in the anime pipeline (its resolvers, the HLS
                // player, episode history); a host-API-2 source becomes a unified RiuPlay title.
                active?.pipeline === "anime"
                  ? void navigate({ to: "/anime/$sourceId/$animeId", params: { sourceId: item.sourceId, animeId: item.id } })
                  : open.mutate(item.id)
              }
              className="group text-left"
              title={item.title}
            >
              <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-text/[.06]">
                {item.cover && <img src={item.cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />}
                {open.isPending && open.variables === item.id && <div className="absolute inset-0 animate-pulse bg-black/40" />}
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-text">{item.title}</p>
              {item.year && <p className="text-xs text-muted">{item.year}</p>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
