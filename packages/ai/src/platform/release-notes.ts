import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AiRunner } from "../assist/hsn";
import { claimKinds, DATA_RULES, dataBlock, neutralise, outputLooksInjected, supportedKinds } from "../assist/safety";
import { allowedNumbers, checkNumbers } from "../insights/numbers";
import { PLATFORM_TENANT_ID } from "../types";
import { RELEASE_NOTES_FEATURE } from "./registry";
import type { ReleaseCommit, ReleaseNoteItem } from "./schema";
import { INTERNAL_WORDS } from "./triage";

/**
 * "What's new" notes for shop owners (Phase 7 part B, light tier, platform account). Input: the list of commits (production
 * has no git, so the list is pasted on the admin page or posted by `pnpm --filter @srirealtime/api release-notes:draft`).
 * The model writes plain, benefit-first lines in English and Tamil, grouped by app and trade; code then drops any line that
 * names internals (product code names, files, packages, vendors, "agent", "model"), makes a promise the commits do not state,
 * carries a number not in the commits, or whose Tamil is not Tamil. The team edits both languages and publishes; owners see
 * only the lines for their app and trade.
 */

/** App ids (same list as packages/verticals APP_IDS) with owner-facing names. */
export const NOTE_APPS = { BL: "Billing", EC: "Online shop", PH: "Pharmacy", RS: "Restaurant", SV: "Services" } as const;
export type NoteApp = keyof typeof NOTE_APPS;
/** Trades (packages/verticals BUSINESS_TYPES). Kept here so the AI package does not need the verticals data. */
export const NOTE_TRADES = [
  "fashion", "pharmacy", "restaurant", "cloud_kitchen", "grocery", "bakery", "fresh", "electronics", "repair", "salon", "gym", "jewellery", "hardware", "optical", "tailoring", "organic", "footwear", "stationery", "toys", "cosmetics", "crackers", "florist_pooja", "mobile_accessories", "furniture", "home_decor", "pet_shop", "sports", "tea_stall", "spa",
] as const;

// ------------------------------------------------------------------ commits

/** Commits that never interest an owner. */
const SKIP = /^(merge\b|revert\b|wip\b|chore|ci|build|test|tests|docs?|style|lint|format|refactor|deps?|bump|typo|release|version)\b[:(! ]|^(update|upgrade) (deps|dependencies|lockfile)|^\s*$/i;

/**
 * Reads `git log --format=%h%x09%ad%x09%s --date=short` lines ("abc1234<TAB>2026-10-27<TAB>subject"), "abc1234 subject",
 * or plain subjects (one per line), drops merges and housekeeping, de-duplicates. At most 200.
 */
export function parseCommits(text: string): ReleaseCommit[] {
  const out: ReleaseCommit[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*•]\s+/, "");
    if (!line) continue;
    let sha = "";
    let date: string | null = null;
    let subject = line;
    const tab = line.split("\t");
    if (tab.length >= 3 && /^[0-9a-f]{6,40}$/i.test(tab[0]!)) [sha, date, subject] = [tab[0]!, tab[1]!.trim() || null, tab.slice(2).join(" ")];
    else if (tab.length === 2 && /^[0-9a-f]{6,40}$/i.test(tab[0]!)) [sha, subject] = [tab[0]!, tab[1]!];
    else {
      const m = /^([0-9a-f]{7,40})\s+(.+)$/i.exec(line);
      if (m) [sha, subject] = [m[1]!, m[2]!];
    }
    subject = subject.replace(/\s+/g, " ").trim().slice(0, 600);
    if (!subject || SKIP.test(subject)) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sha: sha.slice(0, 12), subject, date: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null });
    if (out.length >= 200) break;
  }
  return out;
}

