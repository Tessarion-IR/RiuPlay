import { createFileRoute } from "@tanstack/react-router";
import { AudioUnitPage } from "@/features/media/AudioUnitPage";

// RiuPlay: see features/media/AudioUnitPage.tsx.
export const Route = createFileRoute("/listen/$mediaId/$unitId")({ component: RouteComponent });

function RouteComponent() {
  const { mediaId, unitId } = Route.useParams();
  return <AudioUnitPage key={unitId} mediaId={Number(mediaId)} unitId={Number(unitId)} />;
}
