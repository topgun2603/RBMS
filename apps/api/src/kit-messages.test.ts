import type { BookingNotice } from "@srirealtime/bookings";
import type { JobSummary } from "@srirealtime/jobcards";
import type { DedupePort, SendInput } from "@srirealtime/notify";
import type { SettingsService } from "@srirealtime/settings";
import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import { bookingVars, cartRef, createMessages, istDate, jobEvent, jobVars, membershipVars, reminderDue } from "./kit-messages";

/** 2026-10-21 at HH:MM IST. */
const ist = (hh: number, mm = 0, day = 21) => new Date(Date.UTC(2026, 9, day, hh, mm) - 330 * 60_000);
const HOUR = 3_600_000;

const notice: BookingNotice = {
  appointmentId: "a1",
  number: 4,
  status: "booked",
  source: "online",
  start: ist(16, 30, 23),
  end: ist(17, 0, 23),
  staffName: null,
  services: ["Haircut", "Beard trim"],
  customer: { name: "Priya", phone: "9876543210" },
  manageToken: "tok123",
};

const job: JobSummary = {
  id: "j1",
  number: 12,
  label: "JC-0012",
  template: "device",
  status: "awaiting_approval",
  customerName: "Ravi",
  customerPhone: "+919876500022",
  dueDate: "2026-10-24",
  total: 177000,
  balance: 77000,
  trackToken: "trk",
};

describe("event → message vars", () => {
  it("bookings: services joined, staff fallback in the message language, IST date and time", () => {
    expect(bookingVars(notice, "en", "L")).toEqual({
      customer: "Priya",
      number: "4",
      service: "Haircut, Beard trim",
      staff: "our team",
      date: "23 Oct 2026",
      time: "4:30 PM",
      link: "L",
    });
    expect(bookingVars({ ...notice, staffName: "Anu" }, "ta", "L").staff).toBe("Anu");
    expect(bookingVars(notice, "ta", "L").staff).toBe("எங்கள் குழு");
  });

  it("job cards: only received / approval / ready / delivered speak; approval shows the estimate, ready the balance", () => {
    expect(["received", "diagnosed", "awaiting_approval", "in_progress", "trial", "ready", "delivered", "cancelled"].map((s) => jobEvent(s as JobSummary["status"]))).toEqual([
      "job.received",
      null,
      "job.approval",
      null,
      null,
      "job.ready",
      "job.delivered",
      null,
    ]);
    expect(jobVars(job, "en", "L")).toMatchObject({ number: "JC-0012", amount: "Rs.1,770.00", dueDate: "24 Oct 2026" });
    expect(jobVars({ ...job, status: "ready" }, "en", "L").amount).toBe("Rs.770.00");
    expect(jobVars({ ...job, dueDate: null }, "ta", "L").dueDate).toBe("விரைவில்");
  });

  it("memberships", () => {
    expect(membershipVars({ name: "Bala", memberCode: "M-0003", planName: "Monthly", endDate: "2026-10-24", daysLeft: 3 }, "en")).toEqual({
      customer: "Bala",
      plan: "Monthly",
      code: "M-0003",
      startDate: "",
      endDate: "24 Oct 2026",
      days: "3",
    });
  });

  it("cart reference: same content (any order) → same ref; changed content → new ref", () => {
    const a = cartRef({ id: "c1", lines: [{ variantId: "v1", qty: 1 }, { variantId: "v2", qty: 2 }] });
    expect(cartRef({ id: "c1", lines: [{ variantId: "v2", qty: 2 }, { variantId: "v1", qty: 1 }] })).toBe(a);
    expect(cartRef({ id: "c1", lines: [{ variantId: "v1", qty: 3 }] })).not.toBe(a);
    expect(a.startsWith("c1:")).toBe(true);
  });

  it("istDate", () => {
    expect(istDate(ist(0, 30, 22))).toBe("2026-10-22");
    expect(istDate(ist(23, 59))).toBe("2026-10-21");
  });
});

describe("reminderDue", () => {
  const now = ist(11, 0);
  it("inside the lead time, for a booking made before it", () => {
    expect(reminderDue({ start: new Date(now.getTime() + 20 * HOUR), createdAt: ist(9, 0, 18) }, 24, now)).toBe(true);
    expect(reminderDue({ start: new Date(now.getTime() + 30 * HOUR), createdAt: ist(9, 0, 18) }, 24, now)).toBe(false);
  });
  it("not for a last-minute booking (its confirmation is enough) or a past start", () => {
    expect(reminderDue({ start: new Date(now.getTime() + 3 * HOUR), createdAt: new Date(now.getTime() - HOUR) }, 24, now)).toBe(false);
    expect(reminderDue({ start: new Date(now.getTime() - HOUR), createdAt: ist(9, 0, 18) }, 24, now)).toBe(false);
  });
  it("not when quiet hours would hold it past the start", () => {
    const night = ist(6, 0);
    expect(reminderDue({ start: ist(7, 30), createdAt: ist(9, 0, 18) }, 2, night)).toBe(false);
    expect(reminderDue({ start: ist(9, 0), createdAt: ist(9, 0, 18) }, 4, night)).toBe(true);
  });
});

