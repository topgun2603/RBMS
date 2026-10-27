"use client";

import * as React from "react";
import { Loader2Icon, PlusIcon, TruckIcon, XIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  StatusPill,
  Switch,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, useI18n } from "@srirealtime/web";
import { MoneyInput } from "../money-input";
import { money, rupeesToPaise, todayIST } from "../../lib/format";
import { useHasPermission } from "../../lib/access";
import { CHARGE_KINDS, PURCHASES_PERMISSION, useItemWeights, useLandedVoucherAction, useLandedVouchers, type ChargeBasis, type ChargeInput, type ChargeKind, type PurchaseCharge } from "../../lib/valuation";

const GST_CHOICES = ["0", "5", "12", "18", "28"];

export interface ChargeDraft {
  key: string;
  kind: ChargeKind;
  label: string;
  amount: string;
  gstRate: string;
  claimable: boolean;
  basis: ChargeBasis;
}

let seq = 0;
export const blankCharge = (): ChargeDraft => ({ key: `c${++seq}`, kind: "freight", label: "", amount: "", gstRate: "0", claimable: true, basis: "value" });

/** The charges as the API takes them; null when an amount is not a valid rupee value. */
export function chargeInputs(drafts: readonly ChargeDraft[]): ChargeInput[] | null {
  const out: ChargeInput[] = [];
  for (const d of drafts) {
    if (!d.amount.trim()) continue;
    const amount = rupeesToPaise(d.amount);
    if (amount === null || amount <= 0) return null;
    out.push({ kind: d.kind, ...(d.label.trim() ? { label: d.label.trim() } : {}), amount, gstRate: Number(d.gstRate), claimable: d.claimable, basis: d.basis });
  }
  return out;
}

/** Charges with their GST, as added to the bill total (estimate; the server rounds the bill). */
export const chargesTotal = (drafts: readonly ChargeDraft[]) =>
  (chargeInputs(drafts) ?? []).reduce((s, c) => s + c.amount + Math.round((c.amount * c.gstRate) / 100), 0);

/**
 * Landed charges on a purchase or goods receipt: freight, customs duty, insurance, loading... each spread over the stock
 * lines by value, quantity or weight ("by weight" only when an item has a weight), with GST claimable or part of the cost.
 */
