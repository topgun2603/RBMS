"use client";

import * as React from "react";
import { BanknoteIcon, Loader2Icon, SearchIcon, UserPlusIcon, UserRoundIcon, XIcon } from "lucide-react";
import { isValidGstin, stateFromGstin } from "@srirealtime/gst";
import { AnimatePresence, Badge, Button, cn, InitialsAvatar, Input, Label, motion } from "@srirealtime/ui";
import { CustomerDialog } from "./customer-dialog";
import { money, stateLabel } from "../lib/format";
import { useDebounced, useI18n } from "@srirealtime/web";
import { useCustomers } from "../lib/queries";
import type { Customer } from "../lib/types";

export type Party =
  | { kind: "none" }
  | { kind: "saved"; customer: Customer }
  | { kind: "walkin"; name: string; phone: string; gstin: string; stateCode: string };

export const walkIn = (name = "", phone = ""): Party => ({ kind: "walkin", name, phone, gstin: "", stateCode: "" });

/** Customer search with quick-add, or a walk-in buyer by name/phone. */
export function CustomerPicker({
  value,
  onChange,
  invalid,
}: {
  value: Party;
  onChange: (p: Party) => void;
  invalid?: boolean;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = React.useState<{ open: boolean; name?: string; phone?: string }>({ open: false });

  return (
    <div className="grid gap-2">
      <AnimatePresence mode="wait" initial={false}>
        {value.kind === "saved" ? (
          <motion.div
            key={`saved-${value.customer.id}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.05] p-3"
          >
            <InitialsAvatar name={value.customer.name} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-semibold">{value.customer.name}</p>
              <p className="mt-0.5 truncate text-meta text-muted-foreground">
                {[value.customer.phone, value.customer.stateCode && stateLabel(value.customer.stateCode)].filter(Boolean).join(" · ") ||
                  t("billing.picker.noDetails")}
              </p>
              {value.customer.gstin && <p className="font-mono text-xs">GSTIN {value.customer.gstin}</p>}
              {value.customer.outstanding > 0 && (
                <p className="mt-1 text-xs font-medium text-warning-ink">
                  {t("billing.picker.outstanding", { amount: money(value.customer.outstanding) })}
                </p>
              )}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={t("billing.picker.change")} onClick={() => onChange({ kind: "none" })}>
              <XIcon />
            </Button>
          </motion.div>
        ) : value.kind === "walkin" ? (
          <motion.div
            key="walkin"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="grid gap-3 rounded-xl border border-dashed p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <UserRoundIcon className="size-3.5" /> {t("billing.picker.walkIn")}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDialog({ open: true, name: value.name, phone: value.phone })}
                >
                  <UserPlusIcon /> {t("billing.picker.saveAsCustomer")}
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("billing.picker.change")} onClick={() => onChange({ kind: "none" })}>
                  <XIcon />
                </Button>
              </div>
            </div>
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="walkin-name" className="text-xs">
                  {t("billing.picker.name")}
                </Label>
                <Input
                  id="walkin-name"
                  autoFocus={!value.name}
                  autoComplete="off"
                  value={value.name}
                  aria-invalid={invalid && !value.name.trim()}
                  onChange={(e) => onChange({ ...value, name: e.target.value })}
                />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="walkin-phone" className="text-xs">
                  {t("billing.picker.phone")}
                </Label>
                <Input
                  id="walkin-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={value.phone}
                  onChange={(e) => onChange({ ...value, phone: e.target.value })}
                />
              </div>
              <div className="grid content-start gap-1.5 sm:col-span-2">
                <Label htmlFor="walkin-gstin" className="text-xs">
                  {t("billing.picker.gstinOptional")}
                </Label>
                <Input
                  id="walkin-gstin"
                  className="font-mono uppercase"
                  maxLength={15}
                  autoComplete="off"
                  spellCheck={false}
                  value={value.gstin}
                  aria-invalid={!!value.gstin && !isValidGstin(value.gstin)}
                  aria-describedby={!!value.gstin && !isValidGstin(value.gstin) ? "walkin-gstin-err" : undefined}
                  onChange={(e) => {
                    const gstin = e.target.value.toUpperCase().replace(/\s/g, "");
                    const st = isValidGstin(gstin) ? stateFromGstin(gstin) : null;
                    onChange({ ...value, gstin, stateCode: st ?? value.stateCode });
                  }}
                />
                {!!value.gstin && !isValidGstin(value.gstin) && (
                  <p id="walkin-gstin-err" className="text-xs text-destructive">{t("billing.validation.gstin")}</p>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            <CustomerSearch
              invalid={invalid}
              onPick={(c) => onChange({ kind: "saved", customer: c })}
              onWalkIn={(name) => onChange(walkIn(name))}
              onCreate={(name) => setDialog({ open: true, name: /^[\d\s+-]+$/.test(name) ? "" : name, phone: /^[\d\s+-]+$/.test(name) ? name : "" })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <CustomerDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        initial={{ name: dialog.name ?? "", phone: dialog.phone ?? "" }}
        onSaved={(c) => onChange({ kind: "saved", customer: c })}
      />
    </div>
  );
}

type Option =
  | { type: "customer"; customer: Customer }
  | { type: "create"; label: string }
  | { type: "walkin"; label: string; name: string };

function CustomerSearch({
  onPick,
  onCreate,
  onWalkIn,
  invalid,
}: {
  onPick: (c: Customer) => void;
  onCreate: (name: string) => void;
  onWalkIn: (name: string) => void;
  invalid?: boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const debounced = useDebounced(q.trim(), 200);
  const { data, isFetching } = useCustomers(debounced, 8);
  const listId = React.useId();

  const options: Option[] = [
    ...(data?.items ?? []).map((c) => ({ type: "customer" as const, customer: c })),
    ...(q.trim() ? [{ type: "create" as const, label: t("billing.picker.addNew", { name: q.trim() }) }] : []),
    {
      type: "walkin" as const,
      name: q.trim() || t("billing.picker.cashName"),
      label: q.trim() ? t("billing.picker.billWalkIn", { name: q.trim() }) : t("billing.picker.cashSale"),
    },
  ];

  React.useEffect(() => setActive(0), [debounced]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    setOpen(false);
    if (o.type === "customer") onPick(o.customer);
    else if (o.type === "create") onCreate(q.trim());
    else onWalkIn(o.name);
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
        aria-label={t("billing.picker.search")}
        aria-invalid={invalid}
        placeholder={t("billing.picker.search")}
        className="rounded-xl pl-9 text-base sm:text-sm"
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
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-raised"
          >
            {options.map((o, i) => (
              <li
                key={o.type === "customer" ? o.customer.id : o.type}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm",
                  i === active && "bg-accent text-accent-foreground",
                  o.type !== "customer" && "text-primary",
                )}
              >
                {o.type === "customer" ? (
                  <>
                    <InitialsAvatar name={o.customer.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{o.customer.name}</p>
                      <p className="mt-0.5 truncate text-meta text-muted-foreground">
                        {[o.customer.phone, o.customer.gstin].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {o.customer.outstanding > 0 && (
                      <Badge variant="warning" className="tabular-nums">
                        {money(o.customer.outstanding)}
                      </Badge>
                    )}
                  </>
                ) : o.type === "create" ? (
                  <>
                    <UserPlusIcon className="size-4" /> <span className="truncate">{o.label}</span>
                  </>
                ) : (
                  <>
                    <BanknoteIcon className="size-4" /> <span className="truncate">{o.label}</span>
                  </>
                )}
              </li>
            ))}
            {data && data.items.length === 0 && debounced && (
              <li className="px-2.5 py-2 text-xs text-muted-foreground" role="presentation">
                {t("billing.picker.noMatch")}
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
