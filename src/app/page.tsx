"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass, Sparkles } from "lucide-react";
import { api, type HistoryRow, type LibraryRow, type MediaItem } from "@/lib/client-api";
import { useAppData } from "@/components/AppContext";
import { MediaCard, MediaRow } from "@/components/MediaCard";
import { LoadingState, ErrorState, EmptyState, Button } from "@/components/ui";

interface HomeData {
  continueWatching: HistoryRow[];
  continueReading: HistoryRow[];
  continueListening: HistoryRow[];
  recentlyAdded: MediaItem[];
  favorites: LibraryRow[];
}

export default function HomePage() {
  const { profile } = useAppData();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .get<HomeData>("/api/home")
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading your home…" />;

  const isEmpty =
    data.continueWatching.length === 0 &&
    data.continueReading.length === 0 &&
    data.continueListening.length === 0 &&
    data.recentlyAdded.length === 0 &&
    data.favorites.length === 0;

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <header className="mb-8">
        <p className="text-sm text-dim">Welcome back,</p>
        <h1 className="text-2xl font-semibold">{profile?.name ?? "Player One"} 👋</h1>
      </header>

      {isEmpty ? (
        <EmptyState
          icon={<Sparkles size={40} />}
          title="Your library is empty — let's add your first content"
          description="RiuPlay doesn't ship with fake demo content. Add an anime/video by direct URL, a manga manually or via a connected Suwayomi server, or import a local audio file, then it will show up here."
          action={
            <div className="flex gap-2 mt-2 flex-wrap justify-center">
              <Link href="/anime"><Button>Add anime/video</Button></Link>
              <Link href="/manga"><Button variant="secondary">Add manga</Button></Link>
              <Link href="/audio"><Button variant="secondary">Add audio</Button></Link>
              <Link href="/extensions"><Button variant="ghost">Browse extension repositories</Button></Link>
            </div>
          }
        />
      ) : (
        <>
          <MediaRow title="Continue Watching" emptyHint="Watch something to see it appear here.">
            {data.continueWatching.map((h) => (
              <MediaCard
                key={h.history.id}
                media={h.media}
                progress={h.history.duration ? h.history.position / h.history.duration : 0}
                subtitle={h.history.unitLabel}
              />
            ))}
          </MediaRow>
          <MediaRow title="Continue Reading" emptyHint="Read a chapter to see it appear here.">
            {data.continueReading.map((h) => (
              <MediaCard key={h.history.id} media={h.media} subtitle={h.history.unitLabel} />
            ))}
          </MediaRow>
          <MediaRow title="Continue Listening" emptyHint="Play a track to see it appear here.">
            {data.continueListening.map((h) => (
              <MediaCard
                key={h.history.id}
                media={h.media}
                progress={h.history.duration ? h.history.position / h.history.duration : 0}
                subtitle={h.history.unitLabel}
              />
            ))}
          </MediaRow>
          <MediaRow title="Favorites" emptyHint="Mark items as favorite from their detail page.">
            {data.favorites.map((f) => (
              <MediaCard key={f.entry.id} media={f.media} favorite />
            ))}
          </MediaRow>
          <MediaRow title="Recently Added" emptyHint="Items you add will show up here.">
            {data.recentlyAdded.map((m) => (
              <MediaCard key={m.id} media={m} />
            ))}
          </MediaRow>
        </>
      )}

      <section className="surface rounded-2xl p-5 mt-6 flex items-start gap-3">
        <Compass className="accent-text mt-0.5" size={20} />
        <div>
          <h3 className="font-medium text-sm">Looking for new sources?</h3>
          <p className="text-sm text-dim mt-1">
            Visit <Link href="/extensions" className="accent-text underline">Extensions &amp; Sources</Link> to browse
            real community repository metadata, or configure a Suwayomi Server for live manga browsing in{" "}
            <Link href="/settings" className="accent-text underline">Settings</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
