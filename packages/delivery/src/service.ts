import {
  AppError,
  badRequest,
  conflict,
  featureDisabled,
  notFound,
  randomToken,
  safeEqual,
  unauthorized,
  type FeatureGatePort,
} from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ShiprocketClient, ShiprocketDriver, ShiprocketError, parseShiprocketWebhook, type TokenCache, memoryTokenCache } from "./carriers/shiprocket";
import { MockDriver, ManualDriver } from "./carriers/simple";
import {
  canTransition,
  isShippedStatus,
  isTerminal,
  mergeEvents,
  nextMockStatus,
  OPEN_STATUSES,
  STATUS_LABELS,
} from "./carriers/status";
import { CarrierError, type CarrierDriver, type ShipmentRef, type TrackResult } from "./carriers/types";
import { createSecretBox, type SecretBox } from "./crypto";
import { CARRIERS_FEATURE } from "./features";
import {
  fallbackPincodeInfo,
  normalizePincode,
  PINCODE_RE,
  PostalPincodeDriver,
  stateCodeFromPincode,
  type PincodeDriver,
  type PincodeInfo,
} from "./pincode";
import { noopLogger, type FulfillmentInfo, type LoggerPort, type OrderFulfillmentPort } from "./ports";
import {
  CARRIER_PROVIDERS,
  deliveryAccounts,
  deliveryRates,
  deliveryZones,
  pincodeCache,
  RATE_TYPES,
  SHIPMENT_STATUSES,
  shipments,
  type CarrierProvider,
  type DeliveryAccountRow,
  type DeliveryRateRow,
  type DeliveryZoneRow,
  type PackageDims,
  type ShipmentEvent,
  type ShipmentRow,
  type ShipmentStatus,
} from "./schema";
import { isStateCode } from "./states";
import { DEFAULT_ZONE, matchZone, needsState, quoteFromRules, type Quote } from "./zones";

export interface DeliveryConfig {
  /** Any length; a 32-byte AES key is derived with sha256 (may be the same secret payments uses). */
  encryptionKey: string;
  /** Development: allow the mock carrier and `POST /shipments/:id/mock-advance`. */
  allowMock: boolean;
  /** Public API origin used to build each shop's carrier webhook URL. */
  webhookBaseUrl: string;
  /** Overrides for tests / sandboxes. */
  shiprocketBaseUrl?: string;
  pincodeApiUrl?: string;
}

export interface DeliveryDeps {
  db: Db;
  config: DeliveryConfig;
  orders: OrderFulfillmentPort;
  /** Per-shop feature switches; absent = everything on. Used where no request pipeline checks it (webhook, job, carriers). */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  /** Injectable for tests; defaults to global fetch (Shiprocket + pincode API). */
  fetch?: typeof fetch;
  now?: () => Date;
  /** Defaults to api.postalpincode.in (5 s timeout). */
  pincodeDriver?: PincodeDriver;
  /** Shiprocket token cache; defaults to an in-memory map (tokens re-used ~9 days). */
  tokenCache?: TokenCache;
  /** Tests: fixed driver instances per provider. */
  drivers?: Partial<Record<CarrierProvider, CarrierDriver>>;
}

/** Used when neither the request nor the account gives a package size. */
export const DEFAULT_PACKAGE: PackageDims = { lengthCm: 20, breadthCm: 15, heightCm: 10, weightGrams: 500 };

export const PINCODE_CACHE_DAYS = 30;
const PINCODE_MISS_CACHE_DAYS = 1;
const DAY_MS = 86_400_000;
/** The tracking job ignores shipments older than this (stuck ones are for staff to sort out). */
const TRACK_WINDOW_DAYS = 90;
export const WEBHOOK_TOKEN_HEADER = "x-api-key";

// ------------------------------------------------------------------ validation

const money = z.number().int().min(0).max(100_000_000);
const uniq = <T>(a: T[]) => [...new Set(a)];

export const zoneInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  states: z
    .array(z.string().trim().refine(isStateCode, "Unknown state code"))
    .max(40)
    .default([])
    .transform(uniq),
  pincodePrefixes: z
    .array(z.string().trim().regex(/^[1-9]\d{0,4}$/, "Pincode prefixes are 1–5 digits and can't start with 0"))
    .max(1000)
    .default([])
    .transform(uniq),
  pincodes: z
    .array(z.string().trim().regex(PINCODE_RE, "Pincodes are 6 digits and can't start with 0"))
    .max(10_000)
    .default([])
    .transform(uniq),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(100_000).default(0),
});
export type ZoneInput = z.input<typeof zoneInputSchema>;

const slabSchema = z.object({ upToGrams: z.number().int().min(1).max(1_000_000), amount: money });

