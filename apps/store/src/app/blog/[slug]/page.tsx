import { BlogPostPage, postMetadata } from "@rbms/storefront-ui";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  return postMetadata(decodeURIComponent((await params).slug));
}

export default async function Page({ params }: Props) {
  return <BlogPostPage slug={decodeURIComponent((await params).slug)} />;
}
