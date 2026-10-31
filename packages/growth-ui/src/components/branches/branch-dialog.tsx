"use client";

import * as React from "react";
import { Loader2Icon, WandSparklesIcon } from "lucide-react";
import { GST_STATES, stateFromGstin } from "@rbms/gst";
import {
  Button,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { InlineError } from "../bits";
import { BRANCH_CODE_RE, checkBranchGst, normalizeCode, PINCODE_RE, PREFIX_RE, sampleBillNumber, sanitizePrefix, suggestPrefix } from "../../lib/branches";
import { todayIST } from "../../lib/format";
import { useLocations, useSaveBranch } from "../../lib/queries/branches";
import type { Branch, BranchInput } from "../../lib/types";

const NEW_LOCATION = "__new";
const NO_LOCATION = "__none";
const NO_STATE = "__none";

interface Draft {
  name: string;
  code: string;
  gstin: string;
  stateCode: string;
  address: string;
  city: string;
  pincode: string;
  phone: string;
  invoicePrefix: string;
  location: string;
  isDefault: boolean;
}

const toDraft = (b: Branch | null): Draft => ({
  name: b?.name ?? "",
  code: b?.code ?? "",
  gstin: b?.gstin ?? "",
  stateCode: b?.stateCode ?? "",
  address: b?.address ?? "",
  city: b?.city ?? "",
  pincode: b?.pincode ?? "",
  phone: b?.phone ?? "",
  invoicePrefix: b?.invoicePrefix ?? "",
  location: b ? (b.stockLocationId ?? NO_LOCATION) : NEW_LOCATION,
  isDefault: b?.isDefault ?? false,
});

/** Add / edit a branch: code, GSTIN with state check, address, bill prefix with a sample number, stock location. */
export function BranchSheet({
  open,
  onOpenChange,
  branch,
  branches,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = new branch. */
  branch: Branch | null;
  branches: Branch[];
}) {
  const { t } = useI18n();
  const save = useSaveBranch();
  const locations = useLocations(open);
  const [d, setD] = React.useState<Draft>(() => toDraft(branch));
  const [prefixTouched, setPrefixTouched] = React.useState(!!branch);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setD(toDraft(branch));
      setPrefixTouched(!!branch);
      setSubmitted(false);
      setError(null);
    }
  }, [open, branch]);

  const others = branches.filter((b) => b.id !== branch?.id);
  const takenPrefixes = others.map((b) => b.invoicePrefix);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  // The prefix follows the code for a new branch until the user types one.
  const onCode = (v: string) => {
    const code = v.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
    set(prefixTouched ? { code } : { code, invoicePrefix: code ? suggestPrefix(code, takenPrefixes) : "" });
  };
  const onGstin = (v: string) => {
    const gstin = v.toUpperCase().replace(/\s/g, "").slice(0, 15);
    // The first two digits of a GSTIN are the state code: pick the state as soon as they are typed.
    const st = gstin.length === 15 ? stateFromGstin(gstin) : GST_STATES.find((s) => s.code === gstin.slice(0, 2))?.code ?? null;
    set({ gstin, ...(st ? { stateCode: st } : {}) });
  };

  const code = normalizeCode(d.code);
  const prefix = sanitizePrefix(d.invoicePrefix);
  const gst = checkBranchGst(d.gstin, d.stateCode);
  const errors = {
    name: !d.name.trim() ? t("growth.common.required") : null,
    code: !code ? t("growth.common.required") : !BRANCH_CODE_RE.test(code) ? t("growth.branches.errors.code") : others.some((b) => b.code === code) ? t("growth.branches.errors.codeTaken") : null,
    gstin: !gst.ok && gst.field === "gstin" ? t("growth.branches.errors.gstin") : null,
    stateCode: !gst.ok && gst.field === "stateCode" ? t("growth.branches.errors.stateMismatch", { state: d.gstin.slice(0, 2) }) : null,
    pincode: d.pincode && !PINCODE_RE.test(d.pincode) ? t("growth.branches.errors.pincode") : null,
    invoicePrefix: d.invoicePrefix && !PREFIX_RE.test(prefix) ? t("growth.branches.errors.prefix") : others.some((b) => b.invoicePrefix === prefix) ? t("growth.branches.errors.prefixTaken") : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (invalid) return;
    const body: BranchInput = {
      name: d.name.trim(),
      code,
      gstin: d.gstin.trim() || null,
      stateCode: (gst.ok ? gst.stateCode : d.stateCode) || null,
      address: d.address.trim() || null,
      city: d.city.trim() || null,
      pincode: d.pincode.trim() || null,
      phone: d.phone.trim() || null,
      invoicePrefix: d.invoicePrefix ? prefix : null,
    };
    if (d.location === NEW_LOCATION) {
      if (!branch) body.createLocation = true;
    } else if (d.location === NO_LOCATION) {
      if (!branch) body.createLocation = false;
      else body.stockLocationId = null;
    } else body.stockLocationId = d.location;
    if (d.isDefault && !branch?.isDefault) body.isDefault = true;
    try {
      const saved = await save.mutateAsync({ id: branch?.id, body });
      toast.success(branch ? t("growth.branches.updated", { name: saved.name }) : t("growth.branches.created", { name: saved.name }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const show = (k: keyof typeof errors) => (submitted || k === "stateCode" || k === "gstin" ? errors[k] : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl" closeLabel={t("growth.common.close")}>
        <form onSubmit={submit} className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{branch ? t("growth.branches.editTitle", { name: branch.name }) : t("growth.branches.newTitle")}</SheetTitle>
            <SheetDescription>{t("growth.branches.sheetBody")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4">
            {error && <InlineError title={error} />}
            <FieldRow cols={2}>
              <Field invalid={!!show("name")}>
                <FieldLabel>{t("growth.branches.name")}</FieldLabel>
                <FieldControl>
                  <Input value={d.name} maxLength={80} placeholder={t("growth.branches.namePlaceholder")} onChange={(e) => set({ name: e.target.value })} />
                </FieldControl>
                <FieldError>{show("name")}</FieldError>
              </Field>
              <Field invalid={!!show("code")}>
                <FieldLabel>{t("growth.branches.code")}</FieldLabel>
                <FieldControl>
                  <Input className="font-mono uppercase" value={d.code} maxLength={16} placeholder="MDU" onChange={(e) => onCode(e.target.value)} />
                </FieldControl>
                <FieldHint>{t("growth.branches.codeHint")}</FieldHint>
                <FieldError>{show("code")}</FieldError>
              </Field>
            </FieldRow>

            <FieldRow cols={2}>
              <Field invalid={!!show("gstin")}>
                <FieldLabel optional={t("growth.common.optional")}>{t("growth.branches.gstin")}</FieldLabel>
                <FieldControl>
                  <Input className="font-mono uppercase" value={d.gstin} maxLength={15} onChange={(e) => onGstin(e.target.value)} />
                </FieldControl>
                <FieldHint>{t("growth.branches.gstinHint")}</FieldHint>
                <FieldError>{d.gstin.length === 15 ? show("gstin") : null}</FieldError>
              </Field>
              <Field invalid={!!show("stateCode")}>
                <FieldLabel optional={d.gstin ? undefined : t("growth.common.optional")}>{t("growth.branches.state")}</FieldLabel>
                <Select value={d.stateCode || NO_STATE} onValueChange={(v) => set({ stateCode: v === NO_STATE ? "" : v })}>
                  <FieldControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NO_STATE}>{t("growth.branches.noState")}</SelectItem>
                    {GST_STATES.map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {s.name} ({s.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldHint>{t("growth.branches.stateHint")}</FieldHint>
                <FieldError>{show("stateCode")}</FieldError>
              </Field>
            </FieldRow>

            <Field>
              <FieldLabel optional={t("growth.common.optional")}>{t("growth.branches.address")}</FieldLabel>
              <FieldControl>
                <Textarea rows={2} maxLength={500} value={d.address} onChange={(e) => set({ address: e.target.value })} />
              </FieldControl>
            </Field>
            <FieldRow cols={3}>
              <Field>
                <FieldLabel optional={t("growth.common.optional")}>{t("growth.branches.city")}</FieldLabel>
                <FieldControl>
                  <Input value={d.city} maxLength={80} onChange={(e) => set({ city: e.target.value })} />
                </FieldControl>
              </Field>
              <Field invalid={!!show("pincode")}>
                <FieldLabel optional={t("growth.common.optional")}>{t("growth.branches.pincode")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="numeric" maxLength={6} value={d.pincode} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, "") })} />
                </FieldControl>
                <FieldError>{show("pincode")}</FieldError>
              </Field>
              <Field>
                <FieldLabel optional={t("growth.common.optional")}>{t("growth.branches.phone")}</FieldLabel>
                <FieldControl>
                  <Input type="tel" inputMode="tel" maxLength={30} value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
                </FieldControl>
              </Field>
            </FieldRow>

            <FieldRow cols={2}>
              <Field invalid={!!show("invoicePrefix")}>
                <FieldLabel
                  aside={
                    code && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        onClick={() => {
                          set({ invoicePrefix: suggestPrefix(code, takenPrefixes) });
                          setPrefixTouched(true);
                        }}
                      >
                        <WandSparklesIcon className="size-3" /> {t("growth.branches.suggest")}
                      </button>
                    )
                  }
                >
                  {t("growth.branches.prefix")}
                </FieldLabel>
                <FieldControl>
                  <Input
                    className="font-mono uppercase"
                    maxLength={6}
                    value={d.invoicePrefix}
                    onChange={(e) => {
                      setPrefixTouched(true);
                      set({ invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") });
                    }}
                  />
                </FieldControl>
                <FieldHint>{t("growth.branches.prefixSample", { number: sampleBillNumber(d.invoicePrefix, todayIST()) })}</FieldHint>
                <FieldError>{show("invoicePrefix")}</FieldError>
              </Field>
              <Field>
                <FieldLabel>{t("growth.branches.location")}</FieldLabel>
                <Select value={d.location} onValueChange={(v) => set({ location: v })}>
                  <FieldControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    {!branch && <SelectItem value={NEW_LOCATION}>{t("growth.branches.locationNew")}</SelectItem>}
                    {(locations.data ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name} ({l.code})
                      </SelectItem>
                    ))}
                    <SelectItem value={NO_LOCATION}>{t("growth.branches.locationNone")}</SelectItem>
                  </SelectContent>
                </Select>
                <FieldHint>{locations.isError ? t("growth.branches.locationsUnavailable") : t("growth.branches.locationHint")}</FieldHint>
              </Field>
            </FieldRow>

            {!branch?.isDefault && (
              <Field>
                <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
                  <div className="space-y-0.5">
                    <FieldLabel>{t("growth.branches.makeMain")}</FieldLabel>
                    <p className="text-meta text-muted-foreground">{t("growth.branches.makeMainHint")}</p>
                  </div>
                  <FieldControl>
                    <Switch checked={d.isDefault} onCheckedChange={(v) => set({ isDefault: v })} />
                  </FieldControl>
                </div>
              </Field>
            )}
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("growth.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {branch ? t("growth.common.save") : t("growth.branches.add")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
