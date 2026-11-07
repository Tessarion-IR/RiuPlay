import { z } from "zod";
import { getOrCreateDefaultProfile, getSettingsForProfile } from "@/server/queries";
import { suwayomiTestConnection } from "@/server/providers";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ baseUrl: z.string().min(1) });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "baseUrl is required." }, { status: 400 });
  const profile = await getOrCreateDefaultProfile();
  const settings = await getSettingsForProfile(profile.id);
  const result = await suwayomiTestConnection(parsed.data.baseUrl, settings.proxy);
  return Response.json(result);
}
