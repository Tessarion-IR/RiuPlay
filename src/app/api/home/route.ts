import { continueList, listLibrary, listMediaItems } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const [continueVideo, continueManga, continueAudio, recent, favorites] = await Promise.all([
    continueList("video", 8),
    continueList("manga", 8),
    continueList("audio", 8),
    listMediaItems(),
    listLibrary({ favorite: true }),
  ]);

  return Response.json({
    continueWatching: continueVideo,
    continueReading: continueManga,
    continueListening: continueAudio,
    recentlyAdded: recent.slice(0, 12),
    favorites: favorites.slice(0, 12),
  });
}
