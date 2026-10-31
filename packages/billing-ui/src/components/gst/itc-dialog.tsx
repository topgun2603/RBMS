"use client";

import * as React from "react";
import {
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { MoneyInput } from "../money-input";
import { money, paiseToInput, rupeesToPaise, todayIST } from "../../lib/format";
import {
  ITC_CLASSES,
  REVERSAL_REASONS,
  taxTotal,
  useRcmCategories,
  useSetItcFlag,
  type ItcClass,
  type ItcFlagPatch,
  type ItcRow,
  type ItcStatus,
  type ReversalReason,
} from "../../lib/gst";
import { useGstText } from "./shared";

type Choice = "auto" | ItcStatus;

/** What the dialog starts from: an existing row, or an expense the system suggests is reverse charge. */
export interface ItcTarget {
  row: ItcRow;
  /** Open with reverse charge switched on and this category chosen. */
  suggestCategory?: string;
}

const monthValue = (v: string | null | undefined) => v ?? "";

/** Decide what happens to the credit on one purchase bill or expense, and whether the tax is on reverse charge. */
export function ItcDialog({ target, onClose }: { target: ItcTarget | null; onClose: () => void }) {
  const { t } = useI18n();
  const text = useGstText();
  const cats = useRcmCategories();
  const save = useSetItcFlag();
  const row = target?.row ?? null;
  const flag = row?.flag ?? null;

  const [choice, setChoice] = React.useState<Choice>("auto");
  const [reversalReason, setReversalReason] = React.useState<ReversalReason>("other");
  const [reversalMonth, setReversalMonth] = React.useState("");
  const [claimMonth, setClaimMonth] = React.useState("");
  const [cls, setCls] = React.useState<ItcClass>("oth");
  const [why, setWhy] = React.useState("");
  const [rcm, setRcm] = React.useState(false);
  const [category, setCategory] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [taxable, setTaxable] = React.useState("");
  const [isImport, setIsImport] = React.useState(false);
  const [paidOn, setPaidOn] = React.useState("");
  const [paidAmount, setPaidAmount] = React.useState("");
  const [challan, setChallan] = React.useState("");

  // Start from the saved decision each time a different document opens.
  React.useEffect(() => {
    if (!row) return;
    const f = row.flag;
    setChoice(f?.itcStatus ?? "auto");
    setReversalReason(f?.reversalReason ?? "other");
    setReversalMonth(monthValue(f?.reversalMonth));
    setClaimMonth(monthValue(f?.claimMonth));
    setCls(f?.itcClass ?? "oth");
    setWhy(f?.reason ?? "");
    const suggested = target?.suggestCategory;
    setRcm(f?.rcm ?? !!suggested);
    setCategory(f?.rcmCategory ?? suggested ?? "");
    setRate(f?.rcmRate != null ? String(f.rcmRate) : "");
    setTaxable(paiseToInput(f?.rcmTaxable));
    setIsImport(f?.rcmImport ?? false);
    setPaidOn(monthValue(f?.rcmPaidOn));
    setPaidAmount(paiseToInput(f?.rcmPaidAmount));
    setChallan(f?.rcmChallan ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.key, target?.suggestCategory]);

  // Choosing a category fills the usual rate (the owner can still change it).
  const pickCategory = (key: string) => {
    setCategory(key);
    const c = cats.data?.find((x) => x.key === key);
    if (c) {
      setRate(String(c.rate));
      if (c.import) setIsImport(true);
    }
  };

  if (!row || !target) return null;
  const doc = row.docType === "purchase" ? "purchase" : "expense";
  const editable = row.docType !== "debit_note";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch: ItcFlagPatch = {
      itcStatus: choice === "auto" ? null : choice,
      itcClass: cls,
      reversalReason: choice === "reversal" ? reversalReason : null,
      reversalMonth: choice === "reversal" ? reversalMonth || null : null,
      claimMonth: claimMonth || null,
      reason: why.trim() || null,
      rcm,
    };
    if (rcm) {
      patch.rcmCategory = category || null;
      patch.rcmRate = rate.trim() === "" ? null : Number(rate);
      patch.rcmTaxable = taxable.trim() === "" ? null : rupeesToPaise(taxable);
      patch.rcmImport = isImport;
      patch.rcmPaidOn = paidOn || null;
      patch.rcmPaidAmount = paidAmount.trim() === "" ? null : rupeesToPaise(paidAmount);
      patch.rcmChallan = challan.trim() || null;
    }
    try {
      await save.mutateAsync({ docType: doc, docId: row.docId, patch });
      toast.success(t("billing.gst.itc.saved"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const reset = async () => {
    try {
      await save.mutateAsync({ docType: doc, docId: row.docId, patch: { reset: true } });
      toast.success(t("billing.gst.itc.resetDone"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const options: { value: Choice; label: string }[] = [
    { value: "auto", label: t("billing.gst.itc.choice.auto") },
    { value: "eligible", label: t("billing.gst.itc.choice.eligible") },
    { value: "ineligible", label: t("billing.gst.itc.choice.ineligible") },
    { value: "blocked", label: t("billing.gst.itc.choice.blocked") },
    { value: "reversal", label: t("billing.gst.itc.choice.reversal") },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" closeLabel={t("billing.common.close")}>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("billing.gst.itc.dialogTitle", { number: row.number })}</DialogTitle>
            <DialogDescription>
              {row.party} · {text.dateText(row.date)} · {t("billing.gst.itc.taxOnDoc", { amount: money(taxTotal(row.tax)) })}
            </DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-2" disabled={!editable}>
            <legend className="mb-1 text-sm font-medium">{t("billing.gst.itc.decisionTitle")}</legend>
            <ChipGroup aria-label={t("billing.gst.itc.decisionTitle")} value={choice} onChange={setChoice} options={options} size="sm" className="flex-wrap" />
            <p className="text-meta text-muted-foreground">
              {choice === "auto"
                ? t("billing.gst.itc.nowAuto", { reason: text.reason(row.reason) })
                : t(`billing.gst.itc.choiceHelp.${choice}`)}
            </p>
          </fieldset>

          {choice === "reversal" && (
            <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="itc-rev-reason">{t("billing.gst.itc.reversalReason")}</Label>
                <Select value={reversalReason} onValueChange={(v) => setReversalReason(v as ReversalReason)}>
                  <SelectTrigger id="itc-rev-reason" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REVERSAL_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`billing.gst.itc.rev.${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="itc-rev-month">{t("billing.gst.itc.reversalMonth")}</Label>
                <Input id="itc-rev-month" type="month" value={reversalMonth} onChange={(e) => setReversalMonth(e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="itc-claim">{t("billing.gst.itc.claimMonth")}</Label>
              <Input id="itc-claim" type="month" value={claimMonth} onChange={(e) => setClaimMonth(e.target.value)} />
              <p className="text-meta text-muted-foreground">{t("billing.gst.itc.claimHelp", { month: row.date.slice(0, 7) })}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="itc-class">{t("billing.gst.itc.classTitle")}</Label>
              <Select value={cls} onValueChange={(v) => setCls(v as ItcClass)}>
                <SelectTrigger id="itc-class" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITC_CLASSES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`billing.gst.itc.class.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="itc-why">{t("billing.gst.itc.why")}</Label>
            <Input id="itc-why" maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("billing.gst.itc.whyHint")} />
          </div>

          <div className="grid gap-3 rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="itc-rcm" className="text-sm font-medium">
                  {t("billing.gst.itc.rcmTitle")}
                </Label>
                <p className="text-meta text-muted-foreground">{t("billing.gst.itc.rcmHelp")}</p>
              </div>
              <Switch id="itc-rcm" checked={rcm} onCheckedChange={setRcm} disabled={!editable} />
            </div>
            {rcm && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="rcm-cat">{t("billing.gst.itc.rcmCategory")}</Label>
                  <Select value={category || undefined} onValueChange={pickCategory}>
                    <SelectTrigger id="rcm-cat" className="w-full">
                      <SelectValue placeholder={t("billing.gst.itc.rcmCategoryHint")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {(cats.data ?? []).map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          {text.rcmName(c)} · {c.rate}%
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rcm-rate">{t("billing.gst.itc.rcmRate")}</Label>
                  <Input id="rcm-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(0)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rcm-taxable">{t("billing.gst.itc.rcmTaxable")}</Label>
                  <MoneyInput id="rcm-taxable" value={taxable} onChange={(e) => setTaxable(e.target.value)} placeholder={paiseToInput(row.taxable)} />
                  <p className="text-meta text-muted-foreground">{t("billing.gst.itc.rcmTaxableHelp")}</p>
                </div>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <Switch id="rcm-import" checked={isImport} onCheckedChange={setIsImport} />
                  <Label htmlFor="rcm-import" className="font-normal">
                    {t("billing.gst.itc.rcmImport")}
                  </Label>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rcm-paid-on">{t("billing.gst.itc.rcmPaidOn")}</Label>
                  <Input id="rcm-paid-on" type="date" max={todayIST()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rcm-paid-amt">{t("billing.gst.itc.rcmPaidAmount")}</Label>
                  <MoneyInput id="rcm-paid-amt" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="rcm-challan">{t("billing.gst.itc.rcmChallan")}</Label>
                  <Input id="rcm-challan" maxLength={60} value={challan} onChange={(e) => setChallan(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {flag && (
                <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => void reset()}>
                  {t("billing.gst.itc.reset")}
                </Button>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                {t("billing.common.cancel")}
              </Button>
              <Button type="submit" disabled={save.isPending || !editable}>
                {t("billing.gst.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Mark tax paid" for one reverse-charge document: date, amount and challan. */
export function RcmPaidDialog({ row, onClose }: { row: ItcRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const save = useSetItcFlag();
  const [paidOn, setPaidOn] = React.useState(todayIST());
  const [amount, setAmount] = React.useState("");
  const [challan, setChallan] = React.useState("");
  React.useEffect(() => {
    if (!row) return;
    setPaidOn(row.rcm?.paidOn ?? todayIST());
    setAmount(paiseToInput(row.rcm?.paidAmount ?? row.rcm?.due ?? 0));
    setChallan(row.flag?.rcmChallan ?? "");
  }, [row?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!row || !row.rcm) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save.mutateAsync({
        docType: row.docType === "expense" ? "expense" : "purchase",
        docId: row.docId,
        patch: { rcmPaidOn: paidOn, rcmPaidAmount: rupeesToPaise(amount), rcmChallan: challan.trim() || null },
      });
      toast.success(t("billing.gst.rcm.paidSaved"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("billing.gst.rcm.paidTitle", { number: row.number })}</DialogTitle>
            <DialogDescription>{t("billing.gst.rcm.paidBody", { amount: money(row.rcm.due) })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="paid-on">{t("billing.gst.itc.rcmPaidOn")}</Label>
            <Input id="paid-on" type="date" required max={todayIST()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="paid-amt">{t("billing.gst.itc.rcmPaidAmount")}</Label>
            <MoneyInput id="paid-amt" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="paid-challan">{t("billing.gst.itc.rcmChallan")}</Label>
            <Input id="paid-challan" maxLength={60} value={challan} onChange={(e) => setChallan(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || !paidOn}>
              {t("billing.gst.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
