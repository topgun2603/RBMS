import { CategoryPage, categoryMetadata } from "@srirealtime/storefront-ui";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  return categoryMetadata(decodeURIComponent((await params).slug));
}

export default async function Page({ params, searchParams }: Props) {
  return <CategoryPage slug={decodeURIComponent((await params).slug)} searchParams={await searchParams} />;
}
