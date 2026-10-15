import { describe, expect, it } from "vitest";
import { activeTypers, groupMessages, mergeById, readState } from "./grouping";
import { cleanTags, parsePhoneList } from "./format";
import { fillReply, loadSavedReplies, removeReply, storeSavedReplies, upsertReply, type KeyValueStore } from "./saved-replies";
import { durationParts, minutesToDue, nextStatuses, slaState } from "./sla";
import { defaultMapping, fillPlaceholders, mappedValues, placeholders, previewTemplate, setSourceKind, templateSlots, unmappedSlots } from "./templates";
import { dayRelation, hoursMinutes, istDayKey, istLocalToIso, isoToIstLocal } from "./time";
import type { Ticket, WaTemplateComponent } from "./types";
import { canSendFreeForm, countdownInterval, sessionWindow } from "./window";

const msg = (id: string, senderId: string, createdAt: string) => ({ id, senderId, createdAt });

describe("message grouping and day separators", () => {
  const now = new Date("2026-10-15T10:00:00+05:30");

  it("puts a separator on every IST day change and groups runs by sender", () => {
    const items = groupMessages(
      [
        msg("1", "a", "2026-10-14T23:50:00+05:30"),
        msg("2", "a", "2026-10-14T23:52:00+05:30"),
        // 18:35 UTC on the 14th is already the 15th in India.
        msg("3", "a", "2026-10-14T18:35:00Z"),
        msg("4", "me", "2026-10-15T00:06:00+05:30"),
        msg("5", "me", "2026-10-15T00:07:00+05:30"),
        msg("6", "a", "2026-10-15T00:08:00+05:30"),
      ],
      { myId: "me", now },
    );
    expect(items.map((i) => (i.kind === "day" ? `day:${i.day}:${i.relation}` : `${i.senderId}:${i.messages.map((m) => m.id).join(",")}:${i.mine}`))).toEqual([
      "day:2026-10-14:yesterday",
      "a:1,2:false",
      "day:2026-10-15:today",
      "a:3:false",
      "me:4,5:true",
      "a:6:false",
    ]);
  });

  it("starts a new group after a long pause from the same sender", () => {
    const items = groupMessages([msg("1", "a", "2026-10-15T09:00:00+05:30"), msg("2", "a", "2026-10-15T09:04:00+05:30"), msg("3", "a", "2026-10-15T09:20:00+05:30")], {
      myId: null,
      now,
    });
    expect(items.filter((i) => i.kind === "group").map((g) => (g.kind === "group" ? g.messages.length : 0))).toEqual([2, 1]);
  });

  it("labels older days by date", () => {
    expect(dayRelation("2026-10-10T12:00:00+05:30", now)).toBe("date");
    expect(istDayKey("2026-10-14T20:00:00Z")).toBe("2026-10-15");
  });

  it("merges pages by id (later copies win) in time order", () => {
    const a = [{ id: "x", createdAt: "2026-10-15T09:00:00Z", v: 1 }];
    const b = [
      { id: "y", createdAt: "2026-10-15T08:00:00Z", v: 1 },
      { id: "x", createdAt: "2026-10-15T09:00:00Z", v: 2 },
    ];
    expect(mergeById(a, b)).toEqual([b[0], b[1]]);
  });

  it("shows read ticks once another participant read past the message, and typing for 5 s", () => {
    const m = { senderId: "me", createdAt: "2026-10-15T09:00:00Z" };
    expect(readState(m, [{ userId: "me", lastReadAt: "2026-10-15T09:10:00Z" }, { userId: "b", lastReadAt: "2026-10-15T08:59:00Z" }], "me")).toBe("sent");
    expect(readState(m, [{ userId: "b", lastReadAt: "2026-10-15T09:00:00Z" }], "me")).toBe("read");
    expect(activeTypers({ a: 1000, b: 9000, me: 9500 }, 10_000, "me")).toEqual(["b"]);
  });
});

