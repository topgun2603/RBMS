"use client";

import * as React from "react";
import { BuildingIcon, ClipboardCheckIcon, FlaskConicalIcon, IdCardIcon, LandmarkIcon, Loader2Icon, SmartphoneIcon, StoreIcon, UserRoundCheckIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  cn,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  motion,
  Progress,
  Skeleton,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, QueryError, useFeature, useI18n } from "@srirealtime/web";
import { AccountFields, accountErrors, emptyAccount, SubmitButton, toAccountInput, type AccountDraft } from "../components/account";
import { AccountPill, CheckPill, StepIcon } from "../components/bits";
import { accountText, ACCOUNT_RE, IFSC_RE, kycErrorKey, latestCheck, normalizeId, onboardingSteps, PAN_RE, VPA_RE, type StepState } from "../lib/logic";
import { useKycSubject, useSubmitKycCheck } from "../lib/queries";
import { useSetMyPayoutAccount, useVendor } from "../lib/vendor";
import type { KycCheck, VendorSelf } from "../lib/types";

const DEV = process.env.NODE_ENV !== "production";

/** Seller onboarding checklist: profile, KYC (PAN, bank/UPI) with live results, payout account, approval. */
export default function OnboardingPage() {
  const { t } = useI18n();
  const { self, vendorId } = useVendor();
  const kycOn = useFeature("kyc");
  const subject = useKycSubject(vendorId, kycOn);
  if (!self) return null;
  const checks = kycOn ? (subject.data?.checks ?? []) : null;
  const steps = onboardingSteps(self, checks);
  const pct = Math.round((steps.done / steps.total) * 100);

  return (
    <Page width="narrow">
      <PageHeading icon={ClipboardCheckIcon} title={t("marketplace.onboarding.title")} description={t("marketplace.onboarding.subtitle", { name: self.name })} />
      <Card className="p-card mb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">{t("marketplace.onboarding.progress", { done: steps.done, total: steps.total })}</p>
          <span className="font-heading text-lg font-semibold tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} className="h-2" />
        {self.status === "pending" && <p className="text-sm text-muted-foreground">{t("marketplace.onboarding.pendingNote")}</p>}
      </Card>

      {kycOn && subject.isError && <QueryError compact error={subject.error} onRetry={() => void subject.refetch()} />}

      <ol className="grid gap-3">
        <Step state={steps.profile} icon={StoreIcon} title={t("marketplace.onboarding.profile")} body={t("marketplace.onboarding.profileBody")}>
          <Button asChild variant={steps.profile === "done" ? "outline" : "default"}>
            <ModuleLink to="profile">{t(steps.profile === "done" ? "marketplace.onboarding.editProfile" : "marketplace.onboarding.completeProfile")}</ModuleLink>
          </Button>
        </Step>
        {kycOn &&
          (subject.isPending ? (
            <Skeleton className="h-40 rounded-2xl" />
          ) : (
            <>
              <Step state={steps.pan} icon={IdCardIcon} title={t("marketplace.onboarding.pan")} body={t("marketplace.onboarding.panBody")}>
                <PanCheck vendorId={vendorId} last={latestCheck(subject.data?.checks ?? [], ["pan"])} />
              </Step>
              <Step state={steps.bank} icon={BuildingIcon} title={t("marketplace.onboarding.bank")} body={t("marketplace.onboarding.bankBody")}>
                <BankCheck vendorId={vendorId} self={self} last={latestCheck(subject.data?.checks ?? [], ["bank_account", "upi"])} />
              </Step>
            </>
          ))}
        <Step state={steps.payout} icon={LandmarkIcon} title={t("marketplace.onboarding.payout")} body={t("marketplace.onboarding.payoutBody")}>
          <PayoutAccountStep self={self} />
        </Step>
        <Step state={steps.approval} icon={UserRoundCheckIcon} title={t("marketplace.onboarding.approval")} body={t(`marketplace.onboarding.approval.${self.status}`)} />
      </ol>

      {kycOn && DEV && <TestValues />}
    </Page>
  );
}

