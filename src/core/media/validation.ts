// RiuPlay: validation of everything the renderer may send about media, before it reaches the
// database - the strict, length-capped zod checks the original RiuPlay applied to untrusted input
// (legacy/next-app/src/server/providers.ts). Remote locations must be http(s); local files never
// come through here (main/mediaFiles.ts builds those from the native file picker's paths).
import { z } from "zod";
import { LIBRARY_STATUSES, MEDIA_TYPES, type MediaType } from "@shared/media";

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const httpUrl = z.string().trim().max(4096).refine(isHttpUrl, { message: "must be an http(s) URL" });
const optionalCover = z.union([z.literal(""), httpUrl]).optional();
const shortText = (max: number) => z.string().trim().max(max);
const MAX_UNITS = 5000;
const MAX_PAGES = 2000;

const timedUnit = z
  .object({
    number: z.number().finite().min(0).max(1_000_000).optional(),
    title: shortText(300).optional(),
    url: httpUrl,
    subtitleUrl: z.union([httpUrl, z.null()]).optional(),
    pages: z.array(z.string()).max(0, { message: "only chapters have pages" }).optional(),
    durationMs: z.union([z.number().int().min(0), z.null()]).optional(),
  })
  .strict();

const chapterUnit = z
  .object({
    number: z.number().finite().min(0).max(1_000_000).optional(),
    title: shortText(300).optional(),
    url: z.literal("").optional(),
    subtitleUrl: z.null().optional(),
    pages: z.array(httpUrl).min(1, { message: "a chapter needs at least one page" }).max(MAX_PAGES),
    durationMs: z.null().optional(),
  })
  .strict();

/** What one episode (video), chapter (manga) or track (audio) must look like. */
export const unitInputSchema = (type: MediaType) => (type === "manga" ? chapterUnit : timedUnit);

const metadata = {
  title: shortText(300).min(1, { message: "a title is required" }),
  description: shortText(10_000).optional(),
  cover: optionalCover,
  genres: z.array(shortText(60).min(1)).max(40).optional(),
  altTitles: z.array(shortText(300).min(1)).max(30).optional(),
  releaseInfo: shortText(120).optional(),
};

type UnitData = z.infer<typeof timedUnit> | z.infer<typeof chapterUnit>;

/** The Add Media dialog's input. Units are checked against the rules of the chosen type. */
export const addMediaInputSchema = z
  .object({
    type: z.enum(MEDIA_TYPES),
    origin: z.enum(["direct", "manual"]),
    ...metadata,
    units: z.array(z.unknown()).max(MAX_UNITS).optional(),
    libraryStatus: z.enum(LIBRARY_STATUSES).optional(),
  })
  .strict()
  .transform((input, ctx) => {
    const schema = unitInputSchema(input.type);
    const units: UnitData[] = [];
    (input.units ?? []).forEach((raw, index) => {
      const result = schema.safeParse(raw);
      if (result.success) units.push(result.data);
      else for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: ["units", index, ...issue.path], message: issue.message });
    });
    if (input.origin === "direct" && (input.units ?? []).length === 0) {
      ctx.addIssue({ code: "custom", path: ["units"], message: "adding by URL needs at least one episode, chapter or track" });
    }
    return { ...input, units };
  });

export const mediaPatchSchema = z
  .object({
    title: metadata.title.optional(),
    description: metadata.description,
    cover: metadata.cover,
    genres: metadata.genres,
    altTitles: metadata.altTitles,
    releaseInfo: metadata.releaseInfo,
  })
  .strict();

export const collectionNameSchema = shortText(120).min(1, { message: "a name is required" });
export const collectionDescriptionSchema = shortText(2000);
