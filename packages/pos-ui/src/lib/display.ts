import type { CartLine, CartTotals } from "./cart";

/**
 * Customer-facing display (docs/counter-close-display-labels.md): what the counter tells the second screen, and the
 * pieces the screen needs to read it. Pure, no React: unit tested.
 *
 * The state carries only what the customer should see: the bill lines, the total, what they saved, a UPI QR link for
 * the amount being paid by UPI, and a name when the cashier picked a saved customer. No phone, address or GSTIN.
 */

export type DisplayPhase = "idle" | "cart" | "pay" | "thanks";

export interface DisplayLine {
  name: string;
  qty: number;
  unit: string;
  /** Paise per unit as sold. */
  price: number;
  /** Paise for the line, with tax. */
  total: number;
}

export interface DisplaySlide {
  name: string;
  image: string;
  price?: number | null;
  mrp?: number | null;
}

export interface DisplayState {
  phase: DisplayPhase;
  lines: DisplayLine[];
  /** Lines that did not fit. */
  more: number;
  itemCount: number;
  total: number;
  savings: number;
  customerName: string | null;
  upi: { link: string; amount: number } | null;
  paid: { total: number; change: number } | null;
  locale: "en" | "ta";
  shop: { name: string; logoUrl: string | null } | null;
  slides?: DisplaySlide[];
  /** The counter's clock (ms), to drop out-of-order updates. */
  at: number;
}

/** The screen shows the newest lines first so the item just scanned is always in view. */
export const DISPLAY_MAX_LINES = 40;

export interface BuildDisplayInput {
  lines: readonly CartLine[];
  totals: Pick<CartTotals, "lines" | "savings" | "units">;
  /** What the customer pays now (after loyalty points). */
  payable: number;
  /** Paise of loyalty points discount, counted as savings. */
  pointsDiscount?: number;
  /** A saved customer's name, else null. The screen never shows a phone number. */
  customerName: string | null;
  /** The payment dialog is open. */
  paying: boolean;
  /** Paise being paid by UPI while the UPI tab is open, 0 otherwise. */
  upiAmount: number;
  /** `upi://pay?...` for `upiAmount`; null when the shop has no UPI id. */
  upiLink: string | null;
  /** The sale that just finished; shown as "Thank you" until the next item. */
  sale: { total: number; change: number } | null;
  locale: "en" | "ta";
  shop: { name: string; logoUrl: string | null } | null;
  slides?: DisplaySlide[];
  now: number;
}

/** Everything the customer saves: line discounts, price-list prices below the catalogue price, points. */
export function savingsOf(lines: readonly CartLine[], lineDiscounts: number, pointsDiscount = 0): number {
  const listPrice = lines.reduce((s, l) => s + (l.listPrice > l.price ? Math.round((l.listPrice - l.price) * l.qty) : 0), 0);
  return Math.max(0, Math.round(lineDiscounts + listPrice + pointsDiscount));
}

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export function buildDisplayState(i: BuildDisplayInput): DisplayState {
  const base = { locale: i.locale, shop: i.shop, at: i.now, ...(i.slides ? { slides: i.slides.slice(0, 12) } : {}) };
  if (i.sale && i.lines.length === 0) {
    return { ...base, phase: "thanks", lines: [], more: 0, itemCount: 0, total: i.sale.total, savings: 0, customerName: null, upi: null, paid: { total: i.sale.total, change: i.sale.change } };
  }
  if (i.lines.length === 0) {
    return { ...base, phase: "idle", lines: [], more: 0, itemCount: 0, total: 0, savings: 0, customerName: null, upi: null, paid: null };
  }
  const all: DisplayLine[] = i.lines.map((l, n) => ({
    name: clean(l.name, 120),
    qty: l.qty,
    unit: clean(l.unit, 16),
    price: l.price,
    total: i.totals.lines[n]?.total ?? Math.round(l.qty * l.price) - l.discount,
  }));
  const shown = all.slice(-DISPLAY_MAX_LINES);
  const upi = i.paying && i.upiLink && i.upiAmount > 0 ? { link: i.upiLink, amount: i.upiAmount } : null;
  return {
    ...base,
    phase: i.paying ? "pay" : "cart",
    lines: shown,
    more: all.length - shown.length,
    itemCount: i.totals.units,
    total: i.payable,
    savings: savingsOf(i.lines, i.totals.savings, i.pointsDiscount ?? 0),
    customerName: i.customerName ? clean(i.customerName, 80) : null,
    upi,
    paid: null,
  };
}

/** Two states show the same thing (the counter does not resend a screen that has not changed). */
export const sameDisplay = (a: DisplayState | null, b: DisplayState): boolean => !!a && JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

// ---------------------------------------------------------------- same-PC channel

/** BroadcastChannel name: the counter and a display tab of the same browser and register talk without the server. */
export const displayChannelName = (tenant: string | null | undefined, register: string) => `sr-pos-display:${tenant ?? "-"}:${register.trim().toLowerCase()}`;

// ---------------------------------------------------------------- server-sent events over fetch

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental parser for a text/event-stream read in chunks (the display uses fetch, not EventSource, so the display
 * token can travel in a header instead of the URL). Feed it each decoded chunk; it returns the complete messages.
 */
export function createSseParser() {
  let buffer = "";
  return (chunk: string): SseMessage[] => {
    buffer += chunk;
    const out: SseMessage[] = [];
    for (;;) {
      const m = /\r?\n\r?\n/.exec(buffer);
      if (!m) break;
      const block = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      let event = "message";
      const data: string[] = [];
      let any = false;
      for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        const i = line.indexOf(":");
        const field = i === -1 ? line : line.slice(0, i);
        let value = i === -1 ? "" : line.slice(i + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") {
          event = value;
          any = true;
        } else if (field === "data") {
          data.push(value);
          any = true;
        }
      }
      if (any) out.push({ event, data: data.join("\n") });
    }
    return out;
  };
}

