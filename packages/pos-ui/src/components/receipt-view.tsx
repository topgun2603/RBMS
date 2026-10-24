"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangleIcon, Loader2Icon, MessageCircleIcon, PlusIcon, PrinterIcon } from "lucide-react";
import { formatINR } from "@srirealtime/gst";
import {
  Alert,
  AlertDescription,
  AnimatedNumber,
  Button,
  Field,
  FieldControl,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  motion,
  SuccessCheck,
  Switch,
  toast,
} from "@srirealtime/ui";
import { hasCashPayment, printDirectIfConfigured, resolvePrinterConfig } from "@srirealtime/receipt-print";
import { describeError, useI18n, useOptionalShop } from "@srirealtime/web";
import { fetchPdf, isNetworkError, sendBill, thermalPath } from "../lib/api";
import { formatQty, mobileDigits, money, timeShort } from "../lib/format";
import { reportNetwork } from "../lib/online";
import { failureKey, fetchShopPrinting, kickDrawer, saleReceipt } from "../lib/printing";
import { printPdfBlob, printReceiptInPage } from "../lib/print";
import { storageKey, useLocalState } from "../lib/storage";
import type { Invoice } from "../lib/types";
import { usePos } from "./pos-context";

export interface CompletedSale {
  invoice: Invoice;
  change: number;
  credit: number;
  /** Payments that couldn't be recorded (network/API) — the bill is issued; record them from the bill page. */
  failedPayments: { method: string; amount: number }[];
  phone: string | null;
}

