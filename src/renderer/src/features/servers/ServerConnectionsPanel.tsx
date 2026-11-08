// RiuPlay M4/M5: Settings > Media servers - the user's own Suwayomi (manga) and Kikoeru (audio)
// servers. Add / edit / test / remove; the password is sent to the main process (encrypted there)
// and never shown again - editing leaves it unchanged unless a new one is typed. A server on this
// computer or the local network needs the explicit "it's mine, on my network" confirmation.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Server, TriangleAlert } from "lucide-react";
import type { ServerAuthMode, ServerConnection, ServerConnectionInput, ServerKind } from "@shared/types";
import { hibiki } from "@/lib/hibiki";
import { cn } from "@/lib/cn";

export const CONNECTIONS_KEY = ["connections"];
export const cleanIpcError = (error: unknown): string =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "") : String(error);

export function useConnections(kind?: ServerKind) {
  const api = hibiki.connections;
  const query = useQuery({ queryKey: CONNECTIONS_KEY, queryFn: () => api!.list(), enabled: Boolean(api) });
  return { ...query, data: (query.data ?? []).filter((c) => !kind || c.kind === kind), available: Boolean(api) };
}

const AUTH_MODES: Record<ServerKind, ServerAuthMode[]> = { suwayomi: ["none", "basic", "ui_login"], kikoeru: ["none", "token"] };
const input = "w-full rounded-lg border border-text/10 bg-text/[.03] px-3 py-2 text-sm text-text outline-none placeholder:text-muted/60 focus:border-accent";
const button = "rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-text/[.06] disabled:opacity-50";

interface FormState {
  kind: ServerKind;
  name: string;
  baseUrl: string;
  authMode: ServerAuthMode;
  username: string;
  password: string;
  clearPassword: boolean;
  localConfirmed: boolean;
}

function ConnectionForm({ initial, onDone, onCancel }: { initial?: ServerConnection; onDone: (message: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({
    kind: initial?.kind ?? "suwayomi",
    name: initial?.name ?? "",
    baseUrl: initial?.baseUrl ?? "",
    authMode: initial?.authMode ?? "none",
    username: initial?.username ?? "",
    password: "",
    clearPassword: false,
    localConfirmed: initial?.local ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const base: Partial<ServerConnectionInput> = { name: form.name, baseUrl: form.baseUrl, authMode: form.authMode, username: form.authMode === "none" ? null : form.username, localConfirmed: form.localConfirmed };
      if (form.password) base.password = form.password;
      else if (form.clearPassword || form.authMode === "none") base.password = null;
      return initial ? hibiki.connections!.update(initial.id, base) : hibiki.connections!.add({ ...base, kind: form.kind } as ServerConnectionInput);
    },
    onSuccess: ({ test }) => {
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
      onDone(test.ok ? t("servers.connected", { version: test.version ?? "" }) : t("servers.savedNotReachable", { error: test.error ?? "" }));
    },
    onError: (e) => setError(cleanIpcError(e)),
  });
  const needsLocal = Boolean(error && /local network/.test(error));
  return (
    <form
      className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
      data-testid="server-form"
    >
      <select className={input} value={form.kind} disabled={Boolean(initial)} onChange={(e) => setForm({ ...form, kind: e.target.value as ServerKind, authMode: "none" })} aria-label={t("servers.type")}>
        <option value="suwayomi">{t("servers.suwayomi")}</option>
        <option value="kikoeru">{t("servers.kikoeru")}</option>
      </select>
      <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("servers.namePlaceholder")} aria-label={t("servers.name")} />
      <input className={cn(input, "col-span-2")} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={form.kind === "suwayomi" ? "http://192.168.1.10:4567" : "http://192.168.1.10:8888"} aria-label={t("servers.address")} spellCheck={false} required />
      <select className={input} value={form.authMode} onChange={(e) => setForm({ ...form, authMode: e.target.value as ServerAuthMode })} aria-label={t("servers.signIn")}>
        {AUTH_MODES[form.kind].map((mode) => (
          <option key={mode} value={mode}>
            {t(`servers.auth.${mode}`)}
          </option>
        ))}
      </select>
      <span />
      {form.authMode !== "none" && (
        <>
          <input className={input} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={t("servers.username")} aria-label={t("servers.username")} autoComplete="off" />
          <input
            className={input}
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={initial?.hasSecret ? t("servers.passwordUnchanged") : t("servers.password")}
            aria-label={t("servers.password")}
            autoComplete="new-password"
          />
          {initial?.hasSecret && (
            <label className="col-span-2 flex items-center gap-2 text-muted">
              <input type="checkbox" checked={form.clearPassword} onChange={(e) => setForm({ ...form, clearPassword: e.target.checked })} />
              {t("servers.forgetPassword")}
            </label>
          )}
        </>
      )}
      <label className={cn("col-span-2 flex items-start gap-2", needsLocal ? "text-amber-300" : "text-muted")}>
        <input type="checkbox" className="mt-0.5" checked={form.localConfirmed} onChange={(e) => setForm({ ...form, localConfirmed: e.target.checked })} />
        {t("servers.localConfirm")}
      </label>
      {error && <p className="col-span-2 text-rose-400">{error}</p>}
      <div className="col-span-2 flex gap-2">
        <button type="submit" className={button} disabled={save.isPending}>
          {save.isPending ? t("servers.checking") : initial ? t("servers.save") : t("servers.addAndTest")}
        </button>
        <button type="button" className={button} onClick={onCancel}>
          {t("servers.cancel")}
        </button>
      </div>
    </form>
  );
}

