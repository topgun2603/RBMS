import { createHash } from "node:crypto";
import { defineModule, requireRole, requireTenant, type SrModule } from "@rbms/core";
import { and, eq, gt, isNotNull, isNull, like, lt, or, sql, type Db } from "@rbms/db";
import type { BookingNotice, NotifyPort as BookingsNotifyPort, createBookings } from "@rbms/bookings";
import type { JobSummary, NotifyPort as JobcardsNotifyPort, ServiceDue, createJobcards } from "@rbms/jobcards";
import type { ExpiringMembership, MembershipNotifyPort, ReminderPort, SoldMembership, createMemberships } from "@rbms/memberships";
import {
  CUSTOMER_EVENTS,
  CUSTOMER_EVENT_KEYS,
  CUSTOMER_TEXT,
  CustomerMessages,
  MESSAGES_SETTINGS_DEFAULTS,
  MESSAGES_SETTINGS_SCHEMA,
  QUIET_HOURS,
  customerEvent,
  formatMessageDate,
  formatMessageTime,
  isCustomerEvent,
  moneyText,
  quietUntil,
  sampleVars,
  type CustomerEventKey,
  type DedupePort,
  type MessageLocale,
  type MessagesSettings,
  type OptOutPort,
  type createNotify,
} from "@rbms/notify";
import type { SettingsService } from "@rbms/settings";
import { settingsValues } from "@rbms/settings";
import { storeCarts, storeCustomers } from "@rbms/storefront";
import { waContacts } from "@rbms/whatsapp";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";

/**
 * Customer messages (docs: packages/notify/src/customer.ts): bookings, job cards, memberships, store orders and
 * abandoned carts on WhatsApp / SMS (and email when known), per the shop's `messages` settings, sent once per event
 * and entity, held during quiet hours, logged in notify_log ("Sent messages"). kit.ts wires the ports below into the
 * engines (late-bound) and schedules the jobs.
 */
type Notify = ReturnType<typeof createNotify>["service"];
type Bookings = ReturnType<typeof createBookings>["service"];
type Memberships = ReturnType<typeof createMemberships>["service"];
type Jobcards = ReturnType<typeof createJobcards>["service"];

export const MESSAGES_JOBS = {
  bookingReminders: "messages.booking-reminders",
  memberships: "messages.memberships",
  serviceDue: "messages.service-due",
  abandonedCarts: "messages.abandoned-carts",
  purge: "messages.purge",
} as const;

/** Bills the shop sends by hand (invoices module) also show in Sent messages. */
const LOG_TEMPLATE_KEYS = [...CUSTOMER_EVENT_KEYS, "invoice.issued", "invoice.reminder", "payment.received"];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 330 * 60_000;
/** "YYYY-MM-DD" in IST. */
export const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------- event → message

/** Vars of the booking.* templates. */
export function bookingVars(n: BookingNotice, locale: MessageLocale, link: string): Record<string, string> {
  const t = CUSTOMER_TEXT[locale];
  return {
    customer: n.customer.name || t.customer,
    number: String(n.number),
    service: n.services.join(", ") || "-",
    staff: n.staffName || t.anyStaff,
    date: formatMessageDate(n.start, locale),
    time: formatMessageTime(n.start),
    link,
  };
}

/** The job.* event for a job card status (null: no message for it). */
export function jobEvent(status: JobSummary["status"]): CustomerEventKey | null {
  const map: Partial<Record<JobSummary["status"], CustomerEventKey>> = {
    received: "job.received",
    awaiting_approval: "job.approval",
    ready: "job.ready",
    delivered: "job.delivered",
  };
  return map[status] ?? null;
}

/** Vars of the job.* templates: approval shows the estimate, ready the balance due. */
export function jobVars(job: JobSummary, locale: MessageLocale, link: string): Record<string, string> {
  const t = CUSTOMER_TEXT[locale];
  return {
    customer: job.customerName || t.customer,
    number: job.label,
    dueDate: job.dueDate ? formatMessageDate(job.dueDate, locale) : t.soon,
    amount: moneyText(job.status === "awaiting_approval" ? job.total : job.balance),
    link,
  };
}

/** Vars of job.service_due: the vehicle, the date and, if the card asked for it, the km. */
export function serviceDueVars(due: ServiceDue, locale: MessageLocale, link: string): Record<string, string> {
  return {
    customer: due.customerName || CUSTOMER_TEXT[locale].customer,
    number: due.label,
    vehicle: due.regNo,
    dueDate: formatMessageDate(due.dueDate, locale),
    dueKm: due.dueKm ? (locale === "ta" ? ` அல்லது ${due.dueKm} கி.மீ` : ` or at ${due.dueKm} km`) : "",
    link,
  };
}

