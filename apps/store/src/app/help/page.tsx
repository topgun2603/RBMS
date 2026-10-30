import { HelpPage, helpMetadata } from "@rbms/storefront-ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Help centre (features `support` / `support.faq`): FAQ with search + FAQPage JSON-LD, raise a ticket, my tickets. */
export const generateMetadata = helpMetadata;

export default async function Page({ searchParams }: Props) {
  return <HelpPage searchParams={await searchParams} />;
}
