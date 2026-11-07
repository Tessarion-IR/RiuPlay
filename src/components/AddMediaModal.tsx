"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal, Button, Field, inputClass, useToast } from "@/components/ui";
import { api, type MediaItem } from "@/lib/client-api";

type ContentType = "anime" | "manga" | "audio";

interface UnitRow {
  number: string;
  title: string;
  url: string; // videoUrl / audioUrl
  subtitleUrl: string;
  pages: string; // newline separated, manga only
}

function emptyUnit(n: number): UnitRow {
  return { number: String(n), title: "", url: "", subtitleUrl: "", pages: "" };
}

export function AddMediaModal({
  open,
  onClose,
  contentType,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  contentType: ContentType;
  onCreated: (item: MediaItem) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [cover, setCover] = useState("");
  const [description, setDescription] = useState("");
  const [genres, setGenres] = useState("");
  const [units, setUnits] = useState<UnitRow[]>([emptyUnit(1)]);
  const [saving, setSaving] = useState(false);

  const label = contentType === "anime" ? "Episode" : contentType === "manga" ? "Chapter" : "Track";

  const reset = () => {
    setTitle("");
    setCover("");
    setDescription("");
    setGenres("");
    setUnits([emptyUnit(1)]);
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.push("error", "Title is required.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        contentType,
        title: title.trim(),
        description,
        cover,
        genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
        sourceType: "direct",
      };

      if (contentType === "anime") {
        payload.episodes = units
          .filter((u) => u.url.trim())
          .map((u) => ({
            number: Number(u.number) || 1,
            title: u.title,
            videoUrl: u.url.trim(),
            subtitleUrl: u.subtitleUrl.trim() || null,
          }));
      } else if (contentType === "manga") {
        payload.sourceType = "manual";
        payload.chapters = units
          .filter((u) => u.pages.trim())
          .map((u) => ({
            number: Number(u.number) || 1,
            title: u.title,
            pages: u.pages
              .split("\n")
              .map((p) => p.trim())
              .filter(Boolean),
          }));
      } else {
        payload.tracks = units
          .filter((u) => u.url.trim())
          .map((u) => ({ number: Number(u.number) || 1, title: u.title, audioUrl: u.url.trim() }));
      }

      const res = await api.post<{ item: MediaItem }>("/api/media", payload);
      toast.push("success", `${res.item.title} added.`);
      onCreated(res.item);
      reset();
      onClose();
    } catch (err) {
      toast.push("error", (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
      }}
      title={`Add ${contentType === "anime" ? "Anime / Video" : contentType === "manga" ? "Manga (Manual)" : "Audio"}`}
      width="max-w-2xl"
    >
      <Field label="Title">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cover image URL (optional)">
          <input className={inputClass} value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Genres (comma separated)">
          <input className={inputClass} value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="Action, Drama" />
        </Field>
      </div>
      <Field label="Description (optional)">
        <textarea
          className={inputClass}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="mt-2 mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-dim">{label}s</span>
        <Button size="sm" variant="secondary" onClick={() => setUnits((u) => [...u, emptyUnit(u.length + 1)])}>
          <Plus size={13} /> Add {label.toLowerCase()}
        </Button>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {units.map((u, i) => (
          <div key={i} className="surface-2 rounded-lg p-2.5">
            <div className="flex gap-2 mb-1.5">
              <input
                className={`${inputClass} w-16`}
                value={u.number}
                onChange={(e) => setUnits((list) => list.map((x, idx) => (idx === i ? { ...x, number: e.target.value } : x)))}
                placeholder="#"
              />
              <input
                className={inputClass}
                value={u.title}
                onChange={(e) => setUnits((list) => list.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x)))}
                placeholder={`${label} title (optional)`}
              />
              <button
                onClick={() => setUnits((list) => list.filter((_, idx) => idx !== i))}
                className="text-dim hover:text-rose-500 focus-ring rounded p-1.5"
                aria-label="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
            {contentType === "manga" ? (
              <textarea
                className={inputClass}
                rows={2}
                placeholder="Page image URLs, one per line"
                value={u.pages}
                onChange={(e) => setUnits((list) => list.map((x, idx) => (idx === i ? { ...x, pages: e.target.value } : x)))}
              />
            ) : (
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder={contentType === "anime" ? "Video URL (mp4/m3u8/https)" : "Audio URL (mp3/wav/https)"}
                  value={u.url}
                  onChange={(e) => setUnits((list) => list.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))}
                />
                {contentType === "anime" && (
                  <input
                    className={inputClass}
                    placeholder="Subtitle URL (.vtt, optional)"
                    value={u.subtitleUrl}
                    onChange={(e) =>
                      setUnits((list) => list.map((x, idx) => (idx === i ? { ...x, subtitleUrl: e.target.value } : x)))
                    }
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-dim mt-3">
        RiuPlay plays direct HTTP(S) media URLs (and HLS .m3u8 where the browser/hls.js supports it). Use{" "}
        <strong>Import local file</strong> on the detail page afterwards to upload files from this computer instead of
        linking a URL.
      </p>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving}>
          Add
        </Button>
      </div>
    </Modal>
  );
}
