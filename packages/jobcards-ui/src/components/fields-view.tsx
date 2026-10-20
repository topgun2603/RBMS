"use client";

import * as React from "react";
import { DetailRow, tOr, useI18n } from "@srirealtime/web";
import { power } from "../lib/format";
import { EYES, RX_FIELDS } from "../lib/templates";
import type { JobTemplate } from "../lib/types";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** A job's template details, read-only (detail page and the printed job sheet). */
export function FieldsView({ template, fields }: { template: JobTemplate; fields: Record<string, unknown> }) {
  const { t, formatDate } = useI18n();
  const f = fields ?? {};
  const row = (label: string, value: React.ReactNode) => (value ? <DetailRow label={label}>{value}</DetailRow> : null);

  if (template === "device") {
    const acc = Array.isArray(f.accessories) ? (f.accessories as unknown[]).filter((a): a is string => typeof a === "string") : [];
    return (
      <div className="divide-y">
        {row(t("jobcards.fields.brand"), str(f.brand))}
        {row(t("jobcards.fields.model"), str(f.model))}
        {row(t("jobcards.fields.serial"), str(f.serial) && <span className="font-mono">{str(f.serial)}</span>)}
        {row(t("jobcards.fields.issue"), str(f.issue))}
        {row(t("jobcards.fields.accessories"), acc.length ? acc.join(", ") : t("jobcards.fields.none"))}
        {row(t("jobcards.fields.condition"), str(f.condition))}
      </div>
    );
  }

  if (template === "garment") {
    const m = rec(f.measurements);
    const unit = f.unit === "cm" ? t("jobcards.fields.cm") : t("jobcards.fields.inches");
    const type = str(f.garmentType);
    return (
      <div className="grid gap-3">
        <div className="divide-y">
          {row(t("jobcards.fields.garmentType"), str(f.garmentName) ?? (type ? tOr(t, `jobcards.garment.${type}`, type) : null))}
          {row(t("jobcards.fields.fabricReceived"), f.fabricReceived ? t("jobcards.common.yes") : t("jobcards.common.no"))}
          {row(t("jobcards.fields.style"), str(f.style))}
          {row(t("jobcards.fields.trialDate"), str(f.trialDate) && formatDate(str(f.trialDate)!))}
        </div>
        {Object.keys(m).length > 0 && (
          <div>
            <p className="mb-2 text-meta font-medium text-muted-foreground">
              {t("jobcards.fields.measurements")} ({unit})
            </p>
            <dl className="avoid-break grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              {Object.entries(m).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-dashed py-1">
                  <dt className="text-muted-foreground">{tOr(t, `jobcards.measure.${k}`, k)}</dt>
                  <dd className="font-medium tabular-nums">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    );
  }

  if (template === "eyewear") {
    const lens = str(f.lensType);
    return (
      <div className="grid gap-3">
        <div className="overflow-x-auto">
          <table className="avoid-break w-full min-w-[20rem] text-sm">
            <caption className="sr-only">{t("jobcards.fields.prescription")}</caption>
            <thead>
              <tr className="border-b text-meta text-muted-foreground">
                <th className="py-1 text-left font-medium">{t("jobcards.rx.eye")}</th>
                {RX_FIELDS.map((k) => (
                  <th key={k} scope="col" className="py-1 text-right font-medium">
                    {t(`jobcards.rx.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EYES.map((eye) => {
                const e = rec(f[eye]);
                return (
                  <tr key={eye} className="border-b last:border-0">
                    <th scope="row" className="py-1.5 text-left font-semibold">
                      {t(`jobcards.rx.${eye}`)}
                    </th>
                    {RX_FIELDS.map((k) => (
                      <td key={k} className="py-1.5 text-right tabular-nums">
                        {k === "axis" ? (typeof e.axis === "number" ? `${e.axis}°` : "—") : power(e[k]) || "—"}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="divide-y">
          {row(t("jobcards.rx.pd"), typeof f.pd === "number" ? `${f.pd} mm` : null)}
          {row(t("jobcards.fields.lensType"), lens && tOr(t, `jobcards.lens.${lens}`, lens))}
          {row(t("jobcards.fields.coating"), str(f.coating))}
          {row(t("jobcards.fields.frame"), str(f.frame))}
        </div>
      </div>
    );
  }

  return <p className="text-sm whitespace-pre-wrap">{str(f.description) ?? "—"}</p>;
}