function Step({ state, icon: Icon, title, body, children }: { state: StepState; icon: React.ComponentType<{ className?: string }>; title: string; body: string; children?: React.ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(state !== "done");
  React.useEffect(() => {
    if (state === "done") setOpen(false);
  }, [state]);
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={cn("gap-0 overflow-hidden p-0", state === "done" && "bg-success/5")}>
        <button
          type="button"
          onClick={() => children && setOpen(!open)}
          className="flex w-full items-center gap-3 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
          aria-expanded={children ? open : undefined}
        >
          <motion.span key={state} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}>
            <StepIcon state={state} />
          </motion.span>
          <span className="icon-chip hidden size-9 rounded-xl text-primary sm:flex">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{title}</span>
            <span className="block text-sm text-muted-foreground">{body}</span>
          </span>
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">{t(`marketplace.onboarding.state.${state}`)}</span>
        </button>
        <AnimatePresence initial={false}>
          {children && open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
              <div className="border-t px-4 py-4 sm:px-5">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.li>
  );
}

/** Latest result of a check: status, the name on record and a friendly error. */
function CheckResult({ check }: { check: KycCheck }) {
  const { t, formatDate } = useI18n();
  return (
    <motion.div
      key={check.id}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "grid gap-1 rounded-xl border p-3 text-sm",
        check.status === "verified" && "border-success/40 bg-success/10",
        check.status === "failed" && "border-destructive/30 bg-destructive/5",
        check.status === "manual_review" && "border-warning/40 bg-warning/10",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CheckPill status={check.status} />
        <span className="text-xs text-muted-foreground">{formatDate(check.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
      </div>
      {check.nameOnRecord && <p>{t("marketplace.kyc.nameOnRecord", { name: check.nameOnRecord })}</p>}
      {check.error && <p className={check.status === "failed" ? "text-danger-ink" : "text-warning-ink"}>{t(kycErrorKey(check.error))}</p>}
    </motion.div>
  );
}

function PanCheck({ vendorId, last }: { vendorId: string; last: KycCheck | null }) {
  const { t } = useI18n();
  const submit = useSubmitKycCheck(vendorId);
  const [pan, setPan] = React.useState("");
  const [name, setName] = React.useState("");
  const [tried, setTried] = React.useState(false);
  const p = normalizeId(pan);
  const err = !PAN_RE.test(p) ? t("marketplace.validation.pan") : null;
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (err) return;
    try {
      const r = await submit.mutateAsync({ type: "pan", input: { pan: p, ...(name.trim() ? { name: name.trim() } : {}) } });
      if (r.check.status === "verified") toast.success(t("marketplace.kyc.panVerified"));
      else toast.error(t(kycErrorKey(r.check.error)));
    } catch (e2) {
      toast.error(describeError(e2, t));
    }
  };
  return (
    <div className="grid gap-3">
      {last && <CheckResult check={last} />}
      {last?.status !== "verified" && (
        <form onSubmit={run} noValidate className="grid gap-3">
          <FieldRow>
            <Field invalid={tried && !!err}>
              <FieldLabel>{t("marketplace.kyc.pan")}</FieldLabel>
              <FieldControl>
                <Input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={12} placeholder="ABCDE1234F" autoCapitalize="characters" className="font-mono" />
              </FieldControl>
              <FieldError>{tried ? err : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.kyc.panName")}</FieldLabel>
              <FieldControl>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </FieldControl>
              <FieldHint>{t("marketplace.kyc.panNameHint")}</FieldHint>
            </Field>
          </FieldRow>
          <div className="flex justify-end">
            <SubmitButton pending={submit.isPending}>{submit.isPending ? t("marketplace.kyc.checking") : t("marketplace.kyc.verify")}</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}

function BankCheck({ vendorId, self, last }: { vendorId: string; self: VendorSelf; last: KycCheck | null }) {
  const { t } = useI18n();
  const submit = useSubmitKycCheck(vendorId);
  const saveAccount = useSetMyPayoutAccount();
  const [kind, setKind] = React.useState<"bank" | "upi">("bank");
  const [acc, setAcc] = React.useState("");
  const [ifsc, setIfsc] = React.useState("");
  const [vpa, setVpa] = React.useState("");
  const [name, setName] = React.useState(self.contactName ?? "");
  const [tried, setTried] = React.useState(false);
  const [verified, setVerified] = React.useState<{ kind: "bank" | "upi"; acc: string; ifsc: string; vpa: string; name: string } | null>(null);
  const errs =
    kind === "bank"
      ? {
          acc: !ACCOUNT_RE.test(acc.replace(/\s+/g, "")) ? t("marketplace.validation.accountNumber") : null,
          ifsc: !IFSC_RE.test(normalizeId(ifsc)) ? t("marketplace.validation.ifsc") : null,
          vpa: null,
        }
      : { acc: null, ifsc: null, vpa: !VPA_RE.test(vpa.trim()) ? t("marketplace.validation.vpa") : null };

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errs.acc || errs.ifsc || errs.vpa) return;
    const input =
      kind === "bank"
        ? { accountNumber: acc.replace(/\s+/g, ""), ifsc: normalizeId(ifsc), ...(name.trim() ? { name: name.trim() } : {}) }
        : { vpa: vpa.trim().toLowerCase(), ...(name.trim() ? { name: name.trim() } : {}) };
    try {
      const r = await submit.mutateAsync({ type: kind === "bank" ? "bank_account" : "upi", input });
      if (r.check.status === "verified") {
        toast.success(t("marketplace.kyc.accountVerified"));
        setVerified({ kind, acc: acc.replace(/\s+/g, ""), ifsc: normalizeId(ifsc), vpa: vpa.trim().toLowerCase(), name: (r.check.nameOnRecord ?? name).trim() });
      } else toast.error(t(kycErrorKey(r.check.error)));
    } catch (e2) {
      toast.error(describeError(e2, t));
    }
  };

  const useForPayouts = async () => {
    if (!verified) return;
    try {
      await saveAccount.mutateAsync(
        verified.kind === "bank"
          ? { type: "bank", holderName: verified.name || self.name, accountNumber: verified.acc, ifsc: verified.ifsc }
          : { type: "upi", vpa: verified.vpa, ...(verified.name ? { holderName: verified.name } : {}) },
      );
      toast.success(t("marketplace.account.savedVendor"));
      setVerified(null);
    } catch (e2) {
      toast.error(describeError(e2, t));
    }
  };

  return (
    <div className="grid gap-3">
      {last && <CheckResult check={last} />}
      <AnimatePresence>
        {verified && self.role === "owner" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
              <span>{t("marketplace.kyc.useForPayouts")}</span>
              <Button size="sm" onClick={() => void useForPayouts()} disabled={saveAccount.isPending}>
                {saveAccount.isPending && <Loader2Icon className="animate-spin" />} {t("marketplace.kyc.useForPayoutsCta")}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {last?.status !== "verified" && (
        <form onSubmit={run} noValidate className="grid gap-3">
          <Field>
            <FieldLabel htmlFor={null}>{t("marketplace.account.kind")}</FieldLabel>
            <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as "bank" | "upi")} className="w-full">
              <ToggleGroupItem value="bank" className="flex-1">
                <BuildingIcon /> {t("marketplace.account.bank")}
              </ToggleGroupItem>
              <ToggleGroupItem value="upi" className="flex-1">
                <SmartphoneIcon /> {t("marketplace.account.upi")}
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          {kind === "bank" ? (
            <FieldRow>
              <Field invalid={tried && !!errs.acc}>
                <FieldLabel>{t("marketplace.account.accountNumber")}</FieldLabel>
                <FieldControl>
                  <Input value={acc} onChange={(e) => setAcc(e.target.value.replace(/[^\d\s]/g, ""))} inputMode="numeric" autoComplete="off" className="font-mono" />
                </FieldControl>
                <FieldError>{tried ? errs.acc : null}</FieldError>
              </Field>
              <Field invalid={tried && !!errs.ifsc}>
                <FieldLabel>{t("marketplace.account.ifsc")}</FieldLabel>
                <FieldControl>
                  <Input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="SBIN0001234" className="font-mono" />
                </FieldControl>
                <FieldError>{tried ? errs.ifsc : null}</FieldError>
              </Field>
            </FieldRow>
          ) : (
            <Field invalid={tried && !!errs.vpa}>
              <FieldLabel>{t("marketplace.account.vpa")}</FieldLabel>
              <FieldControl>
                <Input value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@okbank" autoCapitalize="none" inputMode="email" />
              </FieldControl>
              <FieldError>{tried ? errs.vpa : null}</FieldError>
            </Field>
          )}
          <Field>
            <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.account.holderName")}</FieldLabel>
            <FieldControl>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </FieldControl>
            <FieldHint>{t("marketplace.kyc.holderHint")}</FieldHint>
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={submit.isPending}>{submit.isPending ? t("marketplace.kyc.checking") : t("marketplace.kyc.verify")}</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}

function PayoutAccountStep({ self }: { self: VendorSelf }) {
  const { t } = useI18n();
  const save = useSetMyPayoutAccount();
  const [draft, setDraft] = React.useState<AccountDraft>(emptyAccount());
  const [tried, setTried] = React.useState(false);
  const [editing, setEditing] = React.useState(!self.payoutAccount);
  const errors = accountErrors(draft);
  const owner = self.role === "owner";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) return;
    try {
      await save.mutateAsync(toAccountInput(draft));
      toast.success(t("marketplace.account.savedVendor"));
      setEditing(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <div className="grid gap-3">
      {self.payoutAccount && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
          <span className="font-mono text-sm">{accountText(self.payoutAccount)}</span>
          <AccountPill status={self.payoutAccountStatus} />
        </div>
      )}
      {self.payoutAccountStatus === "pending" && <p className="text-sm text-muted-foreground">{t("marketplace.account.pendingVendor")}</p>}
      {self.payoutAccountStatus === "rejected" && <p className="text-sm text-danger-ink">{t("marketplace.account.rejectedVendor")}</p>}
      {!owner ? (
        <p className="text-sm text-muted-foreground">{t("marketplace.account.ownerOnly")}</p>
      ) : editing ? (
        <form onSubmit={submit} noValidate className="grid gap-3">
          <AccountFields value={draft} onChange={setDraft} errors={tried ? errors : {}} />
          <div className="flex justify-end gap-2">
            {self.payoutAccount && (
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                {t("marketplace.common.cancel")}
              </Button>
            )}
            <SubmitButton pending={save.isPending}>{t("marketplace.account.save")}</SubmitButton>
          </div>
        </form>
      ) : (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setEditing(true)}>
            {t("marketplace.account.change")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Development only: inputs the mock KYC provider answers deterministically. */
function TestValues() {
  const { t } = useI18n();
  const rows: [string, string][] = [
    ["PAN ABCDE1234F", t("marketplace.kyc.test.panOk")],
    ["PAN …Z", t("marketplace.kyc.test.panFail")],
    ["PAN …Y", t("marketplace.kyc.test.panOutage")],
    ["A/c …0000", t("marketplace.kyc.test.bankFail")],
    ["A/c …9999", t("marketplace.kyc.test.bankOther")],
    ["UPI fail…@", t("marketplace.kyc.test.upiFail")],
    ["UPI other…@", t("marketplace.kyc.test.upiOther")],
  ];
  return (
    <details className="mt-6 rounded-2xl border border-dashed p-4 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-muted-foreground">
        <FlaskConicalIcon className="size-4" /> {t("marketplace.kyc.test.title")}
      </summary>
      <dl className="mt-3 grid gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="font-mono text-xs">{k}</dt>
            <dd className="text-muted-foreground">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
    </details>
  );
}
