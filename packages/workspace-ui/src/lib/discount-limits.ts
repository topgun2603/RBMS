"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";

/** `GET /v1/staff/discount-limits`: a max discount percent and / or a max discount per bill, per role or per member. */
export interface DiscountLimit {
  id: string;
  scope: "role" | "user";
  /** A role key, or a user id. */
  subject: string;
  maxPercent: number | null;
  /** Paise per bill. */
  maxAmount: number | null;
  updatedAt: string;
}

export interface DiscountLimitInput {
  scope: "role" | "user";
  subject: string;
  maxPercent: number | null;
  maxAmount: number | null;
}

const KEY = ["staff", "discount-limits"] as const;

export function useDiscountLimits(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<{ items: DiscountLimit[] }>("/staff/discount-limits").then((r) => r.items), enabled });
}

export function useSaveDiscountLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DiscountLimitInput) => api.put<DiscountLimit>("/staff/discount-limits", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteDiscountLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (l: Pick<DiscountLimit, "scope" | "subject">) => api<{ ok: true }>(`/staff/discount-limits/${l.scope}/${encodeURIComponent(l.subject)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Rupees typed by a person ("1,500.50") → paise; null for blank; NaN-safe (returns undefined when invalid). */
export function rupeesToPaise(input: string): number | null | undefined {
  const s = input.replace(/[,\s₹]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 100);
}
