// RiuPlay: reading a manga chapter - a continuous vertical reader that remembers the page, resumes at
// it, and moves on to the next chapter. The original RiuPlay's reader settings (readerDefaults: mode,
// direction, fit, zoom) and Suwayomi-style prefetch/caching extend this reader in Phase 9.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { unitLabelKey, unitName } from "@/lib/media";
import { useProgressSaver, useUnit } from "./useUnit";

type Fit = "width" | "height";

export function MangaReaderPage({ mediaId, unitId }: { mediaId: number; unitId: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { query, details, unit, prev, next, resumeAt } = useUnit(mediaId, unitId);
  const saver = useProgressSaver(unitId, mediaId, 1500);
  const [page, setPage] = useState(0);
  const [fit, setFit] = useState<Fit>(() => (localStorage.getItem("riuplay-reader-fit") === "height" ? "height" : "width"));
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const kindLabel = t(unitLabelKey("manga"));
  const pages = unit?.pages ?? [];
  const go = (id: number) => void navigate({ to: "/read/$mediaId/$unitId", params: { mediaId: String(mediaId), unitId: String(id) } });

  // Resume at the saved page once the pages are on screen.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !pages.length) return;
    resumed.current = true;
    if (resumeAt && resumeAt < pages.length) {
      setPage(resumeAt);
      requestAnimationFrame(() => pageRefs.current[resumeAt]?.scrollIntoView({ block: "start" }));
    }
  }, [pages.length, resumeAt]);

  // The page most in view is the current page; it is what gets saved.
  useEffect(() => {
    if (!pages.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        const index = Number((best.target as HTMLElement).dataset.page);
        setPage(index);
        saver.report(index, pages.length);
      },
      { threshold: [0.25, 0.5, 0.75] },
    );
    for (const el of pageRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [pages.length, saver]);

  useEffect(() => {
    try {
      localStorage.setItem("riuplay-reader-fit", fit);
    } catch {
      // not remembered, that's all
    }
  }, [fit]);

  if (query.isPending) return <div className="p-8"><div className="h-96 animate-pulse rounded-2xl bg-text/[.06]" /></div>;
  if (!details || !unit) return <p className="p-8 text-sm text-muted">{t("media.detail.notFound")}</p>;

  return (
    <div className="min-h-full bg-black/95">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-black/80 px-4 py-2 backdrop-blur">
        <Link to="/media/$mediaId" params={{ mediaId: String(mediaId) }} className="flex items-center gap-1.5 text-sm font-semibold text-white/70 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          <span className="max-w-[16rem] truncate">{details.item.title}</span>
        </Link>
        <span className="truncate text-sm text-white/90">{unitName(unit, kindLabel)}</span>
        <span className="ml-auto text-xs tabular-nums text-white/60">{t("media.reader.page", { page: Math.min(page + 1, pages.length), total: pages.length })}</span>
        <select value={fit} onChange={(e) => setFit(e.target.value as Fit)} aria-label={t("media.reader.fit")} className="rounded-md border border-white/20 bg-black px-2 py-1 text-xs text-white">
          <option value="width">{t("media.reader.fitWidth")}</option>
          <option value="height">{t("media.reader.fitHeight")}</option>
        </select>
        <button type="button" disabled={!prev} onClick={() => prev && go(prev.id)} aria-label={t("media.reader.previousChapter")} className="rounded-md p-1 text-white/80 hover:bg-white/10 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
        <button type="button" disabled={!next} onClick={() => next && go(next.id)} aria-label={t("media.reader.nextChapter")} className="rounded-md p-1 text-white/80 hover:bg-white/10 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
      </header>

      <div className="mx-auto flex max-w-4xl flex-col items-center">
        {pages.map((src, index) => (
          <div key={`${unit.id}-${index}`} ref={(el) => void (pageRefs.current[index] = el)} data-page={index} className="w-full">
            {failed.has(index) ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-white/60">
                <ImageOff className="h-6 w-6" />
                {t("media.reader.pageFailed", { page: index + 1 })}
              </div>
            ) : (
              <img
                src={src}
                alt={t("media.reader.page", { page: index + 1, total: pages.length })}
                loading={Math.abs(index - (resumeAt ?? 0)) < 3 ? "eager" : "lazy"}
                onError={() => setFailed((set) => new Set(set).add(index))}
                className={cn("mx-auto block select-none", fit === "width" ? "w-full" : "max-h-[calc(100vh-48px)] w-auto")}
                draggable={false}
              />
            )}
          </div>
        ))}
        <div className="flex w-full flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-white/70">{t("media.reader.endOfChapter")}</p>
          {next ? (
            <button type="button" onClick={() => { saver.report(pages.length - 1, pages.length, true); go(next.id); }} className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-fg">
              {t("media.reader.nextChapter")} · {unitName(next, kindLabel)}
            </button>
          ) : (
            <Link to="/media/$mediaId" params={{ mediaId: String(mediaId) }} className="rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20">{t("media.reader.backToTitle")}</Link>
          )}
        </div>
      </div>
    </div>
  );
}
