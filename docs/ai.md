# AI foundation (Phase 0)

The shared plumbing every AI helper uses: one entry point (`ai.run`), switches, credits, privacy defaults, draft feedback,
usage screens and evals. Phase 0 is only the plumbing: Settings > AI (switch, helper list, credits, recent uses) and a
one-credit "Test AI" button. The Phase 1 text helpers (HSN suggestions, product descriptions and Tamil translation, import
mapping, the help assistant) are built on it: see "Phase 1: text helpers" below. Ask your shop and Studio come later.

**No API key is needed to develop.** Without `ANTHROPIC_API_KEY`, outside production, a deterministic sample provider (the
`MockProvider`) answers, so the app, the tests and the evals run with no network and no cost. Nothing in Phase 0 has been
run against the real Claude API.

## Architecture

```
caller (a helper's route/service)
   |  ai.service.run({ tenantId, feature, tier, system, input, schema?, tools? })
   v
AiService (packages/ai/src/service.ts)
   1. platform kill switch (AI_ENABLED)            -> 503 ai_disabled
   2. provider present? (production needs a key)   -> 503 ai_unavailable
   3. `ai` feature on for the shop (plan, app, Settings > Features)  -> 403 ai_not_available
   4. shop opt-in (settings ai.enabled)            -> 403 ai_off
   5. per-helper switch (settings ai.features)     -> 403 ai_feature_off
   6. credits left this month                      -> 402 ai_credits_exhausted
   7. mask the text (phones, emails, optional GSTIN), build the request
   8. AiProvider.complete()  (ClaudeProvider | MockProvider), looping over read-only tools when given
   9. stop_reason first: refusal -> 422 ai_refused, max_tokens -> 502 ai_truncated, then parse + validate (zod)
  10. charge the actual usage (never more than is left), record the run (metadata only)
   v
{ output, runId, usage, credits, model, provider }   a DRAFT: show it, let the person confirm, report feedback
```

Every blocked or failed run is recorded too (`status` blocked / error / refused), so the owner can see why.

### Files

| Where | What |
|---|---|
| `packages/ai/src/service.ts` | `AiService`: `run`, `feedback`, `status`, `usage`, `recentRuns`, `adminUsage`, `purgeDebug` |
| `packages/ai/src/claude-provider.ts` | `ClaudeProvider` (official `@anthropic-ai/sdk`) |
| `packages/ai/src/mock-provider.ts` | `MockProvider`: deterministic, canned, with `[mock:refuse]` / `[mock:truncate]` / `[mock:fail]` markers |
| `packages/ai/src/config.ts` | env variables, provider selection, models per tier |
| `packages/ai/src/pricing.ts` | model rates (one map), cost and credit maths |
| `packages/ai/src/masking.ts` | `maskText`, `maskPhone`, `maskEmail`, `maskGstin`, `pick`, `clip` |
| `packages/ai/src/features.ts` | the helper registry, feature + permission keys, settings schema |
| `packages/ai/src/schema.ts` | table `ai_runs` (migration `0035_ai_foundation`) |
| `packages/ai/src/routes.ts` | `/v1/ai/*` and `/v1/admin/ai/usage` |
| `packages/ai/evals/` | 100-case dataset, runner, README, `bills/` README |
| `apps/api/src/kit-ai.ts` | wiring: credits on the plans module, shop names |
| `packages/web/src/components/ai-draft.tsx` | `AiDraftBanner` (en + ta) |
| `packages/workspace-ui/src/pages/ai.tsx` | Settings > AI page (every app that mounts the workspace module) |
| `apps/admin/src/app/(dashboard)/platform/ai/page.tsx` | platform AI usage table |

## The two switches and the shop opt-in

| Switch | Who | Where |
|---|---|---|
| Platform kill switch | you | env `AI_ENABLED` (default on in development, **off in production** until you set `true`) |
| Feature `ai` | you (plan / app profile), owner may hide it | Platform > Apps & features, Settings > Features (`shopToggle`, default on) |
| Shop opt-in | owner / admin | Settings > AI, settings namespace `ai`: `enabled` (**default false**), `features` (per-helper allow map; a helper not listed follows `enabled`), `maskGstin`, `storePrompts` |

