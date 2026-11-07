import { z } from "zod";
import { updateLibraryProgress } from "@/server/queries";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  mediaItemId: z.number().int(),
  unitId: z.number().int().nullable().optional(),
  unitType: z.enum(["episode", "chapter", "track"]).nullable().optional(),
  position: z.number().min(0).optional(),
  duration: z.number().min(0).optional(),
  page: z.number().int().min(0).optional(),
  percentage: z.number().min(0).max(1).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid progress payload." }, { status: 400 });
  const { mediaItemId, ...rest } = parsed.data;
  const updated = await updateLibraryProgress(mediaItemId, {
    unitId: rest.unitId ?? null,
    unitType: rest.unitType ?? null,
    position: rest.position ?? 0,
    duration: rest.duration ?? 0,
    page: rest.page ?? 0,
    percentage: rest.percentage ?? 0,
  });
  if (!updated) return Response.json({ error: "No library entry for this media item. Add it to the library first." }, { status: 404 });
  return Response.json({ entry: updated });
}
