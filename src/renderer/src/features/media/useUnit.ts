// RiuPlay: what every unit page (play / read / listen) needs - the title, the unit, its neighbours,
// where the user left off - and a progress saver that writes at a steady pace and once more on leave,
// so progress survives closing the window mid-episode without hammering the database.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RESUME_THRESHOLD_MS_RENDERER } from "./constants";
import { hibiki } from "@/lib/hibiki";
import { mediaKeys } from "@/lib/media";

export function useUnit(mediaId: number, unitId: number) {
  const query = useQuery({ queryKey: mediaKeys.detail(mediaId), queryFn: () => hibiki.media.get(mediaId) });
  const details = query.data ?? null;
  return useMemo(() => {
    const units = details?.units ?? [];
    const index = units.findIndex((u) => u.id === unitId);
    const unit = index >= 0 ? units[index] : null;
    const progress = details?.progress.find((p) => p.unitId === unitId) ?? null;
    let resumeAt: number | null = null;
    if (unit && progress && !progress.completed) {
      resumeAt = unit.kind === "chapter" ? (progress.position > 0 ? progress.position : null) : progress.position >= RESUME_THRESHOLD_MS_RENDERER ? progress.position : null;
    }
    return {
      query,
      details,
      unit,
      index,
      prev: index > 0 ? units[index - 1] : null,
      next: index >= 0 && index < units.length - 1 ? units[index + 1] : null,
      progress,
      resumeAt,
    };
  }, [details, query, unitId]);
}

/** Saves progress at most every `intervalMs`, plus a final save when the page goes away. */
export function useProgressSaver(unitId: number, mediaId: number, intervalMs = 5000) {
  const queryClient = useQueryClient();
  const latest = useRef<{ position: number; duration: number } | null>(null);
  const lastSaved = useRef(0);
  // Saves without refreshing the page's own data: a fresh `unit` object mid-playback would hand the
  // player a new source and restart the stream. Other screens are refreshed once, on leave.
  const flush = useCallback(async () => {
    const value = latest.current;
    if (!value) return;
    latest.current = null;
    lastSaved.current = Date.now();
    try {
      await hibiki.media.saveProgress(unitId, value.position, value.duration);
    } catch {
      // A failed save is retried by the next one; nothing to show mid-playback.
    }
  }, [unitId]);

  const report = useCallback(
    (position: number, duration: number, immediately = false) => {
      if (!Number.isFinite(position)) return;
      // A stream or file without a known length (duration Infinity/NaN - live streams, some WebM)
      // still gets its position saved, so it can be resumed; "finished" just can't be decided.
      latest.current = { position: Math.max(0, position), duration: Number.isFinite(duration) && duration > 0 ? duration : 0 };
      if (immediately || Date.now() - lastSaved.current >= intervalMs) void flush();
    },
    [flush, intervalMs],
  );

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      void flush().then(() => {
        void queryClient.invalidateQueries({ queryKey: mediaKeys.detail(mediaId) });
        void queryClient.invalidateQueries({ queryKey: ["media", "continue"] });
        void queryClient.invalidateQueries({ queryKey: ["media", "list"] });
      });
    };
  }, [flush, mediaId, queryClient]);

  return useMemo(() => ({ report, flush }), [report, flush]);
}
