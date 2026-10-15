import { CollectionView, collectionMetadata } from "@srirealtime/storefront-ui";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  return collectionMetadata(decodeURIComponent((await params).slug));
}

export default async function Page({ params, searchParams }: Props) {
  return <CollectionView slug={decodeURIComponent((await params).slug)} searchParams={await searchParams} />;
}
