"use client";

import * as React from "react";
import { BanknoteIcon, FileTextIcon, Link2Icon, Loader2Icon, PrinterIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Label, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@srirealtime/ui";
import { apiUrl, describeError, Page, PageHeading, QueryError, useFeature, useI18n } from "@srirealtime/web";
import { useHasPermission } from "../lib/access";
import { CopyButton } from "../components/copy-button";
import { fetchPdf } from "../lib/pdf";
import { money } from "../lib/format";
import { useLoanConsent, useLoanPack, useLoanPacks, useMakeLoanPack, useRevokeLoanPack, useShareLoanPack, type LoanPack } from "../lib/ai-money";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_TA = ["ஜன.", "பிப்.", "மார்.", "ஏப்.", "மே", "ஜூன்", "ஜூலை", "ஆக.", "செப்.", "அக்.", "நவ.", "டிச."];

/** Loan readiness pack: owner or admin only. A consent screen, then a preview, a printable PDF and an expiring link. Nothing is sent to a lender. */
export default function LoanPackPage() {
  const { t } = useI18n();
  const allowed = useHasPermission("ai.manage");
  const aiFeature = useFeature("ai");
  const [packId, setPackId] = React.useState<string | null>(null);
  return (
    <Page>
      <PageHeading icon={BanknoteIcon} title={t("billing.loan.title")} description={t("billing.loan.subtitle")} />
      {!allowed || !aiFeature ? (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>{t("billing.loan.ownerOnlyTitle")}</AlertTitle>
          <AlertDescription>{t("billing.loan.ownerOnlyBody")}</AlertDescription>
        </Alert>
      ) : packId ? (
        <Preview id={packId} onBack={() => setPackId(null)} />
      ) : (
        <Consent onMade={(p) => setPackId(p.id)} onOpen={setPackId} />
      )}
    </Page>
  );
}

function Consent({ onMade, onOpen }: { onMade: (p: LoanPack) => void; onOpen: (id: string) => void }) {
  const { t, locale, formatDate } = useI18n();
  const lang = locale === "ta" ? "ta" : "en";
  const consent = useLoanConsent();
  const make = useMakeLoanPack();
  const packs = useLoanPacks();
  const [agree, setAgree] = React.useState(false);
  const [showNames, setShowNames] = React.useState(false);
  if (consent.isError) return <QueryError error={consent.error} onRetry={() => void consent.refetch()} />;
  if (!consent.data) return <Skeleton className="h-80 rounded-2xl" />;
  return (
    <div className="grid gap-section">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("billing.loan.consentTitle")}</CardTitle>
          <p className="text-meta text-muted-foreground">{t("billing.loan.consentLead")}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="grid gap-2.5" data-testid="loan-sections">
            {consent.data.sections.map((s) => (
              <li key={s.key} className="flex items-start gap-2 text-sm">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="font-medium">{lang === "ta" ? s.ta : s.en}</span>
                  <span className="block text-muted-foreground">{lang === "ta" ? s.descTa : s.descEn}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border p-3 text-sm text-muted-foreground">
            <p>{t("billing.loan.notIncluded")}</p>
            <p className="mt-1">{t("billing.loan.notSent")}</p>
            <p className="mt-1">{consent.data.disclaimer[lang]}</p>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="loan-names" checked={showNames} onCheckedChange={(v) => setShowNames(v === true)} className="mt-0.5" />
            <Label htmlFor="loan-names" className="text-sm font-normal leading-snug">
              {t("billing.loan.showNames")}
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="loan-agree" checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" />
            <Label htmlFor="loan-agree" className="text-sm font-normal leading-snug">
              {t("billing.loan.agree")}
            </Label>
          </div>
          <div>
            <Button
              type="button"
              className="h-11 sm:h-9"
              disabled={!agree || make.isPending}
              onClick={() => make.mutate({ showNames }, { onSuccess: onMade, onError: (e) => toast.error(describeError(e, t)) })}
            >
              {make.isPending ? <Loader2Icon className="animate-spin" /> : <FileTextIcon />}
              {t("billing.loan.prepare")}
            </Button>
          </div>
        </CardContent>
      </Card>
      {packs.data && packs.data.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("billing.loan.earlier")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5">
            {packs.data.items.map((p) => (
              <button key={p.id} type="button" className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(p.id)}>
                <span>{formatDate(p.createdAt, { day: "numeric", month: "short", year: "numeric" })}</span>
                <span className="text-xs text-muted-foreground">{p.shareActive ? t("billing.loan.linkLive") : ""}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Preview({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, locale, formatDate } = useI18n();
  const lang = locale === "ta" ? "ta" : "en";
  const q = useLoanPack(id);
  const [busy, setBusy] = React.useState<string | null>(null);
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  const p = q.data;
  const f = p.facts;
  const label = (m: string) => `${(lang === "ta" ? MONTHS_TA : MONTHS_EN)[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

  const openPdf = async (pdfLocale: "en" | "ta") => {
    const key = `pdf-${pdfLocale}`;
    const win = window.open("", "_blank");
    setBusy(key);
    try {
      const { blob } = await fetchPdf(`/documents/loan-pack/${id}.pdf`, { locale: pdfLocale });
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      if (win) win.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      win?.close();
      toast.error(describeError(e, t));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-section">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-11 sm:h-9" onClick={onBack}>
          {t("billing.loan.back")}
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={busy !== null} onClick={() => void openPdf("en")}>
            {busy === "pdf-en" ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />}
            {t("billing.loan.pdfEn")}
          </Button>
          <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={busy !== null} onClick={() => void openPdf("ta")}>
            {busy === "pdf-ta" ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />}
            {t("billing.loan.pdfTa")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("billing.loan.coverTitle")}</CardTitle>
          <p className="text-meta text-muted-foreground">{p.cover.source === "ai" ? t("billing.loan.coverAi", { credits: p.credits }) : t("billing.loan.coverTemplate")}</p>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">English (for the lender)</p>
            <p data-testid="loan-cover-en" className="leading-relaxed">{p.cover.en}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">தமிழ் (உங்களுக்காக)</p>
            <p data-testid="loan-cover-ta" className="leading-relaxed">{p.cover.ta}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("billing.loan.figuresTitle", { from: label(f.from), to: label(f.to) })}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Fig label={t("billing.loan.totalSales")} value={money(f.totals.sales)} />
            <Fig label={t("billing.loan.avgMonth")} value={money(f.totals.avgMonthly)} />
            <Fig label={t("billing.loan.growth")} value={f.totals.growthPct === null ? "-" : `${f.totals.growthPct}%`} />
            <Fig label={t("billing.loan.margin")} value={f.totals.marginPct === null ? "-" : `${f.totals.marginPct}%`} />
            <Fig label={t("billing.loan.top1")} value={`${f.concentration.top1SharePct}%`} />
            <Fig label={t("billing.loan.top5")} value={`${f.concentration.top5SharePct}%`} />
            <Fig label={t("billing.loan.receivables")} value={money(f.receivables.total)} />
            {f.payables && <Fig label={t("billing.loan.payables")} value={money(f.payables.total)} />}
            {f.stockValue !== null && <Fig label={t("billing.loan.stock")} value={money(f.stockValue)} />}
            {f.balance.average !== null && <Fig label={t("billing.loan.avgBalance")} value={money(f.balance.average)} />}
          </dl>
          <div className="overflow-x-auto" tabIndex={0} aria-label={t("billing.loan.monthsTable")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.loan.col.month")}</TableHead>
                  <TableHead className="text-right">{t("billing.loan.col.sales")}</TableHead>
                  <TableHead className="text-right">{t("billing.loan.col.gst")}</TableHead>
                  <TableHead>{t("billing.loan.col.filed")}</TableHead>
                  <TableHead className="text-right">{t("billing.loan.col.margin")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.months.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="whitespace-nowrap">{label(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(m.sales)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(m.gstOutput)}</TableCell>
                    <TableCell>{m.gstr1Filed ? t("billing.loan.yes") : t("billing.loan.no")}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.marginPct === null ? "-" : `${m.marginPct}%`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("billing.loan.customersNote", { names: f.concentration.namesShown ? t("billing.loan.namesShown") : t("billing.loan.namesHidden") })} {t("billing.loan.madeOn", { date: formatDate(p.createdAt, { day: "numeric", month: "short", year: "numeric" }) })}
          </p>
        </CardContent>
      </Card>

      <ShareCard pack={p} />
    </div>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-heading text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ShareCard({ pack }: { pack: LoanPack }) {
  const { t, formatDate } = useI18n();
  const share = useShareLoanPack(pack.id);
  const revoke = useRevokeLoanPack(pack.id);
  const [days, setDays] = React.useState(7);
  const [fresh, setFresh] = React.useState<{ token: string; expiresAt: string } | null>(null);
  const live = pack.share.active;
  const token = fresh?.token ?? pack.share.token;
  const url = token ? apiUrl(`/ai/money/public/loan-pack/${token}.pdf`) : "";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("billing.loan.shareTitle")}</CardTitle>
        <p className="text-meta text-muted-foreground">{t("billing.loan.shareHint")}</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {live && token ? (
          <div className="grid gap-2" data-testid="loan-link">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-2 text-xs" title={url}>{url}</code>
              <CopyButton value={url} />
            </div>
            <p className="text-xs text-muted-foreground">{t("billing.loan.expires", { date: formatDate(fresh?.expiresAt ?? pack.share.expiresAt ?? "", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) })}</p>
            <div>
              <Button
                type="button"
                variant="outline"
                className="h-11 text-destructive sm:h-9"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(undefined, { onSuccess: () => (setFresh(null), toast.success(t("billing.loan.revoked"))), onError: (e) => toast.error(describeError(e, t)) })}
              >
                {revoke.isPending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                {t("billing.loan.revoke")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="loan-days">{t("billing.loan.validFor")}</Label>
              <select id="loan-days" className="h-11 rounded-md border bg-background px-3 text-sm sm:h-9" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {t("billing.loan.daysOption", { count: d })}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" className="h-11 sm:h-9" disabled={share.isPending} onClick={() => share.mutate(days, { onSuccess: (r) => setFresh({ token: r.token, expiresAt: r.expiresAt }), onError: (e) => toast.error(describeError(e, t)) })}>
              {share.isPending ? <Loader2Icon className="animate-spin" /> : <Link2Icon />}
              {t("billing.loan.makeLink")}
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("billing.loan.linkWarn")}</p>
      </CardContent>
    </Card>
  );
}
