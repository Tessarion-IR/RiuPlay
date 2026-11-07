// RiuPlay M1: the trust and permission UI of the Sources screen.
//  - RepositoryTrustBar: whether a repository is trusted (a choice of the user, never automatic)
//    and enabled, and why it last failed.
//  - PermissionConsentDialog: what an extension may do, shown before it is installed (or when an
//    update asks for different permissions). The install is sent with exactly the permission ids
//    shown; the main process refuses any other set.
//  - InstalledExtensionsPanel: enable / disable installed extensions (a disabled one stays
//    installed, is not offered anywhere and does not run).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { MarketplaceExtension, RepositoryInfo } from "@shared/types";
import { hibiki } from "@/lib/hibiki";
import { cn } from "@/lib/cn";

export const REPOSITORY_DETAILS_KEY = ["repositoryDetails"];

export function useRepositoryDetails() {
  const details = hibiki.sources.repositories.details;
  return useQuery({ queryKey: REPOSITORY_DETAILS_KEY, queryFn: () => details!(), enabled: Boolean(details), staleTime: 0 });
}

const smallButton = "rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-text transition-colors hover:bg-text/[.06] disabled:opacity-50";

export function RepositoryTrustBar({ url }: { url: string }) {
  const queryClient = useQueryClient();
  const details = useRepositoryDetails();
  const info = details.data?.find((r) => r.url === url);
  const update = (data: RepositoryInfo[]) => {
    queryClient.setQueryData(REPOSITORY_DETAILS_KEY, data);
    void queryClient.invalidateQueries({ queryKey: ["marketplace"] });
  };
  const setTrust = useMutation({ mutationFn: (trust: "trusted" | "untrusted") => hibiki.sources.repositories.setTrust!(url, trust), onSuccess: update });
  const setEnabled = useMutation({ mutationFn: (enabled: boolean) => hibiki.sources.repositories.setEnabled!(url, enabled), onSuccess: update });
  if (!info) return null;
  const trusted = info.trust === "trusted";
  return (
    <div className="flex flex-1 flex-wrap items-center gap-2 text-xs" data-testid="repository-trust">
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", trusted ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300")}>
        {trusted ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldQuestion className="h-3.5 w-3.5" />}
        {trusted ? "Trusted by you" : "Not reviewed - added by you"}
      </span>
      {!info.enabled && <span className="rounded-full bg-text/[.06] px-2 py-0.5 text-muted">Disabled</span>}
      <button type="button" className={smallButton} disabled={setTrust.isPending} onClick={() => setTrust.mutate(trusted ? "untrusted" : "trusted")} title={trusted ? "Stop trusting this repository" : "Say you trust whoever maintains this repository. It does not give its extensions any extra rights."}>
        {trusted ? "Untrust" : "Trust..."}
      </button>
      <button type="button" className={smallButton} disabled={setEnabled.isPending} onClick={() => setEnabled.mutate(!info.enabled)}>
        {info.enabled ? "Disable" : "Enable"}
      </button>
    </div>
  );
}

export function PermissionConsentDialog({
  extension,
  repository,
  isUpdate,
  onAccept,
  onCancel,
}: {
  extension: MarketplaceExtension;
  repository: RepositoryInfo | undefined;
  isUpdate: boolean;
  onAccept: (acceptedPermissions: string[]) => void;
  onCancel: () => void;
}) {
  const permissions = extension.permissionList ?? [];
  const incompatible = extension.compatibility && !extension.compatibility.compatible;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Extension permissions" data-testid="permission-consent">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-surface p-5 text-sm shadow-xl">
        <div>
          <p className="text-base font-bold text-text">
            {isUpdate ? "Update" : "Install"} {extension.name} {extension.version}?
          </p>
          <p className="mt-1 text-xs text-muted">
            From {repository?.name ?? repository?.url ?? "a repository"} -{" "}
            {repository?.trust === "trusted" ? "a repository you said you trust." : "a repository nobody has reviewed. Install only what you trust."}
            {isUpdate ? " This version asks for different permissions." : ""}
          </p>
        </div>
        <ul className="space-y-2">
          {permissions.map((p) => (
            <li key={p.id} className={cn("flex gap-2 text-xs", p.level === "danger" ? "text-red-300" : p.level === "warning" ? "text-amber-200" : "text-text")}>
              {p.level === "info" ? <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">Extensions never get access to your files, other programs or your local network. Discovering an extension does not run it.</p>
        {incompatible && <p className="text-xs text-red-300">Can't be installed: {extension.compatibility!.reason}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={smallButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={cn(smallButton, "border-accent/60")} disabled={Boolean(incompatible) || permissions.length === 0} onClick={() => onAccept(permissions.map((p) => p.id))} data-testid="accept-permissions">
            {isUpdate ? "Accept and update" : "Accept and install"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InstalledExtensionsPanel({ installedIds, names }: { installedIds: string[]; names: Map<string, string> }) {
  const queryClient = useQueryClient();
  const getStates = hibiki.sources.extensionStates;
  const states = useQuery({ queryKey: ["extensionStates"], queryFn: () => getStates!(), enabled: Boolean(getStates) });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => hibiki.sources.setExtensionEnabled!(id, enabled),
    onSuccess: (sources) => {
      queryClient.setQueryData(["sources"], sources);
      void queryClient.invalidateQueries({ queryKey: ["extensionStates"] });
    },
  });
  if (!getStates || installedIds.length === 0) return null;
  const disabled = new Set((states.data ?? []).filter((s) => !s.enabled).map((s) => s.id));
  if (disabled.size === 0) return null;
  return (
    <div className="mb-4 max-w-2xl rounded-2xl border border-border bg-text/[.03] p-4 text-sm" data-testid="disabled-extensions">
      <p className="font-semibold text-text">Disabled extensions</p>
      <p className="mt-0.5 text-xs text-muted">Still installed, but not offered anywhere and not run.</p>
      <ul className="mt-3 space-y-2">
        {installedIds
          .filter((id) => disabled.has(id))
          .map((id) => (
            <li key={id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-text">{names.get(id) ?? id}</span>
              <button type="button" className={smallButton} disabled={toggle.isPending} onClick={() => toggle.mutate({ id, enabled: true })}>
                Enable
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function DisableExtensionButton({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const setEnabled = hibiki.sources.setExtensionEnabled;
  const toggle = useMutation({
    mutationFn: () => setEnabled!(id, false),
    onSuccess: (sources) => {
      queryClient.setQueryData(["sources"], sources);
      void queryClient.invalidateQueries({ queryKey: ["extensionStates"] });
    },
  });
  if (!setEnabled) return null;
  return (
    <button type="button" className={smallButton} disabled={toggle.isPending} onClick={(e) => { e.stopPropagation(); toggle.mutate(); }}>
      Disable
    </button>
  );
}
