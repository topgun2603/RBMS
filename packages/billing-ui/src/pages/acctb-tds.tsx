"use client";

import * as React from "react";
import { AlertTriangleIcon, CalendarClockIcon, PercentIcon, PlusIcon, Settings2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@srirealtime/ui";
import { describeError, ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { AccountSelect, AccountingPage, Panel, TableSkeleton } from "../components/accounting/parts";
import { Figure } from "../components/accounting/part-b";
import { MoneyInput } from "../components/money-input";
import { DownloadCsvButton } from "../components/reports/report-ui";
import { ACC, accountingPdfPath, useAccounts } from "../lib/accounting";
import {
  ACC_TDS,
  pct,
  quarterKey,
  recentQuarters,
  useCancelChallan,
  useCancelTds,
  useChallans,
  useCreateChallan,
  useCreateTds,
  useTdsCalendar,
  useTdsCandidates,
  useTdsCompute,
  useTdsDocuments,
  useTdsEntries,
  useTdsParties,
  useTdsPayable,
  useTdsQuarterly,
  useTdsSettings,
  type TdsEntry,
} from "../lib/accounting-b";
import { useHasPermission } from "../lib/access";
import { money, paiseToInput, rupeesToPaise, todayIST } from "../lib/format";
import { usePdf } from "../lib/pdf";

/** TDS and TCS: what was deducted, what is to be deposited and by when, challans, and the quarterly statement data. */
export default function AccountingTdsPage() {
  const { t } = useI18n();
  const canTds = useHasPermission(ACC_TDS);
  const settings = useTdsSettings();
  const [tab, setTab] = React.useState("overview");
  const [recording, setRecording] = React.useState<{ purchaseId?: string; supplierId?: string; section?: string; base?: number } | null>(null);
  const [challan, setChallan] = React.useState<{ period?: string; tax?: number; kind?: "tds" | "tcs" } | null>(null);

  return (
    <AccountingPage
      title={t("billing.acctb.tds.title")}
      description={t("billing.acctb.tds.subtitle")}
      icon={PercentIcon}
      needsSetup={false}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" asChild>
            <ModuleLink to="accounting/tds/settings">
              <Settings2Icon /> {t("billing.acctb.tds.settings")}
            </ModuleLink>
          </Button>
          {canTds && settings.data?.enabled && (
            <Button size="lg" onClick={() => setRecording({})}>
              <PlusIcon /> {t("billing.acctb.tds.record")}
            </Button>
          )}
        </div>
      }
    >
      {settings.data && !settings.data.enabled && (
        <Alert className="mb-section">
          <PercentIcon />
          <AlertTitle>{t("billing.acctb.tds.offTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("billing.acctb.tds.offBody")}</p>
            <Button size="sm" className="mt-2" asChild>
              <ModuleLink to="accounting/tds/settings">{t("billing.acctb.tds.turnOn")}</ModuleLink>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <p className="mb-4 text-meta text-muted-foreground">{t("billing.acctb.tds.caNote")}</p>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="mb-4 overflow-x-auto">
          <TabsList className="w-max">
            {(["overview", "register", "challans", "quarterly", "check"] as const).map((k) => (
              <TabsTrigger key={k} value={k}>
                {t(`billing.acctb.tds.tab.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <Overview onPay={(p) => setChallan(p)} canTds={canTds} />
        </TabsContent>
        <TabsContent value="register">
          <Register canTds={canTds} />
        </TabsContent>
        <TabsContent value="challans">
          <Challans canTds={canTds} onAdd={() => setChallan({})} />
        </TabsContent>
        <TabsContent value="quarterly">
          <Quarterly tcs={!!settings.data?.tcsEnabled} />
        </TabsContent>
        <TabsContent value="check">
          <Candidates canTds={canTds && !!settings.data?.enabled} onRecord={(c) => setRecording(c)} />
        </TabsContent>
      </Tabs>
      <RecordDialog state={recording} onClose={() => setRecording(null)} />
      <ChallanDialog state={challan} onClose={() => setChallan(null)} />
    </AccountingPage>
  );
}

function Overview({ onPay, canTds }: { onPay: (p: { period: string; tax: number; kind: "tds" | "tcs" }) => void; canTds: boolean }) {
  const { t, formatDate } = useI18n();
  const cal = useTdsCalendar();
  const payable = useTdsPayable();
  const d = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "numeric" });
  if (cal.isError && !cal.data) return <QueryError error={cal.error} onRetry={() => void cal.refetch()} />;
  if (!cal.data || !payable.data) return <TableSkeleton />;
  return (
    <div className="grid grid-cols-1 gap-section">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Figure label={t("billing.acctb.tds.deductedYear", { fy: payable.data.fy })}>{money(payable.data.totals.deducted)}</Figure>
        <Figure label={t("billing.acctb.tds.deposited")}>{money(payable.data.totals.deposited)}</Figure>
        <Figure label={t("billing.acctb.tds.toDeposit")} tone={payable.data.totals.balance ? "warning" : "success"} hint={t("billing.acctb.tds.ledger", { amount: money(payable.data.ledgerBalance.tds) })}>
          {money(payable.data.totals.balance)}
        </Figure>
      </div>
      {cal.data.alerts.map((a) => (
        <Alert key={a} variant="warning">
          <AlertTriangleIcon />
          <AlertDescription>{a}</AlertDescription>
        </Alert>
      ))}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardContent>
            <p className="mb-3 flex items-center gap-2 font-medium">
              <CalendarClockIcon className="size-4 text-primary" /> {t("billing.acctb.tds.dueDates")}
            </p>
            <ul className="grid gap-2 text-sm">
              {[
                ...cal.data.deposits.map((x) => ({ ...x, label: t("billing.acctb.tds.depositItem", { kind: x.kind.toUpperCase(), month: x.month, section: x.section }) })),
                ...cal.data.returns.map((x) => ({ ...x, amount: null as number | null, label: t("billing.acctb.tds.returnItem", { form: x.form, quarter: x.quarter }) })),
              ]
                .sort((a, b) => a.due.localeCompare(b.due))
                .map((x) => (
                  <li key={`${x.what}-${x.due}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">{x.label}</span>
                    <span className="flex items-center gap-2">
                      {x.amount !== null && <span className="tabular-nums">{money(x.amount)}</span>}
                      <StatusPill tone={x.late ? "danger" : "info"}>{x.late ? t("billing.acctb.tds.wasDue", { date: d(x.due) }) : t("billing.acctb.tds.dueOn", { date: d(x.due) })}</StatusPill>
                    </span>
                  </li>
                ))}
            </ul>
            <p className="mt-3 text-meta text-muted-foreground">{t("billing.acctb.tds.dueHint")}</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardContent>
            <p className="mb-3 font-medium">{t("billing.acctb.tds.byMonth")}</p>
            {payable.data.items.length === 0 ? (
              <p className="text-meta text-muted-foreground">{t("billing.acctb.tds.nothingYet")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.acctb.tds.month")}</TableHead>
                      <TableHead>{t("billing.acctb.tds.section")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.tds.deducted")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.tds.balance")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payable.data.items.map((i) => (
                      <TableRow key={`${i.kind}-${i.month}-${i.section}`}>
                        <TableCell>{i.month}</TableCell>
                        <TableCell>{i.section}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(i.deducted)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(i.balance)}</TableCell>
                        <TableCell className="text-right">
                          {i.status === "paid" ? (
                            <StatusPill tone="success">{t("billing.acctb.tds.paid")}</StatusPill>
                          ) : canTds ? (
                            <Button size="sm" variant="outline" onClick={() => onPay({ period: i.month, tax: i.balance, kind: i.kind })}>
                              {t("billing.acctb.tds.pay")}
                            </Button>
                          ) : (
                            <StatusPill tone={i.status === "late" ? "danger" : "warning"}>{t(`billing.acctb.tds.status.${i.status}`)}</StatusPill>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Register({ canTds }: { canTds: boolean }) {
  const { t, formatDate } = useI18n();
  const [kind, setKind] = React.useState<"tds" | "tcs">("tds");
  const list = useTdsEntries({ kind });
  const cancel = useCancelTds();
  const [cancelOf, setCancelOf] = React.useState<TdsEntry | null>(null);
  const [why, setWhy] = React.useState("");
  return (
    <>
      <ChipGroup
        size="sm"
        className="mb-4"
        aria-label={t("billing.acctb.tds.kind")}
        value={kind}
        onChange={setKind}
        options={[
          { value: "tds" as const, label: "TDS" },
          { value: "tcs" as const, label: "TCS" },
        ]}
      />
      {list.isPending ? (
        <TableSkeleton />
      ) : !list.data?.items.length ? (
        <EmptyState className="border-0 bg-transparent" title={t("billing.acctb.tds.emptyTitle")} description={t("billing.acctb.tds.emptyBody")} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.accounting.date")}</TableHead>
                  <TableHead>{t("billing.acctb.tds.party")}</TableHead>
                  <TableHead>{t("billing.acctb.tds.section")}</TableHead>
                  <TableHead className="text-right">{t("billing.acctb.tds.base")}</TableHead>
                  <TableHead className="text-right">{t("billing.acctb.tds.tax")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((e) => (
                  <TableRow key={e.id} className={e.status === "cancelled" ? "opacity-60" : undefined}>
                    <TableCell className="whitespace-nowrap">{formatDate(e.date, { day: "numeric", month: "short", year: "numeric" })}</TableCell>
                    <TableCell className="max-w-64">
                      <span className="block truncate font-medium">{e.partyName}</span>
                      <span className="block truncate text-meta text-muted-foreground">
                        {e.pan ?? t("billing.acctb.tds.noPan")}
                        {e.sourceRef ? ` · ${e.sourceRef}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      {e.section} <span className="text-meta text-muted-foreground">{pct(e.rate)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(e.base)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(e.amount)}</TableCell>
                    <TableCell className="text-right">
                      <span className="flex flex-wrap justify-end gap-1">
                        {e.status === "cancelled" ? (
                          <StatusPill tone="neutral">{t("billing.acctb.cancelled")}</StatusPill>
                        ) : e.challanId ? (
                          <StatusPill tone="success">{t("billing.acctb.tds.paid")}</StatusPill>
                        ) : (
                          <StatusPill tone="warning">{t("billing.acctb.tds.unpaid")}</StatusPill>
                        )}
                        {canTds && e.status === "active" && !e.challanId && (
                          <Button size="sm" variant="ghost" onClick={() => (setCancelOf(e), setWhy(""))}>
                            {t("billing.common.cancel")}
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
      <Dialog open={!!cancelOf} onOpenChange={(o) => !o && setCancelOf(null)}>
        <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
          <DialogHeader>
            <DialogTitle>{t("billing.acctb.tds.cancelTitle")}</DialogTitle>
            <DialogDescription>{t("billing.acctb.tds.cancelBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="tc-why">{t("billing.acctb.why")}</Label>
            <Input id="tc-why" value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelOf(null)}>
              {t("billing.common.close")}
            </Button>
            <Button
              variant="destructive"
              disabled={!why.trim() || cancel.isPending}
              onClick={() =>
                void cancel
                  .mutateAsync({ id: cancelOf!.id, reason: why.trim() })
                  .then(() => (toast.success(t("billing.acctb.tds.cancelled")), setCancelOf(null)))
                  .catch((err) => toast.error(describeError(err, t)))
              }
            >
              {t("billing.acctb.tds.cancelTitle")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Challans({ canTds, onAdd }: { canTds: boolean; onAdd: () => void }) {
  const { t, formatDate } = useI18n();
  const list = useChallans();
  const cancel = useCancelChallan();
  return (
    <>
      {canTds && (
        <div className="mb-4 flex justify-end">
          <Button onClick={onAdd}>
            <PlusIcon /> {t("billing.acctb.tds.addChallan")}
          </Button>
        </div>
      )}
      {list.isPending ? (
        <TableSkeleton />
      ) : !list.data?.length ? (
        <EmptyState className="border-0 bg-transparent" title={t("billing.acctb.tds.noChallans")} description={t("billing.acctb.tds.noChallansBody")} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.accounting.date")}</TableHead>
                  <TableHead>{t("billing.acctb.tds.month")}</TableHead>
                  <TableHead>{t("billing.acctb.tds.bsrChallan")}</TableHead>
                  <TableHead className="text-right">{t("billing.acctb.tds.tax")}</TableHead>
                  <TableHead className="text-right">{t("billing.acctb.tds.interestFee")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((c) => (
                  <TableRow key={c.id} className={c.status === "cancelled" ? "opacity-60" : undefined}>
                    <TableCell className="whitespace-nowrap">{formatDate(c.date, { day: "numeric", month: "short", year: "numeric" })}</TableCell>
                    <TableCell>
                      {c.period} <span className="text-meta text-muted-foreground">{c.kind.toUpperCase()}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.bsrCode} / {c.challanNo}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(c.tax)}
                      <span className="block text-meta text-muted-foreground">{t("billing.acctb.tds.covers", { count: c.entries })}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.interest + c.fee)}</TableCell>
                    <TableCell className="text-right">
                      {c.status === "cancelled" ? (
                        <StatusPill tone="neutral">{t("billing.acctb.cancelled")}</StatusPill>
                      ) : (
                        canTds && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const reason = window.prompt(t("billing.acctb.why")) ?? "";
                              if (!reason.trim()) return;
                              void cancel
                                .mutateAsync({ id: c.id, reason: reason.trim() })
                                .then(() => toast.success(t("billing.acctb.tds.challanCancelled")))
                                .catch((err) => toast.error(describeError(err, t)));
                            }}
                          >
                            {t("billing.common.cancel")}
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </>
  );
}

function Quarterly({ tcs }: { tcs: boolean }) {
  const { t, formatDate } = useI18n();
  const pdf = usePdf();
  const quarters = React.useMemo(() => recentQuarters(todayIST()), []);
  const [quarter, setQuarter] = React.useState(quarterKey(todayIST()));
  const [kind, setKind] = React.useState<"tds" | "tcs">("tds");
  const q = useTdsQuarterly(quarter, kind);
  const d = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="tq-q">{t("billing.acctb.tds.quarter")}</Label>
          <Select value={quarter} onValueChange={setQuarter}>
            <SelectTrigger id="tq-q" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {quarters.map((x) => (
                <SelectItem key={x} value={x}>
                  {x}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {tcs && (
          <ChipGroup
            size="sm"
            aria-label={t("billing.acctb.tds.kind")}
            value={kind}
            onChange={setKind}
            options={[
              { value: "tds" as const, label: "TDS (26Q)" },
              { value: "tcs" as const, label: "TCS (27EQ)" },
            ]}
          />
        )}
        <div className="ml-auto">
          <DownloadCsvButton path={`${ACC}/tds/quarterly`} params={{ quarter, kind }} fileName={`${kind === "tcs" ? "27EQ" : "26Q"}-${quarter}.csv`} />
        </div>
      </div>
      {q.isPending || !q.data ? (
        <TableSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure label={t("billing.acctb.tds.entries")}>{q.data.totals.count}</Figure>
            <Figure label={t("billing.acctb.tds.tax")}>{money(q.data.totals.amount)}</Figure>
            <Figure label={t("billing.acctb.tds.returnDue", { form: q.data.form })}>{d(q.data.returnDue)}</Figure>
            <Figure label={t("billing.acctb.tds.certDue")}>{d(q.data.certificateDue)}</Figure>
          </div>
          {q.data.issues.map((i) => (
            <Alert key={i} variant="warning">
              <AlertTriangleIcon />
              <AlertDescription>{i}</AlertDescription>
            </Alert>
          ))}
          <p className="text-meta text-muted-foreground">{q.data.note}</p>
          {q.data.deductees.length > 0 && (
            <Panel>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.acctb.tds.section")}</TableHead>
                      <TableHead>{t("billing.acctb.tds.party")}</TableHead>
                      <TableHead>PAN</TableHead>
                      <TableHead>{t("billing.accounting.date")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.tds.base")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.tds.tax")}</TableHead>
                      <TableHead>{t("billing.acctb.tds.bsrChallan")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data.deductees.map((x) => (
                      <TableRow key={x.id}>
                        <TableCell>{x.section}</TableCell>
                        <TableCell className="max-w-48 truncate">{x.partyName}</TableCell>
                        <TableCell className="font-mono text-xs">{x.pan}</TableCell>
                        <TableCell className="whitespace-nowrap">{d(x.date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(x.base)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(x.amount)}</TableCell>
                        <TableCell className="font-mono text-xs">{x.deposited ? `${x.bsrCode} / ${x.challanNo}` : <StatusPill tone="warning">{t("billing.acctb.tds.unpaid")}</StatusPill>}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pdf.busy === x.id}
                            onClick={() => void pdf.run(x.id, accountingPdfPath("tds-certificate"), { query: { partyName: x.partyName, quarter, kind }, mode: "download", fallbackName: "tds-certificate.pdf" })}
                          >
                            {t("billing.acctb.tds.certificate")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function Candidates({ canTds, onRecord }: { canTds: boolean; onRecord: (c: { purchaseId: string; supplierId: string; section: string; base: number }) => void }) {
  const { t, formatDate } = useI18n();
  const list = useTdsCandidates();
  if (list.isPending) return <TableSkeleton />;
  if (!list.data?.items.length) return <EmptyState className="border-0 bg-transparent" title={t("billing.acctb.tds.noCandidates")} description={t("billing.acctb.tds.noCandidatesBody")} />;
  return (
    <Panel>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("billing.accounting.date")}</TableHead>
              <TableHead>{t("billing.acctb.tds.bill")}</TableHead>
              <TableHead>{t("billing.acctb.tds.section")}</TableHead>
              <TableHead className="text-right">{t("billing.acctb.tds.base")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.items.map((c) => (
              <TableRow key={c.purchaseId}>
                <TableCell className="whitespace-nowrap">{formatDate(c.date, { day: "numeric", month: "short" })}</TableCell>
                <TableCell className="max-w-64">
                  <span className="block truncate font-medium">
                    {c.billNumber} · {c.supplierName}
                  </span>
                  <span className="block text-meta text-muted-foreground">{c.reason}</span>
                </TableCell>
                <TableCell>{c.section}</TableCell>
                <TableCell className="text-right tabular-nums">{money(c.taxable)}</TableCell>
                <TableCell className="text-right">
                  {canTds && (
                    <Button size="sm" variant="outline" onClick={() => onRecord({ purchaseId: c.purchaseId, supplierId: c.supplierId, section: c.section, base: c.taxable })}>
                      {t("billing.acctb.tds.record")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}

function RecordDialog({ state, onClose }: { state: { purchaseId?: string; supplierId?: string; section?: string; base?: number } | null; onClose: () => void }) {
  const { t } = useI18n();
  const settings = useTdsSettings();
  const accounts = useAccounts(false);
  const create = useCreateTds();
  const [kind, setKind] = React.useState<"tds" | "tcs">("tds");
  const [section, setSection] = React.useState("");
  const [partyType, setPartyType] = React.useState<"supplier" | "customer" | "other">("supplier");
  const [partySearch, setPartySearch] = React.useState("");
  const [partyId, setPartyId] = React.useState("");
  const [partyName, setPartyName] = React.useState("");
  const [source, setSource] = React.useState<"purchase" | "supplier" | "expense" | "customer" | "other">("purchase");
  const [docId, setDocId] = React.useState("");
  const [otherAccount, setOtherAccount] = React.useState("");
  const [base, setBase] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(todayIST());
  const [settle, setSettle] = React.useState(true);
  const parties = useTdsParties(partyType === "customer" ? "customer" : "supplier", partySearch);
  const docs = useTdsDocuments(source === "expense" ? "expense" : "purchase", source === "purchase" ? partyId || null : null, !!state && (source === "purchase" ? !!partyId : source === "expense"));

  React.useEffect(() => {
    if (!state) return;
    setKind("tds");
    setSection(state.section ?? "");
    setPartyType("supplier");
    setPartyId(state.supplierId ?? "");
    setPartyName("");
    setPartySearch("");
    setSource(state.purchaseId ? "purchase" : "purchase");
    setDocId(state.purchaseId ?? "");
    setOtherAccount("");
    setBase(state.base ? paiseToInput(state.base) : "");
    setAmount("");
    setDate(todayIST());
    setSettle(true);
  }, [state]);

  const sections = (settings.data?.sections ?? []).filter((s) => s.kind === kind && s.enabled);
  const basePaise = rupeesToPaise(base) ?? 0;
  const compute = useTdsCompute(
    { section, partyType: partyType === "other" ? "other" : partyType, partyId, base: basePaise, date, sourceType: source, sourceId: docId || undefined },
    !!state && !!section && basePaise > 0,
  );
  React.useEffect(() => {
    if (compute.data) setAmount(compute.data.amount ? paiseToInput(compute.data.amount) : "");
  }, [compute.data]);
  const pickDoc = (id: string) => {
    setDocId(id);
    const doc = docs.data?.find((x) => x.id === id);
    if (doc) setBase(paiseToInput(doc.base));
  };
  const amountPaise = rupeesToPaise(amount) ?? 0;
  const party = parties.data?.find((p) => p.id === partyId);

  const submit = async () => {
    try {
      await create.mutateAsync({
        kind,
        section,
        date,
        partyType,
        partyId: partyType === "other" ? null : partyId,
        partyName: partyType === "other" ? partyName.trim() : undefined,
        base: basePaise,
        rate: compute.data?.rate ?? 0,
        amount: amountPaise,
        sourceType: kind === "tcs" ? "customer" : source,
        sourceId: source === "purchase" || source === "expense" ? docId : null,
        otherAccountId: source === "other" ? otherAccount : null,
        settle,
      });
      toast.success(t("billing.acctb.tds.recorded"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const ok = !!section && basePaise > 0 && amountPaise > 0 && (partyType === "other" ? !!partyName.trim() : !!partyId) && (source === "purchase" || source === "expense" ? !!docId : true) && (source !== "other" || !!otherAccount);

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.tds.recordTitle")}</DialogTitle>
          <DialogDescription>{t("billing.acctb.tds.recordBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {settings.data?.tcsEnabled && (
            <div className="sm:col-span-2">
              <ChipGroup
                size="sm"
                aria-label={t("billing.acctb.tds.kind")}
                value={kind}
                onChange={(v) => {
                  setKind(v);
                  setSection("");
                  setPartyType(v === "tcs" ? "customer" : "supplier");
                  setSource(v === "tcs" ? "customer" : "purchase");
                }}
                options={[
                  { value: "tds" as const, label: t("billing.acctb.tds.tdsLong") },
                  { value: "tcs" as const, label: t("billing.acctb.tds.tcsLong") },
                ]}
              />
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="tr-sec">{t("billing.acctb.tds.section")}</Label>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger id="tr-sec" className="w-full">
                <SelectValue placeholder={t("billing.acctb.tds.pickSection")} />
              </SelectTrigger>
              <SelectContent>
                {sections.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.section} · {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {section && <p className="text-meta text-muted-foreground">{sections.find((s) => s.key === section)?.plain}</p>}
          </div>
          {kind === "tds" && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("billing.acctb.tds.from")}</Label>
              <ChipGroup
                size="sm"
                aria-label={t("billing.acctb.tds.from")}
                value={source}
                onChange={(v) => {
                  setSource(v);
                  setDocId("");
                  setPartyType(v === "purchase" || v === "supplier" ? "supplier" : "other");
                }}
                options={[
                  { value: "purchase" as const, label: t("billing.acctb.tds.src.purchase") },
                  { value: "supplier" as const, label: t("billing.acctb.tds.src.supplier") },
                  { value: "expense" as const, label: t("billing.acctb.tds.src.expense") },
                  { value: "other" as const, label: t("billing.acctb.tds.src.other") },
                ]}
              />
            </div>
          )}
          {partyType === "other" ? (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="tr-pn">{t("billing.acctb.tds.payee")}</Label>
              <Input id="tr-pn" maxLength={120} value={partyName} onChange={(e) => setPartyName(e.target.value)} />
              <p className="text-meta text-muted-foreground">{t("billing.acctb.tds.payeeHint")}</p>
            </div>
          ) : (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="tr-party">{partyType === "customer" ? t("billing.acctb.tds.customer") : t("billing.acctb.tds.supplier")}</Label>
              <Input placeholder={t("billing.acctb.tds.searchParty")} aria-label={t("billing.acctb.tds.searchParty")} value={partySearch} onChange={(e) => setPartySearch(e.target.value)} />
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger id="tr-party" className="w-full">
                  <SelectValue placeholder={t("billing.acctb.tds.pickParty")} />
                </SelectTrigger>
                <SelectContent>
                  {(parties.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.effectivePan ? ` · ${p.effectivePan}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {party && !party.effectivePan && <p className="text-meta text-warning-ink">{t("billing.acctb.tds.partyNoPan")}</p>}
            </div>
          )}
          {(source === "purchase" || source === "expense") && kind === "tds" && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="tr-doc">{source === "purchase" ? t("billing.acctb.tds.bill") : t("billing.acctb.tds.src.expense")}</Label>
              <Select value={docId} onValueChange={pickDoc}>
                <SelectTrigger id="tr-doc" className="w-full">
                  <SelectValue placeholder={t("billing.acctb.tds.pickDoc")} />
                </SelectTrigger>
                <SelectContent>
                  {(docs.data ?? []).map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.date} · {x.label} · {money(x.amount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {source === "expense" && <p className="text-meta text-muted-foreground">{t("billing.acctb.tds.expenseHint")}</p>}
            </div>
          )}
          {source === "other" && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("billing.acctb.tds.otherAccount")}</Label>
              <AccountSelect value={otherAccount} onChange={setOtherAccount} accounts={accounts.data ?? []} filter={(a) => !a.isBank && !a.isCash && a.key !== "tds_payable"} aria-label={t("billing.acctb.tds.otherAccount")} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="tr-base">{t("billing.acctb.tds.base")}</Label>
            <MoneyInput id="tr-base" value={base} onChange={(e) => setBase(e.target.value)} />
            <p className="text-meta text-muted-foreground">{t("billing.acctb.tds.baseHint")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tr-date">{t("billing.accounting.date")}</Label>
            <Input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {compute.data && (
            <div className="rounded-xl border bg-muted/40 p-3 text-sm sm:col-span-2">
              <p className="font-medium">
                {compute.data.applies ? t("billing.acctb.tds.suggest", { rate: pct(compute.data.rate), amount: money(compute.data.amount) }) : t("billing.acctb.tds.notDue")}
              </p>
              <ul className="mt-1 list-disc pl-4 text-meta text-muted-foreground">
                {compute.data.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
                <li>{t("billing.acctb.tds.depositBy", { date: compute.data.depositDue })}</li>
              </ul>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="tr-amt">{t("billing.acctb.tds.tax")}</Label>
            <MoneyInput id="tr-amt" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {(source === "purchase" || source === "supplier") && kind === "tds" && (
            <label className="flex items-start gap-3 rounded-xl border p-3 text-sm sm:col-span-2">
              <Switch checked={settle} onCheckedChange={setSettle} aria-label={t("billing.acctb.tds.settle")} />
              <span>
                <span className="block font-medium">{t("billing.acctb.tds.settle")}</span>
                <span className="block text-meta text-muted-foreground">{t("billing.acctb.tds.settleHint")}</span>
              </span>
            </label>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!ok || create.isPending}>
            {t("billing.acctb.tds.recordShort")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChallanDialog({ state, onClose }: { state: { period?: string; tax?: number; kind?: "tds" | "tcs" } | null; onClose: () => void }) {
  const { t } = useI18n();
  const accounts = useAccounts(false);
  const create = useCreateChallan();
  const [period, setPeriod] = React.useState("");
  const [bsr, setBsr] = React.useState("");
  const [no, setNo] = React.useState("");
  const [date, setDate] = React.useState(todayIST());
  const [tax, setTax] = React.useState("");
  const [interest, setInterest] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [from, setFrom] = React.useState("");
  React.useEffect(() => {
    if (!state) return;
    setPeriod(state.period ?? todayIST().slice(0, 7));
    setTax(state.tax ? paiseToInput(state.tax) : "");
    setBsr("");
    setNo("");
    setInterest("");
    setFee("");
    setDate(todayIST());
  }, [state]);
  React.useEffect(() => {
    if (!from && accounts.data) setFrom(accounts.data.find((a) => a.key === "bank")?.id ?? "");
  }, [from, accounts.data]);
  const submit = async () => {
    try {
      const r = await create.mutateAsync({ kind: state?.kind ?? "tds", period, bsrCode: bsr.trim(), challanNo: no.trim(), date, tax: rupeesToPaise(tax) ?? 0, interest: rupeesToPaise(interest) ?? 0, fee: rupeesToPaise(fee) ?? 0, paidFromAccountId: from });
      toast.success(t("billing.acctb.tds.challanSaved", { count: r.entries }));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.tds.addChallan")}</DialogTitle>
          <DialogDescription>{t("billing.acctb.tds.challanBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ch-p">{t("billing.acctb.tds.monthOfDeduction")}</Label>
            <Input id="ch-p" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ch-d">{t("billing.acctb.tds.paidOn")}</Label>
            <Input id="ch-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ch-bsr">{t("billing.acctb.tds.bsr")}</Label>
            <Input id="ch-bsr" inputMode="numeric" maxLength={7} value={bsr} onChange={(e) => setBsr(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ch-no">{t("billing.acctb.tds.challanNo")}</Label>
            <Input id="ch-no" inputMode="numeric" maxLength={5} value={no} onChange={(e) => setNo(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ch-tax">{t("billing.acctb.tds.tax")}</Label>
            <MoneyInput id="ch-tax" value={tax} onChange={(e) => setTax(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ch-int">{t("billing.acctb.tds.interest")}</Label>
            <MoneyInput id="ch-int" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ch-fee">{t("billing.acctb.tds.fee")}</Label>
            <MoneyInput id="ch-fee" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("billing.acctb.tds.paidFrom")}</Label>
            <AccountSelect value={from} onChange={setFrom} accounts={accounts.data ?? []} filter={(a) => a.isBank || a.isCash} aria-label={t("billing.acctb.tds.paidFrom")} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={create.isPending || bsr.length !== 7 || !no || !(rupeesToPaise(tax) ?? 0) || !from || !period}>
            {t("billing.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
