import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";

/**
 * `pnpm exec tsx --env-file-if-exists=.env src/seed-thaiyal.ts`: the people of the Thaiyal demo shop (store data and
 * catalogue come from `pnpm seed:stores thaiyal`, history from `pnpm seed:history thaiyal`). Staff are invited through
 * the staff module (`POST /v1/staff/invites`, roles manager / tailor / cashier, see docs/demo-history.md); this
 * script only gives the invited users their Tamil names, which a person normally types on first sign-in (the demo
 * numbers cannot sign in: test OTPs are for the owner's e-mail only). Idempotent.
 */
const STAFF: { phone: string; name: string }[] = [
  { phone: "+919000084301", name: "Rajeswari Sundaram" },
  { phone: "+919000084302", name: "Selvi Murugesan" },
  { phone: "+919000084303", name: "Ganesan Pandian" },
  { phone: "+919000084304", name: "Thenmozhi Velu" },
  { phone: "+919000084305", name: "Pushpa Karthikeyan" },
];

const log = pino({ level: "info" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);
try {
  for (const s of STAFF) {
    const { user } = await kit.auth.service.findOrCreateByTarget(s.phone);
    if (user.name !== s.name) {
      await kit.auth.service.updateProfile(user.id, { name: s.name });
      log.info({ phone: s.phone, name: s.name }, "thaiyal: staff named");
    }
  }
} finally {
  await kit.stop();
}
