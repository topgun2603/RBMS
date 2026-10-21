import { z } from "zod";
import { maskTarget } from "./render";
import type { SendInput, SendResult } from "./service";
import { baseLocale } from "./templates";
import { noopLogger, type Channel, type LoggerPort } from "./types";

/**
 * Customer messages: the WhatsApp / SMS (and email, when we have the address) notices a shop's customers get from
 * the services engines and the store. Each event has a shop switch and a channel in the `messages` settings
 * namespace; sends are de-duplicated per event + entity + channel, held during quiet hours (21:00–08:00 IST, until
 * 08:00) and skip customers who opted out on WhatsApp. Delivery and the "Sent messages" list are notify's own
 * (notify_log); templates are the built-ins in customer-templates.ts / templates.ts, overridable per shop.
 */

export const CUSTOMER_EVENT_GROUPS = ["bookings", "jobcards", "memberships", "orders", "store"] as const;
export type CustomerEventGroup = (typeof CUSTOMER_EVENT_GROUPS)[number];

export interface CustomerEventDef {
  /** Also the notify template key. */
  key: string;
  group: CustomerEventGroup;
  /** The shop feature the event belongs to (the settings page only lists events of features that are on). */
  feature: string;
  /** Promotional in nature (abandoned cart): needs the customer's opt-in and skips every channel on opt-out. */
  marketing?: boolean;
}

export const CUSTOMER_EVENTS = [
  { key: "booking.confirmed", group: "bookings", feature: "bookings" },
  { key: "booking.rescheduled", group: "bookings", feature: "bookings" },
  { key: "booking.cancelled", group: "bookings", feature: "bookings" },
  { key: "booking.reminder", group: "bookings", feature: "bookings" },
  { key: "job.received", group: "jobcards", feature: "jobcards" },
  { key: "job.approval", group: "jobcards", feature: "jobcards" },
  { key: "job.ready", group: "jobcards", feature: "jobcards" },
  { key: "job.delivered", group: "jobcards", feature: "jobcards" },
  { key: "membership.welcome", group: "memberships", feature: "memberships" },
  { key: "membership.renewed", group: "memberships", feature: "memberships" },
  { key: "membership.renewal_due", group: "memberships", feature: "memberships" },
  { key: "membership.expired", group: "memberships", feature: "memberships" },
  { key: "order.placed", group: "orders", feature: "orders" },
  { key: "order.confirmed", group: "orders", feature: "orders" },
  { key: "order.shipped", group: "orders", feature: "orders" },
  { key: "order.delivered", group: "orders", feature: "orders" },
  { key: "order.cancelled", group: "orders", feature: "orders" },
  { key: "cart.abandoned", group: "store", feature: "storefront", marketing: true },
] as const satisfies readonly CustomerEventDef[];

export type CustomerEventKey = (typeof CUSTOMER_EVENTS)[number]["key"];
export const CUSTOMER_EVENT_KEYS: readonly CustomerEventKey[] = CUSTOMER_EVENTS.map((e) => e.key);
export const isCustomerEvent = (key: string): key is CustomerEventKey => (CUSTOMER_EVENT_KEYS as readonly string[]).includes(key);
export const customerEvent = (key: CustomerEventKey): CustomerEventDef => CUSTOMER_EVENTS.find((e) => e.key === key)!;

// ---------------------------------------------------------------------------------------------- settings

export const MESSAGE_CHANNEL_MODES = ["whatsapp", "sms", "both"] as const;
export type MessageChannelMode = (typeof MESSAGE_CHANNEL_MODES)[number];
export const MESSAGE_LANGUAGES = ["en", "ta"] as const;

const eventSetting = z.object({ on: z.boolean(), channel: z.enum(MESSAGE_CHANNEL_MODES) });
export type EventSetting = z.infer<typeof eventSetting>;

/**
 * Settings namespace `messages` (apps/api defines it). `events` is one map per shop (event key → on/channel);
 * missing events fall back to the defaults, so new events need no data change.
 */
export const MESSAGES_SETTINGS_SCHEMA = z.object({
  /** Language of the customer messages (orders use the customer's own when known). */
  language: z.enum(MESSAGE_LANGUAGES),
  /** Also send by email when the customer's address is known. */
  email: z.boolean(),
  /** Booking reminder: this many hours before the start. */
  bookingReminderHours: z.number().int().min(1).max(72),
  /** Membership renewal reminder: this many days before the plan ends. */
  membershipRenewalDays: z.number().int().min(1).max(30),
  /** Abandoned cart: a signed-in shopper's cart left with items for this many hours. */
  abandonedCartHours: z.number().int().min(1).max(72),
  events: z.record(z.string(), eventSetting.partial()),
});
export type MessagesSettings = Omit<z.infer<typeof MESSAGES_SETTINGS_SCHEMA>, "events"> & { events: Record<CustomerEventKey, EventSetting> };

