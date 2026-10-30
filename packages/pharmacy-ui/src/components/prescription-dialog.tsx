"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
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
  Input,
  Textarea,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { useSavePrescription } from "../lib/queries";
import type { BillSummary, Prescription } from "../lib/types";
import { InlineError } from "./bits";
import { BillPicker } from "./pickers";

/** Records (or edits) a prescription: the bill it was dispensed on, the patient and the prescriber. */
export function PrescriptionDialog({
  open,
  onOpenChange,
  prescription,
  bill: initialBill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prescription?: Prescription | null;
  bill?: BillSummary | null;
}) {
  const { t } = useI18n();
  const save = useSavePrescription(prescription?.id);
  const [bill, setBill] = React.useState<BillSummary | null>(null);
  const [patientName, setPatientName] = React.useState("");
  const [patientAge, setPatientAge] = React.useState("");
  const [patientPhone, setPatientPhone] = React.useState("");
  const [patientAddress, setPatientAddress] = React.useState("");
  const [doctorName, setDoctorName] = React.useState("");
  const [doctorRegNo, setDoctorRegNo] = React.useState("");
  const [doctorAddress, setDoctorAddress] = React.useState("");
  const [rxDate, setRxDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const p = prescription;
    setBill(p?.invoiceId ? { id: p.invoiceId, number: p.invoiceNumber, date: p.rxDate, total: 0 } : (initialBill ?? null));
    setPatientName(p?.patientName ?? "");
    setPatientAge(p?.patientAge != null ? String(p.patientAge) : "");
    setPatientPhone(p?.patientPhone ?? "");
    setPatientAddress(p?.patientAddress ?? "");
    setDoctorName(p?.doctorName ?? "");
    setDoctorRegNo(p?.doctorRegNo ?? "");
    setDoctorAddress(p?.doctorAddress ?? "");
    setRxDate(p?.rxDate ?? new Date().toISOString().slice(0, 10));
    setNote(p?.note ?? "");
    setSubmitted(false);
    setError(null);
  }, [open, prescription, initialBill]);

  const age = patientAge ? Number(patientAge) : null;
  const errors = {
    patientName: !patientName.trim() ? t("pharmacy.common.required") : null,
    doctorName: !doctorName.trim() ? t("pharmacy.common.required") : null,
    patientAge: age !== null && (!Number.isInteger(age) || age > 130) ? t("pharmacy.rx.ageInvalid") : null,
    rxDate: !/^\d{4}-\d{2}-\d{2}$/.test(rxDate) ? t("pharmacy.common.required") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean)) return;
    try {
      await save.mutateAsync({
        invoiceId: bill?.id ?? null,
        invoiceNumber: bill?.number ?? null,
        patientName: patientName.trim(),
        patientAge: age,
        patientPhone: patientPhone.trim() || null,
        patientAddress: patientAddress.trim() || null,
        doctorName: doctorName.trim(),
        doctorRegNo: doctorRegNo.trim() || null,
        doctorAddress: doctorAddress.trim() || null,
        rxDate,
        imageUrl: prescription?.imageUrl ?? null,
        note: note.trim() || null,
      });
      toast.success(t("pharmacy.rx.saved"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("pharmacy.common.close")} className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{prescription ? t("pharmacy.rx.editTitle") : t("pharmacy.rx.newTitle")}</DialogTitle>
            <DialogDescription>{t("pharmacy.rx.body")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field>
            <FieldLabel>{t("pharmacy.rx.bill")}</FieldLabel>
            <BillPicker value={bill} onChange={setBill} />
            <FieldHint>{t("pharmacy.rx.billHint")}</FieldHint>
          </Field>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{t("pharmacy.rx.patient")}</legend>
            <Field invalid={!!err("patientName")}>
              <FieldLabel>{t("pharmacy.rx.name")}</FieldLabel>
              <FieldControl>
                <Input value={patientName} maxLength={120} onChange={(e) => setPatientName(e.target.value)} />
              </FieldControl>
              <FieldError>{err("patientName")}</FieldError>
            </Field>
            <Field invalid={!!err("patientAge")}>
              <FieldLabel>{t("pharmacy.rx.age")}</FieldLabel>
              <FieldControl>
                <Input inputMode="numeric" value={patientAge} onChange={(e) => setPatientAge(e.target.value.replace(/\D/g, ""))} />
              </FieldControl>
              <FieldError>{err("patientAge")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("pharmacy.rx.phone")}</FieldLabel>
              <FieldControl>
                <Input inputMode="tel" value={patientPhone} maxLength={20} onChange={(e) => setPatientPhone(e.target.value)} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t("pharmacy.rx.address")}</FieldLabel>
              <FieldControl>
                <Input value={patientAddress} maxLength={300} onChange={(e) => setPatientAddress(e.target.value)} />
              </FieldControl>
            </Field>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{t("pharmacy.rx.prescriber")}</legend>
            <Field invalid={!!err("doctorName")}>
              <FieldLabel>{t("pharmacy.rx.doctor")}</FieldLabel>
              <FieldControl>
                <Input value={doctorName} maxLength={120} placeholder="Dr." onChange={(e) => setDoctorName(e.target.value)} />
              </FieldControl>
              <FieldError>{err("doctorName")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("pharmacy.rx.regNo")}</FieldLabel>
              <FieldControl>
                <Input value={doctorRegNo} maxLength={40} onChange={(e) => setDoctorRegNo(e.target.value)} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t("pharmacy.rx.clinic")}</FieldLabel>
              <FieldControl>
                <Input value={doctorAddress} maxLength={300} onChange={(e) => setDoctorAddress(e.target.value)} />
              </FieldControl>
            </Field>
            <Field invalid={!!err("rxDate")}>
              <FieldLabel>{t("pharmacy.rx.date")}</FieldLabel>
              <FieldControl>
                <Input type="date" value={rxDate} onChange={(e) => setRxDate(e.target.value)} />
              </FieldControl>
              <FieldError>{err("rxDate")}</FieldError>
            </Field>
          </fieldset>
          <Field>
            <FieldLabel>{t("pharmacy.rx.note")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("pharmacy.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("pharmacy.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
