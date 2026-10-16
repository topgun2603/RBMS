"use client";

import * as React from "react";
import { BanIcon, DownloadIcon, Loader2Icon, MegaphoneIcon, PlayIcon, Trash2Icon, UsersRoundIcon } from "lucide-react";
import {
  AnimatedNumber,
  Button,
  Card,
  ChipGroup,
  cn,
  EmptyState,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  type StatusTone,
} from "@srirealtime/ui";
import { apiDownload, ConfirmDialog, describeError, Page, PageHeading, QueryError, useI18n, useModuleNavigate, useRouteParams } from "@srirealtime/web";
import { ConnectionPill, Section } from "../components/bits";
import { CampaignStatusPill, CountBars } from "../components/pills";
import { useSentinel } from "../components/two-pane";
import { formatPhone, pct } from "../lib/format";
import { pollWhenNotLive } from "../lib/live";
import { useCampaign, useCampaignAction, useRecipients } from "../lib/queries";
import { RECIPIENT_STATUSES, type RecipientStatus } from "../lib/types";
import { useWhatsAppLive } from "../lib/wa-live";

const RECIPIENT_TONE: Record<RecipientStatus, StatusTone> = {
  pending: "neutral",
  sent: "info",
  delivered: "info",
  read: "success",
  failed: "danger",
  skipped: "warning",
  cancelled: "neutral",
};

