import { badRequest, conflict, notFound, type AuditPort } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, count, desc, eq, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { BREACH_REPORT_HOURS } from "./privacy-settings";
import { BREACH_SEVERITIES, BREACH_STATUSES, breachIncidents, type BreachIncidentRow } from "./schema";

export const BREACH_DATA_TYPES = ["phone", "email", "address", "purchases", "health", "id_documents", "payment", "staff", "credentials", "other"] as const;

/** Steps the owner ticks off. The order is the order they are usually done in. */
export const BREACH_CHECKLIST = ["contain", "preserve_evidence", "assess", "intimate_board", "notify_people", "report_board", "fix_cause", "review"] as const;
export type BreachChecklistKey = (typeof BREACH_CHECKLIST)[number];

export type BreachClock = "ok" | "due_soon" | "overdue" | "done";

export interface BreachCountdown {
  deadlineAt: string;
  /** Hours left (negative when late). Null once the Board report is filed. */
  hoursLeft: number | null;
  state: BreachClock;
}

/** The 72-hour clock: state "done" once the detailed report is filed; "due_soon" in the last 24 hours. */
export function breachCountdown(b: Pick<BreachIncidentRow, "boardDeadlineAt" | "boardReportedAt">, now: Date): BreachCountdown {
  if (b.boardReportedAt) return { deadlineAt: b.boardDeadlineAt.toISOString(), hoursLeft: null, state: "done" };
  const hoursLeft = Math.round(((b.boardDeadlineAt.getTime() - now.getTime()) / 3_600_000) * 10) / 10;
  return { deadlineAt: b.boardDeadlineAt.toISOString(), hoursLeft, state: hoursLeft < 0 ? "overdue" : hoursLeft <= 24 ? "due_soon" : "ok" };
}

export const boardDeadline = (discoveredAt: Date) => new Date(discoveredAt.getTime() + BREACH_REPORT_HOURS * 3_600_000);

export const breachInputSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).default(""),
  severity: z.enum(BREACH_SEVERITIES).default("medium"),
  occurredAt: z.coerce.date().optional().nullable(),
  discoveredAt: z.coerce.date().optional(),
  dataTypes: z.array(z.enum(BREACH_DATA_TYPES)).max(12).default([]),
  peopleAffected: z.number().int().min(0).max(100_000_000).nullable().optional(),
  containment: z.string().trim().max(4000).default(""),
  cause: z.string().trim().max(4000).default(""),
});
export const breachPatchSchema = breachInputSchema.partial().extend({
  status: z.enum(BREACH_STATUSES).optional(),
  peopleNotifiedNote: z.string().trim().max(2000).optional(),
});

export interface BreachDraftInput {
  shopName: string;
  title: string;
  description: string;
  dataTypes: string[];
  containment: string;
  contact: string;
  occurredAt: Date | null;
  discoveredAt: Date;
}

const TYPE_EN: Record<string, string> = {
  phone: "phone number",
  email: "email address",
  address: "address",
  purchases: "purchase history",
  health: "health or prescription details",
  id_documents: "identity documents",
  payment: "payment details",
  staff: "staff records",
  credentials: "sign-in details",
  other: "other personal details",
};
const TYPE_TA: Record<string, string> = {
  phone: "தொலைபேசி எண்",
  email: "மின்னஞ்சல் முகவரி",
  address: "முகவரி",
  purchases: "வாங்கிய வரலாறு",
  health: "உடல்நலம் அல்லது மருந்துச் சீட்டு விவரங்கள்",
  id_documents: "அடையாள ஆவணங்கள்",
  payment: "கட்டண விவரங்கள்",
  staff: "பணியாளர் பதிவுகள்",
  credentials: "உள்நுழைவு விவரங்கள்",
  other: "பிற தனிப்பட்ட விவரங்கள்",
};
const day = (d: Date) => d.toISOString().slice(0, 10);

export interface BreachDrafts {
  /** Message to affected people (DPDP Rules: what happened, what data, what we did, what you can do, who to contact). */
  people: { en: string; ta: string };
  /** Plain draft of the first intimation to the Data Protection Board; the Board's own portal form is what is filed. */
  board: { en: string; ta: string };
}

