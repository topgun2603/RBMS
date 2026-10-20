import { BookPage, bookMetadata } from "@srirealtime/storefront-ui";

export const dynamic = "force-dynamic";
export const generateMetadata = bookMetadata;

export default function Page() {
  return <BookPage />;
}
