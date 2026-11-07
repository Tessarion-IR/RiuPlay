"use client";

import { useEffect, useState } from "react";
import { Plus, Clapperboard } from "lucide-react";
import { api, type MediaItem } from "@/lib/client-api";
import { MediaCard } from "@/components/MediaCard";
import { EmptyState, LoadingState, ErrorState, Button } from "@/components/ui";
import { AddMediaModal } from "@/components/AddMediaModal";

export default function AnimePage() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    setError(null);
    api
      .get<{ items: MediaItem[] }>("/api/media?contentType=anime")
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold">Anime &amp; Video</h1>
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={15} /> Add anime / video
        </Button>
      </div>
      <p className="text-sm text-dim mb-6 max-w-2xl">
        RiuPlay cannot execute the Android/Kotlin extensions published by the yuzono/keiyoushi repositories inside
        this process (see Extensions &amp; Sources for details). The fully working path today is adding direct
        HTTP(S)/HLS video URLs or importing local video files you have the rights to play.
      </p>

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && !items && <LoadingState />}
      {!error && items && items.length === 0 && (
        <EmptyState
          icon={<Clapperboard size={36} />}
          title="No anime or video items yet"
          description="Add your first item by direct URL to start building your library."
          action={<Button onClick={() => setShowAdd(true)}>Add anime / video</Button>}
        />
      )}
      {items && items.length > 0 && (
        <div className="flex gap-4 flex-wrap">
          {items.map((m) => (
            <MediaCard key={m.id} media={m} />
          ))}
        </div>
      )}

      <AddMediaModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        contentType="anime"
        onCreated={(item) => setItems((list) => [item, ...(list ?? [])])}
      />
    </div>
  );
}
