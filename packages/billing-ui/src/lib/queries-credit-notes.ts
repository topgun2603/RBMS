"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import { qk } from "./queries";
import type { CreditNote, CreditNoteInput, CreditNoteResult, CreditNoteStatus, CreditNoteSummary, Paged, Returnable } from "./types";

const INV = "/invoices";

export const qkCn = {
  returnable: (invoiceId: string) => ["invoices", "returnable", invoiceId] as const,
  list: (f: object) => ["credit-notes", "list", f] as const,
  one: (id: string) => ["credit-notes", "one", id] as const,
};

/** What can still be returned / credited on a bill. */
export function useReturnable(invoiceId: string, enabled = true) {
  return useQuery({
    queryKey: qkCn.returnable(invoiceId),
    queryFn: () => api.get<Returnable>(`${INV}/${invoiceId}/returnable`),
    enabled: enabled && !!invoiceId,
    staleTime: 0,
  });
}

export interface CreditNoteFilters {
  q?: string;
  status?: CreditNoteStatus | "";
  from?: string;
  to?: string;
  customerId?: string;
}

export function useCreditNotes(f: CreditNoteFilters) {
  return useQuery({
    queryKey: qkCn.list(f),
    queryFn: ({ signal }) =>
      api.get<Paged<CreditNoteSummary> & { totals: { count: number; total: number } }>(
        `${INV}/credit-notes`,
        { q: f.q || undefined, status: f.status || undefined, from: f.from || undefined, to: f.to || undefined, customerId: f.customerId || undefined, limit: 100 },
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

export function useCreditNote(id: string) {
  return useQuery({ queryKey: qkCn.one(id), queryFn: () => api.get<CreditNote>(`${INV}/credit-notes/${id}`), enabled: !!id });
}

/** Everything a credit note changes: the bill, its returnable lines, lists, the customer's ledger, stock and reports. */
function useCreditNoteChanged() {
  const qc = useQueryClient();
  return (r: CreditNoteResult) => {
    qc.setQueryData(qk.invoice(r.invoice.id), r.invoice);
    qc.setQueryData(qkCn.one(r.creditNote.id), r.creditNote);
    // ["customers"] covers the customer ledgers too.
    for (const key of [["invoices"], ["credit-notes"], ["customers"], ["credit-book"], ["stock"], ["reports"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
}

export function useCreateCreditNote(invoiceId: string) {
  const changed = useCreditNoteChanged();
  return useMutation({
    mutationFn: (body: CreditNoteInput) => api.post<CreditNoteResult>(`${INV}/${invoiceId}/credit-notes`, body),
    onSuccess: changed,
  });
}

export function useCancelCreditNote() {
  const changed = useCreditNoteChanged();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.post<CreditNoteResult>(`${INV}/credit-notes/${id}/cancel`, reason ? { reason } : {}),
    onSuccess: changed,
  });
}
