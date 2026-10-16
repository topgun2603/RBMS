"use client";

import * as React from "react";
import {
  CheckCircle2Icon,
  Loader2Icon,
  MapPinIcon,
  MinusIcon,
  NotebookPenIcon,
  PlusIcon,
  ShoppingCartIcon,
  TicketPercentIcon,
  Trash2Icon,
  TruckIcon,
  UserIcon,
  WalletIcon,
  AlertTriangleIcon,
  ShoppingBagIcon,
  LockIcon,
} from "lucide-react";
import { GST_STATES } from "@srirealtime/gst";
import {
  AnimatePresence,
  Button,
  ChipGroup,
  cn,
  controlHeight,
  EmptyState,
  Input,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { describeError, Page, PageHeading, useFeature, useI18n, useModuleNavigate } from "@srirealtime/web";
import { Field, MoneyInput, ReadOnlyNote, Section, Thumb, TotalRow } from "../components/bits";
import { VariantPicker } from "../components/variant-picker";
import { PERMS, usePermissions } from "../lib/access";
import { cleanQty, digitsOnly, formatGrams, money, normalizeCode, orNull, paiseToInput, parseQty, rupeesToPaise } from "../lib/format";
import { quoteDelivery, useCreateOrder, usePincode, validateCoupon } from "../lib/queries";
import type { CouponEvaluation, DeliveryOption, ManualOrderInput, OrderPaymentMethod, VariantLookup } from "../lib/types";

interface Line {
  key: string;
  variant: VariantLookup;
  qty: string;
  price: string;
}

const METHODS: OrderPaymentMethod[] = ["cash", "upi", "card", "cod", "online", "other"];
const PAID_NOW: OrderPaymentMethod[] = ["cash", "upi", "card", "other"];
const PHONE_RE = /^\+?[0-9][0-9 ()-]{5,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = Partial<Record<"name" | "phone" | "email" | "line1" | "city" | "stateCode" | "pincode" | "lines" | "shipping", string>>;

export default function NewOrderPage() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const { can } = usePermissions();
  const deliveryOn = useFeature("delivery");
  const couponsOn = useFeature("coupons");
  const create = useCreateOrder();

  // customer
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  // address
  const [ship, setShip] = React.useState(true);
  const [pincode, setPincode] = React.useState("");
  const [line1, setLine1] = React.useState("");
  const [line2, setLine2] = React.useState("");
  const [landmark, setLandmark] = React.useState("");
  const [city, setCity] = React.useState("");
  const [district, setDistrict] = React.useState("");
  const [stateCode, setStateCode] = React.useState("33");
  // lines
  const [lines, setLines] = React.useState<Line[]>([]);
  // coupon
  const [code, setCode] = React.useState("");
  const [coupon, setCoupon] = React.useState<{ code: string; result: CouponEvaluation } | null>(null);
  const [checking, setChecking] = React.useState(false);
  // shipping + payment
  const [shipping, setShipping] = React.useState("");
  const [options, setOptions] = React.useState<DeliveryOption[] | null>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [method, setMethod] = React.useState<OrderPaymentMethod>("cash");
  const [markPaid, setMarkPaid] = React.useState(true);
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [customerNote, setCustomerNote] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});

  // PIN code → city, district, state (only fills empty fields, never overwrites what staff typed).
  const pin = usePincode(ship ? pincode : "");
  React.useEffect(() => {
    const p = pin.data;
    if (!p) return;
    setCity((c) => c || p.city);
    setDistrict((d) => d || p.district);
    if (p.stateCode) setStateCode(p.stateCode);
  }, [pin.data]);

  // ---- derived
  const priced = lines.map((l) => {
    const qty = parseQty(l.qty) ?? 0;
    const price = rupeesToPaise(l.price) ?? l.variant.price;
    return { ...l, qtyN: qty, priceN: price, amount: Math.round(qty * price) };
  });
  const subtotal = priced.reduce((s, l) => s + l.amount, 0);
  const weight = priced.reduce((s, l) => s + (l.variant.weightGrams ?? 0) * l.qtyN, 0);
  const couponOk = coupon?.result.valid ? coupon.result : null;
  const shippingPaise = rupeesToPaise(shipping) ?? 0;
  const discount = couponOk ? Math.min(couponOk.discount, subtotal) : 0;
  const shippingCharged = couponOk?.freeShipping ? 0 : shippingPaise;
  const estimate = Math.max(subtotal - discount, 0) + shippingCharged;
  const anyExclusive = lines.some((l) => !l.variant.taxInclusive && l.variant.gstRate > 0);

  // The coupon preview is stale once the cart changes.
  React.useEffect(() => setCoupon((c) => (c && c.result.valid ? null : c)), [subtotal]);

  const addVariant = (v: VariantLookup) => {
    setErrors((e) => ({ ...e, lines: undefined }));
    setLines((ls) => {
      const existing = ls.find((l) => l.variant.id === v.id);
      if (existing) return ls.map((l) => (l === existing ? { ...l, qty: String((parseQty(l.qty) ?? 0) + 1) } : l));
      return [...ls, { key: `${v.id}-${Date.now()}`, variant: v, qty: "1", price: paiseToInput(v.price) }];
    });
  };
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const step = (key: string, delta: number) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: String(Math.max(1, Math.round(((parseQty(l.qty) ?? 0) + delta) * 1000) / 1000)) } : l)));

  const checkCoupon = async () => {
    const c = normalizeCode(code);
    if (!c) return;
    setChecking(true);
    try {
      const result = await validateCoupon({
        code: c,
        subtotal,
        shipping: shippingPaise,
        lines: priced.map((l) => ({ productId: l.variant.productId, amount: l.amount })),
      });
      setCoupon({ code: c, result });
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setChecking(false);
    }
  };

  const getRates = async () => {
    if (!/^[1-9]\d{5}$/.test(pincode)) {
      setErrors((e) => ({ ...e, pincode: t("orders.validation.pincode") }));
      return;
    }
    setQuoting(true);
    try {
      const q = await quoteDelivery({ pincode, stateCode, weightGrams: Math.round(weight), subtotal: Math.max(subtotal - discount, 0), cod: method === "cod" });
      setOptions(q.serviceable ? q.options : []);
      if (q.serviceable && q.options[0]) setShipping(paiseToInput(q.options[0].amount + (method === "cod" ? q.options[0].codFee : 0)));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setQuoting(false);
    }
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!name.trim()) e.name = t("orders.validation.required");
    if (phone.trim() && !PHONE_RE.test(phone.trim())) e.phone = t("orders.validation.phone");
    if (email.trim() && !EMAIL_RE.test(email.trim())) e.email = t("orders.validation.email");
    if (ship) {
      if (!line1.trim()) e.line1 = t("orders.validation.required");
      if (!city.trim()) e.city = t("orders.validation.required");
      if (!/^[1-9]\d{5}$/.test(pincode)) e.pincode = t("orders.validation.pincode");
      if (!stateCode) e.stateCode = t("orders.validation.required");
    }
    if (lines.length === 0) e.lines = t("orders.new.noLines");
    else if (priced.some((l) => l.qtyN <= 0)) e.lines = t("orders.validation.qty");
    if (shipping && rupeesToPaise(shipping) === null) e.shipping = t("orders.validation.amount");
    return e;
  };

  const submit = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error(t("orders.new.fixErrors"));
      return;
    }
    const body: ManualOrderInput = {
      channel: "manual",
      customer: { name: name.trim(), phone: orNull(phone), email: orNull(email) },
      shippingAddress: ship
        ? {
            name: name.trim(),
            phone: orNull(phone),
            line1: line1.trim(),
            line2: orNull(line2),
            landmark: orNull(landmark),
            city: city.trim(),
            district: orNull(district),
            stateCode,
            pincode,
            country: "IN",
          }
        : null,
      lines: priced.map((l) => ({ variantId: l.variant.id, qty: l.qtyN, ...(l.priceN !== l.variant.price ? { price: l.priceN } : {}) })),
      couponCode: couponsOn && coupon?.code ? coupon.code : couponsOn && code.trim() ? normalizeCode(code) : null,
      paymentMethod: method,
      shipping: shippingPaise,
      notes: orNull(notes),
      customerNote: orNull(customerNote),
      ...(PAID_NOW.includes(method) && markPaid ? { markPaid: true, paymentReference: orNull(reference) } : {}),
    };
    try {
      const order = await create.mutateAsync(body);
      toast.success(t("orders.new.created", { number: order.number }));
      navigate(`orders/${order.id}`, { replace: true });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  if (!can(PERMS.manage)) {
    return (
      <Page width="narrow">
        <PageHeading icon={ShoppingBagIcon} title={t("orders.new.title")} back={{ href: "orders", label: t("orders.list.title") }} />
        <ReadOnlyNote icon={LockIcon}>{t("orders.errors.permission_denied")}</ReadOnlyNote>
      </Page>
    );
  }

  const createButton = (cls?: string) => (
    <Button type="submit" form="new-order" size="lg" className={cn("h-12", cls)} disabled={create.isPending}>
      {create.isPending ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />}
      {t("orders.new.create")}
    </Button>
  );

  return (
    <Page className="pb-32 lg:pb-8">
      <PageHeading icon={ShoppingBagIcon} title={t("orders.new.title")} description={t("orders.new.subtitle")} back={{ href: "orders", label: t("orders.list.title") }} />
      <form id="new-order" onSubmit={submit} noValidate className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          {/* Items */}
          <Section icon={ShoppingCartIcon} title={t("orders.new.items")} description={t("orders.new.itemsHint")}>
            <VariantPicker onPick={addVariant} />
            {errors.lines && <p className="-mt-2 text-xs text-destructive">{errors.lines}</p>}
            {lines.length === 0 ? (
              <EmptyState compact icon={ShoppingCartIcon} title={t("orders.new.emptyCart")} description={t("orders.new.emptyCartHint")} />
            ) : (
              <ul className="grid gap-2">
                <AnimatePresence initial={false}>
                  {priced.map((l) => (
                    <motion.li
                      key={l.key}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 24 }}
                      className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Thumb src={l.variant.image} alt="" className="size-12" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{l.variant.productName}</p>
                          <p className="mt-0.5 truncate text-meta text-muted-foreground">
                            {[l.variant.title, l.variant.sku, t("orders.new.catalogPrice", { price: money(l.variant.price) })].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className={cn("flex items-stretch overflow-hidden rounded-lg border bg-card", controlHeight("sm"))}>
                          <Button type="button" variant="ghost" size="icon-sm" className="h-full rounded-none" onClick={() => step(l.key, -1)} aria-label={t("orders.new.less")}>
                            <MinusIcon />
                          </Button>
                          <input
                            inputMode="decimal"
                            className="w-14 bg-transparent text-center text-sm tabular-nums outline-none"
                            aria-label={t("orders.new.qty")}
                            value={l.qty}
                            onChange={(e) => setLine(l.key, { qty: cleanQty(e.target.value) })}
                          />
                          <Button type="button" variant="ghost" size="icon-sm" className="h-full rounded-none" onClick={() => step(l.key, 1)} aria-label={t("orders.new.more")}>
                            <PlusIcon />
                          </Button>
                        </div>
                        <div className="w-28">
                          <MoneyInput size="sm" aria-label={t("orders.new.price")} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                        </div>
                        <span className="ml-auto min-w-20 text-right font-semibold tabular-nums">{money(l.amount)}</span>
                        <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-danger-ink" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t("orders.common.removeNamed", { name: l.variant.productName })}>
                          <Trash2Icon />
                        </Button>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Section>

          {/* Customer */}
          <Section icon={UserIcon} title={t("orders.new.customer")}>
            <Field label={t("orders.new.name")} htmlFor="c-name" error={errors.name}>
              <Input id="c-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
            </Field>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label={t("orders.new.phone")} htmlFor="c-phone" optional error={errors.phone} hint={t("orders.new.phoneHint")}>
                <Input id="c-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!errors.phone} />
              </Field>
              <Field label={t("orders.new.email")} htmlFor="c-email" optional error={errors.email}>
                <Input id="c-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
              </Field>
            </div>
          </Section>

          {/* Address */}
          <Section
            icon={MapPinIcon}
            title={t("orders.new.address")}
            description={ship ? t("orders.new.addressHint") : t("orders.new.noDelivery")}
            action={
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={ship} onCheckedChange={setShip} aria-label={t("orders.new.deliver")} />
                <span className="hidden sm:inline">{t("orders.new.deliver")}</span>
              </label>
            }
          >
            {ship && (
              <>
                <div className="grid items-start gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <Field
                    label={t("orders.new.pincode")}
                    htmlFor="a-pin"
                    error={errors.pincode}
                    hint={pin.isFetching ? t("orders.new.pinLooking") : pin.data ? `${pin.data.city}, ${pin.data.state}` : pin.isError ? t("orders.new.pinUnknown") : undefined}
                  >
                    <Input
                      id="a-pin"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      className="tabular-nums"
                      value={pincode}
                      maxLength={6}
                      onChange={(e) => {
                        setPincode(digitsOnly(e.target.value, 6));
                        setOptions(null);
                        setErrors((x) => ({ ...x, pincode: undefined }));
                      }}
                      aria-invalid={!!errors.pincode}
                    />
                  </Field>
                  <Field label={t("orders.new.line1")} htmlFor="a-line1" error={errors.line1}>
                    <Input id="a-line1" autoComplete="address-line1" value={line1} onChange={(e) => setLine1(e.target.value)} aria-invalid={!!errors.line1} />
                  </Field>
                </div>
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <Field label={t("orders.new.line2")} htmlFor="a-line2" optional>
                    <Input id="a-line2" autoComplete="address-line2" value={line2} onChange={(e) => setLine2(e.target.value)} />
                  </Field>
                  <Field label={t("orders.new.landmark")} htmlFor="a-landmark" optional>
                    <Input id="a-landmark" value={landmark} onChange={(e) => setLandmark(e.target.value)} />
                  </Field>
                </div>
                <div className="grid items-start gap-4 sm:grid-cols-3">
                  <Field label={t("orders.new.city")} htmlFor="a-city" error={errors.city}>
                    <Input id="a-city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} aria-invalid={!!errors.city} />
                  </Field>
                  <Field label={t("orders.new.district")} htmlFor="a-district" optional>
                    <Input id="a-district" value={district} onChange={(e) => setDistrict(e.target.value)} />
                  </Field>
                  <Field label={t("orders.new.state")} htmlFor="a-state" error={errors.stateCode}>
                    <Select value={stateCode} onValueChange={setStateCode}>
                      <SelectTrigger id="a-state" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GST_STATES.map((s) => (
                          <SelectItem key={s.code} value={s.code}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </>
            )}
          </Section>

          {/* Payment */}
          <Section icon={WalletIcon} tone="text-success-ink" title={t("orders.new.payment")}>
            <ChipGroup<OrderPaymentMethod>
              className="flex-wrap"
              aria-label={t("orders.payments.method")}
              value={method}
              onChange={(m) => {
                setMethod(m);
                setOptions(null);
              }}
              options={METHODS.map((m) => ({ value: m, label: t(`orders.method.${m}`) }))}
            />
            {PAID_NOW.includes(method) ? (
              <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Switch checked={markPaid} onCheckedChange={setMarkPaid} />
                  {t("orders.new.markPaid")}
                </label>
                {markPaid && (
                  <Input aria-label={t("orders.payments.reference")} placeholder={t("orders.payments.referencePlaceholder")} value={reference} onChange={(e) => setReference(e.target.value)} />
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t(`orders.new.methodHint.${method}`)}</p>
            )}
          </Section>

          {/* Notes */}
          <Section icon={NotebookPenIcon} tone="text-warning-ink" title={t("orders.new.notes")}>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label={t("orders.new.internalNote")} htmlFor="n-int" optional hint={t("orders.timeline.noteInternal")}>
                <Textarea id="n-int" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <Field label={t("orders.new.customerNote")} htmlFor="n-cust" optional hint={t("orders.new.customerNoteHint")}>
                <Textarea id="n-cust" rows={3} maxLength={1000} value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} />
              </Field>
            </div>
          </Section>
        </div>

        {/* Summary */}
        <div className="grid min-w-0 content-start gap-4 lg:sticky lg:top-20 lg:self-start">
          {couponsOn && (
            <Section icon={TicketPercentIcon} title={t("orders.new.coupon")}>
              <div className="flex items-start gap-2">
                <Input
                  className="font-mono uppercase"
                  aria-label={t("orders.new.couponCode")}
                  placeholder={t("orders.new.couponPlaceholder")}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setCoupon(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void checkCoupon();
                    }
                  }}
                />
                <Button type="button" variant="outline" disabled={!code.trim() || checking || lines.length === 0} onClick={() => void checkCoupon()}>
                  {checking && <Loader2Icon className="animate-spin" />}
                  {t("orders.new.apply")}
                </Button>
              </div>
              {coupon && <CouponResult result={coupon.result} />}
            </Section>
          )}

          <Section icon={TruckIcon} tone="text-info-ink" title={t("orders.new.shipping")}>
            <Field label={t("orders.new.shippingAmount")} htmlFor="s-amount" error={errors.shipping} hint={couponOk?.freeShipping ? t("orders.new.freeShippingCoupon") : undefined}>
              <MoneyInput id="s-amount" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0" />
            </Field>
            {deliveryOn && ship && (
              <>
                <Button type="button" variant="outline" disabled={quoting || lines.length === 0} onClick={() => void getRates()}>
                  {quoting ? <Loader2Icon className="animate-spin" /> : <TruckIcon />}
                  {t("orders.new.getRates")}
                  {weight > 0 && <span className="text-muted-foreground">· {formatGrams(weight)}</span>}
                </Button>
                {options && options.length === 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-warning-ink">
                    <AlertTriangleIcon className="size-3.5" /> {t("orders.new.notServiceable")}
                  </p>
                )}
                {options && options.length > 0 && (
                  <div className="grid gap-1.5" role="radiogroup" aria-label={t("orders.new.rates")}>
                    {options.map((o) => {
                      const amt = o.amount + (method === "cod" ? o.codFee : 0);
                      const on = rupeesToPaise(shipping) === amt;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setShipping(paiseToInput(amt))}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            on ? "border-primary bg-primary/8" : "bg-card hover:bg-accent/50",
                          )}
                        >
                          <span>
                            <span className="block font-medium">{o.name}</span>
                            <span className="text-xs text-muted-foreground">{t("orders.delivery.eta", { min: o.etaDays[0], max: o.etaDays[1] })}</span>
                          </span>
                          <span className="font-semibold tabular-nums">{amt === 0 ? t("orders.totals.free") : money(amt)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </Section>

          <div className="hidden rounded-2xl border border-card-ring bg-card p-4 shadow-elevated lg:grid lg:gap-2">
            <SummaryRows subtotal={subtotal} discount={discount} shipping={shippingCharged} estimate={estimate} anyExclusive={anyExclusive} />
            {createButton("mt-2 w-full")}
          </div>
        </div>
      </form>

      {/* Phone: sticky total + create */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-raised backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-meta text-muted-foreground">{t("orders.new.estimate")}</p>
            <p className="font-heading text-xl font-bold tabular-nums">{money(estimate)}</p>
          </div>
          {createButton("flex-1")}
        </div>
      </div>
    </Page>
  );
}

function SummaryRows({ subtotal, discount, shipping, estimate, anyExclusive }: { subtotal: number; discount: number; shipping: number; estimate: number; anyExclusive: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <TotalRow label={t("orders.totals.subtotal")} value={money(subtotal)} />
      {discount > 0 && <TotalRow label={t("orders.totals.coupon")} value={<span className="text-success-ink">−{money(discount)}</span>} />}
      <TotalRow label={t("orders.totals.shipping")} value={shipping > 0 ? money(shipping) : t("orders.totals.free")} />
      <TotalRow strong label={t("orders.new.estimate")} value={money(estimate)} className="border-t pt-2" />
      <p className="text-meta text-muted-foreground">{anyExclusive ? t("orders.new.gstAdded") : t("orders.new.gstNote")}</p>
    </>
  );
}

/** Live coupon check. The preview uses the store's rules; reasons that may differ for manual orders are soft warnings. */
function CouponResult({ result }: { result: CouponEvaluation }) {
  const { t } = useI18n();
  if (result.valid) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-2 text-sm text-success-ink">
        <CheckCircle2Icon className="size-4 shrink-0" />
        {result.freeShipping ? t("orders.new.couponFreeShipping") : t("orders.new.couponOk", { amount: money(result.discount) })}
      </p>
    );
  }
  const soft = result.reason === "wrong_channel" || result.reason === "not_applicable";
  return (
    <p className={cn("flex items-start gap-1.5 rounded-lg px-3 py-2 text-sm", soft ? "bg-warning/10 text-warning-ink" : "bg-destructive/10 text-danger-ink")}>
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <span>
        {t(`orders.coupons.reason.${result.reason}`)}
        {soft && <span className="block text-xs opacity-80">{t("orders.new.couponCheckedOnCreate")}</span>}
      </span>
    </p>
  );
}
