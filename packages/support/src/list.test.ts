import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { faqArticleQuerySchema } from "./faq";
import { ticketListQuerySchema } from "./logic";
import { faqArticles, supportTickets } from "./schema";
import { FAQ_ARTICLE_SORT, SupportService, TICKET_SORT } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const ME = "44444444-4444-4444-8444-444444444444";
const U2 = "55555555-5555-4555-8555-555555555555";
const C1 = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-10-17T06:00:00Z");
const svc = new SupportService({ db, now: () => NOW });

const ticketWhere = (q: Record<string, unknown>, skip?: "status" | "priority") =>
  db.select().from(supportTickets).where(svc.listConditions(T, ticketListQuerySchema.parse(q), ME, skip)).toSQL();
const ticketOrder = (s?: string) => db.select().from(supportTickets).orderBy(...TICKET_SORT.orderBy(ticketListQuerySchema.parse({ sort: s }).sort)).toSQL().sql;

describe("ticket list query", () => {
  it("keeps the 50 / 500 limits (CSV asks for 500) and takes comma lists", () => {
    expect(ticketListQuerySchema.parse({}).limit).toBe(50);
    expect(ticketListQuerySchema.parse({ limit: "500" }).limit).toBe(500);
    expect(() => ticketListQuerySchema.parse({ limit: "501" })).toThrow(ZodError);
    const p = ticketListQuerySchema.parse({ priority: "high,urgent", channel: "web", assignee: `none,me,${U2}`, overdue: "1" });
    expect(p.priority).toEqual(["high", "urgent"]);
    expect(p.assignee).toEqual(["none", "me", U2]);
    expect(p.overdue).toBe(true);
    expect(ticketListQuerySchema.parse({ overdue: "false" }).overdue).toBe(false);
    expect(() => ticketListQuerySchema.parse({ priority: "asap" })).toThrow(ZodError);
    expect(() => ticketListQuerySchema.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
  });

  it("ORs assignees: me is the viewer, none is unassigned", () => {
    const q = ticketWhere({ assignee: `me,none,${U2}` });
    expect(q.sql).toContain('"support_tickets"."assignee_id" is null');
    expect(q.sql).toMatch(/\("support_tickets"\."assignee_id" = \$\d+ or "support_tickets"\."assignee_id" is null or "support_tickets"\."assignee_id" = \$\d+\)/);
    expect(q.params).toEqual(expect.arrayContaining([T, ME, U2]));
  });

  it("filters status, priority, channel, overdue and dates", () => {
    const q = ticketWhere({ status: "open", priority: "urgent", channel: "whatsapp", overdue: "true", from: "2026-10-01", to: "2026-10-31" });
    expect(q.sql).toContain('"support_tickets"."status" in ($');
    expect(q.sql).toContain('"support_tickets"."priority" in ($');
    expect(q.sql).toContain('"support_tickets"."channel" in ($');
    expect(q.sql).toContain('"support_tickets"."first_response_at" is null');
    expect(q.sql).toContain('"support_tickets"."sla_due_at" < $');
    expect(q.params).toEqual(expect.arrayContaining(["open", "urgent", "whatsapp"]));
  });

  it("searches number, subject and customer (escaped), and the ticket sequence", () => {
    const q = ticketWhere({ q: "TKT-0042" });
    for (const col of ["number", "subject", "requester_name", "requester_phone", "requester_email"]) expect(q.sql).toContain(`"support_tickets"."${col}" ilike`);
    expect(q.sql).toContain('"support_tickets"."seq" = $');
    expect(q.params).toEqual(expect.arrayContaining(["%TKT-0042%", 42]));
    expect(ticketWhere({ q: "50%" }).params).toContain("%50\\%%");
  });

  it("drops one filter for its facet counts", () => {
    expect(ticketWhere({ status: "open", priority: "high" }, "status").params).not.toContain("open");
    const p = ticketWhere({ status: "open", priority: "high" }, "priority").params;
    expect(p).toContain("open");
    expect(p).not.toContain("high");
  });

  it("sorts by activity by default, priority by severity, and maps the old names", () => {
    expect(ticketOrder()).toContain('order by "support_tickets"."last_message_at" desc nulls last, "support_tickets"."id" desc');
    expect(ticketOrder("recent")).toContain('"support_tickets"."last_message_at" desc nulls last');
    expect(ticketOrder("oldest")).toContain('"support_tickets"."created_at" asc nulls last');
    expect(ticketOrder("due")).toContain('"support_tickets"."sla_due_at" asc nulls last');
    expect(ticketOrder("-priority")).toContain(`(case "support_tickets"."priority" when 'urgent' then 4`);
    expect(ticketOrder("-priority")).toContain("end) desc nulls last");
    expect(() => ticketOrder("-secret")).toThrow(AppError);
    expect(TICKET_SORT.default).toBe("-updated");
    expect(TICKET_SORT.keys).toEqual(["number", "subject", "updated", "created", "priority", "due", "status"]);
  });
});

const articleWhere = (q: Record<string, unknown>, skip?: "status" | "category") =>
  db.select().from(faqArticles).where(svc.articleConditions(T, faqArticleQuerySchema.parse(q), skip)).toSQL();

describe("FAQ article list query", () => {
  it("pages 25 by default (max 200) and takes comma lists with `none` for uncategorised", () => {
    expect(faqArticleQuerySchema.parse({}).limit).toBe(25);
    expect(() => faqArticleQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    expect(faqArticleQuerySchema.parse({ status: "draft,published", categoryId: `${C1},none` })).toMatchObject({ status: ["draft", "published"], categoryId: [C1, "none"] });
    expect(() => faqArticleQuerySchema.parse({ status: "archived" })).toThrow(ZodError);
    expect(() => faqArticleQuerySchema.parse({ categoryId: "returns" })).toThrow(ZodError);
  });

  it("ORs categories with uncategorised and searches title and body", () => {
    const q = articleWhere({ categoryId: `${C1},none`, status: "published", q: "refund" });
    expect(q.sql).toMatch(/\("faq_articles"\."category_id" in \(\$\d+\) or "faq_articles"\."category_id" is null\)/);
    expect(q.sql).toContain('"faq_articles"."title" ilike');
    expect(q.sql).toContain('"faq_articles"."body" ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, C1, "published", "%refund%"]));
    expect(articleWhere({ status: "draft", categoryId: C1 }, "status").params).not.toContain("draft");
    expect(articleWhere({ status: "draft", categoryId: C1 }, "category").params).not.toContain(C1);
  });

  it("sorts by manual order by default and by helpful votes", () => {
    const render = (s?: string) => db.select().from(faqArticles).orderBy(...FAQ_ARTICLE_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "faq_articles"."sort" asc nulls last, lower("faq_articles"."title") asc, "faq_articles"."id" asc');
    expect(render("-helpful")).toContain('("faq_articles"."helpful_yes" - "faq_articles"."helpful_no") desc nulls last');
    expect(render("title")).toContain('lower("faq_articles"."title") asc nulls last');
    expect(() => render("body")).toThrow(AppError);
  });
});
