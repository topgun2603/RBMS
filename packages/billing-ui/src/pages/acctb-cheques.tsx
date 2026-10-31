"use client";

import * as React from "react";
import { NotebookTabsIcon, PlusIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { describeError, QueryError, useI18n } from "@rbms/web";
import { AccountingPage, Panel, TableSkeleton } from "../components/accounting/parts";
import { BankAccountSelect, ChequeStatusPill, Figure, Signed } from "../components/accounting/part-b";
import { MoneyInput } from "../components/money-input";
import { ACC_BANK, useBankAccounts, useChequeAction, useChequeCandidates, useCheques, useSaveCheque, type Cheque } from "../lib/accounting-b";
import { useHasPermission } from "../lib/access";
import { money, rupeesToPaise, todayIST } from "../lib/format";

type Dir = "all" | "issued" | "received";
type Filter = "open" | "all" | "cleared" | "bounced";

/** Cheques written and received, post-dated ones included: deposit, clear, bounce (with the bank's charges). */
export default function AccountingChequesPage() {
  const { t, formatDate } = useI18n();
  const canBank = useHasPermission(ACC_BANK);
  const [dir, setDir] = React.useState<Dir>("all");
  const [filter, setFilter] = React.useState<Filter>("open");
  const list = useCheques({ direction: dir === "all" ? undefined : dir, status: filter === "open" ? "pending,deposited" : filter === "all" ? undefined : filter });
  const act = useChequeAction();
  const [adding, setAdding] = React.useState(false);
  const [bounce, setBounce] = React.useState<Cheque | null>(null);
  const [link, setLink] = React.useState<Cheque | null>(null);
  const d = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "numeric" });
  const today = list.data?.today ?? todayIST();

  const run = async (c: Cheque, action: "deposit" | "clear" | "cancel" | "reopen") => {
    try {
      await act.mutateAsync({ id: c.id, action });
      toast.success(t(`billing.acctb.cheque.done.${action}`));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <AccountingPage
      title={t("billing.acctb.nav.cheques")}
      description={t("billing.acctb.cheque.subtitle")}
      icon={NotebookTabsIcon}
      needsSetup={false}
      actions={
        canBank ? (
          <Button size="lg" onClick={() => setAdding(true)}>
            <PlusIcon /> {t("billing.acctb.cheque.add")}
          </Button>
        ) : undefined
      }
    >
      {list.data && (
        <div className="mb-section grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Figure label={t("billing.acctb.cheque.dueToDeposit")} tone={list.data.summary.dueToDeposit ? "warning" : undefined}>
            {list.data.summary.dueToDeposit}
          </Figure>
          <Figure label={t("billing.acctb.cheque.postDated")}>{list.data.summary.postDated}</Figure>
          <Figure label={t("billing.acctb.cheque.uncleared")}>{list.data.summary.uncleared}</Figure>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ChipGroup
          size="sm"
          aria-label={t("billing.acctb.cheque.direction")}
          value={dir}
          onChange={setDir}
          options={[
            { value: "all" as const, label: t("billing.accounting.all") },
            { value: "issued" as const, label: t("billing.acctb.cheque.issued") },
            { value: "received" as const, label: t("billing.acctb.cheque.received") },
          ]}
        />
        <ChipGroup
          size="sm"
          aria-label={t("billing.acctb.cheque.show")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open" as const, label: t("billing.acctb.cheque.notCleared") },
            { value: "cleared" as const, label: t("billing.acctb.cheque.status.cleared") },
            { value: "bounced" as const, label: t("billing.acctb.cheque.status.bounced") },
            { value: "all" as const, label: t("billing.acctb.cheque.anyStatus") },
          ]}
        />
      </div>

      {list.isError && !list.data ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <TableSkeleton />
      ) : !list.data.items.length ? (
        <EmptyState className="border-0 bg-transparent" icon={NotebookTabsIcon} title={t("billing.acctb.cheque.noneTitle")} description={t("billing.acctb.cheque.noneBody")} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.acctb.cheque.no")}</TableHead>
                  <TableHead>{t("billing.accounting.date")}</TableHead>
                  <TableHead>{t("billing.acctb.cheque.party")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.amount")}</TableHead>
                  <TableHead>{t("billing.acctb.cheque.statusLabel")}</TableHead>
                  <TableHead className="w-64" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">
                      {c.chequeNo}
                      <span className="block font-sans text-meta text-muted-foreground">{t(`billing.acctb.cheque.${c.direction}`)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {d(c.chequeDate)}
                      {c.chequeDate > today && (c.status === "pending" || c.status === "deposited") && (
                        <span className="ml-1">
                          <StatusPill tone="info">{t("billing.acctb.cheque.pdc")}</StatusPill>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56">
                      <span className="block truncate">{c.partyName || "-"}</span>
                      {c.drawnOn && <span className="block truncate text-meta text-muted-foreground">{c.drawnOn}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Signed v={c.direction === "received" ? c.amount : -c.amount} />
                    </TableCell>
                    <TableCell>
                      <ChequeStatusPill status={c.status} />
                      {c.status === "bounced" && c.bounceCharges > 0 && <span className="block text-meta text-muted-foreground">{t("billing.acctb.cheque.charges", { amount: money(c.bounceCharges) })}</span>}
                      {!c.acctLineId && (c.status === "pending" || c.status === "deposited") && <span className="block text-meta text-muted-foreground">{t("billing.acctb.cheque.notLinked")}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canBank && (
                        <span className="flex flex-wrap justify-end gap-1">
                          {c.direction === "received" && c.status === "pending" && (
                            <Button size="sm" variant="outline" onClick={() => void run(c, "deposit")}>
                              {t("billing.acctb.cheque.deposit")}
                            </Button>
                          )}
                          {(c.status === "pending" || c.status === "deposited") && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => void run(c, "clear")}>
                                {t("billing.acctb.cheque.clear")}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setBounce(c)}>
                                {t("billing.acctb.cheque.bounce")}
                              </Button>
                              {!c.acctLineId && (
                                <Button size="sm" variant="ghost" onClick={() => setLink(c)}>
                                  {t("billing.acctb.cheque.link")}
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => void run(c, "cancel")}>
                                {t("billing.common.cancel")}
                              </Button>
                            </>
                          )}
                          {(c.status === "cancelled" || c.status === "bounced") && (
                            <Button size="sm" variant="ghost" onClick={() => void run(c, "reopen")}>
                              {t("billing.acctb.cheque.reopen")}
                            </Button>
                          )}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
      <p className="mt-4 text-meta text-muted-foreground">{t("billing.acctb.cheque.hint")}</p>
      <AddChequeDialog open={adding} onClose={() => setAdding(false)} />
      <BounceDialog cheque={bounce} onClose={() => setBounce(null)} />
      <LinkDialog cheque={link} onClose={() => setLink(null)} />
    </AccountingPage>
  );
}

function AddChequeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const accounts = useBankAccounts();
  const save = useSaveCheque();
  const [direction, setDirection] = React.useState<"issued" | "received">("received");
  const [accountId, setAccountId] = React.useState("");
  const [no, setNo] = React.useState("");
  const [date, setDate] = React.useState(todayIST());
  const [amount, setAmount] = React.useState("");
  const [party, setParty] = React.useState("");
  const [drawnOn, setDrawnOn] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    setNo("");
    setAmount("");
    setParty("");
    setDrawnOn("");
    setDate(todayIST());
    if (!accountId && accounts.data?.[0]) setAccountId(accounts.data[0].id);
  }, [open, accounts.data, accountId]);
  const paise = rupeesToPaise(amount) ?? 0;
  const submit = async () => {
    try {
      await save.mutateAsync({ body: { direction, accountId, chequeNo: no.trim(), chequeDate: date, amount: paise, partyName: party.trim(), drawnOn: drawnOn.trim() || null } });
      toast.success(t("billing.acctb.cheque.added"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.cheque.add")}</DialogTitle>
          <DialogDescription>{t("billing.acctb.cheque.addBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <ChipGroup
              size="sm"
              aria-label={t("billing.acctb.cheque.direction")}
              value={direction}
              onChange={setDirection}
              options={[
                { value: "received" as const, label: t("billing.acctb.cheque.received") },
                { value: "issued" as const, label: t("billing.acctb.cheque.issued") },
              ]}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>{t("billing.acctb.bankAccount")}</Label>
            <BankAccountSelect value={accountId} onChange={setAccountId} accounts={accounts.data ?? []} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cq-no">{t("billing.acctb.cheque.no")}</Label>
            <Input id="cq-no" inputMode="numeric" maxLength={20} value={no} onChange={(e) => setNo(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cq-date">{t("billing.acctb.cheque.date")}</Label>
            <Input id="cq-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cq-amt">{t("billing.accounting.amount")}</Label>
            <MoneyInput id="cq-amt" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cq-party">{direction === "received" ? t("billing.acctb.cheque.from") : t("billing.acctb.cheque.to")}</Label>
            <Input id="cq-party" maxLength={120} value={party} onChange={(e) => setParty(e.target.value)} />
          </div>
          {direction === "received" && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="cq-bank">{t("billing.acctb.cheque.drawnOn")}</Label>
              <Input id="cq-bank" maxLength={80} value={drawnOn} onChange={(e) => setDrawnOn(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={save.isPending || !no.trim() || paise <= 0 || !accountId}>
            {t("billing.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BounceDialog({ cheque, onClose }: { cheque: Cheque | null; onClose: () => void }) {
  const { t } = useI18n();
  const act = useChequeAction();
  const [date, setDate] = React.useState(todayIST());
  const [reason, setReason] = React.useState("");
  const [charges, setCharges] = React.useState("");
  React.useEffect(() => {
    if (cheque) {
      setDate(todayIST());
      setReason("");
      setCharges("");
    }
  }, [cheque]);
  const [fix, setFix] = React.useState<string | null>(null);
  const submit = async () => {
    if (!cheque) return;
    try {
      const r = await act.mutateAsync({ id: cheque.id, action: "bounce", date, reason: reason.trim() || null, charges: rupeesToPaise(charges) ?? 0 });
      toast.success(t("billing.acctb.cheque.done.bounce"));
      if (r.sourceFix) setFix(r.sourceFix.number);
      else onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!cheque} onOpenChange={(o) => !o && !act.isPending && (setFix(null), onClose())}>
      <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.cheque.bounceTitle", { no: cheque?.chequeNo ?? "" })}</DialogTitle>
          <DialogDescription>{t("billing.acctb.cheque.bounceBody")}</DialogDescription>
        </DialogHeader>
        {fix ? (
          <Alert variant="warning">
            <AlertDescription>{t("billing.acctb.cheque.fixSource", { number: fix })}</AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bc-date">{t("billing.accounting.date")}</Label>
              <Input id="bc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bc-why">{t("billing.acctb.cheque.reason")}</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="bc-why" className="w-full">
                  <SelectValue placeholder={t("billing.acctb.cheque.reasonPick")} />
                </SelectTrigger>
                <SelectContent>
                  {(["funds", "signature", "stale", "stopped", "other"] as const).map((r) => (
                    <SelectItem key={r} value={t(`billing.acctb.cheque.reasons.${r}`)}>
                      {t(`billing.acctb.cheque.reasons.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bc-chg">{t("billing.acctb.cheque.bankCharges")}</Label>
              <MoneyInput id="bc-chg" value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="0" />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          {fix ? (
            <Button onClick={() => (setFix(null), onClose())}>{t("billing.common.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                {t("billing.common.cancel")}
              </Button>
              <Button variant="destructive" onClick={submit} disabled={act.isPending}>
                {t("billing.acctb.cheque.bounce")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ cheque, onClose }: { cheque: Cheque | null; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const cands = useChequeCandidates(cheque?.id ?? null);
  const save = useSaveCheque();
  const pick = async (lineId: string) => {
    if (!cheque) return;
    try {
      await save.mutateAsync({ id: cheque.id, body: { acctLineId: lineId } as Partial<Cheque> });
      toast.success(t("billing.acctb.cheque.linked"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!cheque} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.cheque.linkTitle")}</DialogTitle>
          <DialogDescription>{t("billing.acctb.cheque.linkBody")}</DialogDescription>
        </DialogHeader>
        {cands.isPending ? (
          <TableSkeleton />
        ) : !cands.data?.length ? (
          <p className="text-meta text-muted-foreground">{t("billing.acctb.cheque.noCandidates")}</p>
        ) : (
          <ul className="grid gap-2">
            {cands.data.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{l.narration}</span>
                  <span className="block text-meta text-muted-foreground">
                    {formatDate(l.date, { day: "numeric", month: "short" })} · {l.number}
                  </span>
                </span>
                <Button size="sm" onClick={() => void pick(l.id)} disabled={save.isPending}>
                  {t("billing.acctb.cheque.thisOne")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