export const rateInputSchema = z
  .object({
    zoneId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    type: z.enum(RATE_TYPES).default("flat"),
    amount: money.default(0),
    freeAbove: money.nullable().default(null),
    weightSlabs: z.array(slabSchema).max(50).default([]),
    etaMinDays: z.number().int().min(0).max(90).default(2),
    etaMaxDays: z.number().int().min(0).max(90).default(7),
    codAllowed: z.boolean().default(true),
    codFee: money.default(0),
    active: z.boolean().default(true),
    sort: z.number().int().min(0).max(100_000).default(0),
  })
  .superRefine((r, ctx) => {
    if (r.type === "weight" && r.weightSlabs.length === 0)
      ctx.addIssue({ code: "custom", path: ["weightSlabs"], message: "Add at least one weight slab" });
    if (new Set(r.weightSlabs.map((s) => s.upToGrams)).size !== r.weightSlabs.length)
      ctx.addIssue({ code: "custom", path: ["weightSlabs"], message: "Weight slabs must have different limits" });
    if (r.type === "free_above" && r.freeAbove === null)
      ctx.addIssue({ code: "custom", path: ["freeAbove"], message: "Set the order amount above which shipping is free" });
    if (r.etaMaxDays < r.etaMinDays)
      ctx.addIssue({ code: "custom", path: ["etaMaxDays"], message: "Maximum days can't be less than minimum days" });
  })
  .transform((r) => ({ ...r, weightSlabs: [...r.weightSlabs].sort((a, b) => a.upToGrams - b.upToGrams) }));
export type RateInput = z.input<typeof rateInputSchema>;

export const quoteInputSchema = z.object({
  pincode: z.union([z.string(), z.number()]).transform(String),
  stateCode: z.string().trim().nullish(),
  weightGrams: z.coerce.number().min(0).max(1_000_000).default(0),
  subtotal: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  cod: z.boolean().default(false),
});
export type QuoteRequest = z.input<typeof quoteInputSchema>;

export const packageSchema = z.object({
  lengthCm: z.number().min(0.5).max(300),
  breadthCm: z.number().min(0.5).max(300),
  heightCm: z.number().min(0.5).max(300),
  weightGrams: z.number().int().min(1).max(100_000),
});

