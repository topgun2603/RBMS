/* CMS pages live at /:pageSlug (STORE_PATHS.page); anything else 404s. */
import { CmsPageView, cmsPageMetadata } from "@srirealtime/storefront-ui";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  return cmsPageMetadata(decodeURIComponent((await params).slug));
}

export default async function Page({ params }: Props) {
  return <CmsPageView slug={decodeURIComponent((await params).slug)} />;
}