describe("24 h window countdown", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("counts down from the last inbound message", () => {
    const w = sessionWindow("2026-10-15T02:30:00Z", now);
    expect(w.open).toBe(true);
    expect(w.tone).toBe("open");
    expect([w.hours, w.minutes]).toEqual([14, 30]);
    expect(w.expiresAt?.toISOString()).toBe("2026-10-16T02:30:00.000Z");
  });

  it("turns amber in the last two hours, closes at 24 h, and never opens without an inbound message", () => {
    const closing = sessionWindow("2026-10-14T13:15:00Z", now);
    expect([closing.tone, closing.hours, closing.minutes]).toEqual(["closing", 1, 15]);
    expect(sessionWindow("2026-10-14T12:00:00Z", now)).toMatchObject({ open: false, tone: "closed", remainingMs: 0 });
    expect(sessionWindow(null, now).tone).toBe("never");
    // rounds up partial minutes so "0 min left" never shows while still open
    expect(hoursMinutes(30_000)).toEqual({ hours: 0, minutes: 1 });
  });

  it("blocks free-form for customers who opted out after writing, and ticks faster near the end", () => {
    expect(canSendFreeForm({ lastInboundAt: "2026-10-15T11:00:00Z", optedOutAt: null }, now)).toBe(true);
    expect(canSendFreeForm({ lastInboundAt: "2026-10-15T11:00:00Z", optedOutAt: "2026-10-15T11:01:00Z" }, now)).toBe(false);
    expect(canSendFreeForm({ lastInboundAt: "2026-10-15T11:00:00Z", optedOutAt: "2026-10-01T00:00:00Z" }, now)).toBe(true);
    expect(countdownInterval(4 * 60_000)).toBe(15_000);
    expect(countdownInterval(3 * 3_600_000)).toBe(60_000);
  });
});

describe("template variables", () => {
  const components: WaTemplateComponent[] = [
    { type: "HEADER", format: "TEXT", text: "Hi {{1}}" },
    { type: "BODY", text: "Your bill of {{2}} is due on {{3}}. Thanks {{1}}!" },
    { type: "FOOTER", text: "Reply STOP to opt out" },
    { type: "BUTTONS", buttons: [{ type: "URL", text: "Pay", url: "https://pay.example/{{1}}" }, { type: "COPY_CODE", text: "Copy code" }] },
  ];

  it("finds slots like the server", () => {
    expect(placeholders("{{2}} {{10}} {{1}} {{2}}")).toEqual(["1", "2", "10"]);
    expect(placeholders("{{name}} {{amount}}")).toEqual(["name", "amount"]);
    expect(templateSlots(components).map((s) => s.slot)).toEqual(["header.1", "body.1", "body.2", "body.3", "button.0.1", "button.1.code"]);
    expect(templateSlots([{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "x" }])).toEqual([]);
  });

  it("previews with the values filled in and reports missing slots", () => {
    const p = previewTemplate({ components }, { "header.1": "Ravi", "body.1": "Ravi", "body.2": "₹1,250\n" });
    expect(p.header).toBe("Hi Ravi");
    expect(p.body).toBe("Your bill of ₹1,250 is due on {{3}}. Thanks Ravi!");
    expect(p.footer).toBe("Reply STOP to opt out");
    expect(p.missing).toEqual(["body.3", "button.0.1", "button.1.code"]);
    expect(previewTemplate({ components: [{ type: "HEADER", format: "IMAGE" }] }, {}).missing).toEqual(["header.media"]);
    expect(fillPlaceholders("{{a}}-{{b}}", { a: "1", b: "" })).toBe("1-{{b}}");
  });

  it("maps campaign variables per recipient", () => {
    const slots = templateSlots(components);
    const mapping = defaultMapping(slots);
    expect(mapping.params["body.1"]).toEqual({ from: "name", fallback: "Customer" });
    expect(mapping.params["body.2"]).toEqual({ from: "var", key: "2" });
    const custom = setSourceKind(setSourceKind(mapping, slots[3]!, "text"), slots[0]!, "phone");
    expect(custom.params["body.3"]).toEqual({ from: "text", value: "" });
    expect(unmappedSlots(slots, custom)).toEqual(["body.3"]);
    const values = mappedValues(slots, { params: { ...custom.params, "body.3": { from: "text", value: "20 Oct" } } }, { phone: "+919876543210", name: null, variables: { "2": "₹500" } });
    expect(values).toMatchObject({ "header.1": "+919876543210", "body.1": "Customer", "body.2": "₹500", "body.3": "20 Oct" });
    expect(values["button.1.code"]).toBeUndefined();
  });
});

