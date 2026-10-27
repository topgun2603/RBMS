"use client";

import * as React from "react";
import { CheckIcon, ClipboardListIcon, CopyIcon, ExternalLinkIcon, FileBadgeIcon, FileTextIcon, Loader2Icon, MailIcon, MessageCircleIcon, MessageSquareTextIcon, PackageIcon, Share2Icon } from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { describeError, useFeature, useI18n, usePermission, useWebApp } from "@srirealtime/web";
import { QrImage } from "../upi-qr";
import { money, whatsappNumber } from "../../lib/format";
import { usePublicUrl } from "../../lib/links";
import { useCancelQuotation, useConvertQuotation, useSendQuotation, useShareQuotation } from "../../lib/queries-quotations";
import type { Quotation, QuotationChannel, QuotationConvertResult } from "../../lib/types-quotations";

const METHODS = ["cash", "upi", "card", "bank", "cheque", "other"] as const;

/** Href of an order in the orders module, when this app mounts it (null in the billing-only app). */
export function useOrderHref(): ((id: string) => string) | null {
  const app = useWebApp() as { modules?: { id: string; basePath: string }[] };
  const orders = app.modules?.find((m) => m.id === "orders");
  return React.useMemo(() => (orders ? (id: string) => `${orders.basePath.replace(/\/+$/, "")}/orders/${id}` : null), [orders]);
}

// ---------------------------------------------------------------- send / share

/**
 * Sends the quotation through the shop's WhatsApp / SMS / email (POST /quotations/:id/send), or hands out the public
 * link to copy, scan or send from the owner's own WhatsApp. Sending or creating the link marks a draft as sent.
 */
