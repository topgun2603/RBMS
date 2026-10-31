import { ProductsPage, productsMetadata } from "@rbms/storefront-ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const generateMetadata = productsMetadata;

export default async function Page({ searchParams }: Props) {
  return <ProductsPage searchParams={await searchParams} />;
}
