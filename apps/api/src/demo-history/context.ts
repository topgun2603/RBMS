import type { Logger } from "pino";
import type { Kit } from "../kit";
import { istInstant } from "./calendar";
import type { PlannedCustomer } from "./customers";
import type { DayPlan } from "./planner";
import type { CatalogueEntry, HookId, Profile } from "./profiles";
import type { Rng } from "./rng";

/** The simulated clock: services built with `now: clock.now` see the simulated instant while a day is generated. */
export class SimClock {
  private at: Date | null = null;
  readonly now = (): Date => this.at ?? new Date();
  /** Moves the clock to a minute (and second) of an IST date. Never into the future: it is capped at the real now. */
  set(date: string, minutes: number, seconds = 0): void {
    const t = istInstant(date, minutes, seconds);
    this.at = t.getTime() > Date.now() ? new Date() : t;
  }
  reset(): void {
    this.at = null;
  }
}

export interface SimItem {
  id: string;
  name: string;
  unit: string;
  hsn: string | null;
  /** GST-exclusive catalogue rate, paise. */
  rate: number;
  gstRate: number;
  /** Price-band GST rule (apparel / footwear); bill lines re-band after discounts. */
  gstRule?: import("@rbms/gst").GstRateRule | null;
  entry: CatalogueEntry;
  /** Popularity weight (Pareto). */
  weight: number;
  /** Stock stops sales at 0 only for tracked items. */
  tracked: boolean;
  stock: number;
  /** Expected units sold per day, for sizing restock orders. */
  daily: number;
  reorder: number;
}

export interface SimCustomer {
  id: string;
  planned: PlannedCustomer;
  /** Dues in paise (ledger balance), kept in step with every bill, receipt and credit note. */
  balance: number;
}

export interface Session {
  id: string;
  register: string;
  cashier: string;
}

export interface BillLine {
  item: SimItem;
  qty: number;
  /** Overrides the item's rate (jewellery prices per piece); GST-exclusive paise. */
  rate?: number;
  description?: string;
  /** Serial numbers / IMEIs of the units sold on this line (electronics): they print on the bill and start the warranty. */
  serials?: string[];
}

export interface BillDraft {
  date: string;
  minute: number;
  index: number;
  rng: Rng;
  customer: SimCustomer | null;
  /** A name for the bill when the customer isn't a saved one (restaurants, prescriptions). */
  walkIn?: { name: string; phone?: string };
  lines: BillLine[];
  /** Filled by a hook that needs the customer to be a saved one (scheduled drugs). */
  needsCustomer?: boolean;
}

export interface IssuedBill {
  id: string;
  number: string | null;
  total: number;
  paid: number;
  lines: { itemId?: string | null; qty: number; description?: string }[];
}

export interface LowStock {
  item: SimItem;
  /** Units to order. */
  qty: number;
}

export interface PurchaseLineSpec {
  itemId?: string;
  description: string;
  hsn?: string;
  qty: number;
  unit?: string;
  /** Cost per unit, GST-exclusive paise. */
  rate: number;
  gstRate: number;
}

export interface HistoryCtx {
  kit: Kit;
  slug: string;
  tenant: { id: string; slug: string; planId: string | null; appId: string | null; name: string };
  profile: Profile;
  city: string | undefined;
  log: Logger;
  say: (line: string) => void;
  clock: SimClock;
  items: SimItem[];
  customers: SimCustomer[];
  staff: { role: string; name: string }[];
  features: Record<string, boolean>;
  rng: (label: string) => Rng;
  /** Plan of the day being generated (set by the engine). */
  day: DayPlan | null;
  /** Multiplier on the chance that a customer with dues pays today (hooks may raise it). */
  repayBoost: number;
  /** Records a supplier's bill on a date (stock arrives only for lines with an itemId). */
  recordPurchase: (date: string, supplier: string, lines: PurchaseLineSpec[]) => Promise<boolean>;
  /** Today's IST date and the latest simulated minute of it (everything after is in the future). */
  today: string;
  nowMinutes: number;
  /** First day of the simulated window (hooks that back-date records, like job intake, stay inside it). */
  windowStart: string;
}

export interface IndustryHook {
  id: HookId;
  /** Once per run, before any day: set up what the trade needs (batches, tables, pieces, scale PLUs). */
  prepare?(ctx: HistoryCtx): Promise<void>;
  /** Start of each day (daily metal rates, repay boosts). */
  beginDay?(ctx: HistoryCtx, day: DayPlan): Promise<void>;
  /** Adjust a drafted bill before it is issued (loose weights, a saved customer for scheduled drugs). */
  shapeBill?(ctx: HistoryCtx, draft: BillDraft): void;
  /** Replace the standard create-and-issue step (dining orders, jewellery pieces). Null = use the standard one. */
  issueBill?(ctx: HistoryCtx, draft: BillDraft, session: Session | null): Promise<IssuedBill[] | null>;
  /** After the bills are issued and paid (prescriptions and the H1 register entries). */
  afterBill?(ctx: HistoryCtx, draft: BillDraft, bills: IssuedBill[]): Promise<void>;
  /** Restock in the trade's own way (batches with expiry). True = handled, the engine records nothing more. */
  restock?(ctx: HistoryCtx, day: DayPlan, low: LowStock[]): Promise<boolean>;
}