export const accountInputSchema = z.object({
  /** Shiprocket API user email (Settings → API → Configure in Shiprocket). */
  email: z.string().trim().email().max(200),
  /** Required for a new account or a new email; omit to keep the stored one. */
  password: z.string().min(1).max(200).optional(),
  /** Pickup location nickname exactly as set up in Shiprocket. */
  pickupLocation: z.string().trim().min(1).max(80).default("Primary"),
  enabled: z.boolean(),
  defaultPackage: packageSchema.nullable().optional(),
  /** The shop's own webhook token (the `x-api-key` Shiprocket sends); generated when absent. */
  webhookToken: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{16,128}$/, "Use 16–128 letters, digits, dot, dash or underscore")
    .optional(),
  rotateWebhookToken: z.boolean().optional(),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export const shipmentInputSchema = z.object({
  provider: z.enum(CARRIER_PROVIDERS),
  courier: z.string().trim().max(80).nullish(),
  awb: z.string().trim().max(80).nullish(),
  trackingUrl: z.string().trim().url().max(500).nullish(),
  package: packageSchema.nullish(),
});
export type ShipmentInput = z.input<typeof shipmentInputSchema>;

export const shipmentListQuerySchema = z.object({
  orderId: z.string().uuid().optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ShipmentListQuery = z.input<typeof shipmentListQuerySchema>;

// ------------------------------------------------------------------ views

export type ZoneView = Omit<DeliveryZoneRow, "tenantId">;
export type RateView = Omit<DeliveryRateRow, "tenantId">;
export type ZoneWithRates = ZoneView & { rates: RateView[] };

export interface ZoneList {
  items: ZoneWithRates[];
  total: number;
  /** True while the shop has no active zone: every serviceable pincode gets the implicit All India ₹0 rate. */
  implicitDefault: boolean;
}

export interface AccountView {
  configured: boolean;
  provider: "shiprocket";
  /** Masked ("ab***@shop.in"); the password and webhook token are never returned. */
  email: string | null;
  pickupLocation: string | null;
  enabled: boolean;
  defaultPackage: PackageDims | null;
  webhookTokenSet: boolean;
  /** Paste into Shiprocket → Settings → API → Webhooks, with the token as the `x-api-key` header value. */
  webhookUrl: string;
  webhookHeader: typeof WEBHOOK_TOKEN_HEADER;
  /** Only in the PUT response that generated it: show once, the shop copies it into Shiprocket. */
  newWebhookToken?: string;
}

export interface ShipmentView {
  id: string;
  orderId: string;
  provider: CarrierProvider;
  providerOrderId: string | null;
  providerShipmentId: string | null;
  awb: string | null;
  courier: string | null;
  status: ShipmentStatus;
  statusLabel: string;
  trackingUrl: string | null;
  labelUrl: string | null;
  events: ShipmentEvent[];
  cost: number | null;
  trackedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PincodeView {
  pincode: string;
  city: string;
  district: string;
  state: string;
  stateCode: string | null;
  approximate: boolean;
}

export interface WebhookResult {
  ok: true;
  result: "processed" | "duplicate" | "ignored";
}

export interface TrackRunResult {
  checked: number;
  updated: number;
  failed: number;
  skipped: number;
}

interface Credentials {
  email: string;
  password: string;
  webhookToken: string;
}

const stripTenant = <T extends { tenantId: string }>(row: T): Omit<T, "tenantId"> => {
  const { tenantId: _t, ...rest } = row;
  return rest;
};

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

export const deliveryWebhookUrl = (baseUrl: string, tenantId: string) =>
  `${baseUrl.replace(/\/+$/, "")}/v1/delivery/webhooks/courier/${tenantId}`;

// ------------------------------------------------------------------ service

export class DeliveryService {
  private readonly db: Db;
  private readonly config: DeliveryConfig;
  private readonly orders: OrderFulfillmentPort;
  private readonly featureGate?: FeatureGatePort;
  private readonly log: LoggerPort;
  private readonly fetchFn?: typeof fetch;
  private readonly now: () => Date;
  private readonly pincodeDriver: PincodeDriver;
  private readonly tokenCache: TokenCache;
  private readonly box: SecretBox;
  private readonly drivers: Partial<Record<CarrierProvider, CarrierDriver>>;

  constructor(deps: DeliveryDeps) {
    if (!deps.config.encryptionKey) throw new Error("delivery: encryptionKey is required");
    this.db = deps.db;
    this.config = deps.config;
    this.orders = deps.orders;
    this.featureGate = deps.featureGate;
    this.log = deps.log ?? noopLogger;
    this.fetchFn = deps.fetch;
    this.now = deps.now ?? (() => new Date());
    this.pincodeDriver =
      deps.pincodeDriver ?? new PostalPincodeDriver({ fetch: deps.fetch, baseUrl: deps.config.pincodeApiUrl, timeoutMs: 5_000 });
    this.tokenCache = deps.tokenCache ?? memoryTokenCache();
    this.box = createSecretBox(deps.config.encryptionKey);
    this.drivers = deps.drivers ?? {};
  }

  get allowMock() {
    return this.config.allowMock;
  }

  // ================================================================ zones + rates

  async listZones(tenantId: string): Promise<ZoneList> {
    const zones = await this.db
      .select()
      .from(deliveryZones)
      .where(eq(deliveryZones.tenantId, tenantId))
      .orderBy(asc(deliveryZones.sort), asc(deliveryZones.name));
    const rates = await this.db
      .select()
      .from(deliveryRates)
      .where(eq(deliveryRates.tenantId, tenantId))
      .orderBy(asc(deliveryRates.sort), asc(deliveryRates.name));
    const items = zones.map((z) => ({ ...stripTenant(z), rates: rates.filter((r) => r.zoneId === z.id).map(stripTenant) }));
    return { items, total: items.length, implicitDefault: !zones.some((z) => z.active) };
  }

  async createZone(tenantId: string, input: ZoneInput): Promise<ZoneView> {
    const data = zoneInputSchema.parse(input);
    const [row] = await this.db.insert(deliveryZones).values({ tenantId, ...data }).returning();
    return stripTenant(row!);
  }

  async updateZone(tenantId: string, id: string, input: Partial<ZoneInput>): Promise<ZoneView> {
    const existing = await this.zoneRow(tenantId, id);
    const data = zoneInputSchema.parse({ ...zoneToInput(existing), ...stripUndefined(input) });
    const [row] = await this.db
      .update(deliveryZones)
      .set(data)
      .where(and(eq(deliveryZones.tenantId, tenantId), eq(deliveryZones.id, id)))
      .returning();
    if (!row) throw notFound("Zone");
    return stripTenant(row);
  }

  /** Deletes the zone and its rates. */
  async deleteZone(tenantId: string, id: string): Promise<void> {
    await this.db.delete(deliveryRates).where(and(eq(deliveryRates.tenantId, tenantId), eq(deliveryRates.zoneId, id)));
    const rows = await this.db
      .delete(deliveryZones)
      .where(and(eq(deliveryZones.tenantId, tenantId), eq(deliveryZones.id, id)))
      .returning({ id: deliveryZones.id });
    if (rows.length === 0) throw notFound("Zone");
  }

  async listRates(tenantId: string, zoneId?: string): Promise<{ items: RateView[]; total: number }> {
    const where = zoneId
      ? and(eq(deliveryRates.tenantId, tenantId), eq(deliveryRates.zoneId, zoneId))
      : eq(deliveryRates.tenantId, tenantId);
    const rows = await this.db.select().from(deliveryRates).where(where).orderBy(asc(deliveryRates.sort), asc(deliveryRates.name));
    return { items: rows.map(stripTenant), total: rows.length };
  }

  async createRate(tenantId: string, input: RateInput): Promise<RateView> {
    const data = rateInputSchema.parse(input);
    await this.zoneRow(tenantId, data.zoneId);
    const [row] = await this.db.insert(deliveryRates).values({ tenantId, ...data }).returning();
    return stripTenant(row!);
  }

  async updateRate(tenantId: string, id: string, input: Partial<RateInput>): Promise<RateView> {
    const [existing] = await this.db
      .select()
      .from(deliveryRates)
      .where(and(eq(deliveryRates.tenantId, tenantId), eq(deliveryRates.id, id)))
      .limit(1);
    if (!existing) throw notFound("Rate");
    const data = rateInputSchema.parse({ ...rateToInput(existing), ...stripUndefined(input) });
    if (data.zoneId !== existing.zoneId) await this.zoneRow(tenantId, data.zoneId);
    const [row] = await this.db
      .update(deliveryRates)
      .set(data)
      .where(and(eq(deliveryRates.tenantId, tenantId), eq(deliveryRates.id, id)))
      .returning();
    if (!row) throw notFound("Rate");
    return stripTenant(row);
  }

  async deleteRate(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(deliveryRates)
      .where(and(eq(deliveryRates.tenantId, tenantId), eq(deliveryRates.id, id)))
      .returning({ id: deliveryRates.id });
    if (rows.length === 0) throw notFound("Rate");
  }

  private async zoneRow(tenantId: string, id: string): Promise<DeliveryZoneRow> {
    const [row] = await this.db
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.tenantId, tenantId), eq(deliveryZones.id, id)))
      .limit(1);
    if (!row) throw notFound("Zone");
    return row;
  }

  // ================================================================ quote

  /**
   * Delivery options for a pincode (storefront `DeliveryPort.quote`, public and staff test quote). Never throws for a
   * bad pincode: it is simply not serviceable. Without `stateCode` the state comes from the pincode cache or the
   * offline prefix table (no network call on this path). A shop with no active zones gets the implicit All India ₹0 rate.
   */
  async quote(tenantId: string, raw: QuoteRequest): Promise<Quote> {
    const input = quoteInputSchema.parse(raw);
    const pincode = normalizePincode(input.pincode);
    if (!pincode) return { serviceable: false, options: [], zone: null };
    const zones = await this.db
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.tenantId, tenantId), eq(deliveryZones.active, true)));
    const base = { pincode, weightGrams: input.weightGrams, subtotal: input.subtotal, cod: input.cod };
    if (zones.length === 0) return quoteFromRules([], [], base);

    let stateCode = input.stateCode && isStateCode(input.stateCode) ? input.stateCode : null;
    if (!stateCode && needsState(zones, pincode)) stateCode = await this.stateFor(pincode);
    const match = matchZone(zones, pincode, stateCode);
    if (!match) return { serviceable: false, options: [], zone: null };
    const rates = await this.db
      .select()
      .from(deliveryRates)
      .where(and(eq(deliveryRates.tenantId, tenantId), eq(deliveryRates.zoneId, match.zone.id), eq(deliveryRates.active, true)));
    return quoteFromRules(zones, rates, { ...base, stateCode });
  }

  /** State code for zone matching: cached API answer when we have one, else the prefix table. */
  private async stateFor(pincode: string): Promise<string | null> {
    try {
      const [row] = await this.db.select().from(pincodeCache).where(eq(pincodeCache.pincode, pincode)).limit(1);
      if (row?.found && row.stateCode) return row.stateCode;
    } catch (err) {
      this.log.warn({ err, pincode }, "delivery: pincode cache read failed");
    }
    return stateCodeFromPincode(pincode);
  }

  // ================================================================ pincode lookup

  /**
   * City / district / state for a pincode: cache (30 days; misses 1 day) → api.postalpincode.in (5 s) → when the API
   * is down, a stale cache entry or the offline prefix table (`approximate: true`). 400 for a malformed pincode,
   * 404 when it doesn't exist.
   */
  async lookupPincode(raw: string): Promise<PincodeView> {
    const pincode = normalizePincode(raw);
    if (!pincode) throw badRequest("Enter a valid 6-digit pincode");
    const now = this.now();
    let cached: typeof pincodeCache.$inferSelect | undefined;
    try {
      [cached] = await this.db.select().from(pincodeCache).where(eq(pincodeCache.pincode, pincode)).limit(1);
    } catch (err) {
      this.log.warn({ err, pincode }, "delivery: pincode cache read failed");
    }
    if (cached) {
      const ttl = (cached.found ? PINCODE_CACHE_DAYS : PINCODE_MISS_CACHE_DAYS) * DAY_MS;
      if (now.getTime() - cached.fetchedAt.getTime() < ttl) {
        if (!cached.found) throw notFound("Pincode");
        return cachedView(cached);
      }
    }

    let info: PincodeInfo | null;
    try {
      info = await this.pincodeDriver.lookup(pincode);
    } catch (err) {
      this.log.warn({ err, pincode }, "delivery: pincode API unavailable, using fallback");
      if (cached?.found) return cachedView(cached);
      const fallback = fallbackPincodeInfo(pincode);
      if (fallback) return fallback;
      throw notFound("Pincode");
    }

    const values = info
      ? { found: true, city: info.city, district: info.district, state: info.state, stateCode: info.stateCode, fetchedAt: now }
      : { found: false, city: "", district: "", state: "", stateCode: null, fetchedAt: now };
    try {
      await this.db
        .insert(pincodeCache)
        .values({ pincode, ...values })
        .onConflictDoUpdate({ target: pincodeCache.pincode, set: values });
    } catch (err) {
      this.log.warn({ err, pincode }, "delivery: pincode cache write failed");
    }
    if (!info) throw notFound("Pincode");
    return info;
  }

  // ================================================================ carrier account

  async getAccount(tenantId: string): Promise<AccountView> {
    const row = await this.accountRow(tenantId);
    return this.accountView(tenantId, row, row ? this.credentials(row) : null);
  }

  async putAccount(tenantId: string, input: AccountInput): Promise<AccountView> {
    const data = accountInputSchema.parse(input);
    const existing = await this.accountRow(tenantId);
    const prev = existing ? this.credentials(existing) : null;
    const emailChanged = !prev || prev.email.toLowerCase() !== data.email.toLowerCase();
    if (!data.password && emailChanged) throw badRequest("Enter the Shiprocket API user's password");
    const password = data.password ?? prev!.password;

    if (data.password || emailChanged) {
      let ok: boolean;
      try {
        ok = await this.shiprocketClient(data.email, password).validateCredentials();
      } catch (err) {
        this.log.warn({ err, tenantId }, "delivery: could not validate Shiprocket credentials");
        throw new AppError(502, "carrier_error", "Could not reach Shiprocket to check the login, try again");
      }
      if (!ok) throw new AppError(400, "invalid_credentials", "Shiprocket rejected this email / password");
    }

    let newWebhookToken: string | undefined;
    let webhookToken = data.webhookToken ?? prev?.webhookToken ?? "";
    if (!data.webhookToken && (data.rotateWebhookToken || !webhookToken)) {
      webhookToken = randomToken(24);
      newWebhookToken = webhookToken;
    }
    const creds: Credentials = { email: data.email, password, webhookToken };
    const values = {
      provider: "shiprocket" as const,
      credentialsEnc: this.box.encrypt(JSON.stringify(creds)),
      pickupLocation: data.pickupLocation,
      enabled: data.enabled,
      defaultPackage: data.defaultPackage === undefined ? (existing?.defaultPackage ?? null) : data.defaultPackage,
    };
    const [row] = await this.db
      .insert(deliveryAccounts)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: deliveryAccounts.tenantId, set: { ...values, updatedAt: this.now() } })
      .returning();
    this.log.info({ tenantId, enabled: data.enabled }, "delivery: Shiprocket account saved");
    const view = this.accountView(tenantId, row!, creds);
    return newWebhookToken ? { ...view, newWebhookToken } : view;
  }

  async deleteAccount(tenantId: string): Promise<void> {
    await this.db.delete(deliveryAccounts).where(eq(deliveryAccounts.tenantId, tenantId));
    this.log.info({ tenantId }, "delivery: Shiprocket account removed");
  }

  private async accountRow(tenantId: string): Promise<DeliveryAccountRow | null> {
    const [row] = await this.db.select().from(deliveryAccounts).where(eq(deliveryAccounts.tenantId, tenantId)).limit(1);
    return row ?? null;
  }

  private credentials(row: DeliveryAccountRow): Credentials | null {
    try {
      const c = JSON.parse(this.box.decrypt(row.credentialsEnc)) as Partial<Credentials>;
      return { email: c.email ?? "", password: c.password ?? "", webhookToken: c.webhookToken ?? "" };
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId }, "delivery: cannot decrypt carrier credentials");
      return null;
    }
  }

  private accountView(tenantId: string, row: DeliveryAccountRow | null, creds: Credentials | null): AccountView {
    return {
      configured: Boolean(row),
      provider: "shiprocket",
      email: creds?.email ? maskEmail(creds.email) : null,
      pickupLocation: row?.pickupLocation ?? null,
      enabled: row?.enabled ?? false,
      defaultPackage: row?.defaultPackage ?? null,
      webhookTokenSet: Boolean(creds?.webhookToken),
      webhookUrl: deliveryWebhookUrl(this.config.webhookBaseUrl, tenantId),
      webhookHeader: WEBHOOK_TOKEN_HEADER,
    };
  }

  private shiprocketClient(email: string, password: string) {
    return new ShiprocketClient({
      email,
      password,
      fetch: this.fetchFn,
      baseUrl: this.config.shiprocketBaseUrl,
      tokenCache: this.tokenCache,
      now: this.now,
    });
  }

  // ================================================================ shipments

  async createShipment(tenantId: string, orderId: string, input: ShipmentInput): Promise<ShipmentView> {
    const data = shipmentInputSchema.parse(input);
    let account: DeliveryAccountRow | null = null;
    if (data.provider === "mock" && !this.config.allowMock) throw badRequest("The mock carrier is only available in development");
    if (data.provider === "shiprocket") {
      await this.assertFeature(tenantId, CARRIERS_FEATURE);
      account = await this.accountRow(tenantId);
      if (!account?.enabled) throw badRequest("Connect and enable your Shiprocket account first");
    }

    const order = await this.orders.getOrder(tenantId, orderId);
    if (!order) throw notFound("Order");
    if (["cancelled", "delivered", "returned"].includes(order.status)) throw conflict(`This order is ${order.status}`);
    if (data.provider === "shiprocket" && !order.shippingAddress) throw badRequest("The order has no shipping address");

    const [open] = await this.db
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(eq(shipments.tenantId, tenantId), eq(shipments.orderId, orderId), notInArray(shipments.status, ["cancelled", "rto"])))
      .limit(1);
    if (open) throw conflict("This order already has a shipment; cancel it before creating another");

    const pkg = data.package ?? account?.defaultPackage ?? DEFAULT_PACKAGE;
    const driver = this.driverFor(data.provider, account);
    const now = this.now();
    let created;
    try {
      created = await driver.createShipment({
        order,
        package: pkg,
        courier: data.courier ?? null,
        awb: data.awb ?? null,
        trackingUrl: data.trackingUrl ?? null,
        now,
      });
    } catch (err) {
      throw this.carrierFailure(err, tenantId);
    }

    const [row] = await this.db
      .insert(shipments)
      .values({ tenantId, orderId, provider: data.provider, ...created })
      .returning();
    const shipment = row!;
    this.log.info({ tenantId, orderId, shipmentId: shipment.id, provider: data.provider, awb: shipment.awb }, "delivery: shipment created");

    await this.safely(tenantId, orderId, "setFulfillment", () =>
      this.orders.setFulfillment(tenantId, orderId, {
        carrier: shipment.courier,
        trackingNumber: shipment.awb,
        trackingUrl: shipment.trackingUrl,
        shipmentId: shipment.id,
      }),
    );
    await this.syncOrder(tenantId, orderId, null, shipment.status);
    return shipmentView(shipment);
  }

  async listShipments(tenantId: string, query: ShipmentListQuery = {}): Promise<{ items: ShipmentView[]; total: number }> {
    const q = shipmentListQuerySchema.parse(query);
    const conds: SQL[] = [eq(shipments.tenantId, tenantId)];
    if (q.orderId) conds.push(eq(shipments.orderId, q.orderId));
    if (q.status) conds.push(eq(shipments.status, q.status));
    const where = and(...conds);
    const rows = await this.db.select().from(shipments).where(where).orderBy(desc(shipments.createdAt)).limit(q.limit).offset(q.offset);
    const [totalRow] = await this.db.select({ n: count() }).from(shipments).where(where);
    return { items: rows.map(shipmentView), total: Number(totalRow?.n ?? rows.length) };
  }

  async getShipment(tenantId: string, id: string): Promise<ShipmentView> {
    return shipmentView(await this.shipmentRow(tenantId, id));
  }

  /** Cancels with the carrier (Shiprocket refuses once picked up), marks it cancelled and clears the order's tracking. */
  async cancelShipment(tenantId: string, id: string): Promise<ShipmentView> {
    const row = await this.shipmentRow(tenantId, id);
    if (isTerminal(row.status)) throw conflict(`This shipment is already ${STATUS_LABELS[row.status].toLowerCase()}`);
    const account = row.provider === "shiprocket" ? await this.accountRow(tenantId) : null;
    try {
      await this.driverFor(row.provider, account).cancel(refOf(row));
    } catch (err) {
      throw this.carrierFailure(err, tenantId);
    }
    const { row: updated } = await this.applyUpdate(row, {
      status: "cancelled",
      events: [{ at: this.now().toISOString(), status: "cancelled", label: "Shipment cancelled", source: "staff" }],
    });
    const cleared: FulfillmentInfo = { carrier: null, trackingNumber: null, trackingUrl: null, shipmentId: null };
    await this.safely(tenantId, row.orderId, "setFulfillment", () => this.orders.setFulfillment(tenantId, row.orderId, cleared));
    return shipmentView(updated);
  }

  /** Label URL to redirect to; Shiprocket labels are generated on first request when creation couldn't. */
  async labelUrl(tenantId: string, id: string): Promise<string> {
    const row = await this.shipmentRow(tenantId, id);
    if (row.labelUrl) return row.labelUrl;
    if (row.provider !== "shiprocket") throw notFound("Label");
    await this.assertFeature(tenantId, CARRIERS_FEATURE);
    let url: string | null;
    try {
      url = await this.driverFor("shiprocket", await this.accountRow(tenantId)).label(refOf(row));
    } catch (err) {
      throw this.carrierFailure(err, tenantId);
    }
    if (!url) throw notFound("Label");
    await this.db
      .update(shipments)
      .set({ labelUrl: url })
      .where(and(eq(shipments.tenantId, tenantId), eq(shipments.id, id)));
    return url;
  }

  /** Development: moves a mock shipment one step (created → pickup_scheduled → in_transit → out_for_delivery → delivered). */
  async mockAdvance(tenantId: string, id: string): Promise<ShipmentView> {
    if (!this.config.allowMock) throw notFound("Route");
    const row = await this.shipmentRow(tenantId, id);
    if (row.provider !== "mock") throw badRequest("Only mock shipments can be advanced");
    const next = nextMockStatus(row.status);
    if (!next) throw conflict(`This shipment is already ${STATUS_LABELS[row.status].toLowerCase()}`);
    const { row: updated } = await this.applyUpdate(row, {
      status: next,
      events: [{ at: this.now().toISOString(), status: next, label: STATUS_LABELS[next], source: "mock" }],
    });
    return shipmentView(updated);
  }

  /** Polls the carrier now (staff "refresh tracking"). */
  async refreshShipment(tenantId: string, id: string): Promise<ShipmentView> {
    const row = await this.shipmentRow(tenantId, id);
    if (row.provider !== "shiprocket") return shipmentView(row);
    await this.assertFeature(tenantId, CARRIERS_FEATURE);
    let result: TrackResult;
    try {
      result = await this.driverFor("shiprocket", await this.accountRow(tenantId)).track(refOf(row), this.now());
    } catch (err) {
      throw this.carrierFailure(err, tenantId);
    }
    const { row: updated } = await this.applyUpdate(row, result, { tracked: true });
    return shipmentView(updated);
  }

  private async shipmentRow(tenantId: string, id: string): Promise<ShipmentRow> {
    const [row] = await this.db
      .select()
      .from(shipments)
      .where(and(eq(shipments.tenantId, tenantId), eq(shipments.id, id)))
      .limit(1);
    if (!row) throw notFound("Shipment");
    return row;
  }

  // ================================================================ webhook + job

  /**
   * Shiprocket tracking webhook. 401 unless `x-api-key` equals the shop's webhook token. Unknown AWBs, test pings and
   * shops with carriers switched off are acknowledged as "ignored"; replays change nothing ("duplicate").
   */
  async handleShiprocketWebhook(tenantId: string, token: string | undefined, body: unknown): Promise<WebhookResult> {
    const account = await this.accountRow(tenantId);
    const creds = account ? this.credentials(account) : null;
    if (!creds?.webhookToken || !token || !safeEqual(token, creds.webhookToken)) throw unauthorized("Invalid webhook token");
    if (!(await this.featureOn(tenantId, CARRIERS_FEATURE))) return { ok: true, result: "ignored" };
    const parsed = parseShiprocketWebhook(body, this.now());
    if (!parsed) return { ok: true, result: "ignored" };
    const [row] = await this.db
      .select()
      .from(shipments)
      .where(and(eq(shipments.tenantId, tenantId), eq(shipments.provider, "shiprocket"), eq(shipments.awb, parsed.awb)))
      .orderBy(desc(shipments.createdAt))
      .limit(1);
    if (!row) {
      this.log.info({ tenantId, awb: parsed.awb }, "delivery: webhook for an unknown AWB ignored");
      return { ok: true, result: "ignored" };
    }
    const { changed } = await this.applyUpdate(row, { status: parsed.status, events: parsed.events, courier: parsed.courier });
    return { ok: true, result: changed ? "processed" : "duplicate" };
  }

  /**
   * Job `delivery.track` (every 2 h): polls Shiprocket for open shipments (oldest-polled first, up to `limit`, created in
   * the last 90 days) of shops whose `delivery.carriers` is on and whose account is enabled.
   */
  async trackOpenShipments(opts: { limit?: number } = {}): Promise<TrackRunResult> {
    const now = this.now();
    const rows = await this.db
      .select()
      .from(shipments)
      .where(
        and(
          eq(shipments.provider, "shiprocket"),
          inArray(shipments.status, [...OPEN_STATUSES]),
          isNotNull(shipments.awb),
          gt(shipments.createdAt, new Date(now.getTime() - TRACK_WINDOW_DAYS * DAY_MS)),
        ),
      )
      .orderBy(sql`${shipments.trackedAt} asc nulls first`)
      .limit(opts.limit ?? 200);

    const result: TrackRunResult = { checked: 0, updated: 0, failed: 0, skipped: 0 };
    const byTenant = new Map<string, ShipmentRow[]>();
    for (const r of rows) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r]);

    for (const [tenantId, list] of byTenant) {
      let driver: CarrierDriver;
      try {
        if (!(await this.featureOn(tenantId, CARRIERS_FEATURE))) {
          result.skipped += list.length;
          continue;
        }
        const account = await this.accountRow(tenantId);
        if (!account?.enabled) {
          result.skipped += list.length;
          continue;
        }
        driver = this.driverFor("shiprocket", account);
      } catch (err) {
        this.log.warn({ err, tenantId }, "delivery: tracking skipped for shop");
        result.skipped += list.length;
        continue;
      }
      for (const row of list) {
        result.checked++;
        try {
          const track = await driver.track(refOf(row), this.now());
          const { changed } = await this.applyUpdate(row, track, { tracked: true });
          if (changed) result.updated++;
        } catch (err) {
          result.failed++;
          this.log.warn({ err, tenantId, shipmentId: row.id }, "delivery: tracking failed");
          await this.db
            .update(shipments)
            .set({ trackedAt: this.now() })
            .where(and(eq(shipments.tenantId, tenantId), eq(shipments.id, row.id)))
            .catch(() => undefined);
        }
      }
    }
    if (result.checked || result.failed) this.log.info(result, "delivery: tracking run");
    return result;
  }

  // ================================================================ internals

  /**
   * Merges carrier events, moves the status forward when allowed (see `canTransition`), saves, and tells orders about
   * shipped / delivered. `changed` = the status or the event list changed.
   */
  private async applyUpdate(
    row: ShipmentRow,
    update: TrackResult,
    opts: { tracked?: boolean } = {},
  ): Promise<{ row: ShipmentRow; changed: boolean }> {
    const nextStatus = update.status && canTransition(row.status, update.status) ? update.status : row.status;
    const statusChanged = nextStatus !== row.status;
    let incoming = update.events;
    if (statusChanged && !incoming.some((e) => e.status === nextStatus)) {
      incoming = [...incoming, { at: this.now().toISOString(), status: nextStatus, label: STATUS_LABELS[nextStatus], source: "carrier" }];
    }
    const before = row.events ?? [];
    const events = mergeEvents(before, incoming);
    const eventsChanged = events.length !== before.length || events.some((e, i) => e !== before[i]);
    const set: Partial<typeof shipments.$inferInsert> = {};
    if (statusChanged) set.status = nextStatus;
    if (eventsChanged) set.events = events;
    if (update.courier && !row.courier) set.courier = update.courier;
    if (update.trackingUrl && !row.trackingUrl) set.trackingUrl = update.trackingUrl;
    if (opts.tracked) set.trackedAt = this.now();
    if (Object.keys(set).length === 0) return { row, changed: false };

    const [saved] = await this.db
      .update(shipments)
      .set(set)
      .where(and(eq(shipments.tenantId, row.tenantId), eq(shipments.id, row.id)))
      .returning();
    const updated = saved ?? { ...row, ...set };
    if (statusChanged) {
      this.log.info({ tenantId: row.tenantId, shipmentId: row.id, from: row.status, to: nextStatus }, "delivery: shipment status");
      await this.syncOrder(row.tenantId, row.orderId, row.status, nextStatus);
    }
    return { row: updated as ShipmentRow, changed: statusChanged || eventsChanged };
  }

  /** shipped when the parcel leaves (in transit or later, incl. delivered); delivered on delivery. Port is idempotent. */
  private async syncOrder(tenantId: string, orderId: string, from: ShipmentStatus | null, to: ShipmentStatus) {
    if (isShippedStatus(to) && !(from && isShippedStatus(from))) {
      await this.safely(tenantId, orderId, "markShipped", () => this.orders.markShipped(tenantId, orderId));
    }
    if (to === "delivered") {
      await this.safely(tenantId, orderId, "markDelivered", () => this.orders.markDelivered(tenantId, orderId));
    }
  }

  private async safely(tenantId: string, orderId: string, what: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      this.log.warn({ err, tenantId, orderId }, `delivery: orders.${what} failed`);
    }
  }

  private driverFor(provider: CarrierProvider, account: DeliveryAccountRow | null): CarrierDriver {
    const fixed = this.drivers[provider];
    if (fixed) return fixed;
    if (provider === "manual") return new ManualDriver();
    if (provider === "mock") return new MockDriver();
    const creds = account ? this.credentials(account) : null;
    if (!account || !creds?.email) throw badRequest("Connect your Shiprocket account first");
    return new ShiprocketDriver(this.shiprocketClient(creds.email, creds.password), account.pickupLocation, this.log);
  }

  private carrierFailure(err: unknown, tenantId: string): AppError {
    if (err instanceof AppError) return err;
    const e =
      err instanceof CarrierError
        ? err
        : err instanceof ShiprocketError
          ? new CarrierError("shiprocket", err.status, err.message)
          : null;
    if (!e) {
      this.log.error({ err, tenantId }, "delivery: carrier call failed");
      return new AppError(502, "carrier_error", "The courier service failed, try again");
    }
    this.log.warn({ err: e.message, status: e.status, provider: e.provider, tenantId }, "delivery: carrier error");
    if (e.status === 401 || e.status === 403)
      return new AppError(400, "carrier_auth", "Shiprocket rejected the saved login; update it in Delivery settings");
    if (e.status >= 400 && e.status < 500) return new AppError(400, "carrier_rejected", e.message, { provider: e.provider });
    return new AppError(502, "carrier_error", e.message, { provider: e.provider });
  }

  private async featureOn(tenantId: string, key: string): Promise<boolean> {
    return this.featureGate ? this.featureGate.isEnabled(tenantId, key) : true;
  }

  private async assertFeature(tenantId: string, key: string) {
    if (!(await this.featureOn(tenantId, key))) throw featureDisabled(key, "shop");
  }
}

