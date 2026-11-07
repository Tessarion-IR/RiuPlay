// RiuPlay M2: Settings > the opt-in Java runtime for APK (Aniyomi) sources. Off by default; turning
// it on is an explicit choice made with the warning in view, and applies from the next start.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { useState } from "react";
import { hibiki } from "@/lib/hibiki";

export function ApkRuntimeRow() {
  const api = hibiki.network.apkRuntime;
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["apkRuntime"], queryFn: () => api!.get(), enabled: Boolean(api) });
  const [confirming, setConfirming] = useState(false);
  const set = useMutation({ mutationFn: (enabled: boolean) => api!.set(enabled), onSuccess: (data) => queryClient.setQueryData(["apkRuntime"], data) });
  if (!api || !state.data) return null;
  const { enabled, running } = state.data;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-text/[.03] p-4 text-sm" data-testid="apk-runtime">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-text/[.06] text-muted">
        <Cpu className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-semibold text-text">APK (Aniyomi) sources</p>
        <p className="text-xs leading-relaxed text-muted">
          Runs Android extension code in a Java process with your full Windows user rights. Unlike RiuPlay's own extensions it is not sandboxed and its
          network traffic does not go through RiuPlay's protections. Off unless you turn it on; changes apply after a restart.
          {running !== enabled ? " Restart RiuPlay to apply your choice." : ""}
        </p>
        {confirming ? (
          <div className="space-y-2 rounded-lg border border-red-500/40 p-3 text-xs">
            <p className="text-text">Allow APK extensions to run with your full user rights?</p>
            <div className="flex gap-2">
              <button type="button" className="rounded-lg border border-border px-3 py-1.5 font-semibold text-red-300 hover:bg-text/[.06]" onClick={() => { set.mutate(true); setConfirming(false); }}>
                Allow (from the next start)
              </button>
              <button type="button" className="rounded-lg border border-border px-3 py-1.5 font-semibold text-text hover:bg-text/[.06]" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text hover:bg-text/[.06]" disabled={set.isPending} onClick={() => (enabled ? set.mutate(false) : setConfirming(true))}>
            {enabled ? "Turn off" : "Turn on..."}
          </button>
        )}
      </div>
    </div>
  );
}
