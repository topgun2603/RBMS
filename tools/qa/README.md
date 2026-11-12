# QA toolkit

Attacks the platform with bad data and measures test coverage, on a throwaway copy. It never touches the real database:
everything runs against `rbms_qa`, with in-memory jobs and every outside provider switched off (`lib.mjs`). Results go to
`tools/qa/out/` (not committed); open `out/report.html`.

Needs Docker running (`pnpm infra:up`). Run from the repo root, in this order:

| Step | Command | What it does |
|---|---|---|
| 1 | `node -e "import('./tools/qa/lib.mjs').then(m=>{m.setup();process.exit(0)})"` | Creates and seeds the copy (about 10 minutes, first time only) |
| 2 | `node tools/qa/record.mjs` | Runs the flow tests and keeps every real request they send |
| 3 | `node tools/qa/bad-data.mjs` | Corrupts every field of the recorded requests, then junk on all 1,400+ routes (about 8 minutes) |
| 4 | `node tools/qa/money-attack.mjs` | Bad behaviour on bills, payments, returns, stock and other shops' data, with hand-written answers |
| 5 | `node tools/qa/coverage.mjs` | Every package's tests with coverage, database tests on (about 15 minutes) |
| 6 | `node tools/qa/report.mjs` | Builds the report |

Run `pnpm --filter @rbms/api seed:e2e` with the QA settings before step 2 on a repeat run, and again before step 4: the attacks
cancel the test shops' plans and use up their monthly bill limit, and a refusal for that reason proves nothing. Never reseed
between steps 2 and 3: seeding archives the products the recording points at, so its requests fail as "item no longer exists".

`triage.json` holds what a person confirmed by reproducing it by hand (`repro.mjs`); keep it current.

`pnpm --filter @rbms/www test:home` is separate: it drives the marketing page in Chrome, and needs that site running.

What a number means: a route counts as "reached" only when its untouched request still works, because otherwise a refusal says
nothing about the bad value. High coverage only means code ran, not that it is right.
