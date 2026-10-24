import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";

/**
 * `pnpm exec tsx --env-file-if-exists=.env src/seed-techzone.ts`: the people of the TechZone demo shop (store data and
 * catalogue come from `pnpm seed:stores techzone`, history from `pnpm seed:history techzone`). Staff are invited through
 * the staff module (`POST /v1/staff/invites`: manager, two sales executives on the custom "sales" role, one cashier), each
 * with a POS PIN (`PUT /v1/pos/pins/:userId`) and two unpaired terminals ("Counter 1", "Counter 2"); this script only gives
 * the invited users their Tamil names, which a person normally types on first sign-in (the demo numbers cannot sign in:
 * test OTPs are for the owner's e-mail only). Idempotent.
 */
const STAFF: { phone: string; name: string }[] = [
  { phone: "+919000047401", name: "Karthikeyan Rajendran" },
  { phone: "+919000047402", name: "Arunachalam Murugesan" },
  { phone: "+919000047403", name: "Priyadharshini Velusamy" },
  { phone: "+919000047404", name: "Tamilselvi Palanisamy" },
];

const log = pino({ level: "info" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);
try {
  for (const s of STAFF) {
    const { user } = await kit.auth.service.findOrCreateByTarget(s.phone);
    if (user.name !== s.name) {
      await kit.auth.service.updateProfile(user.id, { name: s.name });
      log.info({ phone: s.phone, name: s.name }, "techzone: staff named");
    }
  }
} finally {
  await kit.stop();
}