Permissions: `ai.use` (run helpers, give feedback; the staff **Manager** template has it), `ai.manage` (usage, recent runs,
Test AI; owners and admins hold every permission). The read-only demo role holds neither, and the demo guard refuses every
write anyway, so a demo session can never spend credits.

## Models per tier

| Tier | Env | Default | For |
|---|---|---|---|
| light | `AI_MODEL_LIGHT` | `claude-haiku-5-5` | classification, short answers, HSN, intents |
| standard | `AI_MODEL_STANDARD` | `claude-opus-5-5` | writing, "Ask your shop" with tools |
| vision | `AI_MODEL_VISION` | `claude-opus-5-5` | photos and PDFs (supplier bills, products) |

**To save cost, set `AI_MODEL_STANDARD=claude-sonnet-5-5` and `AI_MODEL_VISION=claude-sonnet-5-5`** (about half the price of
Opus 5.5). Use exact ids, no date suffix. Run the evals (`--live`) after a model change.

Request rules the provider follows (these models reject the old parameters): no `temperature`, `top_p`, `top_k`, no
`thinking` block (thinking is always on; depth is `output_config.effort`, default `low` for light and `medium` otherwise),
no assistant prefill, no forced `tool_choice` (tools use `strict: true` with auto choice), structured output through
`output_config.format` (JSON schema) validated again with zod. `max_tokens` caps thinking **plus** the reply (default 4096),
so a too-small cap shows up as `ai_truncated`. The stable `system` prompt is sent with `cache_control: ephemeral`, so keep it
identical between calls (no dates or ids in it). On `claude-opus-5-*` the provider asks for the server-side refusal fallback
(beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`) and prices every attempt from `usage.iterations`.

## Credits and money

```
1 credit = $0.001 of model cost = 1,000 micro-USD         (CREDIT_MICRO_USD in pricing.ts)
cost (micro-USD) = input x rate_in + output x rate_out + cache_read x rate_cr + cache_write x rate_cw   ($/MTok = micro-USD per token)
credits = ceil(cost / 1000), at least 1 for any run that used tokens
```

| Model | In | Out | Cache read | Cache write (5 min) |
|---|---:|---:|---:|---:|
| claude-opus-5-5 | $4 | $20 | $0.20 | $5 |
| claude-sonnet-5-5 | $2 | $10 | $0.20 | $2.50 |
| claude-haiku-5-5 | $0.10 | $0.50 | $0.01 | $0.125 |

Worked example, one "Ask your shop" answer on the standard tier (3,000 tokens in, 800 out including thinking):

```
3,000 x 4 + 800 x 20 = 12,000 + 16,000 = 28,000 micro-USD = $0.028
28,000 / 1,000       = 28 credits
$0.028 x Rs 85       = about Rs 2.38 of model cost
```

The same answer on Sonnet 5.5 is 14 credits (Rs 1.19). A light-tier classification (3,000 in, 400 out on Haiku) costs 500
micro-USD, charged as 1 credit (about Rs 0.09).

**Allowance.** The plan limit `ai_credits_per_month` (a `_per_month` key, so the plans module resets it by itself at the start
of each IST month, with no cron). Plan allowances seeded for every app (placeholders until pricing is decided):

| Plan | Credits / month | Model cost at most |
|---|---:|---:|
| Free | 50 | $0.05 (about Rs 4) |
| Starter | 2,000 | $2 (about Rs 170) |
| Pro | 10,000 | $10 (about Rs 850) |
| Enterprise | unlimited (-1) | not capped |

**Top-ups.** The `credits` add-on `<app>-ai-credits-5000` (5,000 credits, one-time, placeholder Rs 599 before GST) in
Platform > Apps & features > Add-ons; it grants `{ ai_credits_per_month: 5000 }` into the shop's credit balance, which the
plans module spends **after** the monthly allowance and which never expires. `AiService` only asks `CreditsPort` for the
balance and to charge; `apps/api/src/kit-ai.ts` backs it with `plans.limit/usage/credits/consume`.

Before each run the balance is checked (402 `ai_credits_exhausted` with a friendly message when nothing is left); after the
run the actual usage is charged, never more than is left. During a tool loop the run stops once its cost reaches what is left.
`ai_runs` is the ledger: its `credits` summed per `period` is what the shop spent.

Margins: price the packs and the plans above the model cost, and add GST. Rupee cost moves with the exchange rate
(`AI_USD_INR` only changes the rupees shown on the settings page).

## API

| Route | Who | Notes |
|---|---|---|
| `GET /v1/ai/status` | any member | ready?, provider (`claude`/`mock`), models, credits (allowance, used, top-up, remaining), helpers with switches |
| `GET /v1/ai/usage?days=30` | `ai.manage` | by helper and by day, share of drafts accepted without edits |
| `GET /v1/ai/runs?limit=25` | `ai.manage` | recent runs, **no prompt or reply text** |
| `POST /v1/ai/runs/:id/feedback` | `ai.use` | `{ outcome: "accepted"\|"edited"\|"rejected", note? }` |
| `POST /v1/ai/ping` | `ai.manage` | the one-credit Test AI; send a body (`{}`) |
| `GET /v1/settings/ai`, `PUT /v1/settings/ai/tenant` | owner / admin | `enabled`, `features`, `maskGstin`, `storePrompts` (settings merge one level deep, so send `features` whole) |
| `GET /v1/admin/ai/usage?month=YYYY-MM` | super-admin | per shop: calls, failures, tokens, cost, credits |

Error codes: `ai_disabled`, `ai_unavailable` (503), `ai_not_available`, `ai_off`, `ai_feature_off` (403),
`ai_credits_exhausted` (402), `ai_refused` (422), `ai_busy` (503, rate limit or overload), `ai_failed`, `ai_truncated`,
`ai_invalid_output`, `ai_too_many_steps` (502), `ai_input_too_large` (413). Friendly en + ta messages live in
`web.errors.ai_*`, so `describeError` shows them.

## Adding a helper with `ai.run`

1. Add it to `AI_FEATURE_REGISTRY` in `packages/ai/src/features.ts` (key, tier, en + ta label and description) with
   `status: "soon"`. It appears greyed in Settings > AI. Set `"live"` when it ships.
2. In your service, depend on `AiService` (`kit.ai.service`) and call it. Keep the system prompt a constant:

```ts
const r = await ai.service.run({
  tenantId,                       // only this shop's data may go into the prompt
  userId,
  feature: "hsn-suggest",         // the registry key
  tier: "light",
  system: HSN_SYSTEM,             // stable text: cached
  input: { text: `Item: ${itemName}` },   // minimise: send the name, not the whole item row (see pick/clip)
  schema: { name: "hsn", jsonSchema: HSN_JSON_SCHEMA, zod: HsnSchema },
});
// r.output is validated; r.runId goes to the client with the draft
```

3. Return `{ draft: r.output, runId: r.runId, credits: r.credits }` and show the draft with
   `<AiDraftBanner runId={...} credits={...} onOutcome={...} />` (from `@srirealtime/web`). Apply nothing until the person
   confirms; the buttons call `POST /v1/ai/runs/:id/feedback`.
4. Put the route behind `config: { feature: "ai", permission: "ai.use" }`. Let `AppError`s from `run` reach the client
   unchanged; they carry the right status and code.
5. Add cases to `packages/ai/evals/dataset.json` and a spec in `evals/specs.ts`; run `eval` (mock) in CI and `--live` before
   switching the helper on.

Images and PDFs: `input: { images: [{ mediaType, data }], pdfs: [{ data }] }` (base64), tier `vision` only, 20 MB of base64
at most. Tools (for "Ask your shop"): `tools: [{ name, description, inputSchema, run }]`. `run` must only **read**, and only
from the caller's tenant (close over `tenantId`; never take a tenant from the model's input). `maxSteps` (default 6, max 12)
stops a runaway loop, results over 20,000 characters are cut, a throwing tool is reported to the model as an error.

## Privacy and DPDP

What is sent, stored and kept:

- **Opt-in.** Nothing goes to a model until the owner switches AI on (default off), and a helper can be switched off alone.
- **Minimise.** Callers send only the fields a question needs (`pick`, `clip`). `run` masks the text by default: phone
  numbers keep the last 4 digits (`XXXXXX3210`), emails become `r***@gmail.com`; GSTINs are masked on request
  (`maskGstin`). Images and PDFs cannot be masked: redact before sending, and never send an image of an ID card.
- **Never send:** Aadhaar, PAN of individuals, bank or card numbers, passwords, OTPs, prescriptions or other health data,
  children's data. If a future helper needs one of these, design it with its own review first.
- **Tenant isolation.** The model only sees what the calling service puts in the prompt or returns from a tool, and those
  services are given one `tenantId`. `ai_runs` rows are always read and written with the tenant; feedback on another shop's
  run is a 404.
- **No content stored by default.** `ai_runs` holds who, which helper, model, token counts, cost, credits, outcome and
  timing. The shop can switch on "Keep prompts for debugging": the masked input and the reply are then kept in
  `ai_runs.debug` for **7 days** (job `ai.purge-debug`, daily) and never shown in the screens.
- **Logs** carry metadata only (feature, tenant id, error text), never prompts or replies. Provider error text is not shown
  to the shop.
- **Roles.** The shop is the data fiduciary for its customers' data; the platform processes it on the shop's behalf and
  Anthropic is a sub-processor. Before going live: confirm the data-processing terms with Anthropic (retention of API inputs,
  no training on API data, zero-data-retention options), list Anthropic as a sub-processor in the privacy policy, and note
  that data is processed outside India (cross-border transfer is allowed under the DPDP Act unless the government restricts a
  country; keep an eye on notifications).
- **Erasure / access.** Runs hold no personal content. If a user is erased, run rows keep only the opaque `user_id`; clear it
  with the user's other references if your erasure process requires.
- **Every result is a draft.** Nothing is saved, sent or changed by AI without a person confirming. Feedback is recorded so
  the "saved without edits" rate can be measured per helper (`GET /v1/ai/usage` -> `savedWithoutEdits`).

This is engineering guidance, not legal advice; have the privacy policy and terms reviewed before launch.

## Evals

`pnpm --filter @srirealtime/ai eval` runs 100 Tamil / Tanglish / English prompts (Ask your shop, HSN, product descriptions,
Studio, safety) through the real `AiService` on the **mock provider**, then writes `evals/reports/*.md|json`. Add `--live` to
call the real API (costs about 30 cents on the defaults; refuses to start above `--max-cost`, default $2). See
`packages/ai/evals/README.md`. For supplier-bill photos the owner drops 20 real, redacted bills in `evals/bills/`
(`evals/bills/README.md`); none are made up.

## Phase 1: text helpers

Four helpers ship on the foundation (all drafts: nothing is saved until the person confirms; all in the registry as `live`):

| Helper (registry key) | Tier | Where | Cost (about) | Who (permissions) |
|---|---|---|---|---|
| HSN and GST suggestions (`hsn-suggest`) | light, standard only when confidence is low | "Suggest HSN & GST" under the HSN field of Billing > Items, the catalogue product editor and the POS "not found: add it" dialog | 1 credit | `ai.use` + (`catalogue.manage` or `invoices.create`) |
| Product descriptions (`product-description`) | standard (effort low) | "Write description" in the product editor; "Translate to Tamil" in the product list's bulk bar | 15-20 credits a product | `ai.use` + `catalogue.manage` |
| Smart import mapping (`import-mapping`) | light | "Suggest mapping with AI" in Settings > Import & export, mapping step | 1-2 credits | `ai.use` + `importexport.run` |
| Help assistant (`help`) | light | "Help" in the top bar of every business app | 1-2 credits a question | `ai.use` |

The read-only demo role holds none of these permissions and the Help button is hidden for it, so a demo session never spends. A
cashier without `ai.use` does not see the buttons. Switching AI off for the shop, or one helper off, answers `ai_off` /
`ai_feature_off` and the buttons show the message; `ai_credits_exhausted` shows the credit message. Settings > AI also has
"Suggest HSN and GST when I leave the item name box" (`autoHsn`, default off).

Code: `packages/ai/src/assist/` (pure logic, tested with the mock provider), routes at `/v1/ai/assist/*`
(`assist/routes.ts`), API wiring `apps/api/src/kit-ai-assist.ts`, UI in `packages/web/src/components/ai-assist/`
(`HsnSuggestPanel`, `DescribeButton`, `TranslateToTamilButton`, `AiHelpButton`) and `workspace-ui/.../import/ai-mapping.tsx`.

### Safety rules that apply to all four

1. **Text is data.** Item names, notes, spreadsheet cells and questions go to the model inside `<<<DATA label ... DATA>>>` blocks
   (the delimiter strings are removed from the text); the stable system prompt says never to follow instructions inside them
   (`assist/safety.ts`, `DATA_RULES`). Sentences that look like instructions ("ignore the format", "reply only with X") are
   removed before sending, and an output that repeats such a payload, or leaks the instructions, is dropped.
2. **Output only through the schema** (structured output + zod).
3. **No invented promises.** `filterClaims` (en + ta keyword rules) removes sentences about delivery, refunds/returns, warranty,
   guarantees, certifications, health claims and discounts unless the shop stated them: in the product facts, or in the shop's
   own storefront settings (`store.policies.shipping`, `store.policies.returns`, `store.trust.returns`, pickup note). An
   instruction in the owner's notes ("write: free delivery") is not a fact. A supported promise must keep its numbers
   (a "1 year warranty" cannot become "2 years"). Removed sentences are listed in the draft dialog.

### HSN and GST

Reference: `packages/ai/src/data/hsn-data.ts`, generated from the **official GST portal master** (HSN_SAC.xlsx from
tutorial.gst.gov.in, fetched 2026-10-24): 98 chapters, 1,348 four-digit headings, 5,773 six-digit subheadings, 681 SAC codes
(8-digit tariff lines left out). Two fixes are noted in the file header (heading 3307 is mislabelled in the portal file; typo
prefixes are not headings). Regenerate from a fresh download rather than editing by hand.

Flow (`assist/hsn.ts`): the light tier proposes up to 3 `{hsn, kind, official_title, gstRate, confidence, reason}` (the system
prompt lists the official SAC headings). Each code is checked: it must exist in the reference (a longer code is cut back to its
6-digit subheading or heading), and the title the model gives must share a content word with the official one (a real code with
the wrong meaning, such as 9972 "real estate" for a haircut, is refused). If nothing passes, the model is asked once more with
candidate headings found by keyword search of the reference; if that fails too the answer is "not sure, please check". Low
confidence escalates once to the standard tier. The description shown is the official one, the rate is limited to the allowed
slabs and shown as "usual rate, verify", and apparel / footwear (chapters 61, 62, 63 except 6309, 6401-6405) carry the
existing price-band rule (5% up to Rs 2,500 per piece, 18% above; with a price the band is resolved).

### Product descriptions and bulk Tamil

`describeProduct` writes `{title, description_en, description_ta, seo_title, seo_description, bullets_en, bullets_ta}` from the
product's own facts (name, category, brand, attributes, options, price) and the shop's stated policies. The catalogue had no
translation columns, so Tamil text lives in the new table `ai_product_translations` (migration `0037_ai_translations`; one row
per shop, product and locale; `approved` rows are what a storefront may show; `TranslationService.approvedFor` and
`GET /v1/ai/assist/translations/approved?ids=` read them). Showing it on the storefront is not wired yet.

Bulk: select products in the product list, "Translate to Tamil" shows the credit estimate (`POST /translate/estimate`, refuses
a batch the credits cannot pay for) and starts the job `ai.translate-batch` (rows become `draft`); "Review Tamil drafts" lets
the owner edit and approve or reject each one (or approve all). A switched-off helper or empty credits stops the batch and marks
the rest `failed`. At most 100 products per batch.

### Import mapping

Only the header row, 5 sample rows (phones, e-mails and GSTINs masked, cells cut at 40 characters) and the importer's field
list are sent. The server keeps only known fields, columns inside the file and one field per column (higher confidence wins);
the wizard merges the picks into the mapping the owner is already looking at and notes the low-confidence ones.

### Help assistant

`assist/help.ts` chunks `docs/guides/*.md` (user manual, product guides en/ta, admin guide at lower weight) into sections at
start and searches them with BM25 in code (no embeddings), plus a Tamil/Tanglish glossary that maps Tamil words to the English
words the manual uses. The top sections go to the light tier; the stable system prompt (rules and the guides' table of
contents) is cached. No matching section: "I don't know, contact support" with no model call and no credit. Questions about the
shop's own data are refused (that is Phase 2). Screens a section names (Items, Invoices, Settings > Import...) become links in
the panel. Rate limit: 8 questions a minute per user (in memory, per API process). The API reads the guides from `docs/guides`
(or `AI_GUIDES_DIR`): ship that folder with the API image.

### Phase 1 evals

`pnpm --filter @srirealtime/ai eval:phase1 [--live] [--group=hsn|desc|mapping|help] [--max-cost=1]`: 41 HSN cases (the 30 old
ones plus agarbatti regressions and an injection), 24 description cases (the old 22 plus two claim / injection cases), 15 mapping
cases built from the real Vyapar / Tally / Busy / Marg presets, 20 help questions on the real guides. Reports go to
`evals/reports`. A live run of all of it costs about $0.25.

## Going live

1. Create an Anthropic API key (a dedicated workspace for srikit) and **set a monthly spend limit** in the Anthropic
   Console before the first request. Credits protect each shop; the spend limit protects you.
2. Set `ANTHROPIC_API_KEY` as a secret on the API service (and the worker), and `AI_ENABLED=true`. In production without a
   key every AI call answers 503 `ai_unavailable`.
3. Choose models (`AI_MODEL_*`); keep the defaults or move standard / vision to `claude-sonnet-5-5`.
4. Run `pnpm --filter @srirealtime/ai eval --live` and read the Tamil outputs.
5. Check Platform > AI usage after a day; check the Anthropic Console against the "Model cost" column (they should agree
   within a few percent; if not, fix the rate map in `pricing.ts`).
6. Review the plan allowances and the credits pack price in Platform > Apps & features.
7. Update the privacy policy and terms (sub-processor, cross-border processing).

## Tests

`pnpm --filter @srirealtime/ai test` (provider routing, mock, structured output, refusal / `max_tokens`, credits, switches,
masking, routes and permissions; the SDK client is faked, no network). `AI_TEST_DATABASE_URL=postgres://... pnpm --filter
@srirealtime/ai test` also runs the database test (feedback, usage, platform table, purge) in a throw-away schema.
`apps/api` has `kit-ai.test.ts` for the credits adapter on the plans module.

## Scan a supplier bill / an expense receipt (Phase 1, vision)

Two helpers on the vision tier (`bill-scan`, `receipt-scan` in the registry, both live; each has its own switch in Settings > AI).
They **draft only**: the API never saves a purchase or an expense, the owner edits and saves through the normal screens, and
`AiDraftBanner` reports accepted / edited / rejected (`POST /v1/ai/runs/:id/feedback`; saving untouched or edited reports
it by itself).

| Route | Needs | Fills |
|---|---|---|
| `POST /v1/ai/scan/purchase-bill` | `ai.use` + `inventory.purchases` (feature `inventory.purchases`) | New purchase (billing-ui `PurchaseForm`) |
| `POST /v1/ai/scan/receipt` | `ai.use` + `expenses.manage` (feature `expenses`) | Expense dialog |

Body: `{ images: [{ mediaType, data }] }` (1 to 6 photos, base64) or `{ pdf: { data } }` (one multi-page PDF), 20 MB of base64
at most; the first bytes of every file must match its type (`ai_bad_image` otherwise). The browser shrinks photos to 1800 px
JPEG before sending. HEIC works only where the browser can open it (phones, Safari); otherwise the user is told to share a JPG.
Code: prompts and strict JSON schemas in `packages/ai/src/vision/` (`bill.ts`, `receipt.ts`, `shared.ts`), checks in
`apps/api/src/ai-vision/` (`common.ts`, `bill.ts`, `receipt.ts`), routes in `apps/api/src/kit-ai-vision.ts`, UI in
`packages/billing-ui/src/components/ai/` and `lib/ai-scan.ts`, strings `lib/messages/ai-scan.ts` (en + ta).

**Cost.** About 25 to 45 credits a bill and 7 to 16 a receipt on `claude-opus-5-5` (measured: $0.024 to $0.045 per bill, $0.006
to $0.016 per receipt); the UI says "about 40" / "about 15" before scanning. Effort is `low`. The schema asks for rupees as
printed (not paise: models misread x100 less when copying) and the server converts to paise. The model API allows 16 nullable
fields per schema, so text is "" when missing and only numbers are nullable.

**The model is never trusted.** After the call, `processBill` / `processReceipt` clean and check every field and return flags
(`billing.ai.flag.<code>`, severity error / warn / info) that the form shows next to the draft; a failed field is dropped, not
passed on:

- Text from the image is data. The system prompt says to ignore instructions in the document; text fields are stripped of
  control/bidi characters and markup, clipped, and any field that reads like an instruction to an AI is removed with an
  `injection` flag. Output only goes through the schema (zod, tolerant per field).
- Dates must be real and not in the future (older than 3 years: warning). Amounts: 0 to Rs 2 crore, no negatives; qty 0 to
  1,000,000. GSTIN: format and checksum (`isValidGstin`). HSN: 4 to 8 digits. GST rate: must be in `GST_RATES` of `packages/gst`;
  a legal slab the app does not have yet (0.1, 1.5, 40) is reported as `gst_rate_unsupported`. Expiry `YYYY-MM` becomes the last day of the month.
- Supplier: matched by GSTIN, then by name (never to a supplier with a different valid GSTIN); otherwise filled as a one-off
  supplier. Lines: matched to saved items by name (exact, close; sizes in the name must agree), unmatched lines get a
  "Create item" link that opens the normal item dialog. (The items API has no SKU or barcode search, so name only.)
- GST maths: lines are computed with `computeLine`; taxable, tax and total are compared with the printed totals (Rs 1 plus 50
  paise per line of slack); the bill must add up by itself; CGST/SGST versus IGST is checked against the supplier state
  (GSTIN, else printed state) and the shop's state (billing profile).
- Pharmacy shops (feature `medicines` on): every line needs a batch and an expiry, otherwise a flag and a highlighted field; expired batches are flagged everywhere.
- Fields the model marked "low" confidence, and fields a check failed, are tinted until the owner edits them.

**Photos are not kept.** Nothing in the AI code stores the image (run rows hold metadata only). Purchases have no attachment
feature, so there is no "attach the photo" for bills. Expenses do (`receiptUrl`): after a receipt scan the dialog offers
"Attach this photo as the receipt", which uses the normal upload.

**Errors the owner sees:** AI off for the shop or the helper (with a link to Settings > AI), credits used up, photo unreadable
(`ai_unreadable_image`, 422: "retake in good light"), unusable file, busy.

**Evals.** `pnpm --filter @srirealtime/ai eval:vision [-- --live --group=purchase-bill|receipt --only=NN --max-cost=1]` reads
`evals/bills/*` (the owner's real bills) and `evals/bills/synthetic/*` with `<name>.expected.json` and scores the raw reading per
field. The synthetic set (`synthetic/generate.mjs`, puppeteer) is made up and every image says so: 3 clean bills (one pharmacy
with batch and expiry, one inter-state/IGST photo), a blurred low-light photo, a bill carrying a hidden "ignore previous
instructions" note, 2 receipts and an unreadable dark frame. They only stand in until the owner supplies 20 real bills.
First live run, `claude-opus-5-5`: 100% of fields on all of them (about 220 checks) including the injection bill and the
unreadable frame, total cost about $0.20. Clean synthetic bills are far easier than real ones: expect lower numbers on real paper.
