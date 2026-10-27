"use client";

import * as React from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon, MailIcon, MessageCircleIcon, MessageSquareTextIcon, Share2Icon, TruckIcon } from "lucide-react";
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea, toast } from "@srirealtime/ui";
import { describeError, useFeature, useI18n } from "@srirealtime/web";
import { QrImage } from "../upi-qr";
import { money, todayIST, whatsappNumber } from "../../lib/format";
import { usePublicUrl } from "../../lib/links";
import {
  useCancelSalesDoc,
  useChallansToBill,
  useConvertProforma,
  useDeliverSaleOrder,
  useInvoiceChallans,
  useInvoiceOrderChallans,
  useInvoiceSaleOrder,
  useProformaAdvance,
  useReturnChallan,
  useSaleOrderAdvance,
  useSendSalesDoc,
  useShareSalesDoc,
  useUpdateChallan,
} from "../../lib/queries-sales-docs";
import type { Invoice, InvoiceParty, PaymentMethod } from "../../lib/types";
import { round3, TRANSPORT_MODES, type Challan, type ChallanTransport, type SaleOrder, type SalesDocChannel, type SalesDocKind, type TransportMode } from "../../lib/types-sales-docs";
import { qtyText } from "./sd-ui";

const METHODS: PaymentMethod[] = ["cash", "upi", "card", "bank", "cheque", "other"];
const ICON = { whatsapp: MessageCircleIcon, sms: MessageSquareTextIcon, email: MailIcon } as const;

/** Digits and one dot, at most 3 decimals. */
const cleanQty = (v: string) => {
  const s = v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  const m = /^(\d*)(\.?\d{0,3})/.exec(s);
  return m ? m[1]! + m[2]! : "";
};

// ---------------------------------------------------------------- send / share

/**
 * Sends the document through the shop's WhatsApp / SMS / email, or hands out the public link to copy, scan or send from
 * the owner's own WhatsApp (like quotations). A draft proforma becomes issued when it goes out.
 */
