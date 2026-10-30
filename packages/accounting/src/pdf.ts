import { formatINR } from "@rbms/gst";
import type { ReportTable } from "./reports-logic";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Extra CSS for report tables; the host wraps `body` with the documents module's page() (header, fonts, branding). */
export const REPORT_CSS = `
.rep h1{font-size:15pt;font-weight:700;color:var(--primary)}
.rep .sub{margin-top:2px;font-size:9pt;color:#4b5563}
.rep table{width:100%;border-collapse:collapse;margin-top:12px;font-size:9pt}
.rep th{background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:5px 4px;font-size:8pt;color:#4b5563;text-align:left}
.rep th.r,.rep td.r{text-align:right}
.rep td{border-bottom:1px solid #f3f4f6;padding:4px}
.rep tr.head td{background:#f9fafb;font-weight:700}
.rep tr.total td{border-top:1px solid #9ca3af;font-weight:700}
.rep .notes{margin-top:12px;font-size:8pt;color:#6b7280}
`;

/** A report table as HTML for the PDF renderer. Money cells are paise. */
export function reportBodyHtml(t: ReportTable): string {
  const head = t.columns.map((c) => `<th class="${c.align === "right" || c.kind === "money" ? "r" : ""}">${esc(c.label)}</th>`).join("");
  const rows = t.rows
    .map((r) => {
      const cells = t.columns
        .map((c) => {
          const v = r.cells[c.key] ?? null;
          const text = c.kind === "money" && typeof v === "number" ? formatINR(v) : v === null ? "" : String(v);
          return `<td class="${c.align === "right" || c.kind === "money" ? "r num" : ""}">${esc(text)}</td>`;
        })
        .join("");
      return `<tr class="${r.style && r.style !== "normal" ? r.style : ""}">${cells}</tr>`;
    })
    .join("\n");
  const notes = t.notes?.length ? `<div class="notes">${t.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>` : "";
  return `<section class="rep"><h1>${esc(t.title)}</h1><p class="sub">${esc(t.subtitle)}</p><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>${notes}</section>`;
}
