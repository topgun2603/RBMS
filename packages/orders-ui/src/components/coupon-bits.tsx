"use client";

import * as React from "react";
import { BanIcon, CalendarClockIcon, CheckCircle2Icon, CircleSlashIcon, ClockIcon, TruckIcon } from "lucide-react";
import { StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { couponState, couponValueText, type CouponState } from "../lib/coupons";
import type { Coupon } from "../lib/types";

const STATE_META: Record<CouponState, { tone: StatusTone; icon: React.ComponentType<{ className?: string }> }> = {
  active: { tone: "success", icon: CheckCircle2Icon },
  scheduled: { tone: "info", icon: CalendarClockIcon },
  expired: { tone: "neutral", icon: ClockIcon },
  used_up: { tone: "warning", icon: CircleSlashIcon },
  off: { tone: "neutral", icon: BanIcon },
};

export function CouponStatePill({ coupon }: { coupon: Coupon }) {
  const { t } = useI18n();
  const s = couponState(coupon);
  const m = STATE_META[s];
  return (
    <StatusPill tone={m.tone} icon={m.icon}>
      {t(`orders.coupons.state.${s}`)}
    </StatusPill>
  );
}

export function CouponValue({ coupon }: { coupon: Coupon }) {
  const { t } = useI18n();
  const v = couponValueText(coupon);
  if (coupon.type === "free_shipping")
    return (
      <span className="inline-flex items-center gap-1 font-semibold">
        <TruckIcon className="size-4 text-info-ink" /> {t("orders.coupons.type.free_shipping")}
      </span>
    );
  return (
    <span className="font-semibold tabular-nums">
      {t("orders.coupons.off", { value: v.main ?? "" })}
      {v.cap && <span className="block text-xs font-normal text-muted-foreground">{t("orders.coupons.upTo", { amount: v.cap })}</span>}
    </span>
  );
}

