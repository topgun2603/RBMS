"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import { retry4xx } from "./http";
import type { Enquiry, EnquiriesSummary, EnquiryStatus } from "./types";

const ES = "/enquiries";

export const ek = {
  all: ["enquiries"] as const,
  list: ["enquiries", "list"] as const,
  one: (id: string) => ["enquiries", "one", id] as const,
  summary: ["enquiries", "summary"] as const,
};

export function useEnquiry(id: string) {
  return useQuery({ queryKey: ek.one(id), queryFn: () => api.get<Enquiry>(`${ES}/enquiries/${id}`), retry: retry4xx });
}

export function useEnquiriesSummary() {
  return useQuery({ queryKey: ek.summary, queryFn: () => api.get<EnquiriesSummary>(`${ES}/summary`), retry: retry4xx, refetchInterval: 60_000 });
}

export function useEnquiryActions(id: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ek.all });
  return {
    update: useMutation({
      mutationFn: (body: { status?: EnquiryStatus; note?: string | null }) => api.patch<Enquiry>(`${ES}/enquiries/${id}`, body),
      onSuccess: (e) => {
        qc.setQueryData(ek.one(id), e);
        void qc.invalidateQueries({ queryKey: ek.list });
        void qc.invalidateQueries({ queryKey: ek.summary });
      },
    }),
    remove: useMutation({ mutationFn: () => api.delete(`${ES}/enquiries/${id}`), onSuccess: invalidate }),
  };
}
