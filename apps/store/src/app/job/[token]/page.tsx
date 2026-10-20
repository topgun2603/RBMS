import { JobPage, jobMetadata } from "@srirealtime/storefront-ui";

export const dynamic = "force-dynamic";
export const generateMetadata = jobMetadata;

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return <JobPage params={params} />;
}
