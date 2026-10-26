import { tokenize } from "../assist/help";
import { istDate } from "./churn";
import type { PlatformTicketMessageRow, PlatformTicketRow, PlatformTicketStatus, TicketCategory, TicketTriage } from "./schema";

/**
 * Pure helpers of the RBMS support desk (Phase 7 part B). The status rules mirror a shop's own help desk
 * (packages/support/src/logic.ts) with the sides renamed: `open` = waiting on RBMS, `pending` = waiting on the shop.
 */

export const TICKET_PREFIX = "RBMS";
export const TICKET_LIMITS = { subject: 160, body: 4000, screen: 300, question: 400, reply: 6000 } as const;

/** 7 -> "RBMS-0007". */
export function ticketNumber(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`Bad ticket sequence: ${seq}`);
  return `${TICKET_PREFIX}-${String(seq).padStart(4, "0")}`;
}

export const PLATFORM_TICKET_TRANSITIONS: Readonly<Record<PlatformTicketStatus, readonly PlatformTicketStatus[]>> = {
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};
export const canMove = (from: PlatformTicketStatus, to: PlatformTicketStatus) => from === to || PLATFORM_TICKET_TRANSITIONS[from].includes(to);

/**
 * Status after a message. A shop reply puts a pending or resolved ticket back to `open`; an RBMS reply on an open ticket
 * moves it to `pending` unless a status was picked; a note changes nothing. Null = not allowed (a closed ticket takes
 * only RBMS notes).
 */
export function statusAfter(current: PlatformTicketStatus, author: "shop" | "rbms", kind: "reply" | "note", requested?: PlatformTicketStatus | null): PlatformTicketStatus | null {
  if (current === "closed") return author === "rbms" && kind === "note" ? "closed" : null;
  if (author === "shop") return kind === "reply" ? "open" : null;
  if (kind === "note") return requested && canMove(current, requested) ? requested : current;
  if (requested) return canMove(current, requested) ? requested : null;
  return current === "open" ? "pending" : current;
}

/** Plain text only: tags, control and bidi characters removed, blank lines squeezed. */
export function cleanText(s: string, max: number): string {
  return s
    .replace(/<[^>]*>/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

// ------------------------------------------------------------------ views

export interface ShopTicketView {
  id: string;
  number: string;
  subject: string;
  status: PlatformTicketStatus;
  unread: boolean;
  createdAt: Date;
  lastMessageAt: Date;
  requesterName: string | null;
  messages?: { id: string; from: "you" | "rbms"; authorName: string | null; body: string; createdAt: Date }[];
}

/** What the shop sees: its replies and ours. Never internal notes, the triage, the AI draft or the urgency. */
export function shopView(t: PlatformTicketRow, messages?: PlatformTicketMessageRow[]): ShopTicketView {
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    unread: t.shopUnread,
    createdAt: t.createdAt,
    lastMessageAt: t.lastMessageAt,
    requesterName: t.requesterName,
    ...(messages
      ? {
          messages: messages
            .filter((m) => m.kind === "reply" && m.authorKind !== "system")
            .map((m) => ({ id: m.id, from: m.authorKind === "rbms" ? ("rbms" as const) : ("you" as const), authorName: m.authorKind === "rbms" ? "RBMS support" : m.authorName, body: m.body, createdAt: m.createdAt })),
        }
      : {}),
  };
}

// ------------------------------------------------------------------ common problems

export interface ClusterInput {
  id: string;
  tenantId: string;
  number: string;
  subject: string;
  createdAt: Date;
  category: TicketCategory | null;
  triage: Pick<TicketTriage, "topic" | "summary"> | null;
}

export interface ProblemCluster {
  /** Monday of the IST week, YYYY-MM-DD. */
  week: string;
  category: TicketCategory | "other";
  /** The most common topic words of the group. */
  label: string;
  count: number;
  shops: number;
  tickets: { id: string; number: string; subject: string }[];
}

/** Monday (IST) of the week a moment falls in. */
export function weekOf(d: Date): string {
  const day = istDate(d);
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  return new Date(Date.parse(`${day}T00:00:00Z`) - dow * 86_400_000).toISOString().slice(0, 10);
}

const STOP = new Set(["not", "cannot", "can", "the", "and", "for", "with", "how", "why", "what", "when", "able", "working", "work", "problem", "issue", "help", "please", "need", "want", "shop", "rbms", "app"]);
const keyWords = (s: string) => [...new Set(tokenize(s, { expand: true }).filter((w) => w.length > 2 && !STOP.has(w)))];
const jaccard = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const inter = a.filter((x) => B.has(x)).length;
  return inter / (a.length + b.length - inter);
};

/**
 * "Common problems": tickets of the same week and category whose topic words overlap (Jaccard >= 0.34 on the topic and
 * subject words, single-link) form one group. Counted in code; the topic words come from the triage, else the subject.
 * Groups are sorted by week (newest first), then by how many shops reported them.
 */
export function clusterTickets(rows: ClusterInput[]): ProblemCluster[] {
  type G = { week: string; category: TicketCategory | "other"; words: string[]; items: ClusterInput[]; wordCount: Map<string, number> };
  const groups: G[] = [];
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const week = weekOf(r.createdAt);
    const category = r.category ?? "other";
    const words = keyWords(`${r.triage?.topic ?? ""} ${r.triage?.topic ?? ""} ${r.subject}`);
    const g = groups.find((x) => x.week === week && x.category === category && (jaccard(words, x.words) >= 0.34 || x.items.some((i) => jaccard(words, keyWords(`${i.triage?.topic ?? ""} ${i.subject}`)) >= 0.34)));
    const target = g ?? { week, category, words, items: [], wordCount: new Map<string, number>() };
    if (!g) groups.push(target);
    target.items.push(r);
    for (const w of words) target.wordCount.set(w, (target.wordCount.get(w) ?? 0) + 1);
    target.words = [...new Set([...target.words, ...words])];
  }
  return groups
    .map((g) => {
      const topic = g.items.map((i) => i.triage?.topic?.trim()).filter((x): x is string => !!x);
      const commonTopic = topic.sort((a, b) => topic.filter((t) => t === b).length - topic.filter((t) => t === a).length)[0];
      const label = commonTopic ?? [...g.wordCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w).join(" ");
      return {
        week: g.week,
        category: g.category,
        label: label || g.category,
        count: g.items.length,
        shops: new Set(g.items.map((i) => i.tenantId)).size,
        tickets: g.items.slice(-5).reverse().map((i) => ({ id: i.id, number: i.number, subject: i.subject })),
      };
    })
    .sort((a, b) => (a.week === b.week ? b.shops - a.shops || b.count - a.count : a.week < b.week ? 1 : -1));
}
