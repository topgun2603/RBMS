import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon, SearchXIcon, ShieldCheckIcon, ThumbsDownIcon, WrenchIcon } from "lucide-react";
import { cn } from "@rbms/ui/lib/utils";
import { EstimateAnswer, RepairLookup, WarrantyLookup } from "../client/aftersales";
import { Container, Empty } from "../components/bits";
import { money } from "../lib/format";
import { aftersalesText, fill } from "../lib/messages-aftersales";
import { apiGetOrNull, getRequestInfo, hasFeature } from "../server/api";

/*
 * After-sales pages: /warranty (warranty by serial / IMEI, feature `serials.warranty`), /track-repair (job number +
 * phone digits → the job's page, feature `jobcards.tracking`) and the job's tracking page /job/<token> with the
 * estimate approval. Nothing here shows the customer's name or phone.
 */

function Heading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <>
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&_svg]:size-7">{icon}</span>
      <h1 className="sf-heading mt-4 font-display text-h1 font-semibold">{title}</h1>
      <p className="mt-2 mb-8 text-muted-foreground">{subtitle}</p>
    </>
  );
}

// ------------------------------------------------------------------ /warranty

export async function warrantyMetadata(): Promise<Metadata> {
  const { locale } = await getRequestInfo();
  return { title: aftersalesText(locale)["warranty.title"] };
}

/** Warranty lookup by serial number / IMEI (optional `?code=` prefills it). */
export async function WarrantyPage({ searchParams }: { searchParams?: Promise<{ code?: string | string[] }> } = {}) {
  const { locale } = await getRequestInfo();
  const text = aftersalesText(locale);
  const [on, repairs] = await Promise.all([hasFeature("serials.warranty"), hasFeature("jobcards.tracking")]);
  if (!on) return <Empty icon={<ShieldCheckIcon />} title={text["warranty.off"]} body={text["warranty.offBody"]} className="mx-auto my-16 max-w-md" />;
  const raw = (await searchParams)?.code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 60).toUpperCase() ?? "";
  return (
    <Container className="max-w-xl py-10 pb-24">
      <Heading icon={<ShieldCheckIcon />} title={text["warranty.title"]} subtitle={text["warranty.subtitle"]} />
      <WarrantyLookup text={text} locale={locale} initialCode={code} repairHref={repairs ? "/track-repair" : null} />
    </Container>
  );
}

// ------------------------------------------------------------------ /track-repair

export async function trackRepairMetadata(): Promise<Metadata> {
  const { locale } = await getRequestInfo();
  return { title: aftersalesText(locale)["repair.title"] };
}

/** "Track my repair": job number + the last 4 digits of the phone → /job/<token>. */
export async function TrackRepairPage() {
  const { locale } = await getRequestInfo();
  const text = aftersalesText(locale);
  const [on, warranty] = await Promise.all([hasFeature("jobcards.tracking"), hasFeature("serials.warranty")]);
  if (!on) return <Empty icon={<WrenchIcon />} title={text["repair.off"]} body={text["repair.offBody"]} className="mx-auto my-16 max-w-md" />;
  return (
    <Container className="max-w-xl py-10 pb-24">
      <Heading icon={<WrenchIcon />} title={text["repair.title"]} subtitle={text["repair.subtitle"]} />
      <RepairLookup text={text} />
      {warranty && (
        <p className="mt-6 text-sm">
          <Link href="/warranty" className="font-semibold text-primary hover:underline">
            {text["repair.warranty"]} →
          </Link>
        </p>
      )}
    </Container>
  );
}

// ------------------------------------------------------------------ /job/<token>

interface JobTrack {
  label: string;
  template: "device" | "garment" | "eyewear" | "general";
  status: string;
  dueDate: string | null;
  total: number;
  createdAt: string;
  timeline: { status: string; at: string }[];
  approval: { decision: "approved" | "declined"; channel: string; at: string; amount: number } | null;
  canRespond: boolean;
}

const FLOW = ["received", "diagnosed", "awaiting_approval", "approved", "in_progress", "trial", "ready", "delivered"] as const;
const getJob = (token: string) => apiGetOrNull<JobTrack>(`/jobcards/public/track/${encodeURIComponent(token)}`, { revalidate: 0 }).catch(() => null);

