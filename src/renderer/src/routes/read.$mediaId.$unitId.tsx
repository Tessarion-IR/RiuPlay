import { createFileRoute } from "@tanstack/react-router";
import { MangaReaderPage } from "@/features/media/MangaReaderPage";

// RiuPlay: see features/media/MangaReaderPage.tsx.
export const Route = createFileRoute("/read/$mediaId/$unitId")({ component: RouteComponent });

function RouteComponent() {
  const { mediaId, unitId } = Route.useParams();
  return <MangaReaderPage key={unitId} mediaId={Number(mediaId)} unitId={Number(unitId)} />;
}
