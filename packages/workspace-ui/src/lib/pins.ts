"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";

/**
 * Staff POS PINs (docs/pos-terminals.md → Staff PINs): who has one, set / reset / remove a member's PIN (pos.devices),
 * and the signed-in member's own PIN. The server is the last word (`pin_weak`, `pin_taken`).
 */

export const POS_TERMINALS_FEATURE = "pos.terminals";
export const POS_DEVICES_PERMISSION = "pos.devices";

export interface PinRow {
  userId: string;
  name: string;
  hasPin: boolean;
  updatedAt: string | null;
}

export const pinKeys = { all: ["pos", "pins"] as const };

export function usePosPins(enabled: boolean) {
  return useQuery({
    queryKey: pinKeys.all,
    queryFn: () => api.get<{ items: PinRow[] }>("/pos/pins").then((r) => new Map(r.items.map((p) => [p.userId, p]))),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

export function usePinActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: pinKeys.all });
  return {
    set: useMutation({ mutationFn: (b: { userId: string | "me"; pin: string }) => api.put<{ ok: true }>(`/pos/pins/${b.userId}`, { pin: b.pin }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (userId: string) => api.delete<{ ok: true }>(`/pos/pins/${userId}`), onSuccess: refresh }),
  };
}

/** 4–6 digits; not all the same digit, not a run up or down (1234, 6543). Mirrors the server's pin_weak rule. */
export function pinProblem(pin: string, confirm?: string): "format" | "weak" | "mismatch" | null {
  if (!/^\d{4,6}$/.test(pin)) return "format";
  if (/^(\d)\1+$/.test(pin)) return "weak";
  const d = [...pin].map(Number);
  const step = d[1]! - d[0]!;
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1]! === step)) return "weak";
  if (confirm !== undefined && confirm !== pin) return "mismatch";
  return null;
}
