"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BanIcon,
  BookOpenTextIcon,
  CircleCheckIcon,
  FileTextIcon,
  HandCoinsIcon,
  WalletIcon,
} from "lucide-react";
import { StatusPill, toast, type StatusTone } from "@srirealtime/ui";
import { describeError, useI18n, useOptionalShop } from "@srirealtime/web";
import { money, whatsappNumber } from "../../lib/format";
import { usePublicUrl } from "../../lib/links";
import { useRemindCustomer, useShareStatement } from "../../lib/queries-v2";
import type { Customer, LedgerEntryType } from "../../lib/types";
import type { Translator } from "@srirealtime/i18n/client";

type Icon = React.ComponentType<{ className?: string }>;

export type BalanceSide = "due" | "advance" | "settled";

export const balanceSide = (balance: number): BalanceSide => (balance > 0 ? "due" : balance < 0 ? "advance" : "settled");

/** Text ink for a balance: dues in warning ink, advances in success ink. */
export const balanceInk = (balance: number) =>
  balance > 0 ? "text-warning-ink" : balance < 0 ? "text-success-ink" : "text-muted-foreground";

const SIDE: Record<BalanceSide, { tone: StatusTone; icon: Icon; key: string }> = {
  due: { tone: "warning", icon: ArrowUpRightIcon, key: "billing.creditBook.due" },
  advance: { tone: "success", icon: ArrowDownLeftIcon, key: "billing.creditBook.advance" },
  settled: { tone: "neutral", icon: CircleCheckIcon, key: "billing.creditBook.settled" },
};

/** Due / Advance / Settled pill (icon + label, never colour alone). */
export function BalancePill({ balance, size, className }: { balance: number; size?: "sm" | "md"; className?: string }) {
  const { t } = useI18n();
  const s = SIDE[balanceSide(balance)];
  return (
    <StatusPill tone={s.tone} icon={s.icon} size={size} className={className}>
      {t(s.key)}
    </StatusPill>
  );
}

/**
 * Overdue flag from the credit book row. The contract leaves `overdue` open: a paise amount or a boolean.
 * Returns null when nothing is overdue.
 */
export function overdueInfo(overdue: unknown): { amount: number | null } | null {
  if (typeof overdue === "number") return overdue > 0 ? { amount: overdue } : null;
  if (overdue === true) return { amount: null };
  return null;
}

export function OverduePill({ overdue }: { overdue: unknown }) {
  const { t } = useI18n();
  const info = overdueInfo(overdue);
  if (!info) return null;
  return (
    <StatusPill tone="danger" icon={AlertTriangleIcon}>
      {info.amount !== null ? t("billing.creditBook.overdueAmount", { amount: money(info.amount) }) : t("billing.creditBook.overdue")}
    </StatusPill>
  );
}

export const LEDGER_TYPE: Record<LedgerEntryType, { icon: Icon; tone: string }> = {
  opening: { icon: BookOpenTextIcon, tone: "text-info-ink" },
  invoice: { icon: FileTextIcon, tone: "text-warning-ink" },
  payment: { icon: WalletIcon, tone: "text-success-ink" },
  receipt: { icon: HandCoinsIcon, tone: "text-success-ink" },
  cancel: { icon: BanIcon, tone: "text-muted-foreground" },
};

export const ledgerTypeMeta = (type: string) => LEDGER_TYPE[type as LedgerEntryType] ?? LEDGER_TYPE.opening;

/** WhatsApp/SMS text for a statement link, worded for due, advance or settled. */
export function statementMessage(t: Translator, v: { name: string; shop: string; balance: number; url: string }) {
  const side = balanceSide(v.balance);
  const key =
    side === "due"
      ? "billing.creditBook.statement.messageDue"
      : side === "advance"
        ? "billing.creditBook.statement.messageAdvance"
        : "billing.creditBook.statement.messageSettled";
  return t(key, { name: v.name, shop: v.shop, amount: money(Math.abs(v.balance)), url: v.url });
}

export const waLink = (phone: string | null | undefined, text: string) =>
  `https://wa.me/${whatsappNumber(phone) ?? ""}?text=${encodeURIComponent(text)}`;

/** Statement URL from the share response (falls back to this module's public page when the API omits `url`). */
export const statementUrl = (r: { token: string; url?: string }, publicUrl: (path: string) => string) => r.url || publicUrl(`s/${r.token}`);

/**
 * "Remind" action: asks the API to send the reminder (WhatsApp/SMS). If that fails (no provider,
 * no phone…), the error toast offers a wa.me fallback with a fresh statement link.
 */
export function useRemind() {
  const { t } = useI18n();
  const shop = useOptionalShop();
  const remind = useRemindCustomer();
  const share = useShareStatement();
  const publicUrl = usePublicUrl();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const viaWhatsapp = React.useCallback(
    async (customer: Pick<Customer, "id" | "name" | "phone">, balance: number) => {
      // Open the tab synchronously (inside the click) so popup blockers allow it, then point it at wa.me.
      const tab = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
      try {
        const r = await share.mutateAsync(customer.id);
        const text = statementMessage(t, { name: customer.name, shop: shop?.shopName ?? "", balance, url: statementUrl(r, publicUrl) });
        const href = waLink(customer.phone, text);
        if (tab) tab.location.href = href;
        else window.location.assign(href);
      } catch (err) {
        tab?.close();
        toast.error(describeError(err, t));
      }
    },
    [share, shop?.shopName, t, publicUrl],
  );

  const send = React.useCallback(
    (customer: Pick<Customer, "id" | "name" | "phone">, balance: number) => {
      setPendingId(customer.id);
      remind.mutate(
        { customerId: customer.id },
        {
          onSuccess: () => toast.success(t("billing.creditBook.remindSent", { name: customer.name })),
          onError: (err) =>
            toast.error(t("billing.creditBook.remindFailed", { reason: describeError(err, t) }), {
              duration: 10_000,
              action: { label: t("billing.creditBook.remindWhatsapp"), onClick: () => void viaWhatsapp(customer, balance) },
            }),
          onSettled: () => setPendingId(null),
        },
      );
    },
    [remind, t, viaWhatsapp],
  );

  return { send, pendingId, viaWhatsapp };
}
