"use client";

import * as React from "react";
import { CheckCircle2Icon, HandCoinsIcon, PencilIcon, SparklesIcon } from "lucide-react";
import { Button, Card, EmptyState, Input, Label, Skeleton, StatCard, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@srirealtime/ui";
import { ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { money, todayIST } from "../../lib/format";
import { fyStartYear, useRcm, useRcmCategories, type ItcRow } from "../../lib/gst";
import { ItcDialog, RcmPaidDialog, type ItcTarget } from "./itc-dialog";
import { Section, useCanManage, useGstText } from "./shared";

/** Reverse charge: tax the shop pays itself on some purchases (transport, rent from a person, imports ...). */
export function RcmSection() {
  const { t } = useI18n();
  const text = useGstText();
  const canManage = useCanManage();
  const today = todayIST();
  const [from, setFrom] = React.useState(`${fyStartYear(today)}-04-01`);
  const [to, setTo] = React.useState(today);
  const q = useRcm({ from, to });
  const cats = useRcmCategories();
  const [edit, setEdit] = React.useState<ItcTarget | null>(null);
  const [paying, setPaying] = React.useState<ItcRow | null>(null);
  const d = q.data;

  return (
    <div className="grid gap-5">
      <Card className="px-card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="rcm-from">{t("billing.range.from")}</Label>
            <Input id="rcm-from" type="date" className="w-40" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rcm-to">{t("billing.range.to")}</Label>
            <Input id="rcm-to" type="date" className="w-40" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>
        </div>
        <p className="text-meta text-muted-foreground">{t("billing.gst.rcm.intro")}</p>
      </Card>

      {q.isError && !d ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard title={t("billing.gst.rcm.due")} value={money(d.dueTotal)} icon={HandCoinsIcon} />
            <StatCard title={t("billing.gst.rcm.paid")} value={money(d.paid)} icon={CheckCircle2Icon} />
            <StatCard title={t("billing.gst.rcm.unpaid")} value={money(d.unpaid)} icon={HandCoinsIcon} iconClassName={d.unpaid > 0 ? "text-warning-ink" : undefined} />
          </div>

          {d.items.length === 0 ? (
            <EmptyState icon={HandCoinsIcon} title={t("billing.gst.rcm.emptyTitle")} description={t("billing.gst.rcm.emptyBody")} />
          ) : (
            <Section title={t("billing.gst.rcm.registerTitle")} hint={t("billing.gst.rcm.registerHint")} flush>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.gst.itc.colDoc")}</TableHead>
                    <TableHead>{t("billing.gst.rcm.category")}</TableHead>
                    <TableHead numeric>{t("billing.gst.rcm.value")}</TableHead>
                    <TableHead numeric>{t("billing.gst.rcm.taxDue")}</TableHead>
                    <TableHead>{t("billing.gst.rcm.status")}</TableHead>
                    <TableHead className="w-56">
                      <span className="sr-only">{t("billing.gst.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.items.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="whitespace-normal">
                        {r.docType === "purchase" ? (
                          <ModuleLink to={`purchases/${r.docId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                            {r.number}
                          </ModuleLink>
                        ) : (
                          <span className="font-medium">{r.number}</span>
                        )}
                        <span className="block text-meta text-muted-foreground">
                          {r.party} · {text.dateText(r.date)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-56 whitespace-normal">
                        {text.rcmKey(cats.data, r.rcm?.category ?? null) || t("billing.gst.rcm.noCategory")}
                        {r.rcm?.isImport && <span className="block text-meta text-muted-foreground">{t("billing.gst.rcm.import")}</span>}
                      </TableCell>
                      <TableCell numeric>
                        {money(r.rcm?.taxable ?? 0)}
                        <span className="block text-meta text-muted-foreground">{r.rcm?.rate ?? 0}%</span>
                      </TableCell>
                      <TableCell numeric>{money(r.rcm?.due ?? 0)}</TableCell>
                      <TableCell>
                        {r.rcm?.paid ? (
                          <StatusPill tone="success" icon={CheckCircle2Icon}>
                            {t("billing.gst.rcm.paidOn", { date: r.rcm.paidOn ? text.dateText(r.rcm.paidOn) : "" })}
                          </StatusPill>
                        ) : (
                          <StatusPill tone="warning">{t("billing.gst.rcm.notPaid")}</StatusPill>
                        )}
                      </TableCell>
                      <TableCell>
                        {canManage && (
                          <div className="flex flex-wrap gap-2">
                            {!r.rcm?.paid && (
                              <Button type="button" size="sm" className="h-11 sm:h-9" onClick={() => setPaying(r)}>
                                {t("billing.gst.rcm.markPaid")}
                              </Button>
                            )}
                            <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" aria-label={t("billing.gst.itc.changeFor", { number: r.number })} onClick={() => setEdit({ row: r })}>
                              <PencilIcon />
                              {t("billing.gst.itc.change")}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          )}

          {d.suggestions.length > 0 && (
            <Section title={t("billing.gst.rcm.suggestTitle")} hint={t("billing.gst.rcm.suggestHint")} flush>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.gst.itc.colDoc")}</TableHead>
                    <TableHead>{t("billing.gst.rcm.looksLike")}</TableHead>
                    <TableHead numeric>{t("billing.gst.rcm.value")}</TableHead>
                    <TableHead className="w-48">
                      <span className="sr-only">{t("billing.gst.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.suggestions.map((s) => (
                    <TableRow key={s.key}>
                      <TableCell className="whitespace-normal">
                        <span className="font-medium">{s.number}</span>
                        <span className="block text-meta text-muted-foreground">
                          {s.party} · {text.dateText(s.date)}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal">{text.rcmKey(cats.data, s.suggestedCategory)}</TableCell>
                      <TableCell numeric>{money(s.total)}</TableCell>
                      <TableCell>
                        {canManage && (
                          <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => setEdit({ row: s, suggestCategory: s.suggestedCategory })}>
                            <SparklesIcon />
                            {t("billing.gst.rcm.markRcm")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          )}
        </>
      )}

      <ItcDialog target={edit} onClose={() => setEdit(null)} />
      <RcmPaidDialog row={paying} onClose={() => setPaying(null)} />
    </div>
  );
}
