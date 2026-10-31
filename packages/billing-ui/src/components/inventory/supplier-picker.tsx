"use client";

import * as React from "react";
import { Loader2Icon, PlusIcon, SearchIcon, StoreIcon, XIcon } from "lucide-react";
import { isValidGstin, stateFromGstin } from "@rbms/gst";
import { AnimatePresence, Button, cn, InitialsAvatar, Input, Label, motion } from "@rbms/ui";
import { SupplierDialog } from "./supplier-dialog";
import { StateSelect } from "../state-select";
import { money, stateLabel } from "../../lib/format";
import { useDebounced, useI18n } from "@rbms/web";
import { useSuppliers } from "../../lib/queries-v2";
import type { Supplier } from "../../lib/types";

export type SupplierParty =
  | { kind: "none" }
  | { kind: "saved"; supplier: Supplier }
  | { kind: "oneoff"; name: string; gstin: string; stateCode: string };

export const supplierPartyState = (p: SupplierParty) =>
  (p.kind === "saved" ? p.supplier.stateCode : p.kind === "oneoff" ? p.stateCode : null) || "";

const fade = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15 },
};

/** Supplier search with quick-add, or a one-off supplier typed in for this bill only. */
export function SupplierPicker({
  value,
  onChange,
  invalid,
}: {
  value: SupplierParty;
  onChange: (p: SupplierParty) => void;
  invalid?: boolean;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = React.useState<{ open: boolean; name?: string }>({ open: false });

  return (
    <div className="grid gap-2">
      <AnimatePresence mode="wait" initial={false}>
        {value.kind === "saved" ? (
          <motion.div key={`saved-${value.supplier.id}`} {...fade} className="flex items-start gap-3 rounded-xl border bg-primary/5 p-3">
            <InitialsAvatar name={value.supplier.name} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-semibold">{value.supplier.name}</p>
              <p className="mt-0.5 truncate text-meta text-muted-foreground">
                {[value.supplier.phone, value.supplier.stateCode && stateLabel(value.supplier.stateCode)].filter(Boolean).join(" · ") ||
                  t("billing.picker.noDetails")}
              </p>
              {value.supplier.gstin && <p className="font-mono text-xs">GSTIN {value.supplier.gstin}</p>}
              {value.supplier.payable > 0 && (
                <p className="mt-1 text-xs font-medium text-warning-ink">
                  {t("billing.suppliers.payableNote", { amount: money(value.supplier.payable) })}
                </p>
              )}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={t("billing.supplierPicker.change")} onClick={() => onChange({ kind: "none" })}>
              <XIcon />
            </Button>
          </motion.div>
        ) : value.kind === "oneoff" ? (
          <motion.div key="oneoff" {...fade} className="grid gap-3 rounded-xl border border-dashed p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <StoreIcon className="size-3.5" /> {t("billing.supplierPicker.oneOff")}
              </span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ open: true, name: value.name })}>
                  <PlusIcon /> {t("billing.supplierPicker.saveAsSupplier")}
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("billing.supplierPicker.change")} onClick={() => onChange({ kind: "none" })}>
                  <XIcon />
                </Button>
              </div>
            </div>
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1.5 sm:col-span-2">
                <Label htmlFor="oneoff-name" className="text-xs">
                  {t("billing.suppliers.name")}
                </Label>
                <Input
                  id="oneoff-name"
                  autoFocus={!value.name}
                  autoComplete="off"
                  value={value.name}
                  aria-invalid={invalid && !value.name.trim()}
                  onChange={(e) => onChange({ ...value, name: e.target.value })}
                />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="oneoff-gstin" className="text-xs">
                  {t("billing.supplierPicker.gstinOptional")}
                </Label>
                <Input
                  id="oneoff-gstin"
                  className="font-mono uppercase"
                  maxLength={15}
                  autoComplete="off"
                  spellCheck={false}
                  value={value.gstin}
                  aria-invalid={!!value.gstin && !isValidGstin(value.gstin)}
                  aria-describedby={!!value.gstin && !isValidGstin(value.gstin) ? "oneoff-gstin-err" : undefined}
                  onChange={(e) => {
                    const gstin = e.target.value.toUpperCase().replace(/\s/g, "");
                    const st = isValidGstin(gstin) ? stateFromGstin(gstin) : null;
                    onChange({ ...value, gstin, stateCode: st ?? value.stateCode });
                  }}
                />
                {!!value.gstin && !isValidGstin(value.gstin) && <p id="oneoff-gstin-err" className="text-xs text-destructive">{t("billing.validation.gstin")}</p>}
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="oneoff-state" className="text-xs">
                  {t("billing.customers.state")}
                </Label>
                <StateSelect id="oneoff-state" value={value.stateCode} onChange={(stateCode) => onChange({ ...value, stateCode })} className="w-full" />
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            <SupplierSearch
              invalid={invalid}
              onPick={(s) => onChange({ kind: "saved", supplier: s })}
              onOneOff={(name) => onChange({ kind: "oneoff", name, gstin: "", stateCode: "" })}
              onCreate={(name) => setDialog({ open: true, name })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <SupplierDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        initial={
          value.kind === "oneoff"
            ? { name: value.name, gstin: value.gstin || null, stateCode: value.stateCode || null }
            : { name: dialog.name ?? "" }
        }
        onSaved={(s) => onChange({ kind: "saved", supplier: s })}
      />
    </div>
  );
}

