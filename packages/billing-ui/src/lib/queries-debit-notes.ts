"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import type { DebitNote, DebitNoteInput, DebitNoteSummary } from "./types-debit-notes";

const INV = "/invoices";

export const qkDn = {
  forInvoice: (invoiceId: string) => ["sales-debit-notes", "invoice", invoiceId] as const,
  one: (id: string) => ["sales-debit-notes", "one", id] as const,
};

/** A bill's debit notes (issued and cancelled), oldest first. */
export function useInvoiceDebitNotes(invoiceId: string, enabled = true) {
  return useQuery({
    queryKey: qkDn.forInvoice(invoiceId),
    queryFn: () => api.get<{ items: DebitNoteSummary[] }>(`${INV}/${invoiceId}/debit-notes`),
    enabled: enabled && !!invoiceId,
  });
}

export function useDebitNote(id: string) {
  return useQuery({ queryKey: qkDn.one(id), queryFn: () => api.get<DebitNote>(`${INV}/debit-notes/${id}`), enabled: !!id });
}

/** Everything a debit note changes: lists, the bill's notes, the customer's ledger and balance, and reports. */
function useDebitNoteChanged() {
  const qc = useQueryClient();
  return (n: DebitNote) => {
    qc.setQueryData(qkDn.one(n.id), n);
    for (const key of [["sales-debit-notes"], ["invoices"], ["customers"], ["credit-book"], ["reports"], ["gst"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
}

export function useCreateDebitNote(invoiceId: string) {
  const changed = useDebitNoteChanged();
  return useMutation({
    mutationFn: (body: DebitNoteInput) => api.post<DebitNote>(`${INV}/${invoiceId}/debit-notes`, body),
    onSuccess: changed,
  });
}

export function useCancelDebitNote() {
  const changed = useDebitNoteChanged();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.post<DebitNote>(`${INV}/debit-notes/${id}/cancel`, reason ? { reason } : {}),
    onSuccess: changed,
  });
}
