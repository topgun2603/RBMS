"use client";

import * as React from "react";
import { CheckCircle2Icon, SearchCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rbms/ui";
import { QueryError, useI18n } from "@rbms/web";
import { AccountingPage, Panel } from "../components/accounting/parts";
import { useReconcile, useReconcileParties, type PartyDifferences } from "../lib/accounting";
import { money, rangeFor, todayIST } from "../lib/format";

/** The books against the credit book, Payables and the GST summaries: every difference listed. */
export default function AccountingChecksPage() {
  const { t } = useI18n();
  const fy = React.useMemo(() => rangeFor("thisFY"), []);
  const range = { from: fy.from, to: todayIST() };
  const rec = useReconcile(range);
  const [who, setWho] = React.useState<"customer" | "supplier" | null>(null);

  return (
    <AccountingPage title={t("billing.accounting.nav.checks")} description={t("billing.accounting.checks.subtitle")} icon={SearchCheckIcon}>
      {rec.isError && !rec.data ? (
        <QueryError error={rec.error} onRetry={() => void rec.refetch()} />
      ) : rec.isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <div className="grid gap-3">
          {rec.data.checks.map((c) => (
            <Card key={c.key}>
              <CardContent className="grid gap-2">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t(`billing.accounting.checks.${c.key}`, { from: range.from, to: range.to })}</p>
                    <p className="mt-1 grid gap-x-6 text-meta text-muted-foreground sm:grid-cols-3">
                      <span>
                        {t("billing.accounting.checks.books")}: <b className="tabular-nums text-foreground">{money(c.ledger)}</b>
                      </span>
                      <span>
                        {t("billing.accounting.checks.records")}: <b className="tabular-nums text-foreground">{money(c.source)}</b>
                      </span>
                      <span>
                        {t("billing.accounting.checks.difference")}: <b className={`tabular-nums ${c.ok ? "text-foreground" : "text-danger-ink"}`}>{money(c.difference)}</b>
                      </span>
                    </p>
                  </div>
                  <StatusPill tone={c.ok ? "success" : "danger"} icon={c.ok ? CheckCircle2Icon : TriangleAlertIcon}>
                    {t(c.ok ? "billing.accounting.checks.match" : "billing.accounting.checks.differs")}
                  </StatusPill>
                </div>
                {c.explained && c.explained.length > 0 && (
                  <ul className="list-disc pl-5 text-meta text-muted-foreground">
                    {c.explained.map((x) => (
                      <li key={x.label}>
                        {x.label}: <b className="tabular-nums">{money(x.amount)}</b>
                      </li>
                    ))}
                  </ul>
                )}
                {c.key === "receivables" && (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => setWho(who === "customer" ? null : "customer")}>
                      {t("billing.accounting.checks.byCustomer")}
                    </Button>
                  </div>
                )}
                {c.key === "payables" && (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => setWho(who === "supplier" ? null : "supplier")}>
                      {t("billing.accounting.checks.bySupplier")}
                    </Button>
                  </div>
                )}
                {(c.key === "receivables" && who === "customer") || (c.key === "payables" && who === "supplier") ? <Parties type={who!} /> : null}
              </CardContent>
            </Card>
          ))}
          <p className="text-meta text-muted-foreground">{t("billing.accounting.checks.note")}</p>
        </div>
      )}
    </AccountingPage>
  );
}

function Parties({ type }: { type: PartyDifferences["type"] }) {
  const { t } = useI18n();
  const q = useReconcileParties(type, true);
  if (q.isPending) return <Skeleton className="h-24 rounded-xl" />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data.items.filter((r) => r.difference !== 0);
  if (rows.length === 0) return <p className="text-meta text-success-ink">{t("billing.accounting.checks.noPartyDiff")}</p>;
  return (
    <Panel>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(type === "customer" ? "billing.accounting.checks.customer" : "billing.accounting.checks.supplier")}</TableHead>
              <TableHead className="text-right">{t("billing.accounting.checks.books")}</TableHead>
              <TableHead className="text-right">{t("billing.accounting.checks.records")}</TableHead>
              <TableHead className="text-right">{t("billing.accounting.checks.difference")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 50).map((r) => (
              <TableRow key={r.partyId ?? r.name}>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.ledger)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.source)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums text-danger-ink">{money(r.difference)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
