"use client";

import * as React from "react";
import { BellRingIcon, BookOpenCheckIcon, BoxesIcon, CheckIcon, LandmarkIcon, MessageCircleIcon, ScaleIcon, WalletCardsIcon } from "lucide-react";
import { motion, useInView, useReducedMotionSafe } from "@rbms/ui/motion";
import { cn } from "@rbms/ui/lib/utils";
import { useSite } from "../site-context";
import { Container } from "../sections";
import { Kolam } from "./kolam";
import { billMoney, itemOf, LOW_STOCK, useSale } from "./sale";

const JOBS = [
  { key: "stock", icon: <BoxesIcon /> },
  { key: "whatsapp", icon: <MessageCircleIcon /> },
  { key: "credit", icon: <BookOpenCheckIcon /> },
  { key: "gst", icon: <LandmarkIcon /> },
  { key: "books", icon: <ScaleIcon /> },
  { key: "till", icon: <WalletCardsIcon /> },
] as const;
type JobKey = (typeof JOBS)[number]["key"];

/** Sample opening figures the panels add this bill to. */
const CREDIT_OPENING = 124000;
const TILL_OPENING = 200000;
const TILL_CASH_TODAY = 834000;
const TILL_UPI_TODAY = 1126000;

function Row({ label, value, strong, flag, testId }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; flag?: React.ReactNode; testId?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 border-b border-dashed border-foreground/25 py-2 last:border-0", strong && "text-base font-bold")}>
      <span className="min-w-0">
        {label}
        {flag}
      </span>
      <span className="shrink-0 font-mono tabular-nums" data-testid={testId}>{value}</span>
    </div>
  );
}

