import { seedPlans } from "@srirealtime/plans";
import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";

/** Idempotent: upserts the default plans and, if SEED_SUPERADMIN is set, grants that user super-admin. */
const log = pino({ level: "info" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

for (const plan of seedPlans) {
  await kit.plans.service.upsertPlan(plan);
  log.info({ plan: plan.id }, "plan upserted");
}

if (env.SEED_SUPERADMIN) {
  const { user } = await kit.auth.service.findOrCreateByTarget(env.SEED_SUPERADMIN);
  const roles = new Set([...user.platformRoles, "superadmin"]);
  await kit.auth.service.setPlatformRoles(user.id, [...roles]);
  log.info({ userId: user.id }, "super-admin ready — sign in with OTP to this phone/email");
}

await kit.stop();
