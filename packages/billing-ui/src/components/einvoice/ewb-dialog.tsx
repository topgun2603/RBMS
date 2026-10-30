"use client";

import * as React from "react";
import { ApiError, describeError, useI18n } from "@rbms/web";
import { AlertTriangleIcon, InfoIcon, Loader2Icon, TruckIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatePresence,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@rbms/ui";
import { todayIST } from "../../lib/format";
import {
  emptyEwbForm,
  ewbRequestBody,
  MAX_EWB_DISTANCE_KM,
  normalizeVehicleNo,
  TRANS_MODE_KEYS,
  TRANS_MODES,
  validateEwbForm,
  type EInvoiceIssue,
  type EInvoiceRecord,
  type EwbErrors,
  type EwbField,
  type EwbForm,
  type TransMode,
  type VehicleType,
} from "../../lib/einvoice";
import { useEInvoiceAction } from "../../lib/queries-growth";

/** Server issue paths (ewbInput fields) → form fields, so a 400 ewb_invalid highlights the right control. */
const SERVER_FIELDS: Record<string, EwbField> = {
  distance: "distance",
  transMode: "transMode",
  transporterId: "transporterId",
  transporterName: "transporterName",
  transDocNo: "transDocNo",
  transDocDate: "transDocDate",
  vehicleNo: "vehicleNo",
  vehicleType: "vehicleType",
};

/** Transport details → POST /v1/einvoice/invoices/:id/ewb (standalone when the bill has no active IRN). */
export function EwbDialog({
  invoiceId,
  billDate,
  standalone,
  open,
  onOpenChange,
}: {
  invoiceId: string;
  billDate: string;
  standalone: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const action = useEInvoiceAction(invoiceId);
  const [form, setForm] = React.useState<EwbForm>(emptyEwbForm);
  const [submitted, setSubmitted] = React.useState(false);
  const [serverError, setServerError] = React.useState<{ message: string; fields: Partial<Record<EwbField, string>> } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setForm(emptyEwbForm());
    setSubmitted(false);
    setServerError(null);
  }, [open]);

  const today = todayIST();
  const errors: EwbErrors = validateEwbForm(form, { today, docDate: billDate });
  const shown = (f: EwbField) => (submitted && errors[f] ? t(`billing.ewb.errors.${errors[f]}`) : (serverError?.fields[f] ?? null));
  const set = (patch: Partial<EwbForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (serverError) setServerError((e) => (e ? { ...e, fields: {} } : e));
  };
  const road = form.transMode === 1;
  const busy = action.isPending;

  const submit = async () => {
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(errors).length) {
      toast.error(t("billing.ewb.fixErrors"));
      return;
    }
    try {
      const r = (await action.mutateAsync({ kind: "ewb", body: ewbRequestBody(form, standalone) })) as { record: EInvoiceRecord };
      toast.success(t("billing.ewb.generated", { number: r.record?.ewbNo ?? "" }));
      onOpenChange(false);
    } catch (err) {
      const issues = err instanceof ApiError ? ((err.details as { issues?: EInvoiceIssue[] } | undefined)?.issues ?? []) : [];
      const fields: Partial<Record<EwbField, string>> = {};
      for (const i of issues) {
        const f = SERVER_FIELDS[i.path];
        if (f && !fields[f]) fields[f] = i.message;
      }
      setServerError({ message: describeError(err, t), fields });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TruckIcon className="size-5 text-primary" /> {t("billing.ewb.dialogTitle")}
          </DialogTitle>
          <DialogDescription>{t("billing.ewb.dialogBody")}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {standalone && (
            <Alert className="border-primary/30 bg-primary/5">
              <InfoIcon />
              <AlertDescription>{t("billing.ewb.standaloneNote")}</AlertDescription>
            </Alert>
          )}

          <FieldRow cols={2}>
            <Field invalid={!!shown("distance")}>
              <FieldLabel>{t("billing.ewb.distance")}</FieldLabel>
              <FieldControl>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  min={0}
                  max={MAX_EWB_DISTANCE_KM}
                  className="tabular-nums"
                  value={form.distance}
                  onChange={(e) => set({ distance: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })}
                />
              </FieldControl>
              <FieldHint>{t("billing.ewb.distanceHint")}</FieldHint>
              <FieldError>{shown("distance")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("billing.ewb.mode")}</FieldLabel>
              <Select value={String(form.transMode)} onValueChange={(v) => set({ transMode: Number(v) as TransMode, ...(Number(v) !== 1 ? { vehicleType: "R" as VehicleType } : {}) })}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {TRANS_MODES.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {t(`billing.ewb.modes.${TRANS_MODE_KEYS[m]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldRow>

          <AnimatePresence initial={false} mode="popLayout">
            {road && (
              <motion.div
                key="road"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <FieldRow cols={2}>
                  <Field invalid={!!shown("vehicleNo")}>
                    <FieldLabel>{t("billing.ewb.vehicleNo")}</FieldLabel>
                    <FieldControl>
                      <Input
                        autoComplete="off"
                        autoCapitalize="characters"
                        maxLength={20}
                        className="font-mono uppercase"
                        placeholder="TN01AB1234"
                        value={form.vehicleNo}
                        onChange={(e) => set({ vehicleNo: e.target.value.toUpperCase() })}
                        onBlur={() => form.vehicleNo.trim() && set({ vehicleNo: normalizeVehicleNo(form.vehicleNo) })}
                      />
                    </FieldControl>
                    <FieldHint>{t("billing.ewb.vehicleNoHint")}</FieldHint>
                    <FieldError>{shown("vehicleNo")}</FieldError>
                  </Field>
                  <Field invalid={!!shown("vehicleType")}>
                    <FieldLabel>{t("billing.ewb.vehicleType")}</FieldLabel>
                    <Select value={form.vehicleType} onValueChange={(v) => set({ vehicleType: v as VehicleType })}>
                      <FieldControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {(["R", "O"] as const).map((v) => (
                          <SelectItem key={v} value={v}>
                            {t(`billing.ewb.vehicleTypes.${v}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError>{shown("vehicleType")}</FieldError>
                  </Field>
                </FieldRow>
              </motion.div>
            )}
          </AnimatePresence>

          <FieldRow cols={2}>
            <Field invalid={!!shown("transporterId")}>
              <FieldLabel optional={t("billing.common.optional")}>{t("billing.ewb.transporterId")}</FieldLabel>
              <FieldControl>
                <Input
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={15}
                  className="font-mono uppercase"
                  value={form.transporterId}
                  onChange={(e) => set({ transporterId: e.target.value.replace(/\s+/g, "").toUpperCase() })}
                />
              </FieldControl>
              <FieldHint>{t("billing.ewb.transporterIdHint")}</FieldHint>
              <FieldError>{shown("transporterId")}</FieldError>
            </Field>
            <Field invalid={!!shown("transporterName")}>
              <FieldLabel optional={t("billing.common.optional")}>{t("billing.ewb.transporterName")}</FieldLabel>
              <FieldControl>
                <Input autoComplete="off" maxLength={100} value={form.transporterName} onChange={(e) => set({ transporterName: e.target.value })} />
              </FieldControl>
              <FieldError>{shown("transporterName")}</FieldError>
            </Field>
          </FieldRow>

          <FieldRow cols={2}>
            <Field invalid={!!shown("transDocNo")}>
              <FieldLabel optional={road ? t("billing.common.optional") : undefined}>{t("billing.ewb.transDocNo")}</FieldLabel>
              <FieldControl>
                <Input autoComplete="off" maxLength={15} className="font-mono" value={form.transDocNo} onChange={(e) => set({ transDocNo: e.target.value })} />
              </FieldControl>
              <FieldHint>{t("billing.ewb.transDocNoHint")}</FieldHint>
              <FieldError>{shown("transDocNo")}</FieldError>
            </Field>
            <Field invalid={!!shown("transDocDate")}>
              <FieldLabel optional={road ? t("billing.common.optional") : undefined}>{t("billing.ewb.transDocDate")}</FieldLabel>
              <FieldControl>
                <Input type="date" min={billDate} max={today} value={form.transDocDate} onChange={(e) => set({ transDocDate: e.target.value })} />
              </FieldControl>
              <FieldError>{shown("transDocDate")}</FieldError>
            </Field>
          </FieldRow>

          <AnimatePresence initial={false}>
            {serverError && (
              <motion.div key="err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <Alert variant="destructive">
                  <AlertTriangleIcon />
                  <AlertTitle>{serverError.message}</AlertTitle>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <TruckIcon />}
              {t("billing.ewb.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