function Panel({ job }: { job: JobKey }) {
  const { t, locale } = useSite();
  const sale = useSale();
  const { totals, lines } = sale;
  const mode = sale.paid ?? "upi";
  const lang = locale === "ta" ? "ta" : "en";
  const tax = totals.cgst + totals.sgst + totals.igst;

  if (job === "stock") {
    if (!lines.length) return <p className="py-3 text-sm text-muted-foreground">{t("home.job.empty")}</p>;
    return (
      <div className="text-sm">
        {lines.map((l) => {
          const item = itemOf(l.id);
          const after = item.stock - l.qty;
          return (
            <Row
              key={l.id}
              label={item[lang]}
              value={
                <>
                  <span className="opacity-50 line-through">{item.stock}</span> → <b>{after}</b>
                </>
              }
              flag={after <= LOW_STOCK ? <span className="ml-2 inline-block rounded bg-kungumam px-1.5 py-0.5 text-[10px] font-bold text-white">{t("home.job.stock.low")}</span> : null}
              testId={`stock-${l.id}`}
            />
          );
        })}
      </div>
    );
  }
  if (job === "whatsapp") {
    return (
      <div className="rounded-xl bg-[#efeae2] p-3 text-[13px] text-[#111b21]">
        <div className="ml-auto max-w-[90%] rounded-xl rounded-br-sm bg-[#d9fdd3] px-3 py-2 shadow-sm">
          <p>{t(mode === "credit" ? "home.counter.waCredit" : "home.counter.waPaid", { no: sale.billNo, total: billMoney(totals.total) })}</p>
          <p className="mt-1.5 rounded-lg bg-white/70 px-2 py-1.5 text-xs font-semibold">📄 {t("home.job.whatsapp.file", { no: sale.billNo })}</p>
        </div>
      </div>
    );
  }
  if (job === "credit") {
    const onCredit = mode === "credit";
    const balance = CREDIT_OPENING + (onCredit ? totals.total : 0);
    return (
      <div className="text-sm">
        <Row label={t("home.job.credit.before")} value={billMoney(CREDIT_OPENING)} />
        <Row label={t("home.job.credit.bill", { no: sale.billNo })} value={onCredit ? `+ ${billMoney(totals.total)}` : t("home.job.credit.paid")} />
        <Row strong label={t("home.job.credit.balance")} value={billMoney(balance)} testId="credit-balance" />
        <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#d9fdd3] px-3 py-1.5 text-xs font-semibold text-[#075e54]">
          <BellRingIcon className="size-3.5" aria-hidden="true" />
          {t("home.job.credit.remind")}
        </p>
        {!onCredit && <p className="mt-2 text-xs text-muted-foreground">{t("home.job.credit.try")}</p>}
      </div>
    );
  }
  if (job === "gst") {
    return (
      <div className="text-sm">
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-xs tabular-nums">
            <thead>
              <tr className="border-b-[1.5px] border-foreground text-left">
                <th className="py-1.5 pr-2 font-semibold">GST</th>
                <th className="py-1.5 text-right font-semibold">{t("home.job.gst.taxable")} ₹</th>
                <th className="py-1.5 pl-2 text-right font-semibold">CGST ₹</th>
                <th className="py-1.5 pl-2 text-right font-semibold">SGST ₹</th>
              </tr>
            </thead>
            <tbody>
              {totals.taxBreakup.map((r) => (
                <tr key={r.gstRate} className="border-b border-dashed border-foreground/25">
                  <td className="py-1.5 pr-2">{r.gstRate}%</td>
                  <td className="py-1.5 text-right">{billMoney(r.taxable).slice(1)}</td>
                  <td className="py-1.5 pl-2 text-right">{billMoney(r.cgst).slice(1)}</td>
                  <td className="py-1.5 pl-2 text-right">{billMoney(r.sgst).slice(1)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-1.5 pr-2">{t("home.job.gst.total")}</td>
                <td className="py-1.5 text-right">{billMoney(totals.taxable).slice(1)}</td>
                <td className="py-1.5 pl-2 text-right">{billMoney(totals.cgst).slice(1)}</td>
                <td className="py-1.5 pl-2 text-right">{billMoney(totals.sgst).slice(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex flex-wrap gap-1.5 text-xs font-bold">
          {["GSTR-1", "GSTR-3B", "HSN"].map((f) => (
            <span key={f} className="rounded-md border-[1.5px] border-foreground px-2 py-0.5">{f} ✓</span>
          ))}
        </p>
      </div>
    );
  }
  if (job === "books") {
    const received = t(mode === "cash" ? "home.job.books.cash" : mode === "upi" ? "home.job.books.bank" : "home.job.books.debtor");
    return (
      <div className="font-mono text-xs tabular-nums">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b-[1.5px] border-foreground py-1.5 font-semibold">
          <span>{t("home.job.books.account")}</span>
          <span className="text-right">Dr</span>
          <span className="text-right">Cr</span>
        </div>
        {[
          { a: received, dr: totals.total, cr: 0 },
          { a: t("home.job.books.sales"), dr: 0, cr: totals.taxable },
          { a: "Output CGST", dr: 0, cr: totals.cgst },
          { a: "Output SGST", dr: 0, cr: totals.sgst },
          ...(totals.roundOff ? [{ a: t("home.job.books.round"), dr: totals.roundOff < 0 ? -totals.roundOff : 0, cr: totals.roundOff > 0 ? totals.roundOff : 0 }] : []),
        ].map((r) => (
          <div key={r.a} className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-dashed border-foreground/25 py-1.5">
            <span className="min-w-0 font-sans">{r.a}</span>
            <span className="text-right">{r.dr ? billMoney(r.dr).slice(1) : "—"}</span>
            <span className="text-right">{r.cr ? billMoney(r.cr).slice(1) : "—"}</span>
          </div>
        ))}
        <p className="mt-3 font-sans text-xs text-muted-foreground">{t("home.job.books.tax", { tax: billMoney(tax) })}</p>
      </div>
    );
  }
  const cash = TILL_CASH_TODAY + (mode === "cash" ? totals.total : 0);
  const upi = TILL_UPI_TODAY + (mode === "upi" ? totals.total : 0);
  return (
    <div className="text-sm">
      <Row label={t("home.job.till.open")} value={billMoney(TILL_OPENING)} />
      <Row label={t("home.job.till.cash")} value={billMoney(cash)} />
      <Row strong label={t("home.job.till.drawer")} value={billMoney(TILL_OPENING + cash)} testId="till-drawer" />
      <Row label={t("home.job.till.upi")} value={billMoney(upi)} />
    </div>
  );
}

function Job({ job, index, onActive, icon }: { job: JobKey; index: number; onActive: (i: number) => void; icon: React.ReactNode }) {
  const { t } = useSite();
  const ref = React.useRef<HTMLLIElement>(null);
  const active = useInView(ref, { margin: "-45% 0px -45% 0px" });
  React.useEffect(() => {
    if (active) onActive(index);
  }, [active, index, onActive]);
  return (
    <li ref={ref} className="flex min-h-[auto] flex-col justify-center py-5 lg:min-h-[78vh]" data-job={job}>
      <motion.article animate={{ opacity: active ? 1 : 0.55 }} transition={{ duration: 0.25 }} className="rounded-2xl border-[1.5px] border-foreground bg-card p-5 shadow-[6px_6px_0_var(--foreground)] motion-reduce:!opacity-100 max-lg:!opacity-100 sm:p-7">
        <p className="mb-3 flex items-center gap-2 font-mono text-xs font-semibold text-primary [&_svg]:size-4">
          {icon}
          {t("home.job.count", { n: index + 1 })}
        </p>
        <h3 className="text-h3-poster">{t(`home.job.${job}.title`)}</h3>
        <p className="mt-2 mb-5 max-w-xl text-pretty text-muted-foreground">{t(`home.job.${job}.body`)}</p>
        <Panel job={job} />
      </motion.article>
    </li>
  );
}

/** "That one bill just did six jobs": the bill from the hero counter, followed through the shop. */
export function RippleSection() {
  const { t } = useSite();
  const sale = useSale();
  const reduced = useReducedMotionSafe();
  const [active, setActive] = React.useState(0);
  return (
    <section className="section-y relative" aria-labelledby="ripple-title" data-testid="ripple">
      <Container className="grid gap-10 [&>*]:min-w-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:sticky lg:top-20 lg:h-[calc(100dvh-6rem)] lg:self-start lg:py-6">
          <p className="mb-4 font-mono text-xs font-semibold tracking-wide text-primary">{t("home.ripple.eyebrow", { no: sale.billNo, total: billMoney(sale.totals.total) })}</p>
          <h2 id="ripple-title" className="text-poster-md">{t("home.ripple.title")}</h2>
          <p className="mt-4 max-w-md text-pretty text-muted-foreground">{t("home.ripple.body")}</p>
          <ol className="mt-7 hidden gap-1 lg:grid">
            {JOBS.map((j, i) => (
              <li key={j.key} className={cn("flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors", i === active ? "bg-foreground text-background" : i < active ? "text-foreground" : "text-muted-foreground")} aria-current={i === active ? "step" : undefined}>
                <span className={cn("flex size-5 items-center justify-center rounded-full border-[1.5px] border-current text-[10px] [&_svg]:size-3", i < active && "border-primary bg-primary text-primary-foreground")}>
                  {i < active ? (
                    <motion.span initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }}>
                      <CheckIcon />
                    </motion.span>
                  ) : (
                    i + 1
                  )}
                </span>
                {t(`home.job.${j.key}.short`)}
              </li>
            ))}
          </ol>
          <Kolam cols={7} rows={3} strokeWidth={2.5} className="mt-7 hidden w-full max-w-sm text-primary lg:block [@media(max-height:880px)]:lg:hidden" />
        </div>
        <ol>
          {JOBS.map((j, i) => (
            <Job key={j.key} job={j.key} index={i} icon={j.icon} onActive={setActive} />
          ))}
          <li className="pt-4 text-xs text-muted-foreground">{t("home.ripple.fine")}</li>
        </ol>
      </Container>
    </section>
  );
}
