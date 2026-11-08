// RiuPlay: search results from the user's own library - local files, links and server titles,
// video, manga and audio alike - shown above a source's results, each labelled with where it is
// from, so search is not only "the active anime source".
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { MediaItem } from "@shared/media";
import { hibiki } from "@/lib/hibiki";
import { mediaKeys } from "@/lib/media";
import { MediaCard } from "@/components/media/MediaCard";

export function originLabel(item: MediaItem): string {
  if (item.origin === "file") return "Your files";
  if (item.origin === "server") return item.originRef.startsWith("suwayomi:") ? "Your Suwayomi server" : "Your Kikoeru server";
  if (item.origin === "extension") return "From a source";
  if (item.origin === "direct") return "Link";
  return "Added by you";
}

export function LibrarySearchResults({ query }: { query: string }) {
  const { t } = useTranslation();
  const search = query.trim();
  const results = useQuery({ queryKey: mediaKeys.list({ search }), queryFn: () => hibiki.media.list({ search }), enabled: search.length >= 2 });
  const items = results.data ?? [];
  if (search.length < 2 || items.length === 0) return null;
  return (
    <section className="mb-8" data-testid="library-search">
      <h2 className="mb-3 text-base font-bold text-text">{t("search.inLibrary", { defaultValue: "In your library" })}</h2>
      <div className="grid grid-cols-6 gap-x-4 gap-y-6 mobile:grid-cols-3">
        {items.slice(0, 12).map((s) => (
          <MediaCard key={s.item.id} item={s.item} library={s.library} subtitle={`${t(`media.type.${s.item.type}`)} · ${originLabel(s.item)}`} />
        ))}
      </div>
    </section>
  );
}
