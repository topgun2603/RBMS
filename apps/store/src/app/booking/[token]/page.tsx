import { BookingPage, bookingMetadata } from "@srirealtime/storefront-ui";

export const dynamic = "force-dynamic";
export const generateMetadata = bookingMetadata;

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return <BookingPage params={params} />;
}
