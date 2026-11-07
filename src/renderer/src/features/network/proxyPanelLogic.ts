// RiuPlay M3: what the encrypted-proxy panel may offer, as one pure decision (tested).
import type { SecureProxyStatus } from "@shared/types";

export interface ProxyPanelActions {
  /** "Move it to encrypted storage...": a plain proxy that can be moved, and no stored record yet. */
  offerMigration: boolean;
  /** "Verify": something usable is in force. */
  offerVerify: boolean;
  /** "Remove the old unencrypted copy...": only when the ENCRYPTED proxy is in force and passed on both paths. */
  offerPlaintextRemoval: boolean;
  /** Requests are refused right now (invalid / undecryptable proxy). */
  failingClosed: boolean;
}

export function proxyPanelActions(status: SecureProxyStatus | undefined, legacyProxy: string): ProxyPanelActions {
  if (!status) return { offerMigration: false, offerVerify: false, offerPlaintextRemoval: false, failingClosed: false };
  return {
    offerMigration: !status.stored.configured && status.legacy.action === "migrate" && legacyProxy.trim() !== "",
    offerVerify: status.effectiveState === "ok",
    offerPlaintextRemoval: status.plaintextRemovalAllowed && status.effectiveSource === "secure" && legacyProxy.trim() !== "",
    failingClosed: status.effectiveState === "invalid" || status.effectiveState === "unavailable",
  };
}
