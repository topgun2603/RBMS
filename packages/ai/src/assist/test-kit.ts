import type { Db } from "@rbms/db";
import { vi } from "vitest";
import { resolveAiConfig } from "../config";
import { AI_SETTINGS_DEFAULTS, type AiSettings } from "../features";
import { MockProvider, type MockResponder } from "../mock-provider";
import { AiService, type CreditBalance } from "../service";

export const T = "11111111-1111-4111-8111-111111111111";

/** A real AiService (switches, masking, schema validation, credits) on the mock provider with scripted answers. */
export function kit(opts: { settings?: Partial<AiSettings>; remaining?: number | null; responders?: MockResponder[] } = {}) {
  const rows: Record<string, unknown>[] = [];
  const db = { insert: () => ({ values: async (r: Record<string, unknown>) => void rows.push(r) }) } as unknown as Db;
  const mock = new MockProvider(opts.responders ?? []);
  const config = resolveAiConfig({ NODE_ENV: "test" }, { mock });
  const remaining = opts.remaining === undefined ? 100000 : opts.remaining;
  let spent = 0;
  const balance = async (): Promise<CreditBalance> => ({
    period: "2026-10",
    unlimited: remaining === null,
    allowance: remaining ?? 0,
    allowanceUsed: spent,
    topUp: 0,
    remaining: remaining === null ? null : Math.max(0, remaining - spent),
  });
  const service = new AiService({
    db,
    config,
    settings: { get: async () => ({ ...AI_SETTINGS_DEFAULTS, enabled: true, ...opts.settings }) },
    featureOn: async () => true,
    credits: {
      balance,
      charge: vi.fn(async (_t: string, n: number) => {
        spent += n;
        return n;
      }),
    },
    now: () => new Date("2026-10-24T06:00:00Z"),
  });
  return { service, mock, rows, spent: () => spent };
}

/** Text of the last user message of a provider request. */
export const userText = (req: { messages: { content: unknown }[] }) => {
  const c = req.messages.at(-1)!.content;
  return typeof c === "string" ? c : (c as { type: string; text?: string }[]).map((b) => b.text ?? "").join("\n");
};
