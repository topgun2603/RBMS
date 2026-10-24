import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";
import { DEMO_STORES, seedDemoStore } from "./demo-stores";

/**
 * `pnpm seed:stores [slug…] [--refresh-home] [--refresh-look] [--refresh-photos] [--refresh-settings]`: seeds only the demo stores (demo-stores/), all or the
 * named ones, owned by the SEED_SUPERADMIN user. Idempotent like `pnpm seed`; plans and app profiles must exist (run
 * `pnpm seed` once first). `--refresh-home` rewrites a home that is still the store's own seeded one (while building a
 * store); `--refresh-look` re-applies the store's preset (incl. pageLayout / mobileNav) after its preset file changed; `--refresh-photos` swaps the first picture of existing products whose photo changed in the store file.
 */
const log = pino({ level: "info" });
if (!env.SEED_SUPERADMIN) throw new Error("Set SEED_SUPERADMIN (the demo stores' owner)");
const args = process.argv.slice(2);
const refreshHome = args.includes("--refresh-home");
const refreshLook = args.includes("--refresh-look");
const refreshPhotos = args.includes("--refresh-photos");
const refreshSettings = args.includes("--refresh-settings");
const wanted = args.filter((a) => !a.startsWith("--"));
const unknown = wanted.filter((s) => !DEMO_STORES.some((d) => d.shop.slug === s));
if (unknown.length) throw new Error(`Unknown demo store(s): ${unknown.join(", ")} (have: ${DEMO_STORES.map((d) => d.shop.slug).join(", ")})`);

const kit = createKit({ ...env, REDIS_URL: "memory" }, log);
try {
  const { user } = await kit.auth.service.findOrCreateByTarget(env.SEED_SUPERADMIN);
  for (const store of DEMO_STORES) if (!wanted.length || wanted.includes(store.shop.slug)) await seedDemoStore(kit, store, user.id, log, { refreshHome, refreshLook, refreshPhotos, refreshSettings });
} finally {
  await kit.stop();
}
