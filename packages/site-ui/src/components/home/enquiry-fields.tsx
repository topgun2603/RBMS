"use client";

import * as React from "react";
import { Label, Textarea } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import type { EnquiryFields, FieldErrors } from "../../lib/sections";
import { FieldError, Optional, TextField } from "../bits";
import { Area, Img, Toggle } from "./section-forms-extra";

/**
 * Editor fields of the enquiry form, shared by the home section and the page block (one component, so the two never
 * drift apart). Name, phone and the privacy line are always on the form; the rest is the owner's choice.
 */
export function EnquiryFieldsEditor({ value, onChange, errors, disabled, idp }: { value: EnquiryFields; onChange: (v: EnquiryFields) => void; errors: FieldErrors; disabled?: boolean; idp: string }) {
  const { t } = useI18n();
  const set = (p: Partial<EnquiryFields>) => onChange({ ...value, ...p });
  const optionsError = errors.options ?? Object.entries(errors).find(([k]) => k.startsWith("options."))?.[1];
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-h`} label={t("site.home.heading")} value={value.heading} maxLength={120} disabled={disabled} error={errors.heading} onChange={(heading) => set({ heading })} />
      <Area id={`${idp}-x`} label={t("site.home.text")} optional value={value.text} rows={2} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => set({ text })} />
      <TextField id={`${idp}-topic`} label={t("site.enquiry.topic")} optional hint={t("site.enquiry.topicHint")} placeholder={t("site.enquiry.topicPlaceholder")} value={value.topic} maxLength={60} disabled={disabled} error={errors.topic} onChange={(topic) => set({ topic })} />
      <Toggle id={`${idp}-stu`} label={t("site.enquiry.askStudent")} hint={t("site.enquiry.askStudentHint")} checked={value.askStudent} onChange={(askStudent) => set({ askStudent })} disabled={disabled} />
      {value.askStudent && (
        <TextField id={`${idp}-stul`} label={t("site.enquiry.studentLabel")} optional placeholder={t("site.enquiry.studentLabelPlaceholder")} value={value.studentLabel} maxLength={40} disabled={disabled} error={errors.studentLabel} onChange={(studentLabel) => set({ studentLabel })} />
      )}
      <div className="grid content-start gap-2">
        <Label htmlFor={`${idp}-opts`}>
          {t("site.enquiry.options")}
          <Optional />
        </Label>
        <Textarea id={`${idp}-opts`} rows={4} value={value.options} disabled={disabled} aria-invalid={!!optionsError} onChange={(e) => set({ options: e.target.value })} />
        <p className="text-meta text-muted-foreground">{t("site.enquiry.optionsHint")}</p>
        <FieldError code={optionsError} />
      </div>
      {value.options.trim() && (
        <TextField id={`${idp}-optl`} label={t("site.enquiry.optionLabel")} optional placeholder={t("site.enquiry.optionLabelPlaceholder")} value={value.optionLabel} maxLength={40} disabled={disabled} error={errors.optionLabel} onChange={(optionLabel) => set({ optionLabel })} />
      )}
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Toggle id={`${idp}-em`} label={t("site.enquiry.askEmail")} checked={value.askEmail} onChange={(askEmail) => set({ askEmail })} disabled={disabled} />
        <Toggle id={`${idp}-msg`} label={t("site.enquiry.askMessage")} checked={value.askMessage} onChange={(askMessage) => set({ askMessage })} disabled={disabled} />
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-sub`} label={t("site.enquiry.submitLabel")} optional placeholder={t("site.enquiry.submitPlaceholder")} value={value.submitLabel} maxLength={40} disabled={disabled} error={errors.submitLabel} onChange={(submitLabel) => set({ submitLabel })} />
        <TextField id={`${idp}-ok`} label={t("site.enquiry.successText")} optional placeholder={t("site.enquiry.successPlaceholder")} value={value.successText} maxLength={300} disabled={disabled} error={errors.successText} onChange={(successText) => set({ successText })} />
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Img label={t("site.enquiry.image")} optional aspect="aspect-[4/3]" value={value.imageUrl} disabled={disabled} error={errors.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
        {value.imageUrl.trim() && (
          <TextField id={`${idp}-alt`} label={t("site.media.alt")} optional hint={t("site.media.altHint")} value={value.imageAlt} maxLength={200} disabled={disabled} error={errors.imageAlt} onChange={(imageAlt) => set({ imageAlt })} />
        )}
      </div>
      <p className="text-meta text-muted-foreground">{t("site.enquiry.alwaysShown")}</p>
    </div>
  );
}
