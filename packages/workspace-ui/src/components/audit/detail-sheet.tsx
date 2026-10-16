"use client";

import * as React from "react";
import { ArrowRightIcon, Code2Icon, GlobeIcon, MonitorSmartphoneIcon, UserIcon } from "lucide-react";
import { Button, cn, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@srirealtime/ui";
import { DetailRow, useI18n } from "@srirealtime/web";
import { diffJson, showValue } from "../../lib/diff";
import type { AuditEvent } from "../../lib/types";
import { actionText, auditModuleLabel } from "./action-label";

/** "Chrome on Windows" from a user agent (best effort). */
export function deviceOf(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? ua.slice(0, 60);
}

export function AuditDetailSheet({ event, actor, onClose }: { event: AuditEvent | null; actor: (id: string | null) => string; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const [raw, setRaw] = React.useState(false);
  React.useEffect(() => setRaw(false), [event?.id]);
  const rows = React.useMemo(() => (event ? diffJson(event.before, event.after) : []), [event]);
  const hasData = !!event && (event.before != null || event.after != null);

  return (
    <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" closeLabel={t("workspace.common.close")}>
        {event && (
          <>
            <SheetHeader className="border-b px-5 py-4">
              <SheetTitle>{actionText(t, event.action)}</SheetTitle>
              <SheetDescription>
                {formatDate(event.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
              </SheetDescription>
            </SheetHeader>
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-4">
              {event.summary && <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm">{event.summary}</p>}
              <div className="divide-y rounded-xl border px-3">
                <DetailRow label={<span className="inline-flex items-center gap-1.5"><UserIcon className="size-3.5" />{t("workspace.audit.member")}</span>}>
                  {actor(event.actorUserId)}
                </DetailRow>
                <DetailRow label={t("workspace.audit.entity")}>
                  {auditModuleLabel(t, event.entityType)}
                  {event.entityId && <span className="block font-mono text-xs break-all text-muted-foreground">{event.entityId}</span>}
                </DetailRow>
                <DetailRow label={<span className="inline-flex items-center gap-1.5"><GlobeIcon className="size-3.5" />{t("workspace.audit.ip")}</span>}>
                  <span className="font-mono text-xs">{event.ip ?? "—"}</span>
                </DetailRow>
                <DetailRow label={<span className="inline-flex items-center gap-1.5"><MonitorSmartphoneIcon className="size-3.5" />{t("workspace.audit.device")}</span>}>
                  <span title={event.userAgent ?? undefined}>{deviceOf(event.userAgent) ?? "—"}</span>
                </DetailRow>
                <DetailRow label={t("workspace.audit.actionCode")}>
                  <code className="text-xs break-all">{event.action}</code>
                </DetailRow>
              </div>

              <section className="grid gap-2" aria-labelledby="audit-changes">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="audit-changes" className="text-sm font-semibold">
                    {t("workspace.audit.changes")}
                  </h3>
                  {hasData && (
                    <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" aria-pressed={raw} onClick={() => setRaw((v) => !v)}>
                      <Code2Icon /> {raw ? t("workspace.audit.showDiff") : t("workspace.audit.showRaw")}
                    </Button>
                  )}
                </div>
                {!hasData ? (
                  <p className="text-sm text-muted-foreground">{t("workspace.audit.noChanges")}</p>
                ) : raw ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["before", "after"] as const).map((k) => (
                      <div key={k} className="min-w-0">
                        <p className="mb-1 text-meta font-medium text-muted-foreground">{t(`workspace.audit.${k}`)}</p>
                        <pre className="max-h-80 overflow-auto rounded-xl bg-muted/50 p-3 text-xs">{JSON.stringify(event[k] ?? null, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("workspace.audit.sameValues")}</p>
                ) : (
                  <ul className="divide-y overflow-hidden rounded-xl border text-sm">
                    {rows.map((r) => (
                      <li key={r.path} className="grid gap-1 px-3 py-2">
                        <span className="flex items-center gap-2">
                          <code className="text-xs font-medium">{r.path}</code>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-px text-[0.6875rem]",
                              r.kind === "added" ? "bg-success/14 text-success-ink" : r.kind === "removed" ? "bg-destructive/12 text-danger-ink" : "bg-info/14 text-info-ink",
                            )}
                          >
                            {t(`workspace.audit.diff.${r.kind}`)}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs break-all">
                          {r.kind !== "added" && <span className="rounded bg-destructive/10 px-1 text-danger-ink line-through decoration-danger-ink/40">{showValue(r.before)}</span>}
                          {r.kind === "changed" && <ArrowRightIcon className="size-3 text-muted-foreground" aria-hidden />}
                          {r.kind !== "removed" && <span className="rounded bg-success/12 px-1 text-success-ink">{showValue(r.after)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
