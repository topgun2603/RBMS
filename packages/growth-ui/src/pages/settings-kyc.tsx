"use client";

import * as React from "react";
import {
  BadgeCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FileUpIcon,
  Loader2Icon,
  SearchCheckIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import {
  AnimatePresence,
  Badge,
  Button,
  ChipGroup,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Meter,
  motion,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  toast,
  useReducedMotionSafe,
  type StatusTone,
} from "@rbms/ui";
import { absoluteUrl, ConfirmDialog, describeError, Page, PageHeading, QueryError, SettingsNav, tOr, useI18n, useShop } from "@rbms/web";
import { InlineError, NoAccess, SectionCard, useCan } from "../components/bits";
import { isValidPan, isValidShopGstin, latestChecks, maskedRows, normalizeId, panFromGstin, scoreBand, STATUS_TONE } from "../lib/kyc";
import { uploadKycFile, useAddDocument, useKycSubject, useRemoveDocument, useSubmitCheck } from "../lib/queries/kyc";
import { KYC_DOCUMENT_KINDS, type KycCheck, type KycCheckStatus, type KycDocumentKind, type KycSubject } from "../lib/types";
import { GROWTH_PERMISSIONS } from "../module";

const CHECK_ICON: Record<KycCheckStatus, React.ComponentType<{ className?: string }>> = {
  verified: BadgeCheckIcon,
  pending: ClockIcon,
  manual_review: SearchCheckIcon,
  failed: XCircleIcon,
};
const CHECK_TONE: Record<KycCheckStatus, StatusTone> = { verified: "success", pending: "info", manual_review: "warning", failed: "danger" };

export default function KycSettingsPage() {
  const { t } = useI18n();
  const allowed = useCan(GROWTH_PERMISSIONS.kyc);
  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={ShieldCheckIcon} title={t("growth.kyc.title")} description={t("growth.kyc.subtitle")} />
      {allowed ? <ShopKyc /> : <NoAccess permission={GROWTH_PERMISSIONS.kyc} />}
    </Page>
  );
}

