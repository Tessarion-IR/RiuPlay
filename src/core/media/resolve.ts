// RiuPlay: turns a riuplay-media:// URL back into the file it stands for - only ever a path that is
// stored in the database for a title the user imported. Anything else resolves to null, so the
// protocol (main/mediaProtocol.ts) can never be used to read an arbitrary file.
//
//   riuplay-media://unit/<unitId>          the episode's/track's file
//   riuplay-media://subtitle/<unitId>      its subtitle/lyrics file
//   riuplay-media://page/<unitId>/<index>  a chapter page
//   riuplay-media://cover/<mediaId>        the title's cover
import { MEDIA_SCHEME, storedItem, storedUnit } from "./media";
import { isHttpUrl } from "./validation";

const isStoredPath = (value: string | null | undefined): value is string => typeof value === "string" && value !== "" && !value.startsWith(`${MEDIA_SCHEME}:`) && !isHttpUrl(value);

function pagesOf(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const id = (text: string | undefined): number | null => (text && /^\d{1,15}$/.test(text) ? Number(text) : null);

export async function resolveMediaUrl(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${MEDIA_SCHEME}:` || url.search || url.username || url.password) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  switch (url.hostname) {
    case "unit": {
      const unitId = id(parts[0]);
      if (unitId === null || parts.length !== 1) return null;
      const unit = await storedUnit(unitId);
      return unit && isStoredPath(unit.url) ? unit.url : null;
    }
    case "subtitle": {
      const unitId = id(parts[0]);
      if (unitId === null || parts.length !== 1) return null;
      const unit = await storedUnit(unitId);
      return unit && isStoredPath(unit.subtitleUrl) ? unit.subtitleUrl : null;
    }
    case "page": {
      const unitId = id(parts[0]);
      const index = id(parts[1]);
      if (unitId === null || index === null || parts.length !== 2) return null;
      const unit = await storedUnit(unitId);
      const page = unit ? pagesOf(unit.pagesJson)[index] : undefined;
      return isStoredPath(page) ? page : null;
    }
    case "cover": {
      const mediaId = id(parts[0]);
      if (mediaId === null || parts.length !== 1) return null;
      const item = await storedItem(mediaId);
      return item && isStoredPath(item.cover) ? item.cover : null;
    }
    default:
      return null;
  }
}
