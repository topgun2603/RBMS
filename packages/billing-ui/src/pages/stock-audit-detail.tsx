"use client";

import * as React from "react";
import { describeError, ModuleLink, Page, PageHeading, tOr, useI18n, useModuleNavigate, useRouteParams } from "@srirealtime/web";
import { ArrowLeftIcon, CameraIcon, CheckIcon, ClipboardCheckIcon, DownloadIcon, Loader2Icon, MinusIcon, PlayIcon, PlusIcon, ScanBarcodeIcon, SendIcon, Undo2Icon, XIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ChipGroup,
  cn,
  Input,
  Label,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@srirealtime/ui";
import { StatTile } from "../components/charts/stat-tile";
import { AuditStatusPill } from "../components/inventory/audit-bits";
import { fmtDay } from "../components/inventory/batch-bits";
import { cameraScanSupported, ScanDialog } from "../components/inventory/scan-dialog";
import { useHasPermission } from "../lib/access";
import { formatQty, money, parseQty } from "../lib/format";
import { downloadCsv } from "../lib/queries-v2";
import { useAudit, useAuditAction, useAuditLines, useCountAudit, usePatchAuditLine } from "../lib/queries-stock";
import type { AuditLine, StockAudit } from "../lib/types-stock";

const REASONS = ["damaged", "expired", "theft", "entry_error", "found", "supplier_short", "other"] as const;
const PAGE = 100;
const COUNTER_KEY = "srikit.stock-audit.counter";

const readCounter = () => {
  try {
    return window.localStorage.getItem(COUNTER_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveCounter = (v: string) => {
  try {
    window.localStorage.setItem(COUNTER_KEY, v);
  } catch {
    // private window: the name just isn't remembered
  }
};

export default function StockAuditDetailPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useAudit(id);
  const audit = q.data;
  if (q.isPending) return <Page>{null}</Page>;
  if (!audit)
    return (
      <Page>
        <PageHeading icon={ClipboardCheckIcon} title={t("billing.audit.title")} description={q.error ? describeError(q.error, t) : undefined} />
      </Page>
    );
  return <AuditScreen audit={audit} />;
}

function AuditScreen({ audit }: { audit: StockAudit }) {
  const { t } = useI18n();
  const go = useModuleNavigate();
  const canApprove = useHasPermission("inventory.audit.approve");
  const action = useAuditAction(audit.id);
  const [confirm, setConfirm] = React.useState<"cancel" | "approve" | null>(null);
  const [uncounted, setUncounted] = React.useState<"skip" | "zero">("skip");
  const [reasonBulk, setReasonBulk] = React.useState<string>("");

  const run = async (a: Parameters<typeof action.mutateAsync>[0], ok: string) => {
    try {
      await action.mutateAsync(a);
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error(describeError(err, t));
      return false;
    }
  };

  const exportCsv = async (which: "all" | "variance") => {
    try {
      await downloadCsv(`/inventory/audits/${audit.id}/export`, { which }, `stock-audit-${audit.number.replace(/\//g, "-")}${which === "variance" ? "-variance" : ""}.csv`);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const status = audit.status;
  const tot = audit.totals;
  const uncountedLines = tot.lines - tot.counted;

  const actions = (
    <>
      {status === "draft" && (
        <Button size="lg" onClick={() => run({ action: "start" }, t("billing.audit.started"))} disabled={action.isPending}>
          <PlayIcon /> {t("billing.audit.start")}
        </Button>
      )}
      {status === "counting" && (
        <Button size="lg" onClick={() => run({ action: "submit" }, t("billing.audit.submitted"))} disabled={action.isPending || tot.counted === 0}>
          <SendIcon /> {t("billing.audit.submit")}
        </Button>
      )}
      {status === "review" && (
        <>
          <Button variant="outline" size="lg" onClick={() => run({ action: "reopen" }, t("billing.audit.reopened"))} disabled={action.isPending}>
            <Undo2Icon /> {t("billing.audit.reopen")}
          </Button>
          {canApprove && (
            <Button size="lg" onClick={() => setConfirm("approve")} disabled={action.isPending}>
              <CheckIcon /> {t("billing.audit.approve")}
            </Button>
          )}
        </>
      )}
      {(status === "review" || status === "approved") && (
        <Button variant="outline" size="lg" onClick={() => exportCsv("variance")}>
          <DownloadIcon /> {t("billing.audit.exportVariance")}
        </Button>
      )}
      {status !== "draft" && status !== "cancelled" && (
        <Button variant="outline" size="lg" onClick={() => exportCsv("all")}>
          <DownloadIcon /> {t("billing.audit.exportAll")}
        </Button>
      )}
      {(status === "draft" || status === "counting" || status === "review") && canApprove && (
        <Button variant="ghost" size="lg" onClick={() => setConfirm("cancel")} disabled={action.isPending}>
          <XIcon /> {t("billing.audit.cancel")}
        </Button>
      )}
    </>
  );

  return (
    <Page>
      <div className="mb-2">
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="stock-audit">
            <ArrowLeftIcon /> {t("billing.audit.title")}
          </ModuleLink>
        </Button>
      </div>
      <PageHeading
        icon={ClipboardCheckIcon}
        title={audit.number}
        description={[audit.title, audit.locationName, t("billing.audit.frozenAt", { date: fmtDay(audit.snapshotAt.slice(0, 10)) })].filter(Boolean).join(" · ")}
        actions={actions}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <AuditStatusPill status={status} />
        <span className="text-sm text-muted-foreground">{t(`billing.audit.hint.${status}`)}</span>
        {audit.counters.length > 0 && <span className="text-sm text-muted-foreground">{t("billing.audit.counters", { names: audit.counters.join(", ") })}</span>}
      </div>

      {status === "counting" && <CountPanel audit={audit} />}
      {(status === "review" || status === "approved") && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={t("billing.audit.tiles.lines")} value={tot.varianceLines} kind="count" hint={t("billing.audit.tiles.linesHint", { counted: tot.counted, total: tot.lines })} />
            <StatTile label={t("billing.audit.tiles.surplus")} value={tot.surplusValue} hint={t("billing.audit.tiles.atCost")} />
            <StatTile label={t("billing.audit.tiles.shortage")} value={tot.shortageValue} iconTone="text-danger-ink" hint={t("billing.audit.tiles.atCost")} />
            <StatTile label={t("billing.audit.tiles.net")} value={tot.netValue} hint={t("billing.audit.tiles.atCost")} />
          </div>
          {status === "review" && tot.varianceLines > 0 && (
            <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border bg-muted/30 p-3">
              <div className="grid gap-1.5">
                <Label>{t("billing.audit.bulkReason")}</Label>
                <Select value={reasonBulk} onValueChange={setReasonBulk}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder={t("billing.audit.chooseReason")} />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`billing.audit.reason.${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" disabled={!reasonBulk || action.isPending} onClick={() => run({ action: "reasons", body: { reason: reasonBulk } }, t("billing.audit.reasonsSet"))}>
                {t("billing.audit.applyToEmpty")}
              </Button>
            </div>
          )}
          <ReviewTable audit={audit} editable={status === "review"} />
        </>
      )}
      {status === "draft" && (
        <div className="rounded-2xl border bg-card p-6 text-center">
          <ScanBarcodeIcon className="mx-auto size-10 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">{t("billing.audit.draftTitle", { count: tot.lines })}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("billing.audit.draftBody")}</p>
        </div>
      )}
      {status === "cancelled" && <p className="text-sm text-muted-foreground">{audit.cancelReason ? t("billing.audit.cancelledWhy", { reason: audit.cancelReason }) : t("billing.audit.cancelled")}</p>}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "approve" ? t("billing.audit.approveTitle") : t("billing.audit.cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "approve" ? t("billing.audit.approveBody", { lines: tot.varianceLines, net: money(tot.netValue) }) : t("billing.audit.cancelBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm === "approve" && uncountedLines > 0 && (
            <div className="grid gap-1.5">
              <Label>{t("billing.audit.uncounted", { count: uncountedLines })}</Label>
              <ChipGroup
                value={uncounted}
                onChange={setUncounted}
                aria-label={t("billing.audit.uncounted", { count: uncountedLines })}
                options={[
                  { value: "skip", label: t("billing.audit.uncountedSkip") },
                  { value: "zero", label: t("billing.audit.uncountedZero") },
                ]}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("billing.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                const ok =
                  confirm === "approve"
                    ? await run({ action: "approve", body: { uncounted } }, t("billing.audit.approved"))
                    : await run({ action: "cancel", body: {} }, t("billing.audit.cancelledToast"));
                if (ok) {
                  setConfirm(null);
                  if (confirm === "cancel") go("stock-audit");
                }
              }}
            >
              {action.isPending && <Loader2Icon className="animate-spin" />}
              {confirm === "approve" ? t("billing.audit.approve") : t("billing.audit.cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

// ---------------------------------------------------------------- counting (phone-first, blind: system quantities hidden)

function CountPanel({ audit }: { audit: StockAudit }) {
  const { t } = useI18n();
  const count = useCountAudit(audit.id);
  const [counter, setCounter] = React.useState("");
  const [code, setCode] = React.useState("");
  const [per, setPer] = React.useState("1");
  const [camera, setCamera] = React.useState(false);
  const [recent, setRecent] = React.useState<{ n: number; name: string; batch: string | null; counted: number; ok: boolean }[]>([]);
  const [filter, setFilter] = React.useState<"all" | "uncounted" | "counted">("uncounted");
  const [search, setSearch] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const seq = React.useRef(0);

  React.useEffect(() => setCounter(readCounter()), []);
  React.useEffect(() => setOffset(0), [filter, search]);

  const lines = useAuditLines(audit.id, { filter, q: search, offset, limit: PAGE });
  const total = audit.totals.lines;
  const counted = audit.totals.counted;

  const submit = async (c: string) => {
    const clean = c.trim();
    if (!clean) return;
    const qty = parseQty(per) ?? 1;
    try {
      const res = await count.mutateAsync({ counter: counter.trim() || undefined, entries: [{ code: clean, qty }] });
      if (res.unknown.length > 0) {
        navigator.vibrate?.([80, 60, 80]);
        setRecent((r) => [{ n: ++seq.current, name: clean, batch: null, counted: 0, ok: false }, ...r].slice(0, 6));
        toast.error(t("billing.audit.count.unknown", { code: clean }));
      } else {
        const x = res.results[0]!;
        setRecent((r) => [{ n: ++seq.current, name: x.itemName, batch: x.batchNo, counted: x.counted, ok: true }, ...r].slice(0, 6));
      }
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const setLine = async (l: AuditLine, value: number) => {
    try {
      await count.mutateAsync({ counter: counter.trim() || undefined, entries: [{ lineId: l.id, qty: Math.max(0, value), mode: "set" }] });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-2xl border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="ac-code">{t("billing.audit.count.scan")}</Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = code;
                setCode("");
                void submit(v).then(() => inputRef.current?.focus());
              }}
            >
              <Input
                ref={inputRef}
                id="ac-code"
                value={code}
                autoFocus
                autoComplete="off"
                inputMode="text"
                enterKeyHint="done"
                className="h-12 text-lg"
                placeholder={t("billing.audit.count.scanPlaceholder")}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" size="lg" className="h-12" disabled={count.isPending || !code.trim()}>
                <PlusIcon /> {t("billing.audit.count.add")}
              </Button>
              {cameraScanSupported() && (
                <Button type="button" variant="outline" size="lg" className="h-12" onClick={() => setCamera(true)} aria-label={t("billing.audit.count.camera")}>
                  <CameraIcon />
                </Button>
              )}
            </form>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ac-per">{t("billing.audit.count.perScan")}</Label>
            <Input id="ac-per" value={per} inputMode="decimal" className="h-12 w-24 text-right text-lg tabular-nums" onChange={(e) => setPer(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ac-name">{t("billing.audit.count.counter")}</Label>
            <Input
              id="ac-name"
              value={counter}
              maxLength={60}
              className="h-12 sm:w-40"
              placeholder={t("billing.audit.count.counterPlaceholder")}
              onChange={(e) => {
                setCounter(e.target.value);
                saveCounter(e.target.value);
              }}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("billing.audit.count.hint")}</p>
        {recent.length > 0 && (
          <ul className="grid gap-1" aria-live="polite">
            {recent.map((r, i) => (
              <li key={r.n} className={cn("flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm", r.ok ? "bg-success/10" : "bg-danger/10", i > 0 && "opacity-70")}>
                <span className="truncate">
                  {r.name}
                  {r.batch ? <span className="ml-2 font-mono text-xs text-muted-foreground">{r.batch}</span> : null}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{r.ok ? formatQty(r.counted) : t("billing.audit.count.notFound")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{t("billing.audit.count.progress", { counted, total })}</span>
          <span className="text-muted-foreground tabular-nums">{total ? Math.round((counted / total) * 100) : 0}%</span>
        </div>
        <Progress value={total ? (counted / total) * 100 : 0} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup
          value={filter}
          onChange={setFilter}
          aria-label={t("billing.audit.count.filter")}
          options={(["uncounted", "counted", "all"] as const).map((f) => ({ value: f, label: t(`billing.audit.count.filter.${f}`) }))}
        />
        <Input className="h-9 w-full sm:w-64" value={search} placeholder={t("billing.audit.count.search")} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <ul className="grid gap-2">
        {(lines.data?.items ?? []).map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate font-medium">{l.itemName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[l.batchNo ? t("billing.batches.batchLabel", { no: l.batchNo }) : null, l.expiry ? fmtDay(l.expiry) : null, l.barcode].filter(Boolean).join(" · ") || l.unit || ""}
              </p>
            </div>
            <CountStepper value={l.countedQty} unit={l.unit} onChange={(v) => setLine(l, v)} disabled={count.isPending} />
          </li>
        ))}
        {lines.data && lines.data.items.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">{t("billing.audit.count.none")}</li>}
      </ul>
      <Pager total={lines.data?.total ?? 0} offset={offset} onOffset={setOffset} />

      <ScanDialog
        open={camera}
        onClose={() => setCamera(false)}
        onCode={(c) => {
          void submit(c);
        }}
      />
    </div>
  );
}

function CountStepper({ value, unit, onChange, disabled }: { value: number | null; unit: string | null; onChange: (v: number) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [text, setText] = React.useState(value === null ? "" : String(value));
  React.useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const n = parseQty(text);
    if (n !== null && n !== value) onChange(n);
    else setText(value === null ? "" : String(value));
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button type="button" variant="outline" size="icon" aria-label={t("billing.audit.count.minus")} disabled={disabled || (value ?? 0) <= 0} onClick={() => onChange(Math.max(0, (value ?? 0) - 1))}>
        <MinusIcon />
      </Button>
      <Input
        value={text}
        inputMode="decimal"
        placeholder="—"
        aria-label={t("billing.audit.col.counted")}
        className="h-10 w-20 text-center text-base font-semibold tabular-nums"
        onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
      />
      <Button type="button" variant="outline" size="icon" aria-label={t("billing.audit.count.plus")} disabled={disabled} onClick={() => onChange((value ?? 0) + 1)}>
        <PlusIcon />
      </Button>
      {unit ? <span className="w-8 text-xs text-muted-foreground">{unit}</span> : null}
    </div>
  );
}

function Pager({ total, offset, onOffset }: { total: number; offset: number; onOffset: (n: number) => void }) {
  const { t } = useI18n();
  if (total <= PAGE) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>{t("billing.audit.pager", { from: offset + 1, to: Math.min(total, offset + PAGE), total })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - PAGE))}>
          {t("billing.audit.prev")}
        </Button>
        <Button variant="outline" size="sm" disabled={offset + PAGE >= total} onClick={() => onOffset(offset + PAGE)}>
          {t("billing.audit.next")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- review: variance with reasons

function ReviewTable({ audit, editable }: { audit: StockAudit; editable: boolean }) {
  const { t } = useI18n();
  const [filter, setFilter] = React.useState<"variance" | "all" | "uncounted">("variance");
  const [search, setSearch] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => setOffset(0), [filter, search]);
  const lines = useAuditLines(audit.id, { filter, q: search, offset, limit: PAGE });
  const patch = usePatchAuditLine(audit.id);

  const save = async (l: AuditLine, body: { countedQty?: number | null; reason?: string | null }) => {
    try {
      await patch.mutateAsync({ lineId: l.id, body });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup
          value={filter}
          onChange={setFilter}
          aria-label={t("billing.audit.count.filter")}
          options={(["variance", "all", "uncounted"] as const).map((f) => ({ value: f, label: t(`billing.audit.review.filter.${f}`) }))}
        />
        <Input className="h-9 w-full sm:w-64" value={search} placeholder={t("billing.audit.count.search")} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t("billing.audit.col.item")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.audit.col.system")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.audit.col.counted")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.audit.col.diff")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.audit.col.value")}</th>
              <th className="px-3 py-2 font-medium">{t("billing.audit.col.reason")}</th>
            </tr>
          </thead>
          <tbody>
            {(lines.data?.items ?? []).map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="max-w-[16rem] px-3 py-2">
                  <p className="truncate font-medium">{l.itemName}</p>
                  <p className="truncate text-xs text-muted-foreground">{[l.batchNo ? t("billing.batches.batchLabel", { no: l.batchNo }) : null, l.expiry ? fmtDay(l.expiry) : null].filter(Boolean).join(" · ")}</p>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.systemQty)}</td>
                <td className="px-3 py-2 text-right">
                  {editable ? (
                    <RecountInput value={l.countedQty} onCommit={(v) => save(l, { countedQty: v })} />
                  ) : (
                    <span className="tabular-nums">{l.countedQty === null ? "—" : formatQty(l.countedQty)}</span>
                  )}
                </td>
                <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", l.variance < 0 && "text-danger-ink", l.variance > 0 && "text-success-ink")}>
                  {l.countedQty === null ? "—" : `${l.variance > 0 ? "+" : ""}${formatQty(l.variance)}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.countedQty === null || l.variance === 0 ? "—" : money(l.value)}</td>
                <td className="px-3 py-2">
                  {l.countedQty === null || l.variance === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : editable ? (
                    <Select value={l.reason ?? ""} onValueChange={(v) => save(l, { reason: v })}>
                      <SelectTrigger size="sm" className={cn("w-44", !l.reason && "border-warning")} aria-label={t("billing.audit.col.reason")}>
                        <SelectValue placeholder={t("billing.audit.chooseReason")} />
                      </SelectTrigger>
                      <SelectContent>
                        {REASONS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {t(`billing.audit.reason.${r}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span>{l.reason ? tOr(t, `billing.audit.reason.${l.reason}`, l.reason) : "—"}</span>
                  )}
                </td>
              </tr>
            ))}
            {lines.data && lines.data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {t("billing.audit.review.none")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager total={lines.data?.total ?? 0} offset={offset} onOffset={setOffset} />
    </div>
  );
}

function RecountInput({ value, onCommit }: { value: number | null; onCommit: (v: number | null) => void }) {
  const { t } = useI18n();
  const [text, setText] = React.useState(value === null ? "" : String(value));
  React.useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    if (!text.trim()) {
      if (value !== null) onCommit(null);
      return;
    }
    const n = parseQty(text);
    if (n !== null && n !== value) onCommit(n);
    else setText(value === null ? "" : String(value));
  };
  return (
    <Input
      value={text}
      inputMode="decimal"
      aria-label={t("billing.audit.recount")}
      className="ml-auto h-9 w-24 text-right tabular-nums"
      onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
    />
  );
}
