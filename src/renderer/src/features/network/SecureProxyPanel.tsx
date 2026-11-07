// RiuPlay M3: Settings > Network > encrypted proxy. Shows which proxy is in force and where it
// comes from, lets the user store a proxy with its password encrypted (Electron safeStorage), move
// the old plaintext proxy into encrypted storage (preview -> explicit confirmation), verify it on
// BOTH network paths (RiuPlay's own requests and Chromium: player, pictures, sign-in windows), and
// only then remove the old plaintext copy - a separate, explicit action. The password never comes
// back from the main process; this screen only learns whether one is stored.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SecureProxyInput, SecureProxyKind, SecureProxyStatus } from "@shared/types";
import { hibiki } from "@/lib/hibiki";
import { cn } from "@/lib/cn";
import { useNetworkPrefsStore } from "@/stores/networkPrefsStore";
import { proxyPanelActions } from "./proxyPanelLogic";

const KEY = ["network", "secureProxy"];

function describeStored(status: SecureProxyStatus): string | null {
  const s = status.stored;
  if (!s.configured || s.damaged || !s.kind) return null;
  return `${s.kind}://${s.username ? `${s.username}@` : ""}${s.host}:${s.port}${s.hasPassword ? " (password encrypted)" : ""}`;
}

const inputClass = "w-full rounded-lg border border-text/10 bg-text/[.03] px-3 py-2 text-sm text-text outline-none placeholder:text-muted/60 focus:border-accent";
const buttonClass = "rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-text/[.06] disabled:opacity-50";

