import { createHash, randomBytes, randomInt } from "node:crypto";
import { AppError, notFound, type AuditEvent } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuditPort, LoggerPort, PosCatalogPort, PosTenantsPort } from "./ports";
import { posDisplays, type DisplayRow, type DisplaySettings } from "./schema";
import { SlidingWindow, type Actor } from "./service";

/**
 * Customer-facing display (docs/counter-close-display-labels.md): a second screen or tablet that shows the bill being
 * rung up at one register. The screen has no account. A cashier makes a 6-digit pairing code for a register, the screen
 * trades it for a display token that can only read that register's feed (and is revoked from the counter), and the
 * counter pushes the bill state to `/display/state`; every screen of the register gets it over server-sent events.
 */

const CODE_TTL_MS = 10 * 60_000;
const PAIR_ATTEMPTS_PER_WINDOW = 10;
const PAIR_WINDOW_MS = 10 * 60_000;
/** A state older than this is not replayed to a newly opened screen (the counter is idle or gone). */
const STATE_KEEP_MS = 2 * 60 * 60_000;
const LAST_SEEN_EVERY_MS = 60_000;
export const DISPLAY_CHANNEL = "pos.display";
export const DISPLAY_TOKEN_HEADER = "x-display-token";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const regKey = (tenantId: string, register: string) => `${tenantId}:${register.trim().toLowerCase()}`;
const codeInvalid = () => new AppError(400, "pairing_code_invalid", "This pairing code is wrong or has expired");
const notPaired = () => new AppError(401, "display_not_paired", "This screen is not paired. Enter a new pairing code");

// ------------------------------------------------------------------ what the counter shows

const paise = z.number().int().min(-2_000_000_000).max(2_000_000_000);
const text = (max: number) => z.string().max(max);
/** The bill as the customer sees it. Prices in paise; no customer detail beyond a first name the cashier picked. */
export const displayStateSchema = z.object({
  phase: z.enum(["idle", "cart", "pay", "thanks"]),
  lines: z
    .array(z.object({ name: text(120), qty: z.number().min(0).max(1_000_000), unit: text(16), price: paise, total: paise }))
    .max(60),
  /** Lines that did not fit on the screen. */
  more: z.number().int().min(0).max(100_000).default(0),
  itemCount: z.number().min(0).max(1_000_000).default(0),
  total: paise.default(0),
  savings: paise.default(0),
  customerName: text(80).nullish(),
  /** A UPI deep link for the amount being paid by UPI; the screen draws the QR from it. */
  upi: z.object({ link: text(400).regex(/^upi:\/\/pay\?/), amount: paise }).nullish(),
  paid: z.object({ total: paise, change: paise }).nullish(),
  locale: z.enum(["en", "ta"]).default("en"),
  shop: z.object({ name: text(120), logoUrl: text(500).nullish() }).nullish(),
  slides: z.array(z.object({ name: text(120), image: text(500), price: paise.nullish(), mrp: paise.nullish() })).max(12).optional(),
  /** Counter's clock, to drop out-of-order updates. */
  at: z.number().int().min(0),
});
export type DisplayState = z.infer<typeof displayStateSchema>;

export const displayCreateBody = z.object({ name: z.string().trim().min(1).max(40), register: z.string().trim().min(1).max(40) });
export const displayPatchBody = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  settings: z.object({ language: z.enum(["auto", "en", "ta"]).optional(), slideSeconds: z.number().int().min(3).max(60).optional() }).optional(),
});
export const displayPairBody = z.object({ code: z.string().trim().min(4).max(12) });
export const displayStateBody = z.object({ register: z.string().trim().min(1).max(40), state: displayStateSchema });

// ------------------------------------------------------------------ ports and views

export interface DisplayPubSub {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => void | Promise<void>>;
}

export interface DisplayHostPorts {
  /** The shop's name, logo and colour for the idle screen. */
  brand?(tenantId: string): Promise<{ name: string | null; logoUrl: string | null; primary: string | null }>;
  /** The owner's idle messages (settings namespace `display`). */
  messages?(tenantId: string): Promise<{ welcomeEn: string; welcomeTa: string; offerEn: string; offerTa: string }>;
  /** Spreads one counter's state to every API instance (Redis); without it states reach this instance only. */
  pubsub?: DisplayPubSub;
}

export interface DisplayView {
  id: string;
  name: string;
  register: string;
  paired: boolean;
  pairingPending: boolean;
  pairedAt: Date | null;
  lastSeenAt: Date | null;
  settings: DisplaySettings;
}

export interface DisplayPairing {
  code: string;
  expiresAt: Date;
}

