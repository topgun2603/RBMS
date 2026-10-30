"use client";

import * as React from "react";
import { ArrowRightLeftIcon, CalendarCheckIcon, Loader2Icon, LockIcon, MinusIcon, PlusIcon, PrinterIcon, RefreshCwIcon, StoreIcon, WifiOffIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatedNumber,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Skeleton,
  SuccessCheck,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@rbms/ui";
import { ApprovalCancelled, describeError, useDiscountApproval, useI18n } from "@rbms/web";
import { fetchPdf, usePaymentsReport } from "../lib/api";
import { money, rupeesToPaise, timeShort, todayIST } from "../lib/format";
import { closeBlockers } from "../lib/close-check";
import { printPdfBlob } from "../lib/print";
import { storageKey, useLocalState } from "../lib/storage";
import { countTotal, DENOMINATIONS, type Denomination, type DenominationCounts } from "../lib/tender";
import { CASH_CATEGORIES, REPORT_PAPERS, tillReportPath, useClosedTills, useTillActions, useTillReport, zLabel, type CashCategory, type ReportPaper, type TillReport, type TillSession } from "../lib/till";
import { useOffline } from "./offline/offline-provider";
import { usePos } from "./pos-context";

export interface DayDialogProps {
  open: boolean;
  onClose: () => void;
  /** The register's open session (null = not open). */
  session: TillSession | null;
  loading: boolean;
  /** This device's register name. */
  register: string;
  onRegister: (name: string) => void;
  /** The till permission (POS_PERMISSIONS.till). */
  canTill: boolean;
}

/** Prints an 80 mm PDF from the API; falls back to opening it in a tab. */
async function printSlip(path: string, locale: string) {
  const blob = await fetchPdf(path, { locale: locale === "ta" ? "ta" : undefined });
  try {
    await printPdfBlob(blob);
  } catch {
    window.open(URL.createObjectURL(blob), "_blank");
  }
}

/**
 * Till open / X report / cash in-out / close for this register, kept on the server (`/v1/invoices/till`): opening cash,
 * the bills, payments and refunds made at this till, cash in / out and the closing count by denomination with the
 * difference against what is expected. Closing freezes the Z report (80 mm PDF). The "whole shop today" figures come
 * from the payments report when `invoices.reports` is on.
 */
export function DayDialog(props: DayDialogProps) {
  const { t, locale } = useI18n();
  const { online } = usePos();
  const s = props.session;
  const isOpen = !!s && s.status === "open";
  const [closed, setClosed] = React.useState<{ session: TillSession; report: TillReport } | null>(null);
  const [tab, setTab] = React.useState("summary");
  React.useEffect(() => {
    if (props.open) {
      setClosed(null);
      setTab("summary");
    }
  }, [props.open]);

  const body = !online.online ? (
    <Alert variant="warning">
      <WifiOffIcon />
      <AlertTitle>{t("pos.till.offlineTitle")}</AlertTitle>
      <AlertDescription>{t("pos.till.offlineBody")}</AlertDescription>
    </Alert>
  ) : props.loading ? (
    <div className="grid gap-3">
      <Skeleton className="h-20 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  ) : closed ? (
    <ClosedSummary session={closed.session} report={closed.report} onPrint={(paper) => void printSlip(tillReportPath(closed.session.id, paper), locale).catch((e) => toast.error(describeError(e, t)))} />
  ) : !props.canTill ? (
    <Alert variant="warning">
      <LockIcon />
      <AlertTitle>{t("pos.till.noPermTitle")}</AlertTitle>
      <AlertDescription>{t("pos.till.noPermBody")}</AlertDescription>
    </Alert>
  ) : !isOpen ? (
    <OpenForm register={props.register} onRegister={props.onRegister} onOpened={props.onClose} />
  ) : (
    <Tabs value={tab} onValueChange={setTab} className="grid gap-4">
      <TabsList className="w-full">
        <TabsTrigger value="summary">{t("pos.day.tabSummary")}</TabsTrigger>
        <TabsTrigger value="cash">{t("pos.day.tabCash")}</TabsTrigger>
        <TabsTrigger value="handover">{t("pos.day.tabHandover")}</TabsTrigger>
        <TabsTrigger value="close">{t("pos.day.tabClose")}</TabsTrigger>
      </TabsList>
      <TabsContent value="summary">
        <XReport
          session={s!}
          onPrint={(paper) => void printSlip(tillReportPath(s!.id, paper), locale).catch((e) => toast.error(describeError(e, t)))}
          onPrintZ={(id, paper) => void printSlip(tillReportPath(id, paper), locale).catch((e) => toast.error(describeError(e, t)))}
        />
      </TabsContent>
      <TabsContent value="cash">
        <CashMove session={s!} register={props.register} />
      </TabsContent>
      <TabsContent value="handover">
        <HandoverForm session={s!} register={props.register} onDone={() => setTab("summary")} />
      </TabsContent>
      <TabsContent value="close">
        <CloseForm session={s!} register={props.register} onClosed={setClosed} />
      </TabsContent>
    </Tabs>
  );

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-2xl" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("pos.day.title")}</DialogTitle>
          <DialogDescription>
            {closed
              ? t("pos.day.closedAt", { time: timeShort(closed.session.closedAt ?? Date.now()) })
              : isOpen
                ? t("pos.till.openSince", { register: s!.register, time: timeShort(s!.openedAt), by: s!.cashierName ?? s!.openedByName ?? "" })
                : t("pos.day.notOpen")}
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function OpenForm({ register, onRegister, onOpened }: { register: string; onRegister: (n: string) => void; onOpened: () => void }) {
  const { t } = useI18n();
  const { cashier, branch } = usePos();
  const actions = useTillActions(register, branch?.id ?? null);
  const [mode, setMode] = React.useState<"amount" | "count">("amount");
  const [text, setText] = React.useState("");
  const [counts, setCounts] = React.useState<DenominationCounts>({});
  const [name, setName] = React.useState(register);
  React.useEffect(() => setName(register), [register]);
  const amount = mode === "count" ? countTotal(counts) : (rupeesToPaise(text) ?? (text.trim() ? null : 0));
  const busy = actions.open.isPending;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (amount === null || busy) return;
        const reg = name.trim() || register;
        if (reg !== register) onRegister(reg);
        try {
          await actions.open.mutateAsync({
            register: reg,
            ...(mode === "count" ? { openingCount: counts } : { openingCash: amount }),
            actorName: cashier,
          });
          toast.success(t("pos.day.opened"));
          onOpened();
        } catch (err) {
          toast.error(describeError(err, t));
        }
      }}
    >
      <Field>
        <FieldLabel>{t("pos.till.register")}</FieldLabel>
        <FieldControl>
          <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </FieldControl>
        <FieldHint>{t("pos.till.registerHint")}</FieldHint>
      </Field>
      <Field>
        <FieldLabel
          aside={
            <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => (v === "amount" || v === "count") && setMode(v)} aria-label={t("pos.day.mode")}>
              <ToggleGroupItem value="amount" className="h-7 px-2 text-xs">
                {t("pos.day.modeAmount")}
              </ToggleGroupItem>
              <ToggleGroupItem value="count" className="h-7 px-2 text-xs">
                {t("pos.day.modeCount")}
              </ToggleGroupItem>
            </ToggleGroup>
          }
        >
          {t("pos.day.openingCash")}
        </FieldLabel>
        {mode === "amount" ? (
          <InputGroup size="lg" className="h-14">
            <InputGroupAddon className="text-xl">₹</InputGroupAddon>
            <FieldControl>
              <InputGroupInput value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoFocus placeholder="0" className="text-2xl font-semibold tabular-nums md:text-2xl" />
            </FieldControl>
          </InputGroup>
        ) : (
          <DenominationCounter counts={counts} onChange={setCounts} />
        )}
        <FieldHint>{t("pos.day.openingHint")}</FieldHint>
      </Field>
      <DialogFooter>
        <Button type="submit" size="lg" disabled={amount === null || busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <StoreIcon />} {t("pos.day.open")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Paper the Z / X report prints on, remembered on this device (58 / 80 mm roll or A4). */
function usePaper(): [ReportPaper, (p: ReportPaper) => void] {
  const { tenant } = usePos();
  const [paper, setPaper] = useLocalState<ReportPaper>(storageKey("reportPaper", tenant), "80");
  return [REPORT_PAPERS.includes(paper) ? paper : "80", setPaper];
}

function PaperPicker({ value, onChange }: { value: ReportPaper; onChange: (p: ReportPaper) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{t("pos.day.paper")}</span>
      <ToggleGroup type="single" size="sm" variant="outline" value={value} onValueChange={(v) => v && onChange(v as ReportPaper)} aria-label={t("pos.day.paper")}>
        {REPORT_PAPERS.map((p) => (
          <ToggleGroupItem key={p} value={p} className="h-7 px-2 text-xs">
            {t(`pos.day.paper.${p}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** Earlier days of this register: reprint any Z report (they never change once closed). */
function ZHistory({ register, paper, onPrintZ }: { register: string; paper: ReportPaper; onPrintZ: (id: string, paper: ReportPaper) => void }) {
  const { t } = useI18n();
  const closed = useClosedTills(register, true);
  if (!closed.data?.length) return null;
  return (
    <section className="grid gap-1.5">
      <h3 className="text-sm font-semibold">{t("pos.day.history")}</h3>
      <ul className="grid gap-1 text-sm tabular-nums">
        {closed.data.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
            <span className="truncate">
              {zLabel(s)} · {s.date}
              {s.closedByName ? ` · ${s.closedByName}` : ""}
            </span>
            <span className="flex items-center gap-2">
              <span className={cn((s.difference ?? 0) < 0 && "text-destructive")}>{((s.difference ?? 0) > 0 ? "+" : "") + money(s.difference ?? 0)}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("pos.till.printZ")} onClick={() => onPrintZ(s.id, paper)}>
                <PrinterIcon />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function XReport({ session, onPrint, onPrintZ }: { session: TillSession; onPrint: (paper: ReportPaper) => void; onPrintZ: (id: string, paper: ReportPaper) => void }) {
  const { t } = useI18n();
  const { has, branch } = usePos();
  const x = useTillReport(session.id, true);
  const shop = usePaymentsReport(todayIST(), branch?.id ?? null, has.reports);
  const [paper, setPaper] = usePaper();
  const label = (m: string) => t(`pos.day.method.${m}`);
  const r = x.data?.report;
  return (
    <div className="grid gap-4">
      {x.isError ? (
        <p className="text-sm text-destructive">{describeError(x.error, t)}</p>
      ) : !r ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tile label={t("pos.day.bills")} value={String(r.bills.count)} />
            <Tile label={t("pos.day.sales")} value={money(r.bills.total)} />
            <Tile label={t("pos.day.expected")} value={<AnimatedNumber value={r.cash.expected} format={money} />} />
          </div>
          <section className="grid gap-1.5">
            <h3 className="text-sm font-semibold">{t("pos.till.thisRegister", { register: session.register })}</h3>
            <dl className="grid gap-1 rounded-xl border p-3 text-sm tabular-nums">
              <Row label={t("pos.day.cashier")} value={session.cashierName ?? "—"} />
              {r.billRange?.from && <Row label={t("pos.day.billRange")} value={r.billRange.to && r.billRange.to !== r.billRange.from ? `${r.billRange.from} – ${r.billRange.to}` : r.billRange.from} />}
              <Row label={t("pos.day.openingCash")} value={money(r.cash.opening)} />
              {r.payments.map((p) => (
                <Row key={p.method} label={`${label(p.method)} · ${p.count}`} value={money(p.amount)} />
              ))}
              {r.onCredit > 0 && <Row label={label("credit")} value={money(r.onCredit)} />}
              {r.refunds.map((p) => (
                <Row key={`r-${p.method}`} label={t("pos.till.refundsBy", { method: label(p.method), count: p.count })} value={`−${money(p.amount)}`} tone="destructive" />
              ))}
              {!!r.discounts?.total && <Row label={t("pos.day.discounts", { count: r.discounts.bills })} value={`−${money(r.discounts.total)}`} />}
              {r.creditNotes.count > 0 && <Row label={t("pos.day.returns", { count: r.creditNotes.count })} value={`−${money(r.creditNotes.total)}`} />}
              {!!r.voids?.count && <Row label={t("pos.day.voids", { count: r.voids.count })} value={money(r.voids.total)} />}
              {(r.cash.cashIn > 0 || r.cash.cashOut > 0) && <Row label={t("pos.day.cashMoves")} value={money(r.cash.cashIn - r.cash.cashOut)} />}
              {!!r.cash.handoverAdjust && <Row label={t("pos.day.handoverAdj")} value={money(r.cash.handoverAdjust)} />}
              <Row label={t("pos.day.expected")} value={money(r.cash.expected)} bold />
            </dl>
          </section>
          {!!r.taxByRate?.length && (
            <section className="grid gap-1.5">
              <h3 className="text-sm font-semibold">{t("pos.day.taxByRate")}</h3>
              <dl className="grid gap-1 rounded-xl border p-3 text-sm tabular-nums">
                {r.taxByRate.map((x2) => (
                  <Row key={x2.gstRate} label={t("pos.day.taxRow", { rate: x2.gstRate, taxable: money(x2.taxable) })} value={money(x2.cgst + x2.sgst + x2.igst)} />
                ))}
              </dl>
            </section>
          )}
          {!!r.cashByCategory?.length && (
            <section className="grid gap-1.5">
              <h3 className="text-sm font-semibold">{t("pos.day.byCategory")}</h3>
              <dl className="grid gap-1 rounded-xl border p-3 text-sm tabular-nums">
                {r.cashByCategory.map((c) => (
                  <Row
                    key={c.category}
                    label={`${t(`pos.cash.cat.${c.category}`)} · ${c.count}`}
                    value={[c.cashIn ? `+${money(c.cashIn)}` : "", c.cashOut ? `−${money(c.cashOut)}` : ""].filter(Boolean).join(" ")}
                  />
                ))}
              </dl>
            </section>
          )}
          <p className="text-xs text-muted-foreground">{t("pos.day.xNote")}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PaperPicker value={paper} onChange={setPaper} />
            <Button type="button" variant="outline" onClick={() => onPrint(paper)}>
              <PrinterIcon /> {t("pos.till.printX")}
            </Button>
          </div>
          {has.reports && <ZHistory register={session.register} paper={paper} onPrintZ={onPrintZ} />}
        </>
      )}
      {has.reports && (
        <section className="grid gap-1.5">
          <h3 className="text-sm font-semibold">{branch ? t("pos.day.wholeBranch", { branch: branch.name }) : t("pos.day.wholeShop")}</h3>
          {shop.isLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : shop.isError ? (
            <p className="text-sm text-destructive">{describeError(shop.error, t)}</p>
          ) : (
            <dl className="grid gap-1 rounded-xl border p-3 text-sm tabular-nums">
              {(shop.data?.byMethod ?? []).length === 0 && <p className="text-muted-foreground">{t("pos.day.noPayments")}</p>}
              {(shop.data?.byMethod ?? []).map((m) => (
                <Row key={m.method} label={`${label(m.method)} · ${m.count}`} value={money(m.amount)} />
              ))}
              {(shop.data?.byMethod ?? []).length > 0 && (
                <Row label={t("pos.day.collected")} value={money((shop.data?.byMethod ?? []).reduce((s, m) => s + m.amount, 0))} bold />
              )}
            </dl>
          )}
          <p className="text-xs text-muted-foreground">{t("pos.day.shopHint")}</p>
        </section>
      )}
    </div>
  );
}

function CashMove({ session, register }: { session: TillSession; register: string }) {
  const { t } = useI18n();
  const { cashier, branch } = usePos();
  const actions = useTillActions(register, branch?.id ?? null);
  const [dir, setDir] = React.useState<"in" | "out">("out");
  const [category, setCategory] = React.useState<CashCategory>("petty_expense");
  const [text, setText] = React.useState("");
  const [note, setNote] = React.useState("");
  const amount = rupeesToPaise(text);
  const busy = actions.cash.isPending;
  // Out: tea, courier, drawings. In: change float. "Other" fits both.
  const categories = CASH_CATEGORIES.filter((c) => (dir === "out" ? c !== "change_float" : c !== "petty_expense" && c !== "owner_drawing"));
  React.useEffect(() => {
    setCategory((c) => (categories.includes(c) ? c : dir === "out" ? "petty_expense" : "change_float"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `categories` follows `dir`
  }, [dir]);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!amount || busy) return;
        try {
          await actions.cash.mutateAsync({ id: session.id, amount: dir === "in" ? amount : -amount, category, reason: note.trim(), actorName: cashier });
          setText("");
          setNote("");
          toast.success(t("pos.till.cashRecorded"));
        } catch (err) {
          toast.error(describeError(err, t));
        }
      }}
    >
      <FieldRow cols={2}>
        <Field>
          <FieldLabel htmlFor={null}>{t("pos.day.direction")}</FieldLabel>
          <ToggleGroup type="single" variant="outline" size="lg" value={dir} onValueChange={(v) => (v === "in" || v === "out") && setDir(v)} className="w-full">
            <ToggleGroupItem value="out" className="flex-1">
              {t("pos.day.cashOut")}
            </ToggleGroupItem>
            <ToggleGroupItem value="in" className="flex-1">
              {t("pos.day.cashIn")}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>{t("pos.day.amount")}</FieldLabel>
          <InputGroup size="lg">
            <InputGroupAddon>₹</InputGroupAddon>
            <FieldControl>
              <InputGroupInput value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" />
            </FieldControl>
          </InputGroup>
        </Field>
      </FieldRow>
      <Field>
        <FieldLabel htmlFor={null}>{t("pos.cash.category")}</FieldLabel>
        <ToggleGroup type="single" variant="outline" value={category} onValueChange={(v) => v && setCategory(v as CashCategory)} className="flex flex-wrap justify-start gap-1">
          {categories.map((c) => (
            <ToggleGroupItem key={c} value={c} className="px-3">
              {t(`pos.cash.cat.${c}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldHint>{t("pos.cash.catHint")}</FieldHint>
      </Field>
      <Field>
        <FieldLabel optional={t("pos.common.optional")}>{t("pos.day.moveNote")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} placeholder={t("pos.day.moveNotePlaceholder")} />
        </FieldControl>
      </Field>
      <Button type="submit" size="lg" disabled={!amount || busy}>
        {busy && <Loader2Icon className="animate-spin" />} {t("pos.day.record")}
      </Button>
      {session.cashEntries.length > 0 && (
        <ul className="grid gap-1 text-sm tabular-nums">
          {session.cashEntries.map((m) => (
            <li key={m.id} className="flex justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
              <span className="truncate">
                {timeShort(m.at)} · {t(`pos.cash.cat.${m.category ?? "other"}`)}
                {m.reason ? ` · ${m.reason}` : ""}
                {m.byName ? ` · ${m.byName}` : ""}
              </span>
              <span className={cn(m.amount < 0 && "text-destructive")}>{money(m.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** The count, what the till expects, the difference and (when it differs) the reason: shared by closing and handover. */
function CountSection({
  counts,
  onCounts,
  expected,
  reason,
  onReason,
}: {
  counts: DenominationCounts;
  onCounts: (c: DenominationCounts) => void;
  expected: number | null;
  reason: string;
  onReason: (r: string) => void;
}) {
  const { t } = useI18n();
  const counted = countTotal(counts);
  const diff = expected === null ? 0 : counted - expected;
  return (
    <>
      <Field>
        <FieldLabel htmlFor={null}>{t("pos.day.count")}</FieldLabel>
        <DenominationCounter counts={counts} onChange={onCounts} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Tile label={t("pos.day.expected")} value={expected === null ? "…" : money(expected)} />
        <Tile label={t("pos.day.counted")} value={<AnimatedNumber value={counted} format={money} />} />
        <Tile
          label={diff === 0 ? t("pos.day.matches") : diff > 0 ? t("pos.day.over") : t("pos.day.short")}
          value={<AnimatedNumber value={diff} format={(n) => (n > 0 ? "+" : "") + money(n)} />}
          tone={diff === 0 ? "success" : diff > 0 ? "warning" : "destructive"}
        />
      </div>
      {diff !== 0 && expected !== null && (
        <Field>
          <FieldLabel>{t("pos.day.reason")}</FieldLabel>
          <FieldControl>
            <Textarea rows={2} value={reason} onChange={(e) => onReason(e.target.value.slice(0, 200))} aria-invalid={!reason.trim()} />
          </FieldControl>
          <FieldHint>{t("pos.day.reasonHint")}</FieldHint>
        </Field>
      )}
    </>
  );
}

/** Bills made offline that have not synced are not in the Z report: say so, offer to sync, and let the cashier choose. */
function OfflinePending({ closeAnyway, onCloseAnyway }: { closeAnyway: boolean; onCloseAnyway: (v: boolean) => void }) {
  const { t } = useI18n();
  const offline = useOffline();
  const { online } = usePos();
  if (offline.counts.pending === 0) return null;
  return (
    <Alert variant="warning">
      <WifiOffIcon />
      <AlertTitle>{t("pos.day.offlinePending", { count: offline.counts.pending })}</AlertTitle>
      <AlertDescription className="grid gap-2">
        <div>
          <Button type="button" size="sm" variant="outline" disabled={!online.online || offline.syncing} onClick={() => void offline.syncNow()}>
            {offline.syncing ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {offline.syncing ? t("pos.day.syncing") : t("pos.day.syncNow")}
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={closeAnyway} onChange={(e) => onCloseAnyway(e.target.checked)} />
          <span>{t("pos.day.closeAnyway")}</span>
        </label>
      </AlertDescription>
    </Alert>
  );
}

function CloseForm({ session, register, onClosed }: { session: TillSession; register: string; onClosed: (r: { session: TillSession; report: TillReport }) => void }) {
  const { t } = useI18n();
  const { cashier, branch } = usePos();
  const offline = useOffline();
  const approval = useDiscountApproval();
  const actions = useTillActions(register, branch?.id ?? null);
  const x = useTillReport(session.id, true);
  const [counts, setCounts] = React.useState<DenominationCounts>({});
  const [note, setNote] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [closeAnyway, setCloseAnyway] = React.useState(false);
  const counted = countTotal(counts);
  const expected = x.data?.report.cash.expected ?? null;
  const blockers = closeBlockers({ counted, expected, reason, pendingBills: offline.counts.pending, closeAnyway });
  const busy = actions.close.isPending;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || blockers.length > 0) return;
        try {
          // A difference beyond the shop's limit asks for a manager's PIN, then sends the same close again.
          const r = await approval.run((pin) => actions.close.mutateAsync({ id: session.id, count: counts, note: note.trim(), reason, actorName: cashier, ...(pin ? { pin } : {}) }));
          toast.success(t("pos.day.closed"));
          onClosed(r);
        } catch (err) {
          if (!(err instanceof ApprovalCancelled)) toast.error(describeError(err, t));
        }
      }}
    >
      <OfflinePending closeAnyway={closeAnyway} onCloseAnyway={setCloseAnyway} />
      <CountSection counts={counts} onCounts={setCounts} expected={expected} reason={reason} onReason={setReason} />
      <Field>
        <FieldLabel optional={t("pos.common.optional")}>{t("pos.day.closeNote")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} />
        </FieldControl>
      </Field>
      <p className="text-xs text-muted-foreground">{t("pos.day.closeNote2")}</p>
      {blockers.includes("reason") && counted > 0 && <p className="text-xs text-destructive">{t("pos.day.reasonRequired")}</p>}
      <DialogFooter>
        <Button type="submit" size="lg" disabled={busy || blockers.length > 0}>
          {busy ? <Loader2Icon className="animate-spin" /> : <CalendarCheckIcon />} {t("pos.day.close")}
        </Button>
      </DialogFooter>
      {approval.dialog}
    </form>
  );
}

/** Hands the open drawer to the next cashier: a count, both names recorded, the day stays open. */
function HandoverForm({ session, register, onDone }: { session: TillSession; register: string; onDone: () => void }) {
  const { t } = useI18n();
  const { cashier, branch } = usePos();
  const approval = useDiscountApproval();
  const actions = useTillActions(register, branch?.id ?? null);
  const x = useTillReport(session.id, true);
  const [to, setTo] = React.useState("");
  const [counts, setCounts] = React.useState<DenominationCounts>({});
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const counted = countTotal(counts);
  const expected = x.data?.report.cash.expected ?? null;
  // Offline bills only matter at close (the Z report); a handover just needs a count and, when it differs, a reason.
  const blockers = closeBlockers({ counted, expected, reason, pendingBills: 0, closeAnyway: false });
  const busy = actions.handover.isPending;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || blockers.length > 0 || !to.trim()) return;
        try {
          await approval.run((pin) => actions.handover.mutateAsync({ id: session.id, toName: to.trim(), count: counts, note: note.trim(), reason, actorName: cashier, ...(pin ? { pin } : {}) }));
          toast.success(t("pos.handover.done", { name: to.trim() }));
          setTo("");
          setCounts({});
          setReason("");
          setNote("");
          onDone();
        } catch (err) {
          if (!(err instanceof ApprovalCancelled)) toast.error(describeError(err, t));
        }
      }}
    >
      <div>
        <h3 className="text-sm font-semibold">{t("pos.handover.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("pos.handover.hint")}</p>
      </div>
      <Field>
        <FieldLabel>{t("pos.handover.to")}</FieldLabel>
        <FieldControl>
          <Input value={to} maxLength={80} onChange={(e) => setTo(e.target.value)} placeholder={t("pos.handover.toPlaceholder")} />
        </FieldControl>
      </Field>
      <CountSection counts={counts} onCounts={setCounts} expected={expected} reason={reason} onReason={setReason} />
      <Field>
        <FieldLabel optional={t("pos.common.optional")}>{t("pos.day.closeNote")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} />
        </FieldControl>
      </Field>
      <DialogFooter>
        <Button type="submit" size="lg" disabled={busy || blockers.length > 0 || !to.trim() || counted === 0}>
          {busy ? <Loader2Icon className="animate-spin" /> : <ArrowRightLeftIcon />} {t("pos.handover.submit")}
        </Button>
      </DialogFooter>
      {session.handovers.length > 0 && (
        <section className="grid gap-1.5">
          <h3 className="text-sm font-semibold">{t("pos.handover.list")}</h3>
          <ul className="grid gap-1 text-sm tabular-nums">
            {session.handovers.map((h) => (
              <li key={h.id} className="grid gap-0.5 rounded-lg bg-muted/50 px-3 py-1.5">
                <span className="flex justify-between gap-2">
                  <span>
                    {timeShort(h.at)} · {t("pos.handover.line", { from: h.fromName ?? "?", to: h.toName })}
                  </span>
                  <span className={cn(h.difference < 0 && "text-destructive")}>{(h.difference > 0 ? "+" : "") + money(h.difference)}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("pos.handover.counted", { counted: money(h.counted), expected: money(h.expected) })}
                  {h.note ? ` · ${h.note}` : ""}
                  {h.approvedByName ? ` · ${t("pos.day.approvedBy", { name: h.approvedByName })}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {approval.dialog}
    </form>
  );
}

function ClosedSummary({ session, report, onPrint }: { session: TillSession; report: TillReport; onPrint: (paper: ReportPaper) => void }) {
  const { t } = useI18n();
  const [paper, setPaper] = usePaper();
  const diff = session.difference ?? 0;
  return (
    <div className="grid gap-4">
      <div className="grid justify-items-center gap-2 py-1 text-center">
        <SuccessCheck size={56} />
        <p className="font-semibold">{t("pos.day.closedZ", { register: session.register, z: zLabel(session) })}</p>
        {session.closeApprovedByName && <p className="text-xs text-muted-foreground">{t("pos.day.approvedBy", { name: session.closeApprovedByName })}</p>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Tile label={t("pos.day.bills")} value={String(report.bills.count)} />
        <Tile label={t("pos.day.counted")} value={money(session.countedCash ?? 0)} />
        <Tile label={t("pos.day.difference")} value={(diff > 0 ? "+" : "") + money(diff)} tone={diff === 0 ? "success" : diff > 0 ? "warning" : "destructive"} />
      </div>
      {session.differenceReason && <p className="text-sm text-muted-foreground">{session.differenceReason}</p>}
      <p className="text-xs text-muted-foreground">{t("pos.day.closeNote2")}</p>
      <DialogFooter className="items-center sm:justify-between">
        <PaperPicker value={paper} onChange={setPaper} />
        <Button type="button" size="lg" onClick={() => onPrint(paper)}>
          <PrinterIcon /> {t("pos.till.printZ")}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** ₹2000 … ₹1 rows with − count + steppers and a live total. */
export function DenominationCounter({ counts, onChange }: { counts: DenominationCounts; onChange: (c: DenominationCounts) => void }) {
  const { t } = useI18n();
  const set = (d: Denomination, n: number) => onChange({ ...counts, [d]: Math.max(Math.floor(n) || 0, 0) });
  return (
    <div className="grid gap-2">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {DENOMINATIONS.map((d) => {
          const n = counts[d] ?? 0;
          return (
            <div key={d} className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
              <span className="w-14 text-sm font-semibold tabular-nums">₹{d}</span>
              <span className="text-muted-foreground">×</span>
              <div className="flex items-center rounded-md border">
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("pos.day.less", { d })} onClick={() => set(d, n - 1)} disabled={n === 0}>
                  <MinusIcon />
                </Button>
                <input
                  value={n === 0 ? "" : String(n)}
                  onChange={(e) => set(d, Number(e.target.value.replace(/\D/g, "")))}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label={t("pos.day.countOf", { d })}
                  className="h-9 w-12 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("pos.day.more", { d })} onClick={() => set(d, n + 1)}>
                  <PlusIcon />
                </Button>
              </div>
              <span className="ml-auto text-sm tabular-nums">{money(n * d * 100)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-baseline justify-between rounded-lg bg-muted/50 px-3 py-2">
        <span className="text-sm font-medium">{t("pos.day.countTotal")}</span>
        <AnimatedNumber value={countTotal(counts)} format={money} className="text-xl font-bold tabular-nums" />
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "success" | "warning" | "destructive" }) {
  return (
    <div className={cn("grid gap-0.5 rounded-xl border p-3", tone === "success" && "border-success/40 bg-success/10", tone === "warning" && "border-warning/50 bg-warning/10", tone === "destructive" && "border-destructive/40 bg-destructive/10")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "destructive" }) {
  return (
    <div className={cn("flex justify-between gap-3", bold && "border-t pt-1 font-semibold")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn(tone === "destructive" && "text-destructive")}>{value}</dd>
    </div>
  );
}