function ShopKyc() {
  const { tenant } = useShop();
  const subject = useKycSubject("shop", tenant.id);
  if (subject.isError) return <QueryError error={subject.error} onRetry={() => void subject.refetch()} />;
  if (subject.isPending) {
    return (
      <div className="grid gap-section" aria-busy="true">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }
  return (
    <div className="grid gap-section">
      <StatusHero subject={subject.data} />
      <CheckForm shopId={tenant.id} subject={subject.data} />
      <ChecksList checks={subject.data.checks} />
      <Documents shopId={tenant.id} subject={subject.data} />
    </div>
  );
}

function StatusHero({ subject: s }: { subject: KycSubject }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const tone = STATUS_TONE[s.status];
  const Icon = s.verified ? ShieldCheckIcon : s.status === "failed" ? ShieldAlertIcon : s.status === "none" ? CircleDashedIcon : ClockIcon;
  const badges = s.badges.filter((b) => b !== "verified");
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className={`icon-chip size-14 shrink-0 rounded-2xl ${s.verified ? "text-success-ink" : s.status === "failed" ? "text-danger-ink" : "text-primary"}`}>
          <Icon className="size-7" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-semibold">{t(`growth.kyc.headline.${s.status}`)}</h2>
            <StatusPill tone={tone} icon={Icon} size="md">
              {t(`growth.kyc.status.${s.status}`)}
            </StatusPill>
          </div>
          {s.verifiedName && <p className="text-sm">{t("growth.kyc.verifiedAs", { name: s.verifiedName })}</p>}
          {!s.verified && s.missing.length > 0 && <p className="text-sm text-muted-foreground">{t("growth.kyc.missing", { items: s.missing.join(", ") })}</p>}
          {s.updatedAt && <p className="text-meta text-muted-foreground">{t("growth.kyc.updated", { date: formatDate(s.updatedAt) })}</p>}
        </div>
      </div>
      {badges.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
          {badges.map((b) => (
            <Badge key={b} variant="secondary" className="gap-1">
              <BadgeCheckIcon className="size-3.5 text-success-ink" /> {tOr(t, `growth.kyc.badges.${b}`, b.toUpperCase())}
            </Badge>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function CheckForm({ shopId, subject }: { shopId: string; subject: KycSubject }) {
  const { t } = useI18n();
  const submit = useSubmitCheck("shop", shopId);
  const [type, setType] = React.useState<"gstin" | "pan">("gstin");
  const [id, setId] = React.useState("");
  const [name, setName] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [result, setResult] = React.useState<KycCheck | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const value = normalizeId(id);
  const formatError = !value ? t("growth.common.required") : type === "gstin" ? (isValidShopGstin(value) ? null : t("growth.kyc.invalidGstin")) : isValidPan(value) ? null : t("growth.kyc.invalidPan");
  const already = latestChecks(subject.checks).find((c) => c.type === type && c.status === "verified");

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    setResult(null);
    if (formatError) return;
    try {
      const input: Record<string, string> = type === "gstin" ? { gstin: value } : { pan: value };
      if (name.trim()) input.name = name.trim();
      const out = await submit.mutateAsync({ type, input });
      setResult(out.check);
      if (out.check.status === "verified") toast.success(t("growth.kyc.checkVerified"));
      else if (out.check.status === "failed") toast.error(out.check.error ?? t("growth.kyc.checkFailed"));
      else toast.info(t(`growth.kyc.checkStatus.${out.check.status}`));
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <SectionCard icon={SearchCheckIcon} title={t("growth.kyc.checkTitle")} description={t("growth.kyc.checkBody")}>
      <form onSubmit={go} className="grid gap-4">
        <ChipGroup
          aria-label={t("growth.kyc.checkType")}
          value={type}
          onChange={(v) => {
            setType(v);
            setSubmitted(false);
            setResult(null);
          }}
          options={[
            { value: "gstin", label: "GSTIN" },
            { value: "pan", label: "PAN" },
          ]}
        />
        {already && (
          <p className="flex items-center gap-1.5 text-sm text-success-ink">
            <BadgeCheckIcon className="size-4" /> {t("growth.kyc.alreadyVerified", { type: type.toUpperCase(), value: String(already.input[type] ?? "") })}
          </p>
        )}
        <FieldRow cols={2}>
          <Field invalid={submitted && !!formatError}>
            <FieldLabel>{type === "gstin" ? t("growth.kyc.gstin") : t("growth.kyc.pan")}</FieldLabel>
            <FieldControl>
              <Input
                className="font-mono uppercase"
                autoComplete="off"
                maxLength={type === "gstin" ? 15 : 10}
                value={id}
                placeholder={type === "gstin" ? "33ABCDE1234F1Z5" : "ABCDE1234F"}
                onChange={(e) => setId(e.target.value.toUpperCase())}
              />
            </FieldControl>
            <FieldHint>
              {type === "gstin" && value.length === 15 && isValidShopGstin(value)
                ? t("growth.kyc.gstinPan", { pan: panFromGstin(value) ?? "" })
                : type === "gstin"
                  ? t("growth.kyc.gstinHint")
                  : t("growth.kyc.panHint")}
            </FieldHint>
            <FieldError>{submitted ? formatError : null}</FieldError>
          </Field>
          <Field>
            <FieldLabel optional={t("growth.common.optional")}>{t("growth.kyc.legalName")}</FieldLabel>
            <FieldControl>
              <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </FieldControl>
            <FieldHint>{t("growth.kyc.legalNameHint")}</FieldHint>
          </Field>
        </FieldRow>
        {error && <InlineError title={error} />}
        <AnimatePresence>{result && <CheckResult key={result.id} check={result} />}</AnimatePresence>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={submit.isPending}>
            {submit.isPending ? <Loader2Icon className="animate-spin" /> : <SearchCheckIcon />}
            {t("growth.kyc.verify")}
          </Button>
          <p className="text-meta text-muted-foreground">{t("growth.kyc.privacy")}</p>
        </div>
      </form>
    </SectionCard>
  );
}

function CheckResult({ check: c }: { check: KycCheck }) {
  const { t } = useI18n();
  const Icon = CHECK_ICON[c.status];
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={CHECK_TONE[c.status]} icon={Icon}>
            {t(`growth.kyc.checkStatus.${c.status}`)}
          </StatusPill>
          {c.nameOnRecord && <span>{t("growth.kyc.nameOnRecord", { name: c.nameOnRecord })}</span>}
        </div>
        {c.nameMatchScore !== null && <ScoreMeter score={c.nameMatchScore} />}
        {c.error && <p className="text-danger-ink">{c.error}</p>}
      </div>
    </motion.div>
  );
}

function ScoreMeter({ score }: { score: number }) {
  const { t } = useI18n();
  const band = scoreBand(score);
  return (
    <div className="grid max-w-sm gap-1">
      <p className="flex justify-between text-xs">
        <span className="text-muted-foreground">{t("growth.kyc.nameMatch")}</span>
        <span className="font-medium tabular-nums">
          {score}/100 · {t(`growth.kyc.band.${band ?? "poor"}`)}
        </span>
      </p>
      <Meter value={score} max={100} warnAt={2} label={t("growth.kyc.nameMatch")} valueText={`${score}/100 · ${t(`growth.kyc.band.${band ?? "poor"}`)}`} />
    </div>
  );
}

function ChecksList({ checks }: { checks: KycCheck[] }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const sorted = [...checks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <SectionCard icon={ClockIcon} title={t("growth.kyc.historyTitle")} description={t("growth.kyc.historyBody")}>
      {sorted.length === 0 ? (
        <EmptyState compact icon={CircleDashedIcon} title={t("growth.kyc.noChecks")} />
      ) : (
        <ul className="grid">
          {sorted.map((c, i) => {
            const Icon = CHECK_ICON[c.status];
            return (
              <motion.li
                key={c.id}
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduced ? 0 : Math.min(i, 8) * 0.03 }}
                className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {tOr(t, `growth.kyc.types.${c.type}`, c.type)}
                    <StatusPill tone={CHECK_TONE[c.status]} icon={Icon}>
                      {t(`growth.kyc.checkStatus.${c.status}`)}
                    </StatusPill>
                    {c.review && (
                      <Badge variant="outline">{t(`growth.kyc.review.${c.review.decision}`)}</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-meta text-muted-foreground">
                    {maskedRows(c.input)
                      .map((r) => r.value)
                      .join(" · ")}
                  </p>
                  {(c.error || c.review?.reason) && <p className="mt-0.5 text-xs text-danger-ink">{c.review?.reason ?? c.error}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground sm:flex-col sm:items-end sm:gap-0.5">
                  <span>{formatDate(c.createdAt, { day: "numeric", month: "short", year: "numeric" })}</span>
                  {c.nameMatchScore !== null && <span className="tabular-nums">{t("growth.kyc.scoreShort", { score: c.nameMatchScore })}</span>}
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function Documents({ shopId, subject }: { shopId: string; subject: KycSubject }) {
  const { t, formatDate } = useI18n();
  const add = useAddDocument("shop", shopId);
  const remove = useRemoveDocument("shop", shopId);
  const [kind, setKind] = React.useState<KycDocumentKind>("gst_certificate");
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError(t("growth.kyc.fileTooBig"));
      return;
    }
    try {
      setProgress(0);
      const url = await uploadKycFile(file, setProgress);
      await add.mutateAsync({ kind, fileUrl: url });
      toast.success(t("growth.kyc.docAdded"));
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <SectionCard icon={FileTextIcon} title={t("growth.kyc.docsTitle")} description={t("growth.kyc.docsBody")}>
      <div className="grid gap-4">
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,16rem)_auto]">
          <Field>
            <FieldLabel>{t("growth.kyc.docKind")}</FieldLabel>
            <Select value={kind} onValueChange={(v) => setKind(v as KycDocumentKind)}>
              <FieldControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {KYC_DOCUMENT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`growth.kyc.docKinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="sr-only" aria-label={t("growth.kyc.upload")} onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button type="button" variant="outline" disabled={progress !== null} onClick={() => fileRef.current?.click()}>
              {progress !== null ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
              {t("growth.kyc.upload")}
            </Button>
          </div>
        </div>
        {progress !== null && <Progress value={progress} className="h-2" aria-label={t("growth.kyc.uploading", { pct: progress })} />}
        {error && <InlineError title={error} />}
        {subject.documents.length === 0 ? (
          <EmptyState compact icon={FileUpIcon} title={t("growth.kyc.noDocs")} description={t("growth.kyc.noDocsBody")} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {subject.documents.map((d) => (
                <motion.li
                  key={d.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3"
                >
                  <span className="icon-chip size-9 shrink-0 rounded-xl text-primary">
                    <FileTextIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t(`growth.kyc.docKinds.${d.kind}`)}</p>
                    <p className="text-meta text-muted-foreground">{formatDate(d.createdAt)}</p>
                  </div>
                  <Button asChild variant="ghost" size="icon-sm" aria-label={t("growth.kyc.openDoc")}>
                    <a href={absoluteUrl(d.fileUrl)} target="_blank" rel="noreferrer noopener">
                      <ExternalLinkIcon />
                    </a>
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={t("growth.common.remove")} onClick={() => setConfirm(d.id)}>
                    <Trash2Icon />
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("growth.kyc.removeDocTitle")}
        description={t("growth.kyc.removeDocBody")}
        confirmLabel={t("growth.common.remove")}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(confirm!);
            toast.success(t("growth.kyc.docRemoved"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </SectionCard>
  );
}
