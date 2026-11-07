import { z } from "zod";
import {
  addRepository,
  getOrCreateDefaultProfile,
  getSettingsForProfile,
  listRepositories,
  replaceExtensionsForRepository,
  setRepositoryStatus,
} from "@/server/queries";
import { fetchRepositoryIndex, RepoParseError } from "@/server/providers";
import { isHttpUrl } from "@/server/net";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listRepositories();
  return Response.json({ items });
}

const BodySchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().min(1),
  repoType: z.enum(["anime", "manga"]),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "name, baseUrl and repoType are required." }, { status: 400 });
  if (!isHttpUrl(parsed.data.baseUrl)) {
    return Response.json({ error: "Repository URL must be a valid http(s) URL." }, { status: 400 });
  }

  const repo = await addRepository(parsed.data.name, parsed.data.baseUrl, parsed.data.repoType);

  const profile = await getOrCreateDefaultProfile();
  const settings = await getSettingsForProfile(profile.id);

  try {
    const parsedExtensions = await fetchRepositoryIndex(repo.baseUrl, settings.proxy);
    await replaceExtensionsForRepository(repo.id, repo.repoType as "anime" | "manga", parsedExtensions);
    const updated = await setRepositoryStatus(repo.id, "ok", null, parsedExtensions.length);
    return Response.json({ repository: updated, extensionCount: parsedExtensions.length });
  } catch (err) {
    const message = err instanceof RepoParseError ? err.message : "Failed to refresh repository.";
    const updated = await setRepositoryStatus(repo.id, "error", message, 0);
    return Response.json({ repository: updated, error: message }, { status: 207 });
  }
}
