"use client";

import * as React from "react";
import { AwardIcon, Loader2Icon, PhoneIcon, UserPlusIcon, UserRoundIcon, XIcon } from "lucide-react";
import {
  AnimatePresence,
  Badge,
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
  FieldLabel,
  InitialsAvatar,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  motion,
  toast,
} from "@rbms/ui";
import { describeError, useDebounced, useI18n } from "@rbms/web";
import { createCustomer, isNetworkError, useCustomerSearch } from "../lib/api";
import { mobileDigits, money } from "../lib/format";
import { reportNetwork } from "../lib/online";
import type { Customer, LoyaltyQuote, PosCustomer } from "../lib/types";
import { usePos } from "./pos-context";

export interface CustomerBarProps {
  value: PosCustomer;
  onChange: (c: PosCustomer) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  quote: LoyaltyQuote | undefined;
  quoteLoading: boolean;
}

/** Customer by mobile: pick a saved customer, add one on the spot, or bill a walk-in with just the number. */
export function CustomerBar({ value, onChange, inputRef, quote, quoteLoading }: CustomerBarProps) {
  const { t } = useI18n();
  const { has } = usePos();
  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState<{ phone: string; name: string } | null>(null);
  const q = useDebounced(text.trim(), 200);
  const search = useCustomerSearch(open ? q : "");
  const digits = mobileDigits(text);

  React.useEffect(() => {
    if (value.kind === "none") setText("");
  }, [value.kind]);

  const pick = (c: Customer) => {
    onChange({ kind: "saved", customer: c });
    setOpen(false);
  };

  const loyalty = has.loyalty && quote?.member ? quote.member : null;

  return (
    <div className="relative">
      <AnimatePresence mode="wait" initial={false}>
        {value.kind === "none" ? (
          <motion.div key="search" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
            <Field>
              <FieldLabel className="sr-only">{t("pos.customer.label")}</FieldLabel>
              <InputGroup size="lg" className="bg-card">
                <InputGroupAddon>
                  <PhoneIcon />
                </InputGroupAddon>
                <FieldControl>
                  <InputGroupInput
                    ref={inputRef}
                    value={text}
                    inputMode="tel"
                    autoComplete="off"
                    placeholder={t("pos.customer.placeholder")}
                    onChange={(e) => {
                      setText(e.target.value);
                      setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => window.setTimeout(() => setOpen(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const first = search.data?.items[0];
                        if (first) pick(first);
                        else if (digits) setAdding({ phone: digits, name: "" });
                      } else if (e.key === "Escape") {
                        setOpen(false);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </FieldControl>
                <InputGroupAddon className="hidden sm:flex">
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem]">F4</kbd>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </motion.div>
        ) : (
          <motion.div
            key={value.kind === "saved" ? value.customer.id : "walkin"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.05] px-3 py-2"
          >
            {value.kind === "saved" ? <InitialsAvatar name={value.customer.name} size="sm" /> : <UserRoundIcon className="size-8 rounded-full bg-muted p-1.5 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {value.kind === "saved" ? value.customer.name : value.name || t("pos.customer.walkIn")}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="tabular-nums">{value.kind === "saved" ? (value.customer.phone ?? t("pos.customer.noPhone")) : value.phone}</span>
                {value.kind === "saved" && value.customer.outstanding > 0 && (
                  <span className="font-medium text-warning-ink">{t("pos.customer.due", { amount: money(value.customer.outstanding) })}</span>
                )}
              </p>
            </div>
            {has.loyalty &&
              (quoteLoading && !quote ? (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ) : loyalty ? (
                <Badge variant="secondary" className="gap-1 tabular-nums" title={t("pos.loyalty.tier", { tier: loyalty.tier })}>
                  <AwardIcon /> {loyalty.tier} · {t("pos.loyalty.points", { count: loyalty.pointsBalance })}
                </Badge>
              ) : null)}
            {value.kind === "walkin" && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("pos.customer.save")} title={t("pos.customer.save")} onClick={() => setAdding({ phone: value.phone, name: value.name })}>
                <UserPlusIcon />
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("pos.customer.clear")} onClick={() => onChange({ kind: "none" })}>
              <XIcon />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {open && value.kind === "none" && q.length >= 3 && (
        <div
          role="listbox"
          aria-label={t("pos.customer.matches")}
          className="absolute inset-x-0 top-full z-30 mt-1 grid max-h-72 gap-0.5 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {search.isFetching && !search.data && <p className="px-3 py-2 text-sm text-muted-foreground">{t("pos.common.searching")}</p>}
          {search.data?.items.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => pick(c)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <InitialsAvatar name={c.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground tabular-nums">{c.phone ?? "—"}</span>
              </span>
              {c.outstanding > 0 && <span className="text-xs font-medium text-warning-ink">{money(c.outstanding)}</span>}
            </button>
          ))}
          {search.data && search.data.items.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{t("pos.customer.none")}</p>}
          <div className="mt-1 grid gap-1 border-t pt-1 sm:grid-cols-2">
            <Button type="button" variant="ghost" className="justify-start" onClick={() => setAdding({ phone: digits ?? "", name: /\d/.test(q) ? "" : q })}>
              <UserPlusIcon /> {t("pos.customer.add")}
            </Button>
            {digits && (
              <Button
                type="button"
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  onChange({ kind: "walkin", name: "", phone: digits });
                  setOpen(false);
                }}
              >
                <UserRoundIcon /> {t("pos.customer.useWalkIn")}
              </Button>
            )}
          </div>
        </div>
      )}

      <QuickAddDialog
        initial={adding}
        onClose={() => setAdding(null)}
        onSaved={(c) => {
          setAdding(null);
          setOpen(false);
          onChange({ kind: "saved", customer: c });
        }}
      />
    </div>
  );
}

function QuickAddDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: { phone: string; name: string } | null;
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (initial) {
      setName(initial.name);
      setPhone(initial.phone);
      setTouched(false);
    }
  }, [initial]);
  const phoneOk = phone.trim() === "" || mobileDigits(phone) !== null;
  const nameOk = name.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!nameOk || !phoneOk) return;
    setBusy(true);
    try {
      const d = mobileDigits(phone);
      const c = await createCustomer({ name: name.trim(), phone: d ? `+91${d}` : null });
      reportNetwork(true);
      toast.success(t("pos.customer.added", { name: c.name }));
      onSaved(c);
    } catch (err) {
      if (isNetworkError(err)) reportNetwork(false);
      toast.error(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={initial !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("pos.common.close")}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("pos.customer.addTitle")}</DialogTitle>
            <DialogDescription>{t("pos.customer.addBody")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>{t("pos.customer.name")}</FieldLabel>
            <FieldControl>
              <Input size="lg" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
            </FieldControl>
            <FieldError>{touched && !nameOk ? t("pos.customer.nameRequired") : null}</FieldError>
          </Field>
          <Field>
            <FieldLabel optional={t("pos.common.optional")}>{t("pos.customer.mobile")}</FieldLabel>
            <InputGroup size="lg">
              <InputGroupAddon>+91</InputGroupAddon>
              <FieldControl>
                <InputGroupInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" />
              </FieldControl>
            </InputGroup>
            <FieldError>{touched && !phoneOk ? t("pos.customer.phoneInvalid") : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              {t("pos.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />} {t("pos.customer.saveAndUse")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
