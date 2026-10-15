/** Pure help-centre helpers: FAQPage JSON-LD, instant FAQ filtering, ticket status tones. */
import { plainText, truncate, type JsonLd } from "@srirealtime/cms/seo";
import type { FaqGroup, TicketStatus } from "../types";

export interface FaqEntry {
  question: string;
  /** Markdown answer. */
  answer: string;
  /** Absolute or site-relative URL of the article. */
  url?: string;
}

/**
 * schema.org FAQPage for a list of questions (https://developers.google.com/search/docs/appearance/structured-data/faqpage).
 * Answers are plain text (markdown stripped), at most 1500 characters each. Null when there is nothing to describe.
 */
export function faqPageJsonLd(entries: readonly FaqEntry[]): JsonLd | null {
  const main = entries
    .map((e) => ({ q: e.question.trim(), a: truncate(plainText(e.answer), 1500), url: e.url }))
    .filter((e) => e.q && e.a)
    .map((e) => ({
      "@type": "Question",
      name: e.q,
      acceptedAnswer: { "@type": "Answer", text: e.a, ...(e.url ? { url: e.url } : {}) },
    }));
  if (!main.length) return null;
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: main };
}

/** Lower-cased words of a query (Tamil and Latin letters/digits). */
export function queryWords(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((w) => w.length > 1 || /\p{N}/u.test(w));
}

/**
 * Groups narrowed to articles whose title, excerpt or `bodies[slug]` contain every word of `q` (prefix match on word
 * starts). Empty groups are dropped; an empty query returns the groups unchanged.
 */
export function filterFaq(groups: readonly FaqGroup[], q: string, bodies: Readonly<Record<string, string>> = {}): FaqGroup[] {
  const words = queryWords(q);
  if (!words.length) return groups.slice();
  const out: FaqGroup[] = [];
  for (const g of groups) {
    const articles = g.articles.filter((a) => {
      const hay = queryWords(`${a.title} ${a.excerpt} ${bodies[a.slug] ?? ""} ${g.category?.name ?? ""}`);
      return words.every((w) => hay.some((h) => h.startsWith(w)));
    });
    if (articles.length) out.push({ ...g, articles });
  }
  return out;
}

export const countArticles = (groups: readonly FaqGroup[]) => groups.reduce((s, g) => s + g.articles.length, 0);

/** StatusChip tone for a ticket status (the chip maps known order statuses to colours). */
export function ticketTone(status: TicketStatus): "placed" | "pending" | "delivered" | "returned" {
  switch (status) {
    case "open":
      return "placed";
    case "pending":
      return "pending";
    case "resolved":
      return "delivered";
    default:
      return "returned";
  }
}

/** Shopper-side reply is possible unless the ticket is closed or merged. */
export const canReply = (t: { status: TicketStatus; mergedInto: string | null }) => t.status !== "closed" && !t.mergedInto;
