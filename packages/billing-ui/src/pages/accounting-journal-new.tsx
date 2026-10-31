"use client";

import * as React from "react";
import { ArrowLeftRightIcon, FilePlus2Icon, HandCoinsIcon, NotebookPenIcon, PlusIcon, Trash2Icon, WalletIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Card, CardContent, ChipGroup, EmptyState, Input, Label, Textarea, toast } from "@rbms/ui";
import { describeError, ModuleLink, useI18n, useModuleNavigate } from "@rbms/web";
import { AccountSelect, AccountingPage } from "../components/accounting/parts";
import { MoneyInput } from "../components/money-input";
import { ACC_POST, useAccounts, useCreateEntry, type EntryInput } from "../lib/accounting";
import { useHasPermission } from "../lib/access";
import { money, rupeesToPaise, todayIST } from "../lib/format";

type Kind = "payment" | "receipt" | "contra" | "journal";
interface Row {
  key: number;
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}
const blankRow = (key: number): Row => ({ key, accountId: "", debit: "", credit: "", memo: "" });

/** New entry: money paid out, money received, cash to bank, or a journal voucher for the accountant. */
export default function AccountingJournalNewPage() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const canPost = useHasPermission(ACC_POST);
  const accounts = useAccounts(false);
  const create = useCreateEntry();

  const [kind, setKind] = React.useState<Kind>("payment");
  const [date, setDate] = React.useState(todayIST());
  const [narration, setNarration] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [moneyAccount, setMoneyAccount] = React.useState("");
  const [other, setOther] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([blankRow(1), blankRow(2)]);
  const nextKey = React.useRef(3);

  const list = accounts.data ?? [];
  const isMoney = (a: { isCash: boolean; isBank: boolean }) => a.isCash || a.isBank;
  React.useEffect(() => {
    // The first cash account is a sensible default for "paid from" / "received in" / "from".
    if (!moneyAccount && list.length) setMoneyAccount(list.find((a) => a.key === "cash")?.id ?? list.find(isMoney)?.id ?? "");
  }, [list, moneyAccount]);
  React.useEffect(() => setOther(""), [kind]);

  if (!canPost) {
    return (
      <AccountingPage title={t("billing.accounting.nav.newEntry")} icon={FilePlus2Icon} needsSetup={false}>
        <EmptyState title={t("billing.accounting.noPostTitle")} description={t("billing.accounting.noPostBody")} />
      </AccountingPage>
    );
  }

  const paise = rupeesToPaise(amount) ?? 0;
  const jDebit = rows.reduce((s, r) => s + (rupeesToPaise(r.debit) ?? 0), 0);
  const jCredit = rows.reduce((s, r) => s + (rupeesToPaise(r.credit) ?? 0), 0);
  const jOk = jDebit > 0 && jDebit === jCredit && rows.filter((r) => r.accountId && ((rupeesToPaise(r.debit) ?? 0) > 0 || (rupeesToPaise(r.credit) ?? 0) > 0)).length >= 2 && rows.every((r) => !(rupeesToPaise(r.debit) && rupeesToPaise(r.credit)));
  const simpleOk = kind !== "journal" && paise > 0 && !!moneyAccount && !!other && moneyAccount !== other;
  const ready = narration.trim().length > 0 && (kind === "journal" ? jOk : simpleOk);

  const submit = async () => {
    const body: EntryInput =
      kind === "journal"
        ? {
            voucherType: "journal",
            date,
            narration: narration.trim(),
            reference: reference.trim() || null,
            lines: rows
              .filter((r) => r.accountId && ((rupeesToPaise(r.debit) ?? 0) > 0 || (rupeesToPaise(r.credit) ?? 0) > 0))
              .map((r) => ({ accountId: r.accountId, debit: rupeesToPaise(r.debit) ?? 0, credit: rupeesToPaise(r.credit) ?? 0, memo: r.memo.trim() || null })),
          }
        : { voucherType: kind, date, narration: narration.trim(), reference: reference.trim() || null, simple: { accountId: moneyAccount, otherAccountId: other, amount: paise } };
    try {
      const e = await create.mutateAsync(body);
      toast.success(t("billing.accounting.new.posted", { number: e.number }));
      navigate(`accounting/journal`);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const labels = {
    payment: { money: "billing.accounting.new.paidFrom", other: "billing.accounting.new.paidFor" },
    receipt: { money: "billing.accounting.new.receivedIn", other: "billing.accounting.new.receivedFor" },
    contra: { money: "billing.accounting.new.moveFrom", other: "billing.accounting.new.moveTo" },
  } as const;
  const otherFilter = (a: { isCash: boolean; isBank: boolean; type: string }) => (kind === "contra" ? isMoney(a) : !isMoney(a));

  return (
    <AccountingPage title={t("billing.accounting.nav.newEntry")} description={t("billing.accounting.new.subtitle")} icon={FilePlus2Icon} needsSetup={false}>
      <div className="mx-auto grid max-w-3xl gap-5">
        <ChipGroup
          aria-label={t("billing.accounting.new.kind")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "payment", label: t("billing.accounting.voucher.payment") },
            { value: "receipt", label: t("billing.accounting.voucher.receipt") },
            { value: "contra", label: t("billing.accounting.voucher.contra") },
            { value: "journal", label: t("billing.accounting.voucher.journal") },
          ]}
        />
        <p className="flex items-start gap-2 text-meta text-muted-foreground">
          {kind === "payment" ? <WalletIcon className="mt-0.5 size-4 shrink-0" /> : kind === "receipt" ? <HandCoinsIcon className="mt-0.5 size-4 shrink-0" /> : kind === "contra" ? <ArrowLeftRightIcon className="mt-0.5 size-4 shrink-0" /> : <NotebookPenIcon className="mt-0.5 size-4 shrink-0" />}
          {t(`billing.accounting.new.about.${kind}`)}
        </p>

        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="je-date">{t("billing.accounting.date")}</Label>
                <Input id="je-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="je-ref">{t("billing.accounting.new.reference")}</Label>
                <Input id="je-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} placeholder={t("billing.accounting.new.referencePlaceholder")} />
              </div>
            </div>

            {kind !== "journal" ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="je-money">{t(labels[kind].money)}</Label>
                    <AccountSelect id="je-money" value={moneyAccount} onChange={setMoneyAccount} accounts={list} filter={isMoney} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="je-other">{t(labels[kind].other)}</Label>
                    <AccountSelect id="je-other" value={other} onChange={setOther} accounts={list} filter={otherFilter} />
                  </div>
                </div>
                <div className="grid gap-1.5 sm:max-w-xs">
                  <Label htmlFor="je-amount">{t("billing.accounting.amount")}</Label>
                  <MoneyInput id="je-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="text-lg font-semibold" />
                </div>
              </>
            ) : (
              <div className="grid gap-3">
                <div className="hidden gap-2 text-meta font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_9rem_9rem_2.5rem]">
                  <span>{t("billing.accounting.account")}</span>
                  <span className="text-right">{t("billing.accounting.debit")}</span>
                  <span className="text-right">{t("billing.accounting.credit")}</span>
                  <span />
                </div>
                {rows.map((r) => (
                  <div key={r.key} className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_2.5rem]">
                    <AccountSelect aria-label={t("billing.accounting.account")} value={r.accountId} onChange={(v) => setRow(r.key, { accountId: v })} accounts={list} />
                    <MoneyInput aria-label={t("billing.accounting.debit")} placeholder={t("billing.accounting.debit")} value={r.debit} onChange={(e) => setRow(r.key, { debit: e.target.value, credit: e.target.value ? "" : r.credit })} />
                    <MoneyInput aria-label={t("billing.accounting.credit")} placeholder={t("billing.accounting.credit")} value={r.credit} onChange={(e) => setRow(r.key, { credit: e.target.value, debit: e.target.value ? "" : r.debit })} />
                    <Button type="button" variant="ghost" size="icon" aria-label={t("billing.common.delete")} disabled={rows.length <= 2} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, blankRow(nextKey.current++)])}>
                    <PlusIcon /> {t("billing.accounting.new.addLine")}
                  </Button>
                  <p className={jDebit === jCredit && jDebit > 0 ? "text-meta text-success-ink" : "text-meta text-warning-ink"} role="status">
                    {t("billing.accounting.new.totals", { debit: money(jDebit), credit: money(jCredit) })}
                    {jDebit !== jCredit && ` · ${t("billing.accounting.new.difference", { amount: money(Math.abs(jDebit - jCredit)) })}`}
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="je-narration">{t("billing.accounting.new.narration")}</Label>
              <Textarea id="je-narration" rows={2} maxLength={500} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder={t("billing.accounting.new.narrationPlaceholder")} />
            </div>

            {kind !== "journal" && simpleOk && (
              <Alert>
                <AlertDescription>
                  {t(`billing.accounting.new.preview.${kind}`, {
                    amount: money(paise),
                    from: list.find((a) => a.id === (kind === "contra" ? moneyAccount : kind === "payment" ? moneyAccount : other))?.name ?? "",
                    to: list.find((a) => a.id === (kind === "contra" ? other : kind === "payment" ? other : moneyAccount))?.name ?? "",
                  })}
                </AlertDescription>
              </Alert>
            )}
            <p className="text-meta text-muted-foreground">{t("billing.accounting.new.lockedNote")}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild variant="outline">
                <ModuleLink to="accounting/journal">{t("billing.common.cancel")}</ModuleLink>
              </Button>
              <Button type="button" onClick={submit} disabled={!ready || create.isPending}>
                {t("billing.accounting.new.post")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AccountingPage>
  );
}
