import { RaiseTicketPage, helpPrivateMetadata } from "@rbms/storefront-ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const generateMetadata = helpPrivateMetadata;

export default async function Page({ searchParams }: Props) {
  return <RaiseTicketPage searchParams={await searchParams} />;
}
