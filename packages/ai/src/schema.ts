import { pk, tenantId, timestamps } from "@srirealtime/db";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { AiFeedback, AiRunStatus, AiTier, ProviderKind } from "./types";

/**
 * One row per AI call. Metadata only: who, which helper, which model, tokens, cost, credits, outcome. The text of the
 * prompt and the reply is NOT stored, except in `debug` when the shop switched "store prompts for debugging" on
 * (kept 7 days, then cleared). This table is also the credit ledger: the sum of `credits` per `period` is what the shop spent.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: pk(),
    tenantId: tenantId(),
    userId: text("user_id"),
    feature: text("feature").notNull(),
    tier: text("tier").$type<AiTier>().notNull(),
    model: text("model").notNull(),
    provider: text("provider").$type<ProviderKind>().notNull(),
    status: text("status").$type<AiRunStatus>().notNull(),
    /** Machine code of the failure or block (`ai_credits_exhausted`, `ai_refused`...). */
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** Model cost in micro-USD (1,000,000 = $1). */
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    /** Credits taken from the shop (1 credit = $0.001 of model cost). */
    credits: integer("credits").notNull().default(0),
    /** Model calls in the run (more than 1 when tools were used). */
    steps: integer("steps").notNull().default(1),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** IST month the credits belong to, "2026-10". */
    period: text("period").notNull(),
    /** accepted | edited | rejected: what the person did with the draft. */
    feedback: text("feedback").$type<AiFeedback>(),
    feedbackNote: text("feedback_note"),
    feedbackAt: timestamp("feedback_at", { withTimezone: true }),
    /** Only when the shop switched on "store prompts for debugging". Cleared after 7 days. */
    debug: jsonb("debug").$type<{ input: string; output: string }>(),
    ...timestamps(),
  },
  (t) => [index("ai_runs_tenant_created_idx").on(t.tenantId, t.createdAt), index("ai_runs_tenant_period_idx").on(t.tenantId, t.period, t.feature)],
);

export type AiRunRow = typeof aiRuns.$inferSelect;
