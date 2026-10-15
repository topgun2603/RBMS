import { OrderConfirmationPage, orderMetadata } from "@srirealtime/storefront-ui";

type Props = { params: Promise<{ accessToken: string }> };

export const generateMetadata = orderMetadata;

export default async function Page({ params }: Props) {
  return <OrderConfirmationPage accessToken={(await params).accessToken} />;
}
