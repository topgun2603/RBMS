"use client";

import * as React from "react";
import { AlertTriangleIcon, BanIcon, CheckCircle2Icon, CircleSlashIcon, PencilIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type StatusTone,
} from "@srirealtime/ui";
import { ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { money } from "../../lib/format";
import { G, ITC_STATUSES, monthOfPeriod, taxTotal, useItc, type ItcRow, type ItcStatus } from "../../lib/gst";
import { ItcDialog, type ItcTarget } from "./itc-dialog";
import { RcmSection } from "./rcm-section";
import { FileButton, PeriodPicker, Section, useCanManage, useGstText, usePeriodLabel } from "./shared";

const PAGE = 50;
const TONE: Record<ItcStatus, StatusTone> = { eligible: "success", ineligible: "neutral", blocked: "danger", reversal: "warning" };
const ICON = { eligible: CheckCircle2Icon, ineligible: CircleSlashIcon, blocked: BanIcon, reversal: RotateCcwIcon } as const;

export function ItcPill({ status }: { status: ItcStatus }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={TONE[status]} icon={ICON[status]}>
      {t(`billing.gst.itc.status.${status}`)}
    </StatusPill>
  );
}

export function ItcTab({ period, onPeriod, filter, section, onSection }: { period: string; onPeriod: (p: string) => void; filter: string | null; section: string | null; onSection: (s: "register" | "rcm") => void }) {
  const { t } = useI18n();
  const view = section === "rcm" ? "rcm" : "register";
  return (
    <div className="grid grid-cols-1 gap-5">
      <ChipGroup
        aria-label={t("billing.gst.itc.viewLabel")}
        value={view}
        onChange={onSection}
        options={[
          { value: "register", label: t("billing.gst.itc.viewRegister") },
          { value: "rcm", label: t("billing.gst.itc.viewRcm") },
        ]}
      />
      {view === "register" ? <Register month={monthOfPeriod(period)} onMonth={onPeriod} initialStatus={filter} /> : <RcmSection />}
    </div>
  );
}