/** What a paired screen is: resolved from its token. */
export interface DisplayAuth {
  id: string;
  tenantId: string;
  register: string;
  name: string;
  settings: DisplaySettings;
}

const toView = (r: DisplayRow, now: Date): DisplayView => ({
  id: r.id,
  name: r.name,
  register: r.register,
  paired: !!r.tokenHash && !r.revokedAt,
  pairingPending: !!r.pairingCodeHash && !!r.pairingExpiresAt && r.pairingExpiresAt > now,
  pairedAt: r.pairedAt,
  lastSeenAt: r.lastSeenAt,
  settings: r.settings ?? {},
});

export interface DisplayDeps {
  db: Db;
  catalog: PosCatalogPort;
  tenants: PosTenantsPort;
  host?: DisplayHostPorts;
  audit?: AuditPort;
  log?: LoggerPort;
  now?: () => Date;
}

type Listener = (state: DisplayState) => void;

export class DisplayService {
  private readonly db: Db;
  private readonly now: () => Date;
  readonly pairLimiter: SlidingWindow;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly latest = new Map<string, { state: DisplayState; at: number }>();
  private readonly seen = new Map<string, number>();
  /** Open streams by display id, so revoking a screen closes them. */
  private readonly closers = new Map<string, Set<() => void>>();
  private unsubscribe: (() => void | Promise<void>) | null = null;
  private subscribing: Promise<void> | null = null;

  constructor(private readonly deps: DisplayDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
    this.pairLimiter = new SlidingWindow(PAIR_ATTEMPTS_PER_WINDOW, PAIR_WINDOW_MS, () => this.now().getTime());
  }

  private async record(actor: Actor, e: Omit<AuditEvent, "actorUserId" | "ip" | "userAgent">) {
    await this.deps.audit?.record({ ...e, actorUserId: actor.userId, ip: actor.ip, userAgent: actor.userAgent }).catch(() => undefined);
  }

  private async row(tenantId: string, id: string): Promise<DisplayRow> {
    const [row] = await this.db
      .select()
      .from(posDisplays)
      .where(and(eq(posDisplays.tenantId, tenantId), eq(posDisplays.id, id), isNull(posDisplays.revokedAt)))
      .limit(1);
    if (!row) throw notFound("Display");
    return row;
  }

  // ================================================================ managing screens (the counter)

  async list(tenantId: string, register?: string): Promise<{ items: DisplayView[] }> {
    const rows = await this.db
      .select()
      .from(posDisplays)
      .where(
        and(
          eq(posDisplays.tenantId, tenantId),
          isNull(posDisplays.revokedAt),
          register ? sql`lower(${posDisplays.register}) = lower(${register})` : undefined,
        ),
      )
      .orderBy(asc(posDisplays.createdAt), asc(posDisplays.id));
    const now = this.now();
    return { items: rows.map((r) => toView(r, now)) };
  }

  /** A fresh 6-digit code; retried when it collides with another pending code. */
  private async issueCode(tenantId: string, id: string): Promise<DisplayPairing> {
    const expiresAt = new Date(this.now().getTime() + CODE_TTL_MS);
    for (let i = 0; i < 6; i++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      try {
        await this.db
          .update(posDisplays)
          .set({ pairingCodeHash: sha256(`display:${code}`), pairingExpiresAt: expiresAt, updatedAt: this.now() })
          .where(and(eq(posDisplays.tenantId, tenantId), eq(posDisplays.id, id)));
        return { code, expiresAt };
      } catch (err) {
        if (!isUnique(err)) throw err;
      }
    }
    throw new AppError(503, "try_again", "Could not make a pairing code. Try again");
  }

  async create(tenantId: string, input: z.input<typeof displayCreateBody>, actor: Actor): Promise<{ display: DisplayView; pairing: DisplayPairing }> {
    const b = displayCreateBody.parse(input);
    const [row] = await this.db
      .insert(posDisplays)
      .values({ tenantId, name: b.name, register: b.register, createdBy: actor.userId })
      .returning();
    const pairing = await this.issueCode(tenantId, row!.id);
    await this.record(actor, { tenantId, action: "pos.display.create", entityType: "pos_display", entityId: row!.id, summary: `Customer display "${b.name}" added for ${b.register}` });
    return { display: toView((await this.row(tenantId, row!.id)), this.now()), pairing };
  }