export function SendQuotationDialog({
  quotation,
  shopName,
  open,
  onOpenChange,
}: {
  quotation: Quotation;
  shopName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const whatsappOn = useFeature("invoices.whatsapp");
  const send = useSendQuotation();
  const share = useShareQuotation();
  const publicUrl = usePublicUrl();
  const [channel, setChannel] = React.useState<QuotationChannel>("whatsapp");
  const [to, setTo] = React.useState("");
  const [url, setUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const channels = whatsappOn ? (["whatsapp", "sms", "email"] as const) : (["email"] as const);

  React.useEffect(() => {
    if (!open) return;
    setCopied(false);
    setChannel(whatsappOn ? "whatsapp" : "email");
    setTo(quotation.customer.phone ?? "");
    setUrl(null);
    // A quotation that was shared before: its link is just looked up (sharing again changes nothing).
    if (quotation.hasShareLink) {
      share.mutate(quotation.id, {
        onSuccess: (r) => setUrl(r.url || publicUrl(`q/${r.token}`)),
        onError: (err) => toast.error(describeError(err, t)),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when opened
  }, [open]);

  const pick = (c: QuotationChannel) => {
    setChannel(c);
    setTo(c === "email" ? (quotation.customer.email ?? "") : (quotation.customer.phone ?? ""));
  };

  const run = async () => {
    try {
      const r = await send.mutateAsync({ id: quotation.id, channel, to: to.trim() || undefined, locale: locale === "ta" ? "ta" : undefined });
      setUrl(r.url);
      toast.success(t(`billing.q.send.sent.${channel}`, { name: quotation.customer.name }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t), { description: t("billing.q.send.failedHint") });
    }
  };

  const makeLink = () =>
    share.mutate(quotation.id, {
      onSuccess: (r) => setUrl(r.url || publicUrl(`q/${r.token}`)),
      onError: (err) => toast.error(describeError(err, t)),
    });

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

  const message = url
    ? t("billing.q.send.message", { name: quotation.customer.name, shop: shopName, number: quotation.number, amount: money(quotation.total), date: quotation.validUntil, url })
    : "";
  const wa = whatsappNumber(to || quotation.customer.phone);
  const waHref = url ? `https://wa.me/${wa ?? ""}?text=${encodeURIComponent(message)}` : "#";
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const ICON = { whatsapp: MessageCircleIcon, sms: MessageSquareTextIcon, email: MailIcon } as const;

  return (
    <Dialog open={open} onOpenChange={(o) => !send.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.q.send.title", { number: quotation.number })}</DialogTitle>
          <DialogDescription>{t("billing.q.send.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${channels.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={t("billing.q.send.channel")}>
              {channels.map((c) => {
                const Icon = ICON[c];
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={channel === c}
                    onClick={() => pick(c)}
                    className={cn(
                      "flex h-11 items-center justify-center gap-1.5 rounded-md border text-sm",
                      channel === c ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="size-4" /> {t(`billing.q.send.channels.${c}`)}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="q-send-to">{channel === "email" ? t("billing.q.send.emailTo") : t("billing.q.send.phoneTo")}</Label>
              <Input
                id="q-send-to"
                type={channel === "email" ? "email" : "tel"}
                inputMode={channel === "email" ? "email" : "tel"}
                placeholder={channel === "email" ? "name@example.com" : "98765 43210"}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button size="lg" className="h-12" disabled={send.isPending || !to.trim()} onClick={() => void run()}>
              {send.isPending ? <Loader2Icon className="animate-spin" /> : React.createElement(ICON[channel])}
              {t(`billing.q.send.go.${channel}`)}
            </Button>
          </div>

          <div className="grid gap-3 border-t pt-4">
            <p className="text-sm font-medium">{t("billing.q.send.orShare")}</p>
            {!url ? (
              <Button variant="outline" size="lg" disabled={share.isPending} onClick={makeLink}>
                {share.isPending ? <Loader2Icon className="animate-spin" /> : <Share2Icon />}
                {t("billing.q.send.makeLink")}
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
                    <Button variant="outline" size="lg" onClick={() => void navigator.share({ title: `${shopName} ${quotation.number}`, text: message, url }).catch(() => undefined)}>
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

// ---------------------------------------------------------------- make bill / make order

/**
 * One-tap conversion of the latest revision: a draft bill to edit and issue, an issued bill, or an order. When the
 * quotation asks for an advance, it can be recorded as a payment on the new bill (which is then issued at once) or order.
 */
export function ConvertQuotationDialog({
  quotation,
  open,
  onOpenChange,
  initialTo,
  onDone,
}: {
  quotation: Quotation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialTo?: "invoice" | "order" | "proforma" | "sale_order";
  onDone: (r: QuotationConvertResult) => void;
}) {
  const { t } = useI18n();
  const convert = useConvertQuotation();
  const ordersOn = useFeature("orders");
  const orderHref = useOrderHref();
  const canOrder = ordersOn && !!orderHref;
  // Proforma invoices and sale orders (docs/sales-documents.md).
  const salesDocsOn = useFeature("invoices.sales-docs");
  const canSalesDocs = usePermission("sales-docs.manage");
  const salesDocs = salesDocsOn && canSalesDocs;
  const allCatalogue = quotation.lines.every((l) => !!l.itemId);
  const [to, setTo] = React.useState<"invoice" | "order" | "proforma" | "sale_order">("invoice");
  const [issue, setIssue] = React.useState(false);
  const [advance, setAdvance] = React.useState(false);
  const [method, setMethod] = React.useState<(typeof METHODS)[number]>("cash");
  const hasAdvance = quotation.advanceAmount > 0;

  React.useEffect(() => {
    if (!open) return;
    setTo(initialTo === "order" && canOrder ? "order" : (initialTo === "proforma" || initialTo === "sale_order") && salesDocs ? initialTo : "invoice");
    setIssue(false);
    setAdvance(false);
    setMethod("cash");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened
  }, [open]);

  const issuing = to === "invoice" && (issue || (hasAdvance && advance));
  const toDoc = to === "proforma" || to === "sale_order";

  const submit = async () => {
    try {
      const r = await convert.mutateAsync({
        id: quotation.id,
        body: { to, ...(to === "invoice" && issuing ? { issue: true } : {}), ...(hasAdvance && advance && !toDoc ? { recordAdvance: true, advanceMethod: method } : {}) },
      });
      toast.success(
        r.invoice
          ? t(r.invoice.number ? "billing.q.convert.doneIssued" : "billing.q.convert.doneDraft", { number: r.invoice.number ?? "" })
          : r.salesDoc
            ? t(r.salesDoc.kind === "proforma" ? "billing.sd.fromQuote.doneProforma" : "billing.sd.fromQuote.doneOrder", { number: r.salesDoc.number })
            : t("billing.q.convert.doneOrder", { number: r.order?.number ?? "" }),
      );
      onOpenChange(false);
      onDone(r);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const Option = ({ value, icon: Icon, title, body, disabled }: { value: "invoice" | "order" | "proforma" | "sale_order"; icon: React.ComponentType<{ className?: string }>; title: string; body: string; disabled?: boolean }) => (
    <button
      type="button"
      role="radio"
      aria-checked={to === value}
      disabled={disabled}
      onClick={() => setTo(value)}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        to === value ? "border-primary bg-primary/5" : "hover:bg-accent",
      )}
    >
      <span className="icon-chip mt-0.5 size-9 shrink-0 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-meta text-muted-foreground">{body}</span>
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !convert.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.q.convert.title", { number: quotation.number })}</DialogTitle>
          <DialogDescription>{t("billing.q.convert.body", { rev: quotation.rev, total: money(quotation.total) })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2" role="radiogroup" aria-label={t("billing.q.convert.title", { number: quotation.number })}>
            <Option value="invoice" icon={FileTextIcon} title={t("billing.q.convert.bill")} body={t("billing.q.convert.billBody")} />
            {canOrder && (
              <Option
                value="order"
                icon={PackageIcon}
                title={t("billing.q.convert.order")}
                body={allCatalogue ? t("billing.q.convert.orderBody") : t("billing.q.convert.orderNeedsItems")}
                disabled={!allCatalogue}
              />
            )}
            {salesDocs && <Option value="proforma" icon={FileBadgeIcon} title={t("billing.sd.fromQuote.proforma")} body={t("billing.sd.fromQuote.proformaBody")} />}
            {salesDocs && <Option value="sale_order" icon={ClipboardListIcon} title={t("billing.sd.fromQuote.order")} body={t("billing.sd.fromQuote.orderBody")} />}
          </div>

          {to === "invoice" && (
            <label className={cn("flex items-start gap-2.5 rounded-lg border p-3 text-sm", hasAdvance && advance && "opacity-60")}>
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={issuing} disabled={hasAdvance && advance} onChange={(e) => setIssue(e.target.checked)} />
              <span>
                <span className="block font-medium">{t("billing.q.convert.issueNow")}</span>
                <span className="block text-meta text-muted-foreground">{t("billing.q.convert.issueHint")}</span>
              </span>
            </label>
          )}

          {hasAdvance && toDoc && <p className="rounded-lg bg-primary/5 p-3 text-meta">{t("billing.sd.fromQuote.advanceLater", { pct: quotation.advancePercent ?? 0 })}</p>}
          {hasAdvance && !toDoc && (
            <div className="grid gap-2 rounded-lg border p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
                <span>
                  <span className="block font-medium">{t("billing.q.convert.advance", { amount: money(quotation.advanceAmount), pct: quotation.advancePercent ?? 0 })}</span>
                  <span className="block text-meta text-muted-foreground">{to === "invoice" ? t("billing.q.convert.advanceBillHint") : t("billing.q.convert.advanceOrderHint")}</span>
                </span>
              </label>
              {advance && (
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("billing.payment.method")}>
                  {METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={method === m}
                      onClick={() => setMethod(m)}
                      className={cn("h-10 rounded-md border text-sm", method === m ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent")}
                    >
                      {t(`billing.payment.methods.${m}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={convert.isPending}>
            {t("billing.common.cancel")}
          </Button>
          <Button size="lg" disabled={convert.isPending || (to === "order" && !allCatalogue)} onClick={() => void submit()}>
            {convert.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {to === "proforma" ? t("billing.sd.fromQuote.makeProforma") : to === "sale_order" ? t("billing.sd.fromQuote.makeOrder") : to === "order" ? t("billing.q.convert.makeOrder") : issuing ? t("billing.q.convert.makeIssued") : t("billing.q.convert.makeDraft")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- cancel

export function CancelQuotationDialog({ quotation, open, onOpenChange }: { quotation: Quotation; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const cancel = useCancelQuotation();
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !cancel.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.q.cancel.title", { number: quotation.number })}</DialogTitle>
          <DialogDescription>{t("billing.q.cancel.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="q-cancel-reason">{t("billing.q.cancel.reason")}</Label>
          <Textarea id="q-cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
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
                await cancel.mutateAsync({ id: quotation.id, reason: reason.trim() || undefined });
                toast.success(t("billing.q.cancel.done"));
                onOpenChange(false);
              } catch (err) {
                toast.error(describeError(err, t));
              }
            }}
          >
            {cancel.isPending && <Loader2Icon className="animate-spin" />}
            {t("billing.q.cancel.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
