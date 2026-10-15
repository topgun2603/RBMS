import { SearchPage, searchMetadata } from "@srirealtime/storefront-ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props) {
  return searchMetadata(await searchParams);
}

export default async function Page({ searchParams }: Props) {
  return <SearchPage searchParams={await searchParams} />;
}
