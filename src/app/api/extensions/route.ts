import { listExtensions } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repositoryId = searchParams.get("repositoryId");
  const items = await listExtensions(repositoryId ? Number(repositoryId) : undefined);
  return Response.json({ items });
}