export function ChargesEditor({ value, onChange, itemIds, idPrefix = "chg" }: { value: ChargeDraft[]; onChange: (v: ChargeDraft[]) => void; itemIds: string[]; idPrefix?: string }) {
  const { t } = useI18n();
  const weights = useItemWeights(itemIds);
  const weightOk = (weights.data?.withWeight.length ?? 0) > 0;
  const set = (key: string, patch: Partial<ChargeDraft>) => onChange(value.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{t("billing.landed.title")}</CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...value, blankCharge()])}>
          <PlusIcon /> {t("billing.landed.add")}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {value.length === 0 && <p className="text-meta text-muted-foreground">{t("billing.landed.hint")}</p>}
        {value.map((d) => {
          const id = `${idPrefix}-${d.key}`;
          const basisOptions = (["value", "qty", ...(weightOk || d.basis === "weight" ? (["weight"] as const) : [])] as ChargeBasis[]).map((b) => ({ value: b, label: t(`billing.landed.basis.${b}`) }));
          return (
            <div key={d.key} className="grid gap-3 rounded-xl border p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-kind`}>{t("billing.landed.kindLabel")}</Label>
                  <Select value={d.kind} onValueChange={(v) => set(d.key, { kind: v as ChargeKind })}>
                    <SelectTrigger id={`${id}-kind`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHARGE_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {t(`billing.landed.kind.${k}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-amt`}>{t("billing.landed.amount")}</Label>
                  <MoneyInput id={`${id}-amt`} value={d.amount} onChange={(e) => set(d.key, { amount: e.target.value })} />
                </div>
                <Button type="button" variant="ghost" size="icon" className="size-11 sm:size-9" aria-label={t("billing.landed.remove")} onClick={() => onChange(value.filter((x) => x.key !== d.key))}>
                  <XIcon />
                </Button>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-gst`}>{t("billing.landed.gst")}</Label>
                  <Select value={d.gstRate} onValueChange={(v) => set(d.key, { gstRate: v })}>
                    <SelectTrigger id={`${id}-gst`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GST_CHOICES.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}%
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label htmlFor={`${id}-itc`} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 sm:min-h-9">
                  <span className="text-sm">{t("billing.landed.claimable")}</span>
                  <Switch id={`${id}-itc`} checked={d.claimable} disabled={d.gstRate === "0"} onCheckedChange={(v) => set(d.key, { claimable: v })} />
                </label>
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{t("billing.landed.spread")}</span>
                <ChipGroup size="sm" aria-label={t("billing.landed.spread")} value={d.basis} onChange={(v) => set(d.key, { basis: v as ChargeBasis })} options={basisOptions} />
                {d.gstRate !== "0" && !d.claimable && <p className="text-meta text-muted-foreground">{t("billing.landed.notClaimableHint")}</p>}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Charges recorded on a bill (purchase detail). */
export function ChargesList({ charges }: { charges: PurchaseCharge[] }) {
  const { t } = useI18n();
  if (!charges.length) return null;
  return (
    <ul className="grid gap-1 text-sm">
      {charges.map((c, i) => (
        <li key={i} className="flex flex-wrap items-baseline justify-between gap-2">
          <span>
            {c.label || t(`billing.landed.kind.${c.kind}`)} <span className="text-meta text-muted-foreground">· {t(`billing.landed.basis.${c.basis}`)}</span>
          </span>
          <span className="tabular-nums">
            {money(c.amount)}
            {c.gst > 0 && <span className="text-meta text-muted-foreground"> + {t(c.claimable ? "billing.landed.gstItc" : "billing.landed.gstCost", { amount: money(c.gst) })}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Landed costs added after the purchase (later freight bills): list, add, cancel. */
export function LandedCostsCard({ purchaseId, cancelled }: { purchaseId: string; cancelled: boolean }) {
  const { t, formatDate } = useI18n();
  const can = useHasPermission(PURCHASES_PERMISSION);
  const q = useLandedVouchers(purchaseId);
  const act = useLandedVoucherAction();
  const [open, setOpen] = React.useState(false);
  const [cancelId, setCancelId] = React.useState<string | null>(null);
  const list = q.data?.items ?? [];
  if (!can) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TruckIcon className="size-4 text-primary" /> {t("billing.landed.laterTitle")}
        </CardTitle>
        {!cancelled && (
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setOpen(true)}>
            <PlusIcon /> {t("billing.landed.addLater")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {list.length === 0 && <p className="text-meta text-muted-foreground">{t("billing.landed.laterHint")}</p>}
        {list.map((v) => (
          <div key={v.id} className="grid gap-1 rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {v.number} · {v.description || t(`billing.landed.kind.${v.kind}`)}
              </span>
              <span className="tabular-nums font-semibold">{money(v.amount)}</span>
            </div>
            <p className="text-meta text-muted-foreground">
              {formatDate(v.date, { day: "numeric", month: "short", year: "numeric" })} · {t("billing.landed.split", { stock: money(v.toStock), sold: money(v.toSold) })}
            </p>
            <div className="flex items-center gap-2">
              {v.status === "cancelled" ? (
                <StatusPill tone="neutral">{t("billing.landed.cancelled")}</StatusPill>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setCancelId(v.id)}>
                  {t("billing.landed.cancel")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
      {open && <AddLandedDialog purchaseId={purchaseId} onClose={() => setOpen(false)} />}
      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(o) => !o && setCancelId(null)}
        title={t("billing.landed.cancelTitle")}
        description={t("billing.landed.cancelBody")}
        confirmLabel={t("billing.landed.cancel")}
        onConfirm={async () => {
          try {
            await act.mutateAsync({ kind: "cancel", id: cancelId! });
            toast.success(t("billing.landed.cancelledToast"));
          } catch (err) {
            toast.error(describeError(err, t));
          } finally {
            setCancelId(null);
          }
        }}
      />
    </Card>
  );
}

function AddLandedDialog({ purchaseId, onClose }: { purchaseId: string; onClose: () => void }) {
  const { t } = useI18n();
  const act = useLandedVoucherAction();
  const canPay = useHasPermission("inventory.purchases.pay");
  const [kind, setKind] = React.useState<ChargeKind>("freight");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [gstRate, setGstRate] = React.useState("0");
  const [claimable, setClaimable] = React.useState(true);
  const [basis, setBasis] = React.useState<ChargeBasis>("value");
  const [supplierName, setSupplierName] = React.useState("");
  const [billNumber, setBillNumber] = React.useState("");
  const [date, setDate] = React.useState(() => todayIST());
  const [paid, setPaid] = React.useState(false);
  const paise = amount.trim() ? rupeesToPaise(amount) : null;
  const ok = paise !== null && paise > 0 && billNumber.trim().length > 0;
  const save = async () => {
    if (!ok) return;
    try {
      const v = await act.mutateAsync({
        kind: "create",
        body: { purchaseId, date, kind, description: description.trim() || undefined, basis, claimable: gstRate === "0" ? true : claimable, amount: paise!, gstRate: Number(gstRate), supplierName: supplierName.trim() || undefined, billNumber: billNumber.trim(), paid, ...(paid ? { paymentMode: "cash" as const } : {}) },
      });
      toast.success(t("billing.landed.added", { stock: money(v.toStock), sold: money(v.toSold) }));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !act.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.landed.addLater")}</DialogTitle>
          <DialogDescription>{t("billing.landed.laterBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="lc-kind">{t("billing.landed.kindLabel")}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ChargeKind)}>
                <SelectTrigger id="lc-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHARGE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`billing.landed.kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lc-date">{t("billing.landed.date")}</Label>
              <Input id="lc-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lc-desc">{t("billing.landed.description")}</Label>
            <Input id="lc-desc" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="lc-sup">{t("billing.landed.transporter")}</Label>
              <Input id="lc-sup" value={supplierName} maxLength={120} onChange={(e) => setSupplierName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lc-bill">{t("billing.landed.billNumber")}</Label>
              <Input id="lc-bill" value={billNumber} maxLength={50} onChange={(e) => setBillNumber(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="lc-amt">{t("billing.landed.amount")}</Label>
              <MoneyInput id="lc-amt" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lc-gst">{t("billing.landed.gst")}</Label>
              <Select value={gstRate} onValueChange={setGstRate}>
                <SelectTrigger id="lc-gst" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GST_CHOICES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {gstRate !== "0" && (
            <label htmlFor="lc-itc" className="flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3">
              <span className="text-sm">{t("billing.landed.claimable")}</span>
              <Switch id="lc-itc" checked={claimable} onCheckedChange={setClaimable} />
            </label>
          )}
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">{t("billing.landed.spread")}</span>
            <ChipGroup size="sm" aria-label={t("billing.landed.spread")} value={basis} onChange={(v) => setBasis(v as ChargeBasis)} options={(["value", "qty", "weight"] as const).map((b) => ({ value: b, label: t(`billing.landed.basis.${b}`) }))} />
            {basis === "weight" && <p className="text-meta text-muted-foreground">{t("billing.landed.weightHint")}</p>}
          </div>
          {canPay && (
            <label htmlFor="lc-paid" className="flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3">
              <span className="text-sm">{t("billing.landed.paidCash")}</span>
              <Switch id="lc-paid" checked={paid} onCheckedChange={setPaid} />
            </label>
          )}
          <p className="text-meta text-muted-foreground">{t("billing.landed.billNote")}</p>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={act.isPending}>
            {t("billing.common.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!ok || act.isPending}>
            {act.isPending && <Loader2Icon className="animate-spin" />}
            {t("billing.landed.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
