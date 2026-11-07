import { z } from "zod";
import { safeFetch, testSocks5 } from "@/server/net";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  mode: z.enum(["none", "http", "https", "socks5"]),
  host: z.string().max(255),
  port: z.number().int().min(1).max(65535).nullable(),
  username: z.string().max(255).optional().default(""),
  password: z.string().max(500).optional().default(""),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "Invalid proxy configuration." }, { status: 400 });
  const { mode, host, port, username, password } = parsed.data;

  if (mode === "none") {
    return Response.json({ ok: true, message: "No proxy is configured; direct connections will be used." });
  }
  if (!host || !port) {
    return Response.json({ ok: false, error: "Host and port are required for proxy mode." }, { status: 400 });
  }

  if (mode === "socks5") {
    const result = await testSocks5(host, port, username, password);
    if (result.ok) {
      return Response.json({
        ok: true,
        message:
          "SOCKS5 handshake succeeded. Note: SOCKS5 routing is currently only verified for this connectivity test; application HTTP(S) requests do not yet route through SOCKS5 in this build (see Settings for scope).",
      });
    }
    return Response.json({ ok: false, error: result.error }, { status: 502 });
  }

  // http / https proxy: perform a real request through the proxy dispatcher.
  try {
    const res = await safeFetch("https://example.com/", {
      timeoutMs: 8000,
      proxy: {
        mode,
        host,
        port,
        username,
        hasPassword: Boolean(password),
        passwordEnc: null,
      },
      proxyRawPassword: password || undefined,
    });
    if (res.ok || res.status < 500) {
      return Response.json({ ok: true, message: `Proxy responded (HTTP ${res.status}). Connection is usable.` });
    }
    return Response.json({ ok: false, error: `Proxy returned HTTP ${res.status}.` }, { status: 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy test failed.";
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
