"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, CalendarClockIcon, ShoppingCartIcon, WalletIcon } from "lucide-react";
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
} from "@rbms/ui";
import { upiLink } from "@rbms/gst";
import { ApiError, ApprovalCancelled, ConfirmDialog, describeError, useAppNavigate, useDebounced, useDiscountApproval, useI18n, useOptionalShop, usePermission, useSettingsHref } from "@rbms/web";
import {
  addPayment,
  createBill,
  isNetworkError,
  lookupCode,
  posApi,
  resolveCode,
  useCategories,
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
import { buildSale, offlineBlocker, offlineInvoice, slipInvoice } from "../lib/offline/bill";
import { newClientId } from "../lib/offline/queue";
import { reportNetwork } from "../lib/online";
import { fromBillingItem, fromLookup, looksLikeCode } from "../lib/products";
import type { ShortcutAction } from "../lib/shortcuts";
import { dropHold, holdBill, pushRecent, storageKey, toggleFavourite, useLocalState, type HeldBill } from "../lib/storage";
import { migrateLocalDay, useRegisterName, useTillActions, useTillSession } from "../lib/till";
import { buildDisplayState } from "../lib/display";
import { useCustomerDisplay, useDisplays } from "../lib/display-client";
import { fitPayments, paymentsFor } from "../lib/tender";
import { customerPhone, NO_CUSTOMER, type BillingItem, type Paged, type PosCustomer, type VariantLookup } from "../lib/types";
import { useCounterKeys, useFinePointer, useMediaQuery } from "../lib/use-keys";
import { needsWeight, resolveScan, type ScanHit, type ServerHit } from "../lib/scan";
import { getTicketByCode, markTicketUsed, usePricingCache } from "../lib/terminal-api";
import { listsFor, repriceLines, setLineUnit } from "../lib/units";
import { PriceListPicker } from "./price-list-picker";
import type { WeighTicket } from "../lib/terminal-types";
import { addTicket, isTicketCode, markTicketsUsed, removeLineOrTicket, ticketIdsOf } from "../lib/weigh-ticket";
import { CameraScanDialog } from "./camera-scan";
import { CatalogProvider, useCatalog } from "./catalog-provider";
import { AlsoBuyChips } from "./also-buy-chips";
import { CartPanel } from "./cart-panel";
import { CustomerBar } from "./customer-bar";
import { DayDialog } from "./day-dialog";
import { DisplayDialog } from "./display/display-dialog";
import { HelpDialog } from "./help-dialog";
import { HoldDialog, HoldsDialog } from "./holds-dialog";
import { BatchPickDialog } from "./batch-pick-dialog";
import { useAutoBatches } from "../lib/batches";
import { LineEditDialog } from "./line-edit-dialog";
import { PaymentDialog, type PaymentResult } from "./payment-dialog";
import { PosProvider, usePos } from "./pos-context";
import { ProductPanel } from "./product-panel";
import { ReceiptView, type CompletedSale } from "./receipt-view";
import { ReturnsDialog } from "./returns-dialog";
import { TopBar } from "./top-bar";
import { VariantPicker } from "./variant-picker";
import { WeightDialog } from "./weight-dialog";
import { QuickAddDialog, type QuickAddTarget } from "./quick-add-dialog";
import type { VoiceAddLine } from "./voice-bill";
import { QUICK_ADD_PERMISSION, shouldOfferQuickAdd } from "../lib/quick-add";
import { OfflineBar } from "./offline/offline-bar";
import { OfflineProvider, useOffline } from "./offline/offline-provider";
import { PendingBillsDialog } from "./offline/pending-bills-dialog";

interface CartState {
  lines: CartLine[];
  customer: PosCustomer;
  /** Loyalty points to redeem on this bill. */
  points: number;
}

const EMPTY_CART: CartState = { lines: [], customer: NO_CUSTOMER, points: 0 };

type DialogKind = "display" | "pay" | "hold" | "holds" | "returns" | "day" | "help" | "camera" | "clear" | "pending" | "exit";

/** The full-screen counter (covers the app shell). */

/**
 * A scanned / typed code: an item barcode or SKU first; when none matches (404), the counter resolvers (weighing-scale
 * labels with the weight, serial numbers / IMEIs with the unit). Null = nothing matched.
 */
async function lookupOrResolve(code: string): Promise<{ variant?: VariantLookup; qty?: number; serial?: string; weighTicket?: WeighTicket } | null> {
  try {
    return { variant: await lookupCode(code) };
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
  try {
    return await resolveCode(code);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
}

export function PosScreen() {
  return (
    <PosProvider>
      <OfflineProvider>
        <WithCatalog />
      </OfflineProvider>
    </PosProvider>
  );
}

/** The full POS catalogue cache: on a paired terminal, and for staff when pos.terminals is on (falls back when absent). */
function WithCatalog() {
  const env = usePos();
  return (
    <CatalogProvider enabled={!!env.terminal || env.has.terminals} tenant={env.tenant}>
      <Counter />
    </CatalogProvider>
  );
}

/** The server side of a scan: lookup → resolvers (catalogue on), or a billing item by exact code (catalogue off). */
async function serverHit(code: string, catalogue: boolean): Promise<ServerHit | null> {
  if (!catalogue) {
    const r = await posApi.get<Paged<BillingItem>>("/invoices/items", { q: code, limit: 2 });
    return r.items.length === 1 ? { product: fromBillingItem(r.items[0]!) } : null;
  }
  const hit = await lookupOrResolve(code);
  if (!hit) return null;
  return { product: hit.variant ? fromLookup(hit.variant) : undefined, qty: hit.qty, serial: hit.serial, weighTicket: hit.weighTicket };
}

function Counter() {
  const env = usePos();
  const catalog = useCatalog();
  const offline = useOffline();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const appNavigate = useAppNavigate();
  const settingsHref = useSettingsHref();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const finePointer = useFinePointer();

  const [cart, setCart] = useLocalState<CartState>(storageKey("cart", env.tenant, env.userId), EMPTY_CART);
  const [holds, setHolds] = useLocalState<HeldBill[]>(storageKey("holds", env.tenant, env.userId), []);
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
  /** A by-weight item waiting for its weight. */
  const [weighProduct, setWeighProduct] = React.useState<CartProduct | null>(null);
  /** Voice billing: weighed items said aloud wait here for the weighing prompt (the weighing station flow wins), one after another. */
  const [weighQueue, setWeighQueue] = React.useState<VoiceAddLine[]>([]);
  const [weighSaid, setWeighSaid] = React.useState<number | null>(null);
  const [quickAddTarget, setQuickAddTarget] = React.useState<QuickAddTarget | null>(null);
  const [lastGst, setLastGst] = useLocalState<number | null>(storageKey("quick-add-gst", env.tenant), null);
  const hasCatalogueManage = usePermission(QUICK_ADD_PERMISSION);
  // Only staff who may create products (and not a paired terminal session) can save a new item; open items follow price edits.
  const canCreateItem = env.has.catalogue && hasCatalogueManage && !env.terminal;
  const canOpenItem = env.can.price;
  const categoriesQuery = useCategories(env.has.catalogue && canCreateItem);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const customerRef = React.useRef<HTMLInputElement>(null);

  const lines = cart.lines;
  const customer = cart.customer;

  // Price lists (docs/price-lists-units.md): the customer's list or the one picked here, priced from the cached lists
  // (offline too). Lines whose price was changed by hand keep it.
  const [priceChoice, setPriceChoice] = useLocalState<string>(storageKey("price-list", env.tenant), "");
  const pricingFallback = usePricingCache(!catalog.pricing && env.online.online);
  const pricing = catalog.pricing ?? pricingFallback ?? null;
  const customerId = customer.kind === "saved" ? customer.customer.id : null;
  const priceLists = React.useMemo(() => listsFor(pricing, { customerId, chosen: priceChoice || null }), [pricing, customerId, priceChoice]);
  const autoListName = React.useMemo(() => listsFor(pricing, { customerId })[0]?.name ?? null, [pricing, customerId]);
  const priceSig = lines.map((l) => `${l.key}:${l.unit}:${l.qty}:${l.price}:${l.listPrice}`).join("|");
  React.useEffect(() => {
    if (!pricing) return;
    const today = todayIST();
    setCart((c) => {
      const next = repriceLines(c.lines, priceLists, today);
      return next === c.lines ? c : { ...c, lines: next };
    });
  }, [pricing, priceLists, priceSig, setCart]);
  const sellerState = env.sellerState ?? "00";
  const placeOfSupply = (customer.kind === "saved" && customer.customer.stateCode) || sellerState;
  const totals = React.useMemo(() => cartTotals(lines, { sellerState, placeOfSupply, taxFree: env.seller.taxScheme === "composition" }), [lines, sellerState, placeOfSupply, env.seller.taxScheme]);

  const phone = e164(customerPhone(customer));
  const quoteAmount = useDebounced(totals.total, 400);
  const quote = useLoyaltyQuote(phone, quoteAmount, env.has.loyalty && env.online.online);
  const pointsDiscount = cart.points * (quote.data?.pointValuePaise ?? 0);
  const payable = payableAfterLoyalty(totals, pointsDiscount);
  const stock = useStock(
    lines.map((l) => l.itemId).filter((id) => !id.startsWith("open:")),
    env.has.inventory,
  );

  // Items with batches: the oldest-expiry batch is put on the line; tap it to choose another.
  const [batchKey, setBatchKey] = React.useState<string | null>(null);
  const batchTracked = useAutoBatches(lines, (fn) => setCart((c) => ({ ...c, lines: fn(c.lines) })), (env.has.inventory || env.has.medicines) && env.online.online, env.has.medicines);

  // The till session of this register (server-side; the last one seen is cached for offline display).
  const branchReady = !env.has.branches || !!env.branch;
  const [storedRegister, setRegister] = useRegisterName(env.tenant);
  // A paired terminal's till register is the terminal's name.
  const register = env.terminal?.device.terminal.name ?? storedRegister;
  const tillQuery = useTillSession(env.tenant, register, env.branch?.id ?? null, branchReady && !env.sellerLoading);
  const till = tillQuery.data ?? null;
  const tillActions = useTillActions(register, env.branch?.id ?? null);
  const dayOpen = !!till && till.status === "open";
  const refreshTill = React.useCallback(() => void qc.invalidateQueries({ queryKey: ["pos", "till"] }), [qc]);

  // Customer display (docs/counter-close-display-labels.md): the bill, the total, the UPI QR while paying by UPI, then
  // "Thank you" for a few seconds. Same-PC tabs hear it at once; paired screens get it from the server.
  const [upiAmount, setUpiAmount] = React.useState(0);
  const [thanks, setThanks] = React.useState(false);
  const shopBrand = useOptionalShop();
  const screens = useDisplays(register, env.online.online);
  const displayState = React.useMemo(
    () =>
      buildDisplayState({
        lines,
        totals,
        payable,
        pointsDiscount,
        customerName: customer.kind === "saved" ? customer.customer.name : null,
        paying: dialog === "pay",
        upiAmount,
        upiLink: env.seller.upiId ? upiLink({ vpa: env.seller.upiId, name: env.seller.legalName || env.shopName, amountPaise: upiAmount, note: t("pos.pay.upiNote") }) : null,
        sale: sale && thanks ? { total: sale.invoice.total, change: sale.change } : null,
        locale: locale === "ta" ? "ta" : "en",
        shop: { name: env.shopName, logoUrl: shopBrand?.logoUrl ?? null },
        now: Date.now(),
      }),
    // `now` is taken when the bill changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, totals, payable, pointsDiscount, customer, dialog, upiAmount, env.seller.upiId, env.seller.legalName, env.shopName, sale, thanks, locale, shopBrand?.logoUrl],
  );
  useCustomerDisplay({ tenant: env.tenant, register, remote: (screens.data ?? []).some((d) => d.paired), state: displayState });
  React.useEffect(() => {
    if (!sale) return setThanks(false);
    setThanks(true);
    const id = window.setTimeout(() => setThanks(false), 12_000);
    return () => window.clearTimeout(id);
  }, [sale]);

  // ---------------------------------------------------------------- cart updates

  /** Any change to the lines drops applied points (the redeemable amount depends on the bill). */
  const updateLines = React.useCallback((fn: (l: CartLine[]) => CartLine[]) => setCart((c) => ({ ...c, lines: fn(c.lines), points: 0 })), [setCart]);

  const focusSearch = React.useCallback(() => {
    if (finePointer && desktop) window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [finePointer, desktop]);

  const add = React.useCallback(
    (p: CartProduct, qty = 1, serial?: string | null) => {
      let key = "";
      setCart((c) => {
        const r = addProduct(c.lines, p, qty, serial);
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
      } else if (shouldOfferQuickAdd({ code, looksLikeCode: looksLikeCode(code), online: env.online.online, canCreate: canCreateItem, canOpenItem })) {
        setQuickAddTarget({ code: code.trim() });
      } else if (looksLikeCode(code) && env.online.online && env.has.catalogue) {
        toast.error(`${t("pos.scan.notFound", { code })} ${t("pos.quickAdd.askManagerShort")}`);
      } else {
        toast.error(t("pos.scan.notFound", { code }));
      }
    },
    [t, reduced, shake, shakeScope, env.online.online, env.has.catalogue, canCreateItem, canOpenItem],
  );

  /** A weigh ticket's lines go in as fixed lines (once per ticket). */
  const addTicketLines = React.useCallback(
    (ticket: WeighTicket) => {
      let result: ReturnType<typeof addTicket> | null = null;
      setCart((c) => {
        result = addTicket(c.lines, ticket);
        return result.ok ? { ...c, lines: result.lines, points: 0 } : c;
      });
      const r = result as ReturnType<typeof addTicket> | null;
      if (!r) return;
      if (!r.ok) {
        beep(false);
        if (r.reason === "duplicate") toast.info(t("pos.ticket.duplicate", { code: ticket.code }));
        else if (r.reason === "expired") toast.error(t("pos.ticket.error.expired", { code: ticket.code }));
        else toast.error(t(ticket.status === "cancelled" ? "pos.ticket.error.cancelled" : "pos.ticket.error.used", { code: ticket.code }));
        return;
      }
      const last = r.keys.at(-1)!;
      setSelected(last);
      setFlash({ key: last, n: Date.now() });
      setLastAdded({ name: ticket.code, n: Date.now() });
      beep(true);
      toast.success(t("pos.ticket.added", { code: ticket.code, count: ticket.lines.length }));
    },
    [setCart, t],
  );

  /** Acts on a scan result; false = nothing matched. */
  const applyHit = React.useCallback(
    (hit: ScanHit): boolean => {
      switch (hit.kind) {
        case "ticket":
          addTicketLines(hit.ticket);
          return true;
        case "ticketError":
          beep(false);
          toast.error(t(`pos.ticket.error.${hit.error}`, { code: hit.code }));
          return true;
        case "item":
          if (needsWeight(hit)) setWeighProduct(hit.product);
          else add(hit.product, hit.qty ?? 1, hit.serial);
          return true;
        case "miss":
          return false;
      }
    },
    [add, addTicketLines, t],
  );

  const scanDeps = React.useMemo(
    () => ({ cache: catalog.index, tickets: env.has.weighing, getTicket: getTicketByCode, server: (c: string) => serverHit(c, env.has.catalogue) }),
    [catalog.index, env.has.weighing, env.has.catalogue],
  );

  const scan = React.useCallback(
    async (code: string) => {
      try {
        const hit = await resolveScan(code, scanDeps);
        if (hit.kind !== "item" || hit.source === "server") reportNetwork(true);
        if (!applyHit(hit)) miss(code);
      } catch (err) {
        miss(code, err);
      }
    },
    [scanDeps, applyHit, miss],
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
    if ((env.has.catalogue || catalog.index) && (looksLikeCode(q) || isTicketCode(q))) {
      try {
        if (applyHit(await resolveScan(q, scanDeps))) {
          setQuery("");
          return;
        }
      } catch (err) {
        if (isNetworkError(err)) return miss(q, err);
      }
    }
    if (first) {
      addOrWeigh(first);
      setQuery("");
    } else miss(q);
  };

  /** The confirmed lines of a spoken order (voice billing). Nothing is billed here; the lines join the cart like any other. */
  const addVoiceLines = (lines: VoiceAddLine[]) => {
    const toWeigh: VoiceAddLine[] = [];
    for (const l of lines) {
      if (l.product.soldBy === "weight" && env.has.weighing) toWeigh.push(l);
      else add(l.product, l.qty);
    }
    if (toWeigh.length) {
      setWeighProduct(toWeigh[0]!.product);
      setWeighSaid(toWeigh[0]!.qty);
      setWeighQueue(toWeigh.slice(1));
    }
    setQuery("");
  };
  const nextWeigh = () => {
    const next = weighQueue[0];
    setWeighProduct(next?.product ?? null);
    setWeighSaid(next?.qty ?? null);
    setWeighQueue((q) => q.slice(1));
  };

  /** Grid taps: by-weight items ask for the weight first. */
  function addOrWeigh(p: CartProduct) {
    if (p.soldBy === "weight") setWeighProduct(p);
    else add(p);
  }

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

  const approval = useDiscountApproval();

  /** The attempt key of the bill being made: the same cart retried is the same bill (Idempotency-Key). */
  const billKey = React.useRef<{ sig: string; key: string } | null>(null);

  /** No connection: the sale is saved on this device (with its number) and synced later. */
  const completeOffline = async (r: PaymentResult): Promise<boolean> => {
    const blocker = offlineBlocker(lines, r.points > 0 || r.tenders.credit > 0 ? ["credit"] : []);
    if (blocker) {
      toast.error(t(blocker === "ticket" ? "pos.off.noTickets" : "pos.off.noCredit"));
      return false;
    }
    const date = todayIST();
    const payments = paymentsFor(r.settlement, r.tenders, r.refs);
    const built = buildSale({
      lines,
      customer,
      phone,
      payments,
      ...(dayOpen ? { tillSessionId: till!.id } : {}),
      cashier: env.cashier,
      date,
      now: new Date(),
      walkInName: t("pos.customer.walkInName"),
      sellerState,
      placeOfSupply,
    });
    let bill;
    try {
      bill = await offline.enqueue(built);
    } catch {
      toast.error(t("pos.off.saveFailed"));
      return false;
    }
    const inv = offlineInvoice(bill)!;
    setCart(EMPTY_CART);
    setSelected(null);
    setDialog(null);
    setSale({ invoice: inv, change: r.settlement.change, credit: 0, failedPayments: [], phone });
    // Bottom of the screen: at the top it would sit on the offline bar that tells the same story.
    toast.success(t("pos.off.savedToast", { number: bill.number }), { position: "bottom-center" });
    return true;
  };

  const complete = async (r: PaymentResult): Promise<boolean> => {
    if (!env.online.online) return completeOffline(r);
    const date = todayIST();
    const tillSessionId = dayOpen ? till!.id : undefined;
    const input: CreateBillInput = { date, lines: lines.map(toLineInput), issue: true, ...(tillSessionId ? { tillSessionId } : {}) };
    if (customer.kind === "saved") input.customerId = customer.customer.id;
    else if (customer.kind === "walkin") input.customer = { name: customer.name.trim() || t("pos.customer.walkInName"), ...(phone ? { phone } : {}) };
    if (r.points > 0) input.loyaltyPoints = r.points;

    let inv;
    try {
      // A discount above the cashier's limit asks for a manager's PIN (server-enforced) and repeats the bill with it.
      const sig = JSON.stringify(input);
      if (billKey.current?.sig !== sig) billKey.current = { sig, key: newClientId() };
      const key = billKey.current.key;
      inv = await approval.run((pin) => createBill(input, pin, key));
      billKey.current = null;
      reportNetwork(true);
    } catch (err) {
      if (err instanceof ApprovalCancelled) return false;
      if (isNetworkError(err)) {
        reportNetwork(false);
        toast.error(t("pos.offline.billFailed"));
      } else toast.error(describeError(err, t));
      return false;
    }

    // Weigh tickets on the bill are used now (stable idempotency key per bill + ticket); the bill stands either way.
    const ticketIds = ticketIdsOf(lines);
    if (ticketIds.length) {
      const used = await markTicketsUsed(inv.id, ticketIds, markTicketUsed);
      if (used.failed.length) toast.warning(t("pos.ticket.useFailed", { count: used.failed.length }));
    }

    const planned = fitPayments(paymentsFor(r.settlement, r.tenders, r.refs), inv.balance);
    const failed: { method: string; amount: number }[] = [];
    for (const p of planned) {
      try {
        inv = await addPayment(inv.id, { ...p, date, ...(tillSessionId ? { tillSessionId } : {}) });
      } catch (err) {
        if (isNetworkError(err)) reportNetwork(false);
        failed.push({ method: p.method, amount: p.amount });
      }
    }
    const cashPaid = planned.find((p) => p.method === "cash" && !failed.some((f) => f.method === "cash"))?.amount ?? 0;
    const change = Math.max(r.tenders.cash - cashPaid, 0);
    const failedSum = failed.reduce((s, f) => s + f.amount, 0);
    const credit = Math.max(inv.balance - failedSum, 0);

    setCart(EMPTY_CART);
    setSelected(null);
    setDialog(null);
    setSale({ invoice: inv, change, credit, failedPayments: failed, phone });
    void qc.invalidateQueries({ queryKey: ["pos", "payments"] });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["pos", "stock"] });
    refreshTill();
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
        if (target) updateLines((l) => removeLineOrTicket(l, target));
        break;
      case "help":
        setDialog("help");
        break;
    }
  };

  const overlayOpen = dialog !== null || editKey !== null || pickProduct !== null || sale !== null || weighProduct !== null || quickAddTarget !== null;
  useCounterKeys({ enabled: !overlayOpen, onScan, onShortcut });

  // Desktop: keep the search box ready for typing / scanning.
  React.useEffect(() => {
    if (!overlayOpen) focusSearch();
  }, [overlayOpen, focusSearch]);

  // First load: carry a device-only day (before till sessions moved to the server) over, or drop it with a notice;
  // then offer to open the till when this register has no open session (once per visit).
  const asked = React.useRef(false);
  React.useEffect(() => {
    if (asked.current || env.sellerLoading || !branchReady || !tillQuery.isSuccess || !env.online.online) return;
    asked.current = true;
    void (async () => {
      let opened = dayOpen;
      try {
        const r = await migrateLocalDay({
          tenant: env.tenant,
          branchCode: env.branch?.code ?? null,
          register,
          today: todayIST(),
          actorName: env.cashier,
          hasServerSession: dayOpen,
          open: (b) => tillActions.open.mutateAsync(b),
          cash: (b) => tillActions.cash.mutateAsync(b),
        });
        if (r === "migrated") {
          opened = true;
          toast.success(t("pos.till.migrated"));
        } else if (r === "dropped") toast.info(t("pos.till.dropped"));
      } catch (err) {
        toast.error(describeError(err, t));
      }
      if (!opened && env.can.till) setDialog((d) => d ?? "day");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the till state is known
  }, [env.sellerLoading, branchReady, tillQuery.isSuccess, env.online.online]);

  const doExit = () => {
    // On a paired terminal "Exit" locks it for the next cashier.
    if (env.terminal) env.terminal.lock("locked");
    else appNavigate("/");
  };
  // Leaving (or locking) with bills that haven't reached the server asks first: they stay safe on this device.
  const exit = () => {
    if (offline.counts.pending > 0) setDialog("exit");
    else doExit();
  };

  const editing = editKey ? (lines.find((l) => l.key === editKey) ?? null) : null;
  const payBlocked = !env.online.online ? t("pos.off.payOfflineTitle") : null;

  const cartPanel = (
    <CartPanel
      lines={lines}
      totals={totals}
      payable={payable}
      pointsDiscount={pointsDiscount}
      selectedKey={target}
      flash={flash}
      stock={stock.data}
      batchTracked={batchTracked}
      onBatch={setBatchKey}
      onSelect={setSelected}
      onStep={(key, d) => updateLines((l) => stepQty(l, key, d))}
      onEdit={(key) => {
        if (lines.find((l) => l.key === key)?.ticket) toast.info(t("pos.ticket.fixed"));
        else setEditKey(key);
      }}
      onRemove={(key) => updateLines((l) => removeLineOrTicket(l, key))}
      onHold={() => setDialog("hold")}
      onPay={openPay}
      payBlocked={payBlocked}
      suggestions={<AlsoBuyChips lines={lines} onAdd={(p) => add(p)} />}
      customerBar={
        <>
          <CustomerBar
            value={customer}
            onChange={(c) => setCart((s) => ({ ...s, customer: c, points: 0 }))}
            inputRef={customerRef}
            quote={quote.data}
            quoteLoading={quote.isFetching}
          />
          <PriceListPicker pricing={pricing} value={priceChoice} onChange={setPriceChoice} autoName={autoListName} />
        </>
      }
    />
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" data-pos-root="">
      <TopBar
        day={dayOpen ? { date: todayIST(), openedAt: till!.openedAt } : null}
        holds={holds.length}
        onHolds={() => setDialog("holds")}
        onReturns={() => setDialog("returns")}
        onDay={() => setDialog("day")}
        onDisplay={() => setDialog("display")}
        onHelp={() => setDialog("help")}
        onExit={exit}
      />

      <OfflineBar onOpen={() => setDialog("pending")} />
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
        <main className="min-h-0 min-w-0 flex-1 p-3">
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
                addOrWeigh(p);
                setQuery("");
                focusSearch();
              }}
              onPickProduct={setPickProduct}
              onCamera={() => setDialog("camera")}
              onVoiceAdd={addVoiceLines}
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
        onUpi={setUpiAmount}
      />
      <LineEditDialog
        line={editing}
        onClose={() => setEditKey(null)}
        onSave={(key, e) => {
          updateLines((l) => setDiscount(setPrice(setQty(e.unit ? setLineUnit(l, key, e.unit) : l, key, e.qty), key, e.price), key, e.discount));
          setEditKey(null);
        }}
      />
      <BatchPickDialog
        line={lines.find((l) => l.key === batchKey) ?? null}
        onClose={() => setBatchKey(null)}
        onPick={(key, batch) => updateLines((ls) => ls.map((l) => (l.key === key ? { ...l, batch: batch ?? undefined } : l)))}
      />
      <VariantPicker productId={pickProduct} onClose={() => setPickProduct(null)} onPick={add} />
      <WeightDialog
        product={weighProduct}
        said={weighSaid}
        onClose={() => {
          setWeighProduct(null);
          setWeighQueue([]);
          setWeighSaid(null);
        }}
        onAdd={(p, qty) => {
          add(p, qty);
          nextWeigh();
        }}
      />
      <QuickAddDialog
        target={quickAddTarget}
        canCreate={canCreateItem}
        canOpenItem={canOpenItem}
        hasInventory={env.has.inventory}
        categories={categoriesQuery.data ?? []}
        defaultGst={lastGst ?? undefined}
        onClose={() => {
          setQuickAddTarget(null);
          window.setTimeout(() => searchRef.current?.focus(), 0);
        }}
        onAdded={(p, gst) => {
          setLastGst(gst);
          setQuickAddTarget(null);
          add(p);
          setQuery("");
          void qc.invalidateQueries({ queryKey: ["pos"] });
          window.setTimeout(() => searchRef.current?.focus(), 0);
        }}
      />
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
        tillSessionId={dayOpen ? till!.id : null}
        onDone={() => {
          refreshTill();
          void qc.invalidateQueries({ queryKey: ["pos", "stock"] });
          void qc.invalidateQueries({ queryKey: ["pos", "payments"] });
        }}
      />
      <DayDialog
        open={dialog === "day"}
        onClose={() => setDialog(null)}
        session={dayOpen ? till : null}
        loading={tillQuery.isPending}
        register={register}
        onRegister={env.terminal ? () => undefined : setRegister}
        canTill={env.can.till}
      />
      <DisplayDialog open={dialog === "display"} onClose={() => setDialog(null)} register={register} />
      <HelpDialog open={dialog === "help"} onClose={() => setDialog(null)} />
      <PendingBillsDialog
        open={dialog === "pending"}
        onClose={() => setDialog(null)}
        onShowSlip={(b) => {
          const inv = slipInvoice(b);
          if (!inv) return;
          setDialog(null);
          setSale({ invoice: inv, change: 0, credit: 0, failedPayments: [], phone: b.payload.customer?.phone ?? null });
        }}
      />
      <ConfirmDialog
        open={dialog === "exit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("pos.off.exitTitle")}
        description={t(env.online.online ? "pos.off.exitBodyOnline" : "pos.off.exitBodyOffline", { count: offline.counts.pending })}
        confirmLabel={t(env.terminal ? "pos.off.exitLock" : "pos.off.exitLeave")}
        onConfirm={() => {
          setDialog(null);
          doExit();
        }}
      />
      {approval.dialog}
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