/** Vars of the membership.* templates. */
export function membershipVars(
  m: Pick<ExpiringMembership, "name" | "memberCode" | "planName" | "endDate"> & { startDate?: string; daysLeft?: number },
  locale: MessageLocale,
): Record<string, string> {
  return {
    customer: m.name || CUSTOMER_TEXT[locale].customer,
    plan: m.planName,
    code: m.memberCode,
    startDate: m.startDate ? formatMessageDate(m.startDate, locale) : "",
    endDate: formatMessageDate(m.endDate, locale),
    days: String(m.daysLeft ?? 0),
  };
}

/** Same cart content → same reference (one reminder per cart content, however often the shopper looks at it). */
export function cartRef(cart: { id: string; lines: { variantId: string; qty: number }[] }): string {
  const content = [...cart.lines]
    .map((l) => `${l.variantId}x${l.qty}`)
    .sort()
    .join(",");
  return `${cart.id}:${createHash("sha256").update(content).digest("hex").slice(0, 12)}`;
}

/**
 * Whether a booking reminder is due now: the start is within the shop's lead time, the booking was made at least
 * that long before the start (a last-minute booking already got its confirmation), and the message wouldn't be held
 * for quiet hours past the start.
 */
export function reminderDue(a: { start: Date; createdAt: Date }, leadHours: number, now: Date): boolean {
  const lead = leadHours * HOUR_MS;
  if (a.start.getTime() <= now.getTime() || a.start.getTime() - now.getTime() > lead) return false;
  if (a.start.getTime() - a.createdAt.getTime() < lead) return false;
  const held = quietUntil(now);
  return !held || held.getTime() < a.start.getTime();
}

// ---------------------------------------------------------------------------------------------- stores

/**
 * "Send once" claims, kept without a table of their own: one settings_values row per shop and month
 * (namespace `messages.sent.YYYY-MM`, never a defined settings namespace) whose jsonb holds the claimed keys.
 * The claim is one atomic upsert; last month's row is checked too. `messages.purge` drops rows older than 2 months.
 */
export function pgDedupe(db: Db, now: () => Date = () => new Date()): DedupePort & { purge(): Promise<number> } {
  const ns = (month: string) => `messages.sent.${month}`;
  const months = () => {
    const d = istDate(now());
    const first = `${d.slice(0, 7)}-01`;
    return { current: d.slice(0, 7), previous: addDays(first, -1).slice(0, 7) };
  };
  const scope = (tenantId: string, namespace: string) =>
    and(eq(settingsValues.namespace, namespace), eq(settingsValues.tenantId, tenantId), isNull(settingsValues.userId));
  return {
    async claim(tenantId, key) {
      const m = months();
      const [old] = await db
        .select({ id: settingsValues.id })
        .from(settingsValues)
        .where(and(scope(tenantId, ns(m.previous)), sql`jsonb_exists(${settingsValues.value}, ${key})`))
        .limit(1);
      if (old) return false;
      const at = now();
      const rows = await db
        .insert(settingsValues)
        .values({ tenantId, userId: null, namespace: ns(m.current), value: { [key]: at.toISOString() } })
        .onConflictDoUpdate({
          target: [settingsValues.namespace, settingsValues.tenantId, settingsValues.userId],
          set: { value: sql`${settingsValues.value} || excluded.value`, updatedAt: at },
          setWhere: sql`not jsonb_exists(${settingsValues.value}, ${key})`,
        })
        .returning({ id: settingsValues.id });
      return rows.length > 0;
    },
    async release(tenantId, key) {
      const m = months();
      await db
        .update(settingsValues)
        .set({ value: sql`${settingsValues.value} - ${key}::text` })
        .where(or(scope(tenantId, ns(m.current)), scope(tenantId, ns(m.previous))));
    },
    async purge() {
      const m = months();
      const rows = await db
        .delete(settingsValues)
        .where(and(like(settingsValues.namespace, "messages.sent.%"), lt(settingsValues.namespace, ns(m.previous))))
        .returning({ id: settingsValues.id });
      return rows.length;
    },
  };
}

