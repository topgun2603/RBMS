"use client";

import * as React from "react";
import { describeError, useI18n, useModuleNavigate } from "@rbms/web";
import { CalendarClockIcon, Loader2Icon, PlusIcon, SaveIcon, StickyNoteIcon } from "lucide-react";
import { computeInvoice } from "@rbms/gst";
import {
  AnimatedNumber,
  AnimatePresence,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  motion,
  Textarea,
  toast,
} from "@rbms/ui";
import { CustomerPicker, type Party } from "../customer-picker";
import { PriceListPicker, useLinePricing, type PriceListChoice } from "../pricing/line-pricing";
import { blankLine, isBlank, LineRow, linesFromInvoice, parseLine, partyFromInvoice, partyState, Row, type LineDraft } from "../invoice-form";
import { UnitList } from "../item-dialog";
import { money, todayIST } from "../../lib/format";
import { useCustomer, useSellerProfile } from "../../lib/queries";
import { useCreateRecurring, useRecurringPreview, useUpdateRecurring } from "../../lib/queries-recurring";
import {
  RECURRING_FREQUENCIES,
  type RecurringDetail,
  type RecurringFrequency,
  type RecurringInput,
  type RecurringIssueMode,
  type RecurringPriceMode,
  type RecurringSendChannel,
} from "../../lib/types-recurring";
import { useScheduleText } from "./rc-ui";

type EndMode = "never" | "date" | "count";
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const SEND: RecurringSendChannel[] = ["none", "whatsapp", "sms"];

const intOr = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/**
 * New / edit form of a recurring bill: a saved customer, the bill lines (same line editor, units and price lists as the
 * bill form), the schedule with a live preview of the next dates, and how each bill is made (draft or issued, prices,
 * sending).
 */
