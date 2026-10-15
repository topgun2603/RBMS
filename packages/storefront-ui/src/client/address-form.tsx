"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { GST_STATES } from "@srirealtime/gst";
import { Button } from "@srirealtime/ui/components/button";
import { cn } from "@srirealtime/ui/lib/utils";
import { normalizeMobile, prettyPhone } from "../lib/format";
import type { Address, AddressInput, PincodeInfo } from "../types";
import { ApiError, call, errorMessage } from "./api";
import { useStore } from "./store-context";

type Fields = Record<keyof AddressInput, string>;

const EMPTY: Fields = { label: "", name: "", phone: "", line1: "", line2: "", landmark: "", city: "", district: "", stateCode: "33", pincode: "" };

/** Address entry with PIN code → city / district / state autofill (/delivery/public/pincode/:pin). Saves to the address book. */
export function AddressForm({
  existing,
  defaults,
  onSaved,
  onCancel,
  submitLabel,
}: {
  existing?: Address | null;
  defaults?: Partial<Fields>;
  onSaved: (a: Address) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const { t } = useStore();
  const id = React.useId();
  const [f, setF] = React.useState<Fields>(() =>
    existing
      ? {
          label: existing.label ?? "",
          name: existing.name,
          phone: prettyPhone(existing.phone),
          line1: existing.line1,
          line2: existing.line2 ?? "",
          landmark: existing.landmark ?? "",
          city: existing.city,
          district: existing.district ?? "",
          stateCode: existing.stateCode,
          pincode: existing.pincode,
        }
      : { ...EMPTY, ...defaults },
  );
  const [errors, setErrors] = React.useState<Partial<Record<keyof Fields, string>>>({});
  const [busy, setBusy] = React.useState(false);
  const [lookup, setLookup] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const lastPin = React.useRef(existing?.pincode ?? "");

  React.useEffect(() => {
    const pin = f.pincode;
    if (!/^[1-9]\d{5}$/.test(pin) || pin === lastPin.current) return;
    lastPin.current = pin;
    setLookup(true);
    call<PincodeInfo>(`/delivery/public/pincode/${pin}`, { auth: false })
      .then((p) => setF((x) => ({ ...x, city: x.city || p.city, district: p.district ?? x.district, stateCode: p.stateCode || x.stateCode })))
      .catch(() => undefined)
      .finally(() => setLookup(false));
  }, [f.pincode]);

  const validate = (): boolean => {
    const e: Partial<Record<keyof Fields, string>> = {};
    if (!f.name.trim()) e.name = t("address.required");
    if (!normalizeMobile(f.phone)) e.phone = t("auth.invalidPhone");
    if (!/^[1-9]\d{5}$/.test(f.pincode)) e.pincode = t("delivery.invalidPin");
    if (!f.line1.trim()) e.line1 = t("address.required");
    if (!f.city.trim()) e.city = t("address.required");
    if (!f.stateCode) e.stateCode = t("address.required");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    const body = {
      label: f.label.trim() || null,
      name: f.name.trim(),
      phone: normalizeMobile(f.phone),
      line1: f.line1.trim(),
      line2: f.line2.trim() || null,
      landmark: f.landmark.trim() || null,
      city: f.city.trim(),
      district: f.district.trim() || null,
      stateCode: f.stateCode,
      pincode: f.pincode,
    };
    try {
      const a = existing ? await call<Address>(`/store/me/addresses/${existing.id}`, { method: "PATCH", body }) : await call<Address>("/store/me/addresses", { body });
      onSaved(a);
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_input" && Array.isArray(err.details)) {
        const fe: Partial<Record<keyof Fields, string>> = {};
        for (const d of err.details as { path?: (string | number)[]; message?: string }[]) {
          const k = d.path?.[d.path.length - 1];
          if (typeof k === "string" && k in EMPTY) fe[k as keyof Fields] = d.message ?? t("address.required");
        }
        setErrors(fe);
      }
      setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, cls?: string) => (
    <div className={cn("grid gap-1.5", cls)}>
      <label htmlFor={`${id}-${k}`} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={`${id}-${k}`}
        value={f[k]}
        onChange={set(k)}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `${id}-${k}-e` : undefined}
        className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-[3px] focus:ring-ring/30 aria-invalid:border-destructive"
        {...props}
      />
      {errors[k] && (
        <p id={`${id}-${k}-e`} className="text-xs text-danger-ink">
          {errors[k]}
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate data-testid="address-form">
      {field("name", t("address.name"), { autoComplete: "name" })}
      {field("phone", t("address.phone"), { type: "tel", inputMode: "numeric", autoComplete: "tel-national", placeholder: "98765 43210" })}
      <div className="relative">
        {field("pincode", t("address.pincode"), { inputMode: "numeric", autoComplete: "postal-code", maxLength: 6, onChange: (e) => setF((x) => ({ ...x, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })) })}
        {lookup && (
          <span className="absolute top-0 right-0 flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" /> {t("address.lookingUp")}
          </span>
        )}
      </div>
      {field("city", t("address.city"), { autoComplete: "address-level2" })}
      {field("line1", t("address.line1"), { autoComplete: "address-line1" }, "sm:col-span-2")}
      {field("line2", t("address.line2"), { autoComplete: "address-line2" }, "sm:col-span-2")}
      {field("landmark", t("address.landmark"))}
      {field("district", t("address.district"))}
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-state`} className="text-sm font-medium">
          {t("address.state")}
        </label>
        <select id={`${id}-state`} value={f.stateCode} onChange={set("stateCode")} autoComplete="address-level1" className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-[3px] focus:ring-ring/30">
          {GST_STATES.filter((s) => s.code !== "97" && s.code !== "96").map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {field("label", t("address.label"), { maxLength: 40 })}
      {formError && (
        <p className="text-sm text-danger-ink sm:col-span-2" role="alert">
          {formError}
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" size="lg" className="h-11 rounded-full px-6" disabled={busy} data-testid="address-save">
          {busy && <Loader2Icon className="animate-spin" />}
          {busy ? t("address.saving") : (submitLabel ?? t("address.save"))}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="lg" className="h-11 rounded-full" onClick={onCancel}>
            {t("address.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}

export function AddressText({ a, className }: { a: Address; className?: string }) {
  const state = GST_STATES.find((s) => s.code === a.stateCode)?.name ?? a.stateCode;
  return (
    <address className={cn("text-sm leading-relaxed not-italic text-foreground/80", className)}>
      <span className="font-semibold text-foreground">{a.name}</span> · {prettyPhone(a.phone)}
      <br />
      {[a.line1, a.line2, a.landmark].filter(Boolean).join(", ")}
      <br />
      {[a.city, a.district && a.district !== a.city ? a.district : null, state].filter(Boolean).join(", ")} – {a.pincode}
    </address>
  );
}
