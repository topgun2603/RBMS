"use client";

import * as React from "react";
import { BanknoteIcon, BookOpenCheckIcon, CheckCheckIcon, MinusIcon, RotateCcwIcon, SmartphoneIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { cn } from "@rbms/ui/lib/utils";
import { useSite } from "../site-context";
import { billMoney, itemOf, SALE_ITEMS, useSale, type PayMode } from "./sale";

/** Words printed on the slip. They follow the slip's own language switch, so an English visitor can see a Tamil bill. */
const SLIP = {
  en: { shop: "KUMAR STORES", town: "Madurai, Tamil Nadu", bill: "Tax invoice", item: "Item", amt: "Amount", taxable: "Taxable value", round: "Round off", total: "TOTAL", paid: { cash: "PAID · CASH", upi: "PAID · UPI", credit: "ON CREDIT" }, empty: "Tap an item to start the bill", thanks: "Thank you. Please visit again." },
  ta: { shop: "குமார் ஸ்டோர்ஸ்", town: "மதுரை, தமிழ்நாடு", bill: "வரி விலைப்பட்டியல்", item: "பொருள்", amt: "தொகை", taxable: "வரிக்குட்பட்ட தொகை", round: "முழுமையாக்கல்", total: "மொத்தம்", paid: { cash: "பணம் பெற்றது", upi: "UPI பெற்றது", credit: "கடன் கணக்கில்" }, empty: "பில் தொடங்க ஒரு பொருளைத் தட்டுங்கள்", thanks: "நன்றி. மீண்டும் வருக." },
} as const;

const PAY: { mode: PayMode; icon: React.ReactNode; key: string }[] = [
  { mode: "cash", icon: <BanknoteIcon />, key: "home.pay.cash" },
  { mode: "upi", icon: <SmartphoneIcon />, key: "home.pay.upi" },
  { mode: "credit", icon: <BookOpenCheckIcon />, key: "home.pay.credit" },
];

/** A working counter: tap items, a thermal slip prints with the real GST split, Pay stamps it and the WhatsApp receipt arrives. */
export function SaleCounter() {
  const { t, locale } = useSite();
  const sale = useSale();
  const reduced = useReducedMotionSafe();
  const [lang, setLang] = React.useState<"en" | "ta">(locale === "ta" ? "ta" : "en");
  React.useEffect(() => setLang(locale === "ta" ? "ta" : "en"), [locale]);

  // The opening demo: one more item prints, then it is paid. Stops the moment the visitor touches anything.
  const { touched, add, pay } = sale;
  const demo = React.useRef({ add, pay });
  demo.current = { add, pay };
  React.useEffect(() => {
    if (reduced || touched) return;
    const a = window.setTimeout(() => demo.current.add("milk", "demo"), 2400);
    const b = window.setTimeout(() => demo.current.pay("upi", "demo"), 4200);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [reduced, touched]);

  const words = SLIP[lang];
  const name = (id: string) => itemOf(id)[lang];
  const { totals } = sale;
  const hasLines = sale.lines.length > 0;

  return (
    <div className="relative mx-auto w-full max-w-[30rem]" data-testid="sale-counter" role="group" aria-label={t("home.counter.label")}>
      <div className="relative z-10 rounded-[1.75rem] bg-ink p-4 text-paper shadow-[0_30px_60px_-24px_oklch(0.2_0.03_50/0.65)] sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-mono text-xs tracking-wide text-paper/75">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-turmeric opacity-70 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-turmeric" />
            </span>
            {t("home.counter.title")}
          </p>
          <div className="flex rounded-full bg-paper/10 p-0.5 text-[11px] font-semibold" role="group" aria-label={t("home.counter.slipLang")}>
            {(["en", "ta"] as const).map((l) => (
              <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)} className={cn("min-h-7 rounded-full px-2.5 transition-colors focus-ring", lang === l ? "bg-paper text-ink" : "text-paper/75 hover:text-paper")} data-testid={`slip-lang-${l}`}>
                {l === "en" ? "EN" : "தமிழ்"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SALE_ITEMS.map((item) => (
            <motion.button
              key={item.id}
              type="button"
              whileTap={reduced ? undefined : { scale: 0.95 }}
              onClick={() => sale.add(item.id)}
              className="flex min-h-[4.5rem] flex-col justify-between rounded-xl bg-paper/[0.08] p-2.5 text-left transition-colors hover:bg-paper/[0.16] focus-ring"
              data-testid={`item-${item.id}`}
            >
              <span className="text-xs leading-snug font-medium" lang={lang}>{item[lang]}</span>
              <span className="mt-1.5 flex items-center justify-between gap-1 font-mono text-[11px]">
                <span>{billMoney(item.price).replace(".00", "")}</span>
                <span className="rounded bg-turmeric/20 px-1 text-turmeric">{item.gstRate}%</span>
              </span>
            </motion.button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {PAY.map((p) => (
            <button
              key={p.mode}
              type="button"
              disabled={!hasLines}
              aria-pressed={sale.paid === p.mode}
              onClick={() => sale.pay(p.mode)}
              className={cn("flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-1 text-xs font-bold transition-colors focus-ring disabled:opacity-40 sm:text-sm [&_svg]:size-4", sale.paid === p.mode ? "bg-turmeric text-ink" : "bg-kungumam text-white hover:brightness-110")}
              data-testid={`pay-${p.mode}`}
            >
              {p.icon}
              {t(p.key)}
            </button>
          ))}
        </div>

        {/* The slot the slip prints from. */}
        <div className="mt-4 h-2.5 rounded-full bg-black shadow-[inset_0_1px_3px_oklch(0_0_0/0.9),0_1px_0_oklch(1_0_0/0.12)]" aria-hidden="true" />
      </div>

      <div className="relative -mt-4 overflow-hidden px-4 sm:px-7">
        <div className="receipt-print receipt-edge relative bg-[oklch(0.985_0.012_90)] px-4 pt-8 pb-7 font-mono text-[12px] leading-relaxed text-[oklch(0.2_0.02_60)] drop-shadow-sm sm:px-5" lang={lang} data-testid="receipt">
          <p className="text-sm font-bold">{words.shop}</p>
          <p className="text-[11px] opacity-70">{words.town}</p>
          <p className="mt-1 text-[11px] opacity-70">
            {words.bill} · #{sale.billNo}
          </p>
          <div className="my-2 border-t border-dashed border-current/40" />
          <div className="flex justify-between text-[11px] opacity-70">
            <span>{words.item}</span>
            <span>{words.amt}</span>
          </div>

          <ul aria-live="polite">
            <AnimatePresence initial={false}>
              {sale.lines.map((l) => (
                <motion.li key={l.id} initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduced ? undefined : { height: 0, opacity: 0 }} transition={{ duration: 0.28 }} className="overflow-hidden">
                  <div className="group flex items-start justify-between gap-2 py-0.5">
                    <span className="min-w-0">
                      {name(l.id)}
                      <span className="block text-[11px] opacity-65">
                        {l.qty} × {billMoney(itemOf(l.id).price)} · GST {itemOf(l.id).gstRate}%
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                      {billMoney(itemOf(l.id).price * l.qty)}
                      {!sale.paid && (
                        <button type="button" onClick={() => sale.remove(l.id)} aria-label={`${t("home.counter.remove")}: ${name(l.id)}`} className="-my-1 flex size-6 items-center justify-center rounded-full opacity-60 hover:bg-black/10 hover:opacity-100 focus-ring [&_svg]:size-3">
                          <MinusIcon />
                        </button>
                      )}
                    </span>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {!hasLines && <p className="py-4 text-center opacity-70">{words.empty}</p>}

          {hasLines && (
            <>
              <div className="my-2 border-t border-dashed border-current/40" />
              <table className="w-full text-[11px]">
                <thead className="opacity-70">
                  <tr>
                    <th className="text-left font-normal">GST</th>
                    <th className="text-right font-normal">{words.taxable}</th>
                    <th className="text-right font-normal">CGST</th>
                    <th className="text-right font-normal">SGST</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {totals.taxBreakup.map((r) => (
                    <tr key={r.gstRate} data-rate={r.gstRate}>
                      <td>{r.gstRate}%</td>
                      <td className="text-right">{billMoney(r.taxable).slice(1)}</td>
                      <td className="text-right">{billMoney(r.cgst).slice(1)}</td>
                      <td className="text-right">{billMoney(r.sgst).slice(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totals.roundOff !== 0 && (
                <p className="mt-1 flex justify-between text-[11px] opacity-70">
                  <span>{words.round}</span>
                  <span>{billMoney(totals.roundOff)}</span>
                </p>
              )}
              <div className="my-2 border-t border-dashed border-current/40" />
              <p className="flex items-baseline justify-between text-base font-bold">
                <span>{words.total}</span>
                <span data-testid="receipt-total">{billMoney(totals.total)}</span>
              </p>
              <p className="mt-2 text-center text-[11px] opacity-70">{words.thanks}</p>
            </>
          )}

          <AnimatePresence>
            {sale.paid && (
              <motion.p
                key={sale.paid}
                initial={reduced ? false : { scale: 2.1, opacity: 0, rotate: -4 }}
                animate={{ scale: 1, opacity: 1, rotate: -11 }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
                transition={{ type: "spring", stiffness: 420, damping: 20 }}
                className="pointer-events-none absolute top-10 right-3 rounded-md border-[3px] border-kungumam px-2 py-0.5 text-sm font-bold tracking-wide text-kungumam"
                data-testid="receipt-stamp"
              >
                {words.paid[sale.paid]}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {sale.paid && hasLines && (
          <motion.div initial={reduced ? false : { opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ delay: reduced ? 0 : 0.45, type: "spring", stiffness: 300, damping: 24 }} className="relative z-10 -mt-1 ml-auto w-[88%] rounded-2xl rounded-br-sm bg-[#d9fdd3] px-3.5 py-2.5 text-[13px] text-[#111b21] shadow-lg" data-testid="whatsapp-receipt">
            <p className="text-[11px] font-bold text-[#128c7e]">{t("home.counter.waFrom")}</p>
            <p>{t(sale.paid === "credit" ? "home.counter.waCredit" : "home.counter.waPaid", { no: sale.billNo, total: billMoney(totals.total) })}</p>
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
              <CheckCheckIcon className="size-3.5 text-[#53bdeb]" aria-hidden="true" />
              {t("home.counter.waSent")}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("home.counter.note")}</p>
        <button type="button" onClick={sale.newBill} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-foreground px-3 text-xs font-bold transition-colors hover:bg-foreground hover:text-background focus-ring [&_svg]:size-3.5" data-testid="new-bill">
          <RotateCcwIcon />
          {t("home.counter.new")}
        </button>
      </div>
    </div>
  );
}
