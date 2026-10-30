"use client";

import * as React from "react";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
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
  toast,
} from "@rbms/ui";
import { describeError, useI18n, useModuleNavigate } from "@rbms/web";
import { rupeesToPaise } from "../lib/format";
import { useCreateJob } from "../lib/queries";
import { draftToFields, emptyDraft, type FieldError as FieldProblem, type FieldsDraft } from "../lib/templates";
import { JOB_TEMPLATES, type JobTemplate } from "../lib/types";
import { InlineError, TEMPLATE_ICON } from "./bits";
import { FieldsForm } from "./fields-form";

/** Takes in a job: pick the kind of work, then its details, the customer, due date and advance. */
export function NewJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const create = useCreateJob();
  const [template, setTemplate] = React.useState<JobTemplate | null>(null);
  const [draft, setDraft] = React.useState<FieldsDraft>(emptyDraft);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [due, setDue] = React.useState("");
  const [urgent, setUrgent] = React.useState(false);
  const [advance, setAdvance] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTemplate(null);
    setDraft(emptyDraft());
    setName("");
    setPhone("");
    setDue("");
    setUrgent(false);
    setAdvance("");
    setNotes("");
    setSubmitted(false);
    setError(null);
  }, [open]);

  const advancePaise = advance.trim() ? rupeesToPaise(advance) : 0;
  const result = template ? draftToFields(template, draft) : null;
  const problem: FieldProblem | null = submitted && result?.error ? result.error : null;
  const nameError = !name.trim() ? t("jobcards.common.required") : null;
  const phoneError = phone.trim() && !/^[+\d][\d\s-]{5,19}$/.test(phone.trim()) ? t("jobcards.new.phoneInvalid") : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!template || !result) return;
    setSubmitted(true);
    setError(null);
    if (result.error || nameError || phoneError || advancePaise === null) return;
    try {
      const job = await create.mutateAsync({
        template,
        fields: result.fields,
        customerName: name.trim(),
        customerPhone: phone.trim() || null,
        dueDate: due || null,
        priority: urgent ? "urgent" : "normal",
        advance: advancePaise,
        notes: notes.trim() || null,
      });
      toast.success(t("jobcards.new.done", { number: job.label }));
      onOpenChange(false);
      navigate(`jobs/${job.id}`);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("jobcards.common.close")} className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {!template ? (
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{t("jobcards.new.title")}</DialogTitle>
              <DialogDescription>{t("jobcards.new.pick")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              {JOB_TEMPLATES.map((tpl) => {
                const Icon = TEMPLATE_ICON[tpl];
                return (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setTemplate(tpl)}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <span className="icon-chip size-10 rounded-xl text-primary">
                      <Icon className="size-5" />
                    </span>
                    <span className="grid gap-0.5">
                      <span className="font-medium">{t(`jobcards.template.${tpl}`)}</span>
                      <span className="text-meta text-muted-foreground">{t(`jobcards.templateHint.${tpl}`)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t("jobcards.common.back")} onClick={() => setTemplate(null)}>
                  <ArrowLeftIcon />
                </Button>
                {t("jobcards.new.titleFor", { template: t(`jobcards.template.${template}`) })}
              </DialogTitle>
              <DialogDescription>{t("jobcards.new.body")}</DialogDescription>
            </DialogHeader>
            {error && <InlineError title={error} />}
            <FieldRow cols={2}>
              <Field invalid={submitted && !!nameError}>
                <FieldLabel>{t("jobcards.fields.customerName")}</FieldLabel>
                <FieldControl>
                  <Input autoFocus maxLength={120} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
                </FieldControl>
                <FieldError>{submitted ? nameError : null}</FieldError>
              </Field>
              <Field invalid={submitted && !!phoneError}>
                <FieldLabel>{t("jobcards.fields.customerPhone")}</FieldLabel>
                <FieldControl>
                  <Input type="tel" inputMode="tel" maxLength={20} autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </FieldControl>
                <FieldError>{submitted ? phoneError : null}</FieldError>
              </Field>
            </FieldRow>
            <FieldsForm template={template} draft={draft} onChange={setDraft} error={problem} />
            <FieldRow cols={2}>
              <Field>
                <FieldLabel>{t("jobcards.fields.dueDate")}</FieldLabel>
                <FieldControl>
                  <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
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
              <label htmlFor="jc-urgent" className="text-sm font-medium">
                {t("jobcards.fields.urgent")}
              </label>
              <Switch id="jc-urgent" checked={urgent} onCheckedChange={setUrgent} />
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
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2Icon className="animate-spin" />}
                {t("jobcards.new.create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
