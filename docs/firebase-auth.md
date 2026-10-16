# Firebase phone sign-in

Phone numbers are verified with **Firebase Phone Authentication**. Google sends the SMS from its own registered
sender, so we don't need India's DLT registration (sender id and template approval) for sign-in codes.

Firebase only proves that the person has the phone. Our API still owns the account and the session:

```
browser                         Firebase                         our API
  │ signInWithPhoneNumber ───────▶ │  SMS with a 6-digit code
  │ confirm(code) ───────────────▶ │  → Firebase ID token (RS256 JWT)
  │ POST /v1/auth/firebase {idToken} ─────────────────────────────▶ │  verify the token, phone_number → user
  │ ◀──────────────────────────────────────────── { token, user, isNewUser } + sr_session cookie
  │ signOut() from Firebase (nothing of Firebase's is kept in the browser)
```

These parts don't change:

- **Email** codes use the existing email OTP.
- **WhatsApp** codes use the existing OTP.
- **Dev test identities** keep the fixed test OTP, so the e2e suites never touch Firebase. These are `TEST_OTP_CODE`
  for `+9199990*` and `e2e-*@example.com`. Their patterns come from `GET /v1/auth/config`, and that endpoint lists
  them only when test OTPs are on, which is never in production.
- **Without Firebase config** everything behaves exactly as before.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> → **Add project**. You can attach it to an existing Google Cloud project.
   Google Analytics is not needed.
2. **Project settings → General → Your apps → Add app → Web** (`</>`). Give it a nickname. Firebase Hosting isn't
   needed. Copy the config values: `apiKey`, `authDomain`, `projectId` and `appId`. The other fields aren't used.

The project in use is `srikit-cdea0`.

## 2. Enable Phone sign-in

1. **Build → Authentication → Get started → Sign-in method → Add new provider → Phone → Enable → Save.**
2. **Authentication → Settings → SMS region policy.** Allow **India (IN)**, plus any other country you sell to.
   Numbers outside the allowed regions are refused with
   `OPERATION_NOT_ALLOWED: SMS unable to be sent until this region enabled by the app developer`. That is exactly what
   `srikit-cdea0` returned for a US test number on 2026-10-17, so a region policy is active there. Make sure India is
   on the allow list.
3. Optional: **Authentication → Settings → reCAPTCHA (Enterprise)** for SMS fraud protection. Without it the SDK
   logs `Failed to initialize reCAPTCHA Enterprise config. Triggering the reCAPTCHA v2 verification.` and uses the
   classic invisible reCAPTCHA v2. That message is expected and harmless.

## 3. Authorized domains, and per-shop subdomains

Phone sign-in only works on pages served from an **authorized domain**: **Authentication → Settings → Authorized
domains**. `localhost`, `<project>.firebaseapp.com` and `<project>.web.app` are there by default.

Add the fixed hosts:

| Host | Why |
| --- | --- |
| `srikit.in`, `www.srikit.in` | the landing site (sign-up wizard, `/login`). This is where phone sign-in for shops happens. |
| `admin.srikit.in` | the super-admin app |

**Authorized domains don't accept wildcards.** You can't add `*.srikit.in`, and every shop gets its own subdomain
(`raja.srikit.in`, `anbu.srikit.in`, …). Adding each shop by hand or through the API doesn't scale, and the list has a
size limit.

### What we do: verify on the landing site and hand the session back

The web-kit login (billing `:3001`, shop `:3002`, seller `:3004`) checks whether its own host is in
`NEXT_PUBLIC_FIREBASE_AUTH_HOSTS`:

- **Host listed:** phone sign-in runs in place.
- **Host not listed (a shop subdomain):** a phone number on SMS sends the browser to
  `NEXT_PUBLIC_WWW_URL/login?phone=<E.164>&return=<this app's /login URL>`. The landing site is on an authorized
  domain. It shows "Verify your mobile number" with the number filled in, runs the Firebase check and signs in. Then it
  creates a single-use, 60-second **login handoff code** (`POST /v1/auth/handoff`, the same mechanism sign-up already
  uses) and sends the browser to `<return>?handoff=<code>`. The shop app's login page redeems the code
  (`POST /v1/auth/handoff/redeem`) for its own session.