function Register({ month, onMonth, initialStatus }: { month: string; onMonth: (m: string) => void; initialStatus: string | null }) {
  const { t } = useI18n();
  const text = useGstText();
  const label = usePeriodLabel();
  const canManage = useCanManage();
  const [status, setStatus] = React.useState<string>(initialStatus && (ITC_STATUSES as readonly string[]).includes(initialStatus) ? initialStatus : "all");
  const [docType, setDocType] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const deferred = React.useDeferredValue(search.trim());
  const [target, setTarget] = React.useState<ItcTarget | null>(null);

  React.useEffect(() => setOffset(0), [month, status, docType, deferred]);
  React.useEffect(() => {
    if (initialStatus && (ITC_STATUSES as readonly string[]).includes(initialStatus)) setStatus(initialStatus);
  }, [initialStatus]);

  const params = {
    month,
    status: status === "all" ? undefined : status,
    docType: docType === "all" ? undefined : docType,
    q: deferred || undefined,
  };
  const q = useItc({ ...params, limit: PAGE, offset });
  const d = q.data;
  const facets = d?.facets.status ?? {};
  const all = Object.values(facets).reduce((s, n) => s + n, 0);

  return (
    <div className="grid grid-cols-1 gap-5">
      <Card className="px-card">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker value={month} onChange={onMonth} kind="month" id="itc-month" />
          <div className="grid min-w-48 flex-1 gap-1.5 sm:max-w-xs">
            <label htmlFor="itc-search" className="text-sm font-medium">
              {t("billing.gst.itc.search")}
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="itc-search" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("billing.gst.itc.searchHint")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="itc-doctype" className="text-sm font-medium">
              {t("billing.gst.itc.docType")}
            </label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger id="itc-doctype" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("billing.gst.itc.docAll")}</SelectItem>
                <SelectItem value="purchase">{t("billing.gst.doc.purchase")}</SelectItem>
                <SelectItem value="expense">{t("billing.gst.doc.expense")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto">
            <FileButton path={`${G}/itc.csv`} params={params} fileName={`ITC_register_${month}.csv`} label={t("billing.gst.csv")} />
          </div>
        </div>
        <ChipGroup
          aria-label={t("billing.gst.itc.statusFilter")}
          value={status}
          onChange={setStatus}
          size="sm"
          options={[
            { value: "all", label: t("billing.gst.itc.statusAll"), meta: all },
            ...ITC_STATUSES.map((s) => ({ value: s, label: t(`billing.gst.itc.status.${s}`), meta: facets[s] ?? 0 })),
          ]}
        />
        <p className="text-meta text-muted-foreground">{t("billing.gst.itc.intro", { month: label(month) })}</p>
      </Card>

      {d && d.rule37.length > 0 && (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>{t("billing.gst.itc.rule37Title", { count: d.rule37.length })}</AlertTitle>
          <AlertDescription>
            <p>{t("billing.gst.itc.rule37Body")}</p>
            <ul className="mt-2 grid gap-1">
              {d.rule37.slice(0, 6).map((r) => (
                <li key={r.key} className="flex flex-wrap gap-x-3">
                  <ModuleLink to={`purchases/${r.docId}`} className="font-medium underline underline-offset-2">
                    {r.number}
                  </ModuleLink>
                  <span>{r.party}</span>
                  <span className="text-muted-foreground">{t("billing.gst.itc.rule37Row", { days: r.days, unpaid: money(r.unpaid), credit: money(taxTotal(r.credit)) })}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {q.isError && !d ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : d.items.length === 0 ? (
        <EmptyState icon={SearchIcon} title={t("billing.gst.itc.emptyTitle")} description={t("billing.gst.itc.emptyBody")} />
      ) : (
        <Section title={t("billing.gst.itc.tableTitle", { count: d.total })} flush>
          <div className={q.isFetching ? "opacity-60 transition-opacity" : undefined}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.gst.itc.colDoc")}</TableHead>
                  <TableHead>{t("billing.gst.itc.colSupplier")}</TableHead>
                  <TableHead numeric>{t("billing.gst.itc.colTax")}</TableHead>
                  <TableHead>{t("billing.gst.itc.colStatus")}</TableHead>
                  <TableHead className="min-w-56">{t("billing.gst.itc.colWhy")}</TableHead>
                  <TableHead className="w-28">
                    <span className="sr-only">{t("billing.gst.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.items.map((r) => (
                  <ItcTableRow key={r.key} r={r} canManage={canManage} onEdit={() => setTarget({ row: r })} reason={text.reason(r.reason)} />
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 pt-3 text-sm sm:px-2">
            <span className="text-muted-foreground">{t("billing.gst.itc.showing", { from: offset + 1, to: Math.min(offset + PAGE, d.total), total: d.total })}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                {t("billing.gst.prev")}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>
                {t("billing.gst.next")}
              </Button>
            </div>
          </div>
        </Section>
      )}

      <ItcDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function ItcTableRow({ r, canManage, onEdit, reason }: { r: ItcRow; canManage: boolean; onEdit: () => void; reason: string }) {
  const { t } = useI18n();
  const text = useGstText();
  const gstinText = r.gstin ?? t("billing.gst.itc.noGstin");
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        {r.docType === "purchase" ? (
          <ModuleLink to={`purchases/${r.docId}`} className="font-medium text-primary underline-offset-2 hover:underline">
            {r.number}
          </ModuleLink>
        ) : (
          <span className="font-medium">{r.number}</span>
        )}
        <span className="block text-meta text-muted-foreground">
          {t(`billing.gst.doc.${r.docType}`)} · {text.dateText(r.date)}
        </span>
      </TableCell>
      <TableCell className="max-w-56 whitespace-normal">
        {r.party}
        <span className="block text-meta text-muted-foreground">{gstinText}</span>
      </TableCell>
      <TableCell numeric>
        {money(taxTotal(r.tax))}
        {r.rcm && <span className="block text-meta text-muted-foreground">{t("billing.gst.itc.rcmDue", { amount: money(r.rcm.due) })}</span>}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <ItcPill status={r.status} />
          {r.rcm && <StatusPill tone="info">{t("billing.gst.itc.rcmBadge")}</StatusPill>}
          {r.lapsed && <StatusPill tone="danger">{t("billing.gst.itc.lapsedBadge")}</StatusPill>}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal text-sm text-muted-foreground">
        {reason}
        {r.claimMonth && r.status !== "ineligible" && r.status !== "blocked" && r.claimMonth !== r.date.slice(0, 7) && (
          <span className="block">{t("billing.gst.itc.claimIn", { month: r.claimMonth })}</span>
        )}
        {r.flag?.reason && <span className="block italic">{r.flag.reason}</span>}
      </TableCell>
      <TableCell>
        {canManage && r.docType !== "debit_note" && (
          <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" aria-label={t("billing.gst.itc.changeFor", { number: r.number })} onClick={onEdit}>
            <PencilIcon />
            {t("billing.gst.itc.change")}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

