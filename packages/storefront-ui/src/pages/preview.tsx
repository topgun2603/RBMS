import * as React from "react";
import { PreviewBridge } from "../client/preview-bridge";
import { editorOrigins, PREVIEW_EXIT_PATH } from "../lib/preview-protocol";
import { getRequestInfo } from "../server/api";
import { getPreviewSession } from "../server/preview";

/**
 * Renders the live-preview bridge (and, outside the editor's iframe, a "you're in preview" banner) for requests in
 * preview mode; nothing for shoppers. Mounted once in StoreLayout, inside <StoreProvider>.
 */
export async function PreviewMount() {
  const session = await getPreviewSession();
  if (!session) return null;
  const { locale } = await getRequestInfo();
  return <PreviewBridge allowedOrigins={editorOrigins()} locale={locale} expiresAt={session.expiresAt} exitHref={PREVIEW_EXIT_PATH} />;
}
