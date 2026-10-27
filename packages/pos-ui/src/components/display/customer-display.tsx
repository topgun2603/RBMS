"use client";

import * as React from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "@srirealtime/ui";
import { DISPLAY_TEXT, type DisplaySlide, type DisplayState } from "../../lib/display";
import { money } from "../../lib/format";
import { QrImage } from "../qr-image";

/**
 * The customer-facing screen: shop logo and name, the bill as the cashier adds it, the total and what the customer
 * saved, a UPI QR while paying by UPI, "Thank you", and an idle screen of offers. Purely a function of the state, so a
 * tablet, a second monitor and a tab on the counter's own PC all show the same thing. Words follow the bill's language.
 */

export interface IdleContent {
  welcomeEn: string;
  welcomeTa: string;
  offerEn: string;
  offerTa: string;
  slides: DisplaySlide[];
  slideSeconds: number;
}

export const NO_IDLE: IdleContent = { welcomeEn: "", welcomeTa: "", offerEn: "", offerTa: "", slides: [], slideSeconds: 8 };

export function CustomerDisplay({ state, idle, brandLogo, offline }: { state: DisplayState; idle: IdleContent; brandLogo: string | null; offline?: boolean }) {
  const w = DISPLAY_TEXT[state.locale];
  const shopName = state.shop?.name ?? "";
  const logo = state.shop?.logoUrl ?? brandLogo;
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground" data-phase={state.phase}>
      <header className="flex items-center gap-4 border-b px-6 py-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- the shop's own logo, any origin
          <img src={logo} alt="" className="h-14 w-auto max-w-[12rem] object-contain" />
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-3xl font-bold">{shopName}</h1>
        {state.customerName && state.phase !== "idle" && <p className="text-xl text-muted-foreground">{w.customer(state.customerName)}</p>}
        {offline && <span className="rounded-full bg-warning/20 px-3 py-1 text-sm text-warning-foreground">{w.offline}</span>}
      </header>
      <main className="min-h-0 flex-1">
        {state.phase === "idle" && <Idle state={state} idle={idle} />}
        {state.phase === "cart" && <Bill state={state} />}
        {state.phase === "pay" && <Pay state={state} />}
        {state.phase === "thanks" && <Thanks state={state} />}
      </main>
    </div>
  );
}