/** Draft texts only. Nothing is sent: the owner copies them. */
export function breachDrafts(i: BreachDraftInput): BreachDrafts {
  const en = i.dataTypes.length ? i.dataTypes.map((t) => TYPE_EN[t] ?? t).join(", ") : "some of your personal details";
  const ta = i.dataTypes.length ? i.dataTypes.map((t) => TYPE_TA[t] ?? t).join(", ") : "உங்கள் தனிப்பட்ட விவரங்களில் சில";
  const when = i.occurredAt ? day(i.occurredAt) : day(i.discoveredAt);
  const steps = i.containment || "We have secured the systems involved and are looking into the cause.";
  return {
    people: {
      en: [
        `Subject: Important notice about your personal data at ${i.shopName}`,
        "",
        "Dear customer,",
        `On ${day(i.discoveredAt)} we found that ${i.title.toLowerCase()}. This happened around ${when}.`,
        `The details that may be involved: ${en}.`,
        `What we have done: ${steps}`,
        "What you can do: be careful with calls or messages that ask for codes, passwords or payments; change any password you use with us; tell us if you see anything unusual.",
        `We are sorry. For questions, contact: ${i.contact}`,
      ].join("\n"),
      ta: [
        `பொருள்: ${i.shopName} இல் உங்கள் தனிப்பட்ட தரவு குறித்த முக்கிய அறிவிப்பு`,
        "",
        "அன்புள்ள வாடிக்கையாளருக்கு,",
        `${day(i.discoveredAt)} அன்று எங்கள் கவனத்துக்கு ஒரு சம்பவம் வந்தது: ${i.title}. இது சுமார் ${when} அன்று நடந்தது.`,
        `தொடர்புடைய விவரங்கள்: ${ta}.`,
        `நாங்கள் செய்தது: ${i.containment || "தொடர்புடைய அமைப்புகளைப் பாதுகாத்து, காரணத்தை ஆராய்ந்து வருகிறோம்."}`,
        "நீங்கள் செய்யக்கூடியது: குறியீடுகள், கடவுச்சொற்கள் அல்லது பணம் கேட்கும் அழைப்புகள், செய்திகளில் எச்சரிக்கையாக இருங்கள்; எங்களிடம் பயன்படுத்தும் கடவுச்சொல்லை மாற்றுங்கள்; வழக்கத்துக்கு மாறானதைக் கண்டால் எங்களிடம் சொல்லுங்கள்.",
        `வருந்துகிறோம். கேள்விகளுக்கு தொடர்பு கொள்ளுங்கள்: ${i.contact}`,
      ].join("\n"),
    },
    board: {
      en: [
        `Intimation of personal data breach: ${i.shopName}`,
        `Discovered: ${i.discoveredAt.toISOString()}  Occurred: ${i.occurredAt ? i.occurredAt.toISOString() : "not yet known"}`,
        `Nature of the breach: ${i.title}. ${i.description}`,
        `Data involved: ${en}`,
        `Measures taken: ${steps}`,
        `Contact: ${i.contact}`,
        "File the detailed report on the Board's portal within 72 hours of discovery (or the longer time the Board allows).",
      ].join("\n"),
      ta: [
        `தனிப்பட்ட தரவு மீறல் குறித்த தகவல்: ${i.shopName}`,
        `கண்டறிந்த நேரம்: ${i.discoveredAt.toISOString()}  நடந்த நேரம்: ${i.occurredAt ? i.occurredAt.toISOString() : "இன்னும் தெரியவில்லை"}`,
        `மீறலின் தன்மை: ${i.title}. ${i.description}`,
        `தொடர்புடைய தரவு: ${ta}`,
        `எடுத்த நடவடிக்கைகள்: ${i.containment || "—"}`,
        `தொடர்பு: ${i.contact}`,
        "கண்டறிந்த 72 மணி நேரத்துக்குள் (அல்லது வாரியம் அனுமதிக்கும் கூடுதல் நேரத்துக்குள்) வாரியத்தின் இணையதளத்தில் விரிவான அறிக்கையைச் சமர்ப்பிக்கவும்.",
      ].join("\n"),
    },
  };
}

