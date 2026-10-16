"use client";

import * as React from "react";
import {
  AlertCircleIcon,
  BanIcon,
  BadgeCheckIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ClockIcon,
  Loader2Icon,
  PackageCheckIcon,
  PackageIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  TruckIcon,
  WalletIcon,
  XCircleIcon,
} from "lucide-react";
import { cn, StatusPill, type StatusTone } from "@srirealtime/ui";
import { absoluteUrl, useI18n } from "@srirealtime/web";
import type {
  KycCheckStatus,
  KycSubjectStatus,
  LedgerType,
  OrderStatus,
  PayoutAccountStatus,
  PayoutStatus,
  ProductReviewStatus,
  SettlementStatus,
  VendorKycStatus,
  VendorStatus,
} from "../lib/types";
import type { StepState } from "../lib/logic";

type Icon = React.ComponentType<{ className?: string }>;
type PillProps = { className?: string; size?: "sm" | "md" };

const VENDOR: Record<VendorStatus, [StatusTone, Icon]> = {
  pending: ["warning", ClockIcon],
  active: ["success", CheckCircle2Icon],
  suspended: ["danger", BanIcon],
};

export function VendorStatusPill({ status, ...p }: { status: VendorStatus } & PillProps) {
  const { t } = useI18n();
  const [tone, icon] = VENDOR[status];
  return (
    <StatusPill tone={tone} icon={icon} {...p}>
      {t(`marketplace.status.${status}`)}
    </StatusPill>
  );
}

const KYC: Record<KycSubjectStatus, [StatusTone, Icon]> = {
  none: ["neutral", ShieldQuestionIcon],
  pending: ["info", ShieldQuestionIcon],
  manual_review: ["warning", ShieldAlertIcon],
  verified: ["success", ShieldCheckIcon],
  failed: ["danger", ShieldAlertIcon],
};

export function KycPill({ status, ...p }: { status: VendorKycStatus | KycSubjectStatus } & PillProps) {
  const { t } = useI18n();
  const [tone, icon] = KYC[status];
  return (
    <StatusPill tone={tone} icon={icon} {...p}>
      {t(`marketplace.kyc.status.${status}`)}
    </StatusPill>
  );
}

const CHECK: Record<KycCheckStatus, [StatusTone, Icon]> = {
  pending: ["info", Loader2Icon],
  verified: ["success", CheckCircle2Icon],
  failed: ["danger", XCircleIcon],
  manual_review: ["warning", ShieldAlertIcon],
};

export function CheckPill({ status, ...p }: { status: KycCheckStatus } & PillProps) {
  const { t } = useI18n();
  const [tone, icon] = CHECK[status];
  return (
    <StatusPill tone={tone} icon={icon} {...p}>
      {t(`marketplace.kyc.check.${status}`)}
    </StatusPill>
  );
}

const ACCOUNT: Record<PayoutAccountStatus, [StatusTone, Icon]> = {
  none: ["neutral", CircleDashedIcon],
  pending: ["warning", ClockIcon],
  verified: ["success", BadgeCheckIcon],
  rejected: ["danger", XCircleIcon],
};

export function AccountPill({ status, ...p }: { status: PayoutAccountStatus } & PillProps) {
  const { t } = useI18n();
  const [tone, icon] = ACCOUNT[status];
  return (
    <StatusPill tone={tone} icon={icon} {...p}>
      {t(`marketplace.account.status.${status}`)}
    </StatusPill>
  );
}

const PAYOUT: Record<PayoutStatus, [StatusTone, Icon]> = {
  pending: ["warning", ClockIcon],
  processing: ["info", Loader2Icon],
  paid: ["success", CheckCircle2Icon],
  failed: ["danger", AlertCircleIcon],
  cancelled: ["neutral", BanIcon],
};

export function PayoutPill({ status, ...p }: { status: PayoutStatus } & PillProps) {
  const { t } = useI18n();
  const [tone, icon] = PAYOUT[status];
  return (
    <StatusPill tone={tone} icon={icon} {...p}>
      {t(`marketplace.payout.status.${status}`)}
    </StatusPill>
  );
}

