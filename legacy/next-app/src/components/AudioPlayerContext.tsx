"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type MediaItem, type Track } from "@/lib/client-api";

export interface QueueItem {
  media: MediaItem;
  track: Track;
}

interface AudioPlayerContextValue {
  queue: QueueItem[];
  currentIndex: number;
  current: QueueItem | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  speed: number;
  repeat: "off" | "one" | "all";
  shuffle: boolean;
  playQueue: (items: QueueItem[], startIndex?: number) => void;
  playNow: (media: MediaItem, track: Track) => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setSpeed: (s: number) => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [repeat, setRepeat] = useState<"off" | "one" | "all">("off");
  const [shuffle, setShuffle] = useState(false);
  const lastSaveRef = useRef(0);

  const current = currentIndex >= 0 ? queue[currentIndex] ?? null : null;

  const playQueue = useCallback((items: QueueItem[], startIndex = 0) => {
    setQueue(items);
    setCurrentIndex(startIndex);
    setIsPlaying(true);
  }, []);

  const playNow = useCallback((media: MediaItem, track: Track) => {
    setQueue([{ media, track }]);
    setCurrentIndex(0);
    setIsPlaying(true);
  }, []);

  const next = useCallback(() => {
    setCurrentIndex((i) => {
      if (queue.length === 0) return i;
      if (shuffle) return Math.floor(Math.random() * queue.length);
      if (i + 1 < queue.length) return i + 1;
      return repeat === "all" ? 0 : i;
    });
  }, [queue.length, repeat, shuffle]);

  const previous = useCallback(() => {
    setCurrentIndex((i) => (i - 1 >= 0 ? i - 1 : i));
  }, []);

  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);
  const seek = useCallback((time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time;
    setPosition(time);
  }, []);
  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    setMuted(false);
  }, []);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const setSpeed = useCallback((s: number) => setSpeedState(s), []);
  const toggleRepeat = useCallback(
    () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
    [],
  );
  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);

  // Sync <audio> element with state.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current) return;
    if (el.src !== current.track.audioUrl) {
      el.src = current.track.audioUrl;
      const resume = current.media.extra as Record<string, unknown> | undefined;
      void resume;
      el.currentTime = 0;
    }
  }, [current]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
    el.playbackRate = speed;
  }, [volume, muted, speed]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current) return;
    if (isPlaying) el.play().catch(() => setIsPlaying(false));
    else el.pause();
  }, [isPlaying, current]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setPosition(el.currentTime);
      const now = Date.now();
      if (current && now - lastSaveRef.current > 8000 && el.currentTime > 2) {
        lastSaveRef.current = now;
        const pct = el.duration ? el.currentTime / el.duration : 0;
        void api.post("/api/library/progress", {
          mediaItemId: current.media.id,
          unitId: current.track.id,
          unitType: "track",
          position: el.currentTime,
          duration: el.duration || 0,
          percentage: pct,
        });
      }
    };
    const onLoaded = () => setDuration(el.duration || 0);
    const onEnded = () => {
      if (current) {
        void api.post("/api/history", {
          mediaItemId: current.media.id,
          type: "audio",
          unitId: current.track.id,
          unitLabel: current.track.title || `Track ${current.track.number}`,
          position: el.duration || 0,
          duration: el.duration || 0,
          completed: true,
        });
        void api.post("/api/library/progress", {
          mediaItemId: current.media.id,
          unitId: current.track.id,
          unitType: "track",
          position: 0,
          duration: el.duration || 0,
          percentage: 1,
        });
      }
      if (repeat === "one") {
        el.currentTime = 0;
        el.play().catch(() => undefined);
      } else {
        next();
      }
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, repeat]);

  return (
    <AudioPlayerContext.Provider
      value={{
        queue,
        currentIndex,
        current,
        isPlaying,
        position,
        duration,
        volume,
        muted,
        speed,
        repeat,
        shuffle,
        playQueue,
        playNow,
        togglePlay,
        next,
        previous,
        seek,
        setVolume,
        toggleMute,
        setSpeed,
        toggleRepeat,
        toggleShuffle,
      }}
    >
      {children}
      <audio ref={audioRef} />
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
  return ctx;
}