function harness(opts: { features?: Record<string, boolean>; stored?: Record<string, unknown>; now?: Date } = {}) {
  const stored: Record<string, unknown> = { ...(opts.stored ?? {}) };
  const settings = {
    define: () => ({
      get: async () => stored,
      setTenant: async (_t: string, patch: Record<string, unknown>) => Object.assign(stored, patch),
    }),
  } as unknown as SettingsService;
  const claims = new Set<string>();
  const dedupe: DedupePort = {
    claim: async (t, k) => (claims.has(`${t}|${k}`) ? false : (claims.add(`${t}|${k}`), true)),
    release: async (t, k) => void claims.delete(`${t}|${k}`),
  };
  const sent: SendInput[] = [];
  const notify = {
    send: async (i: SendInput) => {
      sent.push(i);
      return { logId: `log-${sent.length}`, status: "queued" as const };
    },
    preview: async () => ({ body: "", source: "builtin" as const }),
    log: async () => [],
  };
  const jobs = new Map<string, () => Promise<void>>();
  const remindable: (BookingNotice & { tenantId: string; createdAt: Date })[] = [];
  const reminded: { tenantId: string; days: number }[] = [];
  const m = createMessages({
    log: { info() {}, warn() {}, error() {} } as unknown as Logger,
    db: {} as never,
    settings,
    notify: notify as never,
    features: { isEnabled: async (_t, key) => opts.features?.[key] ?? true },
    auth: { getUser: async () => ({ phone: "+919800000000", email: null }) },
    shopName: async () => "Glow",
    storeUrl: async () => "https://glow.example/",
    defineJob: (name, h) => jobs.set(name, h),
    schedule: async () => undefined,
    engines: () => ({
      bookings: { remindable: async () => remindable } as never,
      memberships: {
        tenantsWithPlansEnding: async () => ["t1"],
        remindExpiring: async (tenantId: string, days: number) => (reminded.push({ tenantId, days }), 1),
        expiring: async () => [{ memberId: "m1", memberCode: "M-0004", name: "Chitra", phone: "9876500033", subscriptionId: "s4", planName: "Monthly", endDate: "2026-10-19", daysLeft: -2 }],
      } as never,
    }),
    dedupe,
    optOut: { optedOut: async () => false },
    now: () => opts.now ?? ist(11, 0),
  });
  return { m, sent, jobs, remindable, reminded, stored };
}