// ------------------------------------------------------------------ helpers

const stripUndefined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

const zoneToInput = (z: DeliveryZoneRow) => ({
  name: z.name,
  states: z.states,
  pincodePrefixes: z.pincodePrefixes,
  pincodes: z.pincodes,
  active: z.active,
  sort: z.sort,
});

const rateToInput = (r: DeliveryRateRow) => ({
  zoneId: r.zoneId,
  name: r.name,
  type: r.type,
  amount: r.amount,
  freeAbove: r.freeAbove,
  weightSlabs: r.weightSlabs,
  etaMinDays: r.etaMinDays,
  etaMaxDays: r.etaMaxDays,
  codAllowed: r.codAllowed,
  codFee: r.codFee,
  active: r.active,
  sort: r.sort,
});

const refOf = (r: ShipmentRow): ShipmentRef => ({
  providerOrderId: r.providerOrderId,
  providerShipmentId: r.providerShipmentId,
  awb: r.awb,
  status: r.status,
});

const cachedView = (c: typeof pincodeCache.$inferSelect): PincodeView => ({
  pincode: c.pincode,
  city: c.city,
  district: c.district,
  state: c.state,
  stateCode: c.stateCode,
  approximate: false,
});

export function shipmentView(r: ShipmentRow): ShipmentView {
  return {
    id: r.id,
    orderId: r.orderId,
    provider: r.provider,
    providerOrderId: r.providerOrderId,
    providerShipmentId: r.providerShipmentId,
    awb: r.awb,
    courier: r.courier,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status] ?? r.status,
    trackingUrl: r.trackingUrl,
    labelUrl: r.labelUrl,
    events: r.events ?? [],
    cost: r.cost,
    trackedAt: r.trackedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** The implicit zone's name, for UIs that explain the default. */
export const IMPLICIT_ZONE_NAME = DEFAULT_ZONE.name;
