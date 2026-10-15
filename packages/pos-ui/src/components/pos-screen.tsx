"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, CalendarClockIcon, ShoppingCartIcon, WalletIcon, WifiOffIcon } from "lucide-react";
import {
  AnimatedNumber,
  AnimatePresence,
  Button,
  motion,
  useAnimate,
  useReducedMotionSafe,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  toast,
} from "@srirealtime/ui";
import { ApiError, ConfirmDialog, describeError, useAppNavigate, useDebounced, useI18n, useSettingsHref } from "@srirealtime/web";
import {
  addPayment,
  createBill,
  isNetworkError,
  lookupCode,
  posApi,
  useLoyaltyQuote,
  useStock,
  type CreateBillInput,
} from "../lib/api";
import {
  addProduct,
  cartTotals,
  payableAfterLoyalty,
  removeLine,
  setDiscount,
  setPrice,
  setQty,
  stepQty,
  toLineInput,
  type CartLine,
  type CartProduct,
} from "../lib/cart";
import { e164, money, timeShort, todayIST } from "../lib/format";
import { reportNetwork } from "../lib/online";
import { fromBillingItem, fromLookup, looksLikeCode } from "../lib/products";
import type { ShortcutAction } from "../lib/shortcuts";
import {
  closeDay,
  dropHold,
  holdBill,
  openDay,
  pushRecent,
  readJson,
  recordSale,
  storageKey,
  toggleFavourite,
  useLocalState,
  type DayRecord,
  type HeldBill,
} from "../lib/storage";
import { fitPayments, paymentsFor } from "../lib/tender";
import { customerPhone, NO_CUSTOMER, type BillingItem, type Paged, type PosCustomer } from "../lib/types";
import { useCounterKeys, useFinePointer, useMediaQuery } from "../lib/use-keys";
import { CameraScanDialog } from "./camera-scan";
import { CartPanel } from "./cart-panel";
import { CustomerBar } from "./customer-bar";
import { DayDialog } from "./day-dialog";
import { HelpDialog } from "./help-dialog";
import { HoldDialog, HoldsDialog } from "./holds-dialog";
import { LineEditDialog } from "./line-edit-dialog";
import { PaymentDialog, type PaymentResult } from "./payment-dialog";
import { PosProvider, usePos } from "./pos-context";
import { ProductPanel } from "./product-panel";
import { ReceiptView, type CompletedSale } from "./receipt-view";
import { ReturnsDialog } from "./returns-dialog";
import { TopBar } from "./top-bar";
import { VariantPicker } from "./variant-picker";

interface CartState {
  lines: CartLine[];
  customer: PosCustomer;
  /** Loyalty points to redeem on this bill. */
  points: number;
}

const EMPTY_CART: CartState = { lines: [], customer: NO_CUSTOMER, points: 0 };

type DialogKind = "pay" | "hold" | "holds" | "returns" | "day" | "help" | "camera" | "clear";

/** The full-screen counter (covers the app shell). */
export function PosScreen() {
  return (
    <PosProvider>
      <Counter />
    </PosProvider>
  );
}

