"use client";

import * as React from "react";
import { countryName, formatForeign, upiLink } from "@srirealtime/gst";
import { cn } from "@srirealtime/ui";
import { BrandMark, useI18n } from "@srirealtime/web";
import { QrImage } from "./upi-qr";
import { money, stateLabel } from "../lib/format";
import type { Invoice } from "../lib/types";
import type { QuotationDocMeta } from "../lib/types-quotations";
import type { SalesDocMeta } from "../lib/types-sales-docs";

const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const pct = (r: number) => `${r}%`;

/**
 * Printable GST tax invoice (A4 via @media print in globals.css). Used by the staff detail page
 * and the public /i/[token] page. Everything comes from the invoice's own snapshots.
 *
 * With `quotation` it prints a quotation instead (staff detail and the public /q/[token] page): titled "Quotation", with
 * validity, delivery time, advance, the quotation's own terms and who accepted it, and no payment block.
 *
 * With `doc` it prints a proforma invoice, sale order or delivery challan (docs/sales-documents.md): the document's own
 * title, number label, extra header rows, totals rows, footer blocks and terms, all already in the UI's language.
 */
export function InvoiceDocument({
  invoice: inv,
  shopName,
  logoUrl,
  className,
  quotation,
  doc,
}: {
  invoice: Invoice;
  /** Branded name shown next to the logo (falls back to the seller's legal name). */
  shopName?: string | null;
  logoUrl?: string | null;
  className?: string;
  quotation?: QuotationDocMeta;
  doc?: SalesDocMeta;
}) {
  const { t, formatDate } = useI18n();
  const seller = inv.seller ?? {};
  const buyer = inv.customer ?? ({} as Invoice["customer"]);
  const totals = inv.totals;
  const inter = inv.interState;
  const cancelled = inv.status === "cancelled";
  const stamp = quotation ? (["cancelled", "expired", "declined"].includes(quotation.displayStatus) ? quotation.displayStatus : null) : cancelled ? "cancelled" : null;
  const docStamp = doc ? doc.stamp : null;
  const brandName = shopName || seller.legalName || "";
  // Composition taxable person: a Bill of Supply with no tax, from the day the scheme started (Section 10 and Rule 49 CGST).
  const composition = !quotation && !doc && seller.taxScheme === "composition" && (!seller.compositionFrom || inv.date >= seller.compositionFrom);
  const showUpi = !quotation && !doc && !!seller.upiId && inv.balance > 0 && !cancelled && inv.status !== "draft";
  const upi = showUpi
    ? upiLink({
        vpa: seller.upiId!,
        name: seller.legalName || brandName,
        amountPaise: inv.balance,
        note: inv.number ? `${t("billing.doc.invoice")} ${inv.number}` : t("billing.doc.invoice"),
      })
    : null;
  const date = (d: string | null | undefined) => (d ? formatDate(d) : "—");

  return (
    <article
      data-print-area
      className={cn(
        "relative mx-auto w-full max-w-4xl overflow-hidden rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-8",
        className,
      )}
      aria-label={doc ? doc.title : quotation ? t("billing.q.doc.title") : t("billing.doc.taxInvoice")}
    >
      {doc && docStamp && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-7xl font-black tracking-widest text-destructive/15 uppercase select-none sm:text-8xl"
          style={{ transform: "rotate(-24deg)" }}
        >
          {docStamp}
        </div>
      )}
      {!doc && stamp && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-7xl font-black tracking-widest text-destructive/15 uppercase select-none sm:text-8xl"
          style={{ transform: "rotate(-24deg)" }}
        >
          {quotation ? t(`billing.q.status.${stamp}`) : t("billing.status.cancelled")}
        </div>
      )}

      {/* Header: brand + title */}
      <header className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <BrandMark name={brandName} logoUrl={logoUrl} size="lg" nameClassName="text-lg" />
          <div className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
            {seller.legalName && seller.legalName !== brandName && <p className="font-medium text-foreground">{seller.legalName}</p>}
            {seller.address && <p className="whitespace-pre-line">{seller.address}</p>}
            {(seller.city || seller.pincode) && <p>{[seller.city, seller.pincode].filter(Boolean).join(" – ")}</p>}
            {seller.stateCode && (
              <p>
                {t("billing.doc.state")}: {stateLabel(seller.stateCode)}
              </p>
            )}
            {(seller.phone || seller.email) && <p>{[seller.phone, seller.email].filter(Boolean).join(" · ")}</p>}
            {seller.gstin && (
              <p className="font-semibold text-foreground">
                GSTIN: <span className="font-mono">{seller.gstin}</span>
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 sm:text-right">
          <h2 className="font-heading text-xl font-bold tracking-wide text-primary uppercase">
            {doc ? doc.title : quotation ? t("billing.q.doc.title") : composition ? t("billing.doc.compositionBill") : seller.gstin ? t("billing.doc.taxInvoice") : t("billing.doc.billOfSupply")}
          </h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm sm:justify-end">
            <dt className="text-muted-foreground">{doc ? doc.numberLabel : quotation ? t("billing.q.doc.number") : t("billing.doc.number")}</dt>
            <dd className="font-semibold tabular-nums">{inv.number ?? t("billing.status.draft")}</dd>
            {quotation && quotation.rev > 1 && (
              <>
                <dt className="text-muted-foreground">{t("billing.q.doc.revision")}</dt>
                <dd className="tabular-nums">{quotation.rev}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t("billing.doc.date")}</dt>
            <dd className="tabular-nums">{date(inv.date)}</dd>
            {doc?.meta.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </React.Fragment>
            ))}
            {quotation && (
              <>
                <dt className="text-muted-foreground">{t("billing.q.doc.validUntil")}</dt>
                <dd className="font-semibold tabular-nums">{date(quotation.validUntil)}</dd>
              </>
            )}
            {inv.dueDate && !doc && (
              <>
                <dt className="text-muted-foreground">{t("billing.doc.dueDate")}</dt>
                <dd className="tabular-nums">{date(inv.dueDate)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t("billing.doc.placeOfSupply")}</dt>
            <dd>{stateLabel(inv.placeOfSupply)}</dd>
            {!doc && !quotation && inv.exportDetails?.shippingBillNo && (
              <>
                <dt className="text-muted-foreground">{t("billing.export.shippingBillNo")}</dt>
                <dd className="tabular-nums">
                  {inv.exportDetails.shippingBillNo}
                  {inv.exportDetails.shippingBillDate ? ` · ${date(inv.exportDetails.shippingBillDate)}` : ""}
                </dd>
              </>
            )}
            {!doc && !quotation && inv.exportDetails?.portCode && (
              <>
                <dt className="text-muted-foreground">{t("billing.export.portCode")}</dt>
                <dd>{inv.exportDetails.portCode}</dd>
              </>
            )}
            {!doc && !quotation && inv.foreign && (
              <>
                <dt className="text-muted-foreground">{t("billing.export.rate", { cur: inv.foreign.currency })}</dt>
                <dd className="tabular-nums">{inv.foreign.exchangeRate}</dd>
              </>
            )}
          </dl>
        </div>
      </header>
      {/* Export / SEZ declaration (Rule 46) and the frozen LUT */}
      {!doc && !quotation && inv.supplyType && inv.supplyType !== "domestic" && (
        <p className="avoid-break mt-3 rounded-md border border-primary/40 px-3 py-1.5 text-center text-xs font-semibold tracking-wide text-primary uppercase">
          {t(`billing.export.declaration.${inv.supplyType}`)}
          {inv.exportDetails?.lutNumber && (inv.supplyType === "export_wopay" || inv.supplyType === "sez_wopay") && (
            <span className="block font-normal normal-case">{t("billing.export.lut", { no: inv.exportDetails.lutNumber, date: inv.exportDetails.lutDate ? date(inv.exportDetails.lutDate) : "—" })}</span>
          )}
        </p>
      )}

      {/* Buyer */}
      <section className="avoid-break grid gap-1 border-b py-4 text-sm">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{doc ? doc.forLabel : quotation ? t("billing.q.doc.preparedFor") : t("billing.doc.billTo")}</p>
        <p className="font-semibold">{buyer.name || "—"}</p>
        {buyer.address && <p className="text-muted-foreground whitespace-pre-line">{buyer.address}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {buyer.country ? (
            <span>
              {t("billing.gstin.country")}: {countryName(buyer.country) ?? buyer.country}
            </span>
          ) : (
            buyer.stateCode && (
              <span>
                {t("billing.doc.state")}: {stateLabel(buyer.stateCode)}
              </span>
            )
          )}
          {buyer.phone && <span>{buyer.phone}</span>}
          {buyer.email && <span>{buyer.email}</span>}
        </div>
        {buyer.gstin && (
          <p className="text-xs font-semibold">
            GSTIN: <span className="font-mono">{buyer.gstin}</span>
          </p>
        )}
      </section>

      {/* Lines */}
      <section className="-mx-4 overflow-x-auto px-4 py-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-y bg-muted/60 text-left text-xs text-muted-foreground">
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">{t("billing.doc.item")}</th>
              <th className="px-2 py-2 font-medium">{t("billing.doc.hsn")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("billing.doc.qty")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("billing.doc.rate")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("billing.doc.taxable")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("billing.doc.gst")}</th>
              {inter ? (
                <th className="px-2 py-2 text-right font-medium">IGST</th>
              ) : (
                <>
                  <th className="px-2 py-2 text-right font-medium">CGST</th>
                  <th className="px-2 py-2 text-right font-medium">SGST</th>
                </>
              )}
              <th className="px-2 py-2 text-right font-medium">{t("billing.doc.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-b align-top">
                <td className="px-2 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-2 py-2">
                  <div className="font-medium">{l.description}</div>
                  {!!l.batchNo && (
                    <div className="font-mono text-xs text-muted-foreground">
                      {t("billing.batches.pick.label")}: {l.batchNo}
                      {l.expiry ? ` · ${t("billing.batches.pick.exp")}: ${formatDate(l.expiry)}` : ""}
                    </div>
                  )}
                  {!!l.discount && (
                    <div className="text-xs text-muted-foreground">
                      {t("billing.doc.discount")}: −{money(l.discount)}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-xs">{l.hsn || "—"}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                  {qtyFmt.format(l.qty)} {l.unit ?? ""}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{money(l.rate)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(l.taxable)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{pct(l.gstRate)}</td>
                {inter ? (
                  <td className="px-2 py-2 text-right tabular-nums">{money(l.igst)}</td>
                ) : (
                  <>
                    <td className="px-2 py-2 text-right tabular-nums">{money(l.cgst)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(l.sgst)}</td>
                  </>
                )}
                <td className="px-2 py-2 text-right font-medium tabular-nums">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Tax breakup + totals */}
      <section className="avoid-break grid gap-6 sm:grid-cols-[1fr_minmax(16rem,20rem)]">
        <div className="min-w-0 space-y-3">
          {totals.taxBreakup.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("billing.doc.taxBreakup")}</p>
              <table className="w-full min-w-[320px] border-collapse text-xs">
                <thead>
                  <tr className="border-y bg-muted/60 text-left text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">{t("billing.doc.gst")}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t("billing.doc.taxable")}</th>
                    {inter ? (
                      <th className="px-2 py-1.5 text-right font-medium">IGST</th>
                    ) : (
                      <>
                        <th className="px-2 py-1.5 text-right font-medium">CGST</th>
                        <th className="px-2 py-1.5 text-right font-medium">SGST</th>
                      </>
                    )}
                    <th className="px-2 py-1.5 text-right font-medium">{t("billing.doc.totalTax")}</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.taxBreakup.map((b) => (
                    <tr key={b.gstRate} className="border-b">
                      <td className="px-2 py-1.5 tabular-nums">{pct(b.gstRate)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(b.taxable)}</td>
                      {inter ? (
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(b.igst)}</td>
                      ) : (
                        <>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(b.cgst)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(b.sgst)}</td>
                        </>
                      )}
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(b.cgst + b.sgst + b.igst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <p className="text-xs text-muted-foreground">{t("billing.doc.amountInWords")}</p>
            <p className="font-medium">{inv.amountInWords}</p>
          </div>
        </div>

        <dl className="grid content-start gap-1.5 text-sm">
          <TotalRow label={t("billing.totals.subtotal")} value={money(totals.subtotal)} />
          {totals.discount > 0 && <TotalRow label={t("billing.totals.discount")} value={`−${money(totals.discount)}`} />}
          <TotalRow label={t("billing.totals.taxable")} value={money(totals.taxable)} />
          {inter ? (
            <TotalRow label="IGST" value={money(totals.igst)} />
          ) : (
            <>
              <TotalRow label="CGST" value={money(totals.cgst)} />
              <TotalRow label="SGST" value={money(totals.sgst)} />
            </>
          )}
          {totals.roundOff !== 0 && (
            <TotalRow label={t("billing.totals.roundOff")} value={`${totals.roundOff > 0 ? "+" : "−"}${money(Math.abs(totals.roundOff))}`} />
          )}
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-2">
            <dt className="font-semibold">{doc?.totalLabel ?? t("billing.totals.grandTotal")}</dt>
            <dd className="font-heading text-xl font-bold text-primary tabular-nums">{money(totals.total)}</dd>
          </div>
          {!doc && !quotation && inv.foreign && (
            <>
              {inv.foreign.tax > 0 && <TotalRow label={t("billing.export.taxIn", { cur: inv.foreign.currency })} value={formatForeign(inv.foreign.tax, inv.foreign.currency)} />}
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="font-medium">{t("billing.export.totalIn", { cur: inv.foreign.currency })}</dt>
                <dd className="font-semibold tabular-nums">{formatForeign(inv.foreign.total, inv.foreign.currency)}</dd>
              </div>
            </>
          )}
          {doc?.totals.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 text-sm">
              <dt className="font-medium">{k}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
          {quotation && !!quotation.advancePercent && quotation.advanceAmount > 0 && (
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <dt className="font-medium">
                {t("billing.q.doc.advance")} ({quotation.advancePercent}%)
              </dt>
              <dd className="font-semibold tabular-nums">{money(quotation.advanceAmount)}</dd>
            </div>
          )}
          {!!totals.loyalty?.discount && (
            <p className="text-right text-xs text-muted-foreground">
              {t("billing.loyalty.usedOnBill", { amount: money(totals.loyalty.discount), points: totals.loyalty.points })}
            </p>
          )}
          {inv.paid > 0 && !doc && (
            <>
              <TotalRow label={t("billing.totals.paid")} value={money(inv.paid)} />
              <div className="flex items-baseline justify-between gap-4">
                <dt className="font-medium">{t("billing.totals.balance")}</dt>
                <dd className="font-semibold tabular-nums">{money(inv.balance)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {/* Payment details, terms, signature */}
      <section className="avoid-break mt-6 grid gap-6 border-t pt-4 text-xs sm:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-3">
          {(!doc || doc.showBank) && (seller.bankName || seller.accountNumber || seller.ifsc) && (
            <div className="space-y-0.5">
              <p className="font-semibold tracking-wide text-muted-foreground uppercase">{t("billing.doc.bankDetails")}</p>
              {seller.bankName && <p>{seller.bankName}</p>}
              {seller.accountNumber && (
                <p>
                  {t("billing.doc.account")}: <span className="font-mono">{seller.accountNumber}</span>
                </p>
              )}
              {seller.ifsc && (
                <p>
                  IFSC: <span className="font-mono">{seller.ifsc}</span>
                </p>
              )}
              {seller.upiId && (
                <p>
                  UPI: <span className="font-mono">{seller.upiId}</span>
                </p>
              )}
            </div>
          )}
          {doc?.blocks.map((b) => (
            <div key={b.label} className="space-y-0.5">
              <p className="font-semibold tracking-wide text-muted-foreground uppercase">{b.label}</p>
              <p className="whitespace-pre-line">{b.text}</p>
            </div>
          ))}
          {quotation?.deliveryText && (
            <div className="space-y-0.5">
              <p className="font-semibold tracking-wide text-muted-foreground uppercase">{t("billing.q.doc.delivery")}</p>
              <p className="whitespace-pre-line">{quotation.deliveryText}</p>
            </div>
          )}
          {inv.notes && (
            <div className="space-y-0.5">
              <p className="font-semibold tracking-wide text-muted-foreground uppercase">{t("billing.doc.notes")}</p>
              <p className="whitespace-pre-line">{inv.notes}</p>
            </div>
          )}
          {composition && <p className="font-semibold">{t("billing.doc.compositionNote")}</p>}
          {(doc ? doc.terms : quotation ? quotation.terms : seller.terms) && (
            <div className="space-y-0.5">
              <p className="font-semibold tracking-wide text-muted-foreground uppercase">{t("billing.doc.terms")}</p>
              <p className="whitespace-pre-line text-muted-foreground">{doc ? doc.terms : quotation ? quotation.terms : seller.terms}</p>
            </div>
          )}
          {quotation?.acceptedBy && (
            <p className="rounded-md bg-success/10 px-2 py-1.5 font-medium text-success-ink">
              {t("billing.q.doc.acceptedBy", { name: quotation.acceptedBy, date: quotation.acceptedAt ? formatDate(quotation.acceptedAt) : "" })}
            </p>
          )}
          {cancelled && inv.cancelReason && (
            <p className="text-destructive">
              {t("billing.doc.cancelReason")}: {inv.cancelReason}
            </p>
          )}
        </div>
        <div className="flex flex-col items-start gap-4 sm:items-end">
          {upi && (
            <div className="flex items-center gap-3 sm:flex-row-reverse">
              <QrImage value={upi} size={112} alt={t("billing.doc.upiQrAlt", { amount: money(inv.balance) })} />
              <div className="max-w-[10rem] space-y-0.5 sm:text-right">
                <p className="font-semibold">{t("billing.doc.scanToPay")}</p>
                <p className="font-heading text-base font-bold text-primary tabular-nums">{money(inv.balance)}</p>
                <p className="text-muted-foreground">{t("billing.doc.anyUpiApp")}</p>
              </div>
            </div>
          )}
          {doc?.receiverSign && (
            <div className="pt-4 text-center sm:text-right">
              <p className="text-muted-foreground">{doc.receiverSign.text}</p>
              <div className="mt-10 border-t border-dashed pt-1 font-medium">{doc.receiverSign.label}</div>
            </div>
          )}
          <div className="mt-auto pt-8 text-center sm:text-right">
            <p className="text-muted-foreground">{t("billing.doc.forName", { name: seller.legalName || brandName })}</p>
            <div className="mt-10 border-t border-dashed pt-1 font-medium">{t("billing.doc.signatory")}</div>
          </div>
        </div>
      </section>
      <p className="mt-6 text-center text-[0.6875rem] text-muted-foreground">{doc ? doc.note : quotation ? t("billing.q.doc.note") : t("billing.doc.computerGenerated")}</p>
    </article>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
