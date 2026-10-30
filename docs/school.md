# School app (app `SC`, pack `school`)

A school's website, not a shop: admissions, programmes, campus, news and parent enquiries. It runs on its own app,
**School (`SC`, `apps/school`, :3009)**, with its own profile and plans. Pack `school`
(`packages/verticals/src/packs.ts`: `site: true`, `ctaHref: "/admissions"`, categories Pre-primary, Primary, Middle
school, High school, Higher secondary, Co-curricular), look `campus-navy` (`theme-presets-school.ts`).

- **Site mode.** The store hides the cart, wishlist, shopper account, order tracking and product search; the header's
  main button is "Apply for admission" (`storefront-ui` `lib/site.ts`, `siteOnly` / `siteCta`).
- **Programmes** are catalogue items of kind `service` (SAC 9992, GST 0%: education by a school is exempt, Notification
  12/2017-Central Tax (Rate), entry 66), one per stage or club. They carry no fee: a ₹0 price shows as "Price on request" in any shop and "Fee on enquiry" for a `site` pack
  (`Price` in `storefront-ui` `components/bits.tsx`) and the service page's steps talk about the fee call-back, not a
  bill after the service. Never put an invented fee in a demo.
- **Enquiry form.** The CMS element `enquiry-form` (home section and page block) posts to the enquiries module
  (`POST /v1/enquiries/public`). Fields: child's name, class applying for (choice list), phone, e-mail, message, topic
  (e.g. "Admission 2027-28"). Parents' enquiries land in the **Enquiries** list of the services app (`enquiries-ui`).
- **Campus visit.** A free bookable service (45 min, billing item kept off the store) with weekly office hours and a
  counsellor or two, so `/book` works for parents (`demo-stores/thamarai-setup.ts`).
- **News.** CMS blog posts; the home's `blog-posts` section and `/blog` show them (needs `cms.blog` on).

## Demo store: Thamarai Vidyalaya

`thamarai.localhost:3003` (admin and desk `thamarai.localhost:3008`): a fictional Matriculation Higher Secondary School in
Thillai Nagar, Tiruchirappalli (placeholder address, phone `+91 98765 00023`, GSTIN with a valid check digit). Look
`thamarai-lotus` (`theme-presets-thamarai.ts`: ivory page, lotus maroon, Playfair Display over Hind Madurai, kolam motif).
Data: `apps/api/src/demo-stores/thamarai*.ts` (store, programmes, content with pages / posts / FAQ, photos, setup).
Home in English and Tamil, pages (admissions, about, academics, facilities, transport, fees, contact, privacy policy,
photo credits) and four news posts. Fees are never quoted: the fees page says they are given at the counselling visit.

```
pnpm --filter @rbms/api seed:stores thamarai            # first time
pnpm --filter @rbms/api seed:stores thamarai --refresh-home
```

A `DemoStore` may carry `posts` (published by the seed, matched by slug) and, for a website-only trade, a catalogue of
10+ priced-at-zero programmes (`demo-stores.test.ts` allows it for packs with `site: true`).

## Enquiries module (`@rbms/enquiries`, `/v1/enquiries`, migration `0056_enquiries`)

Feature `enquiries` (in the EC, PH, RS, SV and SC profiles, every plan; shop switch, on by default only in the School
app SC: `defaultOnApps: ["SC"]`, other shops switch it on), permission `enquiries.manage`.

- **Website** (no sign-in, store proxy allows only this path): `POST /public { name, phone, email?, topic?, studentName?,
  option?, message?, source?, noticeVersion?, website? }` → `{ ok, number: "ENQ-0007" }`. Indian mobile only (stored E.164).
  5 tries per shop + IP in 10 min and 300 per shop an hour (429 `rate_limited`; counted in the API's Redis-shared
  rate-limit counter, `sharedWindowCounter` in `apps/api/src/http-guard.ts`, so all instances count together). `website` is a
  honeypot: filled → `{ ok, number: null }`, nothing stored. Same phone + topic within 30 min → the first enquiry's number.
- **Staff**: `GET /enquiries` (paged; q, status, topic, from, to; `facets.status`, `topics`), `GET|PATCH|DELETE
  /enquiries/:id` (`PATCH { status?, note? }`; leaving `new` sets `contactedAt`), `GET /summary` (dashboard tile).
  Statuses new → contacted → follow_up → converted ("Admitted" for a school) / closed.
- **Owner alert** (`apps/api/src/kit-enquiries.ts`, template `enquiry.received`): each owner / admin gets one alert on
  the first channel that takes it: push, else WhatsApp, else email, linking to `/enquiries/:id` in their app. At most
  10 alerts per shop an hour (`ALERT_RATE`); past that one job `enquiries.alert-digest` runs when the hour's window ends
  and sends `enquiry.digest` ("N more website enquiries came in this past hour", link to `/enquiries`).
- **Privacy (DPDP)**: the notice lists enquiries (what, why, how long) when the feature is on; rights requests find,
  export and erase enquiries by phone or email (handler `enquiries`); retention category `website_enquiries` (default 2
  years, min 30 days, delete). The form shows the privacy notice line and sends the notice version it showed.

## The School app (`SC`)

- **Profile** (`seed-fixtures.ts`): storefront, `cms.*` (pages, blog, SEO), seo, custom-domain, enquiries, `bookings.*`,
  catalogue, analytics, onboarding, staff, audit, chat, `support.*` (help desk + FAQ), ai, subscriptions. No billing,
  stock, orders, POS, payments, delivery, coupons, loyalty, memberships, job cards, payroll, WhatsApp or accounting.
- **Plans** `sc-free` / `sc-starter` / `sc-pro` / `sc-enterprise` (the shared tiers ∩ the profile): Free = website,
  enquiries, campus visits; Starter adds news (blog), chat, analytics, staff; Pro adds custom domain and the help FAQ.
  Prices are PLACEHOLDERS (Starter ₹599, Pro ₹1,499 a month); set the real ones in Platform → Apps & features → School.
  The custom-domain add-on is offered on Starter.
- **Admin** `apps/school` (:3009): Enquiries, Appointments, programmes (catalogue), website (site-ui), inbox (chat,
  support, FAQ), workspace. CORS and `APP_PUBLIC_URL` list :3009; owner alerts link there.
- **Sign-up**: www offers "School" (`?app=school`); the pack's app is `SC`, so a school signs up straight into it.
  Setup steps that need billing (business details, first bill) are hidden where `invoices` is off.
- **Moving an existing shop** to the School app: set `tenants.app_id = 'SC'` and the plan (and its `subscriptions` row)
  to the matching `sc-*` plan.
