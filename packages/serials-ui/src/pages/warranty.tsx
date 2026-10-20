"use client";

import * as React from "react";
import { ScanLineIcon, SearchIcon, ShieldQuestionIcon } from "lucide-react";
import { Button, Card, CardContent, EmptyState, Input, Skeleton } from "@srirealtime/ui";
import { DetailRow, describeError, Page, PageHeading, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { BillLink, EventTimeline, InlineError, StatusChip, WarrantyPill } from "../components/bits";
import { ClaimForm } from "../components/claim-form";
import { isStatus } from "../lib/http";
import { useWarranty } from "../lib/queries";
import { normaliseSerial } from "../lib/serial";

export default function WarrantyPage() {
  return (
    <React.Suspense fallback={null}>
      <Warranty />
    </React.Suspense>
  );
}

function Warranty() {
  const { t, formatDate } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const code = normaliseSerial(params.get("code") ?? "");
  const [input, setInput] = React.useState(code);
  React.useEffect(() => setInput(code), [code]);
  const q = useWarranty(code);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const c = normaliseSerial(input);
    navigate(c ? `?code=${encodeURIComponent(c)}` : "?", { replace: true, scroll: false });
  };

  const d = q.data;
  return (
    <Page width="narrow">
      <PageHeading title={t("serials.warrantyPage.title")} description={t("serials.warrantyPage.description")} />
      <form onSubmit={search} className="mb-section flex gap-2">
        <div className="relative flex-1">
          <ScanLineIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="h-12 pl-11 font-mono text-base"
            value={input}
            spellCheck={false}
            autoCapitalize="characters"
            placeholder={t("serials.warrantyPage.placeholder")}
            aria-label={t("serials.warrantyPage.placeholder")}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <Button type="submit" size="lg" className="h-12">
          <SearchIcon /> <span className="sr-only sm:not-sr-only">{t("serials.warrantyPage.search")}</span>
        </Button>
      </form>

      {!code ? (
        <EmptyState icon={ShieldQuestionIcon} title={t("serials.warrantyPage.emptyTitle")} description={t("serials.warrantyPage.emptyBody")} />
      ) : q.isError ? (
        isStatus(q.error, 404) ? (
          <EmptyState icon={ShieldQuestionIcon} title={t("serials.warrantyPage.notFoundTitle")} description={t("serials.warrantyPage.notFoundBody", { code })} />
        ) : (
          <InlineError title={describeError(q.error, t)} />
        )
      ) : !d ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <CardContent className="grid gap-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{d.unit.itemName}</p>
                <p className="font-mono text-sm break-all text-muted-foreground">
                  {d.unit.serial}
                  {d.unit.serial2 && ` / ${d.unit.serial2}`}
                </p>
              </div>
              <StatusChip status={d.unit.status} />
            </div>
            <div className="rounded-lg border p-4">
              <p className="mb-2 text-meta text-muted-foreground">{t("serials.warrantyPage.warranty")}</p>
              <WarrantyPill size="md" status={d.unit.warrantyStatus} end={d.unit.warrantyEnd} daysLeft={d.unit.warrantyDaysLeft} />
            </div>
            <div className="grid divide-y">
              <DetailRow label={t("serials.unit.soldOn")}>{d.unit.soldOn ? formatDate(d.unit.soldOn) : "—"}</DetailRow>
              <DetailRow label={t("serials.unit.customer")}>
                {d.unit.customerName ? [d.unit.customerName, d.unit.customerPhone].filter(Boolean).join(" · ") : "—"}
              </DetailRow>
              <DetailRow label={t("serials.unit.bill")}>
                {d.unit.invoiceNumber || d.unit.invoiceId ? <BillLink id={d.unit.invoiceId} number={d.unit.invoiceNumber} /> : "—"}
              </DetailRow>
              <DetailRow label={t("serials.unit.warrantyMonths")}>{t("serials.common.months", { count: d.unit.warrantyMonths })}</DetailRow>
            </div>
            <ClaimForm unitId={d.unit.id} />
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold">{t("serials.unit.history")}</h3>
              <EventTimeline events={d.events} />
            </section>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
