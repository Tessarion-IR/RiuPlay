import { db } from "@/db";
import { repositories } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getOrCreateDefaultProfile,
  getSettingsForProfile,
  replaceExtensionsForRepository,
  setRepositoryStatus,
} from "@/server/queries";
import { fetchRepositoryIndex, RepoParseError } from "@/server/providers";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repoId = Number(id);
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, repoId)).limit(1);
  if (!repo) return Response.json({ error: "Repository not found." }, { status: 404 });

  const profile = await getOrCreateDefaultProfile();
  const settings = await getSettingsForProfile(profile.id);

  try {
    const parsedExtensions = await fetchRepositoryIndex(repo.baseUrl, settings.proxy);
    await replaceExtensionsForRepository(repo.id, repo.repoType as "anime" | "manga", parsedExtensions);
    const updated = await setRepositoryStatus(repo.id, "ok", null, parsedExtensions.length);
    return Response.json({ repository: updated, extensionCount: parsedExtensions.length });
  } catch (err) {
    const message = err instanceof RepoParseError ? err.message : "Failed to refresh repository.";
    const updated = await setRepositoryStatus(repo.id, "error", message, repo.extensionCount);
    return Response.json({ repository: updated, error: message }, { status: 502 });
  }
}
