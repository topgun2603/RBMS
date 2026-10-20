"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  FieldRow,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Switch,
  Textarea,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { paiseToInput, rupeesToPaise } from "../lib/format";
import type { CardBody } from "../lib/queries";
import { draftFromFields, draftToFields, type FieldsDraft } from "../lib/templates";
import type { Job } from "../lib/types";
import { InlineError } from "./bits";
import { FieldsForm } from "./fields-form";

/** Edits a job still in the shop: customer, template details, due date, assignee, priority, advance and notes. */
export function EditJobDialog({ open, onOpenChange, job, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; job: Job; onSave: (b: CardBody) => Promise<unknown> }) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState<FieldsDraft>(() => draftFromFields(job.template, job.fields));
  const [name, setName] = React.useState(job.customerName);
  const [phone, setPhone] = React.useState(job.customerPhone ?? "");
  const [due, setDue] = React.useState(job.dueDate ?? "");
  const [assignee, setAssignee] = React.useState(job.assigneeName ?? "");
  const [urgent, setUrgent] = React.useState(job.priority === "urgent");
  const [advance, setAdvance] = React.useState(paiseToInput(job.advance, true));
  const [notes, setNotes] = React.useState(job.notes ?? "");
  const [submitted, setSubmitted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDraft(draftFromFields(job.template, job.fields));
    setName(job.customerName);
    setPhone(job.customerPhone ?? "");
    setDue(job.dueDate ?? "");
    setAssignee(job.assigneeName ?? "");
    setUrgent(job.priority === "urgent");
    setAdvance(paiseToInput(job.advance, true));
    setNotes(job.notes ?? "");
    setSubmitted(false);
    setError(null);
  }, [open, job]);

  const result = draftToFields(job.template, draft);
  const advancePaise = advance.trim() ? rupeesToPaise(advance) : 0;
  const nameError = !name.trim() ? t("jobcards.common.required") : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (result.error || nameError || advancePaise === null) return;
    setBusy(true);
    try {
      await onSave({
        fields: result.fields,
        customerName: name.trim(),
        customerPhone: phone.trim() || null,
        dueDate: due || null,
        assigneeName: assignee.trim() || null,
        priority: urgent ? "urgent" : "normal",
        advance: advancePaise,
        notes: notes.trim() || null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("jobcards.common.close")} className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("jobcards.edit.title", { number: job.label })}</DialogTitle>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <FieldRow cols={2}>
            <Field invalid={submitted && !!nameError}>
              <FieldLabel>{t("jobcards.fields.customerName")}</FieldLabel>
              <FieldControl>
                <Input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
              </FieldControl>
              <FieldError>{submitted ? nameError : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("jobcards.fields.customerPhone")}</FieldLabel>
              <FieldControl>
                <Input type="tel" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </FieldControl>
            </Field>
          </FieldRow>
          <FieldsForm template={job.template} draft={draft} onChange={setDraft} error={submitted ? (result.error ?? null) : null} />
          <FieldRow cols={3}>
            <Field>
              <FieldLabel>{t("jobcards.fields.dueDate")}</FieldLabel>
              <FieldControl>
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t("jobcards.fields.assignee")}</FieldLabel>
              <FieldControl>
                <Input maxLength={80} value={assignee} onChange={(e) => setAssignee(e.target.value)} />
              </FieldControl>
            </Field>
            <Field invalid={submitted && advancePaise === null}>
              <FieldLabel>{t("jobcards.fields.advance")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>₹</InputGroupAddon>
                <InputGroupInput inputMode="decimal" className="tabular-nums" aria-label={t("jobcards.fields.advance")} value={advance} onChange={(e) => setAdvance(e.target.value)} />
              </InputGroup>
              <FieldError>{submitted && advancePaise === null ? t("jobcards.common.amountInvalid") : null}</FieldError>
            </Field>
          </FieldRow>
          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <label htmlFor="jc-edit-urgent" className="text-sm font-medium">
              {t("jobcards.fields.urgent")}
            </label>
            <Switch id="jc-edit-urgent" checked={urgent} onCheckedChange={setUrgent} />
          </div>
          <Field>
            <FieldLabel>{t("jobcards.fields.notes")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("jobcards.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {t("jobcards.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
