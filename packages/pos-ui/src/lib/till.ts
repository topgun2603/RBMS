"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { APPROVAL_PIN_HEADER } from "@rbms/web";
import { posApi, isNetworkError } from "./api";
import { reportNetwork } from "./online";
import { readJson, storageKey, writeJson, type DayRecord } from "./storage";
import type { DenominationCounts } from "./tender";
import type { PaymentMethod } from "./types";

/**
 * Server-side till sessions (`/v1/invoices/till`): one open cash drawer session per register (this device) and
 * branch. The last session seen is cached on the device so the counter still shows its state while offline; opening,
 * closing and cash in / out need the server.
 */

/** Why cash went in or out of the drawer (pay-in / pay-out). */
export const CASH_CATEGORIES = ["petty_expense", "owner_drawing", "change_float", "other"] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];

export interface TillCashEntry {
  id: string;
  amount: number;
  category?: CashCategory;
  reason: string;
  by: string | null;
  byName: string | null;
  at: string;
}

export interface TillMethodRow {
  method: PaymentMethod;
  amount: number;
  count: number;
}

export interface TillTaxRow {
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface TillHandover {
  id: string;
  at: string;
  fromName: string | null;
  toName: string;
  expected: number;
  counted: number;
  difference: number;
  note: string | null;
  approvedByName: string | null;
}

export interface TillReport {
  bills: { count: number; total: number; cancelled: number };
  payments: TillMethodRow[];
  refunds: TillMethodRow[];
  creditNotes: { count: number; total: number };
  onCredit: number;
  collected: number;
  refunded: number;
  cash: { opening: number; sales: number; refunds: number; cashIn: number; cashOut: number; handoverAdjust?: number; expected: number };
  /** Reports frozen before the Z numbering do not have the blocks below. */
  voids?: { count: number; total: number };
  discounts?: { total: number; bills: number };
  taxByRate?: TillTaxRow[];
  returnsTaxByRate?: TillTaxRow[];
  billRange?: { from: string | null; to: string | null };
  cashByCategory?: { category: CashCategory; cashIn: number; cashOut: number; count: number }[];
}

export interface TillSession {
  id: string;
  branchId: string | null;
  register: string;
  status: "open" | "closed";
  date: string;
  openingCash: number;
  openingCount: Record<string, number> | null;
  openedByName: string | null;
  openedAt: string;
  cashEntries: TillCashEntry[];
  /** Z number of the register (1 = Z1), set at close. */
  zNumber: number | null;
  /** Who has the drawer now. */
  cashierName: string | null;
  handovers: TillHandover[];
  closingCount: Record<string, number> | null;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
  note: string | null;
  differenceReason: string | null;
  closeApprovedByName: string | null;
  closedByName: string | null;
  closedAt: string | null;
  summary: TillReport | null;
}

export const DEFAULT_REGISTER = "Counter 1";
const TILL = "/invoices/till";

export const tillKeys = {
  current: (register: string, branch: string | null) => ["pos", "till", "current", register.toLowerCase(), branch] as const,
  x: (id: string) => ["pos", "till", "x", id] as const,
};

/** This device's register name (per shop), e.g. "Counter 1". */
export function useRegisterName(tenant: string | null): [string, (name: string) => void] {
  const key = storageKey("register", tenant);
  const [name, setName] = React.useState(DEFAULT_REGISTER);
  React.useEffect(() => setName(readJson<string>(key, DEFAULT_REGISTER) || DEFAULT_REGISTER), [key]);
  const set = React.useCallback(
    (n: string) => {
      const clean = n.trim().replace(/\s+/g, " ").slice(0, 40) || DEFAULT_REGISTER;
      writeJson(key, clean);
      setName(clean);
    },
    [key],
  );
  return [name, set];
}

/** The register's open session (null = none), cached on the device for offline display. */
export function useTillSession(tenant: string | null, register: string, branch: string | null, enabled: boolean) {
  const cacheKey = storageKey("till", tenant, `${branch ?? "-"}:${register.toLowerCase()}`);
  return useQuery({
    queryKey: tillKeys.current(register, branch),
    queryFn: async () => {
      try {
        const r = await posApi.get<{ session: TillSession | null }>(`${TILL}/current`, { register });
        reportNetwork(true);
        writeJson(cacheKey, r.session);
        return r.session;
      } catch (err) {
        if (isNetworkError(err)) {
          reportNetwork(false);
          // Offline: the last session this device saw.
          return readJson<TillSession | null>(cacheKey, null);
        }
        throw err;
      }
    },
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useTillReport(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: tillKeys.x(id ?? ""),
    queryFn: () => posApi.get<{ session: TillSession; report: TillReport }>(`${TILL}/${id}/x`),
    enabled: enabled && !!id,
    staleTime: 0,
  });
}

/** The register's closed days, newest first (needs the reports permission): for reprinting an earlier Z report. */
export function useClosedTills(register: string, enabled: boolean) {
  return useQuery({
    queryKey: ["pos", "till", "closed", register.toLowerCase()],
    queryFn: () => posApi.get<{ items: TillSession[]; total: number }>(`${TILL}/sessions`, { register, status: "closed", limit: 8 }).then((r) => r.items),
    enabled,
    staleTime: 30_000,
    retry: 0,
  });
}

export interface OpenInput {
  register: string;
  openingCash?: number;
  openingCount?: DenominationCounts;
  actorName: string;
}

/** Open / cash in-out / close; every success refreshes the session and its X report. */
export function useTillActions(register: string, branch: string | null) {
  const qc = useQueryClient();
  const refresh = (s?: TillSession | null) => {
    if (s !== undefined) qc.setQueryData(tillKeys.current(register, branch), s && s.status === "open" ? s : null);
    void qc.invalidateQueries({ queryKey: ["pos", "till"] });
  };
  const open = useMutation({
    mutationFn: (b: OpenInput) => posApi.post<TillSession>(`${TILL}/open`, b),
    onSuccess: (s) => refresh(s),
  });
  const cash = useMutation({
    mutationFn: (b: { id: string; amount: number; category?: CashCategory; reason: string; actorName: string }) =>
      posApi.post<TillSession>(`${TILL}/${b.id}/cash`, { amount: b.amount, category: b.category ?? "other", reason: b.reason, actorName: b.actorName }),
    onSuccess: (s) => refresh(s),
  });
  // A difference beyond the shop's limit is refused (403 till_approval_required) until a manager's PIN comes with it.
  const close = useMutation({
    mutationFn: (b: { id: string; count: DenominationCounts; note: string; reason?: string; actorName: string; pin?: string }) =>
      posApi.post<{ session: TillSession; report: TillReport }>(
        `${TILL}/${b.id}/close`,
        { count: b.count, note: b.note || null, reason: b.reason?.trim() || null, actorName: b.actorName },
        b.pin ? { headers: { [APPROVAL_PIN_HEADER]: b.pin } } : undefined,
      ),
    onSuccess: () => refresh(null),
  });
  // The drawer changes hands without closing the day.
  const handover = useMutation({
    mutationFn: (b: { id: string; toName: string; count: DenominationCounts; note: string; reason?: string; actorName: string; pin?: string }) =>
      posApi.post<{ session: TillSession; report: TillReport }>(
        `${TILL}/${b.id}/handover`,
        { toName: b.toName, count: b.count, note: b.note || null, reason: b.reason?.trim() || null, actorName: b.actorName },
        b.pin ? { headers: { [APPROVAL_PIN_HEADER]: b.pin } } : undefined,
      ),
    onSuccess: (r) => refresh(r.session),
  });
  return { open, cash, close, handover };
}

/** Paper widths the Z / X report prints on: 58 and 80 mm rolls, or A4. */
export type ReportPaper = "58" | "80" | "a4";
export const REPORT_PAPERS: readonly ReportPaper[] = ["80", "58", "a4"];

/** Z (or X) report of a session as a PDF, 80 mm unless told otherwise. */
export const tillReportPath = (id: string, paper: ReportPaper = "80") => `/documents/${paper === "80" ? "till-z" : `till-z-${paper}`}/${id}.pdf`;

/** "Z7" for a closed session of this register, "X" for one still open. */
export const zLabel = (s: Pick<TillSession, "status" | "zNumber">) => (s.status === "closed" && s.zNumber ? `Z${s.zNumber}` : "X");

/**
 * The device-only day the counter kept before till sessions moved to the server. Today's open day (no server session
 * yet) is carried over: opened with the same float and cash in / out. Anything else is dropped. Returns what happened
 * so the screen can tell the cashier, or null when there was nothing to do.
 */
export async function migrateLocalDay(opts: {
  tenant: string | null;
  branchCode: string | null;
  register: string;
  today: string;
  actorName: string;
  hasServerSession: boolean;
  open: (b: OpenInput) => Promise<TillSession>;
  cash: (b: { id: string; amount: number; reason: string; actorName: string }) => Promise<TillSession>;
}): Promise<"migrated" | "dropped" | null> {
  const key = storageKey("day", opts.tenant, opts.branchCode);
  const day = readJson<DayRecord | null>(key, null);
  if (!day) return null;
  if (day.date !== opts.today || day.closedAt || opts.hasServerSession) {
    writeJson(key, null);
    return "dropped";
  }
  const s = await opts.open({ register: opts.register, openingCash: day.openingCash, actorName: day.openedBy || opts.actorName });
  for (const m of day.cashMoves ?? []) {
    if (m.amount) await opts.cash({ id: s.id, amount: m.amount, reason: m.note ?? "", actorName: opts.actorName });
  }
  writeJson(key, null);
  return "migrated";
}

// ---------------------------------------------------------------- returns (credit notes)

export interface ReturnableLine {
  line: number;
  description: string;
  unit: string | null;
  itemId: string | null;
  gstRate: number;
  qty: number;
  returnedQty: number;
  remainingQty: number;
  total: number;
  remaining: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
  credited: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
}

export interface Returnable {
  invoiceId: string;
  number: string | null;
  status: string;
  total: number;
  paid: number;
  credited: number;
  balance: number;
  creditable: number;
  interState: boolean;
  hasCustomer: boolean;
  blocked: string | null;
  lines: ReturnableLine[];
  creditNotes: { id: string; number: string; status: string; total: number }[];
}

export interface PosCreditNote {
  id: string;
  number: string;
  total: number;
  refundAmount: number;
  refundMode: "cash" | "upi" | "card" | "credit_book" | "none";
}

export const getReturnable = (invoiceId: string) => posApi.get<Returnable>(`/invoices/${invoiceId}/returnable`);

export const createCreditNote = (
  invoiceId: string,
  body: {
    reason: "return";
    refundMode: "cash" | "upi" | "card" | "credit_book" | "none";
    lines: { line: number; qty: number; restock: boolean }[];
    note?: string;
    tillSessionId?: string;
  },
) => posApi.post<{ creditNote: PosCreditNote; invoice: { id: string; number: string | null; balance: number } }>(`/invoices/${invoiceId}/credit-notes`, body);

/** 80 mm credit note slip. */
export const creditNoteSlipPath = (id: string) => `/documents/credit-note-thermal/${id}.pdf`;
