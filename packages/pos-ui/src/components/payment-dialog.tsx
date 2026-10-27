"use client";

import * as React from "react";
import {
  AwardIcon,
  BanknoteIcon,
  BookUserIcon,
  CheckIcon,
  CreditCardIcon,
  Loader2Icon,
  QrCodeIcon,
  WifiOffIcon,
} from "lucide-react";
import { upiLink } from "@srirealtime/gst";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatedNumber,
  AnimatePresence,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  motion,
} from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { payableAfterLoyalty, type CartTotals } from "../lib/cart";
import { money, moneyShort, paiseToInput, rupeesToPaise } from "../lib/format";
import { quickNotes, settle, type Settlement, type TenderProblem, type Tenders } from "../lib/tender";
import type { LoyaltyQuote, PosCustomer } from "../lib/types";
import { customerPhone } from "../lib/types";
import { usePos } from "./pos-context";
import { QrImage } from "./qr-image";

type Method = "cash" | "upi" | "card" | "credit" | "points";

export interface PaymentResult {
  settlement: Settlement;
  tenders: Tenders;
  refs: { upi?: string; card?: string };
  points: number;
}

export interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  totals: CartTotals;
  customer: PosCustomer;
  quote: LoyaltyQuote | undefined;
  points: number;
  onPoints: (points: number) => void;
  onComplete: (r: PaymentResult) => Promise<boolean>;
  /** Paise being taken by UPI while the UPI tab is open (0 otherwise); the customer display draws its QR from it. */
  onUpi?: (paise: number) => void;
}

const METHOD_ICON: Record<Method, React.ComponentType<{ className?: string }>> = {
  cash: BanknoteIcon,
  upi: QrCodeIcon,
  card: CreditCardIcon,
  credit: BookUserIcon,
  points: AwardIcon,
};