  /** A new code for a screen (the old one stops working; a screen already paired keeps working until revoked). */
  async newCode(tenantId: string, id: string, actor: Actor): Promise<DisplayPairing> {
    await this.row(tenantId, id);
    const pairing = await this.issueCode(tenantId, id);
    await this.record(actor, { tenantId, action: "pos.display.code", entityType: "pos_display", entityId: id, summary: "New pairing code for a customer display" });
    return pairing;
  }

  async update(tenantId: string, id: string, input: z.input<typeof displayPatchBody>): Promise<DisplayView> {
    const b = displayPatchBody.parse(input);
    const cur = await this.row(tenantId, id);
    const [row] = await this.db
      .update(posDisplays)
      .set({ ...(b.name ? { name: b.name } : {}), ...(b.settings ? { settings: { ...cur.settings, ...b.settings } } : {}), updatedAt: this.now() })
      .where(and(eq(posDisplays.tenantId, tenantId), eq(posDisplays.id, id)))
      .returning();
    return toView(row!, this.now());
  }

  /** Revokes the screen: its token stops working and its open streams close. */
  async revoke(tenantId: string, id: string, actor: Actor): Promise<{ ok: true }> {
    const cur = await this.row(tenantId, id);
    await this.db
      .update(posDisplays)
      .set({ tokenHash: null, pairingCodeHash: null, pairingExpiresAt: null, revokedAt: this.now(), updatedAt: this.now() })
      .where(and(eq(posDisplays.tenantId, tenantId), eq(posDisplays.id, id)));
    for (const close of [...(this.closers.get(id) ?? [])]) close();
    this.closers.delete(id);
    await this.record(actor, { tenantId, action: "pos.display.revoke", entityType: "pos_display", entityId: id, summary: `Customer display "${cur.name}" removed` });
    return { ok: true };
  }

  // ================================================================ the screen

  /** Trades a pairing code for the screen's token (single use). Rate limited per address. */
  async pair(input: z.input<typeof displayPairBody>, actor: Actor): Promise<{ token: string; display: DisplayView; shop: { name: string | null; logoUrl: string | null } }> {
    const b = displayPairBody.parse(input);
    if (!this.pairLimiter.hit(actor.ip ?? "-")) throw new AppError(429, "too_many_attempts", "Too many wrong codes. Wait a few minutes and try again");
    const digits = b.code.replace(/\D/g, "");
    if (digits.length !== 6) throw codeInvalid();
    const hash = sha256(`display:${digits}`);
    const [row] = await this.db.select().from(posDisplays).where(and(eq(posDisplays.pairingCodeHash, hash), isNull(posDisplays.revokedAt))).limit(1);
    if (!row || !row.pairingExpiresAt || row.pairingExpiresAt <= this.now()) throw codeInvalid();
    const token = randomBytes(32).toString("base64url");
    const [claimed] = await this.db
      .update(posDisplays)
      .set({ tokenHash: sha256(`display-token:${token}`), pairedAt: this.now(), lastSeenAt: this.now(), pairingCodeHash: null, pairingExpiresAt: null, updatedAt: this.now() })
      .where(and(eq(posDisplays.id, row.id), eq(posDisplays.pairingCodeHash, hash)))
      .returning();
    if (!claimed) throw codeInvalid();
    await this.record(actor, { tenantId: row.tenantId, action: "pos.display.pair", entityType: "pos_display", entityId: row.id, summary: `Customer display "${row.name}" paired` });
    return { token, display: toView(claimed, this.now()), shop: await this.brand(row.tenantId) };
  }

  /** The screen behind a token; 401 when unknown or revoked. */
  async authenticate(token: string | undefined | null): Promise<DisplayAuth> {
    const t = token?.trim();
    if (!t || t.length > 200) throw notPaired();
    const [row] = await this.db.select().from(posDisplays).where(and(eq(posDisplays.tokenHash, sha256(`display-token:${t}`)), isNull(posDisplays.revokedAt))).limit(1);
    if (!row) throw notPaired();
    const now = this.now().getTime();
    if (now - (this.seen.get(row.id) ?? 0) > LAST_SEEN_EVERY_MS) {
      this.seen.set(row.id, now);
      void this.db.update(posDisplays).set({ lastSeenAt: this.now() }).where(eq(posDisplays.id, row.id)).catch(() => undefined);
    }
    return { id: row.id, tenantId: row.tenantId, register: row.register, name: row.name, settings: row.settings ?? {} };
  }

  private async brand(tenantId: string): Promise<{ name: string | null; logoUrl: string | null; primary: string | null }> {
    const [shop, brand] = await Promise.all([this.deps.tenants.shop(tenantId).catch(() => null), this.deps.host?.brand?.(tenantId).catch(() => null)]);
    return { name: brand?.name || shop?.name || null, logoUrl: brand?.logoUrl ?? null, primary: brand?.primary ?? null };
  }

