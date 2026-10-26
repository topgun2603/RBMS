"use client";

import * as React from "react";
import { ApiError, api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { useAiAssistAllowed, useAiAssistStatus } from "../ai-assist/use-assist";

/** Pieces shared by the Phase 4 part C helpers (photo cleanup, try-on setup; docs/ai.md). */

export const IMG_API = "/ai/imaging";
export const postImg = <T,>(path: string, body?: unknown) => api.post<T>(`${IMG_API}/${path}`, body ?? {});
export const getImg = <T,>(path: string, query?: Record<string, string | number | undefined>) => api.get<T>(`${IMG_API}/${path}`, query);
export const putImg = <T,>(path: string, body: unknown) => api.put<T>(`${IMG_API}/${path}`, body);
export const delImg = <T,>(path: string) => api.delete<T>(`${IMG_API}/${path}`);

export type CleanStyle = "white" | "shadow" | "color";
export const FESTIVE: { key: string; hex: string }[] = [
  { key: "diwali", hex: "#FFE7B3" },
  { key: "pongal", hex: "#FFF1B8" },
  { key: "navaratri", hex: "#FBD5E3" },
  { key: "christmas", hex: "#DDEFE2" },
  { key: "eid", hex: "#DFF1EA" },
];

export interface ProductImage {
  url: string;
  alt?: string | null;
}

export interface CleanupItem {
  id: string;
  batchId: string;
  productId: string;
  status: "queued" | "running" | "ready" | "check" | "failed" | "applied" | "discarded";
  originalUrl: string;
  cleanedUrl: string | null;
  style: string;
  reasons: string[];
  needsCheck: boolean;
  credits: number;
  error: string | null;
}
export interface CleanupBatch {
  batchId: string;
  total: number;
  done: number;
  waiting: number;
  ready: number;
  check: number;
  failed: number;
  applied: number;
  finished: boolean;
  credits: number;
  items: CleanupItem[];
}
export interface ImagingStatus {
  installed: boolean;
  model: string;
  creditsPerImage: number;
}

export type TryonKind = "glasses" | "earrings" | "nosepin" | "necklace";
export interface Pt {
  x: number;
  y: number;
}
export type TryonAnchors =
  | { kind: "glasses"; leftEye: Pt; rightEye: Pt; widthMm?: number }
  | { kind: "earrings"; hook: Pt; widthMm?: number }
  | { kind: "nosepin"; stud: Pt; widthMm?: number }
  | { kind: "necklace"; top: Pt; widthMm?: number };

/** Whether the helper's buttons show: the person may use AI and manage the catalogue, and the helper is listed for the shop. */
export function useImgHelper(key: "image-cleanup" | "ar-tryon") {
  const allowed = useAiAssistAllowed("catalogue.manage");
  const status = useAiAssistStatus(allowed);
  const info = status.data?.features.find((f) => f.key === key);
  return { show: allowed && !!info, enabled: !!info?.enabled, status: status.data };
}

/** The message for a failed call: our codes first, then the shared AI messages (off, credits, busy...). */
export function useImgError() {
  const { t } = useI18n();
  return React.useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        if (e.code === "image_model_missing") return t("web.aiImg.notInstalled");
        if (e.code === "no_product_found") return t("web.aiImg.noProduct");
        if (e.code === "cleanup_photo_changed") return t("web.aiImg.photoChanged");
        if (e.code === "image_unavailable") return t("web.aiImg.unavailable");
      }
      return describeError(e, t);
    },
    [t],
  );
}

/** Why a result needs a check, in words. */
export const reasonKey = (r: string) => `web.aiImg.reason.${r}`;
