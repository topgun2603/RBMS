# AI evals

A fixed set of 100 realistic shop prompts in Tamil, Tanglish and English for the helpers that come after Phase 0:
**Ask your shop** (34), **HSN suggestions** (28), **product descriptions** (20), **Studio** (10) and **safety** cases (8:
prompt injection, other shops' data, phone numbers in the text). Each case in `dataset.json` has a machine check
(`expect`) and a plain note saying what a good answer looks like.

```
pnpm --filter @rbms/ai eval                  # MockProvider: no network, no cost. Checks the pipeline only.
pnpm --filter @rbms/ai eval --live           # REAL Claude calls. Costs money. Needs ANTHROPIC_API_KEY.
```

Options: `--feature=ask-shop|hsn-suggest|product-description|studio`, `--lang=ta|tanglish|en`, `--limit=N`,
`--max-cost=USD` (live only, default 2: the run refuses to start when its estimate is higher), `--out=DIR`.

**Mock by default.** Without `--live` no request leaves the machine. The mock returns sample objects, so the report says
"not checked" for the content checks and only proves that masking, schema validation and the credit maths run end to end.

**Live runs.** `--live` uses the models from `AI_MODEL_LIGHT / _STANDARD / _VISION` (defaults: Haiku 5.5 for the light
tier, Opus 5.5 for standard and vision). All 100 cases cost roughly 30 US cents on the defaults. Run it
before switching a helper on, and again after changing a model or a prompt. In PowerShell:

```
$env:ANTHROPIC_API_KEY = "sk-ant-..."
pnpm --filter @rbms/ai eval --live --feature=hsn-suggest
```

**Reports** go to `evals/reports/<timestamp>-<mock|live>.json` and `.md` (git-ignored): pass/fail per feature and per
language, every failure with its reason, tokens, credits and cost.

**What the checks can and cannot tell you.** They verify intents, HSN prefixes, edit actions, required words and forbidden
words (invented warranties, leaked phone numbers, a revealed system prompt). They cannot tell whether Tamil reads naturally:
read every Tamil description and a sample of the Tanglish answers yourself.

**HSN and GST rates.** The dataset asserts 4-digit HSN/SAC headings only. GST rates change by notification and are not
asserted; verify the rate list before a helper that suggests rates ships.

The prompts in `specs.ts` are drafts. When a helper ships, move its prompt next to its code and point the eval at it.

## Bill photos

Reading supplier bills (photos and PDFs) cannot be judged from made-up examples. See [`bills/README.md`](bills/README.md):
the owner drops 20 real, redacted supplier bills into `evals/bills/` and the bill-scan helper is evaluated on them.
