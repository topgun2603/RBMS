"use client";

import * as React from "react";
import { Card, CardContent, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { money } from "../../lib/format";
import type { BankAccountRow, ChequeStatus } from "../../lib/accounting-b";

/** A signed amount: money in (+) and money out (-) with words, not colour alone. */
export function Signed({ v, className }: { v: number; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={className}>
      <span className={v < 0 ? "tabular-nums text-danger-ink" : "tabular-nums text-success-ink"}>{money(Math.abs(v))}</span>
      <span className="ml-1 text-xs text-muted-foreground">{v < 0 ? t("billing.acctb.out") : t("billing.acctb.in")}</span>
    </span>
  );
}

/** Pick one of the shop's bank accounts. */
export function BankAccountSelect({ value, onChange, accounts, id }: { value: string; onChange: (id: string) => void; accounts: BankAccountRow[]; id?: string }) {
  const { t } = useI18n();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full sm:w-72" aria-label={t("billing.acctb.bankAccount")}>
        <SelectValue placeholder={t("billing.acctb.pickBank")} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
            {a.bankAccountLast4 ? ` ·${a.bankAccountLast4}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A small figure with a label (summary rows on the Part B screens). */
export function Figure({ label, children, hint, tone }: { label: string; children: React.ReactNode; hint?: string; tone?: "warning" | "success" }) {
  return (
    <Card className="min-w-0">
      <CardContent className="py-3">
        <p className="text-meta text-muted-foreground">{label}</p>
        <div className={`font-heading text-base font-semibold sm:text-lg ${tone === "warning" ? "text-warning-ink" : tone === "success" ? "text-success-ink" : ""}`}>{children}</div>
        {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const CHEQUE_TONE: Record<ChequeStatus, StatusTone> = { pending: "info", deposited: "warning", cleared: "success", bounced: "danger", cancelled: "neutral" };
export function ChequeStatusPill({ status }: { status: ChequeStatus }) {
  const { t } = useI18n();
  return <StatusPill tone={CHEQUE_TONE[status]}>{t(`billing.acctb.cheque.status.${status}`)}</StatusPill>;
}

/** The account selected in the URL (?accountId=) or the first bank account. */
export function useBankAccountParam(accounts: BankAccountRow[] | undefined): [string, (id: string) => void] {
  const [accountId, setAccountId] = React.useState("");
  React.useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("accountId");
    if (fromUrl) setAccountId(fromUrl);
  }, []);
  React.useEffect(() => {
    if (!accountId && accounts?.length) setAccountId(accounts[0]!.id);
  }, [accountId, accounts]);
  return [accountId, setAccountId];
}