function Bill({ state }: { state: DisplayState }) {
  const w = DISPLAY_TEXT[state.locale];
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [state.lines.length, state.total]);
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(16rem,28rem)]">
      <div className="min-h-0 overflow-y-auto px-6 py-4">
        <table className="w-full text-2xl">
          <thead>
            <tr className="text-left text-base text-muted-foreground">
              <th className="pb-2 font-medium">{w.item}</th>
              <th className="pb-2 text-right font-medium">{w.qty}</th>
              <th className="pb-2 text-right font-medium">{w.amount}</th>
            </tr>
          </thead>
          <tbody>
            {state.more > 0 && (
              <tr>
                <td colSpan={3} className="py-1 text-base text-muted-foreground">
                  {w.more(state.more)}
                </td>
              </tr>
            )}
            {state.lines.map((l, i) => (
              <tr key={`${i}-${l.name}`} className={cn("border-t", i === state.lines.length - 1 && "bg-primary/5 font-semibold")}>
                <td className="py-2 pr-4 align-top">
                  <span className="break-words">{l.name}</span>
                  <span className="block text-base font-normal text-muted-foreground">
                    {money(l.price)} / {l.unit || "pcs"}
                  </span>
                </td>
                <td className="py-2 text-right align-top tabular-nums">{formatQty(l.qty)}</td>
                <td className="py-2 pl-4 text-right align-top tabular-nums">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div ref={endRef} />
      </div>
      <aside className="flex flex-col justify-center gap-4 border-l bg-muted/40 p-8">
        <p className="text-xl text-muted-foreground">{w.items(state.itemCount)}</p>
        <div>
          <p className="text-xl text-muted-foreground">{w.total}</p>
          <p className="text-6xl font-extrabold tabular-nums">{money(state.total)}</p>
        </div>
        {state.savings > 0 && (
          <p className="rounded-xl bg-success/15 px-4 py-3 text-2xl font-semibold text-success">
            {w.saved} {money(state.savings)}
          </p>
        )}
      </aside>
    </div>
  );
}

function Pay({ state }: { state: DisplayState }) {
  const w = DISPLAY_TEXT[state.locale];
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="grid w-full max-w-5xl items-center gap-8 md:grid-cols-2">
        <div className="grid gap-3 text-center md:text-left">
          <p className="text-2xl text-muted-foreground">{w.total}</p>
          <p className="text-7xl font-extrabold tabular-nums">{money(state.total)}</p>
          {state.savings > 0 && (
            <p className="text-2xl font-semibold text-success">
              {w.saved} {money(state.savings)}
            </p>
          )}
        </div>
        {state.upi ? (
          <div className="grid justify-items-center gap-3">
            <QrImage value={state.upi.link} size={340} alt={w.scanToPay} />
            <p className="text-3xl font-bold">
              {w.scanToPay} {money(state.upi.amount)}
            </p>
            <p className="text-lg text-muted-foreground">{w.anyUpi}</p>
          </div>
        ) : (
          <div className="grid justify-items-center gap-2 text-center">
            <p className="text-3xl font-semibold">{w.total}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Thanks({ state }: { state: DisplayState }) {
  const w = DISPLAY_TEXT[state.locale];
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="grid justify-items-center gap-4">
        <span className="grid size-24 place-items-center rounded-full bg-success/15 text-success">
          <CheckIcon className="size-14" />
        </span>
        <p className="text-6xl font-extrabold">{w.thankYou}</p>
        <p className="text-3xl text-muted-foreground">{w.visitAgain}</p>
        {state.paid && state.paid.change > 0 && (
          <p className="mt-4 text-4xl font-semibold tabular-nums">
            {w.change} {money(state.paid.change)}
          </p>
        )}
      </div>
    </div>
  );
}

function Idle({ state, idle }: { state: DisplayState; idle: IdleContent }) {
  const w = DISPLAY_TEXT[state.locale];
  const slides = idle.slides.length ? idle.slides : (state.slides ?? []);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setInterval(() => setN((x) => x + 1), Math.max(3, idle.slideSeconds) * 1000);
    return () => window.clearInterval(id);
  }, [slides.length, idle.slideSeconds]);
  const slide = slides.length ? slides[n % slides.length]! : null;
  const welcome = (state.locale === "ta" ? idle.welcomeTa || idle.welcomeEn : idle.welcomeEn || idle.welcomeTa) || w.welcome;
  const offer = state.locale === "ta" ? idle.offerTa || idle.offerEn : idle.offerEn || idle.offerTa;
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4 p-6">
      <div className="text-center">
        <p className="text-5xl font-extrabold">{welcome}</p>
        {offer && <p className="mt-2 text-3xl text-primary">{offer}</p>}
      </div>
      {slide ? (
        <figure key={n % slides.length} className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] justify-items-center gap-3 animate-in fade-in duration-700">
          {/* eslint-disable-next-line @next/next/no-img-element -- shop photos, any origin */}
          <img src={slide.image} alt="" className="max-h-full min-h-0 w-auto max-w-full rounded-2xl object-contain" />
          <figcaption className="text-center">
            <p className="text-3xl font-semibold">{slide.name}</p>
            {slide.price ? (
              <p className="text-3xl tabular-nums">
                {slide.mrp && slide.mrp > slide.price && <span className="mr-3 text-muted-foreground line-through">{money(slide.mrp)}</span>}
                <span className="font-bold text-primary">{money(slide.price)}</span>
              </p>
            ) : null}
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}

const qtyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const formatQty = (n: number) => qtyFormat.format(n);
