"use client";

import * as React from "react";
import { BuildingIcon, CheckCircle2Icon, Loader2Icon, SmartphoneIcon, XCircleIcon, ZapIcon } from "lucide-react";
import {
  Button,
  cn,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Stagger,
  StaggerItem,
  ToggleGroup,
  ToggleGroupItem,
} from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { ACCOUNT_RE, IFSC_RE, kycErrorKey, normalizeId, ROUTE_ACCOUNT_RE, VPA_RE } from "../lib/logic";
import type { KycCheck, PayoutAccountInput } from "../lib/types";
import { CheckPill } from "./bits";

type Kind = "bank" | "upi" | "route";

export interface AccountDraft {
  type: Kind;
  holderName: string;
  accountNumber: string;
  ifsc: string;
  vpa: string;
  accountId: string;
}

export const emptyAccount = (type: Kind = "bank"): AccountDraft => ({ type, holderName: "", accountNumber: "", ifsc: "", vpa: "", accountId: "" });

/** Field errors (message keys) for a draft; empty when valid. */
export function accountErrors(d: AccountDraft): Partial<Record<keyof AccountDraft, string>> {
  const e: Partial<Record<keyof AccountDraft, string>> = {};
  if (d.type === "bank") {
    if (d.holderName.trim().length < 2) e.holderName = "marketplace.validation.holderName";
    if (!ACCOUNT_RE.test(d.accountNumber.replace(/\s+/g, ""))) e.accountNumber = "marketplace.validation.accountNumber";
    if (!IFSC_RE.test(normalizeId(d.ifsc))) e.ifsc = "marketplace.validation.ifsc";
  } else if (d.type === "upi") {
    if (!VPA_RE.test(d.vpa.trim())) e.vpa = "marketplace.validation.vpa";
  } else if (!ROUTE_ACCOUNT_RE.test(d.accountId.trim())) e.accountId = "marketplace.validation.routeAccount";
  return e;
}

export function toAccountInput(d: AccountDraft): PayoutAccountInput {
  if (d.type === "bank") return { type: "bank", holderName: d.holderName.trim(), accountNumber: d.accountNumber.replace(/\s+/g, ""), ifsc: normalizeId(d.ifsc) };
  if (d.type === "upi") return { type: "upi", vpa: d.vpa.trim().toLowerCase(), ...(d.holderName.trim() ? { holderName: d.holderName.trim() } : {}) };
  return { type: "route", accountId: d.accountId.trim() };
}

