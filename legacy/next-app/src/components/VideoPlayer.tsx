"use client";

import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipForward,
  AlertTriangle,
  Loader2,
} from "lucide-react";

export interface VideoPlayerProps {
  src: string;
  subtitleUrl?: string | null;
  startPosition?: number;
  autoPlay?: boolean;
  defaultVolume?: number;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onNextEpisode?: () => void;
  hasNext?: boolean;
  title?: string;
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` : `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoPlayer({
  src,
  subtitleUrl,
  startPosition = 0,
  autoPlay = false,
  defaultVolume = 0.8,
  onProgress,
  onEnded,
  onNextEpisode,
  hasNext,
  title,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(startPosition);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(defaultVolume);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load source, using hls.js for .m3u8 when native HLS isn't supported.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setLoading(true);
    let hls: import("hls.js").default | null = null;

    const isHls = src.includes(".m3u8");
    if (isHls && !video.canPlayType("application/vnd.apple.mpegurl")) {
      import("hls.js").then(({ default: Hls }) => {
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(src);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) setError(`Playback error: ${data.details || "stream could not be loaded"}.`);
          });
        } else {
          setError("This browser cannot play HLS (.m3u8) streams.");
        }
      });
    } else {
      video.src = src;
    }

    video.currentTime = startPosition || 0;

    return () => {
      hls?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    video.playbackRate = speed;
  }, [volume, muted, speed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => {
      setPosition(video.currentTime);
      onProgress?.(video.currentTime, video.duration || 0);
    };
    const onLoaded = () => {
      setDuration(video.duration || 0);
      setLoading(false);
      if (autoPlay) video.play().catch(() => undefined);
    };
    const onWaiting = () => setLoading(true);
    const onPlaying = () => {
      setLoading(false);
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onErr = () => setError("This stream could not be played (unsupported format or source unavailable).");
    const onEndedEvt = () => {
      setPlaying(false);
      onEnded?.();
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("error", onErr);
    video.addEventListener("ended", onEndedEvt);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("error", onErr);
      video.removeEventListener("ended", onEndedEvt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => setError("Playback was blocked by the browser."));
    else video.pause();
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => undefined);
  };

  const resetHideTimer = () => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 2800);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowRight") {
        if (videoRef.current) videoRef.current.currentTime += 5;
      } else if (e.code === "ArrowLeft") {
        if (videoRef.current) videoRef.current.currentTime -= 5;
      } else if (e.code === "KeyF") {
        toggleFullscreen();
      } else if (e.code === "KeyM") {
        setMuted((m) => !m);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-xl overflow-hidden group focus:outline-none"
      tabIndex={0}
      onMouseMove={resetHideTimer}
      onMouseLeave={() => setShowControls(false)}
    >
      <video ref={videoRef} className="w-full h-full" onClick={togglePlay}>
        {subtitleUrl && <track kind="subtitles" src={subtitleUrl} default label="Subtitles" />}
      </video>

      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Loader2 className="animate-spin text-white" size={36} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-white p-6 text-center">
          <AlertTriangle size={28} className="text-rose-400" />
          <p className="text-sm max-w-sm">{error}</p>
        </div>
      )}

      {!error && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pt-10 pb-3 transition-opacity ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
        >
          {title && <p className="text-white text-sm font-medium mb-2 truncate">{title}</p>}
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(position, duration || 0)}
            onChange={(e) => {
              if (videoRef.current) videoRef.current.currentTime = Number(e.target.value);
            }}
            className="w-full accent-[var(--accent)] mb-2"
            aria-label="Seek"
          />
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="focus-ring">
                {playing ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button onClick={() => setMuted((m) => !m)} aria-label="Mute" className="focus-ring">
                {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setMuted(false);
                }}
                className="w-20 accent-[var(--accent)]"
                aria-label="Volume"
              />
              <span className="text-xs tabular-nums">
                {formatTime(position)} / {formatTime(duration)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {hasNext && (
                <button onClick={onNextEpisode} className="focus-ring flex items-center gap-1 text-xs" aria-label="Next episode">
                  <SkipForward size={16} /> Next
                </button>
              )}
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="bg-transparent text-xs border border-white/30 rounded px-1 py-0.5 focus-ring"
                aria-label="Playback speed"
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <option key={s} value={s} className="text-black">
                    {s}x
                  </option>
                ))}
              </select>
              <button onClick={toggleFullscreen} aria-label="Fullscreen" className="focus-ring">
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