export const MESSAGES_SETTINGS_DEFAULTS: MessagesSettings = {
  language: "en",
  email: true,
  bookingReminderHours: 24,
  membershipRenewalDays: 3,
  abandonedCartHours: 4,
  events: Object.fromEntries(CUSTOMER_EVENT_KEYS.map((k) => [k, { on: true, channel: "whatsapp" }])) as Record<CustomerEventKey, EventSetting>,
};

/** Stored (partial, possibly stale) settings → complete settings; invalid values fall back to the defaults. */
export function resolveMessagesSettings(stored: Partial<Record<string, unknown>> | null | undefined): MessagesSettings {
  const s = stored ?? {};
  const shape = MESSAGES_SETTINGS_SCHEMA.shape;
  const pick = <K extends "language" | "email" | "bookingReminderHours" | "membershipRenewalDays" | "abandonedCartHours">(k: K) => {
    const r = shape[k].safeParse(s[k]);
    return (r.success ? r.data : MESSAGES_SETTINGS_DEFAULTS[k]) as MessagesSettings[K];
  };
  const rawEvents = (s.events && typeof s.events === "object" ? s.events : {}) as Record<string, unknown>;
  const events = {} as Record<CustomerEventKey, EventSetting>;
  for (const key of CUSTOMER_EVENT_KEYS) {
    const d = MESSAGES_SETTINGS_DEFAULTS.events[key];
    const r = eventSetting.partial().safeParse(rawEvents[key]);
    events[key] = { on: r.success && r.data.on !== undefined ? r.data.on : d.on, channel: r.success && r.data.channel ? r.data.channel : d.channel };
  }
  return {
    language: pick("language"),
    email: pick("email"),
    bookingReminderHours: pick("bookingReminderHours"),
    membershipRenewalDays: pick("membershipRenewalDays"),
    abandonedCartHours: pick("abandonedCartHours"),
    events,
  };
}

// ---------------------------------------------------------------------------------------------- quiet hours

const IST_OFFSET_MS = 330 * 60_000;
export const QUIET_HOURS = { from: 21, to: 8 } as const;

/** Inside quiet hours (21:00–08:00 IST) → the next 08:00 IST; otherwise null (send now). */
export function quietUntil(now: Date): Date | null {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const h = local.getUTCHours();
  if (h >= QUIET_HOURS.to && h < QUIET_HOURS.from) return null;
  const nextDay = h >= QUIET_HOURS.from ? 1 : 0;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + nextDay, QUIET_HOURS.to, 0, 0) - IST_OFFSET_MS);
}

// ---------------------------------------------------------------------------------------------- planning

export type SkipReason = "off" | "no_contact" | "opted_out" | "duplicate" | "error";

/** Which channels a message goes out on, and why the others don't. Pure. */
export function planChannels(input: {
  setting: EventSetting;
  phone: string | null;
  email: string | null;
  emailOn: boolean;
  optedOut: boolean;
  marketing: boolean;
  /** Restrict to these channels (the orders module sends one target at a time). */
  only?: readonly Channel[];
}): { channels: Channel[]; skipped: { channel: Channel; reason: SkipReason }[] } {
  const allowed = (c: Channel) => !input.only || input.only.includes(c);
  const phoneChannels: Channel[] = input.setting.channel === "both" ? ["whatsapp", "sms"] : [input.setting.channel];
  const wanted: Channel[] = [...phoneChannels.filter(allowed)];
  // Email is a bonus channel: only when the address is known.
  if (input.emailOn && input.email && allowed("email")) wanted.push("email");
  if (!input.setting.on) return { channels: [], skipped: wanted.map((channel) => ({ channel, reason: "off" })) };
  const channels: Channel[] = [];
  const skipped: { channel: Channel; reason: SkipReason }[] = [];
  for (const channel of wanted) {
    if (channel === "email" ? !input.email : !input.phone) skipped.push({ channel, reason: "no_contact" });
    // WhatsApp STOP: no more WhatsApp; promotional messages stop on every channel.
    else if (input.optedOut && (input.marketing || channel === "whatsapp")) skipped.push({ channel, reason: "opted_out" });
    else channels.push(channel);
  }
  return { channels, skipped };
}

/** One send per event, entity and channel, ever. */
export const dedupeKey = (event: string, ref: string, channel: Channel) => `${event}:${ref}:${channel}`;

/** Indian mobile → "+91XXXXXXXXXX", else null (the same rules as invoices and orders). */
export function toIndianE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!/^\+?[0-9][0-9 ()-]*$/.test(trimmed)) return null;
  let d = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (!d.startsWith("91")) return null;
    d = d.slice(2);
  } else if (d.length === 14 && d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? `+91${d}` : null;
}