/** Bank / UPI (and, for staff, Razorpay Route) account fields. Controlled. */
export function AccountFields({
  value,
  onChange,
  errors,
  allowRoute,
  disabled,
}: {
  value: AccountDraft;
  onChange: (d: AccountDraft) => void;
  errors?: Partial<Record<keyof AccountDraft, string>>;
  allowRoute?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<AccountDraft>) => onChange({ ...value, ...patch });
  const err = (k: keyof AccountDraft) => (errors?.[k] ? t(errors[k]!) : null);
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor={null}>{t("marketplace.account.kind")}</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          value={value.type}
          onValueChange={(v) => v && set({ type: v as Kind })}
          className="w-full"
          disabled={disabled}
        >
          <ToggleGroupItem value="bank" className="flex-1">
            <BuildingIcon /> {t("marketplace.account.bank")}
          </ToggleGroupItem>
          <ToggleGroupItem value="upi" className="flex-1">
            <SmartphoneIcon /> {t("marketplace.account.upi")}
          </ToggleGroupItem>
          {allowRoute && (
            <ToggleGroupItem value="route" className="flex-1">
              <ZapIcon /> {t("marketplace.account.route")}
            </ToggleGroupItem>
          )}
        </ToggleGroup>
      </Field>
      {value.type === "bank" && (
        <>
          <Field invalid={!!err("holderName")}>
            <FieldLabel>{t("marketplace.account.holderName")}</FieldLabel>
            <FieldControl>
              <Input value={value.holderName} onChange={(e) => set({ holderName: e.target.value })} autoComplete="name" disabled={disabled} />
            </FieldControl>
            <FieldHint>{t("marketplace.account.holderHint")}</FieldHint>
            <FieldError>{err("holderName")}</FieldError>
          </Field>
          <FieldRow>
            <Field invalid={!!err("accountNumber")}>
              <FieldLabel>{t("marketplace.account.accountNumber")}</FieldLabel>
              <FieldControl>
                <Input
                  value={value.accountNumber}
                  onChange={(e) => set({ accountNumber: e.target.value.replace(/[^\d\s]/g, "") })}
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={disabled}
                />
              </FieldControl>
              <FieldError>{err("accountNumber")}</FieldError>
            </Field>
            <Field invalid={!!err("ifsc")}>
              <FieldLabel>{t("marketplace.account.ifsc")}</FieldLabel>
              <FieldControl>
                <Input value={value.ifsc} onChange={(e) => set({ ifsc: e.target.value.toUpperCase() })} placeholder="SBIN0001234" autoCapitalize="characters" disabled={disabled} />
              </FieldControl>
              <FieldError>{err("ifsc")}</FieldError>
            </Field>
          </FieldRow>
        </>
      )}
      {value.type === "upi" && (
        <FieldRow>
          <Field invalid={!!err("vpa")}>
            <FieldLabel>{t("marketplace.account.vpa")}</FieldLabel>
            <FieldControl>
              <Input value={value.vpa} onChange={(e) => set({ vpa: e.target.value })} placeholder="name@okbank" autoCapitalize="none" inputMode="email" disabled={disabled} />
            </FieldControl>
            <FieldError>{err("vpa")}</FieldError>
          </Field>
          <Field>
            <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.account.holderName")}</FieldLabel>
            <FieldControl>
              <Input value={value.holderName} onChange={(e) => set({ holderName: e.target.value })} disabled={disabled} />
            </FieldControl>
          </Field>
        </FieldRow>
      )}
      {value.type === "route" && (
        <Field invalid={!!err("accountId")}>
          <FieldLabel>{t("marketplace.account.routeId")}</FieldLabel>
          <FieldControl>
            <Input value={value.accountId} onChange={(e) => set({ accountId: e.target.value.trim() })} placeholder="acc_XXXXXXXXXXXXXX" disabled={disabled} />
          </FieldControl>
          <FieldHint>{t("marketplace.account.routeHint")}</FieldHint>
          <FieldError>{err("accountId")}</FieldError>
        </Field>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- kyc timeline

/** KYC checks, newest first, as a vertical timeline. */
export function KycTimeline({ checks, compact }: { checks: KycCheck[]; compact?: boolean }) {
  const { t, formatDate } = useI18n();
  const sorted = [...checks].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (sorted.length === 0) return <p className="text-sm text-muted-foreground">{t("marketplace.kyc.noChecks")}</p>;
  return (
    <Stagger className="relative grid gap-3 pl-6 before:absolute before:top-1 before:bottom-1 before:left-[0.6875rem] before:w-px before:bg-border">
      {sorted.map((c) => {
        const ok = c.status === "verified";
        const bad = c.status === "failed";
        return (
          <StaggerItem key={c.id} className="relative">
            <span
              className={cn(
                "absolute top-1 -left-6 flex size-[1.375rem] items-center justify-center rounded-full ring-4 ring-card",
                ok ? "bg-success text-white dark:bg-success/60" : bad ? "bg-destructive text-white dark:bg-destructive/60" : "bg-warning text-neutral-950",
              )}
              aria-hidden
            >
              {ok ? <CheckCircle2Icon className="size-3.5" /> : bad ? <XCircleIcon className="size-3.5" /> : <Loader2Icon className="size-3.5" />}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{t(`marketplace.kyc.type.${c.type}`)}</p>
              <CheckPill status={c.status} />
              <span className="text-xs text-muted-foreground">{formatDate(c.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
            </div>
            {!compact && (
              <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                {Object.entries(c.input).length > 0 && (
                  <p className="font-mono">
                    {Object.entries(c.input)
                      .filter(([, v]) => typeof v === "string" || typeof v === "number")
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")}
                  </p>
                )}
                {c.nameOnRecord && (
                  <p>
                    {t("marketplace.kyc.nameOnRecord", { name: c.nameOnRecord })}
                    {c.nameMatchScore !== null ? ` · ${t("marketplace.kyc.matchScore", { score: c.nameMatchScore })}` : ""}
                  </p>
                )}
                {c.error && <p className={bad ? "text-danger-ink" : "text-warning-ink"}>{t(kycErrorKey(c.error))}</p>}
                {c.review && <p>{t(c.review.decision === "approved" ? "marketplace.kyc.reviewApproved" : "marketplace.kyc.reviewRejected", { reason: c.review.reason ?? "—" })}</p>}
              </div>
            )}
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

/** Small "Saving…" aware submit button. */
export function SubmitButton({ pending, children, className, ...props }: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button type="submit" disabled={pending || props.disabled} className={className} {...props}>
      {pending && <Loader2Icon className="animate-spin" />}
      {children}
    </Button>
  );
}
