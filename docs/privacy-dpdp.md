# Data privacy: India's DPDP Act 2023 and the DPDP Rules 2025

Gap item #21 in `docs/gap-analysis.md`. Migration `0054_privacy_dpdp`. Code: `packages/consent` (tables, services, routes), `apps/api/src/kit-privacy.ts`
(what each module's data is and how it is purged), the shop screen in `packages/workspace-ui` (Settings > Privacy & data), the shopper screens in
`packages/storefront-ui` (account > Privacy, `/policies/privacy`, sign-in / checkout / loyalty notice line) and the platform screen in `apps/admin`
(Platform > Data protection, Privacy > notice for shop owners).

**This is engineering work, not legal advice.** Every generated text carries a "review with your lawyer" note, and the list of things to confirm is at the
end of this page.

## Who is who

| Role | Who | What it means here |
|---|---|---|
| Data fiduciary | The **shop**, for its customers' data (shoppers, billed customers, loyalty and gym members, patients, WhatsApp contacts, staff) | Decides why and how the data is used. Gives the notice, answers the requests, keeps the breach register, names the grievance contact. |
| Data fiduciary | **RBMS (Retail & Business Management Suite)**, for shop owners' and staff accounts, sign-in records and billing | Same duties for its own users. |
| Data processor | **RBMS**, for the customer data a shop enters or collects | Stores and handles it on the shop's behalf. The platform tools below give the shop what it needs to meet its duties. |
| Sub-processors | Hosting, SMS / WhatsApp / email providers, payment gateways, the AI provider (outside India; see `docs/ai.md` "Privacy and DPDP") | Listed in the generated notices. |

## What existed before (audited, reused)

- `packages/consent`: the append-only consent log (`consent_records`: purpose, version, granted, source), user data export and
  delete-account with a grace period (`data_requests`, exporters / erasers registered by `apps/api/src/kit.ts`), the hourly job `consent.sweep`.
  These are about a **platform account** (the signed-in person). Unchanged.
- Admin pages: `Privacy` (your own consents, export, delete account) and `Platform > Privacy requests` (the account export / delete queue).
- `packages/audit`: every successful change by a signed-in user is recorded. The new staff routes set explicit audit actions.
- `ai.purge-debug` (7 days, AI prompts kept for debugging), `audit.purge` (400 days), `consent.sweep` (export files 7 days),
  `store.carts.purge` (expired carts): kept as they are; the retention screen lists the first three as "handled by job X".
- The store profile had a marketing opt-in checkbox and the WhatsApp contact has `optedIn` / `optedOutAt` (START / STOP keywords). The store checkbox is now
  also written to the consent log with the notice version; the WhatsApp keywords are not (listed under Not done).
- Gaps that were found: no notice, no shop-level rights requests, no retention schedule beyond the four jobs above, no breach process, no
  grievance contact. Those are what this work adds.

## 1. Notice (generated, versioned, en + ta)

`GET /v1/consent/notice` (public; the shop from the host) returns the current notice. The text is **generated** (`privacy-notice.ts`) from:

- the shop name, legal name and address (Settings > Billing);
- the features the shop has on (online store, loyalty, memberships, pharmacy prescriptions, payroll, WhatsApp, delivery, bookings / job cards) and
  whether AI is switched on;
- the grievance contact and response days (Settings > Privacy & data);
- the retention periods in force (so the notice says "WhatsApp conversations: 2 years" because that is what the job does);
- the shop's optional extra sentence.

Sections: who is responsible, what we collect, why, who else sees it, how long we keep it, your rights, how to withdraw consent, children,
questions and complaints (grievance contact and the Data Protection Board), changes.

**Versioning.** Whenever the generated text changes, a new row is stored in `privacy_notices` (version 1, 2, 3 ... per shop) the next time the notice
is read. The consent log stores `notice-v3` as the `version` of what a person accepted, so the exact text can be shown later.
`GET /v1/consent/notice/preview` (staff) shows both languages, the versions and the "review with your lawyer" warning.

**Where shoppers see it:** a one-line "By continuing you accept our privacy notice" at store sign-up (OTP and central sign-in), checkout and the
loyalty panel; a footer link and the page `/policies/privacy` (the shop's own privacy policy text, if it wrote one, then the generated notice);
the account's Privacy tab. On sign-in, on placing an order and when the marketing checkbox changes the store records `privacy_notice` /
`marketing` with the version (`POST /v1/consent`, best effort; it never blocks the shopper).

**Platform notice.** The same generator with no shop produces RBMS's notice for shop owners (`GET /v1/consent/notice` without a shop). It is shown in
Privacy (admin) and Platform > Data protection.

## 2. Rights requests

Types: access, correction, erasure, withdraw consent, nominate (s.14), and a grievance.

- **Shopper:** account > Privacy (`POST /v1/consent/rights`, `GET /rights/mine`, cancel, download the data copy once done).
- **Counter:** Settings > Privacy & data > Requests > "Take a request at the counter" (`POST /rights/counter`).
- **Queue:** `GET /v1/consent/rights` (paged, status / type / overdue filters). Every request gets a **due date** = created + `responseDays` (setting
  `privacy.responseDays`, default **30**, 1 to 90). The screen shows past-due counts.
- **Actions** (permission `privacy.manage`; owners and admins hold it): start work, add a note, **find their records** (matches by account, phone or
  email in every module below), **prepare a data copy** (JSON, also downloadable by the shopper), **erase**, mark done, reject (reason required).
- **Withdraw consent** is applied at once: the consent log gets `granted=false` with the notice version, marketing is switched off on the store
  account and the WhatsApp contact, and the request is closed.
- **Audit trail:** `privacy_request_events` (created, status, note, located, exported, erased, consent_withdrawn, cancelled, with the actor), and the
  host audit log (`privacy.request.*`).

**Erasure and legal retention.** Erasure anonymises the person in each module and **keeps tax and accounting records**; it tells the shop what was kept:

| Module | What is anonymised | What is kept |
|---|---|---|
| Online store account | name, phone, email, addresses, wishlist, carts, marketing flag | orders (sales records, GST 8 years); the account link is removed |
| Customer in the bills | name, phone, email, address, statement link (GSTIN only if there are no bills) | GST bills with the name and GSTIN printed on them (8 years, CGST Act s.36). **Not erased while bills are unpaid.** |
| Loyalty member | name, phone key, points | ledger lines without a person |
| Member (gym / salon) | name, phone, notes, photo (file deleted) | plan dates |
| WhatsApp contact | name, phone, tags, all messages; opt-out recorded | the row (so the number is not messaged again) |
| Help desk | tickets and messages of the person | nothing |

The request itself keeps a minimal proof (type, dates, counts, what was kept) and clears the person's name, phone, email and details. Consent
decisions are kept as a legal record with the IP and user agent cleared.

## 3. Retention

Settings > Privacy & data > Retention (shop) and Platform > Data protection > Retention (platform data). Per category: on / off, days, a legal floor
(a shorter value is raised to it), the last run, a **dry-run preview** that counts what a run would touch (nothing is changed; logged), and "Run now".
The nightly job `privacy.retention` (02:40, idempotent) runs the platform categories once and then every active shop; each category is isolated
(one failure does not stop the rest) and every run is written to `privacy_retention_runs`.

| Category | Default | Floor | Action | Notes |
|---|---|---|---|---|
| `abandoned_carts` | 30 days | 1 | delete | `store_carts` not updated |
| `inactive_store_customers` | 3 years | 1 year | anonymise | no activity and no order for the period; orders stay |
| `support_transcripts` | 3 years | 90 days | delete | resolved / closed tickets and messages |
| `chat_messages` | 2 years | 90 days | delete | |
| `whatsapp_chats` | 2 years | 90 days | delete | messages only; opt-in records stay |
| `prescriptions` | 3 years | 3 years | anonymise | patient name, age, phone, address, photo (file deleted); doctor, date and bill link stay |
| `lapsed_members` | 3 years | 1 year | anonymise | no plan ending within the period |
| `staff_after_exit` | 8 years | 3 years | anonymise | phone, bank, UPI, PAN / UAN / ESI of staff who left; pay runs and payslips stay |
| `kyc_documents` | 5 years | 1 year | delete | rows and files |
| `ai_run_inputs` | 7 days | | handled by `ai.purge-debug` | fixed |
| `otp_logs` (platform) | 30 days | 1 | delete | |
| `login_sessions` (platform) | 180 days | 30 days | delete | expired / revoked |
| `audit_log`, `data_exports` (platform) | 400 days, 7 days | | handled by `audit.purge`, `consent.sweep` | fixed |

**Never touched:** invoices, credit / debit notes, customer receipts, orders, payments, the books (journal), purchases, expenses, pay runs, GST
returns and e-invoices. A test (`apps/api/src/kit-privacy.test.ts`) fails if a category declares one of those tables.

## 4. Breach register

Settings > Privacy & data > Breaches (shop) and Platform > Data protection > Breaches (RBMS's own incidents, plus every shop's, read and managed by
super-admins). `breach_incidents`: reference BR-0001, what happened, seriousness, when it happened and was discovered, data types, people affected,
containment, cause.

- **72-hour countdown** from the discovery time to the detailed report to the Data Protection Board (`board_deadline_at`); states ok, due soon (last
  24 hours), overdue, done. The list shows how many open incidents are past their deadline.
- The owner records the **first intimation** and the **detailed report** (with the Board's acknowledgement number) and when the **affected people
  were informed**. Closing needs the Board report recorded.
- **Checklist:** stop the leak, keep evidence, assess, tell the Board, tell people, file the report, fix the cause, review.
- **Drafts** (English and Tamil): a message to the affected people (what happened, which data, what was done, what they can do, whom to contact) and
  notes for the Board report. **Nothing is sent automatically.** The owner copies the text.

## 5. Grievance contact

Settings namespace `privacy` (`grievanceName`, `grievanceRole`, `grievancePhone`, `grievanceEmail`, `grievanceAddress`, `responseDays`, `retention`,
`noticeExtra`). The app level is the platform's own contact and defaults; a shop's saved values override them. The contact is printed in the notice
and shown on the store's Privacy tab. Platform: Platform > Data protection > Notice & contact.

## API summary (all under `/v1/consent`)

Public: `GET /notice`. Shopper (signed in, in a shop): `POST /rights`, `GET /rights/mine`, `POST /rights/mine/:id/cancel`, `GET /rights/mine/:id/data`.
Staff (`privacy.manage`): `GET /notice/preview`, `GET /rights`, `GET /rights/handlers`, `POST /rights/counter`, `GET /rights/:id`,
`POST /rights/:id/{status,note,locate,access,erase}`, `GET /retention`, `POST /retention/{preview,run}`, `GET|POST /breaches`,
`GET|PATCH /breaches/:id`, `POST /breaches/:id/{checklist,board,people-notified,close}`. Super-admin without a shop: the same retention and breach
routes act on the platform (`/breaches?all=1` lists every shop's). API keys cannot reach `/v1/consent/*`. The store proxy only lets shoppers reach the
notice, recording consent and their own requests.

Jobs: `privacy.retention` (daily 02:40). Existing: `consent.sweep` (hourly).

## Tests

`packages/consent/src/privacy.test.ts` (notice content, both languages, modules, versions hash; retention floors; breach clock and drafts; request
helpers; settings), `apps/api/src/kit-privacy.test.ts` (no category touches tax tables, floors, handlers),
`packages/storefront-ui/src/lib/privacy.test.tsx` (strings, notice body, proxy allow-list),
`packages/workspace-ui/src/lib/privacy-messages.test.ts` (every key used in the screens exists in en and ta).

## Not done

- WhatsApp START / STOP are not written to the consent log.
- Per-purpose consent screens beyond `privacy_notice` and `marketing` (e.g. separate analytics or WhatsApp-offer purposes); a cookie banner.
- Consent for children (parent verification flow); the notice only states the rule.
- Chat conversations (`chat_*`) are purged by age but not located / erased per person in a rights request; orders and delivery addresses stay with the
  order (tax / sales record).
- Correction is by staff in each module's own screen (the request records and closes it).
- Automatic sending of breach notices; the Board's portal filing; consent managers.
- The Flutter business app and the mobile apps have no privacy screen.
- Reminders (e-mail / WhatsApp) to the owner before a request is due.
- Editing the generated notice text by hand (only an extra sentence); a customer-facing per-language switch on the notice page (it follows the store
  language).

## Not legal advice: items to confirm with a lawyer

1. **Commencement and timelines.** Which DPDP Rules 2025 obligations (notice, rights, breach, retention, security) apply from which date, and the
   final text of the Rules. The code is written for all of them being live.
2. **Response deadline.** The default is **30 days** (`privacy.responseDays`) and is a placeholder; confirm the period for rights requests and the
   maximum for grievances.
3. **Breach reporting.** The first intimation "without delay" and the detailed report within **72 hours** of becoming aware (or longer if the Board
   allows), what the report must contain, and whether a shop acting through a processor must tell the Board itself. Whether RBMS (processor) must
   tell the shop, and in what time.
4. **Notice wording.** Required content and language (the Rules need plain language and the 22 scheduled languages on request; the notice is English
   and Tamil), itemised purposes, how consent is withdrawn, and that the "continue = accept" line at sign-in is enough where a tick box may be
   needed. Whether the notice must be re-accepted after each new version.
5. **Retention periods.** GST records: **8 years** is used (CGST Act s.36 and the annual-return date); confirm the exact period. Pharmacy
   prescription register **3 years** (Drugs and Cosmetics Rules, Schedule H / H1 records). Staff records after exit (8 years default; Payment of
   Wages, PF, ESI, gratuity and income-tax record rules). KYC document periods. Inactive-account (3 years), chat, WhatsApp and help-desk periods are
   business choices to confirm. The Rules' own rule for e-commerce, gaming and social media platforms (erasure after 3 years of inactivity) if a
   shop's store is covered.
6. **Erasure vs. retention.** That anonymising the account link while keeping the invoice snapshot (name, GSTIN, address printed on a bill) is
   enough, and that a customer with unpaid bills can be refused erasure until settled.
7. **Cross-border transfer.** The AI provider, SMS / WhatsApp providers and hosting outside India; any government restriction on a country.
8. **Children and persons with disability.** Verifiable parental consent for under-18s, and the nominee (s.14) rules; the exemptions for health
   services that may apply to a pharmacy.
9. **Roles.** Shop = fiduciary and RBMS = processor, the processing contract between them (terms of service), and whether RBMS is a significant data
   fiduciary.
10. **Grievance officer / DPO.** Whether a named grievance officer is mandatory for a small shop, and what a shop with no contact filled in must show
    (the notice currently says the contact is not filled in).
11. **Consent log.** That recording `notice-vN` with the user, IP and time is sufficient proof of consent.
12. **Sub-processor list** in the notices (Anthropic and others), and the data-processing terms with each (`docs/ai.md`).