export function RecurringForm({ profile, initialCustomerId }: { profile?: RecurringDetail; initialCustomerId?: string }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const seller = useSellerProfile();
  const schedule = useScheduleText();
  const create = useCreateRecurring();
  const update = useUpdateRecurring();
  const editing = !!profile;
  const preset = useCustomer(profile ? "" : (initialCustomerId ?? ""));

  const [party, setParty] = React.useState<Party>(() =>
    profile
      ? partyFromInvoice({
          customerId: profile.customerId,
          customer: { name: profile.customerName, phone: null, email: null, gstin: null, address: null, stateCode: profile.placeOfSupply },
          createdAt: profile.createdAt,
        })
      : { kind: "none" },
  );
  const [name, setName] = React.useState(() => profile?.name ?? "");
  const [lines, setLines] = React.useState<LineDraft[]>(() => (profile?.lines.length ? linesFromInvoice({ lines: profile.lines as never }) : [blankLine()]));
  const [frequency, setFrequency] = React.useState<RecurringFrequency>(() => profile?.frequency ?? "monthly");
  const [interval, setInterval] = React.useState(() => String(profile?.interval ?? 1));
  const [startDate, setStartDate] = React.useState(() => profile?.startDate ?? todayIST());
  const [day, setDay] = React.useState(() => (profile?.dayOfMonth ? String(profile.dayOfMonth) : String(Number((profile?.startDate ?? todayIST()).slice(8, 10)))));
  const [weekday, setWeekday] = React.useState<number>(() => profile?.weekday ?? weekdayOf(profile?.startDate ?? todayIST()));
  const [endMode, setEndMode] = React.useState<EndMode>(() => (profile?.endDate ? "date" : profile?.maxCount ? "count" : "never"));
  const [endDate, setEndDate] = React.useState(() => profile?.endDate ?? "");
  const [maxCount, setMaxCount] = React.useState(() => (profile?.maxCount ? String(profile.maxCount) : "12"));
  const [dueDays, setDueDays] = React.useState(() => (profile?.dueDays !== null && profile?.dueDays !== undefined ? String(profile.dueDays) : ""));
  const [issueMode, setIssueMode] = React.useState<RecurringIssueMode>(() => profile?.issueMode ?? "draft");
  const [priceMode, setPriceMode] = React.useState<RecurringPriceMode>(() => profile?.priceMode ?? "fixed");
  const [sendChannel, setSendChannel] = React.useState<RecurringSendChannel>(() => profile?.sendChannel ?? "none");
  const [notes, setNotes] = React.useState(() => profile?.notes ?? "");
  const [showNotes, setShowNotes] = React.useState(() => !!profile?.notes);
  const [priceListId, setPriceListId] = React.useState<PriceListChoice>("");
  const [submitted, setSubmitted] = React.useState(false);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  useLinePricing({ lines, setLines, customerId: party.kind === "saved" ? party.customer.id : null, priceListId, date: startDate });

  React.useEffect(() => {
    if (preset.data && party.kind === "none") setParty({ kind: "saved", customer: preset.data });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the preset arrives
  }, [preset.data]);

  const weekly = frequency === "weekly";
  const n = intOr(interval);
  const dayN = intOr(day);
  const countN = intOr(maxCount);
  const dueN = dueDays.trim() ? intOr(dueDays) : null;
  const errors = {
    customer: party.kind !== "saved" ? t("billing.recurring.form.errors.customer") : null,
    interval: n === null || n < 1 || n > 24 ? t("billing.recurring.form.errors.interval") : null,
    day: !weekly && (dayN === null || dayN < 1 || dayN > 31) ? t("billing.recurring.form.errors.day") : null,
    endDate: endMode === "date" && (!endDate || endDate < startDate) ? t("billing.recurring.form.errors.endDate") : null,
    maxCount: endMode === "count" && (countN === null || countN < 1 || countN > 1000) ? t("billing.recurring.form.errors.maxCount") : null,
    dueDays: dueDays.trim() && (dueN === null || dueN > 365) ? t("billing.recurring.form.errors.dueDays") : null,
  };
  const scheduleOk = !errors.interval && !errors.day && !errors.endDate && !errors.maxCount;

  const previewParams = React.useMemo(
    () =>
      scheduleOk
        ? {
            frequency,
            interval: n ?? 1,
            ...(weekly ? { weekday } : { dayOfMonth: dayN }),
            startDate,
            ...(endMode === "date" ? { endDate } : {}),
            ...(endMode === "count" ? { maxCount: countN } : {}),
          }
        : null,
    [scheduleOk, frequency, n, weekly, weekday, dayN, startDate, endMode, endDate, countN],
  );
  const preview = useRecurringPreview(React.useDeferredValue(previewParams));

  const sellerState = seller.data?.stateCode || "";
  const pos = partyState(party) || sellerState || "33";
  const parsed = lines.map((l) => ({ line: l, ...parseLine(l) }));
  const priced = parsed.filter((p) => p.input && !isBlank(p.line));
  const totals = React.useMemo(
    () => computeInvoice(priced.map((p) => p.input!), { sellerState: sellerState || pos, placeOfSupply: pos }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `priced` is derived from lines
    [lines, sellerState, pos],
  );
  const lineTotals = new Map(priced.map((p, i) => [p.line.key, totals.lines[i]]));
  const filled = parsed.filter((p) => !isBlank(p.line));
  const linesInvalid = filled.length === 0 || filled.some((p) => Object.keys(p.errors).length > 0);

  const updateLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    const l = blankLine(lines[lines.length - 1]?.gstRate ?? "18");
    setLines((ls) => [...ls, l]);
    setFocusKey(l.key);
  };
  const removeLine = (key: string) => setLines((ls) => (ls.length === 1 ? [blankLine(ls[0]?.gstRate)] : ls.filter((l) => l.key !== key)));

  const busy = create.isPending || update.isPending;
  const chip = (on: boolean) => cn("h-8 rounded-full border px-3 text-xs transition-colors", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent");
  const choice = (on: boolean) => cn("rounded-xl border p-3 text-left transition-colors", on ? "border-primary bg-primary/5" : "hover:bg-accent");

  const submit = async () => {
    setSubmitted(true);
    const problem =
      errors.customer ??
      (linesInvalid ? (filled.length === 0 ? t("billing.form.errors.noLines") : t("billing.form.errors.lines")) : null) ??
      errors.interval ??
      errors.day ??
      errors.endDate ??
      errors.maxCount ??
      errors.dueDays;
    if (problem || party.kind !== "saved") {
      toast.error(problem ?? t("billing.recurring.form.errors.customer"));
      return;
    }
    const body: RecurringInput = {
      customerId: party.customer.id,
      name: name.trim() || null,
      lines: filled.map((p) => p.input!),
      notes: notes.trim() || null,
      dueDays: dueDays.trim() ? dueN : null,
      frequency,
      interval: n ?? 1,
      dayOfMonth: weekly ? null : dayN,
      weekday: weekly ? weekday : null,
      startDate,
      endDate: endMode === "date" ? endDate : null,
      maxCount: endMode === "count" ? countN : null,
      issueMode,
      priceMode,
      sendChannel: issueMode === "issue" ? sendChannel : "none",
    };
    try {
      const { customerId: _c, ...patch } = body;
      const saved = profile ? await update.mutateAsync({ id: profile.id, body: patch }) : await create.mutateAsync(body);
      toast.success(saved.nextRunDate ? t("billing.recurring.form.saved", { date: formatDate(saved.nextRunDate) }) : t("billing.recurring.form.savedEnded"));
      navigate(`recurring/${saved.id}`, { replace: true });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const saveLabel = editing ? t("billing.recurring.form.saveChanges") : t("billing.recurring.form.save");
  const dates = preview.data?.dates ?? [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid min-w-0 gap-section">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("billing.recurring.form.customer")}</CardTitle>
            <CardDescription>{t("billing.recurring.form.customerSaved")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {editing ? (
              <p className="text-sm font-medium">{profile.customerName}</p>
            ) : (
              <>
                <CustomerPicker value={party} onChange={setParty} invalid={submitted && !!errors.customer} />
                {submitted && errors.customer && <p className="text-meta text-destructive">{errors.customer}</p>}
              </>
            )}
            <PriceListPicker value={priceListId} onChange={setPriceListId} customerId={party.kind === "saved" ? party.customer.id : null} />
            <Field id="rc-name">
              <FieldLabel>{t("billing.recurring.form.name")}</FieldLabel>
              <Input id="rc-name" maxLength={120} value={name} placeholder={t("billing.recurring.form.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
              <FieldHint>{t("billing.recurring.form.nameHint")}</FieldHint>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClockIcon className="size-4 text-primary" /> {t("billing.recurring.form.schedule")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-4 sm:grid-cols-2">
            <Field id="rc-frequency" className="sm:col-span-2">
              <FieldLabel>{t("billing.recurring.form.frequency")}</FieldLabel>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("billing.recurring.form.frequency")}>
                {RECURRING_FREQUENCIES.map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={frequency === f} onClick={() => setFrequency(f)} className={chip(frequency === f)}>
                    {t(`billing.recurring.frequency.${f}`)}
                  </button>
                ))}
              </div>
            </Field>
            <Field id="rc-interval">
              <FieldLabel>{t("billing.recurring.form.interval")}</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="rc-interval"
                  inputMode="numeric"
                  className="w-20 text-right tabular-nums"
                  aria-invalid={!!errors.interval}
                  value={interval}
                  onChange={(e) => setInterval(e.target.value.replace(/\D/g, "").slice(0, 2))}
                />
                <span className="text-sm text-muted-foreground">{t(`billing.recurring.form.intervalUnit.${frequency}`)}</span>
              </div>
              {errors.interval && <p className="text-meta text-destructive">{errors.interval}</p>}
            </Field>
            {weekly ? (
              <Field id="rc-weekday">
                <FieldLabel>{t("billing.recurring.form.weekday")}</FieldLabel>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("billing.recurring.form.weekday")}>
                  {WEEKDAYS.map((d) => (
                    <button key={d} type="button" role="radio" aria-checked={weekday === d} onClick={() => setWeekday(d)} className={chip(weekday === d)}>
                      {t(`billing.recurring.weekday.${d}`)}
                    </button>
                  ))}
                </div>
              </Field>
            ) : (
              <Field id="rc-day">
                <FieldLabel>{t("billing.recurring.form.dayOfMonth")}</FieldLabel>
                <Input id="rc-day" inputMode="numeric" className="w-20 text-right tabular-nums" aria-invalid={!!errors.day} value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                <FieldHint>{t("billing.recurring.form.dayHint")}</FieldHint>
                {errors.day && <p className="text-meta text-destructive">{errors.day}</p>}
              </Field>
            )}
            <Field id="rc-start">
              <FieldLabel>{t("billing.recurring.form.startDate")}</FieldLabel>
              <Input id="rc-start" type="date" value={startDate} required onChange={(e) => setStartDate(e.target.value || todayIST())} />
            </Field>
            <Field id="rc-due">
              <FieldLabel>{t("billing.recurring.form.dueDays")}</FieldLabel>
              <Input id="rc-due" inputMode="numeric" className="w-24 text-right tabular-nums" aria-invalid={!!errors.dueDays} value={dueDays} onChange={(e) => setDueDays(e.target.value.replace(/\D/g, "").slice(0, 3))} />
              <FieldHint>{t("billing.recurring.form.dueHint")}</FieldHint>
            </Field>
            <Field id="rc-end" className="sm:col-span-2">
              <FieldLabel>{t("billing.recurring.form.end")}</FieldLabel>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("billing.recurring.form.end")}>
                {(["never", "date", "count"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={endMode === m} onClick={() => setEndMode(m)} className={chip(endMode === m)}>
                    {t(m === "never" ? "billing.recurring.form.endNever" : m === "date" ? "billing.recurring.form.endOn" : "billing.recurring.form.endAfter")}
                  </button>
                ))}
              </div>
              {endMode === "date" && (
                <div className="mt-2 grid gap-1">
                  <Label htmlFor="rc-end-date">{t("billing.recurring.form.endDate")}</Label>
                  <Input id="rc-end-date" type="date" className="w-44" min={startDate} aria-invalid={!!errors.endDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  {submitted && errors.endDate && <p className="text-meta text-destructive">{errors.endDate}</p>}
                </div>
              )}
              {endMode === "count" && (
                <div className="mt-2 grid gap-1">
                  <Label htmlFor="rc-count">{t("billing.recurring.form.maxCount")}</Label>
                  <Input id="rc-count" inputMode="numeric" className="w-24 text-right tabular-nums" aria-invalid={!!errors.maxCount} value={maxCount} onChange={(e) => setMaxCount(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                  {errors.maxCount && <p className="text-meta text-destructive">{errors.maxCount}</p>}
                </div>
              )}
            </Field>
            <div className="rounded-xl border bg-muted/40 p-3 text-sm sm:col-span-2" aria-live="polite">
              <p className="font-medium">{scheduleOk ? schedule({ frequency, interval: n ?? 1, dayOfMonth: dayN, weekday, startDate }) : "—"}</p>
              <p className="mt-1 text-meta text-muted-foreground">{t("billing.recurring.form.preview")}</p>
              {preview.isError ? (
                <p className="text-meta text-warning-ink">{describeError(preview.error, t)}</p>
              ) : dates.length ? (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {dates.map((d) => (
                    <li key={d} className="rounded-full bg-card px-2.5 py-0.5 text-xs tabular-nums ring-1 ring-border">
                      {formatDate(d)}
                    </li>
                  ))}
                </ul>
              ) : preview.isSuccess ? (
                <p className="text-meta text-warning-ink">{t("billing.recurring.form.previewNone")}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{t("billing.recurring.form.items")}</CardTitle>
            <span className="text-xs text-muted-foreground">{t("billing.form.lineCount", { count: filled.length })}</span>
          </CardHeader>
          <CardContent className="grid gap-3">
            <UnitList />
            <AnimatePresence initial={false}>
              {lines.map((l, i) => {
                const errs = submitted && !isBlank(l) ? (parsed[i]?.errors ?? {}) : {};
                const lt = lineTotals.get(l.key);
                return (
                  <motion.div
                    key={l.key}
                    layout
                    initial={{ opacity: 0, height: 0, scale: 0.98 }}
                    animate={{ opacity: 1, height: "auto", scale: 1 }}
                    exit={{ opacity: 0, height: 0, x: -24, transition: { duration: 0.2 } }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <LineRow
                      index={i}
                      line={l}
                      errors={errs}
                      lineTotal={lt?.total}
                      taxAmount={lt ? lt.cgst + lt.sgst + lt.igst : undefined}
                      autoFocus={focusKey === l.key}
                      onChange={(patch) => updateLine(l.key, patch)}
                      onRemove={() => removeLine(l.key)}
                      onEnterLast={i === lines.length - 1 ? addLine : undefined}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <Button type="button" variant="outline" className="h-11 rounded-xl border-dashed border-primary/30 text-primary hover:bg-primary/5 hover:text-primary" onClick={addLine}>
              <PlusIcon /> {t("billing.form.addLine")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("billing.recurring.form.howTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">{t("billing.recurring.form.mode")}</p>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("billing.recurring.form.mode")}>
                {(["draft", "issue"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={issueMode === m} onClick={() => setIssueMode(m)} className={choice(issueMode === m)}>
                    <span className="block text-sm font-semibold">{t(m === "draft" ? "billing.recurring.form.modeDraft" : "billing.recurring.form.modeIssue")}</span>
                    <span className="block text-meta text-muted-foreground">{t(m === "draft" ? "billing.recurring.form.modeDraftHint" : "billing.recurring.form.modeIssueHint")}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">{t("billing.recurring.form.prices")}</p>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("billing.recurring.form.prices")}>
                {(["fixed", "list"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={priceMode === m} onClick={() => setPriceMode(m)} className={chip(priceMode === m)}>
                    {t(m === "fixed" ? "billing.recurring.form.pricesFixed" : "billing.recurring.form.pricesList")}
                  </button>
                ))}
              </div>
              {priceMode === "list" && <p className="text-meta text-muted-foreground">{t("billing.recurring.form.pricesListHint")}</p>}
            </div>
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">{t("billing.recurring.form.send")}</p>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("billing.recurring.form.send")}>
                {SEND.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    disabled={issueMode !== "issue" && c !== "none"}
                    aria-checked={(issueMode === "issue" ? sendChannel : "none") === c}
                    onClick={() => setSendChannel(c)}
                    className={cn(chip((issueMode === "issue" ? sendChannel : "none") === c), "disabled:opacity-50")}
                  >
                    {t(c === "none" ? "billing.recurring.form.sendNone" : c === "whatsapp" ? "billing.recurring.form.sendWhatsapp" : "billing.recurring.form.sendSms")}
                  </button>
                ))}
              </div>
              <p className="text-meta text-muted-foreground">{issueMode === "issue" ? t("billing.recurring.form.sendHint") : t("billing.recurring.form.sendDraftHint")}</p>
            </div>
          </CardContent>
        </Card>

        {showNotes ? (
          <Card className="gap-2">
            <CardContent className="grid gap-1.5">
              <Label htmlFor="rc-notes">{t("billing.recurring.form.notes")}</Label>
              <Textarea id="rc-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </CardContent>
          </Card>
        ) : (
          <Button type="button" variant="ghost" className="justify-self-start text-muted-foreground" onClick={() => setShowNotes(true)}>
            <StickyNoteIcon /> {t("billing.form.addNotes")}
          </Button>
        )}
      </div>

      <div className="grid gap-section lg:sticky lg:top-20">
        <Card className="overflow-hidden pt-0">
          <div className="h-1.5 bg-gradient-to-r from-primary to-primary/40 print:hidden" aria-hidden />
          <CardHeader className="pt-1">
            <CardTitle className="text-sm">{t("billing.recurring.form.estimate")}</CardTitle>
            <CardDescription>{t("billing.recurring.form.estimateHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label={t("billing.totals.taxable")} value={money(totals.taxable)} />
            <Row label="GST" value={money(totals.cgst + totals.sgst + totals.igst)} />
            <div className="mt-2 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">{t("billing.totals.grandTotal")}</span>
              <AnimatedNumber value={totals.total} format={(x) => money(Math.round(x))} className="font-heading text-2xl font-bold text-primary tabular-nums" />
            </div>
            {dates[0] && (
              <p className="text-meta text-muted-foreground">
                {t("billing.recurring.detail.next")}: <span className="tabular-nums">{formatDate(dates[0])}</span>
              </p>
            )}
          </CardContent>
        </Card>
        <Button size="lg" className="h-12 rounded-xl text-base" disabled={busy} onClick={() => void submit()}>
          {busy ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
