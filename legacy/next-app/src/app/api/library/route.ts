import { z } from "zod";
import { addToLibrary, listLibrary } from "@/server/queries";
import type { ContentType, LibraryStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const contentType = (searchParams.get("contentType") as ContentType | null) ?? undefined;
  const status = (searchParams.get("status") as LibraryStatus | null) ?? undefined;
  const favorite = searchParams.get("favorite") === "1";
  const search = searchParams.get("search") ?? undefined;
  const sort = (searchParams.get("sort") as "title" | "added" | "activity" | "status" | null) ?? undefined;

  const rows = await listLibrary({
    contentType: contentType || undefined,
    status: status || undefined,
    favorite: favorite || undefined,
    search: search || undefined,
    sort: sort || undefined,
  });
  return Response.json({ items: rows });
}

const BodySchema = z.object({
  mediaItemId: z.number().int(),
  status: z.string().min(1).max(30),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "mediaItemId and status are required." }, { status: 400 });
  const entry = await addToLibrary(parsed.data.mediaItemId, parsed.data.status as LibraryStatus);
  return Response.json({ entry });
}