export function SecureProxyPanel() {
  const api = hibiki.network.secureProxy;
  const queryClient = useQueryClient();
  const legacyProxy = useNetworkPrefsStore((s) => s.proxy);
  const setLegacyProxy = useNetworkPrefsStore((s) => s.setProxy);
  const status = useQuery({ queryKey: [...KEY, legacyProxy], queryFn: () => api!.status(), enabled: Boolean(api), staleTime: 0 });
  const [confirmMigration, setConfirmMigration] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: SecureProxyKind; host: string; port: string; username: string; password: string; localDns: boolean } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

  const migrate = useMutation({
    mutationFn: (display: string) => api!.migrateLegacy(display),
    onSuccess: (result) => {
      setConfirmMigration(false);
      setMessage(result.outcome === "migrated" ? "Moved to encrypted storage. The old plaintext copy is still there until you remove it; verify the proxy first." : `Not moved: ${result.reason}`);
      void refresh();
    },
  });
  const verify = useMutation({ mutationFn: () => api!.verify(), onSuccess: () => void refresh() });
  const save = useMutation({
    mutationFn: (input: SecureProxyInput) => api!.set(input),
    onSuccess: () => {
      setForm(null);
      setMessage("Encrypted proxy saved. It is now used for every request; verify it below.");
      void refresh();
    },
    onError: (error) => setMessage(`Not saved: ${error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (TypeError: |Error: )?/, "") : "error"}`),
  });
  const clear = useMutation({ mutationFn: () => api!.clear(), onSuccess: () => { setMessage("Stored proxy cleared."); void refresh(); } });

  if (!api) return null;
  const s = status.data;
  const stored = s ? describeStored(s) : null;
  const actions = proxyPanelActions(s, legacyProxy);
  const unusable = actions.failingClosed;

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-text/[.03] p-4" data-testid="secure-proxy-panel">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-text/[.06] text-muted">
        <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 space-y-3 text-sm">
        <div>
          <p className="font-semibold text-text">Encrypted proxy</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            The password is encrypted with your Windows account (it can't be read on another account or computer). When an encrypted proxy is stored it
            replaces the plain proxy above for all traffic.
          </p>
        </div>

        {s && (
          <div className={cn("rounded-lg px-3 py-2 text-xs", unusable ? "bg-red-500/10 text-red-300" : "bg-text/[.04] text-muted")} data-testid="secure-proxy-path">
            <div className="flex items-center gap-1.5">
              {unusable ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              <span>In force: {s.path}</span>
            </div>
            {s.effectiveReason && <p className="mt-1">{s.effectiveReason}. Requests are refused (never sent direct) until this is fixed.</p>}
            {s.chromium.mode === "blocked" && s.effectiveState === "ok" && <p className="mt-1">Player and pictures: {s.chromium.reason}</p>}
          </div>
        )}

        {s?.stored.damaged && (
          <p className="text-xs text-red-300">The stored proxy can't be read (damaged, or made on another Windows account or profile). Clear it and enter it again.</p>
        )}
        {stored && <p className="text-xs text-text" data-testid="secure-proxy-stored">Stored: {stored}{s?.stored.origin === "legacy-migration" ? " - moved from the plain setting" : ""}</p>}

        {s && actions.offerMigration && !confirmMigration && (
          <div className="space-y-1">
            <p className="text-xs text-muted">The proxy above is stored in plain text{s.legacy.hasPassword ? ", including its password" : ""}.</p>
            <button type="button" className={buttonClass} onClick={() => setConfirmMigration(true)}>
              Move it to encrypted storage...
            </button>
          </div>
        )}
        {s && s.legacy.action === "refuse" && legacyProxy && <p className="text-xs text-amber-300">The plain proxy can't be moved automatically: {s.legacy.reason}</p>}

        {confirmMigration && s?.legacy.display && (
          <div className="space-y-2 rounded-lg border border-accent/40 p-3 text-xs" role="dialog" aria-label="Confirm proxy migration">
            <p className="text-text">
              Store <span className="font-mono">{s.legacy.display}</span>
              {s.legacy.hasPassword ? " and its password (encrypted)" : ""}?
            </p>
            <p className="text-muted">Nothing is deleted: the plain copy stays until you remove it yourself after verifying.</p>
            <div className="flex gap-2">
              <button type="button" className={buttonClass} disabled={migrate.isPending} onClick={() => migrate.mutate(s.legacy.display!)} data-testid="confirm-migration">
                Move to encrypted storage
              </button>
              <button type="button" className={buttonClass} onClick={() => setConfirmMigration(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {form ? (
          <form
            className="grid grid-cols-2 gap-2 text-xs"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate({ kind: form.kind, host: form.host.trim(), port: Number(form.port), username: form.username || null, password: form.password || null, dnsMode: form.localDns ? "local" : "doh-via-proxy" });
            }}
          >
            <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SecureProxyKind })} aria-label="Proxy type">
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
            </select>
            <input className={inputClass} placeholder="Port" inputMode="numeric" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} aria-label="Port" />
            <input className={cn(inputClass, "col-span-2")} placeholder="Host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} aria-label="Host" spellCheck={false} />
            <input className={inputClass} placeholder="User name (optional)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} aria-label="User name" autoComplete="off" />
            <input className={inputClass} placeholder="Password (optional)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-label="Password" autoComplete="new-password" />
            <label className="col-span-2 flex items-center gap-2 text-muted">
              <input type="checkbox" checked={form.localDns} onChange={(e) => setForm({ ...form, localDns: e.target.checked })} />
              Resolve names locally (only if the proxy blocks DNS-over-HTTPS: DNS queries then leave outside the proxy)
            </label>
            {form.kind === "socks5" && (form.username || form.password) && (
              <p className="col-span-2 text-amber-300">Chromium can't sign in to a SOCKS5 proxy: the player and pictures will be blocked (not sent direct) with this proxy.</p>
            )}
            <div className="col-span-2 flex gap-2">
              <button type="submit" className={buttonClass} disabled={save.isPending}>Save encrypted</button>
              <button type="button" className={buttonClass} onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={() => setForm({ kind: "http", host: "", port: "", username: "", password: "", localDns: false })}>
              {s?.stored.configured ? "Replace stored proxy..." : "Enter a proxy..."}
            </button>
            {actions.offerVerify && (
              <button type="button" className={buttonClass} disabled={verify.isPending} onClick={() => verify.mutate()} data-testid="verify-proxy">
                {verify.isPending ? "Checking..." : "Verify"}
              </button>
            )}
            {s?.stored.configured && (
              <button type="button" className={buttonClass} disabled={clear.isPending} onClick={() => clear.mutate()}>
                Clear stored proxy
              </button>
            )}
          </div>
        )}

        {s?.verification && (
          <p className="text-xs text-muted" data-testid="proxy-verification">
            Last check - RiuPlay requests: {s.verification.main.ok ? "ok" : `failed (${s.verification.main.code})`}; player and pictures: {s.verification.chromium.ok ? "ok" : `failed (${s.verification.chromium.code})`}
          </p>
        )}

        {actions.offerPlaintextRemoval && !confirmRemoval && (
          <button type="button" className={buttonClass} onClick={() => setConfirmRemoval(true)} data-testid="remove-plaintext">
            Remove the old unencrypted copy...
          </button>
        )}
        {confirmRemoval && (
          <div className="space-y-2 rounded-lg border border-red-500/40 p-3 text-xs" role="dialog" aria-label="Confirm plaintext removal">
            <p className="text-text">Remove the plain proxy text from this computer? The encrypted proxy keeps working. Backups made earlier still contain the plain text.</p>
            <div className="flex gap-2">
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  setLegacyProxy("");
                  setConfirmRemoval(false);
                  setMessage("The plain copy was removed.");
                }}
              >
                Remove plain copy
              </button>
              <button type="button" className={buttonClass} onClick={() => setConfirmRemoval(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {message && <p className="text-xs text-text">{message}</p>}
      </div>
    </div>
  );
}
