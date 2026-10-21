"use client";

import * as React from "react";
import {
  CalendarClockIcon,
  CoinsIcon,
  CreditCardIcon,
  FlaskConicalIcon,
  GiftIcon,
  InfoIcon,
  Loader2Icon,
  LockIcon,
  MinusIcon,
  PlusIcon,
  PuzzleIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  motion,
  Skeleton,
  StatusPill,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { describeError, formatPaise, limitName, QueryError, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import {
  MOCK_PAY_PARAM,
  openAuthUrl,
  useAddonPreview,
  useAddons,
  useCancelAddonPayment,
  useMockPay,
  useSetAddon,
  type AddonOffer,
  type AddonPayment,
  type AddonsState,
} from "../../lib/subscriptions";
import { SectionCard } from "./section-card";
import { useLimitValue } from "./usage-meters";

/**
 * Plan & billing → Add-ons: what the shop can add on top of its plan (more staff, branches, WhatsApp messages,
 * storage, features, credits packs), with its price for the plan's interval, what it has now and a quantity stepper.
 * Choosing opens a preview (what is charged now for the rest of the period, GST included, and the next renewal).
 */
export function AddonsSection({ readOnly }: { readOnly: boolean }) {
  const { t } = useI18n();
  const addons = useAddons(!readOnly);
  const [target, setTarget] = React.useState<{ offer: AddonOffer; quantity: number } | null>(null);

  if (readOnly) return null;
  if (addons.isError) {
    return (
      <SectionCard icon={PuzzleIcon} title={t("workspace.plan.addons.title")}>
        <QueryError compact error={addons.error} onRetry={() => void addons.refetch()} />
      </SectionCard>
    );
  }
  if (addons.isPending) return <Skeleton className="h-56 rounded-2xl" />;
  const data = addons.data;
  // Add-ons the shop's app doesn't offer aren't shown at all.
  const offers = data.items.filter((o) => o.block !== "app");
  if (offers.length === 0 && data.other.length === 0) return null;

  return (
    <SectionCard icon={PuzzleIcon} title={t("workspace.plan.addons.title")} description={t("workspace.plan.addons.subtitle")}>
      <div className="grid gap-4">
        {data.billing && data.billing !== "no_provider" && offers.some((o) => o.addon.kind !== "credits") && (
          <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {t(`workspace.plan.addons.billing.${data.billing}`)}
          </p>
        )}
        {data.payments.length > 0 && <PendingPayments payments={data.payments} names={new Map(data.items.map((o) => [o.addon.id, o.addon.name]))} />}
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {offers.map((o, i) => (
            <AddonCard key={o.addon.id} offer={o} index={i} data={data} onChoose={(quantity) => setTarget({ offer: o, quantity })} />
          ))}
        </ul>
        {data.other.length > 0 && (
          <ul className="grid gap-2">
            {data.other.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm">
                <GiftIcon className="size-4 text-primary" aria-hidden />
                <span className="font-medium">{a.name}</span>
                {a.quantity > 1 && <span className="text-muted-foreground">× {a.quantity}</span>}
                <StatusPill tone="brand" icon={GiftIcon}>
                  {t("workspace.plan.addons.comped")}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AddonDialog target={target} onClose={() => setTarget(null)} />
      <MockPayDialog payments={data.payments} />
    </SectionCard>
  );
}

const ADDON_BLOCKS: string[] = ["tier", "app", "included"];

/** "+5 team members", "Unlocks: custom-domain", "+5,000 SMS credits" lines for one unit/pack × `quantity`. */
function useAddonEffect() {
  const { t } = useI18n();
  const value = useLimitValue();
  return (o: AddonOffer, quantity: number): string[] => {
    const q = Math.max(1, quantity);
    if (o.addon.kind === "feature") return [t("workspace.plan.addons.unlocks", { features: o.addon.modules.join(", ") })];
    return Object.entries(o.addon.limits).map(([key, n]) =>
      o.addon.kind === "credits"
        ? t("workspace.plan.addons.addsCredits", { value: value(key, n * q), limit: limitName(t, key) })
        : t("workspace.plan.addons.adds", { value: value(key, n * q), limit: limitName(t, key) }),
    );
  };
}

function AddonCard({ offer: o, index, data, onChoose }: { offer: AddonOffer; index: number; data: AddonsState; onChoose: (quantity: number) => void }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const effect = useAddonEffect();
  const credits = o.addon.kind === "credits";
  const cur = o.current;
  const have = cur?.quantity ?? 0;
  const renew = cur ? (cur.nextQuantity ?? cur.quantity) : 0;
  const comp = cur?.source === "comp";
  const [qty, setQty] = React.useState(credits ? o.addon.minQuantity : Math.max(have || o.addon.minQuantity, o.addon.minQuantity));
  React.useEffect(() => setQty(credits ? o.addon.minQuantity : Math.max(have || o.addon.minQuantity, o.addon.minQuantity)), [credits, have, o.addon.minQuantity]);
  const blocked = o.block ?? o.billing;
  const stepper = o.addon.maxQuantity > 1;
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, { day: "numeric", month: "short" }) : "");
  const per = credits ? t("workspace.plan.addons.once") : data.interval === "yearly" ? t("workspace.plan.perYear") : t("workspace.plan.perMonth");
  const changed = credits || qty !== have || (cur ? renew !== have && qty === have : false);

  let action: string;
  if (credits) action = t("workspace.plan.addons.buyPacks", { count: qty });
  else if (!cur) action = t("workspace.plan.addons.add");
  else if (qty === have && renew !== have) action = t("workspace.plan.addons.keep");
  else action = t("workspace.plan.addons.update");

  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduced ? 0 : Math.min(index, 8) * 0.04, duration: 0.25 }}
      className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-4", cur && !comp && "border-primary/40 ring-1 ring-primary/15")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold">{o.addon.name}</h3>
          {o.addon.description && <p className="mt-0.5 text-sm text-muted-foreground">{o.addon.description}</p>}
        </div>
        <span className="icon-chip size-9 shrink-0 rounded-xl text-primary">{credits ? <CoinsIcon className="size-4" /> : o.addon.kind === "feature" ? <SparklesIcon className="size-4" /> : <PuzzleIcon className="size-4" />}</span>
      </div>
      <ul className="grid gap-1 text-sm">
        {effect(o, 1).map((line) => (
          <li key={line} className="flex items-center gap-1.5">
            <PlusIcon className="size-3.5 text-primary" aria-hidden /> {line}
          </li>
        ))}
      </ul>
      <p className="text-sm tabular-nums">
        <span className="font-semibold">{formatPaise(o.unitPricePaise)}</span>
        <span className="text-muted-foreground">
          {" "}
          {stepper && !credits ? t("workspace.plan.addons.each") : credits ? t("workspace.plan.addons.perPack") : ""}
          {per} {t("workspace.plan.plusGst")}
        </span>
      </p>

      {cur && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusPill tone={comp ? "brand" : "success"} icon={comp ? GiftIcon : PuzzleIcon}>
            {comp ? t("workspace.plan.addons.comped") : t("workspace.plan.addons.have", { count: have })}
          </StatusPill>
          {cur.endsAtPeriodEnd && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CalendarClockIcon className="size-3.5" aria-hidden />
              {cur.endReason === "plan_change" || cur.endReason === "plan_ended"
                ? t("workspace.plan.addons.endsWithPlan", { date: date(cur.currentPeriodEnd) })
                : t("workspace.plan.addons.endsOn", { date: date(cur.currentPeriodEnd) })}
            </span>
          )}
          {!cur.endsAtPeriodEnd && cur.nextQuantity !== null && cur.nextQuantity !== cur.quantity && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CalendarClockIcon className="size-3.5" aria-hidden /> {t("workspace.plan.addons.changesOn", { count: cur.nextQuantity, date: date(cur.currentPeriodEnd) })}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto grid gap-2">
        {blocked && !comp ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0" aria-hidden /> {o.block ? t(`workspace.plan.addons.block.${o.block}`) : t(`workspace.plan.addons.billing.${o.billing}`)}
          </p>
        ) : comp ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {stepper && (
              <div className="flex items-center rounded-lg border" role="group" aria-label={t("workspace.plan.addons.quantity", { name: o.addon.name })}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  disabled={qty <= (credits || !cur ? o.addon.minQuantity : 0)}
                  onClick={() => setQty((n) => Math.max(credits || !cur ? o.addon.minQuantity : 0, n - 1))}
                  aria-label={t("workspace.plan.addons.less")}
                >
                  <MinusIcon />
                </Button>
                <span className="min-w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                  {qty}
                </span>
                <Button variant="ghost" size="icon" className="size-9" disabled={qty >= o.addon.maxQuantity} onClick={() => setQty((n) => Math.min(o.addon.maxQuantity, n + 1))} aria-label={t("workspace.plan.addons.more")}>
                  <PlusIcon />
                </Button>
              </div>
            )}
            <Button className="flex-1 sm:flex-none" disabled={!changed || (!cur && qty === 0)} onClick={() => onChoose(qty)}>
              {action}
            </Button>
            {cur && !cur.endsAtPeriodEnd && !credits && (
              <Button variant="ghost" className="text-danger-ink" onClick={() => onChoose(0)}>
                {t("workspace.plan.addons.remove")}
              </Button>
            )}
          </div>
        )}
      </div>
    </motion.li>
  );
}

