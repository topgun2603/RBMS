import { TicketPage, helpPrivateMetadata } from "@srirealtime/storefront-ui";

type Props = { params: Promise<{ id: string }> };

export const generateMetadata = helpPrivateMetadata;

export default async function Page({ params }: Props) {
  return <TicketPage id={(await params).id} />;
}
