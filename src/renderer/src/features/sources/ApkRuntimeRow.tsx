// RiuPlay: Settings > the Java runtime for APK sources (Keiyoushi manga and Aniyomi anime extensions). Since K4
// it runs confined (an AppContainer with no capabilities and a Job Object; network only through RiuPlay), so
// it is on by default; turning it off applies from the next start.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { hibiki } from "@/lib/hibiki";

export function ApkRuntimeRow() {
  const api = hibiki.network.apkRuntime;
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["apkRuntime"], queryFn: () => api!.get(), enabled: Boolean(api) });
  const set = useMutation({ mutationFn: (enabled: boolean) => api!.set(enabled), onSuccess: (data) => queryClient.setQueryData(["apkRuntime"], data) });
  if (!api || !state.data) return null;
  const { enabled, running } = state.data;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-text/[.03] p-4 text-sm" data-testid="apk-runtime">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-text/[.06] text-muted">
        <Cpu className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-semibold text-text">APK sources (Keiyoushi manga, Aniyomi anime)</p>
        <p className="text-xs leading-relaxed text-muted">
          Android extension code runs in RiuPlay's own Java runtime, inside a Windows sandbox: it cannot open your files, other programs or the
          network directly. Every connection it makes goes through RiuPlay's network rules (public websites only, never your computer or local
          network; your proxy applies). Changes apply after a restart.
          {running !== enabled ? " Restart RiuPlay to apply your choice." : ""}
        </p>
        <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text hover:bg-text/[.06]" disabled={set.isPending} onClick={() => set.mutate(!enabled)}>
          {enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
    </div>
  );
}
