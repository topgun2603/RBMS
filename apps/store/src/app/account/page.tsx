import { AccountPage, accountMetadata } from "@srirealtime/storefront-ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const generateMetadata = accountMetadata;

export default async function Page({ searchParams }: Props) {
  return <AccountPage searchParams={await searchParams} />;
}