const SETTLEMENT: Record<SettlementStatus, [StatusTone, Icon]> = {
  pending: ["neutral", ClockIcon],
  eligible: ["info", WalletIcon],
  settled: ["success", CheckCircle2Icon],
  reversed: ["danger", RotateCcwIcon],
};

export function SettlementPill({ status, ...p }: { status: SettlementStatus } & PillProps) {
  const { t } = useI18n();
  const [tone, icon] = SETTLEMENT[status];
  return (
    <StatusPill tone={tone} icon={icon} {...p}>
      {t(`marketplace.settlement.${status}`)}
    </StatusPill>
  );
}

const ORDER: Record<OrderStatus, [StatusTone, Icon]> = {
  placed: ["info", ClockIcon],
  confirmed: ["brand", CheckCircle2Icon],
  packed: ["brand", PackageCheckIcon],
  shipped: ["info", TruckIcon],
  delivered: ["success", PackageIcon],
  cancelled: ["neutral", BanIcon],
  returned: ["danger", RotateCcwIcon],
};

export function OrderStatusPill({ status, ...p }: { status: OrderStatus } & PillProps) {
  const { t } = useI18n();
  const [tone, icon] = ORDER[status];
  return (
    <StatusPill tone={tone} icon={icon} {...p}>
      {t(`marketplace.orderStatus.${status}`)}
    </StatusPill>
  );
}

const REVIEW: Record<ProductReviewStatus, [StatusTone, Icon]> = {
  pending: ["warning", ClockIcon],
  approved: ["success", CheckCircle2Icon],
  rejected: ["danger", AlertCircleIcon],
  withdrawn: ["neutral", CircleDashedIcon],
};

/** A seller product's review: waiting, approved, changes asked, withdrawn. */
export function ReviewPill({ status, ...p }: { status: ProductReviewStatus } & PillProps) {
  const { t } = useI18n();
  const [tone, icon] = REVIEW[status];
  return (
    <StatusPill tone={tone} icon={icon} {...p}>
      {t(`marketplace.review.status.${status}`)}
    </StatusPill>
  );
}

const LEDGER_TONE: Record<LedgerType, string> = {
  sale: "bg-success/12 text-success-ink",
  commission: "bg-muted text-muted-foreground",
  refund: "bg-destructive/10 text-danger-ink",
  payout: "bg-primary/10 text-primary",
  adjustment: "bg-warning/15 text-warning-ink",
};

export function LedgerTypeTag({ type }: { type: LedgerType }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap", LEDGER_TONE[type])}>
      {t(`marketplace.ledger.type.${type}`)}
    </span>
  );
}

const STEP: Record<StepState, [string, Icon]> = {
  done: ["bg-success text-white", CheckCircle2Icon],
  waiting: ["bg-warning/20 text-warning-ink", ClockIcon],
  failed: ["bg-destructive/15 text-danger-ink", XCircleIcon],
  todo: ["bg-muted text-muted-foreground", CircleDashedIcon],
};

export function StepIcon({ state, className }: { state: StepState; className?: string }) {
  const [tone, Icon] = STEP[state];
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", tone, className)} aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}

/** Seller logo, or initials on a tinted square. */
export function VendorLogo({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  const src = absoluteUrl(url ?? null);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- module packages don't use next/image
    <img src={src} alt="" className={cn("size-10 shrink-0 rounded-xl border object-cover", className)} />
  ) : (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 font-heading text-sm font-semibold text-primary", className)} aria-hidden>
      {initials}
    </span>
  );
}

/** Product thumbnail with a placeholder. */
export function Thumb({ src, className }: { src: string | null | undefined; className?: string }) {
  const url = absoluteUrl(src ?? null);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- module packages don't use next/image
    <img src={url} alt="" className={cn("size-11 shrink-0 rounded-lg border bg-muted object-cover", className)} loading="lazy" />
  ) : (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground", className)} aria-hidden>
      <PackageIcon className="size-4" />
    </span>
  );
}

/** Money cell: tabular, coloured by sign when `signed`. */
export function Amount({ value, signed, className, children }: { value: number; signed?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("font-medium whitespace-nowrap tabular-nums", signed && value > 0 && "text-success-ink", signed && value < 0 && "text-danger-ink", className)}>
      {children}
    </span>
  );
}
