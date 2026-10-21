"use server";

import { cookies } from "next/headers";
import { PREVIEW_COOKIE, looksLikePreviewToken } from "../lib/preview-routing";
import { previewApi } from "./preview";

const MAX_DRAFT_BYTES = 512 * 1024;
/** Throwaway cookie: setting a cookie in a Server Action makes Next re-render the page in the same response. */
const REV_COOKIE = "sr_preview_rev";

/**
 * Live preview, one round trip: parks the editor's unsaved edits (`{ home?, tokens? }`) for this preview token and
 * returns the re-rendered page with the action's response (instead of PUT + router.refresh()). Next checks the
 * Origin of Server Action calls; the API checks the token and its shop.
 */
export async function parkPreviewDraft(body: { home?: unknown; tokens?: unknown }): Promise<{ ok: boolean; status: number }> {
  const jar = await cookies();
  const token = jar.get(PREVIEW_COOKIE)?.value;
  if (!looksLikePreviewToken(token)) return { ok: false, status: 401 };
  if (JSON.stringify(body ?? {}).length > MAX_DRAFT_BYTES) return { ok: false, status: 413 };
  let status = 502;
  try {
    status = (await previewApi("/draft", token, { method: "PUT", body: body ?? {} })).status;
  } catch {
    return { ok: false, status };
  }
  const ok = status >= 200 && status < 300;
  if (ok) jar.set(REV_COOKIE, String(Date.now()), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 });
  return { ok, status };
}
