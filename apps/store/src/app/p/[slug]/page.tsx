import { ProductPage, productMetadata } from "@srirealtime/storefront-ui";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  return productMetadata(decodeURIComponent((await params).slug));
}

export default async function Page({ params }: Props) {
  return <ProductPage slug={decodeURIComponent((await params).slug)} />;
}
