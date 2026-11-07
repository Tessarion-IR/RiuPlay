import { createFileRoute } from "@tanstack/react-router";
import { MediaDetailsPage } from "@/features/media/MediaDetailsPage";

// RiuPlay: see features/media/MediaDetailsPage.tsx.
export const Route = createFileRoute("/media/$mediaId")({ component: RouteComponent });

function RouteComponent() {
  const { mediaId } = Route.useParams();
  return <MediaDetailsPage key={mediaId} mediaId={Number(mediaId)} />;
}
