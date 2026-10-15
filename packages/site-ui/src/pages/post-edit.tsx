"use client";

import { useRouteParams } from "@srirealtime/web";
import { ContentEditor } from "../components/content-editor";
import { ContentLoader } from "../components/content-loader";
import { usePost } from "../lib/queries";

export default function PostEditPage() {
  const { id } = useRouteParams<{ id: string }>();
  const q = usePost(id);
  return <ContentLoader kind="post" query={q}>{(item) => <ContentEditor key={item.id} kind="post" item={item} />}</ContentLoader>;
}
