import { removeRepository } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await removeRepository(Number(id));
  return Response.json({ ok: true });
}
