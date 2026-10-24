import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";

/**
 * `pnpm exec tsx --env-file-if-exists=.env src/seed-quickfix.ts`: the people of the QuickFix demo shop (store data and
 * catalogue come from `pnpm seed:stores quickfix`, history from `pnpm seed:history quickfix`). Staff are invited through
 * the staff module (`POST /v1/staff/invites`, roles manager / technician / front-desk, see docs/demo-history.md); this
 * script only gives the invited users their Tamil names, which a person normally types on first sign-in (the demo
 * numbers cannot sign in: test OTPs are for the owner's e-mail only). Idempotent.
 */
const STAFF: { phone: string; name: string }[] = [
  { phone: "+919000051101", name: "Senthil Murugan" },
  { phone: "+919000051102", name: "Karthikeyan Subramani" },
  { phone: "+919000051103", name: "Arul Prakash" },
  { phone: "+919000051104", name: "Divya Lakshmi" },
];

const log = pino({ level: "info" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);
try {
  for (const s of STAFF) {
    const { user } = await kit.auth.service.findOrCreateByTarget(s.phone);
    if (user.name !== s.name) {
      await kit.auth.service.updateProfile(user.id, { name: s.name });
      log.info({ phone: s.phone, name: s.name }, "quickfix: staff named");
    }
  }
} finally {
  await kit.stop();
}
