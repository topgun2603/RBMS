import { permanentRedirect } from "next/navigation";

/** Older menu links use /pages/:slug; the canonical page URL is /:slug. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  permanentRedirect(`/${encodeURIComponent((await params).slug)}`);
}