describe("createMessages ports", () => {
  it("booking confirmed → /booking/<token>; the store home when online booking is off; cancelled → /book", async () => {
    const h = harness();
    await h.m.bookings.booked("t1", notice);
    expect(h.sent[0]).toMatchObject({ channel: "whatsapp", to: "+919876543210", template: "booking.confirmed" });
    expect(h.sent[0]!.vars).toMatchObject({ shop: "Glow", link: "https://glow.example/booking/tok123", service: "Haircut, Beard trim" });
    await h.m.bookings.cancelled("t1", { ...notice, by: "customer", reason: null });
    expect(h.sent[1]!.vars?.link).toBe("https://glow.example/book");

    const off = harness({ features: { "bookings.online": false } });
    await off.m.bookings.booked("t1", notice);
    expect(off.sent[0]!.vars?.link).toBe("https://glow.example");
  });

  it("each reschedule to a new time is its own message; the same one twice is not", async () => {
    const h = harness();
    await h.m.bookings.rescheduled!("t1", { ...notice, previousStart: notice.start });
    await h.m.bookings.rescheduled!("t1", { ...notice, previousStart: notice.start });
    await h.m.bookings.rescheduled!("t1", { ...notice, start: ist(18, 0, 23), previousStart: notice.start });
    expect(h.sent.map((s) => s.template)).toEqual(["booking.rescheduled", "booking.rescheduled"]);
  });

  it("job cards: approval with the estimate and the tracking link; silent statuses send nothing", async () => {
    const h = harness();
    await h.m.jobcards.statusChanged("t1", { ...job, status: "diagnosed" });
    await h.m.jobcards.statusChanged("t1", job);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ template: "job.approval", vars: { amount: "Rs.1,770.00", link: "https://glow.example/job/trk" } });
  });

  it("memberships: welcome vs renewed; renewal reminders per item", async () => {
    const h = harness();
    const sold = { memberId: "m1", memberCode: "M-1", name: "Arun", phone: "9876500031", subscriptionId: "s1", planName: "Monthly", startDate: "2026-10-21", endDate: "2026-11-19" };
    await h.m.memberships.notify.sold("t1", { ...sold, renewal: false });
    await h.m.memberships.notify.sold("t1", { ...sold, subscriptionId: "s2", renewal: true });
    await h.m.memberships.reminders.expiring("t1", [{ ...sold, daysLeft: 3 }]);
    expect(h.sent.map((s) => s.template)).toEqual(["membership.welcome", "membership.renewed", "membership.renewal_due"]);
    expect(h.sent[0]!.vars).toMatchObject({ startDate: "21 Oct 2026", endDate: "19 Nov 2026", code: "M-1" });
  });

  it("orders: the owner's message goes straight through; customer ones follow the shop's channel, once", async () => {
    const h = harness({ stored: { events: { "order.shipped": { on: true, channel: "sms" } } } });
    const vars = { shop: "Anbu", customer: "Kumar", number: "ORD-7", tracking: "DTDC 123", link: "https://t" };
    await h.m.orderNotifier.send({ tenantId: "t1", channel: "whatsapp", to: "+919800000001", template: "order.received", vars });
    await h.m.orderNotifier.send({ tenantId: "t1", channel: "whatsapp", to: "+919876500044", template: "order.shipped", vars });
    await h.m.orderNotifier.send({ tenantId: "t1", channel: "whatsapp", to: "+919876500044", template: "order.shipped", vars });
    const r = await h.m.orderNotifier.send({ tenantId: "t1", channel: "email", to: "k@x.in", template: "order.shipped", vars });
    expect(h.sent.map((s) => `${s.template}/${s.channel}`)).toEqual(["order.received/whatsapp", "order.shipped/sms", "order.shipped/email"]);
    expect(r.logId).toBe("log-3");
  });

  it("orders: a switched-off event sends nothing and returns an empty log id", async () => {
    const h = harness({ stored: { events: { "order.placed": { on: false } } } });
    const r = await h.m.orderNotifier.send({ tenantId: "t1", channel: "whatsapp", to: "+919876500044", template: "order.placed", vars: { number: "ORD-8" } });
    expect(r).toEqual({ logId: "" });
    expect(h.sent).toHaveLength(0);
  });
});

describe("createMessages jobs", () => {
  it("registers the jobs", () => {
    expect([...harness().jobs.keys()].sort()).toEqual(["messages.abandoned-carts", "messages.booking-reminders", "messages.memberships", "messages.purge"]);
  });

  it("booking reminders follow each shop's lead time and send once per appointment time", async () => {
    const h = harness({ stored: { bookingReminderHours: 24 } });
    const at = ist(11, 0);
    h.remindable.push(
      { ...notice, appointmentId: "due", tenantId: "t1", start: new Date(at.getTime() + 20 * HOUR), createdAt: ist(9, 0, 18) },
      { ...notice, appointmentId: "later", tenantId: "t1", start: new Date(at.getTime() + 40 * HOUR), createdAt: ist(9, 0, 18) },
    );
    expect(await h.m.run.bookingReminders()).toEqual({ checked: 2, sent: 1 });
    expect(await h.m.run.bookingReminders()).toEqual({ checked: 2, sent: 0 });
    expect(h.sent.map((s) => s.template)).toEqual(["booking.reminder"]);
  });

  it("memberships: renewal reminders with the shop's days, expired notices once", async () => {
    const h = harness({ stored: { membershipRenewalDays: 5 } });
    expect(await h.m.run.memberships()).toEqual({ tenants: 1, reminded: 1, expired: 1 });
    expect(h.reminded).toEqual([{ tenantId: "t1", days: 5 }]);
    expect(await h.m.run.memberships()).toMatchObject({ expired: 0 });
    expect(h.sent.map((s) => s.template)).toEqual(["membership.expired"]);
  });

  it("nothing for a shop with the feature off", async () => {
    const h = harness({ features: { bookings: false, memberships: false } });
    h.remindable.push({ ...notice, tenantId: "t1", start: new Date(ist(11, 0).getTime() + 2 * HOUR), createdAt: ist(9, 0, 18) });
    await h.m.run.bookingReminders();
    expect(await h.m.run.memberships()).toEqual({ tenants: 1, reminded: 0, expired: 0 });
    expect(h.sent).toHaveLength(0);
  });
});
