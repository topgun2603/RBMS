"use client";

import * as React from "react";
import { BellRingIcon, CalendarClockIcon, CheckCheckIcon, Loader2Icon, LockIcon, PlusIcon, ReceiptIcon, SaveIcon, XIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  motion,
  Skeleton,
  Stagger,
  StaggerItem,
  Switch,
  toast,
  useReducedMotionSafe,
} from "@rbms/ui";
import { canManageShop, describeError, Page, PageHeading, QueryError, SettingsNav, useI18n, useMe, useShop } from "@rbms/web";
import { fullProfile, MAX_REMINDER_DAYS, SELLER_DEFAULTS } from "../components/payments/seller-defaults";
import { addDays, money, todayIST } from "../lib/format";
import { useSaveSellerProfile, useSellerProfile } from "../lib/queries";
import type { SellerProfile } from "../lib/types";

const PRESET_DAYS = [1, 3, 7, 15, 30] as const;

export default function RemindersSettingsPage() {
  const { t } = useI18n();
  const me = useMe();
  const profile = useSellerProfile();
  const canEdit = canManageShop(me.data);

  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={BellRingIcon} title={t("billing.reminders.title")} description={t("billing.reminders.subtitle")} />
      {!canEdit && !me.isPending && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground ring-1 ring-border ring-inset">
          <LockIcon className="size-4 shrink-0" /> {t("billing.reminders.readOnly")}
        </p>
      )}
      {profile.isError ? (
        <QueryError error={profile.error} onRetry={() => void profile.refetch()} />
      ) : profile.isPending ? (
        <div className="grid gap-section">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : (
        <RemindersForm profile={profile.data} canEdit={canEdit} />
      )}
    </Page>
  );
}

interface State {
  autoReminders: boolean;
  reminderDays: number[];
  sendPaymentReceipts: boolean;
}

const stateFrom = (p: Partial<SellerProfile>): State => ({
  autoReminders: p.autoReminders ?? SELLER_DEFAULTS.autoReminders,
  reminderDays: [...new Set(p.reminderDays ?? SELLER_DEFAULTS.reminderDays)].sort((a, b) => a - b),
  sendPaymentReceipts: p.sendPaymentReceipts ?? SELLER_DEFAULTS.sendPaymentReceipts,
});

const same = (a: State, b: State) =>
  a.autoReminders === b.autoReminders && a.sendPaymentReceipts === b.sendPaymentReceipts && a.reminderDays.join(",") === b.reminderDays.join(",");

