"use client";

import * as React from "react";
import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  InfoIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { Button, Card, cn, Input, Label, Skeleton, StatusPill, toast } from "@rbms/ui";
import { ApiError, ConfirmDialog, describeError, Page, PageHeading, QueryError, SettingsNav, useI18n, useTenantSlug } from "@rbms/web";
import { ReadOnlyNote, Section } from "../components/bits";
import { useIsManager } from "../lib/access";
import { useAddDomain, useDeleteDomain, useDomainInstructions, useDomains, useVerifyDomain } from "../lib/queries";
import { normalizeDomain } from "../lib/domain";
import { storeDomainFor, useStoreUrl } from "../lib/store-url";
import type { DnsRecord, TenantDomain } from "../lib/types";

export default function DomainSettingsPage() {
  const { t } = useI18n();
  const manager = useIsManager();
  const slug = useTenantSlug();
  const storeUrl = useStoreUrl();
  const domains = useDomains();

  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={GlobeIcon} title={t("site.domain.title")} description={t("site.domain.subtitle")} />
      {!manager && <ReadOnlyNote>{t("site.common.readOnlySettings")}</ReadOnlyNote>}

      <div className="grid gap-section">
        <Section icon={GlobeIcon} title={t("site.domain.defaultTitle")} description={t("site.domain.defaultHint")}>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-muted px-3 py-2 font-mono text-sm">{slug ? storeDomainFor(slug) : "…"}</code>
            {slug && <CopyButton value={storeDomainFor(slug)} label={t("site.domain.copyAddress")} />}
            {storeUrl && (
              <Button asChild variant="ghost" size="sm">
                <a href={storeUrl("/")} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon /> {t("site.common.viewStore")}
                </a>
              </Button>
            )}
          </div>
        </Section>

        {manager && <AddDomain />}

        {domains.isError ? (
          <QueryError error={domains.error} onRetry={() => void domains.refetch()} />
        ) : domains.isPending ? (
          <Skeleton className="h-32 w-full rounded-2xl" />
        ) : domains.data.length === 0 ? (
          <Card className="items-center gap-2 p-8 text-center">
            <GlobeIcon className="size-6 text-muted-foreground" />
            <p className="font-medium">{t("site.domain.emptyTitle")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("site.domain.emptyBody")}</p>
          </Card>
        ) : (
          <ul className="grid gap-3">
            {domains.data.map((d) => (
              <li key={d.id}>
                <DomainCard domain={d} canEdit={manager} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

function AddDomain() {
  const { t } = useI18n();
  const add = useAddDomain();
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = normalizeDomain(value);
    if (!d) return setError(t("site.domain.invalid"));
    setError(null);
    try {
      await add.mutateAsync(d);
      setValue("");
      toast.success(t("site.domain.added", { domain: d }));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t("site.domain.taken") : describeError(err, t));
    }
  };
  return (
    <Section icon={PlusIcon} tone="text-info-ink" title={t("site.domain.addTitle")} description={t("site.domain.addHint")}>
      <form onSubmit={submit} noValidate className="grid gap-2">
        <Label htmlFor="dom-new">{t("site.domain.domain")}</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Input
            id="dom-new"
            className="font-mono"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="shop.example.in"
            value={value}
            aria-invalid={!!error}
            aria-describedby="dom-new-help"
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" disabled={add.isPending || !value.trim()}>
            {add.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} {t("site.domain.add")}
          </Button>
        </div>
        {error ? (
          <p id="dom-new-help" className="text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p id="dom-new-help" className="text-xs text-muted-foreground">
            {t("site.domain.wwwTip")}
          </p>
        )}
      </form>
    </Section>
  );
}

function DomainCard({ domain: d, canEdit }: { domain: TenantDomain; canEdit: boolean }) {
  const { t, formatDate } = useI18n();
  const [open, setOpen] = React.useState(!d.verified);
  const [deleting, setDeleting] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string; txt?: boolean; cname?: boolean } | null>(null);
  const ins = useDomainInstructions(open ? d.id : null);
  const verify = useVerifyDomain();
  const del = useDeleteDomain();

  const runVerify = async () => {
    setResult(null);
    try {
      await verify.mutateAsync(d.id);
      setResult({ ok: true, message: t("site.domain.verifiedNow") });
      toast.success(t("site.domain.verifiedNow"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const det = (err.details ?? {}) as { txt?: boolean; cname?: boolean };
        setResult({ ok: false, message: t("site.domain.notYet"), txt: det.txt, cname: det.cname });
      } else if (err instanceof ApiError && err.status === 403) {
        setResult({ ok: false, message: t("site.domain.platformVerifies") });
      } else setResult({ ok: false, message: describeError(err, t) });
    }
  };

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className={cn("icon-chip size-10 shrink-0 rounded-xl", d.verified ? "text-success-ink" : "text-warning-ink")}>
          <GlobeIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono font-medium">{d.domain}</p>
          <p className="text-meta text-muted-foreground">
            {d.verified && d.verifiedAt
              ? t("site.domain.verifiedOn", { date: formatDate(d.verifiedAt) })
              : d.checkedAt
                ? t("site.domain.lastChecked", { date: formatDate(d.checkedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })
                : t("site.domain.notChecked")}
          </p>
        </div>
        {d.verified ? (
          <StatusPill tone="success" icon={CheckCircle2Icon}>
            {t("site.domain.verified")}
          </StatusPill>
        ) : (
          <StatusPill tone="warning" icon={ClockIcon}>
            {t("site.domain.pending")}
          </StatusPill>
        )}
        <Button type="button" variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {t("site.domain.dnsSetup")} <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      {open && (
        <div className="grid gap-4 border-t border-border/60 p-4">
          {ins.isError ? (
            <QueryError compact error={ins.error} onRetry={() => void ins.refetch()} />
          ) : !ins.data ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t("site.domain.instructions")}</p>
              <ol className="grid gap-3">
                {ins.data.records.map((r, i) => (
                  <li key={`${r.type}-${i}`}>
                    <RecordRow record={r} step={i + 1} />
                  </li>
                ))}
              </ol>
              <p className="flex items-start gap-2 text-meta text-muted-foreground">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" /> {t("site.domain.propagation")}
              </p>
            </>
          )}
          {result && (
            <div
              role="status"
              className={cn(
                "grid gap-1 rounded-xl p-3 text-sm ring-1 ring-inset",
                result.ok ? "bg-success/10 text-success-ink ring-success/25" : "bg-warning/10 text-warning-ink ring-warning/30",
              )}
            >
              <p className="font-medium">{result.message}</p>
              {result.txt !== undefined && (
                <p className="flex items-center gap-1.5 text-xs">
                  {result.txt ? <CheckIcon className="size-3.5" /> : <XCircleIcon className="size-3.5" />} {result.txt ? t("site.domain.txtFound") : t("site.domain.txtMissing")}
                </p>
              )}
              {result.cname !== undefined && (
                <p className="flex items-center gap-1.5 text-xs">
                  {result.cname ? <CheckIcon className="size-3.5" /> : <XCircleIcon className="size-3.5" />} {result.cname ? t("site.domain.cnameFound") : t("site.domain.cnameMissing")}
                </p>
              )}
            </div>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {!d.verified && (
                <Button type="button" onClick={() => void runVerify()} disabled={verify.isPending}>
                  {verify.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {t("site.domain.verify")}
                </Button>
              )}
              <Button type="button" variant="ghost" className="ml-auto text-destructive" onClick={() => setDeleting(true)}>
                <Trash2Icon /> {t("site.domain.remove")}
              </Button>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("site.domain.removeTitle", { domain: d.domain })}
        description={d.verified ? t("site.domain.removeBodyLive") : t("site.domain.removeBody")}
        confirmLabel={t("site.domain.remove")}
        onConfirm={async () => {
          try {
            await del.mutateAsync(d.id);
            toast.success(t("site.domain.removed", { domain: d.domain }));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Card>
  );
}

function RecordRow({ record: r, step }: { record: DnsRecord; step: number }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 rounded-xl border bg-muted/20 p-3">
      <p className="text-sm font-medium">
        {t("site.domain.step", { n: step })} · {r.type === "TXT" ? t("site.domain.txtTitle") : t("site.domain.cnameTitle")}
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
        <dt className="text-xs text-muted-foreground sm:pt-2">{t("site.domain.type")}</dt>
        <dd className="font-mono">{r.type}</dd>
        <dt className="text-xs text-muted-foreground sm:pt-2">{t("site.domain.host")}</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1.5 font-mono text-xs ring-1 ring-border">{r.host}</code>
          <CopyButton value={r.host} label={t("site.domain.copyHost")} />
        </dd>
        <dt className="text-xs text-muted-foreground sm:pt-2">{t("site.domain.value")}</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1.5 font-mono text-xs ring-1 ring-border">{r.value}</code>
          <CopyButton value={r.value} label={t("site.domain.copyValue")} />
        </dd>
      </dl>
      {r.type === "TXT" && <p className="text-meta text-muted-foreground">{t("site.domain.txtHint")}</p>}
      {r.type === "CNAME" && <p className="text-meta text-muted-foreground">{t("site.domain.cnameHint")}</p>}
      {r.note && (
        <p className="flex items-start gap-2 rounded-lg bg-info/10 p-2 text-xs text-info-ink">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" /> {t("site.domain.apexNote")}
        </p>
      )}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [done, setDone] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          toast.success(t("site.common.copied"));
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error(t("site.common.copyFailed"));
        }
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
