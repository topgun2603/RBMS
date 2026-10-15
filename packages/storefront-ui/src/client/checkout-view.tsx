"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BanknoteIcon, Loader2Icon, LockIcon, MapPinIcon, PencilIcon, PlusIcon, ShieldCheckIcon, SmartphoneIcon, TruckIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { RadioGroup, RadioGroupItem } from "@srirealtime/ui/components/radio-group";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatedNumber, AnimatePresence, motion, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { etaRange, money } from "../lib/format";
import type { Address, CheckoutResult, DeliveryOption, List } from "../types";
import { Empty, StoreImage } from "../components/bits";
import { EmptyBagArt } from "../components/illustrations";
import { CheckoutSkeleton } from "../components/skeletons";
import { PaymentIcons } from "../components/trust";
import { ApiError, call, errorMessage } from "./api";
import { track } from "./analytics";
import { AddressForm, AddressText } from "./address-form";
import { CartWarnings, CouponForm, Totals } from "./cart-view";
import { useOrderPayment } from "./payment";
import { OtpSignIn } from "./sign-in";
import { useStore } from "./store-context";

/** Step badge: the number, or a check that draws itself when the step completes. */
function StepBadge({ n, done }: { n: number; done?: boolean }) {
  const reduced = useReducedMotionSafe();
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center">
      <AnimatePresence initial={false} mode="popLayout">
        {done ? (
          <motion.svg
            key="done"
            viewBox="0 0 32 32"
            className="size-8 text-success"
            initial={{ scale: reduced ? 1 : 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 20 }}
            aria-hidden
          >
            <circle cx="16" cy="16" r="16" fill="currentColor" />
            <motion.path
              d="M9.5 16.5l4.2 4.2L22.5 11.5"
              fill="none"
              stroke="white"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: reduced ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduced ? 0 : 0.35, delay: reduced ? 0 : 0.12, ease: "easeOut" }}
            />
          </motion.svg>
        ) : (
          <motion.span key="n" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {n}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * A checkout step card. With `summary` + `collapsed`, a completed step folds down to a one-line summary with a Change
 * button (content stays mounted, just hidden, so form state survives).
 */
function Step({
  n,
  title,
  done,
  children,
  icon,
  summary,
  collapsed,
  onEdit,
  editLabel,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
  icon: React.ReactNode;
  summary?: React.ReactNode;
  collapsed?: boolean;
  onEdit?: () => void;
  editLabel?: string;
}) {
  const reduced = useReducedMotionSafe();
  const folded = !!collapsed && !!summary;
  return (
    <motion.section
      layout={reduced ? false : "position"}
      className={cn("rounded-3xl border bg-card p-5 shadow-[var(--elevation-1)] transition-colors sm:p-6", done && "border-success/30")}
      aria-labelledby={`step-${n}`}
    >
      <div className="flex items-center gap-3">
        <StepBadge n={n} done={done} />
        <h2 id={`step-${n}`} className="flex flex-1 items-center gap-2 font-display text-lg font-semibold">
          {title}
          <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        </h2>
        {folded && onEdit && (
          <Button variant="ghost" size="sm" className="rounded-full text-primary" onClick={onEdit}>
            <PencilIcon />
            {editLabel}
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {folded && (
          <motion.div key="summary" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="ps-11 pt-2 text-sm text-foreground/80">{summary}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        initial={false}
        animate={folded ? { height: 0, opacity: 0 } : { height: "auto", opacity: 1 }}
        transition={{ duration: reduced ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
        className={cn("overflow-hidden", folded && "pointer-events-none")}
        aria-hidden={folded || undefined}
        inert={folded || undefined}
      >
        <div className="pt-4">{children}</div>
      </motion.div>
    </motion.section>
  );
}

/** "Pay ₹1,299" with the amount counting to its new value (word order comes from the translation). */
function PayLabel({ template, amount }: { template: string; amount: number }) {
  const [before, after = ""] = template.split("\u0000");
  return (
    <span>
      {before}
      <AnimatedNumber value={amount} format={(n) => money(Math.round(n))} className="sf-price" />
      {after}
    </span>
  );
}

/** Selectable card for a RadioGroup option; the selection ring glides between cards (shared layout). */
function OptionCard({ value, group, selected, disabled, children, testId }: { value: string; group: string; selected: boolean; disabled?: boolean; children: React.ReactNode; testId?: string }) {
  const id = `${group}-${value}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative flex items-center gap-3 rounded-2xl border p-4 transition-colors",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-foreground/30",
        selected && "border-transparent",
      )}
    >
      {selected && <motion.span layoutId={`${group}-ring`} className="pointer-events-none absolute inset-0 rounded-2xl bg-primary/5 ring-2 ring-primary" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
      <RadioGroupItem id={id} value={value} disabled={disabled} className="relative size-5" data-testid={testId} />
      <span className="relative flex min-w-0 flex-1 items-center gap-3">{children}</span>
    </label>
  );
}

export function CheckoutView() {
  const { t, cart, auth, shell, locale } = useStore();
  const router = useRouter();
  const qc = useQueryClient();
  const c = cart.cart;
  const payment = useOrderPayment();

  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => call<List<Address>>("/store/me/addresses"), enabled: !!auth.token });
  const [addressId, setAddressId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [optionId, setOptionId] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState<"online" | "cod">("online");
  const [note, setNote] = React.useState("");
  const [placing, setPlacing] = React.useState(false);
  const [issues, setIssues] = React.useState<string[]>([]);
  const [placed, setPlaced] = React.useState(false);
  const [editAddress, setEditAddress] = React.useState(false);
  const begun = React.useRef(false);

  const list = addresses.data?.items ?? [];
  const address = list.find((a) => a.id === addressId) ?? null;

  React.useEffect(() => {
    if (c && c.lines.length && !begun.current) {
      begun.current = true;
      track({ type: "begin_checkout", value: c.total });
    }
  }, [c]);

  // Pick the default address once they load; open the form when there are none.
  React.useEffect(() => {
    if (!addresses.data) return;
    if (!addressId) {
      const d = addresses.data.items.find((a) => a.isDefault) ?? addresses.data.items[0];
      if (d) setAddressId(d.id);
      else setAdding(true);
    }
  }, [addresses.data, addressId]);

  // Delivery options for the chosen address's PIN code (cart pincode → priced delivery options).
  const pincode = address?.pincode ?? null;
  React.useEffect(() => {
    if (!pincode || !cart.token) return;
    if (c?.pincode === pincode && c.delivery) return;
    cart.setPincode(pincode).catch((err) => toast.error(errorMessage(err, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pincode, cart.token]);

  const options: DeliveryOption[] = c?.pincode === pincode && c?.delivery?.serviceable ? c.delivery.options : [];
  React.useEffect(() => {
    if (!options.length) return setOptionId(null);
    if (!optionId || !options.some((o) => o.id === optionId)) setOptionId(options.slice().sort((a, b) => a.amount - b.amount)[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.map((o) => o.id).join(",")]);
  const option = options.find((o) => o.id === optionId) ?? null;

  const freeShip = !!c?.coupon?.valid && c.coupon.freeShipping;
  const shipping = option ? (freeShip ? 0 : option.amount) : null;
  const goodsTotal = c ? c.total + (c.taxExtra ?? 0) : 0;
  const codPossible = shell.codEnabled && !!option?.codAllowed;
  const codFee = method === "cod" && option ? option.codFee : 0;
  const estimated = goodsTotal + (shipping ?? 0) + codFee;
  const codOverMax = shell.codMaxAmount > 0 && goodsTotal + (shipping ?? 0) + (option?.codFee ?? 0) > shell.codMaxAmount;
  const codAvailable = codPossible && !codOverMax;
  React.useEffect(() => {
    if (method === "cod" && !codAvailable) setMethod("online");
  }, [codAvailable, method]);

  if (placed) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center" role="status">
        <span className="relative flex size-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/15 motion-reduce:hidden" />
          <Loader2Icon className="size-10 animate-spin text-primary" />
        </span>
        <p className="font-heading text-lg font-semibold">{t("pay.verifying")}</p>
        {payment.sheet}
      </div>
    );
  }
  if (!cart.ready && !c) {
    return <CheckoutSkeleton bare />;
  }
  if (!c || c.lines.length === 0) {
    return (
      <Empty
        className="mx-auto max-w-lg"
        illustration={<EmptyBagArt />}
        title={t("cart.empty")}
        body={t("checkout.emptyCart")}
        action={
          <Button asChild size="lg" className="rounded-full px-8">
            <Link href={STORE_PATHS.products}>{t("cart.startShopping")}</Link>
          </Button>
        }
      />
    );
  }

  const blocked = c.lines.some((l) => !l.available || l.problem === "qty_reduced");
  const canPlace = !!auth.token && !!address && !!option && !blocked && shell.open && !placing;

  const place = async () => {
    if (!canPlace || !address || !option || !cart.token) return;
    setPlacing(true);
    setIssues([]);
    try {
      const r = await call<CheckoutResult>("/store/checkout", {
        body: { cartToken: cart.token, addressId: address.id, deliveryOptionId: option.id, paymentMethod: method, ...(note.trim() ? { customerNote: note.trim() } : {}) },
      });
      setPlaced(true);
      cart.reset();
      void qc.invalidateQueries({ queryKey: ["orders"] });
      if (r.payment) {
        const outcome = await payment.pay(r.payment.ref);
        if (outcome !== "paid") toast.info(t("checkout.payLater"));
      }
      router.push(`/order/${encodeURIComponent(r.accessToken)}`);
    } catch (err) {
      if (err instanceof ApiError && (err.details as { issues?: { message: string }[] })?.issues?.length) {
        setIssues((err.details as { issues: { message: string }[] }).issues.map((i) => i.message));
      } else toast.error(errorMessage(err, t));
      void cart.refresh();
      setPlacing(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_400px] lg:gap-10">
      <div className="grid content-start gap-5">
        {/* 1 — account */}
        {!auth.ready ? (
          <div className="sf-shimmer h-32 rounded-3xl" />
        ) : !auth.token ? (
          <Step n={1} title={t("checkout.signInFirst")} icon={<LockIcon />}>
            <div className="mx-auto max-w-sm py-2">
              <OtpSignIn compact onSignedIn={() => toast.success(t("checkout.merged"))} />
            </div>
          </Step>
        ) : (
          <>
            {/* 1 — address */}
            <Step
              n={1}
              title={t("checkout.address")}
              done={!!address && !adding}
              icon={<MapPinIcon />}
              collapsed={!!address && !adding && !editAddress}
              summary={address ? <AddressText a={address} /> : null}
              onEdit={() => setEditAddress(true)}
              editLabel={t("checkout.change")}
            >
              {addresses.isLoading ? (
                <div className="sf-shimmer h-24 rounded-2xl" />
              ) : (
                <div className="grid gap-3">
                  {list.length > 0 && !adding && (
                    <form onSubmit={(e) => e.preventDefault()}>
                      <RadioGroup
                        name="address"
                        value={addressId ?? ""}
                        onValueChange={(v) => {
                          setAddressId(v);
                          setEditAddress(false);
                        }}
                        className="grid gap-2"
                        aria-label={t("checkout.chooseAddress")}
                      >
                        {list.map((a) => (
                          <OptionCard key={a.id} group="address" value={a.id} selected={addressId === a.id}>
                            <span className="min-w-0 flex-1">
                              {a.label && <span className="mb-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase">{a.label}</span>}
                              <AddressText a={a} />
                            </span>
                          </OptionCard>
                        ))}
                      </RadioGroup>
                    </form>
                  )}
                  {adding ? (
                    <AddressForm
                      onSaved={(a) => {
                        setAdding(false);
                        setAddressId(a.id);
                        setEditAddress(false);
                        void qc.invalidateQueries({ queryKey: ["addresses"] });
                      }}
                      onCancel={list.length ? () => setAdding(false) : undefined}
                      defaults={{ name: auth.user?.name ?? "", phone: auth.user?.phone?.replace(/^\+91/, "") ?? "" }}
                      submitLabel={t("checkout.useAddress")}
                    />
                  ) : (
                    <Button variant="outline" className="justify-self-start rounded-full" onClick={() => setAdding(true)}>
                      <PlusIcon />
                      {t("checkout.addAddress")}
                    </Button>
                  )}
                </div>
              )}
            </Step>

            {/* 2 — delivery */}
            <Step n={2} title={t("checkout.delivery")} done={!!option} icon={<TruckIcon />}>
              {!address ? (
                <p className="text-sm text-muted-foreground">{t("checkout.chooseAddress")}</p>
              ) : cart.loading && !options.length ? (
                <div className="sf-shimmer h-16 rounded-2xl" />
              ) : !options.length ? (
                <p className="text-sm text-danger-ink">{c.delivery && !c.delivery.serviceable ? t("delivery.notServiceable", { pincode: address.pincode }) : t("checkout.noOptions")}</p>
              ) : (
                <form onSubmit={(e) => e.preventDefault()}>
                  <RadioGroup name="delivery" value={optionId ?? ""} onValueChange={setOptionId} className="grid gap-2" aria-label={t("checkout.chooseOption")}>
                    {options.map((o) => (
                      <OptionCard key={o.id} group="delivery" value={o.id} selected={optionId === o.id}>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold">{o.name}</span>
                          <span className="block text-xs text-muted-foreground">{t("delivery.by", { date: etaRange(o.etaDays, locale) })}</span>
                        </span>
                        <span className={cn("text-sm font-semibold tabular-nums", (o.amount === 0 || freeShip) && "text-success-ink")}>{o.amount === 0 || freeShip ? t("delivery.free") : money(o.amount)}</span>
                      </OptionCard>
                    ))}
                  </RadioGroup>
                </form>
              )}
            </Step>

            {/* 3 — payment */}
            <Step n={3} title={t("checkout.payment")} icon={<LockIcon />}>
              <form onSubmit={(e) => e.preventDefault()}>
                <RadioGroup name="pay" value={method} onValueChange={(v) => setMethod(v as "online" | "cod")} className="grid gap-2" aria-label={t("checkout.payment")}>
                  <OptionCard group="pay" value="online" selected={method === "online"} testId="pay-online">
                    <SmartphoneIcon className="size-5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{t("checkout.online")}</span>
                      <span className="block text-xs text-muted-foreground">{t("checkout.onlineHint")}</span>
                      <PaymentIcons t={t} cod={false} className="mt-2" />
                    </span>
                  </OptionCard>
                  {shell.codEnabled && (
                    <OptionCard group="pay" value="cod" selected={method === "cod"} disabled={!codAvailable} testId="pay-cod">
                      <BanknoteIcon className="size-5 shrink-0 text-primary" />
                      <span className="flex-1">
                        <span className="block text-sm font-semibold">{t("checkout.cod")}</span>
                        <span className="block text-xs text-muted-foreground">{codAvailable ? t("checkout.codHint") : t("checkout.codUnavailable")}</span>
                      </span>
                      {codAvailable && option && option.codFee > 0 && <span className="text-xs font-semibold text-muted-foreground">+{money(option.codFee)}</span>}
                    </OptionCard>
                  )}
                </RadioGroup>
              </form>
              <div className="mt-4 grid gap-1.5">
                <label htmlFor="checkout-note" className="text-sm font-medium">
                  {t("checkout.note")}
                </label>
                <textarea id="checkout-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-[3px] focus:ring-ring/30" />
              </div>
            </Step>
          </>
        )}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label={t("checkout.summary")}>
        <div className="grid gap-5 rounded-3xl border bg-card p-5 shadow-[var(--elevation-1)] sm:p-6">
          <h2 className="font-heading text-lg font-semibold">{t("checkout.summary")}</h2>
          <CartWarnings cart={c} />
          <ul className="grid max-h-72 gap-3 overflow-y-auto">
            {c.lines.map((l) => (
              <li key={l.variantId} className="flex items-center gap-3">
                <span className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                  <StoreImage src={l.image} alt={l.name} />
                  <span className="absolute -top-0 -right-0 flex size-5 items-center justify-center rounded-bl-lg bg-foreground/80 text-[10px] font-bold text-background">{l.qty}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm font-medium">{l.name}</span>
                  {l.variantTitle && <span className="block text-xs text-muted-foreground">{l.variantTitle}</span>}
                  {!l.available && <span className="block text-xs text-danger-ink">{t("product.outOfStock")}</span>}
                </span>
                <span className="text-sm font-semibold tabular-nums">{money(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <CouponForm cart={c} />
          <Totals cart={c} shipping={shipping} codFee={codFee} />
          {issues.length > 0 && (
            <ul className="grid gap-1 rounded-xl bg-destructive/10 p-3 text-sm text-danger-ink" role="alert">
              {issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          {!shell.open && <p className="text-sm text-warning-ink">{shell.closedMessage || t("store.closed")}</p>}
          <motion.div whileTap={canPlace ? { scale: 0.98 } : undefined}>
            <Button size="lg" className="relative h-13 w-full overflow-hidden rounded-full bg-[image:var(--sf-gradient)] text-base" disabled={!canPlace || payment.busy} onClick={place} data-testid="place-order" aria-busy={placing || payment.busy}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={placing || payment.busy ? "busy" : "idle"} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ duration: 0.18 }} className="flex items-center gap-2">
                  {placing || payment.busy ? <Loader2Icon className="animate-spin" /> : <LockIcon />}
                  {placing ? (
                    t("checkout.placing")
                  ) : method === "online" ? (
                    <PayLabel template={t("checkout.pay", { amount: "\u0000" })} amount={estimated} />
                  ) : (
                    t("checkout.place")
                  )}
                </motion.span>
              </AnimatePresence>
            </Button>
          </motion.div>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheckIcon className="size-3.5 text-success-ink" />
            {t("checkout.secure")}
          </p>
        </div>
      </aside>
      {payment.sheet}
    </div>
  );
}
