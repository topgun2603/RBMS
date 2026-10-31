"use client";

/*
 * After-sales forms for shoppers: warranty lookup by serial / IMEI, "track my repair" by job number + phone digits, and
 * approving / declining a repair estimate on the job's tracking page. All go through the store proxy, without sign-in.
 * Copy comes from the server page (`aftersalesText`), so these stay free of the store's dictionary.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheckIcon, CalendarIcon, Loader2Icon, PackageIcon, SearchIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldXIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { cn } from "@rbms/ui/lib/utils";
import { fill, type AftersalesText } from "../lib/messages-aftersales";
import { ApiError, call } from "./api";

const inputCls =
  "h-11 w-full rounded-md border border-input bg-card px-4 text-base outline-none placeholder:text-muted-foreground/70 focus:ring-[3px] focus:ring-ring/30 aria-[invalid=true]:border-destructive";
const btnCls = "sf-btn inline-flex h-11 items-center justify-center gap-2 bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60";

function Label({ htmlFor, children, hint }: { htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-0.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {children}
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

// ------------------------------------------------------------------ warranty

export interface PublicWarranty {
  product: string;
  serial: string;
  purchaseDate: string | null;
  warrantyMonths: number;
  warrantyEnd: string | null;
  status: "active" | "expired" | "claimed" | "none";
  daysLeft: number | null;
}

const STATUS_STYLE: Record<PublicWarranty["status"], { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  active: { cls: "bg-success/10 text-success border-success/30", Icon: ShieldCheckIcon },
  claimed: { cls: "bg-warning/10 text-warning border-warning/40", Icon: ShieldAlertIcon },
  expired: { cls: "bg-muted text-muted-foreground border-border", Icon: ShieldXIcon },
  none: { cls: "bg-muted text-muted-foreground border-border", Icon: ShieldXIcon },
};

/** Serial / IMEI (+ optional phone digits) → the product's warranty, with no personal details. */
export function WarrantyLookup({ text, locale, initialCode = "", repairHref }: { text: AftersalesText; locale: string; initialCode?: string; repairHref?: string | null }) {
  const [code, setCode] = React.useState(initialCode);
  const [last4, setLast4] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<PublicWarranty | null>(null);
  const id = React.useId();
  const day = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString(locale === "ta" ? "ta-IN" : "en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (c.length < 3) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await call<PublicWarranty>("/serials/public/warranty", { query: { code: c, last4: last4.length === 4 ? last4 : undefined }, auth: false }));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? text["warranty.tooMany"] : text["warranty.notFound"]);
    } finally {
      setBusy(false);
    }
  };

  const s = result ? STATUS_STYLE[result.status] : null;
  return (
    <div className="grid gap-6">
      <form onSubmit={submit} className="grid gap-4 rounded-[var(--sf-radius-card)] border bg-card p-5 sm:p-6" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-code`}>{text["warranty.code"]}</Label>
          <input
            id={`${id}-code`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={text["warranty.codePlaceholder"]}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={60}
            required
            className={cn(inputCls, "font-mono tracking-wide")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-last4`} hint={text["warranty.last4Hint"]}>
            {text["warranty.last4"]}
          </Label>
          <input id={`${id}-last4`} value={last4} onChange={(e) => setLast4(onlyDigits(e.target.value))} inputMode="numeric" autoComplete="off" placeholder="••••" className={cn(inputCls, "w-32 font-mono tracking-[0.3em]")} />
        </div>
        <button type="submit" disabled={busy || code.trim().length < 3} className={cn(btnCls, "sm:w-fit")}>
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : <SearchIcon className="size-4" />}
          {busy ? text["warranty.checking"] : text["warranty.submit"]}
        </button>
        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      {result && s && (
        <section aria-live="polite" className="overflow-hidden rounded-[var(--sf-radius-card)] border bg-card">
          <div className={cn("flex items-center gap-3 border-b px-5 py-4", s.cls)}>
            <s.Icon className="size-6 shrink-0" />
            <div>
              <p className="text-lg font-semibold">{text[`warranty.status.${result.status}`]}</p>
              {result.status === "active" && result.daysLeft !== null && <p className="text-sm opacity-90">{fill(text["warranty.daysLeft"], { days: result.daysLeft })}</p>}
              {result.status === "claimed" && <p className="text-sm opacity-90">{text["warranty.claimedHint"]}</p>}
            </div>
          </div>
          <dl className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="grid gap-0.5 sm:col-span-2">
              <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <PackageIcon className="size-4" /> {text["warranty.product"]}
              </dt>
              <dd className="text-base font-semibold">{result.product}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">{text["warranty.serial"]}</dt>
              <dd className="font-mono text-sm break-all">{result.serial}</dd>
            </div>
            {result.warrantyMonths > 0 && (
              <div className="grid gap-0.5">
                <dt className="text-sm text-muted-foreground">{fill(text["warranty.months"], { months: result.warrantyMonths })}</dt>
                <dd className="font-medium">{result.warrantyEnd ? `${text["warranty.ends"]} ${day(result.warrantyEnd)}` : "—"}</dd>
              </div>
            )}
            {result.purchaseDate && (
              <div className="grid gap-0.5">
                <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CalendarIcon className="size-4" /> {text["warranty.purchased"]}
                </dt>
                <dd className="font-medium">{day(result.purchaseDate)}</dd>
              </div>
            )}
          </dl>
          {repairHref && (
            <p className="border-t px-5 py-3 text-sm">
              <Link href={repairHref} className="font-semibold text-primary hover:underline">
                {text["warranty.trackRepair"]} →
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ track my repair

/** Job number + the phone's last 4 digits → the job's tracking page. */
export function RepairLookup({ text }: { text: AftersalesText }) {
  const router = useRouter();
  const [number, setNumber] = React.useState("");
  const [last4, setLast4] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [tried, setTried] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const numberBad = !number.trim();
  const last4Bad = last4.length !== 4;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (numberBad || last4Bad) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ token: string }>("/jobcards/public/find", { method: "POST", body: { number: number.trim(), phoneLast4: last4 }, auth: false });
      router.push(`/job/${encodeURIComponent(r.token)}`);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? text["repair.tooMany"] : text["repair.notFound"]);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-[var(--sf-radius-card)] border bg-card p-5 sm:p-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-number`}>{text["repair.number"]}</Label>
          <input
            id={`${id}-number`}
            value={number}
            onChange={(e) => setNumber(e.target.value.toUpperCase())}
            placeholder={text["repair.numberPlaceholder"]}
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={20}
            aria-invalid={tried && numberBad}
            className={cn(inputCls, "font-mono tracking-wide")}
          />
          {tried && numberBad && <p className="text-xs text-destructive">{text["repair.numberInvalid"]}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-last4`}>{text["repair.last4"]}</Label>
          <input id={`${id}-last4`} value={last4} onChange={(e) => setLast4(onlyDigits(e.target.value))} inputMode="numeric" autoComplete="off" placeholder="••••" aria-invalid={tried && last4Bad} className={cn(inputCls, "font-mono tracking-[0.3em]")} />
          {tried && last4Bad && <p className="text-xs text-destructive">{text["repair.last4Invalid"]}</p>}
        </div>
      </div>
      <button type="submit" disabled={busy} className={cn(btnCls, "sm:w-fit")}>
        {busy ? <Loader2Icon className="size-4 animate-spin" /> : <SearchIcon className="size-4" />}
        {busy ? text["repair.finding"] : text["repair.submit"]}
      </button>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

// ------------------------------------------------------------------ estimate approval

/** Approve / decline the estimate on the job's tracking page, each behind a confirmation step. */
export function EstimateAnswer({ token, total, text }: { token: string; total: string; text: AftersalesText }) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState<"approve" | "decline" | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();

  const send = async () => {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/jobcards/public/track/${encodeURIComponent(token)}/approval`, { method: "POST", body: { decision: confirm, note: note.trim() || null }, auth: false });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429 && err.message ? err.message : text["job.approval.error"]);
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 rounded-[var(--sf-radius-card)] border-2 border-primary/40 bg-primary/5 p-5 sm:p-6" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="flex items-center gap-2 text-lg font-semibold">
        <BadgeCheckIcon className="size-5 text-primary" /> {text["job.approval.title"]}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{fill(text["job.approval.body"], { total })}</p>
      {confirm === null ? (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => setConfirm("approve")} className={cn(btnCls, "w-full sm:w-auto")}>
            <ThumbsUpIcon className="size-4" /> {fill(text["job.approval.approve"], { total })}
          </button>
          <button
            type="button"
            onClick={() => setConfirm("decline")}
            className="sf-btn inline-flex h-11 w-full items-center justify-center gap-2 border border-destructive/50 px-6 text-sm font-semibold text-destructive hover:bg-destructive/10 sm:w-auto"
          >
            <ThumbsDownIcon className="size-4" /> {text["job.approval.decline"]}
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 rounded-[var(--sf-radius-card)] border bg-card p-4" role="alertdialog" aria-labelledby={`${id}-q`}>
          <p id={`${id}-q`} className="font-medium">
            {confirm === "approve" ? fill(text["job.approval.confirmApprove"], { total }) : text["job.approval.confirmDecline"]}
          </p>
          <label htmlFor={`${id}-note`} className="text-sm text-muted-foreground">
            {text["job.approval.note"]}
          </label>
          <textarea id={`${id}-note`} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-md border border-input bg-background p-3 text-base outline-none focus:ring-[3px] focus:ring-ring/30" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={send}
              className={cn(
                confirm === "approve" ? btnCls : "sf-btn inline-flex h-11 items-center justify-center gap-2 bg-destructive px-6 text-sm font-semibold text-white disabled:opacity-60",
              )}
            >
              {busy && <Loader2Icon className="size-4 animate-spin" />}
              {busy ? text["job.approval.saving"] : confirm === "approve" ? text["job.approval.yesApprove"] : text["job.approval.yesDecline"]}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm(null)} className="inline-flex h-11 items-center justify-center px-4 text-sm font-medium text-muted-foreground hover:text-foreground">
              {text["job.approval.back"]}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{text["job.approval.recorded"]}</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
