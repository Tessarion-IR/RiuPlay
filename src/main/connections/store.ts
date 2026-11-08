// RiuPlay M4/M5: the user's media-server connections (server_connections, migration 0026).
// Secrets (a password, or a token the server handed out) are stored only as safeStorage ciphertext
// through the injectable cipher, and decrypted in memory when a request needs them; they are never
// returned to the renderer (it sees `hasSecret`). A server whose address is on the user's computer or
// local network works only once the user confirmed that, which creates the exact scheme/host/port
// exception in the network broker for that connection (main/net/state.ts setLocalServerAllowances).
import net from "node:net";
import dns from "node:dns/promises";
import { eq } from "drizzle-orm";
import { serverConnections } from "../../core/db/schema";
import { getPlatform } from "../../core/platform";
import type { ServerConnection, ServerConnectionInput, ServerKind } from "@shared/types";
import { blockedReason } from "../net/addresses";
import type { LocalServerAllowance } from "../net/policy";
import type { ProxyCipher } from "../net/secureProxyStore";

type Row = typeof serverConnections.$inferSelect;
const db = () => getPlatform().db.get();

/** Normalises a server address: http(s) only, no credentials, query or fragment, no trailing slash. */
export function normaliseBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `http://${input.trim()}`);
  } catch {
    throw new Error("not a valid server address");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("the server address must start with http:// or https://");
  if (url.username || url.password) throw new Error("put the user name and password in their own fields, not in the address");
  if (url.search || url.hash) throw new Error("the server address can't contain ? or #");
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

/** Whether the address is on this computer or the local network (needs the user's confirmation). */
/**
 * Whether the address is on this computer or the local network (needs the user's confirmation).
 * Names are resolved by the network broker's own resolver first (so behind a proxy the lookup goes
 * through the proxy, like every other request); only a name the public resolvers don't know - a
 * LAN name such as "nas" - is asked of the system resolver, because only it can know such names.
 */
export async function isLocalAddress(
  baseUrl: string,
  options: { preflight?: (url: string) => Promise<{ ok: true } | { ok: false; code: string }>; lookup?: (host: string) => Promise<string[]> } = {},
): Promise<boolean> {
  const url = new URL(baseUrl);
  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return true;
  if (net.isIP(host)) return blockedReason(host) !== null;
  if (options.preflight) {
    const verdict = await options.preflight(baseUrl);
    if (verdict.ok) return false;
    if (verdict.code === "blocked-address") return true;
    if (verdict.code !== "dns-failed") return false; // e.g. proxy unusable: not local, it will fail on its own
  }
  const lookup = options.lookup ?? (async (h: string) => (await dns.lookup(h, { all: true })).map((a) => a.address));
  const addresses = await lookup(host).catch(() => [] as string[]);
  return addresses.length > 0 && addresses.some((a) => blockedReason(a) !== null);
}

function toConnection(row: Row): ServerConnection {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    baseUrl: row.baseUrl,
    authMode: row.authMode,
    username: row.username,
    hasSecret: row.secretCiphertext !== null,
    local: row.localApprovedAt !== null,
    lastOkAt: row.lastOkAt,
    lastError: row.lastError,
  };
}

export class ConnectionStore {
  constructor(private readonly cipher: ProxyCipher, private readonly onAllowancesChanged: (allowances: LocalServerAllowance[]) => void = () => {}) {}

  async list(): Promise<ServerConnection[]> {
    return (await db().select().from(serverConnections).all()).map(toConnection);
  }

  async row(id: number): Promise<Row> {
    const row = await db().select().from(serverConnections).where(eq(serverConnections.id, id)).get();
    if (!row) throw new Error("no such server connection");
    return row;
  }

  async secret(id: number): Promise<string | null> {
    const row = await this.row(id);
    if (!row.secretCiphertext) return null;
    if (!(await this.cipher.isAvailable())) throw new Error("OS encryption is unavailable; the server's password can't be read");
    try {
      return (await this.cipher.decrypt(Buffer.from(row.secretCiphertext, "base64"))).text;
    } catch {
      throw new Error("the stored server password can't be decrypted (another Windows account or profile?); enter it again");
    }
  }

  private async encrypt(secret: string | null | undefined): Promise<string | null> {
    if (!secret) return null;
    if (!(await this.cipher.isAvailable())) throw new Error("OS encryption is unavailable; the password was not stored");
    const ciphertext = (await this.cipher.encrypt(secret)).toString("base64");
    if ((await this.cipher.decrypt(Buffer.from(ciphertext, "base64"))).text !== secret) throw new Error("encryption round-trip failed; nothing was stored");
    return ciphertext;
  }