/** The same filtering for a list that already has fields (the script posts `{sha, subject, date}`). */
export function cleanCommits(list: ReleaseCommit[]): ReleaseCommit[] {
  const out: ReleaseCommit[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const subject = String(c.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
    if (!subject || SKIP.test(subject) || seen.has(subject.toLowerCase())) continue;
    seen.add(subject.toLowerCase());
    out.push({ sha: /^[0-9a-f]{6,40}$/i.test(c.sha ?? "") ? c.sha.slice(0, 12) : "", subject, date: c.date && /^\d{4}-\d{2}-\d{2}/.test(c.date) ? c.date.slice(0, 10) : null });
    if (out.length >= 200) break;
  }
  return out;
}

// ------------------------------------------------------------------ who sees a line

/** True when a line concerns this shop: its app is listed (or none is), and its trade is listed (or none is). */
export function itemFor(item: Pick<ReleaseNoteItem, "apps" | "trades">, shop: { appId: string | null; trade: string | null }): boolean {
  const appOk = item.apps.length === 0 || (!!shop.appId && item.apps.includes(shop.appId));
  const tradeOk = item.trades.length === 0 || (!!shop.trade && item.trades.includes(shop.trade));
  return appOk && tradeOk;
}

export interface PublishedNote {
  id: string;
  titleEn: string;
  titleTa: string;
  items: ReleaseNoteItem[];
  publishedAt: Date | null;
}

/** The published notes a shop sees, each with only its own lines; a note with none left is not shown. */
export function notesForShop<T extends PublishedNote>(notes: T[], shop: { appId: string | null; trade: string | null }): T[] {
  return notes.map((n) => ({ ...n, items: n.items.filter((i) => itemFor(i, shop)) })).filter((n) => n.items.length > 0);
}

// ------------------------------------------------------------------ checks on a line

const TAMIL = /[஀-௿]/g;
const tamilShare = (s: string) => (s.match(TAMIL)?.length ?? 0) / Math.max(1, s.match(/\p{L}/gu)?.length ?? 1);
/** Hype and promises an owner-facing note must not make unless a commit says it. */
const HYPE = /\b(guarantee[ds]?|100%|always works|never fails|instantly|best in class|revolutionary|game[- ]changer|lightning|blazing|world[- ]class|unlimited|free forever)\b/i;
/** "GST return", "sales return", "return to the supplier" are not refund promises: taken out before the promise check. */
export const notReturns = (s: string) =>
  s.replace(/\b(gst|gstr-?\w*|tax|sales|purchase|income tax)\s+returns?\b|\breturns?\s+(month|period|filing|file|summary)\b|\breturns?[- ]to[- ]((the|your)\s+)?suppliers?\b|\b(?:return|returns)\s+(?=\(GSTR)/gi, "").replace(/(GST|ஜிஎஸ்டி)\s*ரிட்டர்ன்/g, "").replace(/சப்ளையர\S*\s+திருப்பி(?:க்)?\s?அனுப்ப\S*/g, "");
/** Technical words that read like changelogs, not benefits. */
const TECH = /\b(api|endpoint|migration|schema|refactor|backend|frontend|deploy(ed|ment)?|bug ?fix(es)?|regression|qa|e2e|eval|evals|tsc|lint|json|sql|cache|cron|webhook|jwt|oauth|sdk|null|undefined|stack|repo|branch|merge|phase \d)\b/i;

export interface CheckedItems {
  items: ReleaseNoteItem[];
  removed: { text: string; reason: string }[];
}

/**
 * Keeps a drafted line only when both languages are clean: no internal names or tech talk, no promise kind the commits do not
 * state, no hype, no number that is not in the commits, Tamil in Tamil script (and no Tamil in the English), and sensible length.
 * Apps and trades outside the known lists are dropped.
 */
export function checkItems(items: { en: string; ta: string; apps: string[]; trades: string[] }[], commits: ReleaseCommit[], payloads: string[] = []): CheckedItems {
  const source = commits.map((c) => c.subject).join("\n");
  const supported = supportedKinds(notReturns(source));
  const numbers = allowedNumbers(source);
  const kept: ReleaseNoteItem[] = [];
  const removed: CheckedItems["removed"] = [];
  for (const raw of items) {
    const en = raw.en.replace(/\s+/g, " ").trim();
    const ta = raw.ta.replace(/\s+/g, " ").trim();
    const both = `${en}\n${ta}`;
    const unsupported = [...new Set([...claimKinds(notReturns(en)), ...claimKinds(notReturns(ta))])].filter((k) => k !== "delivery" && !supported.has(k));
    const reason =
      !en || !ta
        ? "missing a language"
        : en.length > 220 || ta.length > 400
          ? "too long"
          : INTERNAL_WORDS.test(both)
            ? "internal name or code talk"
            : TECH.test(en)
              ? "technical wording"
              : outputLooksInjected(raw, payloads)
                ? "echoed an instruction from the commits"
                : HYPE.test(en)
                  ? "hype or a promise"
                  : unsupported.length
                    ? `promise not in the commits (${unsupported.join(", ")})`
                    : !checkNumbers(both, numbers).ok
                      ? `number not in the commits (${checkNumbers(both, numbers).unknown.join(", ")})`
                      : tamilShare(ta) < 0.3
                        ? "Tamil line is not in Tamil"
                        : (en.match(TAMIL)?.length ?? 0) > 0
                          ? "English line contains Tamil"
                          : null;
    if (reason) {
      removed.push({ text: en || ta, reason });
      continue;
    }
    kept.push({
      id: randomUUID(),
      en,
      ta,
      apps: [...new Set(raw.apps.filter((a): a is NoteApp => a in NOTE_APPS))],
      trades: [...new Set(raw.trades.filter((t) => (NOTE_TRADES as readonly string[]).includes(t)))],
    });
  }
  return { items: kept.slice(0, 15), removed };
}

// ------------------------------------------------------------------ the model call

const NoteSchema = z.object({
  title_en: z.string(),
  title_ta: z.string(),
  items: z.array(z.object({ en: z.string(), ta: z.string(), apps: z.array(z.string()), trades: z.array(z.string()) })),
});
type NoteOut = z.infer<typeof NoteSchema>;
const NOTE_JSON = {
  type: "object",
  properties: {
    title_en: { type: "string" },
    title_ta: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          en: { type: "string" },
          ta: { type: "string" },
          apps: { type: "array", items: { type: "string", enum: Object.keys(NOTE_APPS) } },
          trades: { type: "array", items: { type: "string", enum: [...NOTE_TRADES] } },
        },
        required: ["en", "ta", "apps", "trades"],
        additionalProperties: false,
      },
    },
  },
  required: ["title_en", "title_ta", "items"],
  additionalProperties: false,
} as const;