/** After a sale: big change due, print (thermal PDF, else the in-page 80 mm receipt), WhatsApp, next sale. */
export function ReceiptView({ sale, onNewSale }: { sale: CompletedSale; onNewSale: () => void }) {
  const { t, locale } = useI18n();
  const { has, tenant, terminal, shopName, seller, branch, cashier } = usePos();
  const inv = sale.invoice;
  const shopBrand = useOptionalShop();
  const [printing, setPrinting] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [phone, setPhone] = React.useState(mobileDigits(sale.phone) ?? "");
  // A paired terminal starts from its own setting (Settings → POS terminals); the switch below still overrides it here.
  const [autoPrint, setAutoPrint] = useLocalState<boolean>(
    terminal ? storageKey("autoprint", tenant, terminal.device.terminal.id) : storageKey("autoprint", tenant),
    terminal?.device.terminal.settings.autoPrint ?? false,
  );
  const newSaleRef = React.useRef<HTMLButtonElement>(null);
  const printed = React.useRef(false);

  const autoPrintRef = React.useRef(autoPrint);
  autoPrintRef.current = autoPrint;

  // Direct thermal printer (Settings → Printing) first; the thermal PDF / in-page receipt when none is set up or it fails.
  const print = React.useCallback(
    async (o: { drawer?: boolean; interactive?: boolean } = {}) => {
      setPrinting(true);
      try {
        const direct = await printDirectIfConfigured({
          tenant,
          loadShop: fetchShopPrinting,
          receipt: () => saleReceipt(inv, { locale, shopName, seller, branchName: branch?.name, cashier, change: sale.change, time: timeShort(Date.now()) }),
          logoUrl: shopBrand?.logoUrl ?? null,
          drawer: o.drawer,
          direct: { interactive: o.interactive ?? true },
        });
        if (direct.handled) return;
        if (direct.reason !== "not_configured") toast.warning(`${t(failureKey(direct.reason))} ${t("pos.printing.fellBack")}`);
      } catch {
        // fall through to the browser print
      }
      try {
        const blob = await fetchPdf(thermalPath(inv.id), { locale: locale === "ta" ? "ta" : undefined });
        await printPdfBlob(blob);
      } catch (err) {
        if (isNetworkError(err)) reportNetwork(false);
        // No thermal PDF (documents module off, offline, browser can't print a PDF frame): print the page receipt.
        printReceiptInPage();
      } finally {
        setPrinting(false);
        newSaleRef.current?.focus();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one sale; the shop and seller details are stable for it
    [inv.id, locale, tenant],
  );

  React.useEffect(() => {
    newSaleRef.current?.focus();
    if (printed.current) return;
    printed.current = true;
    // Once per sale: print automatically (with the drawer kick when cash was taken), or just open the drawer.
    void (async () => {
      const cfg = await resolvePrinterConfig(tenant, fetchShopPrinting);
      const direct = cfg.transport !== "none";
      const cash = hasCashPayment(inv);
      if (autoPrintRef.current || (direct && cfg.autoPrint)) {
        await print({ drawer: cash, interactive: false });
      } else if (direct && cash && cfg.openDrawerOnCash) {
        const r = await kickDrawer({ tenant, kind: "cash_sale", user: cashier, interactive: false });
        if (!r.opened) toast.warning(t(failureKey(r.reason)));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per sale
  }, [inv.id]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || (target?.tagName === "BUTTON" && (e.key === "Enter" || e.key === " "))) return;
      if (e.key === "Enter" || e.key === "Escape" || e.key === "F9" || e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNewSale();
      } else if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        void print();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNewSale, print]);

  const send = async () => {
    const d = mobileDigits(phone);
    if (!d) {
      toast.error(t("pos.receipt.phoneInvalid"));
      return;
    }
    setSending(true);
    try {
      await sendBill(inv.id, `+91${d}`);
      toast.success(t("pos.receipt.sent"));
    } catch (err) {
      if (isNetworkError(err)) reportNetwork(false);
      toast.error(describeError(err, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="grid w-full max-w-lg gap-5 rounded-3xl border bg-card p-6 text-center shadow-xl"
        role="status"
        aria-live="polite"
      >
        <div className="grid justify-items-center gap-2">
          <SuccessCheck size={76} label={t("pos.receipt.done")} />
          <h2 className="text-xl font-semibold">{t("pos.receipt.done")}</h2>
          <p className="text-sm text-muted-foreground tabular-nums">
            {inv.number} · {money(inv.total)}
          </p>
        </div>

        {sale.change > 0 ? (
          <div className="grid gap-1 rounded-2xl border border-success/40 bg-success/10 p-4">
            <span className="text-sm font-medium text-muted-foreground">{t("pos.receipt.giveChange")}</span>
            <AnimatedNumber value={sale.change} from={0} format={money} className="text-6xl font-bold tracking-tight text-success tabular-nums" />
          </div>
        ) : null}
        {sale.credit > 0 && (
          <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm font-medium">{t("pos.receipt.onCredit", { amount: money(sale.credit) })}</p>
        )}
        {sale.failedPayments.length > 0 && (
          <Alert variant="warning" className="text-left">
            <AlertTriangleIcon />
            <AlertDescription>
              {t("pos.receipt.paymentsFailed", { amount: money(sale.failedPayments.reduce((s, p) => s + p.amount, 0)) })}
            </AlertDescription>
          </Alert>
        )}
        {inv.warnings.includes("credit_limit_exceeded") && <p className="text-sm text-warning-ink">{t("pos.receipt.creditLimit")}</p>}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" size="lg" variant="outline" className="h-14 text-base" onClick={() => void print()} disabled={printing}>
            {printing ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />} {t("pos.receipt.print")}
            <kbd className="hidden font-mono text-xs opacity-60 sm:inline">P</kbd>
          </Button>
          <Button ref={newSaleRef} type="button" size="lg" className="h-14 text-base" onClick={onNewSale}>
            <PlusIcon /> {t("pos.receipt.newSale")}
            <kbd className="hidden font-mono text-xs opacity-70 sm:inline">↵</kbd>
          </Button>
        </div>

        {has.whatsapp && (
          <form
            className="grid gap-2 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Field>
              <FieldLabel>{t("pos.receipt.whatsappTo")}</FieldLabel>
              <div className="flex gap-2">
                <InputGroup size="lg" className="flex-1">
                  <InputGroupAddon>+91</InputGroupAddon>
                  <FieldControl>
                    <InputGroupInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" />
                  </FieldControl>
                </InputGroup>
                <Button type="submit" size="lg" variant="secondary" disabled={sending}>
                  {sending ? <Loader2Icon className="animate-spin" /> : <MessageCircleIcon />} {t("pos.receipt.whatsapp")}
                </Button>
              </div>
            </Field>
          </form>
        )}

        <div className="flex items-center justify-center gap-2">
          <Switch id="pos-autoprint" checked={autoPrint} onCheckedChange={(v) => setAutoPrint(v)} />
          <Label htmlFor="pos-autoprint" className="text-sm font-normal text-muted-foreground">
            {t("pos.receipt.autoPrint")}
          </Label>
        </div>
      </motion.div>
      <PrintReceipt invoice={inv} change={sale.change} />
    </div>
  );
}

/** The in-page 80 mm receipt: hidden on screen, the only thing printed while `data-pos-printing` is set. */
export function PrintReceipt({ invoice, change }: { invoice: Invoice; change: number }) {
  const { t } = useI18n();
  const { shopName, seller, branch } = usePos();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const tt = invoice.totals;
  const r = (label: React.ReactNode, value: React.ReactNode, bold = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return createPortal(
    <>
      <style>{RECEIPT_CSS}</style>
      <div data-pos-print="" aria-hidden>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{seller.legalName || shopName}</div>
          {branch && <div>{branch.name}</div>}
          {seller.address && <div>{seller.address}</div>}
          {seller.gstin && <div>GSTIN {seller.gstin}</div>}
          {seller.phone && <div>{seller.phone}</div>}
          <div style={{ marginTop: 4, fontWeight: 700 }}>{t("pos.print.taxInvoice")}</div>
        </div>
        <hr />
        {r(invoice.number, `${invoice.date} ${timeShort(Date.now())}`)}
        {r(t("pos.print.to"), invoice.customer.name)}
        <hr />
        {invoice.lines.map((l, i) => (
          <div key={i} style={{ marginBottom: 2 }}>
            <div>{l.description}</div>
            {r(`${formatQty(l.qty)} × ${formatINR(l.total / l.qty)}`, formatINR(l.total))}
          </div>
        ))}
        <hr />
        {r(t("pos.print.taxable"), formatINR(tt.taxable))}
        {tt.cgst > 0 && r("CGST", formatINR(tt.cgst))}
        {tt.sgst > 0 && r("SGST", formatINR(tt.sgst))}
        {tt.igst > 0 && r("IGST", formatINR(tt.igst))}
        {tt.loyalty && tt.loyalty.discount > 0 && r(t("pos.print.points", { count: tt.loyalty.points }), `-${formatINR(tt.loyalty.discount)}`)}
        {tt.roundOff !== 0 && r(t("pos.print.roundOff"), formatINR(tt.roundOff))}
        {r(t("pos.print.total"), formatINR(invoice.total), true)}
        <hr />
        {invoice.payments.map((p) => (
          <React.Fragment key={p.id}>{r(t(`pos.pay.method.${p.method === "cash" || p.method === "upi" || p.method === "card" ? p.method : "other"}`), formatINR(p.amount))}</React.Fragment>
        ))}
        {change > 0 && r(t("pos.print.change"), formatINR(change))}
        {invoice.balance > 0 && r(t("pos.print.balance"), formatINR(invoice.balance), true)}
        <hr />
        <div style={{ textAlign: "center" }}>{t("pos.print.thanks")}</div>
      </div>
    </>,
    document.body,
  );
}

const RECEIPT_CSS = `
[data-pos-print] { display: none; }
@media print {
  html[data-pos-printing] body * { visibility: hidden !important; }
  html[data-pos-printing] [data-pos-print], html[data-pos-printing] [data-pos-print] * { visibility: visible !important; }
  html[data-pos-printing] [data-pos-print] {
    display: block !important; position: absolute; left: 0; top: 0; width: 72mm; padding: 2mm 4mm;
    color: #000; background: #fff; font: 11px/1.35 ui-monospace, "Noto Sans Mono", monospace;
  }
  html[data-pos-printing] [data-pos-print] hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  @page { size: 80mm auto; margin: 0; }
}
`;