export interface BreachView {
  id: string;
  tenantId: string | null;
  reference: string;
  title: string;
  description: string;
  severity: BreachIncidentRow["severity"];
  status: BreachIncidentRow["status"];
  occurredAt: string | null;
  discoveredAt: string;
  dataTypes: string[];
  peopleAffected: number | null;
  containment: string;
  cause: string;
  boardIntimatedAt: string | null;
  boardReportedAt: string | null;
  boardReference: string | null;
  peopleNotifiedAt: string | null;
  peopleNotifiedNote: string | null;
  checklist: Record<string, string>;
  closedAt: string | null;
  countdown: BreachCountdown;
  createdAt: string;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;
export const breachView = (b: BreachIncidentRow, now: Date): BreachView => ({
  id: b.id,
  tenantId: b.tenantId,
  reference: b.reference,
  title: b.title,
  description: b.description,
  severity: b.severity,
  status: b.status,
  occurredAt: iso(b.occurredAt),
  discoveredAt: b.discoveredAt.toISOString(),
  dataTypes: b.dataTypes,
  peopleAffected: b.peopleAffected,
  containment: b.containment,
  cause: b.cause,
  boardIntimatedAt: iso(b.boardIntimatedAt),
  boardReportedAt: iso(b.boardReportedAt),
  boardReference: b.boardReference,
  peopleNotifiedAt: iso(b.peopleNotifiedAt),
  peopleNotifiedNote: b.peopleNotifiedNote,
  checklist: b.checklist,
  closedAt: iso(b.closedAt),
  countdown: breachCountdown(b, now),
  createdAt: b.createdAt.toISOString(),
});

export class BreachService {
  constructor(private readonly deps: { db: Db; audit?: AuditPort }) {}

  private scope(tenantId: string | null): SQL {
    return tenantId ? eq(breachIncidents.tenantId, tenantId) : isNull(breachIncidents.tenantId);
  }

  /** `tenantId` null = the platform's own register. `all` (platform admins) lists every shop's incidents too. */
  async list(tenantId: string | null, opts: { all?: boolean; status?: string; now?: Date } = {}) {
    const now = opts.now ?? new Date();
    const where = and(opts.all ? undefined : this.scope(tenantId), opts.status ? eq(breachIncidents.status, opts.status as BreachIncidentRow["status"]) : undefined);
    const rows = await this.deps.db.select().from(breachIncidents).where(where).orderBy(desc(breachIncidents.discoveredAt)).limit(200);
    const items = rows.map((b) => breachView(b, now));
    return { items, openOverdue: items.filter((b) => b.status !== "closed" && b.countdown.state === "overdue").length };
  }

  async get(tenantId: string | null, id: string, now = new Date()) {
    return breachView(await this.row(tenantId, id), now);
  }

  async create(tenantId: string | null, input: z.input<typeof breachInputSchema>, actorId: string | null, now = new Date()) {
    const p = breachInputSchema.parse(input);
    const discoveredAt = p.discoveredAt ?? now;
    if (discoveredAt.getTime() > now.getTime() + 60_000) throw badRequest("The discovery time cannot be in the future");
    for (let attempt = 0; attempt < 3; attempt++) {
      const [{ n } = { n: 0 }] = await this.deps.db.select({ n: count() }).from(breachIncidents).where(this.scope(tenantId));
      const reference = `BR-${String(Number(n) + 1 + attempt).padStart(4, "0")}`;
      try {
        const [row] = await this.deps.db
          .insert(breachIncidents)
          .values({
            tenantId,
            reference,
            title: p.title,
            description: p.description,
            severity: p.severity,
            occurredAt: p.occurredAt ?? null,
            discoveredAt,
            boardDeadlineAt: boardDeadline(discoveredAt),
            dataTypes: p.dataTypes,
            peopleAffected: p.peopleAffected ?? null,
            containment: p.containment,
            cause: p.cause,
            createdBy: actorId,
          })
          .returning();
        await this.deps.audit?.record({ tenantId, actorUserId: actorId, action: "privacy.breach.create", entityType: "breach", entityId: row!.id, summary: `${reference} recorded: ${p.title}` });
        return breachView(row!, now);
      } catch (err) {
        const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code !== "23505") throw err;
      }
    }
    throw conflict("Could not number the incident, try again");
  }

