import { z } from "zod";
import {
  getOrCreateDefaultProfile,
  getSettingsForProfile,
  updateSettingsForProfile,
} from "@/server/queries";
import { encryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getOrCreateDefaultProfile();
  const s = await getSettingsForProfile(profile.id);
  // Never return the encrypted password payload to the client.
  const { proxy, ...rest } = s;
  return Response.json({
    settings: { ...rest, proxy: { ...proxy, passwordEnc: undefined } },
  });
}

const ProxySchema = z.object({
  mode: z.enum(["none", "http", "https", "socks5"]),
  host: z.string().max(255),
  port: z.number().int().min(0).max(65535).nullable(),
  username: z.string().max(255),
  password: z.string().max(500).optional(),
  clearPassword: z.boolean().optional(),
});

const PatchSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  language: z.string().min(2).max(10).optional(),
  startupView: z.string().min(1).max(40).optional(),
  homeSections: z.array(z.string()).optional(),
  playerDefaults: z
    .object({
      autoplayNext: z.boolean(),
      defaultVolume: z.number().min(0).max(1),
      resumeThreshold: z.number().min(0).max(600),
      completionThreshold: z.number().min(0.5).max(1),
      preferredSubtitleLang: z.string().max(20),
    })
    .optional(),
  readerDefaults: z
    .object({
      mode: z.enum(["single", "continuous"]),
      direction: z.enum(["ltr", "rtl"]),
      fit: z.enum(["width", "height"]),
      zoom: z.number().min(0.5).max(3),
    })
    .optional(),
  proxy: ProxySchema.optional(),
  suwayomiBaseUrl: z.string().max(500).optional(),
});

export async function PATCH(req: Request) {
  const profile = await getOrCreateDefaultProfile();
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid settings payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  const patch: Record<string, unknown> = { ...parsed.data };

  if (parsed.data.proxy) {
    const current = await getSettingsForProfile(profile.id);
    const { password, clearPassword, ...proxyRest } = parsed.data.proxy;
    let passwordEnc: string | null = current.proxy.passwordEnc;
    let hasPassword = current.proxy.hasPassword;
    if (clearPassword) {
      passwordEnc = null;
      hasPassword = false;
    } else if (password) {
      passwordEnc = encryptSecret(password);
      hasPassword = true;
    }
    patch.proxy = { ...proxyRest, hasPassword, passwordEnc };
  }

  const updated = await updateSettingsForProfile(profile.id, patch);
  const { proxy, ...rest } = updated;
  return Response.json({ settings: { ...rest, proxy: { ...proxy, passwordEnc: undefined } } });
}