/** WhatsApp STOP (the inbox's contact list). */
export function waOptOut(db: Db): OptOutPort {
  return {
    async optedOut(tenantId, phone) {
      const [c] = await db
        .select({ optedOutAt: waContacts.optedOutAt })
        .from(waContacts)
        .where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.phone, phone)))
        .limit(1);
      return !!c?.optedOutAt;
    },
  };
}

// ---------------------------------------------------------------------------------------------- module

export interface MessagesDeps {
  log: Logger;
  db: Db;
  settings: SettingsService;
  notify: Notify;
  features: { isEnabled(tenantId: string, key: string): Promise<boolean> };
  auth: { getUser(id: string): Promise<{ phone?: string | null; email?: string | null } | null> };
  shopName: (tenantId: string) => Promise<string | null>;
  /** The shop's public store, e.g. "https://glow.srikit.in" (no trailing slash). */
  storeUrl: (tenantId: string) => Promise<string>;
  /** Registers a job the kit can also run on demand (`kit.runJob`). */
  defineJob: (name: string, handler: () => Promise<void>) => void;
  schedule: (name: string, cron: string) => Promise<void>;
  /** The engines the jobs read (created after this module in kit.ts, so read lazily). */
  engines: () => { bookings: Bookings; memberships: Memberships; jobcards: Jobcards };
  /** Overrides of the Postgres "send once" store and the WhatsApp opt-out lookup (tests). */
  dedupe?: DedupePort & { purge?(): Promise<number> };
  optOut?: OptOutPort;
  now?: () => Date;
}

const putBody = MESSAGES_SETTINGS_SCHEMA.partial()
  .extend({ events: z.record(z.enum(CUSTOMER_EVENT_KEYS as [CustomerEventKey, ...CustomerEventKey[]]), MESSAGES_SETTINGS_SCHEMA.shape.events.element).optional() })
  .strict();
const testBody = z.object({
  event: z.enum(CUSTOMER_EVENT_KEYS as [CustomerEventKey, ...CustomerEventKey[]]),
  channel: z.enum(["whatsapp", "sms", "email"]).optional(),
});
const logQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["queued", "sent", "failed"]).optional(),
});