export function PaymentDialog(props: PaymentDialogProps) {
  const { t } = useI18n();
  const { has, online, seller, shopName, sellerState } = usePos();
  const { totals, customer, quote, points } = props;
  const [method, setMethod] = React.useState<Method>("cash");
  const [text, setText] = React.useState<Record<"cash" | "upi" | "card" | "credit", string>>({ cash: "", upi: "", card: "", credit: "" });
  const [upiConfirmed, setUpiConfirmed] = React.useState(false);
  const [refs, setRefs] = React.useState<{ upi: string; card: string }>({ upi: "", card: "" });
  const [pointsText, setPointsText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [tried, setTried] = React.useState(false);
  const cashRef = React.useRef<HTMLInputElement>(null);

  const phone = customerPhone(customer);
  // Offline the bill is saved on this device: only money taken at the counter (cash, UPI, card). The credit book and
  // loyalty points need the server (docs/offline-billing.md).
  const offlineMode = !online.online;
  const showPoints = has.loyalty && !!phone && !offlineMode;
  const creditOn = has.creditBook && !offlineMode;
  const methods: Method[] = ["cash", "upi", "card", ...(creditOn ? (["credit"] as const) : []), ...(showPoints ? (["points"] as const) : [])];

  const pointValue = quote?.pointValuePaise ?? 0;
  const pointsDiscount = points * pointValue;
  const payable = payableAfterLoyalty(totals, pointsDiscount);

  const tenders: Tenders = {
    cash: rupeesToPaise(text.cash) ?? 0,
    upi: rupeesToPaise(text.upi) ?? 0,
    card: rupeesToPaise(text.card) ?? 0,
    credit: creditOn ? (rupeesToPaise(text.credit) ?? 0) : 0,
  };
  const s = settle(payable, tenders, { upiConfirmed, hasCustomer: customer.kind === "saved", creditAllowed: creditOn });
  const blocked = !sellerState ? "profile" : null;

  // The customer display shows the UPI QR while this tab is on.
  const onUpi = props.onUpi;
  React.useEffect(() => {
    onUpi?.(props.open && method === "upi" ? tenders.upi : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onUpi` is a state setter of the counter
  }, [props.open, method, tenders.upi]);

  // Fresh dialog every time it opens.
  React.useEffect(() => {
    if (!props.open) return;
    setMethod("cash");
    setText({ cash: "", upi: "", card: "", credit: "" });
    setUpiConfirmed(false);
    setRefs({ upi: "", card: "" });
    setPointsText("");
    setTried(false);
    setBusy(false);
    window.setTimeout(() => cashRef.current?.focus(), 50);
  }, [props.open]);

  /** What is still to collect if method `m` took the rest (other methods and any cash already entered count first). */
  const restFor = (m: "upi" | "card" | "credit") =>
    Math.max(payable - (tenders.upi + tenders.card + tenders.credit - tenders[m]) - tenders.cash, 0);

  const choose = (m: Method) => {
    setMethod(m);
    if ((m === "upi" || m === "card" || (m === "credit" && customer.kind === "saved")) && !text[m]) {
      const r = restFor(m);
      if (r > 0) setText((x) => ({ ...x, [m]: paiseToInput(r) }));
    }
    if (m === "points" && !pointsText && quote?.canRedeem) setPointsText(String(points || quote.maxPoints));
  };

  const complete = async (exactCashIfEmpty = false) => {
    setTried(true);
    if (busy || blocked) return;
    let tnd = tenders;
    let st = s;
    // Nothing entered: F10 / "Exact cash" takes the exact amount in cash.
    if (exactCashIfEmpty && tenders.cash + tenders.upi + tenders.card + tenders.credit === 0) {
      tnd = { ...tenders, cash: payable };
      st = settle(payable, tnd, { upiConfirmed, hasCustomer: customer.kind === "saved", creditAllowed: creditOn });
      setText((x) => ({ ...x, cash: paiseToInput(payable) }));
    }
    if (!st.ok) return;
    setBusy(true);
    try {
      await props.onComplete({ settlement: st, tenders: tnd, refs: { upi: refs.upi, card: refs.card }, points });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "F10") {
      e.preventDefault();
      void complete(true);
    } else if (e.key === "F9") {
      e.preventDefault();
    }
  };

  const problems = s.problems.filter((p) => p !== "nothingToPay");
  const mainProblem: TenderProblem | null = tried ? (problems.find((p) => p !== "short") ?? (problems.includes("short") ? "short" : null)) : null;

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && !busy && props.onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] gap-0 p-0 sm:max-w-3xl"
        closeLabel={t("pos.common.close")}
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b px-5 py-4 text-left sm:px-5 sm:pr-12">
          <DialogTitle className="flex items-baseline justify-between gap-4 pr-8">
            <span>{t("pos.pay.title")}</span>
            <AnimatedNumber value={payable} format={money} className="text-3xl font-bold tracking-tight tabular-nums" />
          </DialogTitle>
          <DialogDescription>{t("pos.pay.body")}</DialogDescription>
        </DialogHeader>

        {offlineMode && (
          <div className="px-5 pt-4">
            <Alert variant="warning">
              <WifiOffIcon />
              <AlertTitle>{t("pos.off.payOfflineTitle")}</AlertTitle>
              <AlertDescription>{t("pos.off.payOfflineBody")}</AlertDescription>
            </Alert>
          </div>
        )}
        {blocked && (
          <div className="px-5 pt-4">
            <Alert variant="warning">
              <WifiOffIcon />
              <AlertTitle>{t("pos.profile.title")}</AlertTitle>
              <AlertDescription>{t("pos.profile.body")}</AlertDescription>
            </Alert>
          </div>
        )}

        <div className="grid min-h-0 gap-4 overflow-y-auto p-5 md:grid-cols-[13rem_1fr]">
          <div role="tablist" aria-label={t("pos.pay.methods")} className="grid auto-rows-min grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-1">
            {methods.map((m) => {
              const Icon = METHOD_ICON[m];
              const amount = m === "points" ? pointsDiscount : m === "cash" ? s.cashApplied : tenders[m];
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={method === m}
                  onClick={() => choose(m)}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-xl border px-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    method === m ? "border-primary bg-primary/[0.07] text-foreground" : "bg-card hover:bg-accent",
                  )}
                >
                  <Icon className={cn("size-5 shrink-0", method === m ? "text-primary" : "text-muted-foreground")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t(`pos.pay.method.${m}`)}</span>
                    {amount > 0 && <span className="block text-xs text-muted-foreground tabular-nums">{money(amount)}</span>}
                  </span>
                  {amount > 0 && <CheckIcon className="size-4 text-success" />}
                </button>
              );
            })}
          </div>

          <div className="min-w-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={method} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.14 }} className="grid gap-4">
                {method === "cash" && (
                  <>
                    <Field>
                      <FieldLabel>{t("pos.pay.tendered")}</FieldLabel>
                      <InputGroup size="lg" className="h-16">
                        <InputGroupAddon className="text-2xl">₹</InputGroupAddon>
                        <FieldControl>
                          <InputGroupInput
                            ref={cashRef}
                            value={text.cash}
                            onChange={(e) => setText((x) => ({ ...x, cash: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void complete(true);
                              }
                            }}
                            inputMode="decimal"
                            placeholder={paiseToInput(Math.max(payable - tenders.upi - tenders.card - tenders.credit, 0))}
                            className="text-3xl font-semibold tabular-nums md:text-3xl"
                          />
                        </FieldControl>
                      </InputGroup>
                      <FieldHint>{t("pos.pay.tenderedHint")}</FieldHint>
                    </Field>
                    <div className="flex flex-wrap gap-2" aria-label={t("pos.pay.quickNotes")}>
                      {quickNotes(Math.max(payable - tenders.upi - tenders.card - tenders.credit, 0)).map((n, i) => (
                        <Button key={n} type="button" variant={i === 0 ? "secondary" : "outline"} size="lg" className="min-w-20 text-base tabular-nums" onClick={() => setText((x) => ({ ...x, cash: paiseToInput(n) }))}>
                          {i === 0 ? t("pos.pay.exact") : moneyShort(n)}
                        </Button>
                      ))}
                    </div>
                    <div className={cn("grid gap-1 rounded-2xl border p-4 text-center", s.change > 0 ? "border-success/40 bg-success/10" : "bg-muted/40")}>
                      <span className="text-sm font-medium text-muted-foreground">{t("pos.pay.change")}</span>
                      <AnimatedNumber value={s.change} format={money} className={cn("text-5xl font-bold tracking-tight tabular-nums", s.change > 0 && "text-success")} />
                    </div>
                  </>
                )}

                {method === "upi" && (
                  <>
                    <AmountField label={t("pos.pay.upiAmount")} value={text.upi} onChange={(v) => setText((x) => ({ ...x, upi: v }))} autoFocus />
                    {seller.upiId ? (
                      tenders.upi > 0 ? (
                        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                          <QrImage value={upiLink({ vpa: seller.upiId, name: seller.legalName || shopName, amountPaise: tenders.upi, note: t("pos.pay.upiNote") })} alt={t("pos.pay.upiQr")} size={200} />
                          <div className="grid gap-2 text-sm">
                            <p className="font-semibold">{t("pos.pay.upiScan", { amount: money(tenders.upi) })}</p>
                            <p className="font-mono text-xs text-muted-foreground">{seller.upiId}</p>
                            <Button type="button" size="lg" variant={upiConfirmed ? "default" : "outline"} aria-pressed={upiConfirmed} onClick={() => setUpiConfirmed((v) => !v)} className={cn(upiConfirmed && "bg-success hover:bg-success/90")}>
                              <CheckIcon /> {upiConfirmed ? t("pos.pay.upiReceived") : t("pos.pay.upiConfirm")}
                            </Button>
                          </div>
                        </div>
                      ) : null
                    ) : (
                      <Alert variant="warning">
                        <QrCodeIcon />
                        <AlertTitle>{t("pos.pay.noUpiTitle")}</AlertTitle>
                        <AlertDescription>{t("pos.pay.noUpiBody")}</AlertDescription>
                      </Alert>
                    )}
                    {!seller.upiId && tenders.upi > 0 && (
                      <Button type="button" size="lg" variant={upiConfirmed ? "default" : "outline"} aria-pressed={upiConfirmed} onClick={() => setUpiConfirmed((v) => !v)}>
                        <CheckIcon /> {upiConfirmed ? t("pos.pay.upiReceived") : t("pos.pay.upiConfirm")}
                      </Button>
                    )}
                    <RefField label={t("pos.pay.upiRef")} value={refs.upi} onChange={(v) => setRefs((r) => ({ ...r, upi: v }))} />
                  </>
                )}

                {method === "card" && (
                  <>
                    <AmountField label={t("pos.pay.cardAmount")} value={text.card} onChange={(v) => setText((x) => ({ ...x, card: v }))} autoFocus />
                    <RefField label={t("pos.pay.cardRef")} value={refs.card} onChange={(v) => setRefs((r) => ({ ...r, card: v }))} hint={t("pos.pay.cardRefHint")} />
                  </>
                )}

                {method === "credit" && (
                  <>
                    {customer.kind !== "saved" ? (
                      <Alert variant="warning">
                        <BookUserIcon />
                        <AlertTitle>{t("pos.pay.creditNeedsCustomerTitle")}</AlertTitle>
                        <AlertDescription>{t("pos.pay.creditNeedsCustomerBody")}</AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        <AmountField label={t("pos.pay.creditAmount")} value={text.credit} onChange={(v) => setText((x) => ({ ...x, credit: v }))} autoFocus />
                        <div className="grid gap-1 rounded-xl border bg-muted/40 p-3 text-sm">
                          <p className="font-semibold">{customer.customer.name}</p>
                          <p className="text-muted-foreground">
                            {t("pos.pay.creditNow", { amount: money(customer.customer.outstanding) })}
                            {customer.customer.creditLimit !== null && ` · ${t("pos.pay.creditLimit", { amount: money(customer.customer.creditLimit) })}`}
                          </p>
                          {customer.customer.creditLimit !== null && customer.customer.outstanding + tenders.credit > customer.customer.creditLimit && (
                            <p className="font-medium text-warning-ink">{t("pos.pay.creditOverLimit")}</p>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}

                {method === "points" && (
                  <PointsPanel
                    quote={quote}
                    applied={points}
                    text={pointsText}
                    onText={setPointsText}
                    onApply={(n) => {
                      props.onPoints(n);
                      // Amounts already entered on other methods may now be too high: let the cashier re-check.
                      setText((x) => ({ ...x, upi: "", card: "", credit: "" }));
                      setUpiConfirmed(false);
                    }}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="grid gap-3 border-t bg-card px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="grid grid-cols-3 gap-3 text-sm tabular-nums">
            <Stat label={t("pos.pay.due")} value={payable} />
            <Stat label={t("pos.pay.received")} value={s.received} />
            {s.credit > 0 ? (
              <Stat label={t("pos.pay.onCredit")} value={s.credit} tone="warning" />
            ) : s.remaining > 0 ? (
              <Stat label={t("pos.pay.remaining")} value={s.remaining} tone="destructive" />
            ) : (
              <Stat label={t("pos.pay.change")} value={s.change} tone={s.change > 0 ? "success" : undefined} />
            )}
          </div>
          <div className="grid gap-1">
            <Button type="button" size="lg" className="h-14 min-w-56 text-lg" disabled={busy || !!blocked} onClick={() => void complete(true)}>
              {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
              {busy ? t("pos.pay.saving") : t("pos.pay.complete")}
              <kbd className="hidden font-mono text-xs opacity-70 sm:inline">F10</kbd>
            </Button>
            {mainProblem && <p className="text-center text-xs text-destructive">{t(`pos.pay.problem.${mainProblem}`)}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "destructive" }) {
  return (
    <div className="grid">
      <span className="text-xs text-muted-foreground">{label}</span>
      <AnimatedNumber
        value={value}
        format={money}
        className={cn("text-lg font-semibold", tone === "success" && "text-success-ink", tone === "warning" && "text-warning-ink", tone === "destructive" && "text-destructive")}
      />
    </div>
  );
}

function AmountField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <InputGroup size="lg" className="h-14">
        <InputGroupAddon className="text-xl">₹</InputGroupAddon>
        <FieldControl>
          <InputGroupInput value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" autoFocus={autoFocus} onFocus={(e) => e.target.select()} className="text-2xl font-semibold tabular-nums md:text-2xl" />
        </FieldControl>
      </InputGroup>
    </Field>
  );
}

function RefField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const { t } = useI18n();
  return (
    <Field>
      <FieldLabel optional={t("pos.common.optional")}>{label}</FieldLabel>
      <FieldControl>
        <InputGroup size="lg">
          <InputGroupInput value={value} onChange={(e) => onChange(e.target.value.slice(0, 100))} autoComplete="off" />
        </InputGroup>
      </FieldControl>
      {hint && <FieldHint>{hint}</FieldHint>}
    </Field>
  );
}

function PointsPanel({
  quote,
  applied,
  text,
  onText,
  onApply,
}: {
  quote: LoyaltyQuote | undefined;
  applied: number;
  text: string;
  onText: (v: string) => void;
  onApply: (points: number) => void;
}) {
  const { t } = useI18n();
  if (!quote) return <p className="text-sm text-muted-foreground">{t("pos.loyalty.loading")}</p>;
  const n = Number(text || "0");
  const valid = Number.isInteger(n) && n >= 0 && n <= quote.maxPoints && (n === 0 || n >= quote.minRedeemPoints);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">{t("pos.loyalty.balance")}</p>
          <p className="text-lg font-semibold tabular-nums">{t("pos.loyalty.points", { count: quote.balance })}</p>
          {quote.member && <p className="text-xs text-muted-foreground">{t("pos.loyalty.tier", { tier: quote.member.tier })}</p>}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("pos.loyalty.usable")}</p>
          <p className="text-lg font-semibold tabular-nums">{t("pos.loyalty.points", { count: quote.maxPoints })}</p>
          <p className="text-xs text-muted-foreground">{t("pos.loyalty.worth", { amount: money(quote.maxDiscount) })}</p>
        </div>
      </div>
      {!quote.canRedeem ? (
        <p className="text-sm text-muted-foreground">{quote.member ? t("pos.loyalty.cantRedeem", { min: quote.minRedeemPoints }) : t("pos.loyalty.notMember")}</p>
      ) : (
        <Field>
          <FieldLabel>{t("pos.loyalty.use")}</FieldLabel>
          <div className="flex gap-2">
            <FieldControl>
              <InputGroup size="lg" className="flex-1">
                <InputGroupInput value={text} onChange={(e) => onText(e.target.value.replace(/\D/g, ""))} inputMode="numeric" autoFocus onFocus={(e) => e.target.select()} />
                <InputGroupAddon>{t("pos.loyalty.pts")}</InputGroupAddon>
              </InputGroup>
            </FieldControl>
            <Button type="button" size="lg" disabled={!valid} onClick={() => onApply(n)}>
              {t("pos.loyalty.apply")}
            </Button>
            {applied > 0 && (
              <Button type="button" size="lg" variant="outline" onClick={() => onApply(0)}>
                {t("pos.loyalty.remove")}
              </Button>
            )}
          </div>
          <FieldHint>{valid && n > 0 ? t("pos.loyalty.saves", { amount: money(n * quote.pointValuePaise) }) : t("pos.loyalty.range", { min: quote.minRedeemPoints, max: quote.maxPoints })}</FieldHint>
          <FieldError>{text && !valid ? t("pos.loyalty.invalid") : null}</FieldError>
        </Field>
      )}
      {applied > 0 && <p className="text-sm font-medium text-success-ink">{t("pos.loyalty.applied", { count: applied, amount: money(applied * quote.pointValuePaise) })}</p>}
    </div>
  );
}
