import { z } from "zod";
import { addHistoryEntry, clearHistory, listHistory } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as "video" | "manga" | "audio" | null;
  const rows = await listHistory(type ?? undefined);
  return Response.json({ items: rows });
}

const BodySchema = z.object({
  mediaItemId: z.number().int(),
  type: z.enum(["video", "manga", "audio"]),
  unitId: z.number().int().nullable().optional(),
  unitLabel: z.string().max(200).optional(),
  position: z.number().min(0).optional(),
  duration: z.number().min(0).optional(),
  page: z.number().int().min(0).nullable().optional(),
  completed: z.boolean().optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid history payload." }, { status: 400 });
  const created = await addHistoryEntry(parsed.data);
  return Response.json({ entry: created });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as "video" | "manga" | "audio" | null;
  await clearHistory(type ?? undefined);
  return Response.json({ ok: true });
}