export function SendSalesDocDialog({
  kind,
  doc,
  shopName,
  open,
  onOpenChange,
}: {
  kind: SalesDocKind;
  doc: { id: string; number: string; total: number; customer: InvoiceParty; hasShareLink: boolean };
  shopName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const whatsappOn = useFeature("invoices.whatsapp");
  const send = useSendSalesDoc(kind);
  const share = useShareSalesDoc(kind);
  const publicUrl = usePublicUrl();
  const [channel, setChannel] = React.useState<SalesDocChannel>("whatsapp");
  const [to, setTo] = React.useState("");
  const [url, setUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const channels = whatsappOn ? (["whatsapp", "sms", "email"] as const) : (["email"] as const);

  React.useEffect(() => {
    if (!open) return;
    setCopied(false);
    setChannel(whatsappOn ? "whatsapp" : "email");
    setTo(doc.customer.phone ?? "");
    setUrl(null);
    if (doc.hasShareLink) {
      share.mutate(doc.id, { onSuccess: (r) => setUrl(r.url || publicUrl(`d/${r.token}`)), onError: (err) => toast.error(describeError(err, t)) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when opened
  }, [open]);

  const pick = (c: SalesDocChannel) => {
    setChannel(c);
    setTo(c === "email" ? (doc.customer.email ?? "") : (doc.customer.phone ?? ""));
  };
  const run = async () => {
    try {
      const r = await send.mutateAsync({ id: doc.id, channel, to: to.trim() || undefined, locale: locale === "ta" ? "ta" : undefined });
      setUrl(r.url);
      toast.success(t(`billing.sd.send.sent.${channel}`, { name: doc.customer.name }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t), { description: t("billing.sd.send.failedHint") });
    }
  };
  const makeLink = () => share.mutate(doc.id, { onSuccess: (r) => setUrl(r.url || publicUrl(`d/${r.token}`)), onError: (err) => toast.error(describeError(err, t)) });
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("billing.share.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("billing.share.copyFailed"));
    }
  };
  const message = url ? t(`billing.sd.send.message.${kind}`, { name: doc.customer.name, shop: shopName, number: doc.number, amount: money(doc.total), url }) : "";
  const wa = whatsappNumber(to || doc.customer.phone);
  const waHref = url ? `https://wa.me/${wa ?? ""}?text=${encodeURIComponent(message)}` : "#";
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog open={open} onOpenChange={(o) => !send.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.sd.send.title", { number: doc.number })}</DialogTitle>
          <DialogDescription>{t(`billing.sd.send.body.${kind}`)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${channels.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={t("billing.sd.send.channel")}>
              {channels.map((c) => {
                const Icon = ICON[c];
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={channel === c}
                    onClick={() => pick(c)}
                    className={cn("flex h-11 items-center justify-center gap-1.5 rounded-md border text-sm", channel === c ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent")}
                  >
                    <Icon className="size-4" /> {t(`billing.sd.send.channels.${c}`)}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sd-send-to">{channel === "email" ? t("billing.sd.send.emailTo") : t("billing.sd.send.phoneTo")}</Label>
              <Input id="sd-send-to" type={channel === "email" ? "email" : "tel"} inputMode={channel === "email" ? "email" : "tel"} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button size="lg" className="h-12" disabled={send.isPending || !to.trim()} onClick={() => void run()}>
              {send.isPending ? <Loader2Icon className="animate-spin" /> : React.createElement(ICON[channel])}
              {t(`billing.sd.send.go.${channel}`)}
            </Button>
          </div>
          <div className="grid gap-3 border-t pt-4">
            <p className="text-sm font-medium">{t("billing.sd.send.orShare")}</p>
            {!url ? (
              <Button variant="outline" size="lg" disabled={share.isPending} onClick={makeLink}>
                {share.isPending ? <Loader2Icon className="animate-spin" /> : <Share2Icon />}
                {t("billing.sd.send.makeLink")}
              </Button>
            ) : (
              <div className="grid gap-3">
                <div className="flex items-center gap-3">
                  <QrImage value={url} size={88} alt={t("billing.share.qrAlt")} className="border" />
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={t("billing.share.link")} />
                    <Button variant="outline" size="icon" onClick={() => void copy()} aria-label={t("billing.share.copy")}>
                      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button asChild size="lg" className="bg-[#25D366] text-white hover:bg-[#1ebe5b]">
                    <a href={waHref} target="_blank" rel="noopener noreferrer">
                      <MessageCircleIcon /> {t("billing.share.whatsapp")}
                    </a>
                  </Button>
                  {canNativeShare ? (
                    <Button variant="outline" size="lg" onClick={() => void navigator.share({ title: `${shopName} ${doc.number}`, text: message, url }).catch(() => undefined)}>
                      <Share2Icon /> {t("billing.share.more")}
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="lg">
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <ExternalLinkIcon /> {t("billing.share.open")}
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- cancel

export function CancelSalesDocDialog({ kind, doc, open, onOpenChange }: { kind: SalesDocKind; doc: { id: string; number: string }; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const cancel = useCancelSalesDoc(kind);
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !cancel.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.sd.cancel.title", { number: doc.number })}</DialogTitle>
          <DialogDescription>{t(`billing.sd.cancel.body.${kind}`)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="sd-cancel-reason">{t("billing.sd.cancel.reason")}</Label>
          <Textarea id="sd-cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={cancel.isPending}>
            {t("billing.cancel.keep")}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            disabled={cancel.isPending}
            onClick={async () => {
              try {
                await cancel.mutateAsync({ id: doc.id, reason: reason.trim() || undefined });
                toast.success(t("billing.sd.cancel.done"));
                onOpenChange(false);
              } catch (err) {
                toast.error(describeError(err, t));
              }
            }}
          >
            {cancel.isPending && <Loader2Icon className="animate-spin" />}
            {t("billing.sd.cancel.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- advance

/**
 * Money received against a proforma or sale order. Kept in the customer's credit book as an advance for this document and
 * put on its bill when the bill is issued.
 */
export function AdvanceDialog({
  kind,
  doc,
  open,
  onOpenChange,
}: {
  kind: "proforma" | "sale_order";
  doc: { id: string; number: string; total: number; advanceAmount: number; advanceReceived: number };
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const pAdvance = useProformaAdvance();
  const oAdvance = useSaleOrderAdvance();
  const busy = pAdvance.isPending || oAdvance.isPending;
  const left = Math.max(doc.total - doc.advanceReceived, 0);
  const suggested = Math.min(Math.max(doc.advanceAmount - doc.advanceReceived, 0) || left, left);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [date, setDate] = React.useState(todayIST());
  const [reference, setReference] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    setAmount(suggested > 0 ? String(suggested / 100) : "");
    setMethod("cash");
    setDate(todayIST());
    setReference("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened
  }, [open]);
  const paise = Math.round(Number(amount || "0") * 100);
  const ok = paise > 0 && paise <= left;
  const submit = async () => {
    if (!ok) return;
    const body = { amount: paise, method, date, ...(reference.trim() ? { reference: reference.trim() } : {}) };
    try {
      if (kind === "proforma") await pAdvance.mutateAsync({ id: doc.id, body });
      else await oAdvance.mutateAsync({ id: doc.id, body });
      toast.success(t("billing.sd.advance.done", { amount: money(paise) }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.sd.advance.title", { number: doc.number })}</DialogTitle>
          <DialogDescription>{t("billing.sd.advance.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="sd-adv-amount">{t("billing.sd.advance.amount")}</Label>
            <Input id="sd-adv-amount" inputMode="decimal" className="text-right text-lg tabular-nums" value={amount} aria-invalid={!!amount && !ok} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
            <p className="text-meta text-muted-foreground">{t("billing.sd.advance.left", { amount: money(left) })}</p>
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("billing.payment.method")}>
            {METHODS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={cn("h-10 rounded-md border text-sm", method === m ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent")}>
                {t(`billing.payment.methods.${m}`)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sd-adv-date">{t("billing.sd.advance.date")}</Label>
              <Input id="sd-adv-date" type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value || todayIST())} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sd-adv-ref">{t("billing.sd.advance.reference")}</Label>
              <Input id="sd-adv-ref" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("billing.common.cancel")}
          </Button>
          <Button size="lg" disabled={busy || !ok} onClick={() => void submit()}>
            {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {t("billing.sd.advance.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- bill a proforma

export function ConvertProformaDialog({
  proforma,
  open,
  onOpenChange,
  onDone,
}: {
  proforma: { id: string; number: string; total: number; advanceUnapplied: number };
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (invoice: Invoice) => void;
}) {
  const { t } = useI18n();
  const convert = useConvertProforma();
  const [issue, setIssue] = React.useState(true);
  React.useEffect(() => {
    if (open) setIssue(true);
  }, [open]);
  const submit = async () => {
    try {
      const r = await convert.mutateAsync({ id: proforma.id, issue });
      toast.success(r.invoice.number ? t("billing.sd.convert.doneIssued", { number: r.invoice.number }) : t("billing.sd.convert.doneDraft"));
      onOpenChange(false);
      onDone(r.invoice);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !convert.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.sd.convert.title", { number: proforma.number })}</DialogTitle>
          <DialogDescription>{t("billing.sd.convert.body", { total: money(proforma.total) })}</DialogDescription>
        </DialogHeader>
        <IssueToggle issue={issue} onChange={setIssue} />
        {proforma.advanceUnapplied > 0 && <p className="rounded-lg bg-primary/5 p-3 text-sm">{t(issue ? "billing.sd.convert.advanceNow" : "billing.sd.convert.advanceLater", { amount: money(proforma.advanceUnapplied) })}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={convert.isPending}>
            {t("billing.common.cancel")}
          </Button>
          <Button size="lg" disabled={convert.isPending} onClick={() => void submit()}>
            {convert.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {issue ? t("billing.sd.convert.makeIssued") : t("billing.sd.convert.makeDraft")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueToggle({ issue, onChange }: { issue: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={issue} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-medium">{t("billing.sd.convert.issueNow")}</span>
        <span className="block text-meta text-muted-foreground">{t("billing.sd.convert.issueHint")}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- pick quantities per line

interface PickLine {
  key: string;
  description: string;
  unit: string | null;
  left: number;
}

/** Quantity inputs for lines (each prefilled with what is left; 0 leaves the line out). */
function QtyPicker({ lines, values, onChange, label }: { lines: PickLine[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void; label: string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2" role="group" aria-label={label}>
      {lines.map((l) => {
        const v = values[l.key] ?? "";
        const n = Number(v || "0");
        const bad = n > l.left + 1e-9;
        return (
          <div key={l.key} className="flex items-center gap-3 rounded-lg border p-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.description}</p>
              <p className="text-meta text-muted-foreground">{t("billing.sd.pick.left", { qty: qtyText(l.left), unit: l.unit ?? "" })}</p>
            </div>
            <Input
              inputMode="decimal"
              className="w-24 text-right tabular-nums"
              aria-label={t("billing.sd.pick.qtyFor", { item: l.description })}
              aria-invalid={bad}
              value={v}
              onChange={(e) => onChange({ ...values, [l.key]: cleanQty(e.target.value) })}
            />
          </div>
        );
      })}
    </div>
  );
}

const picked = (values: Record<string, string>, lines: PickLine[]) =>
  lines.map((l) => ({ key: l.key, qty: round3(Number(values[l.key] || "0")) })).filter((x) => x.qty > 0);
const pickValid = (values: Record<string, string>, lines: PickLine[]) =>
  picked(values, lines).length > 0 && lines.every((l) => Number(values[l.key] || "0") <= l.left + 1e-9);
const fullValues = (lines: PickLine[]) => Object.fromEntries(lines.map((l) => [l.key, l.left > 0 ? String(l.left) : ""]));

// ---------------------------------------------------------------- sale order: deliver

/** Goods of a sale order leave on a delivery challan (stock goes out with it). */
export function DeliverDialog({ order, open, onOpenChange, onDone }: { order: SaleOrder; open: boolean; onOpenChange: (o: boolean) => void; onDone: (challan: Challan) => void }) {
  const { t } = useI18n();
  const deliver = useDeliverSaleOrder();
  const lines: PickLine[] = order.progress.filter((p) => p.toDeliver > 0).map((p) => ({ key: p.key, description: p.description, unit: p.unit, left: p.toDeliver }));
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [reason, setReason] = React.useState<"before_invoice" | "approval">("before_invoice");
  const [mode, setMode] = React.useState<TransportMode>("road");
  const [vehicle, setVehicle] = React.useState("");
  const [ewbNo, setEwbNo] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    setValues(fullValues(lines));
    setReason("before_invoice");
    setMode("road");
    setVehicle("");
    setEwbNo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened
  }, [open]);
  const v = vehicle.toUpperCase().replace(/[\s.\-/]/g, "");
  const ok = pickValid(values, lines) && (!v || /^[A-Z0-9]{4,20}$/.test(v)) && (!ewbNo || /^\d{12}$/.test(ewbNo));
  const submit = async () => {
    const transport: ChallanTransport = { mode, ...(v ? { vehicleNo: v } : {}) };
    try {
      const r = await deliver.mutateAsync({ id: order.id, body: { lines: picked(values, lines), reason, transport, ...(ewbNo ? { ewbNo } : {}) } });
      toast.success(t("billing.sd.deliver.done", { number: r.challan.number }));
      onOpenChange(false);
      onDone(r.challan);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !deliver.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.sd.deliver.title", { number: order.number })}</DialogTitle>
          <DialogDescription>{t("billing.sd.deliver.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
          <QtyPicker lines={lines} values={values} onChange={setValues} label={t("billing.sd.deliver.title", { number: order.number })} />
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("billing.sd.form.purpose")}>
            {(["before_invoice", "approval"] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={cn("rounded-lg border p-2.5 text-left text-sm", reason === r ? "border-primary bg-primary/5 font-medium" : "hover:bg-accent")}>
                {t(`billing.sd.reason.${r}`)}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label>
              <TruckIcon className="mr-1 inline size-4" /> {t("billing.sd.transport.mode")}
            </Label>
            <div className="flex flex-wrap gap-1">
              {TRANSPORT_MODES.map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("h-8 rounded-full border px-3 text-xs", mode === m ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent")}>
                  {t(`billing.sd.transport.modes.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sd-dl-vehicle">{t("billing.sd.transport.vehicle")}</Label>
              <Input id="sd-dl-vehicle" className="font-mono uppercase" maxLength={20} value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sd-dl-ewb">{t("billing.sd.form.ewbNo")}</Label>
              <Input id="sd-dl-ewb" inputMode="numeric" className="font-mono" maxLength={12} value={ewbNo} onChange={(e) => setEwbNo(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={deliver.isPending}>
            {t("billing.common.cancel")}
          </Button>
          <Button size="lg" disabled={deliver.isPending || !ok} onClick={() => void submit()}>
            {deliver.isPending ? <Loader2Icon className="animate-spin" /> : <TruckIcon />}
            {t("billing.sd.deliver.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- sale order: bill

/**
 * Bills a sale order: the delivered challans not billed yet (no stock moves again), or undelivered quantities straight
 * from the order (that bill moves the stock).
 */
export function OrderInvoiceDialog({ order, open, onOpenChange, onDone }: { order: SaleOrder; open: boolean; onOpenChange: (o: boolean) => void; onDone: (invoice: Invoice) => void }) {
  const { t } = useI18n();
  const direct = useInvoiceSaleOrder();
  const viaChallans = useInvoiceOrderChallans();
  const busy = direct.isPending || viaChallans.isPending;
  const lines: PickLine[] = order.progress.filter((p) => p.toDeliver > 0).map((p) => ({ key: p.key, description: p.description, unit: p.unit, left: p.toDeliver }));
  const hasChallans = order.challansToBill.length > 0;
  const [how, setHow] = React.useState<"challans" | "direct">(hasChallans ? "challans" : "direct");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [issue, setIssue] = React.useState(true);
  React.useEffect(() => {
    if (!open) return;
    setHow(hasChallans ? "challans" : "direct");
    setValues(fullValues(lines));
    setIssue(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened
  }, [open]);
  const ok = how === "challans" ? hasChallans : pickValid(values, lines);
  const submit = async () => {
    try {
      const r =
        how === "challans"
          ? await viaChallans.mutateAsync({ id: order.id, body: { issue } })
          : await direct.mutateAsync({ id: order.id, body: { lines: picked(values, lines), issue } });
      toast.success(r.invoice.number ? t("billing.sd.convert.doneIssued", { number: r.invoice.number }) : t("billing.sd.convert.doneDraft"));
      onOpenChange(false);
      onDone(r.invoice);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const challanNumbers = order.challans.filter((c) => order.challansToBill.includes(c.id)).map((c) => c.number).join(", ");
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.sd.orderBill.title", { number: order.number })}</DialogTitle>
          <DialogDescription>{t("billing.sd.orderBill.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
          <div className="grid gap-2" role="radiogroup" aria-label={t("billing.sd.orderBill.title", { number: order.number })}>
            <button type="button" role="radio" aria-checked={how === "challans"} disabled={!hasChallans} onClick={() => setHow("challans")} className={cn("rounded-xl border p-3 text-left disabled:opacity-50", how === "challans" ? "border-primary bg-primary/5" : "hover:bg-accent")}>
              <span className="block text-sm font-semibold">{t("billing.sd.orderBill.challans")}</span>
              <span className="block text-meta text-muted-foreground">{hasChallans ? t("billing.sd.orderBill.challansBody", { numbers: challanNumbers }) : t("billing.sd.orderBill.noChallans")}</span>
            </button>
            <button type="button" role="radio" aria-checked={how === "direct"} disabled={lines.length === 0} onClick={() => setHow("direct")} className={cn("rounded-xl border p-3 text-left disabled:opacity-50", how === "direct" ? "border-primary bg-primary/5" : "hover:bg-accent")}>
              <span className="block text-sm font-semibold">{t("billing.sd.orderBill.direct")}</span>
              <span className="block text-meta text-muted-foreground">{t("billing.sd.orderBill.directBody")}</span>
            </button>
          </div>
          {how === "direct" && <QtyPicker lines={lines} values={values} onChange={setValues} label={t("billing.sd.orderBill.direct")} />}
          <IssueToggle issue={issue} onChange={setIssue} />
          {order.advanceUnapplied > 0 && <p className="rounded-lg bg-primary/5 p-3 text-sm">{t(issue ? "billing.sd.convert.advanceNow" : "billing.sd.convert.advanceLater", { amount: money(order.advanceUnapplied) })}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("billing.common.cancel")}
          </Button>
          <Button size="lg" disabled={busy || !ok} onClick={() => void submit()}>
            {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {issue ? t("billing.sd.convert.makeIssued") : t("billing.sd.convert.makeDraft")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- challan: returns

/** Goods that came back (approval goods not kept, job work returned): back into stock. */
export function ReturnDialog({ challan, open, onOpenChange }: { challan: Challan; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const ret = useReturnChallan();
  const lines: PickLine[] = challan.lines.filter((l) => l.net > 0).map((l) => ({ key: l.key, description: l.description, unit: l.unit ?? null, left: l.net }));
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [date, setDate] = React.useState(todayIST());
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    setValues(fullValues(lines));
    setDate(todayIST());
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened
  }, [open]);
  const ok = pickValid(values, lines);
  const submit = async () => {
    try {
      await ret.mutateAsync({ id: challan.id, body: { lines: picked(values, lines), date, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast.success(t("billing.sd.return.done"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !ret.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.sd.return.title", { number: challan.number })}</DialogTitle>
          <DialogDescription>{t("billing.sd.return.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
          <QtyPicker lines={lines} values={values} onChange={setValues} label={t("billing.sd.return.title", { number: challan.number })} />
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sd-ret-date">{t("billing.sd.return.date")}</Label>
              <Input id="sd-ret-date" type="date" min={challan.date} max={todayIST()} value={date} onChange={(e) => setDate(e.target.value || todayIST())} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sd-ret-note">{t("billing.sd.return.note")}</Label>
              <Input id="sd-ret-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={ret.isPending}>
            {t("billing.common.cancel")}
          </Button>
          <Button size="lg" disabled={ret.isPending || !ok} onClick={() => void submit()}>
            {ret.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {t("billing.sd.return.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- challan: bill (one or more of a customer)

/** One tax invoice for this challan and, if picked, the customer's other open billable challans. Stock doesn't move again. */
export function ChallanInvoiceDialog({ challan, open, onOpenChange, onDone }: { challan: Challan; open: boolean; onOpenChange: (o: boolean) => void; onDone: (invoice: Invoice) => void }) {
  const { t, formatDate } = useI18n();
  const invoice = useInvoiceChallans();
  const others = useChallansToBill(challan.customerId, open);
  const [ids, setIds] = React.useState<string[]>([challan.id]);
  const [issue, setIssue] = React.useState(true);
  React.useEffect(() => {
    if (!open) return;
    setIds([challan.id]);
    setIssue(true);
  }, [open, challan.id]);
  const list = (others.data?.items ?? []).filter((c) => c.id !== challan.id && c.customerId === challan.customerId);
  const submit = async () => {
    try {
      const r = await invoice.mutateAsync({ challanIds: ids, issue });
      toast.success(r.invoice.number ? t("billing.sd.convert.doneIssued", { number: r.invoice.number }) : t("billing.sd.convert.doneDraft"));
      onOpenChange(false);
      onDone(r.invoice);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !invoice.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.sd.challanBill.title", { number: challan.number })}</DialogTitle>
          <DialogDescription>{t("billing.sd.challanBill.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
          {list.length > 0 && (
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">{t("billing.sd.challanBill.others")}</p>
              {list.map((c) => (
                <label key={c.id} className="flex items-center gap-2.5 rounded-lg border p-2.5 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={ids.includes(c.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono">{c.number}</span> · {formatDate(c.date)}
                  </span>
                  <span className="tabular-nums">{money(c.total)}</span>
                </label>
              ))}
            </div>
          )}
          <IssueToggle issue={issue} onChange={setIssue} />
          <p className="text-meta text-muted-foreground">{t("billing.sd.challanBill.noStock")}</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={invoice.isPending}>
            {t("billing.common.cancel")}
          </Button>
          <Button size="lg" disabled={invoice.isPending} onClick={() => void submit()}>
            {invoice.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {t("billing.sd.challanBill.confirm", { count: ids.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- challan: transport / e-way bill

/** Transport, e-way bill and the return date can be filled in after the goods left. */
export function ChallanTransportDialog({ challan, open, onOpenChange }: { challan: Challan; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const update = useUpdateChallan();
  const [tr, setTr] = React.useState<ChallanTransport>({});
  const [ewbNo, setEwbNo] = React.useState("");
  const [ewbDate, setEwbDate] = React.useState("");
  const [returnBy, setReturnBy] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    setTr(challan.transport ?? {});
    setEwbNo(challan.ewbNo ?? "");
    setEwbDate(challan.ewbDate ?? "");
    setReturnBy(challan.returnBy ?? "");
  }, [open, challan]);
  const vehicle = (tr.vehicleNo ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
  const ok = (!vehicle || /^[A-Z0-9]{4,20}$/.test(vehicle)) && (!ewbNo || /^\d{12}$/.test(ewbNo));
  const submit = async () => {
    try {
      await update.mutateAsync({
        id: challan.id,
        body: {
          transport: { ...tr, vehicleNo: vehicle || null, transporterName: tr.transporterName?.trim() || null, docNo: tr.docNo?.trim() || null },
          ewbNo: ewbNo || null,
          ewbDate: ewbDate || null,
          returnBy: returnBy || null,
        },
      });
      toast.success(t("billing.sd.transportEdit.done"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !update.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.sd.transportEdit.title", { number: challan.number })}</DialogTitle>
          <DialogDescription>{challan.ewbSuggested ? t("billing.sd.form.ewbNeeded") : t("billing.sd.form.transportHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-1">
            {TRANSPORT_MODES.map((m) => (
              <button key={m} type="button" aria-pressed={tr.mode === m} onClick={() => setTr((x) => ({ ...x, mode: m }))} className={cn("h-8 rounded-full border px-3 text-xs", tr.mode === m ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent")}>
                {t(`billing.sd.transport.modes.${m}`)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sd-te-vehicle">{t("billing.sd.transport.vehicle")}</Label>
              <Input id="sd-te-vehicle" className="font-mono uppercase" maxLength={20} value={tr.vehicleNo ?? ""} onChange={(e) => setTr((x) => ({ ...x, vehicleNo: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sd-te-transporter">{t("billing.sd.transport.transporter")}</Label>
              <Input id="sd-te-transporter" maxLength={120} value={tr.transporterName ?? ""} onChange={(e) => setTr((x) => ({ ...x, transporterName: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sd-te-lr">{t("billing.sd.transport.lr")}</Label>
              <Input id="sd-te-lr" maxLength={30} value={tr.docNo ?? ""} onChange={(e) => setTr((x) => ({ ...x, docNo: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sd-te-return">{t("billing.sd.form.returnBy")}</Label>
              <Input id="sd-te-return" type="date" min={challan.date} value={returnBy} onChange={(e) => setReturnBy(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sd-te-ewb">{t("billing.sd.form.ewbNo")}</Label>
              <Input id="sd-te-ewb" inputMode="numeric" className="font-mono" maxLength={12} value={ewbNo} onChange={(e) => setEwbNo(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sd-te-ewb-date">{t("billing.sd.form.ewbDate")}</Label>
              <Input id="sd-te-ewb-date" type="date" value={ewbDate} onChange={(e) => setEwbDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            {t("billing.common.cancel")}
          </Button>
          <Button size="lg" disabled={update.isPending || !ok} onClick={() => void submit()}>
            {update.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {t("billing.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
