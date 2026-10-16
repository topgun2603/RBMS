"use client";

import * as React from "react";
import {
  ExternalLinkIcon,
  FileTextIcon,
  Loader2Icon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  PhoneIcon,
  PrinterIcon,
  ReceiptIcon,
  RefreshCwIcon,
  StickyNoteIcon,
  TagIcon,
  UserIcon,
} from "lucide-react";
import { Button, toast } from "@srirealtime/ui";
import { describeError, joinPath, ModuleLink, useFeature, useI18n, useOptionalWebApp } from "@srirealtime/web";
import { PERMS, usePermissions } from "../../lib/access";
import { docPath, openPdf } from "../../lib/documents";
import { addressLines, formatPhone, initials, telHref, whatsappHref } from "../../lib/format";
import { useOrderAction } from "../../lib/queries";
import type { Order } from "../../lib/types";
import { CopyButton, Section } from "../bits";

export function CustomerCard({ order }: { order: Order }) {
  const { t } = useI18n();
  const c = order.customer;
  const tel = telHref(c.phone);
  const wa = whatsappHref(c.phone, t("orders.customer.waText", { name: c.name, number: order.number }));
  return (
    <Section icon={UserIcon} title={t("orders.customer.title")}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-heading text-sm font-semibold text-primary ring-4 ring-primary/5">
          {initials(c.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{c.name}</p>
          {c.phone && <p className="text-sm text-muted-foreground tabular-nums">{formatPhone(c.phone)}</p>}
          {c.email && <p className="truncate text-sm text-muted-foreground">{c.email}</p>}
        </div>
      </div>
      {(tel || wa || c.email) && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {tel && (
            <Button asChild variant="outline" className="h-11">
              <a href={tel}>
                <PhoneIcon /> {t("orders.customer.call")}
              </a>
            </Button>
          )}
          {wa && (
            <Button asChild variant="outline" className="h-11">
              <a href={wa} target="_blank" rel="noreferrer">
                <MessageCircleIcon className="text-success-ink" /> {t("orders.customer.whatsapp")}
              </a>
            </Button>
          )}
          {c.email && (
            <Button asChild variant="outline" className="col-span-2 h-11 sm:col-span-1">
              <a href={`mailto:${c.email}?subject=${encodeURIComponent(order.number)}`}>
                <MailIcon /> {t("orders.customer.email")}
              </a>
            </Button>
          )}
        </div>
      )}
      {order.customerNote && (
        <div className="rounded-xl bg-warning/10 p-3 text-sm ring-1 ring-warning/25 ring-inset">
          <p className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-warning-ink">
            <StickyNoteIcon className="size-3.5" /> {t("orders.customer.note")}
          </p>
          <p className="whitespace-pre-wrap">{order.customerNote}</p>
        </div>
      )}
    </Section>
  );
}

export function AddressCard({ order }: { order: Order }) {
  const { t } = useI18n();
  const a = order.shippingAddress;
  const b = order.billingAddress;
  if (!a) {
    return (
      <Section icon={MapPinIcon} title={t("orders.address.title")}>
        <p className="text-sm text-muted-foreground">{t("orders.address.none")}</p>
      </Section>
    );
  }
  const lines = addressLines(a);
  const text = [a.name, ...lines, a.phone].filter(Boolean).join("\n");
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lines.join(", "))}`;
  const differentBilling = b && JSON.stringify(b) !== JSON.stringify(a);
  return (
    <Section icon={MapPinIcon} title={t("orders.address.title")} action={<CopyButton value={text} variant="ghost" size="icon-sm" label={t("orders.address.copy")} />}>
      <address className="text-sm leading-relaxed not-italic">
        {a.name && <span className="block font-medium">{a.name}</span>}
        {lines.map((l) => (
          <span key={l} className="block">
            {l}
          </span>
        ))}
        {a.phone && <span className="block text-muted-foreground tabular-nums">{formatPhone(a.phone)}</span>}
      </address>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <a href={maps} target="_blank" rel="noreferrer">
          <ExternalLinkIcon /> {t("orders.address.map")}
        </a>
      </Button>
      {differentBilling && (
        <div className="border-t border-border/60 pt-3 text-sm">
          <p className="mb-1 text-meta font-medium text-muted-foreground">{t("orders.address.billing")}</p>
          <address className="not-italic">
            {addressLines(b!).map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </address>
        </div>
      )}
    </Section>
  );
}

/** GST bill (open in billing / PDF, retry when it failed) and the order's printable documents. */
export function DocumentsCard({ order }: { order: Order }) {
  const { t } = useI18n();
  const invoices = useFeature("invoices");
  const { can } = usePermissions();
  const action = useOrderAction();
  const [busy, setBusy] = React.useState<string | null>(null);
  const app = useOptionalWebApp();
  // The bill screen belongs to whichever module the host mounted for it (billing-ui's "invoices/:id"); never hard-code it.
  const billing = app?.modules.find((m) => m.routes.some((r) => r.path === "invoices/:id"));
  const billHref = order.invoiceId && billing ? joinPath(billing.basePath, `invoices/${order.invoiceId}`) : null;
  const invoiceFailed = order.events.some((e) => (e.data as { kind?: string; effect?: string }).kind === "effect_failed" && (e.data as { effect?: string }).effect === "invoice.create");

  const open = async (key: string, path: string, fileName: string) => {
    setBusy(key);
    try {
      await openPdf(path, { loadingTitle: t("orders.docs.loading"), fileName });
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    try {
      const o = await action.mutateAsync({ id: order.id, action: "invoice" });
      toast.success(o.invoiceNumber ? t("orders.invoice.created", { number: o.invoiceNumber }) : t("orders.invoice.retried"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const safe = order.number.replace(/[^\w-]+/g, "-");
  return (
    <Section icon={FileTextIcon} title={t("orders.docs.title")}>
      <div className="rounded-xl border bg-muted/20 p-3">
        <div className="flex items-center gap-3">
          <span className="icon-chip size-9 text-primary">
            <ReceiptIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("orders.invoice.title")}</p>
            <p className="mt-0.5 truncate text-meta text-muted-foreground">
              {order.invoiceNumber
                ? order.invoiceNumber
                : invoiceFailed
                  ? t("orders.invoice.failed")
                  : order.status === "cancelled" || order.status === "returned"
                    ? t("orders.invoice.none")
                    : t("orders.invoice.pending")}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {order.invoiceId && invoices && (
            <Button variant="outline" size="sm" disabled={busy === "invoice"} onClick={() => void open("invoice", docPath.invoice(order.invoiceId!), `${order.invoiceNumber ?? "invoice"}.pdf`)}>
              {busy === "invoice" ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />} {t("orders.invoice.pdf")}
            </Button>
          )}
          {billHref && invoices && (
            <Button asChild variant="ghost" size="sm">
              <ModuleLink href={billHref}>
                <ExternalLinkIcon /> {t("orders.invoice.open")}
              </ModuleLink>
            </Button>
          )}
          {!order.invoiceId && invoiceFailed && can(PERMS.manage) && (
            <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => void retry()}>
              {action.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {t("orders.invoice.retry")}
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" disabled={busy === "slip"} onClick={() => void open("slip", docPath.packingSlip(order.id), `Packing-slip-${safe}.pdf`)}>
          {busy === "slip" ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />} {t("orders.docs.packingSlip")}
        </Button>
        <Button
          variant="outline"
          className="h-11"
          disabled={busy === "label" || !order.shippingAddress}
          onClick={() => void open("label", docPath.shippingLabel(order.id), `Label-${safe}.pdf`)}
        >
          {busy === "label" ? <Loader2Icon className="animate-spin" /> : <TagIcon />} {t("orders.docs.shippingLabel")}
        </Button>
      </div>
    </Section>
  );
}
