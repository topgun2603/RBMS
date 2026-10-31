"use client";

import * as React from "react";
import { ImagePlusIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { Button, Field, FieldControl, FieldError, FieldHint, FieldLabel, FieldRow, Input, Progress, Textarea, toast } from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { GSTIN_RE, normalizeId, PHONE_RE } from "../lib/logic";
import { uploadImage } from "../lib/queries";
import type { Vendor } from "../lib/types";
import { VendorLogo } from "./bits";

export interface ProfileDraft {
  name: string;
  description: string;
  logoUrl: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  gstin: string;
  line1: string;
  line2: string;
  city: string;
  stateCode: string;
  pincode: string;
}

export const emptyProfile = (): ProfileDraft => ({
  name: "",
  description: "",
  logoUrl: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  gstin: "",
  line1: "",
  line2: "",
  city: "",
  stateCode: "33",
  pincode: "",
});

export function profileFromVendor(v: Pick<Vendor, "name" | "description" | "logoUrl" | "contactName" | "contactPhone" | "contactEmail" | "gstin" | "address">): ProfileDraft {
  return {
    name: v.name,
    description: v.description ?? "",
    logoUrl: v.logoUrl ?? "",
    contactName: v.contactName ?? "",
    contactPhone: v.contactPhone ?? "",
    contactEmail: v.contactEmail ?? "",
    gstin: v.gstin ?? "",
    line1: v.address?.line1 ?? "",
    line2: v.address?.line2 ?? "",
    city: v.address?.city ?? "",
    stateCode: v.address?.stateCode ?? "33",
    pincode: v.address?.pincode ?? "",
  };
}

const hasAddress = (d: ProfileDraft) => !!(d.line1.trim() || d.city.trim() || d.pincode.trim());

/** Message keys per invalid field. `requireContact`: the apply form needs a contact name and phone. */
export function profileErrors(d: ProfileDraft, requireContact = false): Partial<Record<keyof ProfileDraft, string>> {
  const e: Partial<Record<keyof ProfileDraft, string>> = {};
  if (d.name.trim().length < 2) e.name = "marketplace.validation.name";
  if (requireContact && d.contactName.trim().length < 2) e.contactName = "marketplace.validation.contactName";
  if ((requireContact || d.contactPhone.trim()) && !PHONE_RE.test(d.contactPhone.replace(/[\s-]/g, ""))) e.contactPhone = "marketplace.validation.phone";
  if (d.contactEmail.trim() && !/^\S+@\S+\.\S+$/.test(d.contactEmail.trim())) e.contactEmail = "marketplace.validation.email";
  if (d.gstin.trim() && !GSTIN_RE.test(normalizeId(d.gstin))) e.gstin = "marketplace.validation.gstin";
  if (hasAddress(d)) {
    if (!d.line1.trim()) e.line1 = "marketplace.validation.required";
    if (!d.city.trim()) e.city = "marketplace.validation.required";
    if (!/^[0-9]{2}$/.test(d.stateCode.trim())) e.stateCode = "marketplace.validation.stateCode";
    if (!/^[1-9][0-9]{5}$/.test(d.pincode.trim())) e.pincode = "marketplace.validation.pincode";
  }
  return e;
}

/** API body for PATCH /vendors/:id, PATCH /vendor/profile and POST /public/vendors/apply. Empty strings → null. */
export function profilePatch(d: ProfileDraft): Record<string, unknown> {
  const s = (v: string) => (v.trim() ? v.trim() : null);
  return {
    name: d.name.trim(),
    description: s(d.description),
    logoUrl: s(d.logoUrl),
    contactName: s(d.contactName),
    contactPhone: s(d.contactPhone),
    contactEmail: s(d.contactEmail),
    gstin: d.gstin.trim() ? normalizeId(d.gstin) : null,
    address: hasAddress(d)
      ? { line1: d.line1.trim(), line2: s(d.line2), city: d.city.trim(), stateCode: d.stateCode.trim(), pincode: d.pincode.trim() }
      : null,
  };
}

/** Seller profile fields. `sections` limits which groups show (the apply form skips the address). */
export function ProfileFields({
  value,
  onChange,
  errors,
  requireContact,
  showAddress = true,
  showLogo = true,
}: {
  value: ProfileDraft;
  onChange: (d: ProfileDraft) => void;
  errors: Partial<Record<keyof ProfileDraft, string>>;
  requireContact?: boolean;
  showAddress?: boolean;
  showLogo?: boolean;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<ProfileDraft>) => onChange({ ...value, ...patch });
  const err = (k: keyof ProfileDraft) => (errors[k] ? t(errors[k]!) : null);
  const opt = t("marketplace.common.optional");
  return (
    <div className="grid gap-4">
      {showLogo && <LogoField name={value.name} url={value.logoUrl} onChange={(logoUrl) => set({ logoUrl })} />}
      <Field invalid={!!err("name")}>
        <FieldLabel>{t("marketplace.profile.name")}</FieldLabel>
        <FieldControl>
          <Input value={value.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />
        </FieldControl>
        <FieldHint>{t("marketplace.profile.nameHint")}</FieldHint>
        <FieldError>{err("name")}</FieldError>
      </Field>
      <Field>
        <FieldLabel optional={opt} aside={<span className="tabular-nums">{value.description.length}/2000</span>}>
          {t("marketplace.profile.description")}
        </FieldLabel>
        <FieldControl>
          <Textarea value={value.description} onChange={(e) => set({ description: e.target.value })} rows={4} maxLength={2000} />
        </FieldControl>
        <FieldHint>{t("marketplace.profile.descriptionHint")}</FieldHint>
      </Field>
      <FieldRow>
        <Field invalid={!!err("contactName")}>
          <FieldLabel optional={requireContact ? undefined : opt}>{t("marketplace.profile.contactName")}</FieldLabel>
          <FieldControl>
            <Input value={value.contactName} onChange={(e) => set({ contactName: e.target.value })} autoComplete="name" />
          </FieldControl>
          <FieldError>{err("contactName")}</FieldError>
        </Field>
        <Field invalid={!!err("contactPhone")}>
          <FieldLabel optional={requireContact ? undefined : opt}>{t("marketplace.profile.phone")}</FieldLabel>
          <FieldControl>
            <Input value={value.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} inputMode="tel" autoComplete="tel" />
          </FieldControl>
          <FieldError>{err("contactPhone")}</FieldError>
        </Field>
      </FieldRow>
      <FieldRow>
        <Field invalid={!!err("contactEmail")}>
          <FieldLabel optional={opt}>{t("marketplace.profile.email")}</FieldLabel>
          <FieldControl>
            <Input value={value.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} inputMode="email" autoComplete="email" />
          </FieldControl>
          <FieldError>{err("contactEmail")}</FieldError>
        </Field>
        <Field invalid={!!err("gstin")}>
          <FieldLabel optional={opt}>{t("marketplace.profile.gstin")}</FieldLabel>
          <FieldControl>
            <Input value={value.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} autoCapitalize="characters" />
          </FieldControl>
          <FieldError>{err("gstin")}</FieldError>
        </Field>
      </FieldRow>
      {showAddress && (
        <fieldset className="grid gap-4 rounded-xl border p-3 sm:p-4">
          <legend className="px-1 text-sm font-medium">
            {t("marketplace.profile.address")} <span className="text-xs font-normal text-muted-foreground">({opt})</span>
          </legend>
          <Field invalid={!!err("line1")}>
            <FieldLabel>{t("marketplace.profile.line1")}</FieldLabel>
            <FieldControl>
              <Input value={value.line1} onChange={(e) => set({ line1: e.target.value })} autoComplete="address-line1" />
            </FieldControl>
            <FieldError>{err("line1")}</FieldError>
          </Field>
          <Field>
            <FieldLabel optional={opt}>{t("marketplace.profile.line2")}</FieldLabel>
            <FieldControl>
              <Input value={value.line2} onChange={(e) => set({ line2: e.target.value })} autoComplete="address-line2" />
            </FieldControl>
          </Field>
          <FieldRow cols={3}>
            <Field invalid={!!err("city")}>
              <FieldLabel>{t("marketplace.profile.city")}</FieldLabel>
              <FieldControl>
                <Input value={value.city} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" />
              </FieldControl>
              <FieldError>{err("city")}</FieldError>
            </Field>
            <Field invalid={!!err("stateCode")}>
              <FieldLabel>{t("marketplace.profile.stateCode")}</FieldLabel>
              <FieldControl>
                <Input value={value.stateCode} onChange={(e) => set({ stateCode: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" />
              </FieldControl>
              <FieldHint>{t("marketplace.profile.stateCodeHint")}</FieldHint>
              <FieldError>{err("stateCode")}</FieldError>
            </Field>
            <Field invalid={!!err("pincode")}>
              <FieldLabel>{t("marketplace.profile.pincode")}</FieldLabel>
              <FieldControl>
                <Input value={value.pincode} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" autoComplete="postal-code" />
              </FieldControl>
              <FieldError>{err("pincode")}</FieldError>
            </Field>
          </FieldRow>
        </fieldset>
      )}
    </div>
  );
}

/** Logo upload (uploads API) with a live preview. */
export function LogoField({ name, url, onChange }: { name: string; url: string; onChange: (url: string) => void }) {
  const { t } = useI18n();
  const input = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast.error(t("marketplace.upload.notImage"));
    if (file.size > 5 * 1024 * 1024) return void toast.error(t("marketplace.upload.tooBig"));
    setProgress(0);
    try {
      const f = await uploadImage(file, { purpose: "vendor-logo", onProgress: setProgress });
      onChange(f.url);
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setProgress(null);
    }
  };
  return (
    <Field>
      <FieldLabel htmlFor={null} optional={t("marketplace.common.optional")}>
        {t("marketplace.profile.logo")}
      </FieldLabel>
      <div className="flex items-center gap-3">
        <VendorLogo name={name || "?"} url={url || null} className="size-16 rounded-2xl" />
        <div className="grid flex-1 gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={progress !== null}>
              {progress !== null ? <Loader2Icon className="animate-spin" /> : <ImagePlusIcon />}
              {t(url ? "marketplace.profile.logoChange" : "marketplace.profile.logoUpload")}
            </Button>
            {url && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
                <Trash2Icon /> {t("marketplace.common.remove")}
              </Button>
            )}
          </div>
          {progress !== null && <Progress value={progress} className="h-1.5" />}
          <FieldHint>{t("marketplace.profile.logoHint")}</FieldHint>
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
    </Field>
  );
}
