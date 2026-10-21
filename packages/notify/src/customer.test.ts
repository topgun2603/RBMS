import { describe, expect, it } from "vitest";
import { composeMessage } from "./compose";
import {
  CUSTOMER_EVENT_KEYS,
  CustomerMessages,
  MESSAGES_SETTINGS_DEFAULTS,
  MESSAGES_SETTINGS_SCHEMA,
  dedupeKey,
  formatMessageDate,
  formatMessageTime,
  moneyText,
  planChannels,
  quietUntil,
  resolveMessagesSettings,
  sampleVars,
  toIndianE164,
  type DedupePort,
} from "./customer";
import { CUSTOMER_TEMPLATE_KEYS, CUSTOMER_TEMPLATES } from "./customer-templates";
import { ConsoleDriver } from "./drivers/console";
import { placeholders } from "./render";
import type { SendInput, SendResult } from "./service";
import { BUILTIN_TEMPLATES, pickTemplate } from "./templates";

/** 2026-10-21 at HH:MM IST. */
const ist = (hh: number, mm = 0, day = 21) => new Date(Date.UTC(2026, 9, day, hh, mm) - 330 * 60_000);

describe("customer message templates", () => {
  it("every customer event has a built-in template in en and ta on sms, whatsapp and email", () => {
    for (const key of CUSTOMER_EVENT_KEYS) {
      for (const channel of ["sms", "whatsapp", "email"] as const) {
        for (const locale of ["en", "ta"]) {
          const t = pickTemplate([], { tenantId: null, key, channel, locale });
          expect(t?.source, `${key} ${channel} ${locale}`).toBe("builtin");
          expect(t?.template.locale, `${key} ${channel} ${locale}`).toBe(locale);
          if (channel === "email") expect(t?.template.subject, key).toBeTruthy();
        }
      }
    }
  });

  it("starts with the shop, keeps English SMS ASCII and Tamil in Tamil, with the same variables in both", () => {
    for (const key of CUSTOMER_TEMPLATE_KEYS) {
      const { en, ta } = CUSTOMER_TEMPLATES[key]!;
      expect(en.body.startsWith("{{shop}}:"), key).toBe(true);
      expect(ta.body.startsWith("{{shop}}:"), key).toBe(true);
      expect(/^[\x20-\x7E]*$/.test(en.body), `${key} ASCII`).toBe(true);
      expect(/[஀-௿]/.test(ta.body), `${key} Tamil`).toBe(true);
      expect(placeholders(ta.body).sort(), key).toEqual(placeholders(en.body).sort());
      expect(en.body.length, `${key} short`).toBeLessThanOrEqual(240);
    }
  });

  it("links the store pages: /booking/<token>, /job/<token>, the cart", () => {
    for (const k of ["booking.confirmed", "booking.rescheduled", "booking.reminder", "job.received", "job.ready", "cart.abandoned"]) {
      expect(CUSTOMER_TEMPLATES[k]!.en.body, k).toContain("{{link}}");
    }
    expect(sampleVars("booking.confirmed", "en", "Glow").link).toMatch(/\/booking\//);
    expect(sampleVars("job.ready", "en", "Quickfix").link).toMatch(/\/job\//);
    expect(sampleVars("cart.abandoned", "en", "Anbu").link).toMatch(/\/cart$/);
  });

  it("renders the variables (EN and TA) and leaves no placeholder behind for the sample values", () => {
    for (const key of CUSTOMER_EVENT_KEYS) {
      for (const locale of ["en", "ta"] as const) {
        const t = pickTemplate([], { tenantId: null, key, channel: "whatsapp", locale })!.template;
        const msg = composeMessage({ channel: "whatsapp", to: "+919876543210", template: t, vars: sampleVars(key, locale, "Glow Salon"), locale, config: {} });
        expect(msg.body, `${key} ${locale}`).not.toMatch(/\{\{|\}\}/);
        expect(msg.body.startsWith("Glow Salon:"), key).toBe(true);
        for (const p of placeholders(t.body)) expect(sampleVars(key, locale, "x")[p], `${key} sample ${p}`).toBeTruthy();
      }
    }
    const t = pickTemplate([], { tenantId: null, key: "job.ready", channel: "sms", locale: "en" })!.template;
    const msg = composeMessage({
      channel: "sms",
      to: "+919876543210",
      template: t,
      vars: { shop: "Quickfix", customer: "Ravi", number: "JC-0007", amount: moneyText(150000), link: "https://quickfix.example/job/abc" },
      locale: "en",
      config: {},
    });
    expect(msg.body).toBe("Quickfix: Dear Ravi, your job JC-0007 is ready for pickup. Amount due: Rs.1,500.00. Details: https://quickfix.example/job/abc");
  });

  it("an approved WhatsApp template maps the variables in body order", () => {
    const t = pickTemplate([], { tenantId: null, key: "booking.reminder", channel: "whatsapp", locale: "ta" })!.template;
    const msg = composeMessage({
      channel: "whatsapp",
      to: "+919876543210",
      template: t,
      vars: sampleVars("booking.reminder", "ta", "Glow"),
      locale: "ta",
      config: { whatsapp: { token: "x", phoneNumberId: "1", templates: { "booking.reminder": { name: "booking_reminder" } } } },
    });
    expect(msg.templateRef?.name).toBe("booking_reminder");
    expect(msg.templateRef?.language).toBe("ta");
    expect(msg.templateRef?.params[0]).toBe("Glow");
  });

  it("built-ins carry no duplicate key/channel/locale", () => {
    const seen = new Set<string>();
    for (const t of BUILTIN_TEMPLATES) {
      const id = `${t.key}|${t.channel}|${t.locale}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
    }
  });
});

describe("formatting", () => {
  it("dates, times and money in IST", () => {
    expect(formatMessageDate(ist(16, 30), "en")).toBe("21 Oct 2026");
    expect(formatMessageDate("2026-10-25", "en")).toBe("25 Oct 2026");
    expect(formatMessageDate("2026-10-25", "ta")).toMatch(/25/);
    expect(formatMessageTime(ist(16, 30))).toBe("4:30 PM");
    expect(formatMessageTime(ist(9, 5))).toBe("9:05 AM");
    expect(moneyText(123450)).toBe("Rs.1,234.50");
    expect(moneyText(0)).toBe("Rs.0.00");
  });

  it("normalises Indian mobiles", () => {
    expect(toIndianE164("98765 43210")).toBe("+919876543210");
    expect(toIndianE164("+91 98765-43210")).toBe("+919876543210");
    expect(toIndianE164("12345")).toBeNull();
    expect(toIndianE164(null)).toBeNull();
  });
});

describe("messages settings", () => {
  it("defaults: every event on, on WhatsApp; 24 h booking reminder, 3 days renewal, 4 h cart", () => {
    const s = resolveMessagesSettings(undefined);
    expect(s).toEqual(MESSAGES_SETTINGS_DEFAULTS);
    for (const k of CUSTOMER_EVENT_KEYS) expect(s.events[k]).toEqual({ on: true, channel: "whatsapp" });
    expect([s.bookingReminderHours, s.membershipRenewalDays, s.abandonedCartHours]).toEqual([24, 3, 4]);
  });

  it("fills missing events and drops invalid values", () => {
    const s = resolveMessagesSettings({
      language: "ta",
      bookingReminderHours: 500,
      membershipRenewalDays: 5,
      events: { "job.ready": { channel: "both" }, "booking.reminder": { on: false }, "booking.cancelled": { on: "no", channel: "fax" } },
    });
    expect(s.language).toBe("ta");
    expect(s.bookingReminderHours).toBe(24);
    expect(s.membershipRenewalDays).toBe(5);
    expect(s.events["job.ready"]).toEqual({ on: true, channel: "both" });
    expect(s.events["booking.reminder"]).toEqual({ on: false, channel: "whatsapp" });
    expect(s.events["booking.cancelled"]).toEqual({ on: true, channel: "whatsapp" });
    expect(s.events["order.shipped"]).toEqual({ on: true, channel: "whatsapp" });
  });

  it("the schema accepts the defaults and a partial events patch", () => {
    expect(MESSAGES_SETTINGS_SCHEMA.safeParse(MESSAGES_SETTINGS_DEFAULTS).success).toBe(true);
    expect(MESSAGES_SETTINGS_SCHEMA.partial().safeParse({ events: { "job.ready": { channel: "sms" } } }).success).toBe(true);
    expect(MESSAGES_SETTINGS_SCHEMA.partial().safeParse({ abandonedCartHours: 0 }).success).toBe(false);
  });
});

describe("quiet hours (21:00–08:00 IST)", () => {
  it("sends now during the day", () => {
    expect(quietUntil(ist(8, 0))).toBeNull();
    expect(quietUntil(ist(13, 0))).toBeNull();
    expect(quietUntil(ist(20, 59))).toBeNull();
  });
  it("holds evening messages until 08:00 the next morning", () => {
    expect(quietUntil(ist(21, 0))?.toISOString()).toBe(ist(8, 0, 22).toISOString());
    expect(quietUntil(ist(23, 45))?.toISOString()).toBe(ist(8, 0, 22).toISOString());
  });
  it("holds early-morning messages until 08:00 the same day", () => {
    expect(quietUntil(ist(0, 10))?.toISOString()).toBe(ist(8, 0).toISOString());
    expect(quietUntil(ist(7, 59))?.toISOString()).toBe(ist(8, 0).toISOString());
  });
});

describe("planChannels", () => {
  const base = { phone: "+919876543210", email: "a@b.in", emailOn: true, optedOut: false, marketing: false };
  it("follows the event's channel and adds email when known", () => {
    expect(planChannels({ ...base, setting: { on: true, channel: "whatsapp" } }).channels).toEqual(["whatsapp", "email"]);
    expect(planChannels({ ...base, setting: { on: true, channel: "both" }, emailOn: false }).channels).toEqual(["whatsapp", "sms"]);
    expect(planChannels({ ...base, setting: { on: true, channel: "sms" }, email: null })).toEqual({ channels: ["sms"], skipped: [] });
    expect(planChannels({ ...base, setting: { on: true, channel: "sms" }, phone: null }).skipped).toEqual([{ channel: "sms", reason: "no_contact" }]);
  });
  it("an event switched off sends nothing", () => {
    const p = planChannels({ ...base, setting: { on: false, channel: "both" } });
    expect(p.channels).toEqual([]);
    expect(p.skipped.every((s) => s.reason === "off")).toBe(true);
  });
  it("opt-out stops WhatsApp (SMS stays for service notices) and every channel for promotional ones", () => {
    expect(planChannels({ ...base, optedOut: true, setting: { on: true, channel: "both" }, emailOn: false }).channels).toEqual(["sms"]);
    expect(planChannels({ ...base, optedOut: true, marketing: true, setting: { on: true, channel: "both" } }).channels).toEqual([]);
  });
  it("`only` restricts to the orders module's target", () => {
    expect(planChannels({ ...base, only: ["whatsapp", "sms"], setting: { on: true, channel: "sms" } }).channels).toEqual(["sms"]);
    expect(planChannels({ ...base, only: ["email"], setting: { on: true, channel: "both" } }).channels).toEqual(["email"]);
  });
});

/** An in-memory dedupe store and a notify fake that renders through the real templates and the console driver. */
function harness(opts: { settings?: Record<string, unknown>; now?: Date; optedOut?: string[] } = {}) {
  const claims = new Set<string>();
  const dedupe: DedupePort = {
    claim: async (t, k) => (claims.has(`${t}|${k}`) ? false : (claims.add(`${t}|${k}`), true)),
    release: async (t, k) => void claims.delete(`${t}|${k}`),
  };
  const lines: { obj: Record<string, unknown>; msg?: string }[] = [];
  const logger = { info: (obj: unknown, msg?: string) => lines.push({ obj: obj as Record<string, unknown>, msg }), warn() {}, error() {} };
  const sent: (SendInput & { body: string })[] = [];
  const notify = {
    send: async (input: SendInput): Promise<SendResult> => {
      const t = pickTemplate([], { tenantId: input.tenantId ?? null, key: input.template!, channel: input.channel, locale: input.locale ?? "en" });
      if (!t) throw new Error(`no template ${input.template}`);
      const msg = composeMessage({ channel: input.channel, to: input.to, template: t.template, vars: input.vars ?? {}, locale: t.template.locale, config: {} });
      if (!input.sendAt) await new ConsoleDriver(input.channel, logger).send(msg);
      sent.push({ ...input, body: msg.body });
      return { logId: `log-${sent.length}`, status: input.sendAt ? "queued" : "sent" };
    },
  };
  const messages = new CustomerMessages({
    notify,
    settings: { get: async () => opts.settings ?? {} },
    dedupe,
    optOut: { optedOut: async (_t, phone) => (opts.optedOut ?? []).includes(phone) },
    shopName: async () => "Glow Salon",
    now: () => opts.now ?? ist(11, 0),
    log: logger,
  });
  return { messages, sent, lines, claims };
}

describe("CustomerMessages (console driver)", () => {
  const booking = {
    tenantId: "t1",
    event: "booking.confirmed" as const,
    ref: "appt-1",
    to: { phone: "98765 43210" },
    vars: { customer: "Priya", number: "3", service: "Haircut", staff: "Anu", date: "22 Oct 2026", time: "4:30 PM", link: "https://glow.example/booking/tok" },
  };

  it("sends the rendered message to the console driver and logs it", async () => {
    const h = harness();
    const r = await h.messages.send(booking);
    expect(r).toEqual([{ channel: "whatsapp", status: "sent", logId: "log-1", to: "+91******3210" }]);
    expect(h.sent[0]!.to).toBe("+919876543210");
    expect(h.sent[0]!.body).toBe(
      "Glow Salon: Dear Priya, your booking #3 for Haircut with Anu on 22 Oct 2026 at 4:30 PM is confirmed. View or cancel: https://glow.example/booking/tok",
    );
    expect(h.lines.some((l) => l.msg === "[notify:console] whatsapp → +919876543210")).toBe(true);
    expect(h.lines.some((l) => l.msg === "messages: booking.confirmed")).toBe(true);
  });

  it("never sends the same event for the same entity twice", async () => {
    const h = harness({ settings: { events: { "booking.confirmed": { channel: "both" } } } });
    await h.messages.send(booking);
    const again = await h.messages.send(booking);
    expect(h.sent.map((s) => s.channel)).toEqual(["whatsapp", "sms"]);
    expect(again.map((x) => x.reason)).toEqual(["duplicate", "duplicate"]);
    expect(h.claims.has(`t1|${dedupeKey("booking.confirmed", "appt-1", "sms")}`)).toBe(true);
    // Another entity (or event) still goes out.
    await h.messages.send({ ...booking, ref: "appt-2" });
    expect(h.sent).toHaveLength(4);
  });

  it("holds phone messages during quiet hours and queues them for 08:00 IST", async () => {
    const h = harness({ now: ist(22, 15) });
    const r = await h.messages.send(booking);
    expect(r[0]).toMatchObject({ status: "queued", sendAt: ist(8, 0, 22).toISOString() });
    expect(h.sent[0]!.sendAt?.toISOString()).toBe(ist(8, 0, 22).toISOString());
  });

  it("email is not held for quiet hours", async () => {
    const h = harness({ now: ist(22, 15) });
    await h.messages.send({ ...booking, to: { phone: null, email: "priya@example.in" } });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ channel: "email", to: "priya@example.in" });
    expect(h.sent[0]!.sendAt).toBeUndefined();
  });

  it("respects the shop switch, the language and opt-out", async () => {
    const off = harness({ settings: { events: { "booking.confirmed": { on: false } } } });
    expect((await off.messages.send(booking))[0]).toMatchObject({ status: "skipped", reason: "off" });
    expect(off.sent).toHaveLength(0);

    const ta = harness({ settings: { language: "ta" } });
    await ta.messages.send({ ...booking, vars: ({ locale }) => ({ ...booking.vars, staff: locale === "ta" ? "அனு" : "Anu" }) });
    expect(ta.sent[0]!.locale).toBe("ta");
    expect(ta.sent[0]!.body).toContain("அனு உடன்");

    const stop = harness({ optedOut: ["+919876543210"] });
    expect((await stop.messages.send(booking))[0]).toMatchObject({ channel: "whatsapp", status: "skipped", reason: "opted_out" });
    expect((await stop.messages.send({ ...booking, event: "cart.abandoned", ref: "cart-1", vars: { count: 2, link: "x" } })).every((x) => x.status === "skipped")).toBe(true);
  });

  it("frees the claim when the send fails so a retry can send", async () => {
    const h = harness();
    const r = await h.messages.send({ ...booking, event: "booking.cancelled", ref: "a9", to: { phone: "9876543210" }, vars: {} });
    expect(r[0]!.status).toBe("sent");
    const failing = new CustomerMessages({
      notify: { send: async () => Promise.reject(new Error("down")) },
      settings: { get: async () => ({}) },
      dedupe: { claim: async () => true, release: async () => void h.claims.add("released") },
    });
    expect((await failing.send(booking))[0]).toMatchObject({ status: "failed", reason: "error" });
    expect(h.claims.has("released")).toBe(true);
  });

  it("no phone: nothing sent, nothing claimed", async () => {
    const h = harness();
    const r = await h.messages.send({ ...booking, to: { phone: "abc" } });
    expect(r).toEqual([{ channel: "whatsapp", status: "skipped", reason: "no_contact" }]);
    expect(h.claims.size).toBe(0);
  });

  it("sendTest uses the real template with sample values, outside dedupe and quiet hours", async () => {
    const h = harness({ now: ist(23, 0) });
    const r1 = await h.messages.sendTest({ tenantId: "t1", userId: "u1", event: "job.ready", phone: "9876543210", email: null });
    const r2 = await h.messages.sendTest({ tenantId: "t1", userId: "u1", event: "job.ready", phone: "9876543210", email: null });
    expect([r1[0]!.status, r2[0]!.status]).toEqual(["sent", "sent"]);
    expect(h.sent[0]!.body).toMatch(/^Glow Salon: Dear Raja, your job JC-0012 is ready/);
    expect((await h.messages.sendTest({ tenantId: "t1", userId: "u1", event: "job.ready", phone: null, email: null, channel: "email" }))[0]!.reason).toBe("no_contact");
  });
});
