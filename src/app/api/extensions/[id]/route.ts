import { z } from "zod";
import { setExtensionEnabled } from "@/server/queries";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ enabled: z.boolean() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "enabled (boolean) is required." }, { status: 400 });
  const updated = await setExtensionEnabled(Number(id), parsed.data.enabled);
  if (!updated) return Response.json({ error: "Extension not found." }, { status: 404 });
  return Response.json({ extension: updated });
}
