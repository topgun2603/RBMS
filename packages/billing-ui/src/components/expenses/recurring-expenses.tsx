"use client";

import * as React from "react";
import { CalendarClockIcon, Loader2Icon, PauseIcon, PlayIcon, PlusIcon, RepeatIcon, SkipForwardIcon, SquareIcon, Trash2Icon, ZapIcon } from "lucide-react";
import {
  Button,
  Card,
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
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, useCurrentBranch, useI18n, useMyBranches } from "@srirealtime/web";
import { GstRateSelect } from "../gst-rate-select";
import { MoneyInput } from "../money-input";
import { SupplierPicker, type SupplierParty } from "../inventory/supplier-picker";
import { categoryLabel } from "./expense-dialog";
import { money, paiseToInput, rupeesToPaise, todayIST } from "../../lib/format";
import {
  EXPENSE_PAYMENT_METHODS,
  RECURRING_FREQUENCIES,
  useDeleteRecurringExpense,
  useExpenseCategories,
  useRecurringAction,
  useRecurringExpense,
  useRecurringExpenses,
  useRecurringPreview,
  useSaveRecurringExpense,
  type ExpensePaymentMethod,
  type RecurringAction,
  type RecurringExpense,
  type RecurringFrequency,
  type RecurringMode,
} from "../../lib/expenses";

const SHOP_WIDE = "shop-wide";
const STATUS_TONE = { active: "success", paused: "warning", ended: "neutral" } as const;