Because a handoff code signs someone in, the landing site only returns to URLs that pass all of these checks:

- the origin matches `NEXT_PUBLIC_PHONE_RETURN_ORIGINS`, where `*` is exactly one subdomain label, e.g.
  `https://*.srikit.in`;
- the URL has no user name or password;
- the path ends in `/login`.

Anything else is ignored and `/login` behaves normally. **Never list the storefront origins there**: storefronts render
content the shop supplies.

If the landing site already has a session for the **same** number, it hands back straight away. A different signed-in
account is never reused.

The user sees one extra page load. Email, WhatsApp and test numbers are unaffected and stay on the shop's own page.

**Possible shortcut, to be verified.** Firebase's own origin check treats an authorized domain as also covering its
subdomains. On 2026-10-17 the invisible reCAPTCHA loaded and ran on `raja.localhost` as well as `localhost`. What
hasn't been verified is whether Firebase then accepts the request to send the code from the subdomain: that check
happens server-side and needs a real run. To test it, add `srikit.in` to the authorized domains, then set
`NEXT_PUBLIC_FIREBASE_AUTH_HOSTS=.srikit.in,localhost` on one shop app and try a fictional test number there (see
section 6). If it works, shops can verify in place. If you get `auth/unauthorized-domain` or a captcha error, keep the
default (`localhost`) and the landing-site round trip.

Custom domains (`shop.example.com` CNAMEd to us) apply only to storefronts. They have the same limitation; see
section 7.

## 4. Environment variables

**API (`apps/api/.env`)**

| Variable | |
| --- | --- |
| `FIREBASE_PROJECT_ID` | e.g. `srikit-cdea0`. The project id only: the API checks ID tokens against Google's public keys, so no service account or secret is needed. Unset: `POST /v1/auth/firebase` answers 503 `not_configured` and `GET /v1/auth/config` says `phone.method: "otp"`. |

In **production** with `FIREBASE_PROJECT_ID` set and **no MSG91** (`MSG91_AUTH_KEY` + `MSG91_SENDER_ID`),
`POST /v1/auth/otp/request` refuses phone **SMS** codes with 400 `sms_via_firebase`. Without a provider, the console
driver would accept the code and drop it. WhatsApp, email and development are unaffected.

**Web apps (`.env.local`, never committed)**

| Variable | Apps | |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | admin, billing, shop, seller, www | from the web app config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same | `<project>.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same | must equal the API's `FIREBASE_PROJECT_ID`, or the client stays on OTP |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same | `1:…:web:…` |
| `NEXT_PUBLIC_FIREBASE_AUTH_HOSTS` | billing, shop, seller | hosts where phone sign-in runs in place: exact names or `.suffix`. Default `localhost`. |
| `NEXT_PUBLIC_WWW_URL` | billing, shop, seller | the landing site, default `http://localhost:3005` |
| `NEXT_PUBLIC_PHONE_RETURN_ORIGINS` | www | where `/login` may hand a sign-in back to. Default: the dev admin/billing/shop/seller origins. Production example: `https://admin.srikit.in,https://*.srikit.in` (only if storefronts are not on `*.srikit.in`; otherwise list the app hosts precisely). |

The web config is public by design: anyone can read it from the page. Protect the project with the authorized
domains and the SMS region policy. You can also restrict the API key to your HTTP referrers in Google Cloud Console →
APIs & Services → Credentials. Every `.env.example` has placeholders. `NEXT_PUBLIC_*` values are baked in at build
time, so rebuild or restart the app after changing them.

Only `firebase/app` and `firebase/auth` are used (no Analytics). The SDK is loaded on demand when someone starts a
phone sign-in, and the Firebase client uses in-memory persistence.

## 5. Free quota and billing

Phone Authentication is charged **per SMS sent**, priced by destination country. Check the current figures on
<https://firebase.google.com/pricing> and the Identity Platform pricing page before launch.

- On the no-cost **Spark** plan, phone sign-in has only a small daily SMS allowance, which is fine for trying it out.
- Real traffic needs the pay-as-you-go **Blaze** plan, with a billing account. Set a **budget alert** in Google Cloud
  Billing.