  /** Adds a connection. A local address needs `localConfirmed: true` (the user's explicit consent). */
  async add(input: ServerConnectionInput, isLocal: (baseUrl: string) => Promise<boolean> = (u) => isLocalAddress(u)): Promise<ServerConnection> {
    const kind: ServerKind = input.kind === "kikoeru" ? "kikoeru" : input.kind === "suwayomi" ? "suwayomi" : (() => { throw new Error("unknown server type"); })();
    const baseUrl = normaliseBaseUrl(input.baseUrl);
    const authMode = input.authMode ?? "none";
    if (!["none", "basic", "ui_login", "token"].includes(authMode)) throw new Error("unknown sign-in mode");
    if (authMode !== "none" && !input.username) throw new Error("this sign-in mode needs a user name");
    const local = await isLocal(baseUrl);
    if (local && input.localConfirmed !== true) throw new Error("this server is on your computer or local network; confirm that to allow RiuPlay to reach it");
    const now = Date.now();
    const rows = await db()
      .insert(serverConnections)
      .values({
        kind,
        name: (input.name ?? "").trim().slice(0, 80) || new URL(baseUrl).host,
        baseUrl,
        authMode,
        username: input.username ?? null,
        secretCiphertext: await this.encrypt(input.password),
        localApprovedAt: local ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning()
      .all();
    if (rows.length === 0) throw new Error("this server is already added");
    await this.publishAllowances();
    return toConnection(rows[0]);
  }

  /**
   * Edits a connection. `password`: undefined keeps the stored one, null or "" removes it, a string
   * replaces it. A changed address is classified again and, if local, needs `localConfirmed`.
   */
  async update(id: number, patch: Partial<ServerConnectionInput>, isLocal: (baseUrl: string) => Promise<boolean> = (u) => isLocalAddress(u)): Promise<ServerConnection> {
    const row = await this.row(id);
    const baseUrl = patch.baseUrl !== undefined ? normaliseBaseUrl(patch.baseUrl) : row.baseUrl;
    const authMode = patch.authMode ?? row.authMode;
    if (!["none", "basic", "ui_login", "token"].includes(authMode)) throw new Error("unknown sign-in mode");
    const username = patch.username !== undefined ? patch.username || null : row.username;
    if (authMode !== "none" && !username) throw new Error("this sign-in mode needs a user name");
    let localApprovedAt = row.localApprovedAt;
    if (baseUrl !== row.baseUrl) {
      const local = await isLocal(baseUrl);
      if (local && patch.localConfirmed !== true) throw new Error("this server is on your computer or local network; confirm that to allow RiuPlay to reach it");
      localApprovedAt = local ? Date.now() : null;
    }
    const secretCiphertext = patch.password === undefined ? row.secretCiphertext : await this.encrypt(patch.password);
    try {
      const rows = await db()
        .update(serverConnections)
        .set({ name: patch.name !== undefined ? patch.name.trim().slice(0, 80) || new URL(baseUrl).host : row.name, baseUrl, authMode, username, secretCiphertext: authMode === "none" ? null : secretCiphertext, localApprovedAt, lastError: null, updatedAt: Date.now() })
        .where(eq(serverConnections.id, id))
        .returning()
        .all();
      await this.publishAllowances();
      return toConnection(rows[0]);
    } catch (error) {
      if (/UNIQUE/i.test(String(error))) throw new Error("another connection already uses this address");
      throw error;
    }
  }

  /** Replaces the stored secret (a refreshed token, a corrected password). */
  async setSecret(id: number, secret: string | null): Promise<void> {
    await db().update(serverConnections).set({ secretCiphertext: await this.encrypt(secret), updatedAt: Date.now() }).where(eq(serverConnections.id, id)).run();
  }

  async recordResult(id: number, ok: boolean, error?: string): Promise<void> {
    await db()
      .update(serverConnections)
      .set(ok ? { lastOkAt: Date.now(), lastError: null } : { lastError: (error ?? "unreachable").slice(0, 300) })
      .where(eq(serverConnections.id, id))
      .run();
  }

  /** Removes the connection and its secret. Titles added from it stay in the library (marked unreachable). */
  async remove(id: number): Promise<void> {
    await db().delete(serverConnections).where(eq(serverConnections.id, id)).run();
    await this.publishAllowances();
  }

  /** The broker's exact exceptions: one per approved local connection, for that connection only. */
  async allowances(): Promise<LocalServerAllowance[]> {
    return (await db().select().from(serverConnections).all())
      .filter((r) => r.localApprovedAt !== null)
      .map((r) => {
        const url = new URL(r.baseUrl);
        let host = url.hostname.toLowerCase();
        if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
        return { connectionId: String(r.id), scheme: url.protocol === "https:" ? "https" : "http", host, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)), approvedAt: r.localApprovedAt! } as LocalServerAllowance;
      });
  }

  async publishAllowances(): Promise<void> {
    this.onAllowancesChanged(await this.allowances());
  }
}
