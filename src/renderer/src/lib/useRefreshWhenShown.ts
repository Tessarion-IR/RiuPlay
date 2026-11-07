// RiuPlay: persisted pages (Home, Video/Manga/Audio, Library, Collections) stay mounted while hidden,
// so React Query never sees them "mount" again and their data could stay stale after a change made
// elsewhere - a title added from another section, progress saved by the player, a collection edited
// on a title's page. This refreshes the given queries each time the page is shown again.
import { useContext, useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { PageActiveContext } from "@/lib/mobile";

export function useRefreshWhenShown(keys: QueryKey[]): void {
  const active = useContext(PageActiveContext);
  const queryClient = useQueryClient();
  const wasActive = useRef(active);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  useEffect(() => {
    if (active && !wasActive.current) {
      for (const queryKey of keysRef.current) void queryClient.invalidateQueries({ queryKey });
    }
    wasActive.current = active;
  }, [active, queryClient]);
}
