import { z } from "zod";
import { removeFromLibrary, updateLibraryEntry } from "@/server/queries";
import type { LibraryStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  status: z.string().min(1).max(30).optional(),
  favorite: z.boolean().optional(),
  rating: z.number().int().min(0).max(10).nullable().optional(),
  notes: z.string().max(4000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid payload." }, { status: 400 });
  const updated = await updateLibraryEntry(Number(id), parsed.data as Partial<{
    status: LibraryStatus;
    favorite: boolean;
    rating: number | null;
    notes: string;
  }>);
  if (!updated) return Response.json({ error: "Library entry not found." }, { status: 404 });
  return Response.json({ entry: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await removeFromLibrary(Number(id));
  return Response.json({ ok: true });
}