export default function CampaignDetailPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const navigate = useModuleNavigate();
  const status = useWhatsAppLive();
  const [filter, setFilter] = React.useState<RecipientStatus | "">("");
  const [confirm, setConfirm] = React.useState<"cancel" | "delete" | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  const isActive = (s: string | undefined) => s === "running" || s === "scheduled";
  // Live stats come over the stream; poll while it runs and the stream is down.
  const campaign = useCampaign(id, (data) => (isActive(data?.status) ? pollWhenNotLive(status) : false));
  const active = isActive(campaign.data?.status);
  const recipients = useRecipients(id, filter, active ? pollWhenNotLive(status, 15_000) : false);
  const action = useCampaignAction(id);
  const c = campaign.data;
  const rows = recipients.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinel = useSentinel(() => void recipients.fetchNextPage(), !!recipients.hasNextPage && !recipients.isFetchingNextPage);

  const run = async (a: "start" | "cancel" | "delete") => {
    try {
      await action.mutateAsync(a);
      if (a === "delete") {
        toast.success(t("inbox.campaign.deletedToast"));
        navigate("campaigns", { replace: true });
      } else toast.success(a === "start" ? t("inbox.campaign.startedToast") : t("inbox.campaign.cancelledToast"));
    } catch (err) {
      toast.error(describeError(err, t));
      throw err;
    }
  };

  if (campaign.isError) {
    return (
      <Page>
        <PageHeading title={t("inbox.campaign.title")} back={{ href: "campaigns", label: t("inbox.campaign.title") }} />
        <QueryError error={campaign.error} onRetry={() => void campaign.refetch()} />
      </Page>
    );
  }

  const stats = c
    ? ([
        ["total", c.counts.total, null],
        ["sent", c.counts.sent, pct(c.counts.sent, c.counts.total)],
        ["delivered", c.counts.delivered, pct(c.counts.delivered, c.counts.sent)],
        ["read", c.counts.read, pct(c.counts.read, c.counts.delivered)],
        ["failed", c.counts.failed, pct(c.counts.failed, c.counts.total)],
      ] as const)
    : [];

  return (
    <Page>
      <PageHeading
        icon={MegaphoneIcon}
        title={c?.name ?? <Skeleton className="h-7 w-48" />}
        description={c?.template ? t("inbox.campaign.usingTemplate", { name: c.template.name, lang: c.template.language }) : undefined}
        back={{ href: "campaigns", label: t("inbox.campaign.title") }}
        actions={
          c && (
            <>
              <ConnectionPill status={status} />
              {c.status === "draft" && (
                <>
                  <Button variant="outline" onClick={() => setConfirm("delete")}>
                    <Trash2Icon /> {t("inbox.common.delete")}
                  </Button>
                  <Button onClick={() => void run("start").catch(() => undefined)} disabled={action.isPending}>
                    {action.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                    {c.scheduleAt && Date.parse(c.scheduleAt) > Date.now() ? t("inbox.campaign.schedule") : t("inbox.campaign.sendNow")}
                  </Button>
                </>
              )}
              {active && (
                <Button variant="outline" className="text-destructive" onClick={() => setConfirm("cancel")}>
                  <BanIcon /> {t("inbox.campaign.cancel")}
                </Button>
              )}
            </>
          )
        }
      />

      {!c ? (
        <div className="grid gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-section">
          <Card className="p-card">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <CampaignStatusPill status={c.status} />
              {c.status === "scheduled" && c.scheduleAt && <span className="text-muted-foreground">{t("inbox.campaign.scheduledFor", { date: formatDate(c.scheduleAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>}
              {c.startedAt && <span className="text-muted-foreground">{t("inbox.campaign.startedOn", { date: formatDate(c.startedAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>}
              {c.completedAt && <span className="text-muted-foreground">{t("inbox.campaign.completedOn", { date: formatDate(c.completedAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>}
              {c.ratePerMinute && <span className="text-muted-foreground">· {t("inbox.campaign.rate", { rate: c.ratePerMinute })}</span>}
            </div>
            {c.error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-danger-ink">{c.error}</p>}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {stats.map(([key, value, p]) => (
                <div key={key} className="rounded-xl border bg-muted/20 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">{t(`inbox.campaign.count.${key}`)}</dt>
                  <dd className="flex items-baseline gap-1.5">
                    <AnimatedNumber value={value} className="font-heading text-2xl font-bold tabular-nums" format={(n) => formatNumber(Math.round(n))} />
                    {p !== null && <span className="text-xs text-muted-foreground tabular-nums">{p}%</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <CountBars counts={c.counts} />
            {c.counts.skipped > 0 && <p className="text-xs text-warning-ink">{t("inbox.campaign.skippedNote", { count: c.counts.skipped })}</p>}
          </Card>

          <Section
            icon={UsersRoundIcon}
            title={t("inbox.campaign.recipients")}
            description={recipients.data ? t("inbox.campaign.recipientsCount", { count: recipients.data.pages[0]?.total ?? 0 }) : undefined}
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={downloading || c.counts.total === 0}
                onClick={async () => {
                  setDownloading(true);
                  try {
                    await apiDownload(`/whatsapp/campaigns/${id}/recipients`, { format: "csv", status: filter || undefined }, "whatsapp-campaign-recipients.csv");
                  } catch (err) {
                    toast.error(describeError(err, t));
                  } finally {
                    setDownloading(false);
                  }
                }}
              >
                {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} CSV
              </Button>
            }
          >
            <ChipGroup<RecipientStatus | "">
              size="sm"
              aria-label={t("inbox.campaign.filterRecipients")}
              value={filter}
              onChange={setFilter}
              options={[{ value: "" as const, label: t("inbox.common.all") }, ...RECIPIENT_STATUSES.map((s) => ({ value: s, label: t(`inbox.recipient.${s}`) }))]}
            />
            {recipients.isError ? (
              <QueryError compact error={recipients.error} onRetry={() => void recipients.refetch()} />
            ) : recipients.isPending ? (
              <div className="grid gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState compact icon={UsersRoundIcon} title={c.status === "draft" ? t("inbox.campaign.noRecipientsDraft") : t("inbox.campaign.noRecipients")} />
            ) : (
              <div className={cn("-mx-4 overflow-x-auto sm:-mx-5", recipients.isPlaceholderData && "opacity-60")}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="pl-4 sm:pl-5">{t("inbox.campaign.col.customer")}</TableHead>
                      <TableHead>{t("inbox.campaign.col.status")}</TableHead>
                      <TableHead className="max-sm:hidden">{t("inbox.campaign.col.sentAt")}</TableHead>
                      <TableHead className="pr-4 sm:pr-5">{t("inbox.campaign.col.note")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="pl-4 sm:pl-5">
                          <p className="font-medium">{r.name ?? formatPhone(r.phone)}</p>
                          {r.name && <p className="text-meta text-muted-foreground tabular-nums">{formatPhone(r.phone)}</p>}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={RECIPIENT_TONE[r.status]}>{t(`inbox.recipient.${r.status}`)}</StatusPill>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground max-sm:hidden">{r.sentAt ? formatDate(r.sentAt, { dateStyle: "short", timeStyle: "short" }) : "—"}</TableCell>
                        <TableCell className="max-w-56 truncate pr-4 text-xs text-muted-foreground sm:pr-5" title={r.error ?? undefined}>
                          {r.error === "opted_out" ? t("inbox.wa.optedOut") : (r.error ?? "")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div ref={sentinel} className="h-1" />
            {recipients.isFetchingNextPage && <Loader2Icon className="mx-auto size-4 animate-spin text-muted-foreground" aria-hidden />}
          </Section>
        </div>
      )}

      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("inbox.campaign.cancelTitle")}
        description={t("inbox.campaign.cancelBody")}
        confirmLabel={t("inbox.campaign.cancel")}
        onConfirm={() => run("cancel")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("inbox.campaign.deleteTitle")}
        description={t("inbox.campaign.deleteBody")}
        confirmLabel={t("inbox.common.delete")}
        onConfirm={() => run("delete")}
      />
    </Page>
  );
}
