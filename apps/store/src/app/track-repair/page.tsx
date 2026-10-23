/* "Track my repair" (job number + phone digits → /job/<token>). Takes over the /track-repair path from CMS pages. */
import { TrackRepairPage, trackRepairMetadata } from "@srirealtime/storefront-ui";

export const dynamic = "force-dynamic";
export const generateMetadata = trackRepairMetadata;

export default function Page() {
  return <TrackRepairPage />;
}