  async update(tenantId: string | null, id: string, input: z.input<typeof breachPatchSchema>, actorId: string | null, now = new Date()) {
    const row = await this.row(tenantId, id);
    if (row.status === "closed") throw conflict("This incident is closed");
    const p = breachPatchSchema.parse(input);
    const set: Partial<typeof breachIncidents.$inferInsert> = {};
    if (p.title !== undefined) set.title = p.title;
    if (p.description !== undefined) set.description = p.description;
    if (p.severity !== undefined) set.severity = p.severity;
    if (p.occurredAt !== undefined) set.occurredAt = p.occurredAt;
    if (p.discoveredAt !== undefined) {
      set.discoveredAt = p.discoveredAt;
      set.boardDeadlineAt = boardDeadline(p.discoveredAt);
    }
    if (p.dataTypes !== undefined) set.dataTypes = p.dataTypes;
    if (p.peopleAffected !== undefined) set.peopleAffected = p.peopleAffected;
    if (p.containment !== undefined) set.containment = p.containment;
    if (p.cause !== undefined) set.cause = p.cause;
    if (p.peopleNotifiedNote !== undefined) set.peopleNotifiedNote = p.peopleNotifiedNote;
    if (p.status === "contained" || p.status === "open") set.status = p.status;
    const [upd] = await this.deps.db.update(breachIncidents).set(set).where(eq(breachIncidents.id, id)).returning();
    await this.deps.audit?.record({ tenantId, actorUserId: actorId, action: "privacy.breach.update", entityType: "breach", entityId: id, summary: `${row.reference} updated` });
    return breachView(upd!, now);
  }

  async tick(tenantId: string | null, id: string, key: string, done: boolean, actorId: string | null, now = new Date()) {
    if (!(BREACH_CHECKLIST as readonly string[]).includes(key)) throw badRequest("Unknown checklist step");
    const row = await this.row(tenantId, id);
    const checklist = { ...row.checklist };
    if (done) checklist[key] = now.toISOString();
    else delete checklist[key];
    const [upd] = await this.deps.db.update(breachIncidents).set({ checklist }).where(eq(breachIncidents.id, id)).returning();
    await this.deps.audit?.record({ tenantId, actorUserId: actorId, action: "privacy.breach.checklist", entityType: "breach", entityId: id, summary: `${row.reference}: ${key} ${done ? "done" : "undone"}` });
    return breachView(upd!, now);
  }

  /** Records that the first intimation or the detailed report went to the Board (by the owner, on the Board's portal). */
  async markBoard(tenantId: string | null, id: string, stage: "intimation" | "report", reference: string | null, actorId: string | null, at: Date = new Date()) {
    const row = await this.row(tenantId, id);
    const set: Partial<typeof breachIncidents.$inferInsert> = {};
    const checklist = { ...row.checklist };
    if (stage === "intimation") {
      set.boardIntimatedAt = at;
      checklist.intimate_board = at.toISOString();
    } else {
      set.boardReportedAt = at;
      set.status = "reported";
      if (!row.boardIntimatedAt) set.boardIntimatedAt = at;
      checklist.report_board = at.toISOString();
    }
    if (reference) set.boardReference = reference.slice(0, 100);
    set.checklist = checklist;
    const [upd] = await this.deps.db.update(breachIncidents).set(set).where(eq(breachIncidents.id, id)).returning();
    await this.deps.audit?.record({ tenantId, actorUserId: actorId, action: `privacy.breach.board_${stage}`, entityType: "breach", entityId: id, summary: `${row.reference}: Board ${stage} recorded` });
    return breachView(upd!, at);
  }

  async markPeopleNotified(tenantId: string | null, id: string, note: string | null, actorId: string | null, at = new Date()) {
    const row = await this.row(tenantId, id);
    const checklist = { ...row.checklist, notify_people: at.toISOString() };
    const [upd] = await this.deps.db.update(breachIncidents).set({ peopleNotifiedAt: at, peopleNotifiedNote: note, checklist }).where(eq(breachIncidents.id, id)).returning();
    await this.deps.audit?.record({ tenantId, actorUserId: actorId, action: "privacy.breach.people_notified", entityType: "breach", entityId: id, summary: `${row.reference}: affected people informed` });
    return breachView(upd!, at);
  }

  async close(tenantId: string | null, id: string, actorId: string | null, now = new Date()) {
    const row = await this.row(tenantId, id);
    if (!row.boardReportedAt) throw conflict("File the report to the Board first (or note it) before closing");
    const [upd] = await this.deps.db.update(breachIncidents).set({ status: "closed", closedAt: now }).where(eq(breachIncidents.id, id)).returning();
    await this.deps.audit?.record({ tenantId, actorUserId: actorId, action: "privacy.breach.close", entityType: "breach", entityId: id, summary: `${row.reference} closed` });
    return breachView(upd!, now);
  }

  async rowFor(tenantId: string | null, id: string) {
    return this.row(tenantId, id);
  }

  private async row(tenantId: string | null, id: string) {
    const [row] = await this.deps.db.select().from(breachIncidents).where(and(eq(breachIncidents.id, id), this.scope(tenantId))).limit(1);
    if (!row) throw notFound("Incident");
    return row;
  }
}
