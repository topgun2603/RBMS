import { JobTrackPage, jobTrackMetadata } from "@srirealtime/storefront-ui";

export const dynamic = "force-dynamic";
export const generateMetadata = jobTrackMetadata;

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return <JobTrackPage params={params} />;
}
