import { getOrCreateDefaultProfile, resetSettingsForProfile } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function POST() {
  const profile = await getOrCreateDefaultProfile();
  const s = await resetSettingsForProfile(profile.id);
  const { proxy, ...rest } = s;
  return Response.json({ settings: { ...rest, proxy: { ...proxy, passwordEnc: undefined } } });
}
