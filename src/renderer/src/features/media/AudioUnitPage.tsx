// RiuPlay: listening to an audio/ASMR track - the original RiuPlay's audio player (legacy
// AudioPlayerContext + MiniPlayerBar) as a page: cover, track list, play/pause, seek, previous/next,
// volume, playback speed, resume and automatic next track, plus Windows media keys through the Media
// Session API. KikoFlu's queue, loop/shuffle, sleep timer, synced lyrics and session restore build on
// this page in Phase 8 (see docs/FEATURE_INTEGRATION_MATRIX.md).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Headphones, Loader2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { SmoothImage } from "@/components/SmoothImage";
import { cn } from "@/lib/cn";
import { formatClock, unitLabelKey, unitName } from "@/lib/media";
import { useProgressSaver, useUnit } from "./useUnit";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function AudioUnitPage({ mediaId, unitId }: { mediaId: number; unitId: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { query, details, unit, prev, next, resumeAt } = useUnit(mediaId, unitId);
  const saver = useProgressSaver(unitId, mediaId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("riuplay-audio-volume") ?? 0.9) || 0.9);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const kindLabel = t(unitLabelKey("audio"));

  const go = useCallback((id: number) => void navigate({ to: "/listen/$mediaId/$unitId", params: { mediaId: String(mediaId), unitId: String(id) } }), [mediaId, navigate]);

  // Resume where the track was left, once its length is known.
  const resumed = useRef(false);
  const onLoaded = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration * 1000);
    setLoading(false);
    if (!resumed.current && resumeAt) audio.currentTime = resumeAt / 1000;
    resumed.current = true;
    void audio.play().catch(() => setPlaying(false));
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
      audio.playbackRate = speed;
    }
    try {
      localStorage.setItem("riuplay-audio-volume", String(volume));
    } catch {
      // storage unavailable; the volume just isn't remembered
    }
  }, [volume, muted, speed]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  // Windows media keys and the system media overlay (SMTC), through the Media Session API.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !details || !unit) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: unitName(unit, kindLabel),
      album: details.item.title,
      artwork: details.item.cover ? [{ src: details.item.cover }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => void audioRef.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler("previoustrack", prev ? () => go(prev.id) : null);
    navigator.mediaSession.setActionHandler("nexttrack", next ? () => go(next.id) : null);
    return () => {
      for (const action of ["play", "pause", "previoustrack", "nexttrack"] as MediaSessionAction[]) navigator.mediaSession.setActionHandler(action, null);
    };
  }, [details, go, kindLabel, next, prev, unit]);

  // Space toggles playback, arrows seek - unless the user is typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const audio = audioRef.current;
      if (!audio) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowRight") audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
      else if (event.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 10);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  if (query.isPending) return <div className="p-8"><div className="h-64 animate-pulse rounded-2xl bg-text/[.06]" /></div>;
  if (!details || !unit) return <p className="p-8 text-sm text-muted">{t("media.detail.notFound")}</p>;
  const { item, units } = details;

  return (
    <div className="min-h-full bg-app-bg px-8 py-6 pb-16 mobile:px-4">
      <Link to="/media/$mediaId" params={{ mediaId: String(mediaId) }} className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" />
        {item.title}
      </Link>

      <div className="mx-auto flex max-w-5xl gap-10 mobile:flex-col">
        <div className="w-80 shrink-0 mobile:w-full">
          <div className="aspect-square overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-border">
            {item.cover ? <SmoothImage src={item.cover} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted"><Headphones className="h-16 w-16" strokeWidth={1.25} /></div>}
          </div>
          <p className="mt-5 line-clamp-2 text-xl font-bold text-text">{unitName(unit, kindLabel)}</p>
          <p className="mt-1 truncate text-sm text-muted">{item.title}</p>

          <audio
            key={unit.id}
            ref={audioRef}
            src={unit.url}
            preload="auto"
            onLoadedMetadata={onLoaded}
            onWaiting={() => setLoading(true)}
            onPlaying={() => {
              setLoading(false);
              setPlaying(true);
              setError(null);
            }}
            onPause={() => {
              setPlaying(false);
              void saver.flush();
            }}
            onTimeUpdate={(e) => {
              const ms = e.currentTarget.currentTime * 1000;
              setPosition(ms);
              saver.report(ms, e.currentTarget.duration * 1000);
            }}
            onEnded={(e) => {
              saver.report(e.currentTarget.duration * 1000, e.currentTarget.duration * 1000, true);
              if (next) go(next.id);
            }}
            onError={() => {
              setLoading(false);
              setError(t(item.origin === "file" ? "media.player.fileError" : "media.player.streamError"));
            }}
          />

          <div className="mt-5">
            <input
              type="range"
              min={0}
              max={Math.max(1, duration)}
              step={500}
              value={Math.min(position, duration || 0)}
              onChange={(e) => {
                if (audioRef.current) audioRef.current.currentTime = Number(e.target.value) / 1000;
              }}
              aria-label={t("media.player.seek")}
              className="w-full accent-[rgb(var(--accent-rgb,124_92_255))]"
            />
            <div className="mt-1 flex justify-between text-xs tabular-nums text-muted">
              <span>{formatClock(position)}</span>
              <span>{duration ? formatClock(duration) : "--:--"}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-center gap-4">
            <button type="button" disabled={!prev} onClick={() => prev && go(prev.id)} aria-label={t("media.player.previous")} className="flex h-11 w-11 items-center justify-center rounded-full text-text transition-colors hover:bg-text/[.06] disabled:opacity-30">
              <SkipBack className="h-5 w-5 fill-current" />
            </button>
            <button type="button" onClick={toggle} aria-label={t(playing ? "media.player.pause" : "media.player.play")} className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg transition-transform hover:scale-105">
              {loading && !error ? <Loader2 className="h-6 w-6 animate-spin" /> : playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="ml-0.5 h-6 w-6 fill-current" />}
            </button>
            <button type="button" disabled={!next} onClick={() => next && go(next.id)} aria-label={t("media.player.next")} className="flex h-11 w-11 items-center justify-center rounded-full text-text transition-colors hover:bg-text/[.06] disabled:opacity-30">
              <SkipForward className="h-5 w-5 fill-current" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button type="button" onClick={() => setMuted((m) => !m)} aria-label={t(muted ? "media.player.unmute" : "media.player.mute")} className="text-muted hover:text-text">
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} aria-label={t("media.player.volume")} className="flex-1" />
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label={t("media.player.speed")} className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text">
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>
          {error && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</p>}
        </div>

        <ol className="min-w-0 flex-1 divide-y divide-border self-start overflow-hidden rounded-2xl border border-border bg-surface">
          {units.map((u) => {
            const done = details.progress.find((p) => p.unitId === u.id)?.completed;
            return (
              <li key={u.id}>
                <button type="button" onClick={() => go(u.id)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-text/[.04]", u.id === unit.id && "bg-accent/10")}>
                  <span className="w-6 text-right text-xs tabular-nums text-muted">{u.id === unit.id && playing ? "▶" : u.number}</span>
                  <span className={cn("min-w-0 flex-1 truncate text-sm", u.id === unit.id ? "font-bold text-text" : done ? "text-muted" : "text-text")}>{u.title || `${kindLabel} ${u.number}`}</span>
                  {u.durationMs ? <span className="text-xs tabular-nums text-muted">{formatClock(u.durationMs)}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
