import { getOrCreateDefaultProfile, getSettingsForProfile } from "@/server/queries";
import { suwayomiListSources } from "@/server/providers";
import { NetError } from "@/server/net";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getOrCreateDefaultProfile();
  const settings = await getSettingsForProfile(profile.id);
  if (!settings.suwayomiBaseUrl) {
    return Response.json({ error: "No Suwayomi server is configured in Settings." }, { status: 400 });
  }
  try {
    const sources = await suwayomiListSources(settings.suwayomiBaseUrl, settings.proxy);
    return Response.json({ sources });
  } catch (err) {
    const message = err instanceof NetError ? err.message : "Failed to reach the Suwayomi server.";
    return Response.json({ error: message }, { status: 502 });
  }
}
