"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, GiftIcon, HourglassIcon, Loader2Icon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { api } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";
import { usePlans } from "@/lib/queries";
import { useSubsT } from "@/lib/subscriptions-messages";
import type { AdminPlatformInvoice, AdminSubscription } from "@/lib/types";

export const SUBS_KEY = ["platform", "subscriptions"] as const;

const DAY = 86_400_000;

function ErrorLine({ error }: { error: unknown }) {
  const { t } = useI18n();
  return (
    <AnimatePresence initial={false}>
      {error ? (
        <motion.p
          key="err"
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="flex items-start gap-2 overflow-hidden rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-danger-ink"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {describeError(error, t)}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

/** Keeps the last non-null value while a dialog animates closed. */
function useLast<T>(value: T | null): T | null {
  const [last, setLast] = React.useState<T | null>(value);
  React.useEffect(() => {
    if (value) setLast(value);
  }, [value]);
  return value ?? last;
}

const shopName = (s: AdminSubscription) => s.tenant?.name ?? s.tenantId.slice(0, 8);

export function ExtendTrialDialog({ sub, onClose }: { sub: AdminSubscription | null; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const k = useSubsT();
  const qc = useQueryClient();
  const s = useLast(sub);
  const [days, setDays] = React.useState("7");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (sub) {
      setDays("7");
      setTouched(false);
    }
  }, [sub]);
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 365;
  const base = s?.status === "trialing" && s.trialEndsAt && Date.parse(s.trialEndsAt) > Date.now() ? Date.parse(s.trialEndsAt) : Date.now();
  const newEnd = valid ? new Date(base + n * DAY) : null;

  const save = useMutation({
    mutationFn: () => api.post(`/subscriptions/admin/${s!.tenantId}/extend-trial`, { days: n }, { tenant: null }),
    onSuccess: () => {
      toast.success(k("admin.subs.extend.done", { date: newEnd ? formatDate(newEnd) : "" }));
      void qc.invalidateQueries({ queryKey: SUBS_KEY });
      onClose();
    },
  });
  React.useEffect(() => {
    if (sub) save.reset();
  }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={!!sub} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("admin.common.close")}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (valid && !save.isPending) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HourglassIcon className="size-5 text-primary" /> {k("admin.subs.extend.title", { shop: s ? shopName(s) : "" })}
            </DialogTitle>
            <DialogDescription>{k("admin.subs.extend.body")}</DialogDescription>
          </DialogHeader>
          <ChipGroup
            aria-label={k("admin.subs.extend.days")}
            size="sm"
            value={["7", "14", "30"].includes(days) ? days : "custom"}
            onChange={(v) => v !== "custom" && setDays(v)}
            options={[
              { value: "7", label: "7" },
              { value: "14", label: "14" },
              { value: "30", label: "30" },
            ]}
          />
          <Field invalid={touched && !valid}>
            <FieldLabel>{k("admin.subs.extend.days")}</FieldLabel>
            <FieldControl>
              <Input type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} onBlur={() => setTouched(true)} />
            </FieldControl>
            <FieldHint>{newEnd ? k("admin.subs.extend.newEnd", { date: formatDate(newEnd, { day: "numeric", month: "long", year: "numeric" }) }) : k("admin.subs.extend.daysHint")}</FieldHint>
            <FieldError>{touched && !valid ? k("admin.subs.extend.invalid") : null}</FieldError>
          </Field>
          <ErrorLine error={save.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("admin.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || (touched && !valid)}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : <HourglassIcon />} {k("admin.subs.extend.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Today in IST as "YYYY-MM-DD" (the date input's min). */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function CompPlanDialog({ sub, onClose }: { sub: AdminSubscription | null; onClose: () => void }) {
  const { t, formatCurrency } = useI18n();
  const k = useSubsT();
  const qc = useQueryClient();
  const plans = usePlans(true);
  const s = useLast(sub);
  const [planId, setPlanId] = React.useState("");
  const [until, setUntil] = React.useState("");
  React.useEffect(() => {
    if (sub) {
      setPlanId(sub.planId);
      setUntil("");
    }
  }, [sub]);
  const untilPast = !!until && until <= istToday();
  const plan = plans.data?.find((p) => p.id === planId);

  const save = useMutation({
    mutationFn: () => api.post(`/subscriptions/admin/${s!.tenantId}/comp`, { planId, until: until || null }, { tenant: null }),
    onSuccess: () => {
      toast.success(k("admin.subs.comp.done", { plan: plan?.name ?? planId, shop: s ? shopName(s) : "" }));
      void qc.invalidateQueries({ queryKey: SUBS_KEY });
      void qc.invalidateQueries({ queryKey: ["platform", "tenants"] });
      onClose();
    },
  });
  React.useEffect(() => {
    if (sub) save.reset();
  }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={!!sub} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("admin.common.close")}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (planId && !untilPast && !save.isPending) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GiftIcon className="size-5 text-primary" /> {k("admin.subs.comp.title", { shop: s ? shopName(s) : "" })}
            </DialogTitle>
            <DialogDescription>{k("admin.subs.comp.body")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>{k("admin.subs.comp.plan")}</FieldLabel>
            <Select value={planId} onValueChange={setPlanId}>
              <FieldControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {(plans.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.priceMonthlyPaise ? formatCurrency(p.priceMonthlyPaise / 100, { maximumFractionDigits: 0 }) : t("admin.plans.free")}
                    {!p.isPublic && ` · ${t("admin.platform.private")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field invalid={untilPast}>
            <FieldLabel optional={k("admin.subs.optional")}>{k("admin.subs.comp.until")}</FieldLabel>
            <FieldControl>
              <Input type="date" min={istToday()} value={until} onChange={(e) => setUntil(e.target.value)} />
            </FieldControl>
            <FieldHint>{k("admin.subs.comp.untilHint")}</FieldHint>
            <FieldError>{untilPast ? k("admin.subs.comp.untilPast") : null}</FieldError>
          </Field>
          <ErrorLine error={save.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("admin.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || !planId || untilPast}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : <GiftIcon />} {k("admin.subs.comp.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const INVOICES_KEY = ["platform", "platform-invoices"] as const;

export function VoidInvoiceDialog({ invoice, onClose }: { invoice: AdminPlatformInvoice | null; onClose: () => void }) {
  const { t } = useI18n();
  const k = useSubsT();
  const qc = useQueryClient();
  const inv = useLast(invoice);
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (invoice) setReason("");
  }, [invoice]);
  const save = useMutation({
    mutationFn: () => api.post(`/subscriptions/admin/invoices/${inv!.id}/void`, reason.trim() ? { reason: reason.trim() } : {}, { tenant: null }),
    onSuccess: () => {
      toast.success(k("admin.subs.inv.voided", { number: inv?.number ?? "" }));
      void qc.invalidateQueries({ queryKey: INVOICES_KEY });
      onClose();
    },
  });
  React.useEffect(() => {
    if (invoice) save.reset();
  }, [invoice]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("admin.common.close")}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{k("admin.subs.inv.voidTitle", { number: inv?.number ?? "" })}</DialogTitle>
            <DialogDescription>{k("admin.subs.inv.voidBody")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel optional={k("admin.subs.optional")}>{k("admin.subs.inv.voidReason")}</FieldLabel>
            <FieldControl>
              <Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FieldControl>
            <FieldHint>{k("admin.subs.inv.voidReasonHint")}</FieldHint>
          </Field>
          <ErrorLine error={save.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("admin.common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />} {k("admin.subs.inv.void")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