export function ServerConnectionsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const connections = useConnections();
  const [editing, setEditing] = useState<ServerConnection | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const test = useMutation({
    mutationFn: (id: number) => hibiki.connections!.test(id),
    onSuccess: (result) => {
      setMessage(result.ok ? t("servers.connected", { version: result.version ?? "" }) : t("servers.notReachable", { error: result.error ?? "" }));
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
  const remove = useMutation({ mutationFn: (id: number) => hibiki.connections!.remove(id), onSuccess: (list) => queryClient.setQueryData(CONNECTIONS_KEY, list) });
  if (!connections.available) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-text/[.03] p-4 text-sm" data-testid="server-connections">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-text/[.06] text-muted">
        <Server className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="font-semibold text-text">{t("servers.title")}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{t("servers.hint")}</p>
        </div>
        {connections.data.map((c) =>
          editing !== "new" && editing?.id === c.id ? (
            <ConnectionForm key={c.id} initial={c} onCancel={() => setEditing(null)} onDone={(m) => { setEditing(null); setMessage(m); }} />
          ) : (
            <div key={c.id} className="rounded-xl border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-text">{c.name}</span>
                <span className="rounded-full bg-text/[.06] px-2 py-0.5 text-muted">{t(`servers.${c.kind}`)}</span>
                {c.local && <span className="rounded-full bg-text/[.06] px-2 py-0.5 text-muted">{t("servers.localBadge")}</span>}
                {c.lastError ? (
                  <span className="inline-flex items-center gap-1 text-rose-400"><TriangleAlert className="h-3.5 w-3.5" />{c.lastError}</span>
                ) : c.lastOkAt ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />{t("servers.reachable")}</span>
                ) : null}
              </div>
              <p className="mt-1 truncate text-muted">{c.baseUrl}{c.authMode !== "none" ? ` · ${t(`servers.auth.${c.authMode}`)}${c.username ? ` (${c.username})` : ""}` : ""}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className={button} disabled={test.isPending} onClick={() => test.mutate(c.id)}>{t("servers.test")}</button>
                <button type="button" className={button} onClick={() => setEditing(c)}>{t("servers.edit")}</button>
                <button type="button" className={cn(button, "text-rose-400")} disabled={remove.isPending} onClick={() => remove.mutate(c.id)} title={t("servers.removeHint")}>{t("servers.remove")}</button>
              </div>
            </div>
          ),
        )}
        {editing === "new" ? (
          <ConnectionForm onCancel={() => setEditing(null)} onDone={(m) => { setEditing(null); setMessage(m); }} />
        ) : (
          <button type="button" className={button} onClick={() => setEditing("new")}>{t("servers.add")}</button>
        )}
        {message && <p className="text-xs text-text">{message}</p>}
      </div>
    </div>
  );
}
