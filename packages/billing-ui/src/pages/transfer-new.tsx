"use client";

import * as React from "react";
import { describeError, ModuleLink, Page, PageHeading, useI18n, useModuleNavigate } from "@rbms/web";
import { ArrowLeftIcon, ArrowLeftRightIcon, Loader2Icon, PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, toast } from "@rbms/ui";
import { ItemCombobox } from "../components/inventory/batch-bits";
import { LineBatchSelect } from "../components/inventory/line-batch-select";
import { cleanQty } from "../components/inventory/stock-meta";
import { parseQty } from "../lib/format";
import { useCreateTransfer } from "../lib/queries-stock";
import { useLocationNames } from "./transfers";

interface Line {
  key: string;
  itemId?: string;
  name: string;
  unit: string;
  qty: string;
  batchId?: string;
}
let seq = 0;
const blank = (): Line => ({ key: `t${++seq}`, name: "", unit: "pcs", qty: "1" });

export default function TransferNewPage() {
  const { t } = useI18n();
  const go = useModuleNavigate();
  const locs = useLocationNames();
  const create = useCreateTransfer();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([blank()]);
  const [transport, setTransport] = React.useState("");
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const active = locs.list.filter((l) => l.active !== false);
  React.useEffect(() => {
    if (!from && active.length > 0) setFrom((active.find((l) => l.isDefault) ?? active[0]!).id);
  }, [active, from]);

  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const valid = lines.filter((l) => l.itemId && (parseQty(l.qty) ?? 0) > 0);
  const problem = !from || !to ? t("billing.transfers.form.errPlaces") : from === to ? t("billing.transfers.form.errSame") : valid.length === 0 ? t("billing.transfers.form.errLines") : null;

  const submit = async (send: boolean) => {
    setTouched(true);
    if (problem) return;
    try {
      const tr = await create.mutateAsync({
        fromLocationId: from,
        toLocationId: to,
        lines: valid.map((l) => ({ itemId: l.itemId!, qty: parseQty(l.qty)!, ...(l.batchId ? { batchId: l.batchId } : {}) })),
        ...(transport.trim() ? { transport: transport.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        send,
      });
      toast.success(send ? t("billing.transfers.form.sent", { number: tr.number ?? "" }) : t("billing.transfers.form.saved", { number: tr.number ?? "" }));
      go(`transfers/${tr.id}`);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Page>
      <div className="mb-2">
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="transfers">
            <ArrowLeftIcon /> {t("billing.transfers.title")}
          </ModuleLink>
        </Button>
      </div>
      <PageHeading icon={ArrowLeftRightIcon} title={t("billing.transfers.new")} description={t("billing.transfers.form.subtitle")} />
      <div className="grid gap-5 lg:max-w-3xl">
        <div className="grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="tn-from">{t("billing.transfers.form.from")}</Label>
            <PlaceSelect id="tn-from" value={from} onChange={setFrom} places={active} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tn-to">{t("billing.transfers.form.to")}</Label>
            <PlaceSelect id="tn-to" value={to} onChange={setTo} places={active.filter((l) => l.id !== from)} placeholder={t("billing.transfers.form.choosePlace")} />
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border bg-card p-4">
          <h2 className="font-heading text-base font-semibold">{t("billing.transfers.form.items")}</h2>
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-2 rounded-xl border bg-muted/20 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <ItemCombobox
                    id={`tn-item-${l.key}`}
                    value={l.name}
                    autoFocus={i === 0 && lines.length === 1 && false}
                    placeholder={t("billing.transfers.form.itemPlaceholder")}
                    onValue={(v) => patch(l.key, { name: v, itemId: undefined, batchId: undefined })}
                    onPick={(it) => patch(l.key, { itemId: it.id, name: it.name, unit: it.unit || "pcs", batchId: undefined })}
                  />
                </div>
                <Input
                  aria-label={t("billing.transfers.col.qty")}
                  className="w-24 text-right tabular-nums"
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) => patch(l.key, { qty: cleanQty(e.target.value) })}
                />
                <span className="mt-2 w-8 text-xs text-muted-foreground">{l.unit}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={t("billing.common.delete")} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))}>
                  <Trash2Icon />
                </Button>
              </div>
              <LineBatchSelect itemId={l.itemId} qty={parseQty(l.qty) ?? 1} value={l.batchId} autoPick={false} onChange={(b) => patch(l.key, { batchId: b?.batchId })} />
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
              <PlusIcon /> {t("billing.transfers.form.addItem")}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 rounded-2xl border bg-card p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="tn-transport">
              {t("billing.transfers.form.transport")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
            </Label>
            <Input id="tn-transport" value={transport} maxLength={200} placeholder={t("billing.transfers.form.transportPlaceholder")} onChange={(e) => setTransport(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tn-note">
              {t("billing.adjust.note")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
            </Label>
            <Textarea id="tn-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        {touched && problem && <p className="text-sm text-destructive">{problem}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="lg" disabled={create.isPending} onClick={() => submit(false)}>
            {t("billing.transfers.form.saveDraft")}
          </Button>
          <Button type="button" size="lg" disabled={create.isPending} onClick={() => submit(true)}>
            {create.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("billing.transfers.form.sendNow")}
          </Button>
        </div>
      </div>
    </Page>
  );
}

function PlaceSelect({ id, value, onChange, places, placeholder }: { id: string; value: string; onChange: (v: string) => void; places: { id: string; name: string; code: string }[]; placeholder?: string }) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {places.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name} ({l.code})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
