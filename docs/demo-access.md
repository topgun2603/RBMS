# Live demo access

The marketing site has a `/demo` page: a gallery of demo online stores and a "Try the demo" button for each showcase
shop that opens its business app, already signed in, **read only**.

## Configuration

| Where | Variable | Meaning |
| --- | --- | --- |
| `apps/api/.env` | `DEMO_SHOPS` | Shop slugs (comma-separated) that offer the demo sign-in. Empty or unset = off (the default). |
| `apps/www/.env.local` | `NEXT_PUBLIC_DEMO_STORE_URL` | Storefront template with `{slug}`, e.g. `http://{slug}.localhost:3003` or `https://{slug}.srikit.in`. Unset = the Online stores gallery and demo-store links are hidden. |

Dev values: `DEMO_SHOPS=kumar,raja,arusuvai,vaasam,theneer,thunai,techzone,sukham,thaiyal,quickfix,lakshmi`.
Restart the API after changing `DEMO_SHOPS`. The list of cards lives in `apps/www/src/lib/demos.ts`; storefront
thumbnails are `apps/www/public/demos/<slug>.webp` (1280x800 home-page crop, resized to 960x600).

## How it works

1. The page calls `POST /v1/auth/demo { shop }` through the site's `/api/v1` proxy. The API refuses (404
   `demo_not_available`) any shop not in `DEMO_SHOPS`, and limits sign-ins to 12 per IP per 10 minutes (429).
2. It creates (once) a dedicated user `demo+<slug>@demo.invalid` with the platform role `demo`, a `staff` member of that
   one shop with the built-in role `role:demo` (view permissions only, `@srirealtime/staff` templates). Never the owner.
3. It returns a 2-hour session token and a single-use handoff (`url` = the shop app's `/login?handoff=<code>`), bound to
   that shop. The page opens `url` in a new tab; the app redeems it like any handoff.

## Read-only enforcement (server side)

`apps/api/src/demo-auth.ts` registers `demoGuard`, a request hook that runs right after auth for sessions of users with the
`demo` platform role:

- **Writes**: every request that is not GET, HEAD or OPTIONS gets 403 `demo_read_only`. The only exception is
  `POST /v1/auth/logout`.
- **Other shops**: a request for any shop where the demo user has no membership gets 403 `demo_wrong_shop`.
- **Blocked reads** (403 `demo_not_available`): bulk exports and imports (`/v1/importexport`), API keys
  (`/v1/developer`), consent exports, team (`/v1/staff`, `/v1/tenancy/members`), the audit log, WhatsApp and notification
  setup, subscriptions, payment accounts, KYC, domains, handoff creation (`/v1/auth/handoff`, `/v1/auth/store/handoff`),
  sign-in settings and the user directory.
- **Expiry**: sessions are valid for 2 hours from creation, including the session made when the handoff is redeemed;
  after that 401 `demo_expired` and the session is revoked.

In the business apps (`packages/web`), demo sessions show a "Demo, read only" banner (English and Tamil) and refused
writes show a friendly message (`web.errors.demo_read_only`).

## Production

Leave `DEMO_SHOPS` empty unless you run public demo shops. Use demo shops that hold fake data only. Demo users are
ordinary users flagged by the `demo` platform role; revoke by removing the slug from `DEMO_SHOPS` (new sign-ins stop) and
disabling the user, or wait two hours for sessions to end.
