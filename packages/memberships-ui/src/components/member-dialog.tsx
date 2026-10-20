"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
  Button,
  Checkbox,
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
  Label,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { todayIST } from "@srirealtime/gst";
import { describeError, useFeature, useI18n, useModuleNavigate } from "@srirealtime/web";
import { MEMBERSHIPS_FEATURES } from "../lib/access";
import { phoneLabel } from "../lib/format";
import { useCreateMember, useMemberActions } from "../lib/queries";
import type { MemberDetail } from "../lib/types";
import { InlineError } from "./bits";
import { PlanSelect } from "./pickers";

/** 10-digit Indian mobile (with or without +91 / 0), as the API accepts it. */
export const isIndianMobile = (v: string) => /^(?:\+?91|0)?[6-9]\d{9}$/.test(v.replace(/[\s()-]/g, ""));

/**
 * Adds a member (name, mobile, optionally a plan sold now from a start date and billed at once), or edits one.
 * A new member opens on their page.
 */
export function MemberDialog({ open, onOpenChange, member }: { open: boolean; onOpenChange: (o: boolean) => void; member?: MemberDetail | null }) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const billing = useFeature(MEMBERSHIPS_FEATURES.invoices);
  const create = useCreateMember();
  const actions = useMemberActions(member?.id ?? "");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [planId, setPlanId] = React.useState("");
  const [startDate, setStartDate] = React.useState(todayIST());
  const [billNow, setBillNow] = React.useState(true);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(member?.name ?? "");
    setPhone(phoneLabel(member?.phone));
    setNotes(member?.notes ?? "");
    setPlanId("");
    setStartDate(todayIST());
    setBillNow(true);
    setSubmitted(false);
    setError(null);
  }, [open, member]);

  const errors = {
    name: !name.trim() ? t("memberships.common.required") : null,
    phone: phone.trim() && !isIndianMobile(phone) ? t("memberships.member.phoneInvalid") : null,
    startDate: planId && !startDate ? t("memberships.common.required") : null,
  };
  const busy = create.isPending || actions.update.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean)) return;
    const body = { name: name.trim(), phone: phone.trim() || null, notes: notes.trim() || null };
    try {
      if (member) {
        await actions.update.mutateAsync(body);
        toast.success(t("memberships.member.saved"));
        onOpenChange(false);
      } else {
        const m = await create.mutateAsync({ ...body, plan: planId ? { planId, startDate, billNow: billing && billNow } : undefined });
        toast.success(t("memberships.member.added", { code: m.memberCode }));
        onOpenChange(false);
        navigate(`m/${m.id}`);
      }
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("memberships.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{member ? t("memberships.member.editTitle") : t("memberships.member.addTitle")}</DialogTitle>
            <DialogDescription>{member ? member.memberCode : t("memberships.member.addBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={!!err("name")}>
              <FieldLabel>{t("memberships.member.name")}</FieldLabel>
              <FieldControl>
                <Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </FieldControl>
              <FieldError>{err("name")}</FieldError>
            </Field>
            <Field invalid={!!err("phone")}>
              <FieldLabel optional>{t("memberships.member.phone")}</FieldLabel>
              <FieldControl>
                <Input inputMode="tel" value={phone} maxLength={20} placeholder="98765 43210" onChange={(e) => setPhone(e.target.value)} />
              </FieldControl>
              <FieldError>{err("phone")}</FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel optional>{t("memberships.member.notes")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={1000} value={notes} placeholder={t("memberships.member.notesPlaceholder")} onChange={(e) => setNotes(e.target.value)} />
            </FieldControl>
          </Field>
          {!member && (
            <div className="grid gap-4 rounded-lg border bg-muted/30 p-4">
              <Field>
                <FieldLabel optional>{t("memberships.member.planNow")}</FieldLabel>
                <PlanSelect value={planId} onChange={(id) => setPlanId(id)} allowNone />
                <FieldHint>{t("memberships.member.planHint")}</FieldHint>
              </Field>
              {planId && (
                <>
                  <Field invalid={!!err("startDate")}>
                    <FieldLabel>{t("memberships.sell.startDate")}</FieldLabel>
                    <FieldControl>
                      <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </FieldControl>
                    <FieldError>{err("startDate")}</FieldError>
                  </Field>
                  {billing && (
                    <Label className="flex items-center gap-2 font-normal">
                      <Checkbox checked={billNow} onCheckedChange={(v) => setBillNow(v === true)} />
                      {t("memberships.sell.billNow")}
                    </Label>
                  )}
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("memberships.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {member ? t("memberships.common.save") : t("memberships.member.addCta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
