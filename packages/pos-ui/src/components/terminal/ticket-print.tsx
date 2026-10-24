"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@srirealtime/web";
import { code128Bars } from "../../lib/code128";
import { money } from "../../lib/format";
import type { WeighTicket } from "../../lib/terminal-types";
import { ticketPrintModel } from "../../lib/weigh-ticket";

/** Code 128 as SVG: black bars on white (also on screen, so scanners can read it off a display). */
export function Code128Svg({ value, height = 56, module = 2, className }: { value: string; height?: number; module?: number; className?: string }) {
  const { bars, modules } = React.useMemo(() => code128Bars(value), [value]);
  const quiet = 10;
  const width = (modules + quiet * 2) * module;
  return (
    <svg
      role="img"
      aria-label={value}
      viewBox={`0 0 ${modules + quiet * 2} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={className}
      style={{ background: "#fff", maxWidth: "100%" }}
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x + quiet} y={0} width={b.w} height={height} fill="#000" />
      ))}
    </svg>
  );
}

/**
 * The weigh ticket as printed (58 or 80 mm), rendered off-screen and shown only while printing (the same
 * `data-pos-printing` switch the receipt uses; lib/print.ts printReceiptInPage).
 */
export function TicketPrint({ ticket, shop, terminal, paperMm }: { ticket: WeighTicket | null; shop: string; terminal: string; paperMm: 58 | 80 }) {
  const { t, formatDate } = useI18n();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted || !ticket) return null;
  const m = ticketPrintModel(ticket, {
    shop,
    terminal,
    paperMm,
    time: formatDate(ticket.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    money,
    qty: formatQty3,
    labels: { tare: t("pos.weigh.print.tare"), total: t("pos.weigh.print.total") },
  });
  const css = `
[data-pos-print] { display: none; }
@media print {
  html[data-pos-printing] body * { visibility: hidden !important; }
  html[data-pos-printing] [data-pos-print], html[data-pos-printing] [data-pos-print] * { visibility: visible !important; }
  html[data-pos-printing] [data-pos-print] {
    display: block !important; position: absolute; left: 0; top: 0; width: ${m.widthMm}mm; padding: 2mm ${(m.paperMm - m.widthMm) / 2}mm;
    color: #000; background: #fff; font: ${m.paperMm === 58 ? 10 : 11}px/1.35 ui-monospace, "Noto Sans Mono", monospace;
  }
  html[data-pos-printing] [data-pos-print] hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  @page { size: ${m.paperMm}mm auto; margin: 0; }
}`;
  return createPortal(
    <>
      <style>{css}</style>
      <div data-pos-print="" data-pos-ticket={m.code} aria-hidden>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{m.shop}</div>
          <div>{t("pos.weigh.print.title", { terminal: m.terminal })}</div>
        </div>
        <hr />
        {m.rows.map((r, i) =>
          r.kind === "rule" ? (
            <hr key={i} />
          ) : (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: r.kind === "total" ? 700 : 400, fontSize: r.kind === "detail" ? "0.9em" : undefined, paddingLeft: r.kind === "detail" ? 8 : 0 }}>
              <span>{r.left}</span>
              {r.right && <span>{r.right}</span>}
            </div>
          ),
        )}
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <Code128Svg value={m.code} height={48} module={m.paperMm === 58 ? 1.4 : 2} />
          <div style={{ letterSpacing: 2, fontWeight: 700 }}>{m.code}</div>
          <div>{m.time}</div>
          <div style={{ marginTop: 2 }}>{t("pos.weigh.print.footer")}</div>
        </div>
      </div>
    </>,
    document.body,
  );
}

export const formatQty3 = (q: number) => q.toFixed(3);

