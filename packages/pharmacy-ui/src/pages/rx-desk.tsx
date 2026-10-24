"use client";

import * as React from "react";
import { Loader2Icon, ScanLineIcon, ShieldAlertIcon } from "lucide-react";
import { Button, Input, toast } from "@srirealtime/ui";
import { AiDraftBanner, Page, PageHeading, api, describeError, useI18n } from "@srirealtime/web";
import { SchedulePill } from "../components/bits";
import { InteractionPanel } from "../components/interaction-panel";
import { MAX_PAGES, RX_SCAN_CREDITS, ScanFileError, lookupMeds, prepareScan, scanErrorKind, useScanRx, type MatchRef, type RxDraft, type RxLine } from "../lib/ai";

/** A line in the working draft: what the pharmacist has chosen, not what the AI said. */
interface WorkLine {
  key: string;
  src: RxLine | null;
  picked: MatchRef | null;
  qty: string;
  on: boolean;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function toWork(d: RxDraft): WorkLine[] {
  return d.lines.map((l) => ({ key: `l${l.n}`, src: l, picked: l.match, qty: l.qty ? String(l.qty) : "", on: l.select }));
}

export default function RxDeskPage() {
  const { t, locale } = useI18n();
  const scan = useScanRx();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [draft, setDraft] = React.useState<RxDraft | null>(null);
  const [run, setRun] = React.useState<{ runId: string; credits: number; mock: boolean } | null>(null);
  const [lines, setLines] = React.useState<WorkLine[]>([]);
  const [head, setHead] = React.useState({ doctor: "", regNo: "", clinic: "", date: "", patient: "", age: "" });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [bill, setBill] = React.useState<{ id: string } | null>(null);

  const onFiles = async (files: File[]) => {
    setError(null);
    setBill(null);
    try {
      const payload = await prepareScan(files);
      const r = await scan.mutateAsync(payload);
      setDraft(r.draft);
      setRun({ runId: r.runId, credits: r.credits, mock: r.provider === "mock" });
      setLines(toWork(r.draft));
      setHead({
        doctor: r.draft.doctor.name ?? "",
        regNo: r.draft.doctor.regNo ?? "",
        clinic: r.draft.doctor.clinic ?? "",
        date: r.draft.date ?? "",
        patient: r.draft.patient.name ?? "",
        age: r.draft.patient.age != null ? String(r.draft.patient.age) : "",
      });
    } catch (e) {
      if (e instanceof ScanFileError) setError(t(`pharmacy.ai.file.${e.kind}`, { max: MAX_PAGES }));
      else {
        const kind = scanErrorKind(e);
        setError(kind === "other" ? describeError(e, t) : t(`pharmacy.ai.err.${kind}`));
      }
    }
  };

  const update = (key: string, patch: Partial<WorkLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const chosen = lines.filter((l) => l.on && l.picked && Number(l.qty) > 0);
  const hasH1 = chosen.some((l) => l.picked!.schedule === "H1");
  const needRecord = chosen.some((l) => ["H", "H1"].includes(l.picked!.schedule));

  const createBill = async () => {
    setBusy(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const inv = await api.post<{ id: string }>("/invoices", {
        customer: { name: head.patient.trim() || "Walk-in" },
        date: today,
        issue: false,
        notes: head.doctor ? `Prescription: ${head.doctor}${head.regNo ? ` (${head.regNo})` : ""}` : undefined,
        lines: chosen.map((l) => ({ description: l.picked!.name, qty: Number(l.qty), rate: l.picked!.rate, gstRate: l.picked!.gstRate, hsn: l.picked!.hsn ?? undefined, unit: l.picked!.unit, itemId: l.picked!.itemId })),
      });
      if (needRecord && head.doctor.trim() && head.patient.trim()) {
        await api.post("/medicines/prescriptions", {
          invoiceId: inv.id,
          patientName: head.patient.trim(),
          patientAge: head.age ? Number(head.age) : null,
          doctorName: head.doctor.trim(),
          doctorRegNo: head.regNo.trim() || null,
          doctorAddress: head.clinic.trim() || null,
          rxDate: /^\d{4}-\d{2}-\d{2}$/.test(head.date) ? head.date : today,
        });
      }
      setBill({ id: inv.id });
      toast.success(t("pharmacy.ai.rx.billCreated"));
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeading title={t("pharmacy.ai.rx.title")} description={t("pharmacy.ai.rx.description")} />
      <div className="grid gap-4">
        <div className="rounded-lg border bg-card p-4 grid gap-3">
          <p className="text-sm text-muted-foreground">{t("pharmacy.ai.rx.privacy")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" data-testid="rx-file" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void onFiles(f); }} />
            <Button onClick={() => fileRef.current?.click()} disabled={scan.isPending}>
              {scan.isPending ? <Loader2Icon className="animate-spin" /> : <ScanLineIcon />} {t("pharmacy.ai.rx.scan")}
            </Button>
            <span className="text-meta text-muted-foreground">{t("pharmacy.ai.rx.credits", { credits: RX_SCAN_CREDITS })}</span>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        {draft && run && (
          <>
            <AiDraftBanner runId={run.runId} credits={run.credits} mock={run.mock} />
            {draft.flags.length > 0 && (
              <ul className="grid gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                {draft.flags.map((f, i) => (
                  <li key={i} className="flex gap-2"><ShieldAlertIcon className="mt-0.5 size-4 shrink-0" /> {t(`pharmacy.ai.flag.${f.code}`, f.params ?? {})}</li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
              {([["doctor", "pharmacy.rx.doctor"], ["regNo", "pharmacy.rx.regNo"], ["clinic", "pharmacy.rx.clinic"], ["patient", "pharmacy.rx.name"], ["age", "pharmacy.rx.age"]] as const).map(([k, label]) => (
                <label key={k} className="grid gap-1 text-sm">
                  <span className="font-medium">{t(label)}</span>
                  <Input value={head[k]} onChange={(e) => setHead({ ...head, [k]: e.target.value })} />
                </label>
              ))}
              <label className="grid gap-1 text-sm">
                <span className="font-medium">{t("pharmacy.rx.date")}</span>
                <Input type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
              </label>
            </div>

            <div className="grid gap-3">
              {lines.map((l) => (
                <LineCard key={l.key} line={l} onChange={(p) => update(l.key, p)} />
              ))}
              <AddByHand onAdd={(m) => setLines((ls) => [...ls, { key: `m${ls.length}${m.itemId}`, src: null, picked: m, qty: "1", on: true }])} />
            </div>

            <InteractionPanel itemIds={chosen.map((l) => l.picked!.itemId)} locale={locale === "ta" ? "ta" : "en"} />

            {hasH1 && <p className="rounded-lg border p-3 text-sm">{t("pharmacy.ai.rx.h1Note")}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={createBill} disabled={busy || chosen.length === 0}>
                {busy && <Loader2Icon className="animate-spin" />} {t("pharmacy.ai.rx.createBill", { count: chosen.length })}
              </Button>
              {bill && (
                <a className="text-sm font-medium underline" href={`/invoices/${bill.id}`} data-testid="open-draft-bill">
                  {t("pharmacy.ai.rx.openBill")}
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}

function LineCard({ line, onChange }: { line: WorkLine; onChange: (p: Partial<WorkLine>) => void }) {
  const { t } = useI18n();
  const s = line.src;
  const options = s ? [...(s.match ? [s.match] : []), ...s.substitutes, ...s.candidates] : line.picked ? [line.picked] : [];
  const blocked = s?.status === "blocked";
  const unreadable = s?.status === "unreadable";
  return (
    <div className={`grid gap-2 rounded-lg border bg-card p-3 ${blocked ? "border-destructive" : ""}`} data-testid="rx-line">
      <div className="flex flex-wrap items-center gap-2">
        {!blocked && !unreadable && (
          <input type="checkbox" aria-label={t("pharmacy.ai.rx.add")} checked={line.on} disabled={!line.picked} onChange={(e) => onChange({ on: e.target.checked })} className="size-4" />
        )}
        <span className="font-medium">{s ? [s.written, s.strength, s.form].filter(Boolean).join(" ") || t("pharmacy.ai.rx.unreadable") : line.picked?.name}</span>
        {s && <span className="text-meta text-muted-foreground">{[s.dose, s.duration].filter(Boolean).join(" · ")}</span>}
        {line.picked && <SchedulePill schedule={line.picked.schedule} />}
        {s && s.confidence !== "high" && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">{t(`pharmacy.ai.conf.${s.confidence}`)}</span>}
      </div>
      {blocked && <p className="text-sm font-medium text-destructive">{t("pharmacy.ai.rx.blocked")}</p>}
      {unreadable && <p className="text-sm text-amber-700">{t("pharmacy.ai.rx.typeIt")}</p>}
      {s && s.why && !blocked && !unreadable && <p className="text-sm text-muted-foreground">{t(`pharmacy.ai.why.${s.why}`)}</p>}
      {!blocked && options.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm sm:w-auto sm:flex-1" aria-label={t("pharmacy.ai.rx.product")} value={line.picked?.itemId ?? ""} onChange={(e) => { const m = options.find((o) => o.itemId === e.target.value) ?? null; onChange({ picked: m, on: !!m && Number(line.qty) > 0 }); }}>
            <option value="">{t("pharmacy.ai.rx.choose")}</option>
            {options.map((o) => (
              <option key={o.itemId} value={o.itemId}>{o.name} · {o.stock} {t("pharmacy.ai.rx.inStock")}{s?.match && o.itemId !== s.match.itemId && s.substitutes.some((x) => x.itemId === o.itemId) ? ` · ${t("pharmacy.ai.rx.substitute")}` : ""}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm">
            {t("pharmacy.ai.rx.qty")}
            <Input className="w-20" inputMode="numeric" value={line.qty} onChange={(e) => { const q = e.target.value.replace(/[^0-9.]/g, ""); onChange({ qty: q, on: line.on || (!!line.picked && Number(q) > 0 && !s) }); }} />
          </label>
          {line.picked && <span className="text-meta text-muted-foreground">{rupees(line.picked.rate)} + {line.picked.gstRate}% GST</span>}
        </div>
      )}
      {s?.qtyNote && <p className="text-meta text-muted-foreground">{t("pharmacy.ai.rx.qtyNote", { units: s.qtyNote.units, pack: s.qtyNote.packSize })}</p>}
      {(unreadable || (s && ["no_match"].includes(s.status))) && <AddByHand compact onAdd={(m) => onChange({ picked: m, qty: line.qty || "1", on: true, src: line.src ? { ...line.src, status: "matched", why: null } : null })} />}
    </div>
  );
}

function AddByHand({ onAdd, compact }: { onAdd: (m: MatchRef) => void; compact?: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<MatchRef[]>([]);
  React.useEffect(() => {
    if (q.trim().length < 2) return setItems([]);
    const h = setTimeout(() => void lookupMeds(q.trim()).then((r) => setItems(r.items)).catch(() => setItems([])), 250);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <div className={compact ? "grid gap-1" : "grid gap-1 rounded-lg border border-dashed p-3"}>
      <Input placeholder={t("pharmacy.ai.rx.typePlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("pharmacy.ai.rx.typePlaceholder")} />
      {items.length > 0 && (
        <ul className="rounded-md border bg-popover text-sm" data-testid="lookup-results">
          {items.map((m) => (
            <li key={m.itemId}>
              <button type="button" className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onAdd(m); setQ(""); setItems([]); }}>
                <span>{m.name}</span>
                <span className="text-meta text-muted-foreground">{m.stock} {t("pharmacy.ai.rx.inStock")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
