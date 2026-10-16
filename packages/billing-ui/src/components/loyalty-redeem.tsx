"use client";

import * as React from "react";
import { useDebounced, useFeature, useI18n } from "@srirealtime/web";
import { AlertTriangleIcon, GiftIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import {
  AnimatePresence,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  motion,
  Skeleton,
  Switch,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import type { Party } from "./customer-picker";
import { useHasPermission } from "../lib/access";
import { money } from "../lib/format";
import { clampRedeemPoints, estimatedTotal, pointsValue, quotablePhone, type LoyaltyQuote, type RedeemFailure } from "../lib/loyalty";
import { useLoyaltyQuote } from "../lib/queries-growth";

export const LOYALTY_FEATURE = "loyalty";
export const LOYALTY_REDEEM_PERMISSION = "loyalty.redeem";

const partyPhone = (p: Party) => (p.kind === "saved" ? p.customer.phone : p.kind === "walkin" ? p.phone : null);

export interface LoyaltyRedeemState {
  /** Feature on and the customer has a usable phone. */
  active: boolean;
  quote: LoyaltyQuote | undefined;
  loading: boolean;
  error: unknown;
  canUse: boolean;
  on: boolean;
  input: string;
  /** Points that will be sent with "Save & issue" (0 = none). */
  points: number;
  /** Their value, paise. */
  discount: number;
  failure: RedeemFailure | null;
  setOn: (on: boolean) => void;
  setInput: (v: string) => void;
  setFailure: (f: RedeemFailure | null) => void;
  /** Use the server's suggested maximum after a rejection. */
  applyMax: (points: number) => void;
}

/** Quote (debounced on the bill total) + the "use points" choice for the bill form. */
export function useLoyaltyRedeem(party: Party, total: number): LoyaltyRedeemState {
  const featureOn = useFeature(LOYALTY_FEATURE);
  const canRedeem = useHasPermission(LOYALTY_REDEEM_PERMISSION);
  const phone = featureOn ? quotablePhone(partyPhone(party)) : null;
  const amount = useDebounced(total, 400);
  const q = useLoyaltyQuote(phone, amount, featureOn);
  const [on, setOnRaw] = React.useState(false);
  const [input, setInputRaw] = React.useState("");
  const [failure, setFailure] = React.useState<RedeemFailure | null>(null);

  // Another customer: start over.
  React.useEffect(() => {
    setOnRaw(false);
    setInputRaw("");
    setFailure(null);
  }, [phone]);

  const quote = phone ? q.data : undefined;
  const usable = !!quote?.canRedeem && canRedeem;
  const points = on && usable && quote ? clampRedeemPoints(input, quote) : 0;
  const discount = quote ? pointsValue(points, quote.pointValuePaise) : 0;

  return {
    active: featureOn && !!phone && total > 0,
    quote,
    loading: !!phone && (q.isPending || (q.isFetching && !q.data)),
    error: q.isError ? q.error : null,
    canUse: usable,
    on: on && usable,
    input,
    points,
    discount,
    failure,
    setOn: (v) => {
      setOnRaw(v);
      setFailure(null);
      if (v && quote && !input) setInputRaw(String(quote.maxPoints));
    },
    setInput: (v) => {
      setInputRaw(v.replace(/[^\d]/g, "").slice(0, 9));
      setFailure(null);
    },
    setFailure,
    applyMax: (max) => {
      setOnRaw(true);
      setInputRaw(String(max));
      setFailure(null);
    },
  };
}

/** Compact card in the totals column: tier, balance, earn preview and the "use points" control. */
export function LoyaltyRedeemCard({ state: s }: { state: LoyaltyRedeemState }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  if (!s.active) return null;
  const q = s.quote;
  const id = "loyalty-points";

  const failureText = (f: RedeemFailure) =>
    f.reason
      ? t(`billing.loyalty.reasons.${f.reason}`, { min: q?.minRedeemPoints ?? 0 })
      : f.code === "validation"
        ? f.message
        : t(`billing.errors.${f.code}`);

  return (
    <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="icon-chip size-8 text-primary">
              <GiftIcon className="size-4" />
            </span>
            {t("billing.loyalty.title")}
            {q?.member && (
              <Badge variant="secondary" className="ml-auto">
                {t("billing.loyalty.tier", { tier: q.member.tier })}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {s.loading && !q ? (
            <div className="grid gap-2" role="status" aria-label={t("billing.loyalty.checking")}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : !q ? (
            <p className="flex items-center gap-2 text-meta text-muted-foreground">
              <AlertTriangleIcon className="size-3.5" /> {t("billing.loyalty.quoteError")}
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                {q.member ? (
                  <>
                    <span className="font-heading text-lg font-bold tabular-nums">{t("billing.loyalty.balance", { points: q.balance })}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{t("billing.loyalty.worth", { amount: money(pointsValue(q.balance, q.pointValuePaise)) })}</span>
                  </>
                ) : (
                  <span>
                    <span className="font-medium">{t("billing.loyalty.notMember")}</span>
                    <span className="block text-xs text-muted-foreground">{t("billing.loyalty.notMemberHint")}</span>
                  </span>
                )}
              </div>
              {q.earnPreview > 0 && (
                <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
                  <SparklesIcon className="size-3.5 text-primary" />
                  {t("billing.loyalty.willEarn", { points: q.earnPreview })}
                </p>
              )}

              {s.canUse ? (
                <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
                  <Field id={`${id}-switch`} className="grid-cols-[minmax(0,1fr)_auto] items-center">
                    <FieldLabel className="cursor-pointer font-medium">{t("billing.loyalty.use")}</FieldLabel>
                    <FieldControl>
                      <Switch checked={s.on} onCheckedChange={s.setOn} aria-controls={id} />
                    </FieldControl>
                  </Field>
                  <AnimatePresence initial={false}>
                    {s.on && (
                      <motion.div
                        key="pts"
                        id={id}
                        initial={reduced ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                      >
                        <Field invalid={!!s.failure}>
                          <FieldLabel aside={<span className="font-medium text-foreground tabular-nums">−{money(s.discount)}</span>}>{t("billing.loyalty.points")}</FieldLabel>
                          <FieldControl>
                            <Input
                              inputMode="numeric"
                              autoComplete="off"
                              className="tabular-nums"
                              value={s.input}
                              onChange={(e) => s.setInput(e.target.value)}
                              onBlur={() => s.setInput(String(s.points || q.maxPoints))}
                            />
                          </FieldControl>
                          <FieldHint>
                            {t("billing.loyalty.pointsHint", { min: Math.max(1, q.minRedeemPoints), max: q.maxPoints, value: money(q.pointValuePaise) })}
                          </FieldHint>
                          <FieldError>{s.failure ? failureText(s.failure) : null}</FieldError>
                        </Field>
                        <p className="mt-2 text-meta text-muted-foreground">{t("billing.loyalty.issueOnly")}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                q.reason && <p className="text-meta text-muted-foreground">{t(`billing.loyalty.reasons.${q.reason}`, { min: q.minRedeemPoints })}</p>
              )}

              <AnimatePresence initial={false}>
                {s.failure && (!s.on || !s.canUse) && (
                  <motion.p key="f" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-destructive">
                    {t("billing.loyalty.rejected")}: {failureText(s.failure)}
                  </motion.p>
                )}
              </AnimatePresence>
              {s.failure?.maxPoints && s.canUse && (
                <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => s.applyMax(s.failure!.maxPoints!)}>
                  {t("billing.loyalty.useMax", { points: s.failure.maxPoints })}
                </Button>
              )}
              {s.loading && q && <Loader2Icon className="size-3.5 animate-spin justify-self-end text-muted-foreground" aria-hidden />}
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

/** "Points discount −₹X" and "Total after points (about)" rows for the bill summary. */
export function LoyaltySummaryRows({ state: s, total }: { state: LoyaltyRedeemState; total: number }) {
  const { t } = useI18n();
  return (
    <AnimatePresence initial={false}>
      {s.discount > 0 && (
        <motion.div
          key="loyalty"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="grid gap-1 overflow-hidden"
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">
              {t("billing.loyalty.discountRow")} <span className="text-xs">({t("billing.loyalty.balance", { points: s.points })})</span>
            </span>
            <span className="text-success-ink tabular-nums">−{money(s.discount)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-medium">{t("billing.loyalty.aboutTotal")}</span>
            <span className="font-semibold tabular-nums">≈ {money(estimatedTotal(total, s.discount))}</span>
          </div>
          <p className="text-meta leading-snug text-muted-foreground">{t("billing.loyalty.aboutHint")}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
