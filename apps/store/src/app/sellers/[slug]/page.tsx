import { SellerPage, sellerMetadata } from "@rbms/storefront-ui";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Marketplace seller page (feature `marketplace`); the marketplace-ui "View seller page" link points here. */
export async function generateMetadata({ params }: Props) {
  return sellerMetadata(decodeURIComponent((await params).slug));
}

export default async function Page({ params, searchParams }: Props) {
  return <SellerPage slug={decodeURIComponent((await params).slug)} searchParams={await searchParams} />;
}
