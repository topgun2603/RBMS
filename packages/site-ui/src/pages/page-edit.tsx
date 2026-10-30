"use client";

import { useRouteParams } from "@rbms/web";
import { ContentEditor } from "../components/content-editor";
import { ContentLoader } from "../components/content-loader";
import { usePage } from "../lib/queries";

export default function PageEditPage() {
  const { id } = useRouteParams<{ id: string }>();
  const q = usePage(id);
  return <ContentLoader kind="page" query={q}>{(item) => <ContentEditor key={item.id} kind="page" item={item} />}</ContentLoader>;
}
