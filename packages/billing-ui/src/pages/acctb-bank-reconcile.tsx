"use client";

import * as React from "react";
import { CheckCheckIcon, FileUpIcon, GitCompareArrowsIcon, Link2Icon, PlusIcon, ScrollTextIcon, SparklesIcon, Undo2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@srirealtime/ui";
import { describeError, ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { AccountSelect, AccountingPage, TableSkeleton } from "../components/accounting/parts";
import { BankAccountSelect, Signed, useBankAccountParam } from "../components/accounting/part-b";
import { useAccounts } from "../lib/accounting";
import {
  ACC_BANK,
  useAutoMatch,
  useBankAccounts,
  useCreateFromLine,
  useExcludeLine,
  useMatch,
  useMatchedGroups,
  useUnmatch,
  useWorkspace,
  type BankLine,
  type BookLine,
  type Suggestion,
} from "../lib/accounting-b";
import { useHasPermission } from "../lib/access";
import { money } from "../lib/format";

const PRESETS = ["bank_charges", "interest_received", "interest_paid", "other_income", "other_expense", "drawings", "capital", "cash_deposit", "cash_withdrawal", "account"] as const;

/** Match statement lines with the books: suggestions, click (or drag) to match, entries for what is missing. */
export default function AccountingBankReconcilePage() {
  const { t, formatDate } = useI18n();
  const canBank = useHasPermission(ACC_BANK);
  const accounts = useBankAccounts();
  const [accountId, setAccountId] = useBankAccountParam(accounts.data);
  const ws = useWorkspace(accountId);
  const [tab, setTab] = React.useState("open");
  const matched = useMatchedGroups(accountId, tab === "matched");
  const allAccounts = useAccounts(false);
  const match = useMatch();
  const auto = useAutoMatch();
  const unmatch = useUnmatch();
  const exclude = useExcludeLine();
  const [pickBank, setPickBank] = React.useState<Set<string>>(new Set());
  const [pickBook, setPickBook] = React.useState<Set<string>>(new Set());
  const [diffAccount, setDiffAccount] = React.useState("");
  const [entryFor, setEntryFor] = React.useState<BankLine | null>(null);
  const [q, setQ] = React.useState("");
  const [drag, setDrag] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPickBank(new Set());
    setPickBook(new Set());
  }, [accountId, ws.data]);

  const d = (s: string) => formatDate(s, { day: "numeric", month: "short" });
  const bankById = new Map((ws.data?.bankLines ?? []).map((b) => [b.id, b]));
  const bookById = new Map((ws.data?.bookLines ?? []).map((b) => [b.id, b]));
  const suggestionFor = new Map<string, Suggestion>();
  for (const s of ws.data?.suggestions ?? []) for (const id of [...s.bankIds, ...s.bookIds]) suggestionFor.set(id, s);
  const filt = (text: string, amount: number) => !q || text.toLowerCase().includes(q.toLowerCase()) || money(Math.abs(amount)).includes(q);
  const bankLines = (ws.data?.bankLines ?? []).filter((b) => filt(`${b.narration} ${b.reference ?? ""}`, b.amount));
  const bookLines = (ws.data?.bookLines ?? []).filter((b) => filt(`${b.narration} ${b.number} ${b.chequeNo ?? ""}`, b.amount));
  const bankSum = [...pickBank].reduce((s, id) => s + (bankById.get(id)?.amount ?? 0), 0);
  const bookSum = [...pickBook].reduce((s, id) => s + (bookById.get(id)?.amount ?? 0), 0);
  const diff = bankSum - bookSum;
  const ready = pickBank.size + pickBook.size >= 2 && (diff === 0 || (pickBank.size > 0 && !!diffAccount));

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };
  const doMatch = async (bankLineIds: string[], bookLineIds: string[], withDiff = false) => {
    try {
      await match.mutateAsync({ accountId, bankLineIds, bookLineIds, differenceAccountId: withDiff ? diffAccount : null });
      toast.success(t("billing.acctb.rec.matched"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const acceptAll = async () => {
    try {
      const r = await auto.mutateAsync({ accountId, minConfidence: 85 });
      toast.success(t("billing.acctb.rec.autoDone", { count: r.matched }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const high = (ws.data?.suggestions ?? []).filter((s) => s.confidence >= 85).length;

  return (
    <AccountingPage
      title={t("billing.acctb.rec.title")}
      description={t("billing.acctb.rec.subtitle")}
      icon={GitCompareArrowsIcon}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" asChild>
            <ModuleLink to={`accounting/bank/statement?accountId=${accountId}`}>
              <ScrollTextIcon /> {t("billing.acctb.bank.statement")}
            </ModuleLink>
          </Button>
          {canBank && (
            <Button variant="outline" size="lg" asChild>
              <ModuleLink to={`accounting/bank/import?accountId=${accountId}`}>
                <FileUpIcon /> {t("billing.acctb.bank.import")}
              </ModuleLink>
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <BankAccountSelect value={accountId} onChange={setAccountId} accounts={accounts.data ?? []} />
        {ws.data && (
          <span className="flex flex-wrap gap-2">
            <StatusPill tone={ws.data.summary.open ? "warning" : "success"}>{t("billing.acctb.rec.openCount", { count: ws.data.summary.open })}</StatusPill>
            <StatusPill tone="neutral">{t("billing.acctb.rec.matchedCount", { count: ws.data.summary.matched })}</StatusPill>
          </span>
        )}
        <Input className="w-full sm:ml-auto sm:w-64" placeholder={t("billing.acctb.rec.search")} aria-label={t("billing.acctb.rec.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="open">{t("billing.acctb.rec.tabOpen")}</TabsTrigger>
          <TabsTrigger value="matched">{t("billing.acctb.rec.tabMatched")}</TabsTrigger>
        </TabsList>

        <TabsContent value="open">
          {ws.isError && !ws.data ? (
            <QueryError error={ws.error} onRetry={() => void ws.refetch()} />
          ) : ws.isPending || !ws.data ? (
            <TableSkeleton />
          ) : ws.data.bankLines.length === 0 && ws.data.summary.matched === 0 ? (
            <EmptyState
              icon={FileUpIcon}
              title={t("billing.acctb.rec.noLinesTitle")}
              description={t("billing.acctb.rec.noLinesBody")}
              action={
                canBank ? (
                  <Button asChild>
                    <ModuleLink to={`accounting/bank/import?accountId=${accountId}`}>{t("billing.acctb.bank.import")}</ModuleLink>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {ws.data.suggestions.length > 0 && (
                <Card>
                  <CardContent className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 font-medium">
                        <SparklesIcon className="size-4 text-primary" /> {t("billing.acctb.rec.suggestions", { count: ws.data.suggestions.length })}
                      </p>
                      {canBank && high > 0 && (
                        <Button size="sm" onClick={acceptAll} disabled={auto.isPending}>
                          <CheckCheckIcon /> {t("billing.acctb.rec.acceptAll", { count: high })}
                        </Button>
                      )}
                    </div>
                    <ul className="grid gap-2">
                      {ws.data.suggestions.slice(0, 8).map((s) => (
                        <li key={[...s.bankIds, ...s.bookIds].join()} className="grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                          <div className="min-w-0 text-sm">
                            {s.bankIds.map((id) => bankById.get(id)).filter(Boolean).map((b) => (
                              <p key={b!.id} className="truncate">
                                <span className="text-muted-foreground">{t("billing.acctb.rec.bankSide")}:</span> {d(b!.date)} · {b!.narration} · <Signed v={b!.amount} />
                              </p>
                            ))}
                            {s.bookIds.map((id) => bookById.get(id)).filter(Boolean).map((b) => (
                              <p key={b!.id} className="truncate">
                                <span className="text-muted-foreground">{t("billing.acctb.rec.bookSide")}:</span> {d(b!.date)} · {b!.number} · {b!.narration} · <Signed v={b!.amount} />
                              </p>
                            ))}
                            <p className="text-meta text-muted-foreground">{s.reasons.join(" · ")}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill tone={s.confidence >= 85 ? "success" : "warning"}>{t("billing.acctb.rec.confidence", { n: s.confidence })}</StatusPill>
                            {canBank && (
                              <Button size="sm" variant="outline" onClick={() => void doMatch(s.bankIds, s.bookIds)} disabled={match.isPending}>
                                {t("billing.acctb.rec.accept")}
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <p className="text-meta text-muted-foreground">{t("billing.acctb.rec.howTo")}</p>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Side title={t("billing.acctb.rec.statementLines")} count={bankLines.length}>
                  {bankLines.length === 0 ? (
                    <p className="p-4 text-center text-meta text-muted-foreground">{t("billing.acctb.rec.allMatched")}</p>
                  ) : (
                    bankLines.map((b) => (
                      <LineRow
                        key={b.id}
                        checked={pickBank.has(b.id)}
                        onToggle={() => toggle(pickBank, b.id, setPickBank)}
                        date={d(b.date)}
                        title={b.narration || t("billing.acctb.rec.noNarration")}
                        meta={b.reference ?? ""}
                        amount={b.amount}
                        suggested={suggestionFor.has(b.id)}
                        draggable={canBank}
                        onDragStart={() => setDrag(b.id)}
                        actions={
                          canBank ? (
                            <span className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setEntryFor(b)} aria-label={t("billing.acctb.rec.addEntry")}>
                                <PlusIcon /> <span className="hidden sm:inline">{t("billing.acctb.rec.addEntry")}</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void exclude
                                    .mutateAsync({ lineId: b.id, excluded: true })
                                    .then(() => toast.success(t("billing.acctb.rec.leftOut")))
                                    .catch((err) => toast.error(describeError(err, t)))
                                }
                              >
                                {t("billing.acctb.rec.leaveOut")}
                              </Button>
                            </span>
                          ) : undefined
                        }
                      />
                    ))
                  )}
                </Side>
                <Side title={t("billing.acctb.rec.bookEntries")} count={bookLines.length}>
                  {bookLines.length === 0 ? (
                    <p className="p-4 text-center text-meta text-muted-foreground">{t("billing.acctb.rec.noBook")}</p>
                  ) : (
                    bookLines.map((b) => (
                      <LineRow
                        key={b.id}
                        checked={pickBook.has(b.id)}
                        onToggle={() => toggle(pickBook, b.id, setPickBook)}
                        date={d(b.date)}
                        title={b.narration}
                        meta={[b.number, b.chequeNo ? t("billing.acctb.rec.chequeNo", { no: b.chequeNo }) : null].filter(Boolean).join(" · ")}
                        amount={b.amount}
                        suggested={suggestionFor.has(b.id)}
                        onDrop={
                          canBank && drag
                            ? () => {
                                const from = drag;
                                setDrag(null);
                                void doMatch([from], [b.id]);
                              }
                            : undefined
                        }
                      />
                    ))
                  )}
                </Side>
              </div>

              {canBank && pickBank.size + pickBook.size > 0 && (
                <div className="sticky bottom-2 z-10 grid grid-cols-1 gap-3 rounded-2xl border bg-card p-3 shadow-lg sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block text-meta text-muted-foreground">{t("billing.acctb.rec.bankSide")}</span>
                      <Signed v={bankSum} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-meta text-muted-foreground">{t("billing.acctb.rec.bookSide")}</span>
                      <Signed v={bookSum} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-meta text-muted-foreground">{t("billing.acctb.rec.difference")}</span>
                      <span className={diff === 0 ? "font-semibold text-success-ink" : "font-semibold text-warning-ink"}>{money(Math.abs(diff))}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {diff !== 0 && pickBank.size > 0 && (
                      <div className="w-full sm:w-56">
                        <AccountSelect
                          value={diffAccount}
                          onChange={setDiffAccount}
                          accounts={allAccounts.data ?? []}
                          filter={(a) => !a.isBank && !a.isCash && (a.type === "expense" || a.type === "income")}
                          placeholder={t("billing.acctb.rec.diffTo")}
                          aria-label={t("billing.acctb.rec.diffTo")}
                        />
                      </div>
                    )}
                    <Button variant="ghost" onClick={() => (setPickBank(new Set()), setPickBook(new Set()))}>
                      {t("billing.common.cancel")}
                    </Button>
                    <Button onClick={() => void doMatch([...pickBank], [...pickBook], diff !== 0)} disabled={!ready || match.isPending}>
                      <Link2Icon /> {diff === 0 ? t("billing.acctb.rec.match") : t("billing.acctb.rec.matchWithDiff")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="matched">
          {matched.isPending ? (
            <TableSkeleton />
          ) : !matched.data?.length ? (
            <EmptyState className="border-0 bg-transparent" title={t("billing.acctb.rec.noMatchedTitle")} description={t("billing.acctb.rec.noMatchedBody")} />
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {matched.data.map((g) => (
                <li key={g.groupId} className="grid grid-cols-1 gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0 text-sm">
                    {g.bankLines.map((b) => (
                      <p key={b.id} className="truncate">
                        <span className="text-muted-foreground">{t("billing.acctb.rec.bankSide")}:</span> {d(b.date)} · {b.narration} · <Signed v={b.amount} />
                      </p>
                    ))}
                    {g.bookLines.map((b) => (
                      <p key={b.id} className="truncate">
                        <span className="text-muted-foreground">{t("billing.acctb.rec.bookSide")}:</span> {d(b.date)} · {b.number} · {b.narration} · <Signed v={b.amount} />
                      </p>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={g.reconciled ? "success" : "neutral"}>{g.reconciled ? t("billing.acctb.rec.confirmed") : t(`billing.acctb.rec.method.${g.method === "auto" || g.method === "created" ? g.method : "manual"}`)}</StatusPill>
                    {canBank && !g.reconciled && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void unmatch
                            .mutateAsync(g.groupId)
                            .then(() => toast.success(t("billing.acctb.rec.unmatched")))
                            .catch((err) => toast.error(describeError(err, t)))
                        }
                      >
                        <Undo2Icon /> {t("billing.acctb.rec.unmatch")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      <EntryFromLineDialog line={entryFor} onClose={() => setEntryFor(null)} />
    </AccountingPage>
  );
}

function Side({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardContent className="px-0 sm:px-0">
        <p className="flex items-center justify-between border-b px-4 pb-2 font-medium">
          {title} <span className="text-meta text-muted-foreground">{count}</span>
        </p>
        <div className="max-h-[32rem] divide-y overflow-y-auto">{children}</div>
      </CardContent>
    </Card>
  );
}

function LineRow(p: {
  checked: boolean;
  onToggle: () => void;
  date: string;
  title: string;
  meta: string;
  amount: number;
  suggested: boolean;
  actions?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: () => void;
  onDrop?: () => void;
}) {
  const { t } = useI18n();
  const [over, setOver] = React.useState(false);
  return (
    <div
      className={`flex min-w-0 items-start gap-3 px-4 py-2 ${p.checked ? "bg-primary/5" : ""} ${over ? "ring-2 ring-primary ring-inset" : ""}`}
      draggable={p.draggable}
      onDragStart={p.onDragStart}
      onDragOver={p.onDrop ? (e) => (e.preventDefault(), setOver(true)) : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={p.onDrop ? (e) => (e.preventDefault(), setOver(false), p.onDrop!()) : undefined}
    >
      <Checkbox className="mt-1" checked={p.checked} onCheckedChange={p.onToggle} aria-label={t("billing.acctb.rec.select")} />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={p.onToggle}>
        <span className="block truncate text-sm font-medium">{p.title}</span>
        <span className="block truncate text-meta text-muted-foreground">
          {p.date}
          {p.meta ? ` · ${p.meta}` : ""}
          {p.suggested ? ` · ${t("billing.acctb.rec.hasSuggestion")}` : ""}
        </span>
      </button>
      <span className="shrink-0 text-right text-sm">
        <Signed v={p.amount} />
        {p.actions && <span className="mt-1 block">{p.actions}</span>}
      </span>
    </div>
  );
}

function EntryFromLineDialog({ line, onClose }: { line: BankLine | null; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const accounts = useAccounts(false);
  const create = useCreateFromLine();
  const [preset, setPreset] = React.useState<(typeof PRESETS)[number]>("bank_charges");
  const [accountId, setAccountId] = React.useState("");
  const [narration, setNarration] = React.useState("");
  React.useEffect(() => {
    if (!line) return;
    setPreset(line.amount < 0 ? "bank_charges" : "interest_received");
    setAccountId("");
    setNarration("");
  }, [line]);
  const fits = (p: (typeof PRESETS)[number]) => {
    if (!line) return true;
    if (line.amount < 0) return !["interest_received", "other_income", "capital", "cash_deposit"].includes(p);
    return !["bank_charges", "interest_paid", "other_expense", "drawings", "cash_withdrawal"].includes(p);
  };
  const submit = async () => {
    if (!line) return;
    try {
      await create.mutateAsync({ lineId: line.id, preset, accountId: preset === "account" ? accountId : null, narration: narration.trim() || null });
      toast.success(t("billing.acctb.rec.entryPosted"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.rec.entryTitle")}</DialogTitle>
          <DialogDescription>
            {line ? `${formatDate(line.date, { day: "numeric", month: "short", year: "numeric" })} · ${line.narration}` : ""} {line && <Signed v={line.amount} />}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <RadioGroup value={preset} onValueChange={(v) => setPreset(v as (typeof PRESETS)[number])} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PRESETS.filter(fits).map((p) => (
              <Label key={p} htmlFor={`preset-${p}`} className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 font-normal has-[:checked]:border-primary">
                <RadioGroupItem id={`preset-${p}`} value={p} className="mt-0.5" />
                <span>
                  <span className="block font-medium">{t(`billing.acctb.preset.${p}`)}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          {preset === "account" && (
            <div className="grid gap-1.5">
              <Label htmlFor="pe-acc">{t("billing.acctb.rec.otherAccount")}</Label>
              <AccountSelect id="pe-acc" value={accountId} onChange={setAccountId} accounts={accounts.data ?? []} filter={(a) => !a.isBank || a.id !== line?.accountId} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="pe-narr">{t("billing.acctb.rec.narration")}</Label>
            <Input id="pe-narr" maxLength={300} value={narration} placeholder={line?.narration ?? ""} onChange={(e) => setNarration(e.target.value)} />
          </div>
          <Alert>
            <AlertDescription>{t("billing.acctb.rec.customerHint")}</AlertDescription>
          </Alert>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={create.isPending || (preset === "account" && !accountId)}>
            {t("billing.acctb.rec.post")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
