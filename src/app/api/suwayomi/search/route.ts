import { getOrCreateDefaultProfile, getSettingsForProfile } from "@/server/queries";
import { suwayomiSearch } from "@/server/providers";
import { NetError } from "@/server/net";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sourceId = searchParams.get("sourceId");
  const query = searchParams.get("query") ?? "";
  if (!sourceId) return Response.json({ error: "sourceId is required." }, { status: 400 });

  const profile = await getOrCreateDefaultProfile();
  const settings = await getSettingsForProfile(profile.id);
  if (!settings.suwayomiBaseUrl) {
    return Response.json({ error: "No Suwayomi server is configured in Settings." }, { status: 400 });
  }
  try {
    const results = await suwayomiSearch(settings.suwayomiBaseUrl, sourceId, query, settings.proxy);
    return Response.json({ results });
  } catch (err) {
    const message = err instanceof NetError ? err.message : "Search against the Suwayomi server failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
