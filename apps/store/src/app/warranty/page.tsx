import { WarrantyPage, warrantyMetadata } from "@rbms/storefront-ui";

export const dynamic = "force-dynamic";
export const generateMetadata = warrantyMetadata;

export default function Page({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  return <WarrantyPage searchParams={searchParams} />;
}
