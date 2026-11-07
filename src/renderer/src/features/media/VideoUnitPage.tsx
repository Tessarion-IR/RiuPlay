// RiuPlay: playing a local or direct-URL episode - through hibiki's own VideoPlayer (HLS, DASH, MP4,
// speed, fullscreen, subtitles), so local video gets exactly the playback anime from sources gets.
import { useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { PlayerLink } from "@shared/types";
import { VideoPlayer } from "@/features/player/VideoPlayer";
import { playerLinkTypeFor, unitLabelKey, unitName } from "@/lib/media";
import { useProgressSaver, useUnit } from "./useUnit";

export function VideoUnitPage({ mediaId, unitId }: { mediaId: number; unitId: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { query, details, unit, prev, next, resumeAt } = useUnit(mediaId, unitId);
  const saver = useProgressSaver(unitId, mediaId);
  // Stable callbacks: VideoPlayer lists these in the dependencies of the effect that wires up the
  // media element, so a new function on every render would re-attach its listeners each time.
  const onProgress = useCallback((positionMs: number, durationMs: number) => saver.report(positionMs, durationMs), [saver]);
  const onPlayStateChange = useCallback((playing: boolean) => {
    if (!playing) void saver.flush();
  }, [saver]);
  const kindLabel = t(unitLabelKey("video"));

  // Built from plain values only, so the same episode always yields the same link object.
  const url = unit?.url ?? "";
  const subtitleUrl = unit?.subtitleUrl ?? null;
  const origin = details?.item.origin;
  const link = useMemo<PlayerLink | undefined>(
    () =>
      url
        ? {
            url,
            type: playerLinkTypeFor(url),
            playerName: origin === "file" ? t("media.origin.file") : null,
            subtitles: subtitleUrl ? [{ url: subtitleUrl, label: t("media.units.subtitles") }] : undefined,
          }
        : undefined,
    [origin, subtitleUrl, t, url],
  );
  const episodes = useMemo(() => (details?.units ?? []).map((u) => ({ id: String(u.id), number: u.number, title: u.title || null })), [details?.units]);
  const go = (id: number) => void navigate({ to: "/play/$mediaId/$unitId", params: { mediaId: String(mediaId), unitId: String(id) } });
  const back = () => void navigate({ to: "/media/$mediaId", params: { mediaId: String(mediaId) } });

  if (query.isPending) return <div className="h-full bg-black" />;
  if (!details || !unit) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-black text-center">
        <p className="text-sm text-white/80">{t("media.detail.notFound")}</p>
        <button type="button" onClick={back} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20">{t("detail.back")}</button>
      </div>
    );
  }

  return (
    <VideoPlayer
      key={unit.id}
      link={link}
      unplayable={!link}
      unplayableReason="unsupported"
      offlinePlayback={details.item.origin === "file"}
      startPositionMs={resumeAt ?? undefined}
      onProgress={onProgress}
      onPlayStateChange={onPlayStateChange}
      title={details.item.title}
      episodeLabel={unitName(unit, kindLabel)}
      onBack={back}
      onPrevEpisode={prev ? () => go(prev.id) : undefined}
      onNextEpisode={next ? () => go(next.id) : undefined}
      episodes={episodes}
      currentEpisodeId={String(unit.id)}
      onSelectEpisode={(id) => go(Number(id))}
    />
  );
}
