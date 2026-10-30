"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { Button, Textarea, toast } from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { useClaim } from "../lib/queries";

/** "Log a claim": a note on the unit's history (the shop may later open a job card from it). */
export function ClaimForm({ unitId, onDone }: { unitId: string; onDone?: () => void }) {
  const { t } = useI18n();
  const claim = useClaim(unitId);
  const [note, setNote] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      await claim.mutateAsync({ note: note.trim() });
      toast.success(t("serials.claim.done"));
      setNote("");
      onDone?.();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-2">
      <h3 className="text-sm font-semibold">{t("serials.claim.title")}</h3>
      <Textarea rows={3} maxLength={1000} value={note} placeholder={t("serials.claim.placeholder")} onChange={(e) => setNote(e.target.value)} aria-label={t("serials.claim.title")} />
      <div>
        <Button type="submit" size="sm" disabled={!note.trim() || claim.isPending}>
          {claim.isPending && <Loader2Icon className="animate-spin" />}
          {t("serials.claim.cta")}
        </Button>
      </div>
    </form>
  );
}
