import { getOrCreateDefaultProfile, updateProfile } from "@/server/queries";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getOrCreateDefaultProfile();
  return Response.json({ profile });
}

const PatchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  avatarEmoji: z.string().min(1).max(8).optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function PATCH(req: Request) {
  const profile = await getOrCreateDefaultProfile();
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid profile data." }, { status: 400 });
  }
  const updated = await updateProfile(profile.id, parsed.data);
  return Response.json({ profile: updated });
}