describe("SLA badge", () => {
  const base: Pick<Ticket, "status" | "firstResponseAt" | "slaDueAt" | "mergedIntoId" | "slaBreached" | "createdAt"> = {
    status: "open",
    firstResponseAt: null,
    slaDueAt: "2026-10-15T12:00:00Z",
    mergedIntoId: null,
    slaBreached: false,
    createdAt: "2026-10-14T12:00:00Z",
  };

  it("is overdue past the deadline, due soon within 2 h, else on track", () => {
    expect(slaState(base, new Date("2026-10-15T12:01:00Z"))).toBe("overdue");
    expect(slaState(base, new Date("2026-10-15T10:30:00Z"))).toBe("due_soon");
    expect(slaState(base, new Date("2026-10-15T08:00:00Z"))).toBe("on_track");
    // short SLA (2 h urgent): "soon" is the last quarter, not the whole window
    const urgent = { ...base, createdAt: "2026-10-15T10:00:00Z" };
    expect(slaState(urgent, new Date("2026-10-15T10:30:00Z"))).toBe("on_track");
    expect(slaState(urgent, new Date("2026-10-15T11:40:00Z"))).toBe("due_soon");
  });

  it("reports met/missed after the first reply and nothing for merged or finished tickets", () => {
    expect(slaState({ ...base, firstResponseAt: "2026-10-15T11:00:00Z" })).toBe("met");
    expect(slaState({ ...base, firstResponseAt: "2026-10-15T13:00:00Z" })).toBe("missed");
    expect(slaState({ ...base, firstResponseAt: "2026-10-15T11:00:00Z", slaBreached: true })).toBe("missed");
    expect(slaState({ ...base, mergedIntoId: "x" })).toBe("none");
    expect(slaState({ ...base, status: "resolved" }, new Date("2026-10-16T00:00:00Z"))).toBe("none");
    expect(slaState({ ...base, slaDueAt: null })).toBe("none");
  });

  it("formats the time to the deadline and mirrors the status machine", () => {
    expect(minutesToDue("2026-10-15T12:00:00Z", new Date("2026-10-15T10:45:00Z"))).toBe(75);
    expect(durationParts(-1565)).toEqual({ d: 1, h: 2, m: 5 });
    expect(nextStatuses("open")).toEqual(["pending", "resolved", "closed"]);
    expect(nextStatuses("closed")).toEqual([]);
  });
});

describe("saved replies", () => {
  const store = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  it("are stored per user, newest first, and survive bad data", () => {
    const s = store();
    let list = upsertReply([], { title: " Thanks ", body: "Thanks {name}, ticket {ticket}." }, new Date("2026-10-15T00:00:00Z"));
    list = upsertReply(list, { title: "Refund", body: "Refund started." });
    expect(storeSavedReplies("u1", list, s)).toBe(true);
    expect(loadSavedReplies("u1", s).map((r) => r.title)).toEqual(["Refund", "Thanks"]);
    expect(loadSavedReplies("u2", s)).toEqual([]);
    s.data.set("sr_inbox_saved_replies:u3", "{not json");
    expect(loadSavedReplies("u3", s)).toEqual([]);
    const id = list[1]!.id;
    expect(upsertReply(list, { id, title: "Thanks!", body: "x" })[0]!.title).toBe("Thanks!");
    expect(removeReply(list, id)).toHaveLength(1);
    expect(fillReply("Thanks {name}, ticket {ticket}. {other}", { name: "Ravi", ticket: "TKT-0007" })).toBe("Thanks Ravi, ticket TKT-0007. {other}");
    expect(fillReply("Hi {name}", { name: "" })).toBe("Hi {name}");
  });

  it("falls back when storage throws", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSavedReplies("u1", broken)).toEqual([]);
    expect(storeSavedReplies("u1", [], broken)).toBe(false);
  });
});

describe("helpers", () => {
  it("parses pasted phone lists with an optional header for variables", () => {
    expect(parsePhoneList("98765 43210, Ravi\n12\n+91 91234 56789")).toEqual({
      items: [{ phone: "98765 43210", name: "Ravi" }, { phone: "+91 91234 56789" }],
      skipped: 1,
    });
    expect(parsePhoneList("phone,name,amount\n9876543210,Ravi,₹500").items).toEqual([{ phone: "9876543210", name: "Ravi", variables: { amount: "₹500" } }]);
    expect(cleanTags([" VIP ", "vip", "new customer", ""])).toEqual(["vip", "new-customer"]);
  });

  it("converts the schedule picker's IST wall clock", () => {
    expect(istLocalToIso("2026-10-20T09:30")).toBe("2026-10-20T04:00:00.000Z");
    expect(isoToIstLocal("2026-10-20T04:00:00.000Z")).toBe("2026-10-20T09:30");
    expect(istLocalToIso("bad")).toBeNull();
  });
});
