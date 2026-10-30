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
  Switch,
  Textarea,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { InlineError } from "../bits";
import { useSaveReport } from "../../lib/queries/reports";
import type { ReportSpec, SavedReport } from "../../lib/types";

/**
 * Save the current spec: name, optional description, shared switch. `existing` + mode "update" PATCHes it;
 * otherwise creates a new saved report ("Save as new" when editing). Calls `onSaved` with the row.
 */
export function SaveReportDialog({
  open,
  onOpenChange,
  spec,
  existing,
  mode,
  defaultName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spec: ReportSpec;
  existing?: SavedReport | null;
  mode: "create" | "update";
  defaultName?: string;
  onSaved: (row: SavedReport, created: boolean) => void;
}) {
  const { t } = useI18n();
  const save = useSaveReport();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [shared, setShared] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    save.reset();
    setTouched(false);
    if (existing) {
      setName(mode === "update" ? existing.name : t("growth.reports.save.copyName", { name: existing.name }));
      setDescription(existing.description ?? "");
      setShared(existing.shared);
    } else {
      setName(defaultName ?? "");
      setDescription("");
      setShared(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const nameErr = touched && !name.trim() ? t("growth.reports.save.nameRequired") : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim()) return;
    try {
      const row = await save.mutateAsync({
        id: mode === "update" ? existing?.id : undefined,
        body: { name: name.trim(), description: description.trim() || null, spec, shared },
      });
      toast.success(t(mode === "update" ? "growth.reports.save.updated" : "growth.reports.save.created", { name: row.name }));
      onOpenChange(false);
      onSaved(row, mode !== "update");
    } catch {
      // shown inline
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={t("growth.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{t(mode === "update" ? "growth.reports.save.updateTitle" : existing ? "growth.reports.save.asNewTitle" : "growth.reports.save.title")}</DialogTitle>
            <DialogDescription>{t("growth.reports.save.description")}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!nameErr}>
            <FieldLabel>{t("growth.common.name")}</FieldLabel>
            <FieldControl>
              <Input value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} placeholder={t("growth.reports.save.namePlaceholder")} />
            </FieldControl>
            <FieldError>{nameErr}</FieldError>
          </Field>
          <Field>
            <FieldLabel optional={t("growth.common.optional")}>{t("growth.reports.save.notes")}</FieldLabel>
            <FieldControl>
              <Textarea value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} />
            </FieldControl>
          </Field>
          <Field>
            <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
              <div className="grid gap-1">
                <FieldLabel>{t("growth.reports.save.shared")}</FieldLabel>
                <FieldHint>{t("growth.reports.save.sharedHint")}</FieldHint>
              </div>
              <FieldControl>
                <Switch checked={shared} onCheckedChange={setShared} />
              </FieldControl>
            </div>
          </Field>
          {save.error ? <InlineError title={t("growth.reports.save.failed")}>{describeError(save.error, t)}</InlineError> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {t("growth.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {save.isPending ? t("growth.common.saving") : t("growth.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
