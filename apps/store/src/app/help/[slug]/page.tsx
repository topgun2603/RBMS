import { HelpArticlePage, helpArticleMetadata } from "@srirealtime/storefront-ui";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  return helpArticleMetadata(decodeURIComponent((await params).slug));
}

export default async function Page({ params }: Props) {
  return <HelpArticlePage slug={decodeURIComponent((await params).slug)} />;
}
