"use client";

import * as React from "react";
import { CalendarCheckIcon, MinusIcon, PlusIcon, StoreIcon } from "lucide-react";
import {
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { usePaymentsReport } from "../lib/api";
import { money, rupeesToPaise, timeShort, todayIST } from "../lib/format";
import { expectedCash, salesByMethod, type DayRecord } from "../lib/storage";
import { countTotal, DENOMINATIONS, type Denomination, type DenominationCounts } from "../lib/tender";
import { usePos } from "./pos-context";

export interface DayDialogProps {
  open: boolean;
  day: DayRecord | null;
  onClose: () => void;
  onOpenDay: (openingCash: number) => void;
  onCloseDay: (counts: DenominationCounts, note: string) => void;
  onCashMove: (amount: number, note: string) => void;
}

/**
 * Day open / X report / close for this counter. Stored on the device (no till API yet): opening cash, the sales
 * made here, cash in/out, and the closing count by denomination with the difference against what is expected.
 * The "whole shop today" figures come from the payments report when `invoices.reports` is on.
 */
export function DayDialog(props: DayDialogProps) {
  const { t } = useI18n();
  const today = todayIST();
  const day = props.day && props.day.date === today ? props.day : null;
  const isOpen = !!day && !day.closedAt;

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-2xl" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("pos.day.title")}</DialogTitle>
          <DialogDescription>
            {isOpen ? t("pos.day.openSince", { time: timeShort(day.openedAt), by: day.openedBy }) : day?.closedAt ? t("pos.day.closedAt", { time: timeShort(day.closedAt) }) : t("pos.day.notOpen")}
          </DialogDescription>
        </DialogHeader>
        {!day || day.closedAt ? (
          <>
            {day?.closedAt && <ClosedSummary day={day} />}
            <OpenForm onOpen={props.onOpenDay} again={!!day?.closedAt} />
          </>
        ) : (
          <Tabs defaultValue="summary" className="grid gap-4">
            <TabsList className="w-full">
              <TabsTrigger value="summary">{t("pos.day.tabSummary")}</TabsTrigger>
              <TabsTrigger value="cash">{t("pos.day.tabCash")}</TabsTrigger>
              <TabsTrigger value="close">{t("pos.day.tabClose")}</TabsTrigger>
            </TabsList>
            <TabsContent value="summary">
              <XReport day={day} />
            </TabsContent>
            <TabsContent value="cash">
              <CashMove onMove={props.onCashMove} day={day} />
            </TabsContent>
            <TabsContent value="close">
              <CloseForm day={day} onCloseDay={props.onCloseDay} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OpenForm({ onOpen, again }: { onOpen: (cash: number) => void; again: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<"amount" | "count">("amount");
  const [text, setText] = React.useState("");
  const [counts, setCounts] = React.useState<DenominationCounts>({});
  const amount = mode === "count" ? countTotal(counts) : (rupeesToPaise(text) ?? (text.trim() ? null : 0));
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount !== null) onOpen(amount);
      }}
    >
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
        <Button type="submit" size="lg" disabled={amount === null}>
          <StoreIcon /> {again ? t("pos.day.openAgain") : t("pos.day.open")}
        </Button>
      </DialogFooter>
    </form>
  );
}

const METHODS = ["cash", "upi", "card", "bank", "cheque", "other", "credit"] as const;

function XReport({ day }: { day: DayRecord }) {
  const { t } = useI18n();
  const { has, branch } = usePos();
  const shop = usePaymentsReport(day.date, branch?.id ?? null, has.reports);
  const mine = salesByMethod(day);
  const total = day.sales.reduce((s, x) => s + x.total, 0);
  const label = (m: string) => t(`pos.day.method.${m}`);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Tile label={t("pos.day.bills")} value={String(day.sales.length)} />
        <Tile label={t("pos.day.sales")} value={money(total)} />
        <Tile label={t("pos.day.expected")} value={money(expectedCash(day))} />
      </div>
      <section className="grid gap-1.5">
        <h3 className="text-sm font-semibold">{t("pos.day.thisCounter")}</h3>
        <dl className="grid gap-1 rounded-xl border p-3 text-sm tabular-nums">
          <Row label={t("pos.day.openingCash")} value={money(day.openingCash)} />
          {METHODS.filter((m) => (mine[m] ?? 0) > 0).map((m) => (
            <Row key={m} label={label(m)} value={money(mine[m] ?? 0)} />
          ))}
          {day.cashMoves.length > 0 && <Row label={t("pos.day.cashMoves")} value={money(day.cashMoves.reduce((s, m) => s + m.amount, 0))} />}
        </dl>
      </section>
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

function CashMove({ onMove, day }: { onMove: (amount: number, note: string) => void; day: DayRecord }) {
  const { t } = useI18n();
  const [dir, setDir] = React.useState<"in" | "out">("out");
  const [text, setText] = React.useState("");
  const [note, setNote] = React.useState("");
  const amount = rupeesToPaise(text);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!amount) return;
        onMove(dir === "in" ? amount : -amount, note.trim());
        setText("");
        setNote("");
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
        <FieldLabel optional={t("pos.common.optional")}>{t("pos.day.moveNote")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} placeholder={t("pos.day.moveNotePlaceholder")} />
        </FieldControl>
      </Field>
      <Button type="submit" size="lg" disabled={!amount}>
        {t("pos.day.record")}
      </Button>
      {day.cashMoves.length > 0 && (
        <ul className="grid gap-1 text-sm tabular-nums">
          {day.cashMoves.map((m, i) => (
            <li key={i} className="flex justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
              <span className="truncate">
                {timeShort(m.at)} · {m.note || (m.amount > 0 ? t("pos.day.cashIn") : t("pos.day.cashOut"))}
              </span>
              <span className={cn(m.amount < 0 && "text-destructive")}>{money(m.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function CloseForm({ day, onCloseDay }: { day: DayRecord; onCloseDay: (counts: DenominationCounts, note: string) => void }) {
  const { t } = useI18n();
  const [counts, setCounts] = React.useState<DenominationCounts>({});
  const [note, setNote] = React.useState("");
  const counted = countTotal(counts);
  const expected = expectedCash(day);
  const diff = counted - expected;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onCloseDay(counts, note.trim());
      }}
    >
      <Field>
        <FieldLabel htmlFor={null}>{t("pos.day.count")}</FieldLabel>
        <DenominationCounter counts={counts} onChange={setCounts} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Tile label={t("pos.day.expected")} value={money(expected)} />
        <Tile label={t("pos.day.counted")} value={<AnimatedNumber value={counted} format={money} />} />
        <Tile
          label={diff === 0 ? t("pos.day.matches") : diff > 0 ? t("pos.day.over") : t("pos.day.short")}
          value={<AnimatedNumber value={diff} format={(n) => (n > 0 ? "+" : "") + money(n)} />}
          tone={diff === 0 ? "success" : diff > 0 ? "warning" : "destructive"}
        />
      </div>
      <Field>
        <FieldLabel optional={t("pos.common.optional")}>{t("pos.day.closeNote")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} />
        </FieldControl>
      </Field>
      <DialogFooter>
        <Button type="submit" size="lg">
          <CalendarCheckIcon /> {t("pos.day.close")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ClosedSummary({ day }: { day: DayRecord }) {
  const { t } = useI18n();
  const diff = (day.closingCash ?? 0) - (day.expectedCash ?? 0);
  return (
    <div className="grid grid-cols-3 gap-3">
      <Tile label={t("pos.day.bills")} value={String(day.sales.length)} />
      <Tile label={t("pos.day.counted")} value={money(day.closingCash ?? 0)} />
      <Tile label={t("pos.day.difference")} value={(diff > 0 ? "+" : "") + money(diff)} tone={diff === 0 ? "success" : diff > 0 ? "warning" : "destructive"} />
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", bold && "border-t pt-1 font-semibold")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