  /** Idle screen content: the shop, its messages and a few items with photos (offers first). */
  async config(auth: DisplayAuth) {
    const [brand, messages, slides] = await Promise.all([
      this.brand(auth.tenantId),
      this.deps.host?.messages?.(auth.tenantId).catch(() => null) ?? null,
      this.slides(auth.tenantId),
    ]);
    return {
      display: { id: auth.id, name: auth.name, register: auth.register, settings: auth.settings },
      shop: brand,
      messages: messages ?? { welcomeEn: "", welcomeTa: "", offerEn: "", offerTa: "" },
      slides,
    };
  }

  /** Up to 10 sellable items with a photo, those marked down from their MRP first. */
  private async slides(tenantId: string): Promise<{ name: string; image: string; price: number; mrp: number | null }[]> {
    try {
      const rows = await this.deps.catalog.rows(tenantId, { since: null, afterId: null, limit: 300 });
      const items = rows.flatMap((r) => (r.item && r.item.image && r.item.active && r.item.stock?.status !== "out" ? [r.item] : []));
      const offer = (i: (typeof items)[number]) => (i.mrp && i.mrp > i.price ? 1 : 0);
      return items
        .sort((a, b) => offer(b) - offer(a))
        .slice(0, 10)
        .map((i) => ({ name: i.name, image: i.image!, price: i.price, mrp: i.mrp && i.mrp > i.price ? i.mrp : null }));
    } catch (err) {
      this.deps.log?.warn({ err, tenantId }, "display: slides failed");
      return [];
    }
  }

  // ================================================================ live feed

  private deliver(tenantId: string, register: string, state: DisplayState) {
    const key = regKey(tenantId, register);
    const cur = this.latest.get(key);
    if (cur && cur.state.at > state.at) return;
    this.latest.set(key, { state, at: this.now().getTime() });
    for (const l of [...(this.listeners.get(key) ?? [])]) l(state);
  }

  private ensureSubscribed(): Promise<void> {
    const pubsub = this.deps.host?.pubsub;
    if (!pubsub || this.unsubscribe) return Promise.resolve();
    this.subscribing ??= pubsub
      .subscribe(DISPLAY_CHANNEL, (raw) => {
        try {
          const m = JSON.parse(raw) as { tenantId: string; register: string; state: DisplayState };
          this.deliver(m.tenantId, m.register, m.state);
        } catch {
          // a malformed message is dropped
        }
      })
      .then((u) => {
        this.unsubscribe = u;
      })
      .finally(() => {
        this.subscribing = null;
      });
    return this.subscribing;
  }

  /** The counter pushes what it shows. Needs no paired screen: with none open the state is simply kept for the next one. */
  async publish(tenantId: string, input: z.input<typeof displayStateBody>): Promise<{ ok: true }> {
    const b = displayStateBody.parse(input);
    const pubsub = this.deps.host?.pubsub;
    if (pubsub) {
      await this.ensureSubscribed();
      await pubsub.publish(DISPLAY_CHANNEL, JSON.stringify({ tenantId, register: b.register, state: b.state }));
    } else {
      this.deliver(tenantId, b.register, b.state);
    }
    return { ok: true };
  }

  /**
   * Listens to the register's feed. `send` is called with the last state first (when recent), then with every update.
   * Returns the unsubscribe; `onRevoked` runs when the screen is removed from the counter.
   */
  async subscribe(auth: DisplayAuth, send: Listener, onRevoked: () => void): Promise<() => void> {
    await this.ensureSubscribed();
    const key = regKey(auth.tenantId, auth.register);
    const set = this.listeners.get(key) ?? new Set<Listener>();
    this.listeners.set(key, set);
    set.add(send);
    const closers = this.closers.get(auth.id) ?? new Set<() => void>();
    this.closers.set(auth.id, closers);
    closers.add(onRevoked);
    const last = this.latest.get(key);
    if (last && this.now().getTime() - last.at < STATE_KEEP_MS) send(last.state);
    return () => {
      set.delete(send);
      if (!set.size) this.listeners.delete(key);
      closers.delete(onRevoked);
      if (!closers.size) this.closers.delete(auth.id);
    };
  }

  /** Open feeds (diagnostics, tests). */
  connections(): number {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }

  async stop() {
    await this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
    this.closers.clear();
  }
}

function isUnique(err: unknown): boolean {
  for (let cur = err as { code?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (typeof cur !== "object") break;
    if (cur.code === "23505") return true;
  }
  return false;
}
