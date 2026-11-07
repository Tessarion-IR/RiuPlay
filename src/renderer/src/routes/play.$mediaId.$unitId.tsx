import { createFileRoute } from "@tanstack/react-router";
import { VideoUnitPage } from "@/features/media/VideoUnitPage";

// RiuPlay: see features/media/VideoUnitPage.tsx.
export const Route = createFileRoute("/play/$mediaId/$unitId")({ component: RouteComponent });

function RouteComponent() {
  const { mediaId, unitId } = Route.useParams();
  return <VideoUnitPage key={unitId} mediaId={Number(mediaId)} unitId={Number(unitId)} />;
}