export function createMessages(d: MessagesDeps) {
  const { db, log } = d;
  const now = d.now ?? (() => new Date());
  const handle = d.settings.define("messages", MESSAGES_SETTINGS_SCHEMA, MESSAGES_SETTINGS_DEFAULTS);
  const dedupe = d.dedupe ?? pgDedupe(db, now);
  const messages = new CustomerMessages({
    notify: d.notify,
    settings: { get: (tenantId) => handle.get({ tenantId }) },
    dedupe,
    optOut: d.optOut ?? waOptOut(db),
    shopName: d.shopName,
    log,
    now,
  });
  const storeUrl = async (tenantId: string) => {
    try {
      return (await d.storeUrl(tenantId)).replace(/\/+$/, "");
    } catch {
      return "";
    }
  };
  /** The page's link, or the store's home when the shop switched that page off. */
  const pageLink = async (tenantId: string, feature: string, path: string) => {
    const base = await storeUrl(tenantId);
    return (await d.features.isEnabled(tenantId, feature).catch(() => false)) ? `${base}${path}` : base;
  };
  const on = (tenantId: string, feature: string) => d.features.isEnabled(tenantId, feature).catch(() => false);

  // ------------------------------------------------------------------ engine ports

  const bookings: BookingsNotifyPort = {
    booked: async (tenantId, n) => {
      const link = await pageLink(tenantId, "bookings.online", `/booking/${n.manageToken}`);
      await messages.send({ tenantId, event: "booking.confirmed", ref: n.appointmentId, to: { phone: n.customer.phone }, vars: ({ locale }) => bookingVars(n, locale, link) });
    },
    rescheduled: async (tenantId, n) => {
      const link = await pageLink(tenantId, "bookings.online", `/booking/${n.manageToken}`);
      // One message per new time: each move is its own event.
      const ref = `${n.appointmentId}:${n.start.getTime()}`;
      await messages.send({ tenantId, event: "booking.rescheduled", ref, to: { phone: n.customer.phone }, vars: ({ locale }) => bookingVars(n, locale, link) });
    },
    cancelled: async (tenantId, n) => {
      const link = await pageLink(tenantId, "bookings.online", "/book");
      await messages.send({ tenantId, event: "booking.cancelled", ref: n.appointmentId, to: { phone: n.customer.phone }, vars: ({ locale }) => bookingVars(n, locale, link) });
    },
  };

  const jobcards: JobcardsNotifyPort = {
    statusChanged: async (tenantId, job) => {
      const event = jobEvent(job.status);
      if (!event) return;
      const link = await pageLink(tenantId, "jobcards.tracking", `/job/${job.trackToken}`);
      await messages.send({ tenantId, event, ref: job.id, to: { phone: job.customerPhone }, vars: ({ locale }) => jobVars(job, locale, link) });
    },
  };

  const membershipNotify: MembershipNotifyPort = {
    sold: async (tenantId, m: SoldMembership) => {
      const event = m.renewal ? "membership.renewed" : "membership.welcome";
      await messages.send({ tenantId, event, ref: m.subscriptionId, to: { phone: m.phone }, vars: ({ locale }) => membershipVars(m, locale) });
    },
  };

  const membershipReminders: ReminderPort = {
    expiring: async (tenantId, list) => {
      for (const m of list) {
        await messages.send({
          tenantId,
          event: "membership.renewal_due",
          ref: `${m.subscriptionId}:${m.endDate}`,
          to: { phone: m.phone },
          vars: ({ locale }) => membershipVars(m, locale),
        });
      }
    },
  };

  /**
   * The orders module's notifier, through the shop's settings: customer order messages (WhatsApp target → the
   * event's WhatsApp / SMS choice; email stays email) once per order, event and channel; others (the owner's
   * "new order") go straight to notify.
   */
  const orderNotifier = {
    send: async (i: { tenantId: string; channel: "whatsapp" | "sms" | "email"; to: string; template: string; vars: Record<string, string>; locale?: string }) => {
      if (!isCustomerEvent(i.template) || customerEvent(i.template).group !== "orders") {
        return { logId: (await d.notify.send({ tenantId: i.tenantId, channel: i.channel, to: i.to, template: i.template, vars: i.vars, locale: i.locale })).logId };
      }
      const email = i.channel === "email";
      const r = await messages.send({
        tenantId: i.tenantId,
        event: i.template,
        ref: i.vars.number || i.to,
        to: email ? { email: i.to } : { phone: i.to },
        vars: i.vars,
        locale: i.locale,
        only: email ? ["email"] : ["whatsapp", "sms"],
      });
      return { logId: r.find((x) => x.logId)?.logId ?? "" };
    },
  };

  // ------------------------------------------------------------------ jobs

  /** Booking reminders, every 10 minutes: appointments within each shop's lead time (up to 72 h ahead). */
  const runBookingReminders = async (bookingsService: Bookings) => {
    const at = now();
    const list = await bookingsService.remindable(at, new Date(at.getTime() + 72 * HOUR_MS));
    const cache = new Map<string, MessagesSettings | null>();
    let sent = 0;
    for (const a of list) {
      if (!cache.has(a.tenantId)) cache.set(a.tenantId, (await on(a.tenantId, "bookings")) ? await messages.settingsFor(a.tenantId) : null);
      const s = cache.get(a.tenantId);
      if (!s || !s.events["booking.reminder"].on || !reminderDue(a, s.bookingReminderHours, at)) continue;
      const link = await pageLink(a.tenantId, "bookings.online", `/booking/${a.manageToken}`);
      const r = await messages.send({
        tenantId: a.tenantId,
        event: "booking.reminder",
        ref: `${a.appointmentId}:${a.start.getTime()}`,
        to: { phone: a.customer.phone },
        vars: ({ locale }) => bookingVars(a, locale, link),
      });
      if (r.some((x) => x.status === "sent" || x.status === "queued")) sent++;
    }
    return { checked: list.length, sent };
  };

  /** Membership renewal reminders (N days before, per shop) and "expired" notices, daily at 09:00 IST. */
  const runMemberships = async (membershipsService: Memberships) => {
    const today = istDate(now());
    const tenants = await membershipsService.tenantsWithPlansEnding(addDays(today, -3), addDays(today, 30));
    let reminded = 0;
    let expired = 0;
    for (const tenantId of tenants) {
      if (!(await on(tenantId, "memberships"))) continue;
      const s = await messages.settingsFor(tenantId);
      if (s.events["membership.renewal_due"].on) reminded += await membershipsService.remindExpiring(tenantId, s.membershipRenewalDays);
      if (!s.events["membership.expired"].on) continue;
      // Ended in the last 3 days and not renewed (a missed run catches up; each plan is told once).
      for (const m of await membershipsService.expiring(tenantId, { from: addDays(today, -3), to: addDays(today, -1) })) {
        const r = await messages.send({
          tenantId,
          event: "membership.expired",
          ref: `${m.subscriptionId}:${m.endDate}`,
          to: { phone: m.phone },
          vars: ({ locale }) => membershipVars(m, locale),
        });
        if (r.some((x) => x.status === "sent" || x.status === "queued")) expired++;
      }
    }
    return { tenants: tenants.length, reminded, expired };
  };

  /**
   * Vehicle service reminders, daily: delivered vehicle cards whose "next service after N months" is today. Each card is
   * told once (the ref carries the due date); a shop with job cards or the event off sends none.
   */
  const runServiceDue = async (jobcardsService: Jobcards) => {
    const due = await jobcardsService.serviceDueOn(istDate(now()));
    let sent = 0;
    for (const x of due) {
      if (!(await on(x.tenantId, "jobcards"))) continue;
      const link = await pageLink(x.tenantId, "jobcards.tracking", `/job/${x.trackToken}`);
      const r = await messages.send({ tenantId: x.tenantId, event: "job.service_due", ref: `${x.jobId}:${x.dueDate}`, to: { phone: x.customerPhone }, vars: ({ locale }) => serviceDueVars(x, locale, link) });
      if (r.some((y) => y.status === "sent" || y.status === "queued")) sent++;
    }
    return { due: due.length, sent };
  };

  /**
   * Abandoned carts, every 30 minutes: a signed-in shopper's server cart with items, untouched for the shop's delay
   * (and less than 3 days), no order since, who agreed to offers (`marketing_opt_in`). Anonymous carts have no contact.
   */
  const runAbandonedCarts = async () => {
    const at = now();
    const rows = await db
      .select({
        tenantId: storeCarts.tenantId,
        id: storeCarts.id,
        lines: storeCarts.lines,
        updatedAt: storeCarts.updatedAt,
        name: storeCustomers.name,
        phone: storeCustomers.phone,
        email: storeCustomers.email,
      })
      .from(storeCarts)
      .innerJoin(storeCustomers, and(eq(storeCustomers.id, storeCarts.customerId), eq(storeCustomers.tenantId, storeCarts.tenantId)))
      .where(
        and(
          isNotNull(storeCarts.customerId),
          sql`jsonb_array_length(${storeCarts.lines}) > 0`,
          lt(storeCarts.updatedAt, new Date(at.getTime() - HOUR_MS)),
          gt(storeCarts.updatedAt, new Date(at.getTime() - 3 * DAY_MS)),
          gt(storeCarts.expiresAt, at),
          eq(storeCustomers.marketingOptIn, true),
          or(isNull(storeCustomers.lastOrderAt), lt(storeCustomers.lastOrderAt, storeCarts.updatedAt)),
        ),
      )
      .limit(2000);
    const cache = new Map<string, MessagesSettings | null>();
    let sent = 0;
    for (const c of rows) {
      if (!cache.has(c.tenantId)) cache.set(c.tenantId, (await on(c.tenantId, "storefront")) ? await messages.settingsFor(c.tenantId) : null);
      const s = cache.get(c.tenantId);
      if (!s || !s.events["cart.abandoned"].on || at.getTime() - c.updatedAt.getTime() < s.abandonedCartHours * HOUR_MS) continue;
      const link = `${await storeUrl(c.tenantId)}/cart`;
      const count = c.lines.reduce((n, l) => n + (l.qty > 0 ? l.qty : 0), 0);
      const r = await messages.send({
        tenantId: c.tenantId,
        event: "cart.abandoned",
        ref: cartRef(c),
        to: { phone: c.phone, email: c.email },
        vars: ({ locale }) => ({ customer: c.name || CUSTOMER_TEXT[locale].customer, count: String(count), link }),
      });
      if (r.some((x) => x.status === "sent" || x.status === "queued")) sent++;
    }
    return { carts: rows.length, sent };
  };

  d.defineJob(MESSAGES_JOBS.bookingReminders, async () => {
    log.info(await runBookingReminders(d.engines().bookings), "messages: booking reminders run");
  });
  d.defineJob(MESSAGES_JOBS.memberships, async () => {
    log.info(await runMemberships(d.engines().memberships), "messages: membership reminders run");
  });
  d.defineJob(MESSAGES_JOBS.serviceDue, async () => {
    log.info(await runServiceDue(d.engines().jobcards), "messages: vehicle service reminders run");
  });
  d.defineJob(MESSAGES_JOBS.abandonedCarts, async () => {
    log.info(await runAbandonedCarts(), "messages: abandoned carts run");
  });
  d.defineJob(MESSAGES_JOBS.purge, async () => {
    const n = (await dedupe.purge?.()) ?? 0;
    if (n) log.info({ rows: n }, "messages: old send-once rows purged");
  });

  // ------------------------------------------------------------------ routes

  const eventsFor = async (tenantId: string, s: MessagesSettings) => {
    const shop = (await d.shopName(tenantId).catch(() => null)) || "Shop";
    const base = (await storeUrl(tenantId)) || undefined;
    return Promise.all(
      CUSTOMER_EVENTS.map(async (e) => {
        const preview = await d.notify
          .preview({ tenantId, channel: "whatsapp", locale: s.language, key: e.key, vars: sampleVars(e.key, s.language, shop, base) })
          .then((p) => p.body)
          .catch(() => "");
        return { key: e.key, group: e.group, marketing: "marketing" in e ? e.marketing : false, available: await on(tenantId, e.feature), preview };
      }),
    );
  };

  const module: SrModule = defineModule({
    id: "messages",
    routes: async (app: FastifyInstance) => {
      /** Settings → Customer messages: the settings, each event (available = its feature is on) with a preview. */
      app.get("/settings", async (req) => {
        requireRole(req.ctx, "owner", "admin");
        const tenant = requireTenant(req.ctx);
        const values = await messages.settingsFor(tenant.id);
        return { values, events: await eventsFor(tenant.id, values), quietHours: QUIET_HOURS };
      });

      app.put("/settings", async (req) => {
        requireRole(req.ctx, "owner", "admin");
        const tenant = requireTenant(req.ctx);
        const patch = putBody.parse(req.body ?? {});
        if (patch.events) {
          const current = (await messages.settingsFor(tenant.id)).events;
          const merged = Object.fromEntries(CUSTOMER_EVENT_KEYS.map((k) => [k, { ...current[k], ...(patch.events?.[k] ?? {}) }]));
          patch.events = merged as typeof patch.events;
        }
        await handle.setTenant(tenant.id, patch);
        const values = await messages.settingsFor(tenant.id);
        return { values, events: await eventsFor(tenant.id, values), quietHours: QUIET_HOURS };
      });

      /** "Send test to me": the event's message with sample values to the signed-in owner's own phone / email. */
      app.post("/test", async (req) => {
        const user = requireRole(req.ctx, "owner", "admin");
        const tenant = requireTenant(req.ctx);
        const body = testBody.parse(req.body ?? {});
        const me = await d.auth.getUser(user.id);
        const results = await messages.sendTest({
          tenantId: tenant.id,
          userId: user.id,
          event: body.event,
          phone: me?.phone ?? null,
          email: me?.email ?? null,
          channel: body.channel,
          baseUrl: (await storeUrl(tenant.id)) || undefined,
        });
        return { results };
      });

      /** Sent messages: customer messages and bills, newest first (notify's delivery log; bodies are never stored). */
      app.get("/log", async (req) => {
        requireRole(req.ctx, "owner", "admin");
        const tenant = requireTenant(req.ctx);
        const q = logQuery.parse(req.query ?? {});
        return { items: await d.notify.log({ tenantId: tenant.id, ...q, templateKeys: LOG_TEMPLATE_KEYS }) };
      });
    },
  });

  return {
    messages,
    module,
    /** NotifyPort for @rbms/bookings. */
    bookings,
    /** NotifyPort for @rbms/jobcards. */
    jobcards,
    /** ReminderPort + MembershipNotifyPort for @rbms/memberships. */
    memberships: { reminders: membershipReminders, notify: membershipNotify },
    /** Wraps the orders module's notifier. */
    orderNotifier,
    run: {
      bookingReminders: () => runBookingReminders(d.engines().bookings),
      memberships: () => runMemberships(d.engines().memberships),
      abandonedCarts: runAbandonedCarts,
    },
    async schedule() {
      await d.schedule(MESSAGES_JOBS.bookingReminders, "*/10 * * * *");
      await d.schedule(MESSAGES_JOBS.memberships, "0 9 * * *");
      await d.schedule(MESSAGES_JOBS.serviceDue, "30 9 * * *");
      await d.schedule(MESSAGES_JOBS.abandonedCarts, "*/30 * * * *");
      await d.schedule(MESSAGES_JOBS.purge, "50 3 * * *");
    },
  };
}

export type Messages = ReturnType<typeof createMessages>;