export const NOTES_SYSTEM = [
  'You write the "What\'s new" notes that shop owners read inside RBMS (Retail & Business Management Suite), a billing, stock and online-store app for small shops in Tamil Nadu. You get the list of changes the product team made.',
  "Write at most 12 lines. Each line: one plain sentence (at most 25 words) that says what the owner can now do or what got better for them, in everyday words. Benefits, not technology. Merge changes that are about the same thing; leave out changes an owner would not notice (tests, internal tools, code clean-up, fixes of things they never saw).",
  "Never use: the product's code names or company names other than RBMS, file names, package or screen code names, the words agent, model, prompt, API, migration, database, refactor, deploy, bug fix, phase; no AI vendor or model names. You may say AI when it is a feature the owner uses (for example 'the AI help assistant').",
  "No promises or hype: do not add discounts, free, guarantees, prices, dates or numbers that are not in the changes.",
  "ta: the same line in natural, simple Tamil (Tamil script; keep words like GST, UPI, POS, WhatsApp, AI in English letters).",
  `apps: which apps the line is for (${Object.entries(NOTE_APPS).map(([k, v]) => `${k} = ${v}`).join(", ")}); an empty list means every app. trades: only when the line is for particular trades (for example pharmacy, restaurant, jewellery, tailoring, salon, gym, hardware, fashion, grocery); empty means every trade.`,
  'title_en / title_ta: a short heading such as "New in RBMS this week".',
  DATA_RULES,
].join("\n");

export interface NotesDraft {
  titleEn: string;
  titleTa: string;
  items: ReleaseNoteItem[];
  removed: { text: string; reason: string }[];
  runId: string | null;
  credits: number;
}

/** Drafts the note from the commits (one light-tier call). AI errors reach the caller (the admin page shows them). */
export async function draftReleaseNotes(ai: AiRunner, commits: ReleaseCommit[], opts: { userId?: string | null } = {}): Promise<NotesDraft> {
  const clean = commits.slice(0, 120).map((c) => neutralise(c.subject));
  const payloads = clean.flatMap((c) => c.payloads);
  const list = clean
    .map((c, i) => `${i + 1}. ${c.text}`)
    .filter((l) => l.length > 4)
    .join("\n");
  const r = await ai.run<NoteOut>({
    tenantId: PLATFORM_TENANT_ID,
    platform: true,
    userId: opts.userId ?? null,
    feature: RELEASE_NOTES_FEATURE,
    tier: "light",
    system: NOTES_SYSTEM,
    input: { text: dataBlock("changes", list.slice(0, 24_000)) },
    schema: { name: "whats_new", jsonSchema: NOTE_JSON as unknown as Record<string, unknown>, zod: NoteSchema },
    maxTokens: 6000,
  });
  const checked = checkItems(r.output.items, commits, payloads);
  const title = (s: string, fallback: string) => (s.trim() && !INTERNAL_WORDS.test(s) && !/^sample$/i.test(s.trim()) ? s.trim().slice(0, 80) : fallback);
  return {
    titleEn: title(r.output.title_en, "New in RBMS"),
    titleTa: tamilShare(r.output.title_ta) >= 0.3 ? title(r.output.title_ta, "RBMS-இல் புதியவை") : "RBMS-இல் புதியவை",
    items: checked.items,
    removed: checked.removed,
    runId: r.runId,
    credits: r.credits,
  };
}
