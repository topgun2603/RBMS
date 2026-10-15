"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { retry4xx } from "../http";
import type { EInvoiceAccount, EInvoiceAccountInput } from "../types";

export const ek = { account: ["einvoice", "account"] as const };

export function useEInvoiceAccount() {
  return useQuery({ queryKey: ek.account, queryFn: () => api.get<EInvoiceAccount>("/einvoice/account"), retry: retry4xx });
}

/** Saves the account. With GSP credentials the server signs in to the portal first, so a save is also a connection test. */
export function useSaveEInvoiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: EInvoiceAccountInput) => api.put<EInvoiceAccount>("/einvoice/account", b),
    onSuccess: (a) => qc.setQueryData(ek.account, a),
  });
}

export function useDeleteEInvoiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ ok: true }>("/einvoice/account"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ek.account }),
  });
}
