import { z } from "zod";
import {
  addSearchHistory,
  clearSearchHistory,
  getOrCreateDefaultProfile,
  listSearchHistory,
} from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getOrCreateDefaultProfile();
  const items = await listSearchHistory(profile.id);
  return Response.json({ items });
}

const BodySchema = z.object({ query: z.string().min(1).max(200), contentType: z.string().max(20).optional() });

export async function POST(req: Request) {
  const profile = await getOrCreateDefaultProfile();
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "query is required." }, { status: 400 });
  await addSearchHistory(profile.id, parsed.data.query, parsed.data.contentType ?? "all");
  return Response.json({ ok: true });
}

export async function DELETE() {
  const profile = await getOrCreateDefaultProfile();
  await clearSearchHistory(profile.id);
  return Response.json({ ok: true });
}