type Option = { type: "supplier"; supplier: Supplier } | { type: "create"; label: string } | { type: "oneoff"; label: string };

function SupplierSearch({
  onPick,
  onCreate,
  onOneOff,
  invalid,
}: {
  onPick: (s: Supplier) => void;
  onCreate: (name: string) => void;
  onOneOff: (name: string) => void;
  invalid?: boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const debounced = useDebounced(q.trim(), 200);
  const { data, isFetching } = useSuppliers(debounced);
  const listId = React.useId();
  const name = q.trim();

  const options: Option[] = [
    ...(data?.items ?? []).slice(0, 8).map((s) => ({ type: "supplier" as const, supplier: s })),
    { type: "create" as const, label: name ? t("billing.supplierPicker.addNew", { name }) : t("billing.suppliers.add") },
    { type: "oneoff" as const, label: name ? t("billing.supplierPicker.useOnce", { name }) : t("billing.supplierPicker.oneOffOption") },
  ];

  React.useEffect(() => setActive(0), [debounced]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    setOpen(false);
    if (o.type === "supplier") onPick(o.supplier);
    else if (o.type === "create") onCreate(name);
    else onOneOff(name);
  };

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={t("billing.supplierPicker.search")}
        aria-invalid={invalid}
        placeholder={t("billing.supplierPicker.search")}
        className="pl-9 text-base"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(options.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {isFetching && <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {options.map((o, i) => (
              <li
                key={o.type === "supplier" ? o.supplier.id : o.type}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm",
                  i === active && "bg-accent text-accent-foreground",
                  o.type !== "supplier" && "text-primary",
                )}
              >
                {o.type === "supplier" ? (
                  <>
                    <InitialsAvatar name={o.supplier.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{o.supplier.name}</p>
                      <p className="mt-0.5 truncate text-meta text-muted-foreground">{[o.supplier.phone, o.supplier.gstin].filter(Boolean).join(" · ")}</p>
                    </div>
                    {o.supplier.payable > 0 && <span className="text-xs font-medium text-warning-ink tabular-nums">{money(o.supplier.payable)}</span>}
                  </>
                ) : o.type === "create" ? (
                  <>
                    <PlusIcon className="size-4" /> <span className="truncate">{o.label}</span>
                  </>
                ) : (
                  <>
                    <StoreIcon className="size-4" /> <span className="truncate">{o.label}</span>
                  </>
                )}
              </li>
            ))}
            {data && data.items.length === 0 && debounced && (
              <li className="px-2.5 py-2 text-xs text-muted-foreground" role="presentation">
                {t("billing.supplierPicker.noMatch")}
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
