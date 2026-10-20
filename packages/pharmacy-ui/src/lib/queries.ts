"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { retry4xx } from "./http";
import type { Batch, BillSummary, ExpirySummary, Medicine, Movement, Prescription, ShopItem } from "./types";

const MED = "/medicines";

/** Query keys. Lists start with these prefixes so mutations can invalidate them. */
export const pk = {
  all: ["pharmacy"] as const,
  batches: ["pharmacy", "batches"] as const,
  movements: (id: string) => ["pharmacy", "batches", id, "movements"] as const,
  medicines: ["pharmacy", "medicines"] as const,
  medicine: (itemId: string) => ["pharmacy", "medicines", "item", itemId] as const,
  prescriptions: ["pharmacy", "prescriptions"] as const,
  register: ["pharmacy", "register"] as const,
  expiry: (within: number) => ["pharmacy", "expiry", within] as const,
  items: (q: string) => ["pharmacy", "shop-items", q] as const,
  bills: (q: string) => ["pharmacy", "bills", q] as const,
};

export function useExpirySummary(within = 90) {
  return useQuery({ queryKey: pk.expiry(within), queryFn: () => api.get<ExpirySummary>(`${MED}/reports/expiry`, { within }), retry: retry4xx });
}

export function useMovements(batchId: string | null) {
  return useQuery({
    queryKey: pk.movements(batchId ?? ""),
    queryFn: () => api.get<{ items: Movement[] }>(`${MED}/batches/${batchId}/movements`),
    enabled: !!batchId,
    retry: retry4xx,
  });
}

/** The medicine details saved for an item (null when none yet). */
export function useMedicine(itemId: string | null) {
  return useQuery({
    queryKey: pk.medicine(itemId ?? ""),
    queryFn: async () => {
      const r = await api.get<Medicine | { itemId: string; details: null }>(`${MED}/items/${itemId}`);
      return "details" in r ? null : r;
    },
    enabled: !!itemId,
    retry: retry4xx,
  });
}

/** Billing items (catalogue variants) matching `q`, for the item pickers. */
export function useShopItems(q: string, enabled = true) {
  return useQuery({
    queryKey: pk.items(q),
    queryFn: ({ signal }) => api.get<{ items: ShopItem[] }>("/invoices/items", { q, limit: 12 }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
    retry: retry4xx,
  });
}

/** Recent bills matching `q` (number or customer), for linking a prescription to a bill. */
export function useBills(q: string, enabled = true) {
  return useQuery({
    queryKey: pk.bills(q),
    queryFn: ({ signal }) => api.get<{ items: BillSummary[] }>("/invoices", { q, limit: 8, sort: "-date" }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
    retry: retry4xx,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: pk.all });
}

export interface ReceiveBody {
  itemId: string;
  itemName: string;
  batchNo: string;
  expiry: string;
  mrp?: number | null;
  purchaseRate?: number | null;
  qty: number;
  supplier?: string | null;
  note?: string | null;
}

export function useReceiveBatch() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: ReceiveBody) => api.post<Batch>(`${MED}/batches`, body), onSuccess: invalidate });
}

export interface AdjustBody {
  mode: "add" | "remove" | "set";
  qty: number;
  reason: "adjust" | "expired" | "damaged" | "return_to_supplier";
  note?: string | null;
}

export function useAdjustBatch(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: AdjustBody) => api.post<Batch>(`${MED}/batches/${id}/adjust`, body), onSuccess: invalidate });
}

export type MedicineBody = Pick<Medicine, "itemId" | "name" | "composition" | "manufacturer" | "schedule" | "packSize" | "packUnit" | "rack" | "note">;

export function useSaveMedicine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ itemId, ...body }: MedicineBody) => api.put<Medicine>(`${MED}/items/${itemId}`, body),
    onSuccess: invalidate,
  });
}

export type PrescriptionBody = Omit<Prescription, "id" | "createdAt" | "rxDate"> & { rxDate?: string };

export function useSavePrescription(id?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: PrescriptionBody) =>
      id ? api.patch<Prescription>(`${MED}/prescriptions/${id}`, body) : api.post<Prescription>(`${MED}/prescriptions`, body),
    onSuccess: invalidate,
  });
}

export function useDeletePrescription() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.delete(`${MED}/prescriptions/${id}`), onSuccess: invalidate });
}