- Fictional test numbers (next section) never send an SMS and are free.
- `auth/quota-exceeded` means the project hit its SMS quota. The sign-in screens then say so in English and Tamil and
  suggest email.

## 6. Testing with fictional numbers

**Authentication → Sign-in method → Phone → Phone numbers for testing.** Add, for example, `+91 90000 00001` with
code `123456`. Pick numbers that can't belong to anyone. Firebase sends no SMS for these and accepts only the fixed
code. reCAPTCHA still runs.

Then, with the dev servers running and Firebase configured:

1. <http://localhost:3005/login>: enter `9000000001` → Send code. Solve the reCAPTCHA if one appears; normally it
   doesn't for a real person. Enter `123456`. You should see "Your shops" and be signed in as `+919000000001` (a new
   user is created the first time).
2. <http://localhost:3000/login> (admin): same number, signed in in place.
3. <http://e2e-bill.localhost:3001/login>: same number. You are taken to `localhost:3005/login` with the number filled
   in. Verify there, and you land back in the billing app signed in. That account isn't a member of `e2e-bill`, so you
   see the no-access screen; use a member's number to get in.
4. Wrong code → "That code didn't work…" / "இந்தக் குறியீடு சரியில்லை…". Too many tries →
   `auth/too-many-requests` → "Too many attempts…".

Don't add the dev test identities (`+9199990…`) as Firebase test numbers. They never reach Firebase; the fixed dev OTP
handles them.

## 7. Not covered yet

- **Storefront shoppers** (`packages/storefront-ui` sign-in, checkout and account) and **guest phone verification**
  (support tickets) still use `/v1/auth/otp/request` with SMS. Storefronts run on shop subdomains and on custom
  domains that can't all be authorized. Sending shoppers to the landing site would take them out of the shop's branded
  store, and the cart merge would need care.

  Until this is done, production without MSG91 refuses their phone SMS codes (`sms_via_firebase`). Shoppers can use
  WhatsApp or email.

  Options:
  - (a) Phone sign-in in place on `*.srikit.in` storefronts, if the subdomain check in section 3 passes.
  - (b) A popup or redirect to a fixed auth host with a storefront handoff.
  - (c) MSG91 with DLT for storefront SMS only.
- **Mobile apps** would use the native Firebase SDKs and post the same ID token to `POST /v1/auth/firebase`.

## API reference

- `GET /v1/auth/config` (public) returns:

  ```
  {
    phone: { method: "firebase" | "otp", firebaseProjectId, smsOtp },
    google,
    testTargets?
  }
  ```

  `testTargets` appears only when test OTPs are on (never in production).
- `POST /v1/auth/firebase {idToken, name?}` responds the same way as `/otp/verify`: `{token, expiresAt, user,
  isNewUser}` plus the `sr_session` cookie, audited as `auth.login` "Signed in with firebase". Limited to 20 per IP per
  10 minutes; Firebase limits the SMS itself.

  Token checks (`packages/auth/src/firebase.ts`):
  - RS256 with a known `kid`, against Google's `securetoken@system.gserviceaccount.com` certificates, cached for their
    `Cache-Control` max-age and refetched early when an unknown `kid` appears;
  - `aud` = project id;
  - `iss` = `https://securetoken.google.com/<projectId>`;
  - `exp` / `iat` with 60 s skew;
  - `auth_time` not in the future and at most 10 minutes old;
  - `sub` present;
  - `firebase.sign_in_provider` = `phone`;
  - `phone_number` present.

  Rejections are 400s, each with its own code:

  | Code | Meaning |
  | --- | --- |
  | `firebase_token_invalid` | malformed or failed one of the checks above without a more specific code |
  | `firebase_token_expired` | past `exp` |
  | `firebase_token_stale` | `auth_time` more than 10 minutes ago |
  | `firebase_wrong_project` | `aud` or `iss` is for another project |
  | `firebase_not_phone` | not a phone sign-in |
  | `firebase_no_phone` | no usable `phone_number` |
  | `firebase_bad_signature` | signature doesn't verify |
  | `firebase_unknown_key` | `kid` not among Google's keys |

  When Google's keys can't be fetched, the answer is 503 `firebase_keys_unavailable`.
