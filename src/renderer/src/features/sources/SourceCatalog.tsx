// RiuPlay: the built-in discovery catalog (shared/sourceCatalog.ts) on the Sources screen. Discovery
// only: "Add repository" is the user's explicit action (the repository then starts "not reviewed"),
// and installing an extension from it is a separate choice with its own permission dialog.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Compass, ExternalLink, Search } from "lucide-react";
import { CATALOG_GAPS, SOURCE_CATALOG, type CatalogCategory, type CatalogEntry } from "@shared/sourceCatalog";
import { hibiki } from "@/lib/hibiki";
import { cn } from "@/lib/cn";

const CATEGORIES: Array<{ id: CatalogCategory | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "anime", label: "Anime" },
  { id: "manga", label: "Manga" },
  { id: "audio", label: "Audio / ASMR" },
];
const button = "rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-text transition-colors hover:bg-text/[.06] disabled:opacity-50";

function EntryAction({ entry, added }: { entry: CatalogEntry; added: boolean }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const add = useMutation({
    mutationFn: (url: string) => hibiki.sources.repositories.add(url),
    onSuccess: (list) => {
      queryClient.setQueryData(["repositories"], list);
      void queryClient.invalidateQueries({ queryKey: ["repositoryDetails"] });
    },
  });
  const a = entry.action;
  if (a.kind === "add-repository") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" className={button} disabled={added || add.isPending} onClick={() => add.mutate(a.indexUrl)}>
          {added ? "Added" : add.isPending ? "Adding..." : "Add repository"}
        </button>
        {add.isError && <span className="max-w-xs text-right text-[11px] text-rose-400">{(add.error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}</span>}
      </div>
    );
  }
  if (a.kind === "add-in-suwayomi") {
    return (
      <button type="button" className={button} onClick={() => { void navigator.clipboard.writeText(a.indexUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }} title={a.indexUrl}>
        {copied ? "Copied" : "Copy address for Suwayomi"}
      </button>
    );
  }
  return (
    <a href={entry.homepage} target="_blank" rel="noreferrer" className={cn(button, "inline-flex items-center gap-1")}>
      Get the server <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function SourceCatalog({ addedUrls }: { addedUrls: string[] }) {
  const [category, setCategory] = useState<CatalogCategory | "all">("all");
  const [search, setSearch] = useState("");
  const entries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return SOURCE_CATALOG.filter((e) => (category === "all" || e.category === category) && (!needle || `${e.name} ${e.description}`.toLowerCase().includes(needle)));
  }, [category, search]);
  const gap = category !== "all" ? CATALOG_GAPS[category] : null;
  return (
    <section className="mb-6 max-w-2xl rounded-2xl border border-border bg-text/[.03] p-4" data-testid="source-catalog">
      <div className="flex items-center gap-2">
        <Compass className="h-5 w-5 text-muted" />
        <h2 className="text-sm font-bold text-text">Discover</h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Known places to start from. Nothing here is installed or run by itself: you add a repository, and then choose what to install from it. RiuPlay has not reviewed any of them.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" onClick={() => setCategory(c.id)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", category === c.id ? "bg-accent text-accent-fg" : "bg-text/[.06] text-muted hover:text-text")}>
            {c.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-1">
          <Search className="h-3.5 w-3.5 text-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the catalog" aria-label="Search the catalog" className="w-36 bg-transparent text-xs text-text outline-none placeholder:text-muted/70" />
        </label>
      </div>
      <ul className="mt-3 space-y-2">
        {entries.map((e) => (
          <li key={e.id} className="rounded-xl border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text">{e.name}</p>
                <p className="mt-0.5 text-xs text-muted">{e.description}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {e.license ? `License: ${e.license}` : "License: not stated"} · {e.maintenance} · checked {e.checked} ·{" "}
                  <a href={e.homepage} target="_blank" rel="noreferrer" className="underline hover:text-text">project page</a>
                </p>
                {e.cautions.map((c) => (
                  <p key={c} className="mt-0.5 text-[11px] text-amber-300/90">{c}</p>
                ))}
              </div>
              <EntryAction entry={e} added={e.action.kind === "add-repository" && addedUrls.includes(e.action.indexUrl)} />
            </div>
          </li>
        ))}
      </ul>
      {gap && <p className="mt-3 text-xs text-muted">{gap}</p>}
      {category === "all" && CATALOG_GAPS.audio && <p className="mt-3 text-xs text-muted">{CATALOG_GAPS.audio}</p>}
    </section>
  );
}