function Counter() {
  const env = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const appNavigate = useAppNavigate();
  const settingsHref = useSettingsHref();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const finePointer = useFinePointer();

  const [cart, setCart] = useLocalState<CartState>(storageKey("cart", env.tenant, env.userId), EMPTY_CART);
  const [holds, setHolds] = useLocalState<HeldBill[]>(storageKey("holds", env.tenant, env.userId), []);
  const [day, setDay] = useLocalState<DayRecord | null>(storageKey("day", env.tenant, env.branch?.code ?? null), null);
  const [recent, setRecent] = useLocalState<CartProduct[]>(storageKey("recent", env.tenant), []);
  const [favourites, setFavourites] = useLocalState<CartProduct[]>(storageKey("favourites", env.tenant), []);

  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState<{ key: string; n: number } | null>(null);
  const [scanMiss, setScanMiss] = React.useState(0);
  const [dialog, setDialog] = React.useState<DialogKind | null>(null);
  const [editKey, setEditKey] = React.useState<string | null>(null);
  const [pickProduct, setPickProduct] = React.useState<string | null>(null);
  const [sale, setSale] = React.useState<CompletedSale | null>(null);
  const [sheet, setSheet] = React.useState(false);
  const [lastAdded, setLastAdded] = React.useState<{ name: string; n: number } | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const customerRef = React.useRef<HTMLInputElement>(null);

  const lines = cart.lines;
  const customer = cart.customer;
  const sellerState = env.sellerState ?? "00";
  const placeOfSupply = (customer.kind === "saved" && customer.customer.stateCode) || sellerState;
  const totals = React.useMemo(() => cartTotals(lines, { sellerState, placeOfSupply }), [lines, sellerState, placeOfSupply]);

  const phone = e164(customerPhone(customer));
  const quoteAmount = useDebounced(totals.total, 400);
  const quote = useLoyaltyQuote(phone, quoteAmount, env.has.loyalty && env.online.online);
  const pointsDiscount = cart.points * (quote.data?.pointValuePaise ?? 0);
  const payable = payableAfterLoyalty(totals, pointsDiscount);
  const stock = useStock(
    lines.map((l) => l.itemId),
    env.has.inventory,
  );

  const today = todayIST();
  const dayOpen = !!day && day.date === today && !day.closedAt;

  // ---------------------------------------------------------------- cart updates

  /** Any change to the lines drops applied points (the redeemable amount depends on the bill). */
  const updateLines = React.useCallback((fn: (l: CartLine[]) => CartLine[]) => setCart((c) => ({ ...c, lines: fn(c.lines), points: 0 })), [setCart]);

  const focusSearch = React.useCallback(() => {
    if (finePointer && desktop) window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [finePointer, desktop]);

  const add = React.useCallback(
    (p: CartProduct) => {
      let key = "";
      setCart((c) => {
        const r = addProduct(c.lines, p);
        key = r.key;
        return { ...c, lines: r.lines, points: 0 };
      });
      setSelected(key);
      setFlash({ key, n: Date.now() });
      setLastAdded({ name: p.name, n: Date.now() });
      setRecent((r) => pushRecent(r, p));
      beep(true);
    },
    [setCart, setRecent],
  );

  const [shakeScope, shake] = useAnimate();
  const reduced = useReducedMotionSafe();
  const miss = React.useCallback(
    (code: string, err?: unknown) => {
      beep(false);
      setScanMiss(Date.now());
      if (!reduced && shakeScope.current) void shake(shakeScope.current, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.3 });
      if (err && isNetworkError(err)) {
        reportNetwork(false);
        toast.error(t("pos.offline.scan"));
      } else if (err && !(err instanceof ApiError && err.status === 404)) {
        toast.error(describeError(err, t));
      } else {
        toast.error(t("pos.scan.notFound", { code }));
      }
    },
    [t, reduced, shake, shakeScope],
  );

  const scan = React.useCallback(
    async (code: string) => {
      try {
        if (env.has.catalogue) {
          const v = await lookupCode(code);
          reportNetwork(true);
          add(fromLookup(v));
        } else {
          const r = await posApi.get<Paged<BillingItem>>("/invoices/items", { q: code, limit: 2 });
          reportNetwork(true);
          if (r.items.length === 1) add(fromBillingItem(r.items[0]!));
          else miss(code);
        }
      } catch (err) {
        miss(code, err);
      }
    },
    [env.has.catalogue, add, miss],
  );

  const onScan = React.useCallback(
    (code: string, target: EventTarget | null) => {
      if (target && target === searchRef.current) setQuery("");
      void scan(code);
    },
    [scan],
  );

  const onSubmitSearch = async (q: string, first: CartProduct | null) => {
    if (!q) return;
    if (env.has.catalogue && looksLikeCode(q)) {
      try {
        const v = await lookupCode(q);
        add(fromLookup(v));
        setQuery("");
        return;
      } catch (err) {
        if (isNetworkError(err)) return miss(q, err);
      }
    }
    if (first) {
      add(first);
      setQuery("");
    } else miss(q);
  };

  // ---------------------------------------------------------------- holds

  const holdCurrent = (name: string, note: string) => {
    if (lines.length === 0) return;
    setHolds((h) => holdBill(h, { name, note, lines, customer, total: totals.total }));
    setCart(EMPTY_CART);
    setDialog(null);
    toast.success(t("pos.hold.done", { name }));
    focusSearch();
  };

  const recall = (h: HeldBill) => {
    setHolds((list) => {
      let next = dropHold(list, h.id);
      if (lines.length > 0) next = holdBill(next, { name: t("pos.hold.auto", { time: timeShort(Date.now()) }), note: "", lines, customer, total: totals.total });
      return next;
    });
    setCart({ lines: h.lines, customer: h.customer, points: 0 });
    setSelected(h.lines.at(-1)?.key ?? null);
    setDialog(null);
    toast.success(t("pos.holds.recalled", { name: h.name }));
    focusSearch();
  };

  const defaultHoldName =
    customer.kind === "saved" ? customer.customer.name : customer.kind === "walkin" && (customer.name || customer.phone) ? customer.name || customer.phone : t("pos.hold.defaultName", { time: timeShort(Date.now()) });

  // ---------------------------------------------------------------- payment

  const openPay = () => {
    if (lines.length === 0) return;
    setSheet(false);
    setDialog("pay");
  };

  const complete = async (r: PaymentResult): Promise<boolean> => {
    const date = todayIST();
    const input: CreateBillInput = { date, lines: lines.map(toLineInput), issue: true };
    if (customer.kind === "saved") input.customerId = customer.customer.id;
    else if (customer.kind === "walkin") input.customer = { name: customer.name.trim() || t("pos.customer.walkInName"), ...(phone ? { phone } : {}) };
    if (r.points > 0) input.loyaltyPoints = r.points;

    let inv;
    try {
      inv = await createBill(input);
      reportNetwork(true);
    } catch (err) {
      if (isNetworkError(err)) {
        reportNetwork(false);
        toast.error(t("pos.offline.billFailed"));
      } else toast.error(describeError(err, t));
      return false;
    }

    const planned = fitPayments(paymentsFor(r.settlement, r.tenders, r.refs), inv.balance);
    const failed: { method: string; amount: number }[] = [];
    for (const p of planned) {
      try {
        inv = await addPayment(inv.id, { ...p, date });
      } catch (err) {
        if (isNetworkError(err)) reportNetwork(false);
        failed.push({ method: p.method, amount: p.amount });
      }
    }
    const cashPaid = planned.find((p) => p.method === "cash" && !failed.some((f) => f.method === "cash"))?.amount ?? 0;
    const change = Math.max(r.tenders.cash - cashPaid, 0);
    const failedSum = failed.reduce((s, f) => s + f.amount, 0);
    const credit = Math.max(inv.balance - failedSum, 0);

    setDay((d) =>
      recordSale(d && d.date === date ? d : null, {
        id: inv.id,
        number: inv.number,
        total: inv.total,
        at: new Date().toISOString(),
        payments: planned.filter((p) => !failed.some((f) => f.method === p.method)).map((p) => ({ method: p.method, amount: p.amount })),
        credit,
        customer: inv.customerName,
      }) ?? d,
    );
    setCart(EMPTY_CART);
    setSelected(null);
    setDialog(null);
    setSale({ invoice: inv, change, credit, failedPayments: failed, phone });
    void qc.invalidateQueries({ queryKey: ["pos", "payments"] });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["pos", "stock"] });
    return true;
  };

  const newSale = React.useCallback(() => {
    setSale(null);
    setQuery("");
    focusSearch();
  }, [focusSearch]);

  // ---------------------------------------------------------------- keyboard

  const target = selected && lines.some((l) => l.key === selected) ? selected : (lines.at(-1)?.key ?? null);

  const onShortcut = (action: ShortcutAction) => {
    switch (action) {
      case "search":
        searchRef.current?.focus();
        searchRef.current?.select();
        break;
      case "customer":
        if (!desktop) setSheet(true);
        if (customer.kind !== "none") setCart((c) => ({ ...c, customer: NO_CUSTOMER, points: 0 }));
        window.setTimeout(() => customerRef.current?.focus(), 60);
        break;
      case "hold":
        if (lines.length) setDialog("hold");
        break;
      case "recall":
        setDialog("holds");
        break;
      case "pay":
      case "complete":
        openPay();
        break;
      case "cancel":
        if (query) setQuery("");
        else if (sheet) setSheet(false);
        else if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body && document.activeElement !== searchRef.current) {
          document.activeElement.blur();
          focusSearch();
        } else if (lines.length) setDialog("clear");
        break;
      case "qtyUp":
      case "qtyDown":
        if (target) updateLines((l) => stepQty(l, target, action === "qtyUp" ? 1 : -1));
        break;
      case "remove":
        if (target) updateLines((l) => removeLine(l, target));
        break;
      case "help":
        setDialog("help");
        break;
    }
  };

  const overlayOpen = dialog !== null || editKey !== null || pickProduct !== null || sale !== null;
  useCounterKeys({ enabled: !overlayOpen, onScan, onShortcut });

  // Desktop: keep the search box ready for typing / scanning.
  React.useEffect(() => {
    if (!overlayOpen) focusSearch();
  }, [overlayOpen, focusSearch]);

  // First visit of the day: offer to open the day (once per session).
  const asked = React.useRef(false);
  const dayKey = storageKey("day", env.tenant, env.branch?.code ?? null);
  const branchReady = !env.has.branches || !!env.branch;
  React.useEffect(() => {
    if (asked.current || env.sellerLoading || !branchReady) return;
    asked.current = true;
    // Read storage directly: the day state may not have loaded into React yet on this first pass.
    const stored = readJson<DayRecord | null>(dayKey, null);
    if (!stored || stored.date !== todayIST()) setDialog((d) => d ?? "day");
  }, [env.sellerLoading, branchReady, dayKey]);

  const exit = () => {
    appNavigate("/");
  };

  const editing = editKey ? (lines.find((l) => l.key === editKey) ?? null) : null;
  const payBlocked = !env.online.online ? t("pos.offline.payTitle") : null;

  const cartPanel = (
    <CartPanel
      lines={lines}
      totals={totals}
      payable={payable}
      pointsDiscount={pointsDiscount}
      selectedKey={target}
      flash={flash}
      stock={stock.data}
      onSelect={setSelected}
      onStep={(key, d) => updateLines((l) => stepQty(l, key, d))}
      onEdit={setEditKey}
      onRemove={(key) => updateLines((l) => removeLine(l, key))}
      onHold={() => setDialog("hold")}
      onPay={openPay}
      payBlocked={payBlocked}
      customerBar={
        <CustomerBar
          value={customer}
          onChange={(c) => setCart((s) => ({ ...s, customer: c, points: 0 }))}
          inputRef={customerRef}
          quote={quote.data}
          quoteLoading={quote.isFetching}
        />
      }
    />
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" data-pos-root="">
      <TopBar
        day={day}
        holds={holds.length}
        onHolds={() => setDialog("holds")}
        onReturns={() => setDialog("returns")}
        onDay={() => setDialog("day")}
        onHelp={() => setDialog("help")}
        onExit={exit}
      />

      <AnimatePresence initial={false}>
        {!env.online.online && (
          <motion.div
            key="offline"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-destructive text-white"
            role="alert"
          >
            <p className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium">
              <WifiOffIcon className="size-4" /> {t("pos.offline.banner")}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      {!env.sellerLoading && !env.sellerState && (
        <div className="flex items-center justify-center gap-2 bg-warning/20 px-3 py-2 text-sm" role="alert">
          <AlertTriangleIcon className="size-4" /> {t("pos.profile.body")}
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => appNavigate(settingsHref(""))}>
            {t("pos.profile.open")}
          </Button>
        </div>
      )}
      {!dayOpen && env.online.online && (
        <button type="button" onClick={() => setDialog("day")} className="flex items-center justify-center gap-2 bg-warning/10 px-3 py-1.5 text-xs font-medium hover:bg-warning/20 md:hidden">
          <CalendarClockIcon className="size-3.5" /> {t("pos.top.dayNotOpen")}
        </button>
      )}

      <div className="relative flex min-h-0 flex-1">
        <main className="min-h-0 flex-1 p-3">
          <div ref={shakeScope} className="relative h-full">
            <AnimatePresence>
              {scanMiss > 0 && (
                <motion.span
                  key={scanMiss}
                  aria-hidden
                  className="pointer-events-none absolute -inset-1 z-10 rounded-2xl ring-4 ring-destructive/60"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.8 }}
                />
              )}
            </AnimatePresence>
            <ProductPanel
              searchRef={searchRef}
              query={query}
              onQuery={setQuery}
              onSubmit={(q, first) => void onSubmitSearch(q, first)}
              onAdd={(p) => {
                add(p);
                setQuery("");
                focusSearch();
              }}
              onPickProduct={setPickProduct}
              onCamera={() => setDialog("camera")}
              favourites={favourites}
              recent={recent}
              onToggleFavourite={(p) => setFavourites((f) => toggleFavourite(f, p))}
            />
          </div>
        </main>
        {desktop && <aside className="flex w-[400px] min-w-0 flex-col border-l bg-card/50 xl:w-[440px]">{cartPanel}</aside>}
        {sale && <ReceiptView sale={sale} onNewSale={newSale} />}
      </div>

      {!desktop && (
        <div className="grid grid-cols-[1fr_auto] gap-2 border-t bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setSheet(true)}
            className="relative flex min-h-14 items-center gap-3 overflow-hidden rounded-xl border bg-background px-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="relative">
              <ShoppingCartIcon className="size-6" />
              {lines.length > 0 && (
                <span className="absolute -top-2 -right-2 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.6875rem] font-semibold text-primary-foreground tabular-nums">
                  {lines.length}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={lastAdded?.n ?? 0}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="block truncate text-xs text-muted-foreground"
                >
                  {lastAdded && lines.length ? t("pos.cart.added", { name: lastAdded.name }) : t("pos.cart.viewCart")}
                </motion.span>
              </AnimatePresence>
              <AnimatedNumber value={payable} format={money} className="block text-lg font-bold tabular-nums" />
            </span>
          </button>
          <Button type="button" size="lg" className="h-auto min-h-14 px-5 text-base" onClick={openPay} disabled={lines.length === 0}>
            <WalletIcon /> {t("pos.cart.pay")}
          </Button>
        </div>
      )}

      {!desktop && (
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent side="bottom" className="h-[90dvh] gap-0 rounded-t-2xl p-0" closeLabel={t("pos.common.close")}>
            <SheetHeader className="border-b py-3">
              <SheetTitle>{t("pos.cart.title")}</SheetTitle>
              <SheetDescription className="sr-only">{t("pos.cart.sheetBody")}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1">{cartPanel}</div>
          </SheetContent>
        </Sheet>
      )}

      <PaymentDialog
        open={dialog === "pay"}
        onClose={() => setDialog(null)}
        totals={totals}
        customer={customer}
        quote={quote.data}
        points={cart.points}
        onPoints={(n) => setCart((c) => ({ ...c, points: n }))}
        onComplete={complete}
      />
      <LineEditDialog
        line={editing}
        onClose={() => setEditKey(null)}
        onSave={(key, e) => {
          updateLines((l) => setDiscount(setPrice(setQty(l, key, e.qty), key, e.price), key, e.discount));
          setEditKey(null);
        }}
      />
      <VariantPicker productId={pickProduct} onClose={() => setPickProduct(null)} onPick={add} />
      <CameraScanDialog open={dialog === "camera"} onClose={() => setDialog(null)} onCode={(c) => void scan(c)} />
      <HoldDialog open={dialog === "hold"} defaultName={defaultHoldName} onClose={() => setDialog(null)} onHold={holdCurrent} />
      <HoldsDialog
        open={dialog === "holds"}
        holds={holds}
        cartHasItems={lines.length > 0}
        onClose={() => setDialog(null)}
        onRecall={recall}
        onDelete={(id) => setHolds((h) => dropHold(h, id))}
      />
      <ReturnsDialog
        open={dialog === "returns"}
        onClose={() => setDialog(null)}
        onRefund={(amount, number) =>
          setDay((d) => (d && d.date === todayIST() && !d.closedAt ? { ...d, cashMoves: [...d.cashMoves, { at: new Date().toISOString(), amount: -amount, note: t("pos.returns.refundNote", { number }) }] } : d))
        }
      />
      <DayDialog
        open={dialog === "day"}
        day={day}
        onClose={() => setDialog(null)}
        onOpenDay={(cash) => {
          setDay(openDay(todayIST(), cash, env.cashier));
          setDialog(null);
          toast.success(t("pos.day.opened"));
        }}
        onCloseDay={(counts, note) => {
          setDay((d) => (d ? closeDay(d, counts, note) : d));
          toast.success(t("pos.day.closed"));
        }}
        onCashMove={(amount, note) =>
          setDay((d) => (d ? { ...d, cashMoves: [...d.cashMoves, { at: new Date().toISOString(), amount, note }] } : d))
        }
      />
      <HelpDialog open={dialog === "help"} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={dialog === "clear"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("pos.cart.clearTitle")}
        description={t("pos.cart.clearBody")}
        confirmLabel={t("pos.cart.clear")}
        onConfirm={() => {
          setCart(EMPTY_CART);
          setDialog(null);
        }}
      />
    </div>
  );
}

let audio: AudioContext | null = null;

/** Short beep: high for a good scan, low for a miss. Silent when audio isn't allowed yet. */
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = ok ? 1320 : 220;
    osc.type = ok ? "sine" : "square";
    gain.gain.value = 0.04;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.07 : 0.18));
  } catch {
    // no audio
  }
}
