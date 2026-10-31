"use client";

import * as React from "react";
import { PlusIcon, XIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@rbms/ui";
import { DesignNotesButton, DeviceLabelButton, FaultNoteButton, MeasurementSheetButton, tOr, useI18n } from "@rbms/web";
import {
  APPLIANCE_KINDS,
  EYES,
  FUEL_LEVELS,
  GARMENT_MEASUREMENTS,
  GARMENT_TYPES,
  LAUNDRY_GARMENTS,
  LAUNDRY_SERVICES,
  LENS_TYPES,
  RX_FIELDS,
  VEHICLE_SERVICE_TYPES,
  type ApplianceDraft,
  type DeviceDraft,
  type EyewearDraft,
  type FieldError as FieldProblem,
  type FieldsDraft,
  type GarmentDraft,
  type GarmentType,
  type LaundryDraft,
  type VehicleDraft,
} from "../lib/templates";
import type { JobTemplate } from "../lib/types";

interface FormProps {
  template: JobTemplate;
  draft: FieldsDraft;
  onChange: (d: FieldsDraft) => void;
  /** The problem to show (after a submit). */
  error?: FieldProblem | null;
}

/** The template's own inputs: device, garment (measurement grid), eyewear (Rx grid) or a description. */
export function FieldsForm({ template, draft, onChange, error }: FormProps) {
  const { t } = useI18n();
  const msg = error ? t(`jobcards.fields.error.${error}`) : null;
  if (template === "device") return <DeviceForm value={draft.device} onChange={(device) => onChange({ ...draft, device })} error={error} msg={msg} />;
  if (template === "garment") return <GarmentForm value={draft.garment} onChange={(garment) => onChange({ ...draft, garment })} msg={error === "measurement" ? msg : null} />;
  if (template === "eyewear") return <EyewearForm value={draft.eyewear} onChange={(eyewear) => onChange({ ...draft, eyewear })} msg={msg} />;
  if (template === "vehicle") return <VehicleForm value={draft.vehicle} onChange={(vehicle) => onChange({ ...draft, vehicle })} error={error} msg={msg} />;
  if (template === "laundry") return <LaundryForm value={draft.laundry} onChange={(laundry) => onChange({ ...draft, laundry })} error={error} msg={msg} />;
  if (template === "appliance") return <ApplianceForm value={draft.appliance} onChange={(appliance) => onChange({ ...draft, appliance })} error={error} msg={msg} />;
  return (
    <Field invalid={error === "description"}>
      <FieldLabel>{t("jobcards.fields.description")}</FieldLabel>
      <FieldControl>
        <Textarea rows={3} maxLength={2000} value={draft.general.description} onChange={(e) => onChange({ ...draft, general: { description: e.target.value } })} />
      </FieldControl>
      <FieldError>{error === "description" ? msg : null}</FieldError>
    </Field>
  );
}

function DeviceForm({ value, onChange, error, msg }: { value: DeviceDraft; onChange: (v: DeviceDraft) => void; error?: FieldProblem | null; msg: string | null }) {
  const { t } = useI18n();
  const set = (patch: Partial<DeviceDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-2" data-testid="jobcards-ai-device">
        <DeviceLabelButton
          forWhat="jobcard"
          onApply={(fill) => {
            const ids = [fill.imei1, fill.imei2, fill.serial].filter((x): x is string => !!x);
            set({ ...(fill.brand ? { brand: fill.brand } : {}), ...(fill.model ? { model: fill.model } : {}), ...(ids.length ? { serial: ids.join(" / ").slice(0, 60) } : {}) });
          }}
        />
        <FaultNoteButton complaint={value.issue} brand={value.brand} model={value.model} onApply={(note) => set({ issue: (value.issue.trim() ? `${value.issue.trim()}

${note}` : note).slice(0, 1000) })} />
      </div>
      <FieldRow cols={3}>
        <Field>
          <FieldLabel>{t("jobcards.fields.brand")}</FieldLabel>
          <FieldControl>
            <Input maxLength={60} value={value.brand} onChange={(e) => set({ brand: e.target.value })} />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>{t("jobcards.fields.model")}</FieldLabel>
          <FieldControl>
            <Input maxLength={80} value={value.model} onChange={(e) => set({ model: e.target.value })} />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>{t("jobcards.fields.serial")}</FieldLabel>
          <FieldControl>
            <Input maxLength={60} value={value.serial} onChange={(e) => set({ serial: e.target.value })} />
          </FieldControl>
        </Field>
      </FieldRow>
      <Field invalid={error === "issue"}>
        <FieldLabel>{t("jobcards.fields.issue")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} maxLength={1000} value={value.issue} onChange={(e) => set({ issue: e.target.value })} />
        </FieldControl>
        <FieldError>{error === "issue" ? msg : null}</FieldError>
      </Field>
      <Field>
        <FieldLabel>{t("jobcards.fields.accessories")}</FieldLabel>
        <FieldControl>
          <Input maxLength={600} value={value.accessories} placeholder={t("jobcards.fields.accessoriesHint")} onChange={(e) => set({ accessories: e.target.value })} />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>{t("jobcards.fields.condition")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} maxLength={500} value={value.condition} onChange={(e) => set({ condition: e.target.value })} />
        </FieldControl>
        <FieldHint>{t("jobcards.fields.noPasscode")}</FieldHint>
      </Field>
    </div>
  );
}

function GarmentForm({ value, onChange, msg }: { value: GarmentDraft; onChange: (v: GarmentDraft) => void; msg: string | null }) {
  const { t } = useI18n();
  const [custom, setCustom] = React.useState("");
  const set = (patch: Partial<GarmentDraft>) => onChange({ ...value, ...patch });
  const pickType = (type: GarmentType) => {
    // Keep what was typed for measurements both garments share.
    const typed = new Map(value.measurements.filter((m) => m.value.trim()).map((m) => [m.key, m.value]));
    const keys = [...GARMENT_MEASUREMENTS[type], ...[...typed.keys()].filter((k) => !GARMENT_MEASUREMENTS[type].includes(k))];
    set({ garmentType: type, measurements: keys.map((key) => ({ key, value: typed.get(key) ?? "" })) });
  };
  const addCustom = () => {
    const key = custom.trim().replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 40);
    if (!key || !/^[A-Za-z]/.test(key) || value.measurements.some((m) => m.key === key)) return;
    set({ measurements: [...value.measurements, { key, value: "" }] });
    setCustom("");
  };
  return (
    <div className="grid gap-5">
      <Field>
        <FieldLabel htmlFor={null}>{t("jobcards.fields.garmentType")}</FieldLabel>
        <ChipGroup
          aria-label={t("jobcards.fields.garmentType")}
          value={value.garmentType}
          onChange={pickType}
          options={GARMENT_TYPES.map((g) => ({ value: g, label: t(`jobcards.garment.${g}`) }))}
        />
      </Field>
      {value.garmentType === "other" && (
        <Field>
          <FieldLabel>{t("jobcards.fields.garmentName")}</FieldLabel>
          <FieldControl>
            <Input maxLength={60} value={value.garmentName} onChange={(e) => set({ garmentName: e.target.value })} />
          </FieldControl>
        </Field>
      )}
      <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
        <label htmlFor="jc-fabric" className="text-sm font-medium">
          {t("jobcards.fields.fabricReceived")}
        </label>
        <Switch id="jc-fabric" checked={value.fabricReceived} onCheckedChange={(v) => set({ fabricReceived: v })} />
      </div>
      <div className="flex flex-wrap gap-2" data-testid="jobcards-ai-garment">
        <MeasurementSheetButton
          garment={value.garmentType}
          keys={value.measurements.map((m) => m.key)}
          onApply={(vals, unit) => set({ unit, measurements: value.measurements.map((m) => (m.key in vals ? { ...m, value: String(vals[m.key]) } : m)) })}
        />
        <DesignNotesButton onApply={(text) => set({ style: (value.style.trim() ? `${value.style.trim()}
${text}` : text).slice(0, 1000) })} />
      </div>
      <fieldset className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <legend className="text-sm font-medium">{t("jobcards.fields.measurements")}</legend>
          <ChipGroup
            size="sm"
            aria-label={t("jobcards.fields.unit")}
            value={value.unit}
            onChange={(unit) => set({ unit })}
            options={[
              { value: "in", label: t("jobcards.fields.inches") },
              { value: "cm", label: t("jobcards.fields.cm") },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {value.measurements.map((m, i) => (
            <div key={m.key} className="grid gap-1">
              <label htmlFor={`jc-m-${i}`} className="flex items-center justify-between text-meta text-muted-foreground">
                <span className="truncate">{tOr(t, `jobcards.measure.${m.key}`, m.key)}</span>
                {!GARMENT_MEASUREMENTS[value.garmentType].includes(m.key) && (
                  <button
                    type="button"
                    className="rounded p-0.5 hover:text-foreground"
                    aria-label={t("jobcards.common.remove")}
                    onClick={() => set({ measurements: value.measurements.filter((x) => x.key !== m.key) })}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </label>
              <Input
                id={`jc-m-${i}`}
                inputMode="decimal"
                className="tabular-nums"
                value={m.value}
                onChange={(e) => set({ measurements: value.measurements.map((x) => (x.key === m.key ? { ...x, value: e.target.value.replace(/[^\d.]/g, "") } : x)) })}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            className="max-w-56"
            maxLength={40}
            value={custom}
            placeholder={t("jobcards.fields.addMeasurement")}
            aria-label={t("jobcards.fields.addMeasurement")}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addCustom}>
            <PlusIcon /> {t("jobcards.common.add")}
          </Button>
        </div>
        {msg && <p className="text-sm text-destructive">{msg}</p>}
      </fieldset>
      <Field>
        <FieldLabel>{t("jobcards.fields.style")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} maxLength={1000} value={value.style} onChange={(e) => set({ style: e.target.value })} />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>{t("jobcards.fields.trialDate")}</FieldLabel>
        <FieldControl>
          <Input type="date" className="w-48" value={value.trialDate} onChange={(e) => set({ trialDate: e.target.value })} />
        </FieldControl>
      </Field>
    </div>
  );
}

const NONE = "none";

function EyewearForm({ value, onChange, msg }: { value: EyewearDraft; onChange: (v: EyewearDraft) => void; msg: string | null }) {
  const { t } = useI18n();
  const set = (patch: Partial<EyewearDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("jobcards.fields.prescription")}</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] border-separate border-spacing-1 text-sm">
            <thead>
              <tr className="text-meta text-muted-foreground">
                <th className="w-10 text-left font-medium">
                  <span className="sr-only">{t("jobcards.rx.eye")}</span>
                </th>
                {RX_FIELDS.map((f) => (
                  <th key={f} scope="col" className="text-left font-medium">
                    {t(`jobcards.rx.${f}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EYES.map((eye) => (
                <tr key={eye}>
                  <th scope="row" className="text-left font-semibold" title={t(`jobcards.rx.${eye}`)}>
                    {t(`jobcards.rx.${eye}Short`)}
                  </th>
                  {RX_FIELDS.map((f) => (
                    <td key={f}>
                      <Input
                        inputMode={f === "axis" ? "numeric" : "decimal"}
                        aria-label={`${t(`jobcards.rx.${eye}`)} ${t(`jobcards.rx.${f}`)}`}
                        className="tabular-nums"
                        value={value[eye][f]}
                        placeholder={f === "axis" ? "0–180" : "0.00"}
                        onChange={(e) => set({ [eye]: { ...value[eye], [f]: e.target.value.replace(f === "axis" ? /[^\d]/g : /[^\d.+-]/g, "") } })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-meta text-muted-foreground">{t("jobcards.rx.hint")}</p>
        {msg && <p className="text-sm text-destructive">{msg}</p>}
      </fieldset>
      <FieldRow cols={2}>
        <Field>
          <FieldLabel>{t("jobcards.rx.pd")}</FieldLabel>
          <FieldControl>
            <Input inputMode="decimal" className="tabular-nums" value={value.pd} onChange={(e) => set({ pd: e.target.value.replace(/[^\d.]/g, "") })} />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel htmlFor={null}>{t("jobcards.fields.lensType")}</FieldLabel>
          <Select value={value.lensType || NONE} onValueChange={(v) => set({ lensType: v === NONE ? "" : (v as EyewearDraft["lensType"]) })}>
            <SelectTrigger className="w-full" aria-label={t("jobcards.fields.lensType")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {LENS_TYPES.map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`jobcards.lens.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldRow>
      <FieldRow cols={2}>
        <Field>
          <FieldLabel>{t("jobcards.fields.coating")}</FieldLabel>
          <FieldControl>
            <Input maxLength={120} value={value.coating} placeholder={t("jobcards.fields.coatingHint")} onChange={(e) => set({ coating: e.target.value })} />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>{t("jobcards.fields.frame")}</FieldLabel>
          <FieldControl>
            <Input maxLength={120} value={value.frame} onChange={(e) => set({ frame: e.target.value })} />
          </FieldControl>
        </Field>
      </FieldRow>
    </div>
  );
}

type SubFormProps<T> = { value: T; onChange: (v: T) => void; error?: FieldProblem | null; msg: string | null };

/** One labelled text input of a template form. */
function TextField({ label, value, onChange, max, error, msg, hint, type, inputMode }: { label: string; value: string; onChange: (v: string) => void; max: number; error?: boolean; msg?: string | null; hint?: string; type?: string; inputMode?: "numeric" | "text" }) {
  return (
    <Field invalid={!!error}>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Input type={type} inputMode={inputMode} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
      </FieldControl>
      {hint && <FieldHint>{hint}</FieldHint>}
      <FieldError>{error ? msg : null}</FieldError>
    </Field>
  );
}

function VehicleForm({ value, onChange, error, msg }: SubFormProps<VehicleDraft>) {
  const { t } = useI18n();
  const set = (patch: Partial<VehicleDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-5" data-testid="jobcards-vehicle">
      <FieldRow cols={3}>
        <TextField label={t("jobcards.fields.regNo")} value={value.regNo} max={20} onChange={(regNo) => set({ regNo })} error={error === "regNo"} msg={msg} />
        <TextField label={t("jobcards.fields.brand")} value={value.make} max={60} onChange={(make) => set({ make })} />
        <TextField label={t("jobcards.fields.model")} value={value.model} max={80} onChange={(model) => set({ model })} />
      </FieldRow>
      <TextField label={t("jobcards.fields.km")} value={value.km} max={8} inputMode="numeric" onChange={(km) => set({ km })} error={error === "km"} msg={msg} />
      <Field>
        <FieldLabel htmlFor={null}>{t("jobcards.fields.fuel")}</FieldLabel>
        <ChipGroup aria-label={t("jobcards.fields.fuel")} value={value.fuel || "none"} onChange={(f) => set({ fuel: f === "none" ? "" : f })} options={[{ value: "none", label: "—" }, ...FUEL_LEVELS.map((f) => ({ value: f, label: t(`jobcards.fuel.${f}`) }))]} />
      </Field>
      <Field>
        <FieldLabel htmlFor={null}>{t("jobcards.fields.serviceType")}</FieldLabel>
        <ChipGroup aria-label={t("jobcards.fields.serviceType")} value={value.serviceType} onChange={(serviceType) => set({ serviceType })} options={VEHICLE_SERVICE_TYPES.map((v) => ({ value: v, label: t(`jobcards.vehicleService.${v}`) }))} />
      </Field>
      <Field>
        <FieldLabel>{t("jobcards.fields.complaint")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} maxLength={1000} value={value.complaint} onChange={(e) => set({ complaint: e.target.value })} />
        </FieldControl>
      </Field>
      <FieldRow cols={2}>
        <TextField label={t("jobcards.fields.remindMonths")} value={value.remindAfterMonths} max={2} inputMode="numeric" onChange={(remindAfterMonths) => set({ remindAfterMonths })} error={error === "reminder"} msg={msg} hint={t("jobcards.fields.remindHint")} />
        <TextField label={t("jobcards.fields.remindKm")} value={value.remindAfterKm} max={6} inputMode="numeric" onChange={(remindAfterKm) => set({ remindAfterKm })} error={error === "reminder"} />
      </FieldRow>
    </div>
  );
}

function LaundryForm({ value, onChange, error, msg }: SubFormProps<LaundryDraft>) {
  const { t } = useI18n();
  const set = (patch: Partial<LaundryDraft>) => onChange({ ...value, ...patch });
  const sw = (id: string, label: string, checked: boolean, fn: (v: boolean) => void) => (
    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={fn} />
    </div>
  );
  return (
    <div className="grid gap-5" data-testid="jobcards-laundry">
      <Field>
        <FieldLabel htmlFor={null}>{t("jobcards.fields.service")}</FieldLabel>
        <ChipGroup aria-label={t("jobcards.fields.service")} value={value.service} onChange={(service) => set({ service })} options={LAUNDRY_SERVICES.map((v) => ({ value: v, label: t(`jobcards.laundryService.${v}`) }))} />
      </Field>
      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">{t("jobcards.fields.garmentCounts")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LAUNDRY_GARMENTS.map((g) => (
            <div key={g} className="grid gap-1">
              <label htmlFor={`jc-lg-${g}`} className="text-meta text-muted-foreground">
                {t(`jobcards.laundryGarment.${g}`)}
              </label>
              <Input id={`jc-lg-${g}`} inputMode="numeric" maxLength={3} value={value.counts[g] ?? ""} onChange={(e) => set({ counts: { ...value.counts, [g]: e.target.value } })} />
            </div>
          ))}
        </div>
        {error === "garments" && <p className="text-sm text-destructive">{msg}</p>}
      </fieldset>
      <TextField label={t("jobcards.fields.tagNumbers")} value={value.tagNumbers} max={1000} onChange={(tagNumbers) => set({ tagNumbers })} hint={t("jobcards.fields.tagHint")} error={error === "tags"} msg={msg} />
      {sw("jc-pickup", t("jobcards.fields.pickup"), value.pickup, (pickup) => set({ pickup }))}
      {sw("jc-drop", t("jobcards.fields.drop"), value.drop, (drop) => set({ drop }))}
      {(value.pickup || value.drop) && (
        <FieldRow cols={2}>
          <Field invalid={error === "pickupAddress"}>
            <FieldLabel>{t("jobcards.fields.address")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={500} value={value.address} onChange={(e) => set({ address: e.target.value })} />
            </FieldControl>
            <FieldError>{error === "pickupAddress" ? msg : null}</FieldError>
          </Field>
          <TextField label={t("jobcards.fields.slot")} value={value.slot} max={60} onChange={(slot) => set({ slot })} />
        </FieldRow>
      )}
      <TextField label={t("jobcards.fields.notes")} value={value.notes} max={500} onChange={(notes) => set({ notes })} />
    </div>
  );
}

function ApplianceForm({ value, onChange, error, msg }: SubFormProps<ApplianceDraft>) {
  const { t } = useI18n();
  const set = (patch: Partial<ApplianceDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-5" data-testid="jobcards-appliance">
      <Field>
        <FieldLabel htmlFor={null}>{t("jobcards.fields.kind")}</FieldLabel>
        <ChipGroup aria-label={t("jobcards.fields.kind")} value={value.kind} onChange={(kind) => set({ kind })} options={APPLIANCE_KINDS.map((v) => ({ value: v, label: t(`jobcards.applianceKind.${v}`) }))} />
      </Field>
      <FieldRow cols={3}>
        <TextField label={t("jobcards.fields.brand")} value={value.brand} max={60} onChange={(brand) => set({ brand })} />
        <TextField label={t("jobcards.fields.model")} value={value.model} max={80} onChange={(model) => set({ model })} />
        <TextField label={t("jobcards.fields.serial")} value={value.serial} max={60} onChange={(serial) => set({ serial })} />
      </FieldRow>
      <Field invalid={error === "issue"}>
        <FieldLabel>{t("jobcards.fields.issue")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} maxLength={1000} value={value.issue} onChange={(e) => set({ issue: e.target.value })} />
        </FieldControl>
        <FieldError>{error === "issue" ? msg : null}</FieldError>
      </Field>
      <Field invalid={error === "visitAddress"}>
        <FieldLabel>{t("jobcards.fields.visitAddress")}</FieldLabel>
        <FieldControl>
          <Textarea rows={2} maxLength={500} value={value.address} onChange={(e) => set({ address: e.target.value })} />
        </FieldControl>
        <FieldError>{error === "visitAddress" ? msg : null}</FieldError>
      </Field>
      <FieldRow cols={2}>
        <TextField label={t("jobcards.fields.visitDate")} type="date" value={value.date} max={10} onChange={(date) => set({ date })} />
        <TextField label={t("jobcards.fields.slot")} value={value.slot} max={40} onChange={(slot) => set({ slot })} />
      </FieldRow>
      <TextField label={t("jobcards.fields.amcNumber")} value={value.amcNumber} max={40} onChange={(amcNumber) => set({ amcNumber })} hint={t("jobcards.fields.amcHint")} />
    </div>
  );
}