function RemindersForm({ profile, canEdit }: { profile: Partial<SellerProfile>; canEdit: boolean }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const save = useSaveSellerProfile();
  const initial = React.useMemo(() => stateFrom(profile), [profile]);
  const [s, setS] = React.useState<State>(initial);
  const [custom, setCustom] = React.useState("");
  const [customError, setCustomError] = React.useState<string | null>(null);
  React.useEffect(() => setS(initial), [initial]);

  const dirty = !same(s, initial);
  const full = s.reminderDays.length >= MAX_REMINDER_DAYS;
  const customDays = s.reminderDays.filter((d) => !(PRESET_DAYS as readonly number[]).includes(d));

  const toggleDay = (d: number) =>
    setS((cur) => {
      if (cur.reminderDays.includes(d)) return { ...cur, reminderDays: cur.reminderDays.filter((x) => x !== d) };
      if (cur.reminderDays.length >= MAX_REMINDER_DAYS) return cur;
      return { ...cur, reminderDays: [...cur.reminderDays, d].sort((a, b) => a - b) };
    });

  const addCustom = () => {
    const n = Number(custom.trim());
    if (!Number.isInteger(n) || n < 1 || n > 365) return setCustomError(t("billing.reminders.customInvalid"));
    if (s.reminderDays.includes(n)) return setCustomError(t("billing.reminders.customExists", { n }));
    if (full) return setCustomError(t("billing.reminders.maxDays", { max: MAX_REMINDER_DAYS }));
    setCustomError(null);
    setCustom("");
    toggleDay(n);
  };

  const submit = async () => {
    try {
      await save.mutateAsync(fullProfile(profile, s));
      toast.success(t("billing.reminders.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const disabled = !canEdit || save.isPending;

  return (
    <Stagger className="grid gap-4 pb-4">
      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="icon-chip size-9 text-primary">
                <CalendarClockIcon className="size-4" />
              </span>
              {t("billing.reminders.autoTitle")}
            </CardTitle>
            <CardDescription>{t("billing.reminders.autoHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="flex min-h-11 items-center justify-between gap-4 rounded-xl border bg-muted/30 px-4 py-3">
              <span>
                <span className="block text-sm font-medium">{t("billing.reminders.autoLabel")}</span>
                <span className="block text-xs text-muted-foreground">{t("billing.reminders.autoWhen")}</span>
              </span>
              <Switch
                checked={s.autoReminders}
                disabled={disabled}
                onCheckedChange={(v) => setS((c) => ({ ...c, autoReminders: v }))}
                aria-label={t("billing.reminders.autoLabel")}
              />
            </label>

            <fieldset disabled={disabled || !s.autoReminders} className={cn("grid gap-3 transition-opacity", !s.autoReminders && "opacity-60")}>
              <legend className="mb-2 text-sm font-medium">{t("billing.reminders.daysLabel")}</legend>
              <div className="flex flex-wrap gap-2">
                {PRESET_DAYS.map((d) => {
                  const on = s.reminderDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      disabled={!on && full}
                      onClick={() => toggleDay(d)}
                      className={cn(
                        "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-[color,background-color,border-color,transform] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:active:scale-100",
                        on
                          ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {on && <CheckCheckIcon className="size-4" />}
                      {t("billing.reminders.dayChip", { count: d })}
                    </button>
                  );
                })}
                <AnimatePresence initial={false}>
                  {customDays.map((d) => (
                    <motion.span
                      key={d}
                      layout={!reduced}
                      initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                      className="inline-flex h-11 items-center gap-1 rounded-full border border-primary bg-primary pr-1 pl-4 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20"
                    >
                      {t("billing.reminders.dayChip", { count: d })}
                      <button
                        type="button"
                        onClick={() => toggleDay(d)}
                        className="inline-flex size-9 items-center justify-center rounded-full outline-none hover:bg-primary-foreground/15 focus-visible:ring-2 focus-visible:ring-primary-foreground/60"
                        aria-label={t("billing.reminders.removeDay", { count: d })}
                      >
                        <XIcon className="size-4" />
                      </button>
                    </motion.span>
                  ))}
                </AnimatePresence>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="custom-day" className="text-xs font-normal text-muted-foreground">
                  {t("billing.reminders.customLabel")}
                </Label>
                <div className="flex items-start gap-2">
                  <Input
                    id="custom-day"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={365}
                    className="w-32"
                    placeholder="45"
                    value={custom}
                    aria-invalid={!!customError}
                    aria-describedby="custom-day-hint"
                    onChange={(e) => {
                      setCustom(e.target.value);
                      setCustomError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustom();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addCustom}>
                    <PlusIcon /> {t("billing.reminders.add")}
                  </Button>
                </div>
                {customError ? (
                  <p id="custom-day-hint" className="text-xs text-destructive" role="alert">
                    {customError}
                  </p>
                ) : (
                  <p id="custom-day-hint" className="text-xs text-muted-foreground">{t("billing.reminders.maxDays", { max: MAX_REMINDER_DAYS })}</p>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {s.reminderDays.length === 0
                  ? t("billing.reminders.noDays")
                  : t("billing.reminders.summary", { days: s.reminderDays.join(", "), count: s.reminderDays.length })}
              </p>
            </fieldset>
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardContent>
            <label className="flex min-h-11 items-center justify-between gap-4">
              <span className="flex items-start gap-3">
                <span className="icon-chip size-9 text-success-ink">
                  <ReceiptIcon className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{t("billing.reminders.receiptsLabel")}</span>
                  <span className="block text-xs text-muted-foreground">{t("billing.reminders.receiptsHint")}</span>
                </span>
              </span>
              <Switch
                checked={s.sendPaymentReceipts}
                disabled={disabled}
                onCheckedChange={(v) => setS((c) => ({ ...c, sendPaymentReceipts: v }))}
                aria-label={t("billing.reminders.receiptsLabel")}
              />
            </label>
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <MessagePreview state={s} />
      </StaggerItem>

      {canEdit && (
        <div className="sticky bottom-20 z-30 flex justify-end rounded-2xl border border-border/70 bg-card/90 p-3 shadow-[0_8px_24px_-12px_oklch(0_0_0/0.25)] backdrop-blur-md md:bottom-4">
          <Button size="lg" className="h-11" disabled={save.isPending || !dirty} onClick={() => void submit()}>
            {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {t("billing.reminders.save")}
          </Button>
        </div>
      )}
    </Stagger>
  );
}

/** What the customer sees on WhatsApp (sample data; the real text comes from the shop's notify templates). */
function MessagePreview({ state }: { state: State }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const { shopName } = useShop();
  const day = state.reminderDays[0] ?? 7;
  const today = todayIST();
  const vars = {
    shop: shopName,
    customer: t("billing.reminders.sampleCustomer"),
    number: "INV/26-27/0042",
    amount: money(245000),
    dueDate: formatDate(addDays(today, -day)),
    link: "https://…/i/a1b2c3",
    balance: money(0),
  };
  const bubbles = [
    state.autoReminders && { key: "reminder", label: t("billing.timeline.reminder"), text: t("billing.reminders.previewReminder", vars) },
    state.sendPaymentReceipts && { key: "receipt", label: t("billing.timeline.receipt"), text: t("billing.reminders.previewReceipt", vars) },
  ].filter(Boolean) as { key: string; label: string; text: string }[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("billing.reminders.previewTitle")}</CardTitle>
        <CardDescription>{t("billing.reminders.previewHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 rounded-2xl bg-[color-mix(in_oklch,var(--success)_8%,var(--muted))] p-4 ring-1 ring-border ring-inset">
          <AnimatePresence initial={false} mode="popLayout">
            {bubbles.length === 0 ? (
              <motion.p key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-6 text-center text-sm text-muted-foreground">
                {t("billing.reminders.previewNone")}
              </motion.p>
            ) : (
              bubbles.map((b) => (
                <motion.div
                  key={b.key}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  className="max-w-[90%] justify-self-start"
                >
                  <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{b.label}</p>
                  <div className="relative rounded-2xl rounded-tl-sm bg-card px-3.5 py-2.5 text-sm whitespace-pre-line shadow-raised ring-1 ring-card-ring">
                    {b.text}
                    <span className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                      10:00 <CheckCheckIcon className="size-3.5 text-info-ink" aria-hidden />
                    </span>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
