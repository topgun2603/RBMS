"use client";

import * as React from "react";
import { AlertTriangleIcon, Loader2Icon, RotateCwIcon } from "lucide-react";
import { Button, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Skeleton, toast } from "@srirealtime/ui";
import { describeError, DetailRow, QueryError, useI18n } from "@srirealtime/web";
import { prettyMaybeJson, RESPONSE_BODY_LIMIT, shortUrl, truncateBytes } from "../../lib/developer";
import { useDelivery, useRedeliver } from "../../lib/queries/developer";
import { CopyButton } from "../bits";
import { DeliveryStatusPill, HttpStatus } from "./status";
import { CodeBlock, JsonView } from "./json-view";

/** One delivery: payload, response, error, timings; "Redeliver" sends the same event again as a new delivery. */
export function DeliverySheet({ id, endpointUrl, onClose }: { id: string | null; endpointUrl?: string; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const q = useDelivery(id);
  const redeliver = useRedeliver();
  const d = q.data;
  const body = React.useMemo(() => (d?.responseBody ? truncateBytes(prettyMaybeJson(d.responseBody), RESPONSE_BODY_LIMIT) : null), [d?.responseBody]);
  const at = (iso: string) => formatDate(iso, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

  const resend = async () => {
    if (!id) return;
    try {
      const r = await redeliver.mutateAsync(id);
      if (r?.status === "succeeded") toast.success(t("growth.developer.deliveries.redeliverOk", { status: r.responseStatus ?? "—" }));
      else if (r) toast.error(t("growth.developer.deliveries.redeliverFailed", { status: r.responseStatus ?? "—" }), { description: r.error ?? undefined });
      else toast.success(t("growth.developer.deliveries.redeliverQueued"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" closeLabel={t("growth.common.close")}>
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="font-mono text-base">{d?.type ?? t("growth.developer.deliveries.detailTitle")}</SheetTitle>
          <SheetDescription className="truncate">{d ? `${at(d.createdAt)}${endpointUrl ? ` · ${shortUrl(endpointUrl)}` : ""}` : " "}</SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-4">
          {q.isError ? (
            <QueryError error={q.error} onRetry={() => void q.refetch()} />
          ) : !d ? (
            <div className="grid gap-3" aria-busy="true">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-56 rounded-xl" />
            </div>
          ) : (
            <>
              <div className="divide-y rounded-xl border px-3">
                <DetailRow label={t("growth.common.status")}>
                  <DeliveryStatusPill status={d.status} />
                </DetailRow>
                <DetailRow label={t("growth.developer.deliveries.response")}>
                  <HttpStatus status={d.responseStatus} />
                </DetailRow>
                <DetailRow label={t("growth.developer.deliveries.attempts")}>
                  <span className="tabular-nums">{d.attempts}</span>
                </DetailRow>
                <DetailRow label={t("growth.developer.deliveries.duration")}>
                  {d.durationMs !== null ? t("growth.developer.deliveries.ms", { ms: d.durationMs }) : "—"}
                </DetailRow>
                {d.lastAttemptAt && <DetailRow label={t("growth.developer.deliveries.lastAttempt")}>{at(d.lastAttemptAt)}</DetailRow>}
                {d.deliveredAt && <DetailRow label={t("growth.developer.deliveries.deliveredAt")}>{at(d.deliveredAt)}</DetailRow>}
                {d.status === "pending" && d.nextAttemptAt && <DetailRow label={t("growth.developer.deliveries.nextAttempt")}>{at(d.nextAttemptAt)}</DetailRow>}
                <DetailRow label={t("growth.developer.deliveries.eventId")}>
                  <span className="inline-flex items-center gap-1">
                    <code className="font-mono text-xs break-all">{d.eventId}</code>
                    <CopyButton value={d.eventId} size="icon-sm" variant="ghost" />
                  </span>
                </DetailRow>
                <DetailRow label={t("growth.developer.deliveries.deliveryId")}>
                  <code className="font-mono text-xs break-all">{d.id}</code>
                </DetailRow>
              </div>

              {d.error && (
                <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-danger-ink">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 break-words">{d.error}</span>
                </p>
              )}

              <section className="grid gap-2">
                <h3 className="text-sm font-medium">{t("growth.developer.deliveries.responseBody")}</h3>
                {body ? (
                  <>
                    <CodeBlock code={body.text} label={t("growth.developer.deliveries.responseBodyLabel")} maxHeight="max-h-64" wrap />
                    {body.truncated && <p className="text-meta text-muted-foreground">{t("growth.developer.deliveries.truncated")}</p>}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("growth.developer.deliveries.noBody")}</p>
                )}
              </section>

              <section className="grid gap-2">
                <h3 className="text-sm font-medium">{t("growth.developer.deliveries.payload")}</h3>
                <JsonView value={d.payload ?? null} maxHeight="max-h-96" />
              </section>
            </>
          )}
        </div>
        <SheetFooter className="flex-row justify-end border-t px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            {t("growth.common.close")}
          </Button>
          <Button onClick={() => void resend()} disabled={!d || redeliver.isPending}>
            {redeliver.isPending ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />}
            {t("growth.developer.deliveries.redeliver")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
