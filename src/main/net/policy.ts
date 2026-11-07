// RiuPlay M3: who is making a request and what it may reach.
//
// Every request through the controlled path names its caller. The caller decides the policy
// (hosts, plain HTTP, limits) and whether a local-server exception can apply at all:
//   extension:<id>   scripted/APK source traffic - public internet only, never an exception
//   download         episode/segment downloads of links sources returned - public only
//   app:<purpose>    RiuPlay's own requests (repository indexes, updates, AniList, ...) - public only
//   connection:<id>  a user-configured server (Suwayomi/Kikoeru, M4/M5) - the ONLY caller that may
//                    carry a local-server exception, and only the one approved for that connection
import { NetError } from "./errors";

export type Caller =
  | { kind: "extension"; sourceId: string }
  | { kind: "download" }
  | { kind: "app"; purpose: string }
  | { kind: "connection"; connectionId: string };

/** Parses the caller tag carried by platform HttpRequests ("extension:anilibria", "download", ...).
 * Anything unrecognised is treated as an app request - never as something more privileged. */
export function parseCaller(tag: string | undefined): Caller {
  if (!tag) return { kind: "app", purpose: "unspecified" };
  const [kind, ...rest] = tag.split(":");
  const id = rest.join(":").slice(0, 200);
  if (kind === "extension" && id) return { kind: "extension", sourceId: id };
  if (kind === "download") return { kind: "download" };
  // "connection:" callers are created by the main process only (M4/M5); a tag arriving from shared
  // code is downgraded, so it can never claim a local-server exception.
  return { kind: "app", purpose: (kind === "app" ? id : tag).slice(0, 80) || "unspecified" };
}

export const callerKey = (caller: Caller): string =>
  caller.kind === "extension" ? `extension:${caller.sourceId}` : caller.kind === "connection" ? `connection:${caller.connectionId}` : caller.kind === "app" ? `app:${caller.purpose}` : "download";

/**
 * A narrowly scoped, user-approved exception for the user's OWN server on the local network
 * (designed in M3, used by Suwayomi/Kikoeru connections in M4/M5). It names one exact scheme, host
 * and port, records when the user approved it, and belongs to one connection. It never applies to
 * extensions, downloads or app requests, and never to any other host or port.
 */
export interface LocalServerAllowance {
  connectionId: string;
  scheme: "http" | "https";
  host: string;
  port: number;
  approvedAt: number;
}

export interface NetPolicy {
  /** Host patterns ("example.com", "*.cdn.example.com") or any public host. */
  hosts: string[] | "any-public";
  allowHttp: boolean;
  maxRedirects: number;
  timeoutMs: number;
  /** Raw body cap; null = streamed without a cap (downloads count against their own budget). */
  maxBodyBytes: number | null;
  maxDecodedBytes: number | null;
  /** Exceptions that may apply; filtered by caller in allowanceFor(). */
  allowances: LocalServerAllowance[];
}

export const LIMITS = {
  extension: { maxBodyBytes: 8 * 1024 * 1024, maxDecodedBytes: 32 * 1024 * 1024 },
  app: { maxBodyBytes: 32 * 1024 * 1024, maxDecodedBytes: 64 * 1024 * 1024 },
  connection: { maxBodyBytes: 64 * 1024 * 1024, maxDecodedBytes: 128 * 1024 * 1024 },
  download: { maxBodyBytes: null, maxDecodedBytes: null },
} as const;

export function policyFor(caller: Caller, options: { timeoutMs: number; allowances?: LocalServerAllowance[] }): NetPolicy {
  const limits = LIMITS[caller.kind];
  return {
    // Extensions declare no hosts yet (manifest permissions arrive with M1): until then they get
    // "any public host" - the legacy grant - and the address rules still apply to every request.
    hosts: "any-public",
    allowHttp: true,
    maxRedirects: 5,
    timeoutMs: options.timeoutMs,
    maxBodyBytes: limits.maxBodyBytes,
    maxDecodedBytes: limits.maxDecodedBytes,
    allowances: caller.kind === "connection" ? (options.allowances ?? []).filter((a) => a.connectionId === caller.connectionId) : [],
  };
}

export function hostMatches(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith("*.")) return host.endsWith(p.slice(1)) && host.length > p.length - 1;
    return host === p;
  });
}

/** The exact allowance for this scheme/host/port, if the policy carries one. */
export function allowanceFor(policy: NetPolicy, scheme: string, host: string, port: number): LocalServerAllowance | null {
  return policy.allowances.find((a) => `${a.scheme}:` === scheme && a.host.toLowerCase() === host && a.port === port) ?? null;
}

export function assertPermittedHost(policy: NetPolicy, host: string): void {
  if (policy.hosts !== "any-public" && !hostMatches(host, policy.hosts)) throw new NetError("host-not-permitted", `${host} is not permitted for this caller`);
}