// ---------------------------------------------------------------------------------------------- formatting

export type MessageLocale = (typeof MESSAGE_LANGUAGES)[number];
export const messageLocale = (l: string | null | undefined): MessageLocale => (baseLocale(l) === "ta" ? "ta" : "en");

/** Words the event mappers fill in when a value is missing. */
export const CUSTOMER_TEXT: Record<MessageLocale, { anyStaff: string; soon: string; customer: string }> = {
  en: { anyStaff: "our team", soon: "soon", customer: "Customer" },
  ta: { anyStaff: "எங்கள் குழு", soon: "விரைவில்", customer: "வாடிக்கையாளர்" },
};

/** "25 Oct 2026" (Tamil month names in ta), IST. */
export function formatMessageDate(d: Date | string, locale: MessageLocale): string {
  const date = typeof d === "string" ? new Date(`${d}T12:00:00+05:30`) : d;
  return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(date);
}

/** "4:30 PM", IST (digits and AM/PM in both languages, as on the shop's board). */
export function formatMessageTime(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(d).toUpperCase();
}

/** Paise → "Rs.1,234.50" (GSM-7 safe, as the invoice messages). */
export function moneyText(paise: number): string {
  const rupees = Math.round(paise) / 100;
  return `Rs.${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Sample values for previews and "Send test to me". */
export function sampleVars(event: CustomerEventKey, locale: MessageLocale, shop: string, base = "https://shop.example.in"): Record<string, string> {
  const t = CUSTOMER_TEXT[locale];
  const day = new Date(Date.now() + 2 * 86_400_000);
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0) - IST_OFFSET_MS); // 11:00 AM IST
  const common = { shop, customer: locale === "ta" ? "ராஜா" : "Raja", date: formatMessageDate(start, locale), time: formatMessageTime(start) };
  const group = customerEvent(event).group;
  if (group === "bookings") return { ...common, number: "12", service: locale === "ta" ? "முடி வெட்டுதல்" : "Haircut", staff: t.anyStaff, link: `${base}/booking/sample` };
  if (group === "jobcards") return { ...common, number: "JC-0012", dueDate: formatMessageDate(day, locale), amount: moneyText(180000), link: `${base}/job/sample` };
  if (group === "memberships") {
    return { ...common, plan: locale === "ta" ? "மாதாந்திர திட்டம்" : "Monthly plan", code: "M-0042", startDate: formatMessageDate(new Date(), locale), endDate: formatMessageDate(day, locale), days: "3" };
  }
  if (group === "orders") return { ...common, number: "ORD-1042", amount: moneyText(124950), items: "2 items", tracking: "Delhivery 1234567890", link: `${base}/account/orders` };
  return { ...common, count: "2", link: `${base}/cart` };
}

// ---------------------------------------------------------------------------------------------- dispatcher

/** Atomic "send once" claims (apps/api keeps them in Postgres). */
export interface DedupePort {
  /** True when this call claimed the key; false when it was already claimed. */
  claim(tenantId: string, key: string): Promise<boolean>;
  /** Frees a claim whose send failed before reaching the queue (so a retry may send). */
  release(tenantId: string, key: string): Promise<void>;
}

/** WhatsApp opt-out (STOP) of a customer's number. */
export interface OptOutPort {
  optedOut(tenantId: string, phone: string): Promise<boolean>;
}

export interface CustomerMessagesDeps {
  notify: { send(input: SendInput): Promise<SendResult> };
  settings: { get(tenantId: string): Promise<Partial<Record<string, unknown>>> };
  dedupe: DedupePort;
  optOut?: OptOutPort;
  shopName?: (tenantId: string) => Promise<string | null>;
  log?: LoggerPort;
  now?: () => Date;
}

export type CustomerVars = Record<string, string | number>;

export interface CustomerMessage {
  tenantId: string;
  event: CustomerEventKey;
  /** The entity, for "send once": appointment id, job id, subscription id, order number, cart id + content. */
  ref: string;
  to: { phone?: string | null; email?: string | null };
  /** Template vars; `shop` is filled in when missing. A function gets the language the message goes out in. */
  vars: CustomerVars | ((ctx: { locale: MessageLocale; settings: MessagesSettings }) => CustomerVars | Promise<CustomerVars>);
  /** The customer's own language (orders); otherwise the shop's setting. */
  locale?: string | null;
  only?: readonly Channel[];
  userId?: string | null;
}

export interface CustomerSendResult {
  channel: Channel;
  status: "queued" | "sent" | "failed" | "skipped";
  reason?: SkipReason;
  logId?: string;
  /** Held for quiet hours until this time (ISO). */
  sendAt?: string;
  to?: string;
}

export class CustomerMessages {
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: CustomerMessagesDeps) {
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  async settingsFor(tenantId: string): Promise<MessagesSettings> {
    return resolveMessagesSettings(await this.deps.settings.get(tenantId));
  }

  private async shop(tenantId: string): Promise<string> {
    try {
      return (await this.deps.shopName?.(tenantId)) ?? "";
    } catch {
      return ""; // cosmetic
    }
  }

  /** Sends one customer message per the shop's settings. Never throws: failures come back as results (and are logged). */
  async send(m: CustomerMessage): Promise<CustomerSendResult[]> {
    try {
      const settings = await this.settingsFor(m.tenantId);
      const def = customerEvent(m.event);
      const phone = toIndianE164(m.to.phone ?? null);
      const email = m.to.email?.trim() || null;
      const optedOut = phone && this.deps.optOut ? await this.deps.optOut.optedOut(m.tenantId, phone).catch(() => false) : false;
      const plan = planChannels({
        setting: settings.events[m.event],
        phone,
        email,
        emailOn: settings.email,
        optedOut,
        marketing: !!def.marketing,
        only: m.only,
      });
      const results: CustomerSendResult[] = plan.skipped.map((s) => ({ channel: s.channel, status: "skipped", reason: s.reason }));
      if (!plan.channels.length) {
        this.log.info({ tenantId: m.tenantId, event: m.event, ref: m.ref, skipped: plan.skipped }, `messages: ${m.event} not sent`);
        return results;
      }
      const locale = m.locale ? messageLocale(m.locale) : settings.language;
      const vars = typeof m.vars === "function" ? await m.vars({ locale, settings }) : m.vars;
      const allVars = { shop: vars.shop ?? (await this.shop(m.tenantId)), ...vars };
      const quiet = quietUntil(this.now());
      for (const channel of plan.channels) {
        const to = channel === "email" ? email! : phone!;
        const key = dedupeKey(m.event, m.ref, channel);
        if (!(await this.deps.dedupe.claim(m.tenantId, key))) {
          results.push({ channel, status: "skipped", reason: "duplicate" });
          continue;
        }
        // Quiet hours hold phone messages until 08:00 IST; email doesn't ring, so it goes now.
        const sendAt = quiet && channel !== "email" ? quiet : undefined;
        try {
          const r = await this.deps.notify.send({
            tenantId: m.tenantId,
            userId: m.userId ?? null,
            channel,
            to,
            template: m.event,
            vars: allVars,
            locale,
            ...(sendAt ? { sendAt } : {}),
          });
          results.push({ channel, status: r.status, logId: r.logId, to: maskTarget(to), ...(sendAt ? { sendAt: sendAt.toISOString() } : {}) });
        } catch (err) {
          await this.deps.dedupe.release(m.tenantId, key).catch(() => undefined);
          this.log.warn({ err, tenantId: m.tenantId, event: m.event, ref: m.ref, channel }, "messages: send failed");
          results.push({ channel, status: "failed", reason: "error" });
        }
      }
      this.log.info(
        { tenantId: m.tenantId, event: m.event, ref: m.ref, results: results.map((r) => `${r.channel}:${r.status}${r.reason ? `(${r.reason})` : ""}`) },
        `messages: ${m.event}`,
      );
      return results;
    } catch (err) {
      this.log.error({ err, tenantId: m.tenantId, event: m.event, ref: m.ref }, "messages: could not send");
      return [];
    }
  }

  /**
   * "Send test to me": the event's real template with sample values, to the signed-in owner's own phone / email, on
   * the event's channels (or `channel`). No "send once", no quiet hours; it shows in Sent messages like any other.
   */
  async sendTest(input: {
    tenantId: string;
    userId: string;
    event: CustomerEventKey;
    phone: string | null;
    email: string | null;
    channel?: Channel;
    baseUrl?: string;
  }): Promise<CustomerSendResult[]> {
    const settings = await this.settingsFor(input.tenantId);
    const phone = toIndianE164(input.phone);
    const mode = settings.events[input.event].channel;
    const channels: Channel[] = input.channel ? [input.channel] : mode === "both" ? ["whatsapp", "sms"] : [mode];
    const vars = sampleVars(input.event, settings.language, (await this.shop(input.tenantId)) || "Shop", input.baseUrl);
    const results: CustomerSendResult[] = [];
    for (const channel of channels) {
      const to = channel === "email" ? input.email : phone;
      if (!to) {
        results.push({ channel, status: "skipped", reason: "no_contact" });
        continue;
      }
      const r = await this.deps.notify.send({ tenantId: input.tenantId, userId: input.userId, channel, to, template: input.event, vars, locale: settings.language });
      results.push({ channel, status: r.status, logId: r.logId, to: maskTarget(to) });
    }
    return results;
  }
}