export async function jobTrackMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { t } = await getRequestInfo();
  const j = await getJob(token);
  return { title: j ? t("job.title", { label: j.label }) : t("job.notFound"), robots: { index: false, follow: false } };
}

/**
 * The customer's job (repair, stitching, spectacles): where it is, when it's due, and — while the shop waits for it —
 * the estimate to approve or decline (feature `jobcards.tracking`).
 */
export async function JobTrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t, locale } = await getRequestInfo();
  const text = aftersalesText(locale);
  const [on, j] = await Promise.all([hasFeature("jobcards.tracking"), getJob(token)]);
  if (!on || !j) return <Empty icon={<SearchXIcon />} title={t("job.notFound")} body={t("job.notFoundBody")} className="mx-auto my-16 max-w-md" />;
  const intl = locale === "ta" ? "ta-IN" : "en-IN";
  const fmt = (iso: string) => new Date(iso).toLocaleString(intl, { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const label = (s: string) => (s === "approved" ? text["job.status.approved"] : t(`job.status.${s}`));
  const reached = new Map(j.timeline.map((e) => [e.status, e.at]));
  const at = FLOW.indexOf(j.status as (typeof FLOW)[number]);
  // Steps: every step the job went through, plus the ones still ahead (trial only for stitching; "approved" only while
  // an approval is awaited).
  const ahead = (s: (typeof FLOW)[number]) => FLOW.indexOf(s) > at && (s !== "trial" || j.template === "garment") && (s !== "approved" || j.status === "awaiting_approval");
  const steps = FLOW.filter((s) => reached.has(s) || s === j.status || ahead(s));
  const cancelled = j.status === "cancelled";
  const a = j.approval;
  return (
    <Container className="max-w-xl py-10 pb-24">
      <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
        <WrenchIcon className="size-4" /> {t(`job.template.${j.template}`)}
      </p>
      <h1 className="sf-heading mt-3 font-display text-h1 font-semibold">{t("job.title", { label: j.label })}</h1>
      <p className="mt-2 text-muted-foreground">{t("job.subtitle")}</p>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {j.dueDate && !cancelled && <span>{t("job.due", { date: new Date(`${j.dueDate}T00:00:00+05:30`).toLocaleDateString(intl, { day: "numeric", month: "long" }) })}</span>}
        {j.total > 0 && (
          <span>
            {t("job.total")}: <strong className="tabular-nums">{money(j.total)}</strong>
          </span>
        )}
      </div>

      {j.canRespond && <EstimateAnswer token={token} total={money(j.total)} text={text} />}
      {a && !j.canRespond && (
        <p
          className={cn(
            "mt-8 flex gap-2 rounded-[var(--sf-radius-card)] border p-4 text-sm",
            a.decision === "approved" ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5",
          )}
        >
          {a.decision === "approved" ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" /> : <ThumbsDownIcon className="mt-0.5 size-4 shrink-0 text-destructive" />}
          {fill(text[a.decision === "approved" ? (a.channel === "online" ? "job.approval.approved" : "job.approval.approvedShop") : a.channel === "online" ? "job.approval.declined" : "job.approval.declinedShop"], {
            amount: money(a.amount),
            date: fmt(a.at),
          })}
        </p>
      )}

      {cancelled ? (
        <p className="mt-8 rounded-[var(--sf-radius-card)] border border-destructive/40 bg-destructive/5 p-4 font-medium text-destructive">{t("job.status.cancelled")}</p>
      ) : (
        <ol className="mt-8 grid gap-0">
          {steps.map((s, i) => {
            const when = reached.get(s);
            const current = s === j.status;
            const done = !!when || current;
            return (
              <li key={s} className="relative grid grid-cols-[2rem_1fr] gap-3 pb-6 last:pb-0">
                {i < steps.length - 1 && <span aria-hidden className={cn("absolute top-8 bottom-0 left-[0.95rem] w-0.5", done ? "bg-primary" : "bg-border")} />}
                <span className={cn("relative grid size-8 place-items-center rounded-full border-2", done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background", current && "ring-4 ring-primary/20")}>
                  {done ? <CheckIcon className="size-4" /> : <span className="size-2 rounded-full bg-border" />}
                </span>
                <span className="pt-1">
                  <span className={cn("block font-medium", !done && "text-muted-foreground")}>{label(s)}</span>
                  {when && <span className="text-sm text-muted-foreground">{fmt(when)}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Container>
  );
}
