"use client";

import * as React from "react";
import { describeError, Page, PageHeading, useDebounced, useI18n } from "@rbms/web";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@rbms/ui";
import { Loader2Icon, PackageIcon, PlusIcon, SaveIcon, TagsIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { MoneyInput } from "../components/money-input";
import { useHasPermission } from "../lib/access";
import { money, paiseToInput, parseQty, rupeesToPaise } from "../lib/format";
import { useItems } from "../lib/queries";
import {
  useCustomerGroups,
  useDeleteCustomerGroup,
  useDeletePriceList,
  useGroupCustomers,
  usePriceList,
  usePriceLists,
  usePriceListsOn,
  useSaveCustomerGroup,
  useSavePriceEntries,
  useSavePriceList,
} from "../lib/queries-pricing";
import type { Item } from "../lib/types";
import type { ItemUnit, PriceListDetail, PriceListSummary } from "../lib/types-pricing";

/**
 * Price lists (Retail, Wholesale, Dealer ...) with per-item and per-unit prices, quantity slabs and a % rule, and the
 * customer groups that use them (docs/price-lists-units.md). Item prices stay the retail price.
 */
export default function PriceListsPage() {
  const { t } = useI18n();
  const on = usePriceListsOn();
  return (
    <Page>
      <PageHeading icon={TagsIcon} title={t("billing.pl.title")} description={t("billing.pl.subtitle")} />
      {on ? (
        <Tabs defaultValue="lists" className="grid gap-section">
          <TabsList>
            <TabsTrigger value="lists">{t("billing.pl.tab.lists")}</TabsTrigger>
            <TabsTrigger value="groups">{t("billing.pl.tab.groups")}</TabsTrigger>
          </TabsList>
          <TabsContent value="lists">
            <Lists />
          </TabsContent>
          <TabsContent value="groups">
            <Groups />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">{t("billing.pl.off")}</p>
      )}
    </Page>
  );
}

function listBadges(l: PriceListSummary, t: (k: string) => string) {
  return (
    <span className="flex flex-wrap gap-1">
      {l.isDefault && <Badge>{t("billing.pl.default")}</Badge>}
      {!l.active && <Badge variant="secondary">{t("billing.pl.inactive")}</Badge>}
      {l.active && !l.current && <Badge variant="outline">{t("billing.pl.notNow")}</Badge>}
    </span>
  );
}

function Lists() {
  const { t } = useI18n();
  const canEdit = useHasPermission("catalogue.manage");
  const lists = usePriceLists();
  const [selected, setSelected] = React.useState<string | "new" | null>(null);
  const items = lists.data?.items ?? [];
  React.useEffect(() => {
    if (selected === null && items[0]) setSelected(items[0].id);
  }, [selected, items]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <Card className="gap-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">{t("billing.pl.tab.lists")}</CardTitle>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setSelected("new")}>
              <PlusIcon /> {t("billing.pl.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-1 px-2">
          {lists.isLoading && <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />}
          {!lists.isLoading && items.length === 0 && <p className="px-2 text-sm text-muted-foreground">{t("billing.pl.empty")}</p>}
          {items.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setSelected(l.id)}
              aria-pressed={selected === l.id}
              className={cn("grid gap-0.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent", selected === l.id && "bg-primary/10")}
            >
              <span className="flex items-center justify-between gap-2 font-medium">
                <span className="truncate">{l.name}</span>
                {listBadges(l, t)}
              </span>
              <span className="text-meta text-muted-foreground">
                {t("billing.pl.counts", { prices: l.entryCount, groups: l.groupCount, customers: l.customerCount })}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>
      {selected === "new" ? (
        <ListSettings key="new" canEdit={canEdit} onSaved={(id) => setSelected(id)} />
      ) : selected ? (
        <ListEditor key={selected} id={selected} canEdit={canEdit} onDeleted={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function ListEditor({ id, canEdit, onDeleted }: { id: string; canEdit: boolean; onDeleted: () => void }) {
  const q = usePriceList(id);
  if (!q.data) return <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />;
  return (
    <div className="grid gap-section">
      <ListSettings list={q.data} canEdit={canEdit} onDeleted={onDeleted} />
      <ListPrices list={q.data} canEdit={canEdit} />
    </div>
  );
}

function ListSettings({ list, canEdit, onSaved, onDeleted }: { list?: PriceListDetail; canEdit: boolean; onSaved?: (id: string) => void; onDeleted?: () => void }) {
  const { t } = useI18n();
  const save = useSavePriceList();
  const del = useDeletePriceList();
  const [name, setName] = React.useState(list?.name ?? "");
  const [pct, setPct] = React.useState(list?.adjustPct !== null && list?.adjustPct !== undefined ? String(list.adjustPct) : "");
  const [roundRupee, setRoundRupee] = React.useState(list?.roundRupee ?? false);
  const [from, setFrom] = React.useState(list?.validFrom ?? "");
  const [to, setTo] = React.useState(list?.validTo ?? "");
  const [active, setActive] = React.useState(list?.active ?? true);
  const [isDefault, setIsDefault] = React.useState(list?.isDefault ?? false);
  const [note, setNote] = React.useState(list?.note ?? "");

  const submit = async () => {
    const adjustPct = pct.trim() === "" ? null : Number(pct);
    if (!name.trim() || (adjustPct !== null && (!Number.isFinite(adjustPct) || adjustPct <= -100))) {
      toast.error(t("billing.pl.errSettings"));
      return;
    }
    try {
      const saved = await save.mutateAsync({
        id: list?.id,
        body: { name: name.trim(), adjustPct, roundRupee, validFrom: from || null, validTo: to || null, active, isDefault, note: note.trim() || null },
      });
      toast.success(t("billing.pl.saved"));
      onSaved?.(saved.id);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const remove = async () => {
    if (!list || !window.confirm(t("billing.pl.confirmDelete", { name: list.name }))) return;
    try {
      await del.mutateAsync(list.id);
      onDeleted?.();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{list ? list.name : t("billing.pl.new")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pl-name">{t("billing.pl.name")}</Label>
          <Input id="pl-name" value={name} maxLength={60} disabled={!canEdit} placeholder={t("billing.pl.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pl-pct">{t("billing.pl.rule")}</Label>
          <Input id="pl-pct" inputMode="decimal" value={pct} disabled={!canEdit} placeholder="-10" onChange={(e) => setPct(e.target.value.replace(/[^\d.-]/g, ""))} />
          <span className="text-meta text-muted-foreground">{t("billing.pl.ruleHint")}</span>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pl-from">{t("billing.pl.validFrom")}</Label>
          <Input id="pl-from" type="date" value={from} disabled={!canEdit} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pl-to">{t("billing.pl.validTo")}</Label>
          <Input id="pl-to" type="date" value={to} min={from || undefined} disabled={!canEdit} onChange={(e) => setTo(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={active} onCheckedChange={setActive} disabled={!canEdit} /> {t("billing.pl.active")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={roundRupee} onCheckedChange={setRoundRupee} disabled={!canEdit} /> {t("billing.pl.roundRupee")}
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <Switch checked={isDefault} onCheckedChange={setIsDefault} disabled={!canEdit} />
          <span>
            {t("billing.pl.isDefault")}
            <span className="block text-meta text-muted-foreground">{t("billing.pl.isDefaultHint")}</span>
          </span>
        </label>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="pl-note">{t("billing.pl.note")}</Label>
          <Textarea id="pl-note" rows={2} maxLength={500} value={note} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} />
        </div>
        {canEdit && (
          <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
            {list && (
              <Button variant="ghost" className="text-destructive" disabled={del.isPending} onClick={() => void remove()}>
                <Trash2Icon /> {t("billing.common.delete")}
              </Button>
            )}
            <Button disabled={save.isPending} onClick={() => void submit()}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} {t("billing.common.save")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface EntryRow {
  key: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  units: ItemUnit[] | null;
  unit: string;
  minQty: string;
  price: string;
  itemPrice: number | null;
}

let rowSeq = 0;

function ListPrices({ list, canEdit }: { list: PriceListDetail; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSavePriceEntries(list.id);
  const toRows = React.useCallback(
    (l: PriceListDetail): EntryRow[] =>
      l.entries.map((e) => ({
        key: `r${++rowSeq}`,
        itemId: e.itemId,
        itemName: e.itemName ?? t("billing.pl.itemGone"),
        baseUnit: e.baseUnit ?? "",
        units: null,
        unit: e.unit ?? "",
        minQty: e.minQty ? String(e.minQty) : "",
        price: paiseToInput(e.price),
        itemPrice: e.itemPrice,
      })),
    [t],
  );
  const [rows, setRows] = React.useState<EntryRow[]>(() => toRows(list));
  React.useEffect(() => setRows(toRows(list)), [list, toRows]);
  const update = (key: string, patch: Partial<EntryRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const add = (item: Item) =>
    setRows((rs) => [
      ...rs,
      { key: `r${++rowSeq}`, itemId: item.id, itemName: item.name, baseUnit: item.unit || "pcs", units: item.units ?? [], unit: "", minQty: "", price: paiseToInput(item.rate), itemPrice: item.rate },
    ]);

  const submit = async () => {
    const body: { itemId: string; unit: string | null; minQty: number; price: number }[] = [];
    for (const r of rows) {
      const price = rupeesToPaise(r.price);
      const minQty = r.minQty.trim() ? parseQty(r.minQty) : 0;
      if (price === null || minQty === null) {
        toast.error(t("billing.pl.errRow", { name: r.itemName }));
        return;
      }
      body.push({ itemId: r.itemId, unit: r.unit.trim() || null, minQty, price });
    }
    try {
      await save.mutateAsync(body);
      toast.success(t("billing.pl.pricesSaved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">{t("billing.pl.prices")}</CardTitle>
        <span className="text-meta text-muted-foreground">{t("billing.pl.pricesHint")}</span>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">{list.adjustPct !== null ? t("billing.pl.noPricesRule", { pct: list.adjustPct }) : t("billing.pl.noPrices")}</p>}
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-2 items-end gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <p className="truncate text-sm font-medium">{r.itemName}</p>
              {r.itemPrice !== null && <p className="text-meta text-muted-foreground">{t("billing.pl.itemPrice", { price: money(r.itemPrice) })}</p>}
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${r.key}-u`} className="text-xs text-muted-foreground">
                {t("billing.form.unit")}
              </Label>
              {r.units && r.units.length > 0 ? (
                <Select value={r.unit || "__base"} disabled={!canEdit} onValueChange={(v) => update(r.key, { unit: v === "__base" ? "" : v })}>
                  <SelectTrigger id={`${r.key}-u`} size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__base">{r.baseUnit}</SelectItem>
                    {r.units.map((u) => (
                      <SelectItem key={u.unit} value={u.unit}>
                        {u.unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input id={`${r.key}-u`} size="sm" maxLength={16} value={r.unit} placeholder={r.baseUnit} disabled={!canEdit} onChange={(e) => update(r.key, { unit: e.target.value })} />
              )}
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${r.key}-q`} className="text-xs text-muted-foreground">
                {t("billing.pl.fromQty")}
              </Label>
              <Input id={`${r.key}-q`} size="sm" inputMode="decimal" className="text-right tabular-nums" placeholder="0" value={r.minQty} disabled={!canEdit} onChange={(e) => update(r.key, { minQty: e.target.value.replace(/[^\d.]/g, "") })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${r.key}-p`} className="text-xs text-muted-foreground">
                {t("billing.pl.price")}
              </Label>
              <MoneyInput id={`${r.key}-p`} size="sm" value={r.price} disabled={!canEdit} onChange={(e) => update(r.key, { price: e.target.value })} />
            </div>
            {canEdit && (
              <Button type="button" size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={t("billing.pl.removeRow", { name: r.itemName })} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <Trash2Icon />
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <>
            <ItemAdder onPick={add} />
            <div className="flex justify-end">
              <Button disabled={save.isPending} onClick={() => void submit()}>
                {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} {t("billing.pl.savePrices")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ItemAdder({ onPick }: { onPick: (item: Item) => void }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q.trim(), 200);
  const items = useItems(dq, 6, dq.length > 0);
  const list = dq ? (items.data?.items ?? []) : [];
  return (
    <div className="relative">
      <Input aria-label={t("billing.pl.addItem")} placeholder={t("billing.pl.addItem")} value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {list.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onPick(it);
                  setQ("");
                }}
              >
                <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {money(it.rate)}/{it.unit || "pcs"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- customer groups

function Groups() {
  const { t } = useI18n();
  const canEdit = useHasPermission("catalogue.manage");
  const groups = useCustomerGroups();
  const lists = usePriceLists();
  const save = useSaveCustomerGroup();
  const del = useDeleteCustomerGroup();
  const [name, setName] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const NONE = "__none";

  const create = async () => {
    if (!name.trim()) return;
    try {
      await save.mutateAsync({ body: { name: name.trim(), priceListId: null } });
      setName("");
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <UsersIcon className="size-4" /> {t("billing.pl.tab.groups")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <p className="text-meta text-muted-foreground">{t("billing.pl.groupsHint")}</p>
        {(groups.data?.items ?? []).map((g) => (
          <div key={g.id} className="grid gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => setOpen(open === g.id ? null : g.id)}>
                {g.name} <span className="text-meta font-normal text-muted-foreground">· {t("billing.pl.customersN", { count: g.customerCount })}</span>
              </button>
              <Select
                value={g.priceListId ?? NONE}
                disabled={!canEdit}
                onValueChange={(v) => void save.mutateAsync({ id: g.id, body: { name: g.name, priceListId: v === NONE ? null : v } }).catch((err: unknown) => toast.error(describeError(err, t)))}
              >
                <SelectTrigger size="sm" className="min-w-40" aria-label={t("billing.pl.customer.list")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("billing.pl.picker.none")}</SelectItem>
                  {(lists.data?.items ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t("billing.pl.deleteGroup", { name: g.name })}
                  onClick={() => window.confirm(t("billing.pl.confirmDeleteGroup", { name: g.name })) && void del.mutateAsync(g.id).catch((err: unknown) => toast.error(describeError(err, t)))}
                >
                  <Trash2Icon />
                </Button>
              )}
            </div>
            {open === g.id && <GroupMembers id={g.id} />}
          </div>
        ))}
        {canEdit && (
          <div className="flex gap-2">
            <Input value={name} maxLength={60} placeholder={t("billing.pl.groupPlaceholder")} aria-label={t("billing.pl.newGroup")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
            <Button variant="outline" disabled={save.isPending || !name.trim()} onClick={() => void create()}>
              <PlusIcon /> {t("billing.pl.newGroup")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GroupMembers({ id }: { id: string }) {
  const { t } = useI18n();
  const q = useGroupCustomers(id);
  if (!q.data) return <Loader2Icon className="animate-spin text-muted-foreground" />;
  if (q.data.items.length === 0) return <p className="text-meta text-muted-foreground">{t("billing.pl.noMembers")}</p>;
  return (
    <ul className="grid gap-1 text-sm">
      {q.data.items.map((c) => (
        <li key={c.id} className="flex justify-between gap-2">
          <span className="truncate">{c.name ?? "—"}</span>
          <span className="tabular-nums text-muted-foreground">{c.phone ?? ""}</span>
        </li>
      ))}
    </ul>
  );
}
