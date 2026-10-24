# AI foundation (Phase 0)

The shared plumbing every AI helper uses: one entry point (`ai.run`), switches, credits, privacy defaults, draft feedback,
usage screens and evals. **Phase 0 ships no end-user AI helper.** The only things a shop sees are Settings > AI (switch,
helper list, credits, recent uses) and a one-credit "Test AI" button. Ask your shop, HSN suggestions, product descriptions,
bill scanning and Studio are built on this in later phases.

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