/** Rent, electricity, subscriptions …: what repeats, when it is next, and the actions. */
export function RecurringExpensesPanel() {
  const { t, formatDate } = useI18n();
  const list = useRecurringExpenses();
  const action = useRecurringAction();
  const [dialog, setDialog] = React.useState<{ id: string | null } | null>(null);
  const items = list.data?.items ?? [];

  const run = async (r: RecurringExpense, a: RecurringAction) => {
    try {
      await action.mutateAsync({ id: r.id, action: a });
      toast.success(t(`billing.expenses.rec.done.${a}`, { name: r.name }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const addButton = (
    <Button size="lg" className="h-11" onClick={() => setDialog({ id: null })}>
      <PlusIcon /> {t("billing.expenses.rec.add")}
    </Button>
  );

  return (
    <section aria-label={t("billing.expenses.rec.title")} className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-meta text-muted-foreground">{t("billing.expenses.rec.hint")}</p>
        {items.length > 0 && addButton}
      </div>
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">{t("billing.payables.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={RepeatIcon} title={t("billing.expenses.rec.emptyTitle")} description={t("billing.expenses.rec.emptyBody")} action={addButton} />
      ) : (
        <ul className="grid gap-2">
          {items.map((r) => (
            <li key={r.id}>
              <Card className="px-card flex flex-wrap items-center gap-3 py-3">
                <button type="button" className="grid min-w-0 flex-1 text-left" onClick={() => setDialog({ id: r.id })}>
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold text-primary underline-offset-4 hover:underline">{r.name}</span>
                    <StatusPill tone={STATUS_TONE[r.status]}>{t(`billing.expenses.rec.status.${r.status}`)}</StatusPill>
                  </span>
                  <span className="text-meta text-muted-foreground tabular-nums">
                    {scheduleText(t, r)} · {r.amount === null ? t("billing.expenses.rec.askEachTime") : money(r.amount)}
                    {r.mode === "draft" && r.amount !== null ? ` · ${t("billing.expenses.rec.modeDraftShort")}` : ""}
                  </span>
                  <span className="text-meta text-muted-foreground tabular-nums">
                    {r.nextRunDate ? t("billing.expenses.rec.next", { date: formatDate(r.nextRunDate) }) : t("billing.expenses.rec.noNext")}
                  </span>
                </button>
                <div className="flex flex-wrap gap-1.5">
                  {r.status === "active" && (
                    <>
                      <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => void run(r, "run")}>
                        <ZapIcon /> {t("billing.expenses.rec.runNow")}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={action.isPending} onClick={() => void run(r, "skip")}>
                        <SkipForwardIcon /> {t("billing.expenses.rec.skip")}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={action.isPending} onClick={() => void run(r, "pause")}>
                        <PauseIcon /> {t("billing.expenses.rec.pause")}
                      </Button>
                    </>
                  )}
                  {r.status === "paused" && (
                    <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => void run(r, "resume")}>
                      <PlayIcon /> {t("billing.expenses.rec.resume")}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <RecurringExpenseDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} id={dialog?.id ?? null} />
    </section>
  );
}

type T = ReturnType<typeof useI18n>["t"];

/** "Every month on the 5th", "Every 2 weeks on Monday" … */
export function scheduleText(t: T, r: Pick<RecurringExpense, "frequency" | "interval" | "dayOfMonth" | "weekday">): string {
  const every = t(`billing.expenses.rec.every.${r.frequency}`, { count: r.interval });
  if (r.frequency === "weekly") return r.weekday === null ? every : `${every} · ${t(`billing.expenses.rec.weekdays.${r.weekday}`)}`;
  return r.dayOfMonth === null ? every : `${every} · ${t("billing.expenses.rec.onDay", { day: r.dayOfMonth })}`;
}

interface Form {
  name: string;
  categoryId: string;
  amount: string;
  ask: boolean;
  gstRate: string;
  method: ExpensePaymentMethod;
  dueDays: string;
  mode: RecurringMode;
  frequency: RecurringFrequency;
  interval: string;
  dayOfMonth: string;
  weekday: string;
  startDate: string;
  endDate: string;
  note: string;
  branch: string;
}

const blank = (branch: string): Form => ({
  name: "",
  categoryId: "",
  amount: "",
  ask: false,
  gstRate: "0",
  method: "bank",
  dueDays: "",
  mode: "auto",
  frequency: "monthly",
  interval: "1",
  dayOfMonth: String(Math.min(Number(todayIST().slice(8, 10)), 28)),
  weekday: "1",
  startDate: todayIST(),
  endDate: "",
  note: "",
  branch,
});

/** Set up or edit a recurring expense, with the next dates and the history of what it made. */
function RecurringExpenseDialog({ open, onOpenChange, id }: { open: boolean; onOpenChange: (o: boolean) => void; id: string | null }) {
  const { t, formatDate } = useI18n();
  const detail = useRecurringExpense(open ? id : null);
  const categories = useExpenseCategories(open);
  const save = useSaveRecurringExpense();
  const del = useDeleteRecurringExpense();
  const action = useRecurringAction();
  const branches = useMyBranches();
  const current = useCurrentBranch();
  const branchList = branches.data?.items ?? [];
  const [f, setF] = React.useState<Form>(() => blank(""));
  const [party, setParty] = React.useState<SupplierParty>({ kind: "none" });
  const [touched, setTouched] = React.useState(false);
  const [confirm, setConfirm] = React.useState<null | "delete" | "end">(null);
  const r = id ? detail.data : undefined;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  React.useEffect(() => {
    if (!open) return;
    setTouched(false);
    if (!id) {
      setF(blank(branchList.length ? (current?.id ?? SHOP_WIDE) : ""));
      setParty({ kind: "none" });
      return;
    }
    if (!r) return;
    setF({
      name: r.name,
      categoryId: r.categoryId,
      amount: r.amount === null ? "" : paiseToInput(r.amount),
      ask: r.amount === null,
      gstRate: String(r.gstRate),
      method: r.paymentMethod,
      dueDays: r.dueDays === null ? "" : String(r.dueDays),
      mode: r.mode,
      frequency: r.frequency,
      interval: String(r.interval),
      dayOfMonth: r.dayOfMonth === null ? "" : String(r.dayOfMonth),
      weekday: r.weekday === null ? "1" : String(r.weekday),
      startDate: r.startDate,
      endDate: r.endDate ?? "",
      note: r.note ?? "",
      branch: r.branchId ?? (branchList.length ? SHOP_WIDE : ""),
    });
    setParty(
      r.supplierId
        ? { kind: "saved", supplier: { id: r.supplierId, name: r.vendorName ?? "", gstin: r.vendorGstin, phone: null, email: null, address: null, stateCode: null, payable: 0, createdAt: "" } }
        : { kind: "none" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fill when opened / loaded
  }, [open, id, r?.id, branchList.length]);

  const weekly = f.frequency === "weekly";
  const schedule = {
    frequency: f.frequency,
    interval: Math.max(1, Number(f.interval) || 1),
    dayOfMonth: weekly ? null : f.dayOfMonth ? Number(f.dayOfMonth) : null,
    weekday: weekly ? Number(f.weekday) : null,
    startDate: f.startDate,
    endDate: f.endDate || null,
  };
  const preview = useRecurringPreview(schedule, open && (!r || r.status !== "ended"));
  const amountPaise = f.ask ? null : rupeesToPaise(f.amount);
  const credit = f.method === "credit";
  const error = !f.name.trim()
    ? t("billing.expenses.rec.errors.name")
    : !f.ask && (amountPaise === null || amountPaise <= 0)
      ? t("billing.validation.amount")
      : credit && party.kind !== "saved"
        ? t("billing.expenses.b.creditNeedsSupplier")
        : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (error) return;
    const supplier = party.kind === "saved" ? party.supplier : null;
    try {
      await save.mutateAsync({
        id: id ?? undefined,
        body: {
          name: f.name.trim(),
          ...(f.categoryId ? { categoryId: f.categoryId } : {}),
          supplierId: supplier?.id ?? null,
          vendorName: supplier?.name ?? null,
          vendorGstin: supplier?.gstin ?? null,
          ...(f.branch ? { branchId: f.branch === SHOP_WIDE ? null : f.branch } : {}),
          amount: amountPaise,
          gstRate: Number(f.gstRate) || 0,
          paymentMethod: f.method,
          dueDays: credit && f.dueDays ? Number(f.dueDays) : null,
          note: f.note.trim() || null,
          mode: f.mode,
          ...schedule,
        },
      });
      toast.success(id ? t("billing.expenses.rec.saved") : t("billing.expenses.rec.created", { name: f.name.trim() }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const ended = r?.status === "ended";
  const busy = save.isPending || del.isPending || action.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" closeLabel={t("billing.common.close")}>
          <DialogHeader>
            <DialogTitle>{id ? (r?.name ?? t("billing.expenses.rec.title")) : t("billing.expenses.rec.addTitle")}</DialogTitle>
            <DialogDescription>{ended ? t("billing.expenses.rec.endedHint") : t("billing.expenses.rec.dialogHint")}</DialogDescription>
          </DialogHeader>
          {id && !r ? (
            <p className="text-sm text-muted-foreground">{t("billing.payables.loading")}</p>
          ) : (
            <form onSubmit={submit} className="grid gap-5" noValidate>
              <fieldset disabled={ended} className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="re-name">{t("billing.expenses.rec.name")}</Label>
                  <Input id="re-name" autoFocus={!id} placeholder={t("billing.expenses.rec.namePlaceholder")} value={f.name} aria-invalid={touched && !f.name.trim()} onChange={(e) => set("name", e.target.value)} />
                </div>
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label>{t("billing.expenses.category")}</Label>
                    <Select value={f.categoryId} onValueChange={(v) => set("categoryId", v)}>
                      <SelectTrigger className="w-full" aria-label={t("billing.expenses.category")}>
                        <SelectValue placeholder={t("billing.expenses.pickCategory")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(categories.data ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {categoryLabel(t, c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("billing.expenses.gstRate")}</Label>
                    <GstRateSelect value={f.gstRate} onChange={(v) => set("gstRate", v)} className="w-full" aria-label={t("billing.expenses.gstRate")} />
                  </div>
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="re-amount">{t("billing.expenses.amount")}</Label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={f.ask} onCheckedChange={(v) => set("ask", v)} aria-label={t("billing.expenses.rec.askEachTime")} />
                      {t("billing.expenses.rec.askEachTime")}
                    </label>
                  </div>
                  {f.ask ? (
                    <p className="rounded-xl border border-dashed px-3 py-2.5 text-meta text-muted-foreground">{t("billing.expenses.rec.askHint")}</p>
                  ) : (
                    <MoneyInput id="re-amount" value={f.amount} aria-invalid={touched && (amountPaise === null || amountPaise <= 0)} onChange={(e) => set("amount", e.target.value)} />
                  )}
                </div>

                <div className="grid gap-2">
                  <Label>{t("billing.expenses.rec.makes")}</Label>
                  <ChipGroup
                    size="sm"
                    aria-label={t("billing.expenses.rec.makes")}
                    value={f.ask ? "draft" : f.mode}
                    onChange={(v) => !f.ask && set("mode", v as RecurringMode)}
                    options={[
                      { value: "auto", label: t("billing.expenses.rec.modeAuto") },
                      { value: "draft", label: t("billing.expenses.rec.modeDraft") },
                    ]}
                  />
                  <p className="text-meta text-muted-foreground">{f.ask || f.mode === "draft" ? t("billing.expenses.rec.modeDraftHint") : t("billing.expenses.rec.modeAutoHint")}</p>
                </div>

                <div className="grid gap-2">
                  <span className="text-sm leading-none font-medium">
                    {t("billing.expenses.b.supplier")}
                    {!credit && <span className="font-normal text-muted-foreground"> ({t("billing.common.optional")})</span>}
                  </span>
                  <SupplierPicker value={party} onChange={(p) => setParty(p.kind === "oneoff" ? { kind: "none" } : p)} invalid={touched && credit && party.kind !== "saved"} />
                </div>

                <div className="grid gap-2">
                  <Label>{t("billing.expenses.method")}</Label>
                  <ChipGroup
                    size="sm"
                    aria-label={t("billing.expenses.method")}
                    value={f.method}
                    onChange={(v) => set("method", v as ExpensePaymentMethod)}
                    options={EXPENSE_PAYMENT_METHODS.map((m) => ({ value: m, label: m === "credit" ? t("billing.expenses.b.onCredit") : t(`billing.payment.methods.${m}`) }))}
                  />
                </div>

                {(credit || branchList.length > 0) && (
                  <div className="grid items-start gap-4 sm:grid-cols-2">
                    {credit && (
                      <div className="grid gap-1.5">
                        <Label htmlFor="re-due">{t("billing.expenses.rec.dueDays")}</Label>
                        <Input id="re-due" type="number" inputMode="numeric" min={0} max={365} value={f.dueDays} onChange={(e) => set("dueDays", e.target.value)} />
                      </div>
                    )}
                    {branchList.length > 0 && (
                      <div className="grid gap-1.5">
                        <Label>{t("billing.expenses.b.branch")}</Label>
                        <Select value={f.branch || SHOP_WIDE} onValueChange={(v) => set("branch", v)}>
                          <SelectTrigger className="w-full" aria-label={t("billing.expenses.b.branch")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SHOP_WIDE}>{t("billing.expenses.b.shopWide")}</SelectItem>
                            {branchList.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-2 rounded-xl border border-card-ring p-3">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <CalendarClockIcon className="size-4" /> {t("billing.expenses.rec.schedule")}
                  </span>
                  <ChipGroup
                    size="sm"
                    aria-label={t("billing.expenses.rec.frequency")}
                    value={f.frequency}
                    onChange={(v) => set("frequency", v as RecurringFrequency)}
                    options={RECURRING_FREQUENCIES.map((fr) => ({ value: fr, label: t(`billing.expenses.rec.freq.${fr}`) }))}
                  />
                  <div className="grid items-start gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="re-int">{t("billing.expenses.rec.interval")}</Label>
                      <Input id="re-int" type="number" inputMode="numeric" min={1} max={24} value={f.interval} onChange={(e) => set("interval", e.target.value)} />
                    </div>
                    {weekly ? (
                      <div className="grid gap-1.5">
                        <Label>{t("billing.expenses.rec.weekday")}</Label>
                        <Select value={f.weekday} onValueChange={(v) => set("weekday", v)}>
                          <SelectTrigger className="w-full" aria-label={t("billing.expenses.rec.weekday")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                              <SelectItem key={d} value={String(d)}>
                                {t(`billing.expenses.rec.weekdays.${d}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="grid gap-1.5">
                        <Label htmlFor="re-day">{t("billing.expenses.rec.dayOfMonth")}</Label>
                        <Input id="re-day" type="number" inputMode="numeric" min={1} max={31} value={f.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} />
                      </div>
                    )}
                    <div className="grid gap-1.5">
                      <Label htmlFor="re-start">{t("billing.expenses.rec.startDate")}</Label>
                      <Input id="re-start" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="re-end">
                        {t("billing.expenses.rec.endDate")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
                      </Label>
                      <Input id="re-end" type="date" min={f.startDate || undefined} value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
                    </div>
                  </div>
                  <p className="text-meta text-muted-foreground tabular-nums" aria-live="polite">
                    {preview.isError
                      ? describeError(preview.error, t)
                      : preview.data?.dates.length
                        ? t("billing.expenses.rec.preview", { dates: preview.data.dates.map((d) => formatDate(d, { day: "numeric", month: "short" })).join(", ") })
                        : t("billing.expenses.rec.previewNone")}
                  </p>
                  <p className="text-meta text-muted-foreground">{t("billing.expenses.rec.lockHint")}</p>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="re-note">{t("billing.expenses.note")}</Label>
                  <Textarea id="re-note" rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} />
                </div>
              </fieldset>

              {touched && error && <p className="text-sm text-destructive">{error}</p>}

              {r && r.runs.length > 0 && (
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("billing.expenses.rec.history")}</span>
                  <ul className="grid max-h-48 gap-1 overflow-y-auto text-sm">
                    {r.runs.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-3 tabular-nums">
                        <span>{formatDate(x.runDate)}</span>
                        <span className="text-muted-foreground">{t(`billing.expenses.rec.runStatus.${x.status}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <DialogFooter className="gap-2 sm:justify-between">
                {r ? (
                  <div className="flex gap-1">
                    {r.count === 0 ? (
                      <Button type="button" variant="ghost" size="lg" className="text-danger-ink" disabled={busy} onClick={() => setConfirm("delete")}>
                        <Trash2Icon /> {t("billing.expenses.rec.delete")}
                      </Button>
                    ) : !ended ? (
                      <Button type="button" variant="ghost" size="lg" className="text-danger-ink" disabled={busy} onClick={() => setConfirm("end")}>
                        <SquareIcon /> {t("billing.expenses.rec.end")}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <span />
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
                    {ended ? t("billing.common.close") : t("billing.common.cancel")}
                  </Button>
                  {!ended && (
                    <Button type="submit" size="lg" disabled={busy}>
                      {save.isPending && <Loader2Icon className="animate-spin" />}
                      {t("billing.common.save")}
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "delete" ? t("billing.expenses.rec.deleteTitle") : t("billing.expenses.rec.endTitle")}
        description={confirm === "delete" ? t("billing.expenses.rec.deleteBody") : t("billing.expenses.rec.endBody")}
        confirmLabel={confirm === "delete" ? t("billing.expenses.rec.delete") : t("billing.expenses.rec.end")}
        onConfirm={async () => {
          if (!id) return;
          try {
            if (confirm === "delete") await del.mutateAsync(id);
            else await action.mutateAsync({ id, action: "end" });
            toast.success(confirm === "delete" ? t("billing.expenses.rec.deleted") : t("billing.expenses.rec.done.end", { name: r?.name ?? "" }));
            onOpenChange(false);
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </>
  );
}
