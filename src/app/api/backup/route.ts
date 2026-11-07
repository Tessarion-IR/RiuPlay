import { db } from "@/db";
import {
  profiles,
  settings,
  mediaItems,
  episodes,
  chapters,
  tracks,
  libraryEntries,
  historyEntries,
  repositories,
  searchHistory,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const BACKUP_FORMAT_VERSION = 1;

/** Exports a versioned JSON snapshot of all RiuPlay user data (excludes encrypted secrets). */
export async function GET() {
  const [
    profilesRows,
    settingsRows,
    mediaRows,
    episodesRows,
    chaptersRows,
    tracksRows,
    libraryRows,
    historyRows,
    reposRows,
    searchRows,
  ] = await Promise.all([
    db.select().from(profiles),
    db.select().from(settings),
    db.select().from(mediaItems),
    db.select().from(episodes),
    db.select().from(chapters),
    db.select().from(tracks),
    db.select().from(libraryEntries),
    db.select().from(historyEntries),
    db.select().from(repositories),
    db.select().from(searchHistory),
  ]);

  const sanitizedSettings = settingsRows.map(({ proxy, ...rest }) => ({
    ...rest,
    proxy: { ...proxy, passwordEnc: null, hasPassword: false },
  }));

  const backup = {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    app: "RiuPlay",
    data: {
      profiles: profilesRows,
      settings: sanitizedSettings,
      mediaItems: mediaRows,
      episodes: episodesRows,
      chapters: chaptersRows,
      tracks: tracksRows,
      libraryEntries: libraryRows,
      historyEntries: historyRows,
      repositories: reposRows,
      searchHistory: searchRows,
    },
  };

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="riuplay-backup-${Date.now()}.json"`,
    },
  });
}
