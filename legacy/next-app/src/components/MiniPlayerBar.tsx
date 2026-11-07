"use client";

import Link from "next/link";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Repeat1, Shuffle } from "lucide-react";
import { useAudioPlayer } from "@/components/AudioPlayerContext";

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MiniPlayerBar() {
  const p = useAudioPlayer();
  if (!p.current) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 surface border-t px-4 py-2.5 flex items-center gap-4" style={{ borderColor: "var(--border)" }}>
      <Link href={`/audio/${p.current.media.id}`} className="flex items-center gap-3 min-w-0 w-56">
        <div className="w-10 h-10 rounded-md surface-2 overflow-hidden shrink-0 flex items-center justify-center text-lg">
          {p.current.media.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.current.media.cover} alt="" className="w-full h-full object-cover" />
          ) : (
            "🎧"
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{p.current.track.title || `Track ${p.current.track.number}`}</p>
          <p className="text-xs text-dim truncate">{p.current.media.title}</p>
        </div>
      </Link>

      <div className="flex-1 flex flex-col items-center gap-1 max-w-xl mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={p.toggleShuffle} className={`focus-ring rounded p-1 ${p.shuffle ? "accent-text" : "text-dim"}`} aria-label="Shuffle">
            <Shuffle size={15} />
          </button>
          <button onClick={p.previous} className="focus-ring rounded p-1 hover:accent-text" aria-label="Previous">
            <SkipBack size={17} />
          </button>
          <button
            onClick={p.togglePlay}
            className="focus-ring accent-bg text-white rounded-full p-2 hover:brightness-110"
            aria-label={p.isPlaying ? "Pause" : "Play"}
          >
            {p.isPlaying ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button onClick={p.next} className="focus-ring rounded p-1 hover:accent-text" aria-label="Next">
            <SkipForward size={17} />
          </button>
          <button onClick={p.toggleRepeat} className={`focus-ring rounded p-1 ${p.repeat !== "off" ? "accent-text" : "text-dim"}`} aria-label="Repeat">
            {p.repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
          </button>
        </div>
        <div className="flex items-center gap-2 w-full text-[11px] text-dim">
          <span className="w-9 text-right">{formatTime(p.position)}</span>
          <input
            type="range"
            min={0}
            max={p.duration || 0}
            value={Math.min(p.position, p.duration || 0)}
            onChange={(e) => p.seek(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
            aria-label="Seek"
          />
          <span className="w-9">{formatTime(p.duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 w-40 justify-end">
        <select
          value={p.speed}
          onChange={(e) => p.setSpeed(Number(e.target.value))}
          className="surface-2 rounded-md text-xs px-1.5 py-1 focus-ring"
          aria-label="Playback speed"
        >
          {[0.75, 1, 1.25, 1.5, 2].map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <button onClick={p.toggleMute} className="focus-ring rounded p-1 text-dim hover:accent-text" aria-label="Mute">
          {p.muted || p.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={p.muted ? 0 : p.volume}
          onChange={(e) => p.setVolume(Number(e.target.value))}
          className="w-16 accent-[var(--accent)]"
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
