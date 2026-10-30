import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";
import { SimClock } from "./demo-history/context";
import { runHistory } from "./demo-history/engine";
import { getProfile, profileForBusinessType, PROFILE_IDS } from "./demo-history/profiles";

/**
 * `pnpm --filter @rbms/api seed:history <slug> [--days 90] [--profile tailoring|tea_stall|kirana|pharmacy|restaurant|jewellery|textiles|hardware|services|spa] [--dry-run]`
 *
 * Generates realistic past trading for one demo shop through the real kit services (bills, payments, receipts, credit
 * notes, till sessions, purchases, expenses, customers), dated within the last N days (IST) and never in the future.
 * Re-runnable: days that already have a till session are skipped, so a second run only fills days up to today.
 * Nothing is sent to anyone: messaging providers are switched off for this process (the console driver logs only).
 * See docs/demo-history.md.
 */
/** Profile for the demo shops when the business type isn't known. */
const DEFAULT_BY_SLUG: Record<string, string> = { kumar: "kirana", thunai: "pharmacy", arusuvai: "restaurant", lakshmi: "jewellery", raja: "textiles", glow: "services", quickfix: "repair", ironfit: "services", techzone: "electronics", vaasam: "cloud_kitchen", theneer: "tea_stall", sukham: "spa", thaiyal: "tailoring" };
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--") && ["days", "profile"].includes(args[i - 1]!.slice(2))));
const days = Number(flag("days") ?? 90);
const dryRun = args.includes("--dry-run");
if (!slug || !Number.isInteger(days) || days < 1 || days > 400) {
  console.error(`Usage: seed:history <slug> [--days 90] [--profile ${PROFILE_IDS.join("|")}] [--dry-run]`);
  process.exit(1);
}

const log = pino({ level: process.env.LOG_LEVEL ?? "warn" });
const clock = new SimClock();
// No provider credentials: WhatsApp / SMS / email / push all go to the console driver, and Redis is in-memory.
const quiet = {
  ...env,
  REDIS_URL: "memory",
  MSG91_AUTH_KEY: undefined,
  MSG91_SENDER_ID: undefined,
  MSG91_OTP_FLOW_ID: undefined,
  RESEND_API_KEY: undefined,
  WHATSAPP_TOKEN: undefined,
  WHATSAPP_PHONE_NUMBER_ID: undefined,
  FCM_SERVICE_ACCOUNT_JSON: undefined,
} as typeof env;
const kit = createKit(quiet, log, { now: clock.now, skipInvoiceQuota: true });
let code = 0;
try {
  const tenant = await kit.tenancy.service.getBySlug(slug);
  if (!tenant) throw new Error(`No shop "${slug}"`);
  const signup = (tenant as { details?: { signup?: { businessType?: string } } }).details?.signup?.businessType;
  const byApp: Record<string, string> = { PH: "pharmacy", RS: "restaurant", SV: "services" };
  const profile = flag("profile") ? getProfile(flag("profile")!) : (profileForBusinessType(signup) ?? getProfile(DEFAULT_BY_SLUG[slug] ?? byApp[tenant.appId ?? ""] ?? "kirana"));
  console.log(`history for ${slug}: profile ${profile.id}, ${days} days${dryRun ? " (dry run)" : ""}`);
  const t0 = Date.now();
  const stats = await runHistory(kit, clock, { slug, profile, days, dryRun, log });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(stats));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
} finally {
  await kit.stop();
}
process.exit(code);