/** A state from the wire or a BroadcastChannel; null when it is not one (a stale or hostile message is ignored). */
export function readDisplayState(raw: unknown): DisplayState | null {
  let v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<DisplayState>;
  if (s.phase !== "idle" && s.phase !== "cart" && s.phase !== "pay" && s.phase !== "thanks") return null;
  if (!Array.isArray(s.lines) || typeof s.total !== "number" || typeof s.at !== "number") return null;
  // Only a UPI deep link may be drawn as a QR.
  const upi = s.upi && typeof s.upi.link === "string" && s.upi.link.startsWith("upi://pay?") && typeof s.upi.amount === "number" ? s.upi : null;
  return {
    phase: s.phase,
    lines: s.lines.filter((l) => l && typeof l.name === "string").slice(0, 60),
    more: typeof s.more === "number" ? s.more : 0,
    itemCount: typeof s.itemCount === "number" ? s.itemCount : 0,
    total: s.total,
    savings: typeof s.savings === "number" ? s.savings : 0,
    customerName: typeof s.customerName === "string" ? s.customerName : null,
    upi,
    paid: s.paid && typeof s.paid.total === "number" ? { total: s.paid.total, change: typeof s.paid.change === "number" ? s.paid.change : 0 } : null,
    locale: s.locale === "ta" ? "ta" : "en",
    shop: s.shop && typeof s.shop.name === "string" ? { name: s.shop.name, logoUrl: typeof s.shop.logoUrl === "string" ? s.shop.logoUrl : null } : null,
    slides: Array.isArray(s.slides) ? s.slides.filter((x) => x && typeof x.image === "string" && typeof x.name === "string").slice(0, 12) : undefined,
    at: s.at,
  };
}

// ---------------------------------------------------------------- the screen's words

export interface DisplayText {
  welcome: string;
  thankYou: string;
  visitAgain: string;
  total: string;
  items: (n: number) => string;
  more: (n: number) => string;
  saved: string;
  scanToPay: string;
  anyUpi: string;
  change: string;
  customer: (name: string) => string;
  qty: string;
  amount: string;
  item: string;
  connecting: string;
  pairTitle: string;
  pairBody: string;
  pairButton: string;
  pairCode: string;
  pairWrong: string;
  pairTooMany: string;
  pairBusy: string;
  revoked: string;
  offline: string;
}

/** The screen speaks the language the cashier picked for the bill (English / Tamil), not the browser's. */
export const DISPLAY_TEXT: Record<"en" | "ta", DisplayText> = {
  en: {
    welcome: "Welcome",
    thankYou: "Thank you!",
    visitAgain: "Visit again",
    total: "Total",
    items: (n) => `${n} ${n === 1 ? "item" : "items"}`,
    more: (n) => `+ ${n} more`,
    saved: "You saved",
    scanToPay: "Scan to pay",
    anyUpi: "GPay, PhonePe, Paytm or any UPI app",
    change: "Change",
    customer: (name) => `Hello, ${name}`,
    qty: "Qty",
    amount: "Amount",
    item: "Item",
    connecting: "Connecting…",
    pairTitle: "Customer display",
    pairBody: "On the counter, open Customer display and add a screen. Type the 6-digit code here.",
    pairButton: "Connect",
    pairCode: "6-digit code",
    pairWrong: "That code is wrong or has expired.",
    pairTooMany: "Too many tries. Wait a few minutes.",
    pairBusy: "Connecting…",
    revoked: "This screen was removed from the counter. Enter a new code to connect it again.",
    offline: "Reconnecting…",
  },
  ta: {
    welcome: "வரவேற்கிறோம்",
    thankYou: "நன்றி!",
    visitAgain: "மீண்டும் வருக",
    total: "மொத்தம்",
    items: (n) => `${n} பொருட்கள்`,
    more: (n) => `+ மேலும் ${n}`,
    saved: "நீங்கள் சேமித்தது",
    scanToPay: "செலுத்த ஸ்கேன் செய்யவும்",
    anyUpi: "GPay, PhonePe, Paytm அல்லது எந்த UPI செயலியும்",
    change: "மீதி",
    customer: (name) => `வணக்கம், ${name}`,
    qty: "எண்",
    amount: "தொகை",
    item: "பொருள்",
    connecting: "இணைக்கிறது…",
    pairTitle: "வாடிக்கையாளர் திரை",
    pairBody: "கவுண்டரில் “வாடிக்கையாளர் திரை” திறந்து ஒரு திரையைச் சேருங்கள். அதில் வரும் 6 இலக்கக் குறியீட்டை இங்கே இடுங்கள்.",
    pairButton: "இணை",
    pairCode: "6 இலக்கக் குறியீடு",
    pairWrong: "குறியீடு தவறு அல்லது காலாவதியானது.",
    pairTooMany: "அதிக முயற்சிகள். சில நிமிடங்கள் காத்திருங்கள்.",
    pairBusy: "இணைக்கிறது…",
    revoked: "இந்தத் திரை கவுண்டரிலிருந்து நீக்கப்பட்டது. மீண்டும் இணைக்க புதிய குறியீட்டை இடுங்கள்.",
    offline: "மீண்டும் இணைக்கிறது…",
  },
};

// ---------------------------------------------------------------- where the screen lives

/** The display page next to the counter: "/pos" and "/pos/terminal" both give "/pos/display". */
export function displayPath(counterPath: string, local?: string | null): string {
  const base = counterPath.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\/(terminal|display)$/, "");
  return `${base}/display${local ? `?local=${encodeURIComponent(local)}` : ""}`;
}
