import { TableMenuPage, tableMetadata } from "@srirealtime/storefront-ui";

export const dynamic = "force-dynamic";
export const generateMetadata = tableMetadata;

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return <TableMenuPage params={params} />;
}
