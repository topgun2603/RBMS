"use client";

import * as React from "react";
import { CameraIcon, Loader2Icon } from "lucide-react";
import { Button } from "@srirealtime/ui";
import { ApiError, api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { useAiAssistAllowed, useAiAssistStatus } from "../ai-assist/use-assist";

/**
 * Pieces shared by the Phase 3 part B helpers (catalogue from photos, product tags, pack identify at the counter, jewellery
 * HUID and price breakup; docs/ai.md). Every helper only drafts: the person reads the result and chooses what is saved.
 */

/** Whether a helper's button shows: the person may use AI and the module's permission, and the helper is listed for the shop. */
export function useBHelper(key: string, permission: string | readonly string[]) {
  const allowed = useAiAssistAllowed(permission);
  const status = useAiAssistStatus(allowed);
  const listed = !!status.data?.features.some((f) => f.key === key);
  return { show: allowed && listed, status: status.data };
}

export const B_API = "/ai/trade";
export const postB = <T,>(path: string, body: unknown) => api.post<T>(`${B_API}/${path}`, body);
export const getB = <T,>(path: string, query?: Record<string, string | number | undefined>) => api.get<T>(`${B_API}/${path}`, query);

export interface Run {
  runId: string;
  credits: number;
}

/** The message for a failed call: our photo codes first, then the shared AI messages (off, credits, busy...). */
export function useBError() {
  const { t } = useI18n();
  return React.useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        if (e.code === "ai_unreadable_image") return t("web.aiB.unreadable");
        if (e.code === "ai_bad_image" || e.status === 413) return t("web.aiB.badImage");
        if (e.code === "ai_not_for_trade") return t("web.aiB.notForTrade");
        if (e.code === "no_rate") return t("web.aiB.noRate");
        if (e.code === "no_photos") return t("web.aiB.noPhotos");
        if (e.code === "feature_unavailable") return t("web.aiB.noModule");
      }
      return describeError(e, t);
    },
    [t],
  );
}

// ------------------------------------------------------------------ photos

const MAX_SIDE = 1600;
const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("unreadable"));
    r.readAsDataURL(blob);
  });

export interface Photo {
  mediaType: "image/jpeg";
  data: string;
  /** For the small preview. */
  url: string;
}

/** A photo to a JPEG no bigger than 1600 px on its longest side (phone photos are 12 MP). */
export async function shrinkPhoto(file: File): Promise<Photo> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("unreadable");
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("unreadable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("unreadable");
    return { mediaType: "image/jpeg", data: await toBase64(blob), url: URL.createObjectURL(blob) };
  } finally {
    bmp.close();
  }
}

/** A "Choose photos" button: opens the camera or gallery on a phone and hands back the shrunk photos (up to `max`). */
export function PhotoPicker({
  label,
  busy,
  onPhotos,
  onError,
  max = 1,
  variant = "default",
  size,
  className,
  testId = "ai-b-photo-input",
}: {
  label: string;
  busy?: boolean;
  onPhotos: (photos: Photo[]) => void;
  onError: (message: string) => void;
  max?: number;
  variant?: "default" | "outline" | "secondary";
  size?: "sm" | "default" | "lg";
  className?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  const ref = React.useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple={max > 1}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid={testId}
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length === 0) return;
          if (files.length > max) onError(t("web.aiB.tooMany", { max }));
          try {
            onPhotos(await Promise.all(files.slice(0, max).map(shrinkPhoto)));
          } catch {
            onError(t("web.aiB.badImage"));
          }
        }}
      />
      <Button type="button" variant={variant} size={size} className={className} disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2Icon className="animate-spin" /> : <CameraIcon />} {label}
      </Button>
    </>
  );
}

export const rupeesText = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const toPaise = (rupees: string): number | null => {
  const n = Number(String(rupees).replace(/[, ₹]/g, ""));
  return rupees.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
export const fromPaise = (paise: number | null | undefined) => (paise === null || paise === undefined ? "" : String(Math.round(paise) / 100));