/** Unpaid add-on payments: pay (the provider's page) or drop. */
function PendingPayments({ payments, names }: { payments: AddonPayment[]; names: Map<string, string> }) {
  const { t, formatDate } = useI18n();
  const cancel = useCancelAddonPayment();
  return (
    <ul className="grid gap-2" aria-label={t("workspace.plan.addons.pendingTitle")}>
      {payments.map((p) => (
        <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/8 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <p className="font-medium">{t("workspace.plan.addons.pending", { name: names.get(p.addonId) ?? p.label, amount: formatPaise(p.chargePaise) })}</p>
            <p className="text-meta text-muted-foreground">{t("workspace.plan.addons.pendingUntil", { date: formatDate(p.expiresAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!p.authUrl} onClick={() => p.authUrl && openAuthUrl(p.authUrl) === "new" && toast.info(t("workspace.plan.newTab"))}>
              <CreditCardIcon /> {t("workspace.plan.addons.pay", { amount: formatPaise(p.chargePaise) })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={cancel.isPending}
              onClick={async () => {
                try {
                  await cancel.mutateAsync(p.id);
                  toast.success(t("workspace.plan.addons.paymentCancelled"));
                } catch (err) {
                  toast.error(describeError(err, t));
                }
              }}
            >
              <XIcon /> {t("workspace.common.cancel")}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** What a change does and costs, then confirm (opens the payment page when something is due now). */
function AddonDialog({ target, onClose }: { target: { offer: AddonOffer; quantity: number } | null; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const effect = useAddonEffect();
  const set = useSetAddon();
  const body = target ? { addonId: target.offer.addon.id, quantity: target.quantity } : null;
  const preview = useAddonPreview(body, !!target);
  const p = preview.data;
  const name = target?.offer.addon.name ?? "";
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, { day: "numeric", month: "long", year: "numeric" }) : "");
  const gst = p ? p.gst.cgstPaise + p.gst.sgstPaise + p.gst.igstPaise : 0;

  const confirm = async () => {
    if (!body) return;
    try {
      const r = await set.mutateAsync(body);
      if (r.authUrl) {
        if (openAuthUrl(r.authUrl) === "new") toast.info(t("workspace.plan.newTab"));
      } else toast.success(r.applied === "period_end" ? t("workspace.plan.addons.scheduled", { date: date(p?.startsAt) }) : t("workspace.plan.addons.done"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const rows: [string, string][] = [];
  if (p) {
    if (p.kind === "credits") rows.push([t("workspace.plan.addons.preview.packs"), String(p.quantity)]);
    else rows.push([t("workspace.plan.addons.preview.quantity"), p.fromQuantity === p.quantity ? String(p.quantity) : `${p.fromQuantity} → ${p.quantity}`]);
    if (p.unusedDays > 0 && p.applies === "after_payment") rows.push([t("workspace.plan.addons.preview.prorated"), t("workspace.plan.addons.preview.days", { days: p.unusedDays, total: p.periodDays })]);
    if (p.chargeTodayPaise > 0) {
      rows.push([t("workspace.plan.addons.preview.taxable"), formatPaise(p.taxablePaise)]);
      rows.push([t("workspace.plan.addons.preview.gst", { rate: p.gst.ratePercent }), formatPaise(gst)]);
    }
    if (p.kind !== "credits" && p.nextChargeAt) rows.push([t("workspace.plan.addons.preview.renewal", { date: date(p.nextChargeAt) }), `${formatPaise(p.nextRenewalPaise)} ${t("workspace.plan.plusGst")}`]);
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !set.isPending && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("workspace.common.close")}>
        <DialogHeader>
          <DialogTitle>{target?.quantity === 0 ? t("workspace.plan.addons.preview.removeTitle", { name }) : t("workspace.plan.addons.preview.title", { name })}</DialogTitle>
          <DialogDescription>
            {!p
              ? ""
              : p.kind === "credits"
                ? t("workspace.plan.addons.preview.creditsBody")
                : p.applies === "after_payment"
                  ? t("workspace.plan.addons.preview.payBody", { date: date(p.nextChargeAt) })
                  : p.applies === "period_end"
                    ? t("workspace.plan.addons.preview.periodEndBody", { date: date(p.startsAt) })
                    : p.applies === "now"
                      ? t("workspace.plan.addons.preview.nowBody")
                      : t("workspace.plan.addons.preview.noneBody")}
          </DialogDescription>
        </DialogHeader>
        {preview.isError ? (
          <QueryError compact error={preview.error} onRetry={() => void preview.refetch()} />
        ) : !p ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : (
          <div className="grid gap-3">
            {target && target.quantity > 0 && (
              <ul className="grid gap-1 rounded-xl bg-primary/8 px-3 py-2 text-sm">
                {effect(target.offer, target.quantity).map((line) => (
                  <li key={line} className="flex items-center gap-1.5">
                    <PlusIcon className="size-3.5 text-primary" aria-hidden /> {line}
                  </li>
                ))}
              </ul>
            )}
            <dl className="divide-y rounded-xl border text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium tabular-nums">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 bg-muted/40 px-3 py-2.5">
                <dt className="font-semibold">{t("workspace.plan.addons.preview.dueNow")}</dt>
                <dd className="font-heading text-base font-bold tabular-nums">{formatPaise(p.chargeTodayPaise)}</dd>
              </div>
            </dl>
            {p.block && <p className="text-sm text-danger-ink">{t(ADDON_BLOCKS.includes(p.block) ? `workspace.plan.addons.block.${p.block}` : `workspace.plan.addons.billing.${p.block}`)}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={set.isPending}>
            {t("workspace.common.cancel")}
          </Button>
          <Button onClick={() => void confirm()} disabled={!p || !!p.block || p.applies === "none" || set.isPending} variant={target?.quantity === 0 ? "destructive" : "default"}>
            {set.isPending ? <Loader2Icon className="animate-spin" /> : p && p.chargeTodayPaise > 0 ? <CreditCardIcon /> : null}
            {p && p.chargeTodayPaise > 0 ? t("workspace.plan.addons.pay", { amount: formatPaise(p.chargeTodayPaise) }) : t("workspace.plan.addons.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The mock provider's payment page: its payment links come back here with `?mockPay=<link id>` (non-production). */
function MockPayDialog({ payments }: { payments: AddonPayment[] }) {
  const { t } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const id = params.get(MOCK_PAY_PARAM);
  const pay = useMockPay();
  const [closing, setClosing] = React.useState(false);
  React.useEffect(() => setClosing(false), [id]);
  const payment = payments.find((p) => p.providerPaymentId === id) ?? null;
  const clear = () => {
    setClosing(true);
    navigate("?", { replace: true, scroll: false });
  };
  return (
    <Dialog open={!!id && !closing} onOpenChange={(o) => !o && !pay.isPending && clear()}>
      <DialogContent className="sm:max-w-sm" closeLabel={t("workspace.common.close")}>
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <StatusPill tone="warning" icon={FlaskConicalIcon} className="mx-auto">
            {t("workspace.plan.mock.badge")}
          </StatusPill>
          <DialogTitle>{t("workspace.plan.addons.mockTitle")}</DialogTitle>
          <DialogDescription>{payment ? payment.label : t("workspace.plan.addons.mockUnknown")}</DialogDescription>
        </DialogHeader>
        {payment && (
          <p className="text-center font-heading text-2xl font-bold tabular-nums">{formatPaise(payment.chargePaise)}</p>
        )}
        {pay.isError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-danger-ink">
            {describeError(pay.error, t)}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={clear} disabled={pay.isPending}>
            {t("workspace.plan.mock.decline")}
          </Button>
          <Button
            disabled={!id || pay.isPending}
            onClick={async () => {
              if (!id) return;
              try {
                await pay.mutateAsync(id);
                toast.success(t("workspace.plan.addons.done"));
                clear();
              } catch {
                // shown above
              }
            }}
          >
            {pay.isPending ? <Loader2Icon className="animate-spin" /> : <CreditCardIcon />} {t("workspace.plan.addons.mockPay")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
