"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, Clock } from "lucide-react";
import { api, type MediaItem } from "@/lib/client-api";
import { MediaCard } from "@/components/MediaCard";
import { EmptyState, LoadingState, Button } from "@/components/ui";

type ContentFilter = "all" | "anime" | "manga" | "audio";

export default function DiscoverPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [results, setResults] = useState<MediaItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<{ id: number; query: string }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadRecent = () => {
    api.get<{ items: { id: number; query: string }[] }>("/api/search-history").then((r) => setRecent(r.items));
  };
  useEffect(loadRecent, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: query });
        if (filter !== "all") params.set("contentType", filter);
        const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
        const body = await res.json();
        setResults(body.items ?? []);
        void api.post("/api/search-history", { query, contentType: filter });
        loadRecent();
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter]);

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Discover</h1>
      <p className="text-sm text-dim mb-6">
        Search across everything RiuPlay has indexed locally — items you&apos;ve added by direct URL, manual entry,
        or imported from a connected Suwayomi server.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, genres…"
            className="focus-ring w-full rounded-lg surface-2 pl-9 pr-9 py-2.5 text-sm outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:opacity-70"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 surface-2 rounded-lg p-1">
          {(["all", "anime", "manga", "audio"] as ContentFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`focus-ring px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                filter === f ? "accent-bg text-white" : "text-dim hover:text-[var(--text)]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {!query.trim() && (
        <div className="mb-8">
          {recent.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-6">
              <span className="text-xs text-dim flex items-center gap-1"><Clock size={13}/> Recent:</span>
              {recent.slice(0, 10).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setQuery(r.query)}
                  className="focus-ring surface-2 rounded-full px-2.5 py-1 text-xs hover:accent-text"
                >
                  {r.query}
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => api.del("/api/search-history").then(loadRecent)}
              >
                Clear
              </Button>
            </div>
          )}
          <EmptyState
            icon={<Search size={36} />}
            title="Start typing to search"
            description="Global search looks across your locally indexed anime, manga and audio items. Discovery of new sources happens in Extensions & Sources or via a connected Suwayomi server for manga."
          />
        </div>
      )}

      {query.trim() && loading && <LoadingState label="Searching…" />}
      {query.trim() && !loading && results && results.length === 0 && (
        <EmptyState title="No matches" description={`Nothing in your library matches "${query}".`} />
      )}
      {results && results.length > 0 && (
        <div className="flex gap-4 flex-wrap">
          {results.map((m) => (
            <MediaCard key={m.id} media={m} />
          ))}
        </div>
      )}
    </div>
  );
}
