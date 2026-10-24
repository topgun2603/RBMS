import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";

/**
 * `pnpm exec tsx --env-file-if-exists=.env src/seed-thunai.ts`: the people of the Thunai demo shop (store data and catalogue come from `pnpm seed:stores thunai`, history from
 * `pnpm seed:history thunai --profile pharmacy`). Staff are invited through the staff module (`POST /v1/staff/invites`:
 * manager, two cashiers, stock-keeper; PINs and the two POS terminals through `/v1/pos`, docs/demo-history.md); this
 * script only gives the invited users their Tamil names, which a person normally types on first sign-in (the demo
 * numbers cannot sign in: test OTPs are for the owner's e-mail only). Idempotent.
 */
const STAFF: { phone: string; name: string }[] = [
  { phone: "+919000120101", name: "Kalaiselvi Murugan" },
  { phone: "+919000120102", name: "Abirami Natarajan" },
  { phone: "+919000120103", name: "Saravanan Palanisamy" },
  { phone: "+919000120104", name: "Velmurugan Arumugam" },
];

const log = pino({ level: "info" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);
try {
  for (const s of STAFF) {
    const { user } = await kit.auth.service.findOrCreateByTarget(s.phone);
    if (user.name !== s.name) {
      await kit.auth.service.updateProfile(user.id, { name: s.name });
      log.info({ phone: s.phone, name: s.name }, "thunai: staff named");
    }
  }
} finally {
  await kit.stop();
}
