import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { badRequest } from "@srirealtime/core";
import { z } from "zod";
import type { AiRunner } from "./hsn";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected } from "./safety";

export const HELP_FEATURE = "help";

// ------------------------------------------------------------------ guides -> sections

export interface GuideSection {
  /** Stable id: "<guide>#<n>". */
  id: string;
  guide: string;
  lang: "en" | "ta";
  /** Chapter (H1) and section (H2/H3) titles. */
  chapter: string;
  title: string;
  text: string;
}

/** Files read from docs/guides and how much each counts in retrieval (the admin console guide is for the RBMS team, not shop staff). */
export const GUIDE_FILES: { file: string; guide: string; lang: "en" | "ta"; weight: number }[] = [
  { file: "user-manual.en.md", guide: "user-manual", lang: "en", weight: 1 },
  { file: "product-guide.en.md", guide: "product-guide", lang: "en", weight: 0.8 },
  { file: "product-guide.ta.md", guide: "product-guide-ta", lang: "ta", weight: 1 },
  { file: "admin-guide.en.md", guide: "admin-guide", lang: "en", weight: 0.5 },
];

const MAX_SECTION = 1800;

/** Splits one markdown guide into sections at H1-H3 headings; long sections are split at paragraph breaks. Pure. */
export function chunkGuide(md: string, guide: string, lang: "en" | "ta"): GuideSection[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^:::.*$/gm, "").replace(/\{#?[\w-]+\}|\{pb\}/g, "");
  const out: GuideSection[] = [];
  let chapter = "";
  let title = "";
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    buf = [];
    if (text.length < 40) return;
    const parts: string[] = [];
    let cur = "";
    for (const para of text.split(/\n{2,}/)) {
      if (cur && cur.length + para.length > MAX_SECTION) {
        parts.push(cur);
        cur = "";
      }
      cur += (cur ? "\n\n" : "") + para;
    }
    if (cur) parts.push(cur);
    for (const p of parts) out.push({ id: `${guide}#${out.length + 1}`, guide, lang, chapter, title: title || chapter, text: p.slice(0, MAX_SECTION + 400) });
  };
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence ? /^(#{1,3})\s+(.+?)\s*$/.exec(line) : null;
    if (h) {
      flush();
      const name = h[2]!.replace(/[*_`]/g, "").trim();
      if (h[1] === "#") {
        chapter = name;
        title = name;
      } else title = name;
    } else buf.push(line);
  }
  flush();
  return out;
}

/** Finds docs/guides: AI_GUIDES_DIR, else walks up from the working directory. */
export function findGuidesDir(start = process.cwd(), env: Record<string, string | undefined> = process.env): string | null {
  if (env.AI_GUIDES_DIR && existsSync(env.AI_GUIDES_DIR)) return resolve(env.AI_GUIDES_DIR);
  let dir = resolve(start);
  for (let i = 0; i < 6; i++) {
    const c = join(dir, "docs", "guides");
    if (existsSync(c) && readdirSync(c).some((f) => f.endsWith(".md"))) return c;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// ------------------------------------------------------------------ retrieval (BM25 in code, no embeddings)

const STOP = new Set(["the", "a", "an", "is", "are", "to", "of", "in", "on", "for", "and", "or", "how", "do", "i", "my", "can", "what", "where", "it", "this", "that", "with", "me", "you", "your", "from", "be", "at", "as", "by", "if", "when", "which", "should", "does", "not", "will", "we", "use", "using", "எப்படி", "என்ன", "எனது", "என்", "ஒரு", "இந்த", "எங்கே", "எப்போது", "வேண்டும்", "செய்வது", "செய்ய", "முடியுமா"]);

/** Tamil / Tanglish words people type -> the English words the manual uses. */
export const GLOSSARY: Record<string, string> = {
  பில்: "bill invoice", பில்லை: "bill invoice", பில்லிங்: "billing invoice", இன்வாய்ஸ்: "invoice", ரசீது: "receipt", ஸ்டாக்: "stock", இருப்பு: "stock",
  வாடிக்கையாளர்: "customer", வாடிக்கையாளர்கள்: "customers", சப்ளையர்: "supplier", கொள்முதல்: "purchase purchases", வாங்கிய: "purchase",
  பொருள்: "item product", பொருட்கள்: "items products", பொருளை: "item product", சேர்க்க: "add", சேர்: "add", உருவாக்க: "create make", இறக்குமதி: "import", ஏற்றுமதி: "export",
  அறிக்கை: "report reports", அறிக்கைகள்: "reports", ஜிஎஸ்டி: "gst", வரி: "tax gst", பணம்: "payment money", செலுத்த: "payment", கடன்: "credit due", நிலுவை: "due outstanding",
  திரும்ப: "return refund", ரிட்டர்ன்: "return", தள்ளுபடி: "discount", ஊழியர்: "staff team", ஊழியர்கள்: "staff team", அமைப்புகள்: "settings", அமைப்பு: "settings",
  பிரிண்ட்: "print", அச்சிட: "print", வாட்ஸ்அப்: "whatsapp share", பார்கோடு: "barcode", விலை: "price rate", எச்எஸ்என்: "hsn", ஹெச்எஸ்என்: "hsn",
  ஆன்லைன்: "online store", கடை: "shop store", மொழி: "language", பாஸ்வேர்ட்: "password", உள்நுழை: "sign in login", லாகின்: "sign in login", ரத்து: "cancel", நீக்க: "delete cancel",
  கணக்கு: "accounts accounting", செலவு: "expense expenses", செலவுகள்: "expenses", கவுண்டர்: "pos counter", முனையம்: "terminal pos", கல்லா: "till day close",
  எடை: "weigh weighing scale", அளவு: "size variants", நிறம்: "colour variants", மருந்து: "medicine pharmacy", தொலைபேசி: "phone mobile", செயலி: "app", பதிவிறக்க: "download",
  ஆர்டர்: "order orders", டெலிவரி: "delivery", மேற்கோள்: "quotation estimate", ஏஐ: "ai",
  போடு: "make create", போட: "make create", அனுப்ப: "send share", அனுப்பு: "send share", சரிபார்: "check", பார்ப்ப: "view check", பார்க்க: "view check", மாற்ற: "change edit", சேர்ப்ப: "add",
  வாடிக்கையாளருக்கு: "customer", ஊழியரை: "staff team", பதிவு: "record add", ஸ்கேன்: "scan barcode", எக்செல்: "excel spreadsheet import", கோப்பு: "file spreadsheet",
  eppadi: "how", epdi: "how", podanum: "make", poda: "make", podu: "make", serkka: "add", seka: "add", maatha: "change edit", maathanum: "change edit", pannanum: "do make", panna: "make", irukku: "stock", bill: "bill invoice", varavu: "income", selavu: "expense",
};

const tamil = /[஀-௿]/;

/** Glossary entry for a Tamil word: exact, else the longest glossary key (without its final virama) that the word starts with. */
const GLOSSARY_KEYS = Object.keys(GLOSSARY)
  .filter((k) => tamil.test(k))
  .map((k) => ({ key: k, stem: k.replace(/்$/, "") }))
  .sort((a, b) => b.stem.length - a.stem.length);
function glossaryFor(word: string): string | undefined {
  if (GLOSSARY[word]) return GLOSSARY[word];
  return GLOSSARY_KEYS.find((g) => g.stem.length >= 2 && word.startsWith(g.stem))?.key
    ? GLOSSARY[GLOSSARY_KEYS.find((g) => g.stem.length >= 2 && word.startsWith(g.stem))!.key]
    : undefined;
}

export function tokenize(text: string, opts: { expand?: boolean } = {}): string[] {
  const raw = text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  for (const t of raw) {
    if (STOP.has(t)) continue;
    const g = opts.expand ? (tamil.test(t) ? glossaryFor(t) : GLOSSARY[t]) : undefined;
    if (g) out.push(...g.split(" "));
    if (tamil.test(t)) out.push([...t].slice(0, 5).join(""));
    else if (/^\d+$/.test(t)) continue;
    else out.push(t.length > 4 ? t.replace(/(ing|ed|es|s)$/, "") : t);
  }
  return out;
}

export class GuideIndex {
  readonly sections: GuideSection[];
  private readonly docs: { tf: Map<string, number>; len: number; weight: number }[];
  private readonly df = new Map<string, number>();
  private readonly avg: number;

  constructor(sections: GuideSection[], weights: Record<string, number> = {}) {
    this.sections = sections;
    this.docs = sections.map((s) => {
      // Titles count three times: "Add an item" should beat a passing mention.
      const toks = [...tokenize(s.title), ...tokenize(s.title), ...tokenize(s.title), ...tokenize(s.text)];
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { tf, len: toks.length, weight: weights[s.guide] ?? 1 };
    });
    this.avg = this.docs.reduce((n, d) => n + d.len, 0) / Math.max(1, this.docs.length);
  }

  get size() {
    return this.sections.length;
  }

  /** Top sections for a question (BM25, k1 1.4, b 0.75). Empty when no word matches. */
  search(query: string, limit = 4, opts: { lang?: "en" | "ta" } = {}): { section: GuideSection; score: number }[] {
    // Restricted to the English guides, Tamil words only count through the glossary (they would not match English text anyway).
    const q = [...new Set(tokenize(query, { expand: true }))].filter((t) => opts.lang !== "en" || !tamil.test(t));
    if (q.length === 0) return [];
    const n = this.docs.length;
    const scored: { section: GuideSection; score: number }[] = [];
    this.docs.forEach((d, i) => {
      if (opts.lang && this.sections[i]!.lang !== opts.lang) return;
      let s = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        s += (idf * (f * 2.4)) / (f + 1.4 * (0.25 + (0.75 * d.len) / this.avg));
      }
      // A question word that is in the section's title is a strong hint ("Make a bill" for "how do I make a bill").
      const title = new Set(tokenize(this.sections[i]!.title));
      for (const t of q) if (title.has(t)) s += 1.5 * Math.log(1 + (n - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
      if (s > 0) scored.push({ section: this.sections[i]!, score: s * d.weight * (/mobile app/i.test(this.sections[i]!.chapter) ? 0.7 : 1) });
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  byId(id: string) {
    return this.sections.find((s) => s.id === id);
  }
}

/** Reads and chunks the guides. Returns an empty index when the folder is missing (the helper then answers "I don't know"). */
export function loadGuideIndex(dir: string | null = findGuidesDir()): GuideIndex {
  const sections: GuideSection[] = [];
  const weights: Record<string, number> = {};
  if (dir) {
    for (const g of GUIDE_FILES) {
      const p = join(dir, g.file);
      if (!existsSync(p)) continue;
      weights[g.guide] = g.weight;
      // The "About this manual" front matter (reader table, glossary) is not how-to content and would crowd out real steps.
      sections.push(...chunkGuide(readFileSync(p, "utf8"), g.guide, g.lang).filter((x) => !/^about this|^ஒரு பார்வையில்/i.test(x.chapter)));
    }
  }
  return new GuideIndex(sections, weights);
}

// ------------------------------------------------------------------ screens a section names

/** Screens (by the last path segment of the app's menu entry, or `settings/<page>`) and the words a guide uses for them. */
export const SCREENS: { key: string; label: string; labelTa: string; rx: RegExp }[] = [
  { key: "invoices", label: "Invoices", labelTa: "இன்வாய்ஸ்கள்", rx: /\*\*invoices?\*\*|invoices? (?:screen|page|list)|make a bill/i },
  { key: "items", label: "Items", labelTa: "பொருட்கள்", rx: /\*\*items?\*\*|add an item|items? (?:screen|page|list)/i },
  { key: "customers", label: "Customers", labelTa: "வாடிக்கையாளர்கள்", rx: /\*\*customers?\*\*/i },
  { key: "credit-book", label: "Credit book", labelTa: "கடன் புத்தகம்", rx: /credit book/i },
  { key: "stock", label: "Stock", labelTa: "இருப்பு", rx: /\*\*stock\*\*|check stock|adjust stock/i },
  { key: "purchases", label: "Purchases", labelTa: "கொள்முதல்", rx: /\*\*purchases?\*\*|record a purchase/i },
  { key: "suppliers", label: "Suppliers", labelTa: "சப்ளையர்கள்", rx: /\*\*suppliers?\*\*/i },
  { key: "expenses", label: "Expenses", labelTa: "செலவுகள்", rx: /\*\*expenses?\*\*/i },
  { key: "reports", label: "Reports", labelTa: "அறிக்கைகள்", rx: /\*\*reports?\*\*/i },
  { key: "gst", label: "GST", labelTa: "GST", rx: /\*\*gst\*\*|gst (?:screen|reports?)/i },
  { key: "quotations", label: "Quotations", labelTa: "மேற்கோள்கள்", rx: /\*\*quotations?\*\*/i },
  { key: "settings/import", label: "Settings > Import", labelTa: "அமைப்புகள் > இறக்குமதி", rx: /import from a spreadsheet|\*\*import\*\*/i },
  { key: "settings/ai", label: "Settings > AI", labelTa: "அமைப்புகள் > AI", rx: /settings\W+ai\b/i },
  { key: "settings/team", label: "Settings > Team", labelTa: "அமைப்புகள் > குழு", rx: /add your team|\*\*team\*\*/i },
  { key: "settings/features", label: "Settings > Features", labelTa: "அமைப்புகள் > அம்சங்கள்", rx: /settings\W+features/i },
];

export function screensFor(sections: GuideSection[], max = 2) {
  const found: { key: string; label: string; labelTa: string }[] = [];
  for (const s of sections.slice(0, 2)) {
    for (const sc of SCREENS) if (!found.some((f) => f.key === sc.key) && sc.rx.test(`${s.title}\n${s.text}`)) found.push({ key: sc.key, label: sc.label, labelTa: sc.labelTa });
  }
  return found.slice(0, max);
}

// ------------------------------------------------------------------ the question

export const HELP_SUPPORT_EN = "I don't know that one. Please contact support and we will help you.";
export const HELP_SUPPORT_TA = "இது எனக்குத் தெரியவில்லை. தயவுசெய்து ஆதரவுக் குழுவைத் தொடர்பு கொள்ளுங்கள், நாங்கள் உதவுவோம்.";

const AnswerSchema = z.object({ answered: z.boolean(), answer: z.string(), sections: z.array(z.string()).max(6), language: z.enum(["en", "ta"]) });
type Answer = z.infer<typeof AnswerSchema>;
const ANSWER_JSON = {
  type: "object",
  properties: {
    answered: { type: "boolean" },
    answer: { type: "string" },
    sections: { type: "array", items: { type: "string" } },
    language: { type: "string", enum: ["en", "ta"] },
  },
  required: ["answered", "answer", "sections", "language"],
  additionalProperties: false,
} as const;

/**
 * The stable system prompt: rules plus the table of contents of the guides. It does not change between questions (so the
 * provider's prompt cache serves it); the retrieved sections go in the user message.
 */
export function helpSystem(index: GuideIndex): string {
  const toc = [...new Set(index.sections.filter((s) => s.guide !== "admin-guide").map((s) => `${s.chapter} > ${s.title}`))].slice(0, 160).join("\n");
  return [
    "You are the help assistant inside RBMS (Retail & Business Management Suite), a billing, stock and online-store app for small Indian shops. You answer HOW-TO questions about using the app, in Tamil or English.",
    "Answer ONLY from the guide sections given with the question. Give short numbered steps naming the screens and buttons exactly as the guide does. Do not invent screens, buttons, prices, plans or features that are not in the sections.",
    'If the sections do not cover the question, set answered to false and answer to a short sorry that says you do not know and the person should contact support. Do the same for anything outside using RBMS.',
    "Never answer questions about the shop's own data (sales, stock levels, customers, dues, reports of numbers): set answered to false and say that asking about your shop's data is not available here yet.",
    "Reply in Tamil script when the question is in Tamil or Tanglish (Tamil written in English letters), otherwise in English. Set language to ta or en to match. Keep product words like GST, HSN, UPI, POS in English letters.",
    "The sections are mostly in English even when the question is in Tamil: read them and answer in the language of the question.",
    "sections lists the ids of the sections you used.",
    DATA_RULES,
    "Table of contents of the guides (for orientation only; the sections you may use come with each question):",
    toc,
  ].join("\n");
}

export interface HelpAnswer {
  answered: boolean;
  answer: string;
  language: "en" | "ta";
  /** Guide sections the answer used, for "read more". */
  sources: { id: string; guide: string; title: string; chapter: string }[];
  /** Screens the sections name; the app turns them into links. */
  screens: { key: string; label: string; labelTa: string }[];
  runId: string | null;
  credits: number;
}

const looksTamil = (s: string) => tamil.test(s);

/** Answers one how-to question from the guides (light tier). With no matching section nothing is sent to the model and no credit is spent. */
export async function askHelp(
  ai: AiRunner,
  index: GuideIndex,
  req: { tenantId: string; userId?: string | null; question: string; system?: string },
): Promise<HelpAnswer> {
  const clean = neutralise(req.question);
  const question = clean.text.slice(0, 400);
  if (req.question.trim().length < 3) throw badRequest("Type your question");
  const lang: "en" | "ta" = looksTamil(req.question) ? "ta" : /\b(eppadi|epdi|podanum|serkka|panna|enna|illa|irukku|venum|anuppanum)\b/i.test(req.question) ? "ta" : "en";
  const none = (): HelpAnswer => ({ answered: false, answer: lang === "ta" ? HELP_SUPPORT_TA : HELP_SUPPORT_EN, language: lang, sources: [], screens: [], runId: null, credits: 0 });

  // A question that was only an instruction ("ignore your rules...") has nothing left to answer.
  if (question.length < 3) return none();
  // Tamil questions: the how-to steps are in the English manual (found through the glossary), the Tamil product guide adds context.
  const hits = looksTamil(question)
    ? [...index.search(question, 3, { lang: "en" }), ...index.search(question, 1, { lang: "ta" })]
    : index.search(question, 4);
  if (hits.length === 0 || hits[0]!.score < 0.2) return none();
  const sections = hits.map((h) => h.section);
  const text = [`Reply in ${lang === "ta" ? "Tamil (Tamil script)" : "English"}.`, dataBlock("question", question), ...sections.map((s) => `[section ${s.id}] ${s.chapter} > ${s.title}\n${s.text}`)].join("\n\n");
  const r = await ai.run<Answer>({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: HELP_FEATURE,
    tier: "light",
    system: req.system ?? helpSystem(index),
    input: { text },
    schema: { name: "help_answer", jsonSchema: ANSWER_JSON as unknown as Record<string, unknown>, zod: AnswerSchema },
    maxTokens: 2000,
  });
  if (outputLooksInjected(r.output, clean.payloads) || !r.output.answered) {
    return { ...none(), answer: r.output.answered && !outputLooksInjected(r.output, clean.payloads) ? r.output.answer : lang === "ta" ? HELP_SUPPORT_TA : HELP_SUPPORT_EN, runId: r.runId, credits: r.credits };
  }
  // Only sections we actually sent can be cited (kept in retrieval order).
  const used = sections.filter((s) => r.output.sections.includes(s.id));
  const cited = [sections[0]!, ...used.filter((x) => x.id !== sections[0]!.id)].slice(0, 3);
  return {
    answered: true,
    answer: r.output.answer,
    language: r.output.language,
    sources: cited.map((s) => ({ id: s.id, guide: s.guide, title: s.title, chapter: s.chapter })),
    screens: screensFor(cited),
    runId: r.runId,
    credits: r.credits,
  };
}
