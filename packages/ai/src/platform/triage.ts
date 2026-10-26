import { z } from "zod";
import type { AiRunner } from "../assist/hsn";
import { tokenize, type GuideIndex, type GuideSection } from "../assist/help";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected, sentences } from "../assist/safety";
import { maskText } from "../masking";
import { PLATFORM_TENANT_ID } from "../types";
import { TRIAGE_FEATURE } from "./registry";
import { TICKET_CATEGORIES, TICKET_URGENCIES, type TicketCategory, type TicketTriage, type TicketUrgency } from "./schema";

/**
 * Support ticket triage (Phase 7 part B, light tier, about 1 credit on the platform's account). For each new ticket a shop
 * raises with RBMS: category, urgency, language, a one-line summary, topic words for "common problems", and a DRAFT reply
 * grounded in the user guides the help assistant already indexes (the sections are found in code with BM25; only those may
 * be cited, and the citation line is added by code). A person reads, edits and sends; nothing is sent by AI.
 *
 * Safety: the ticket is DATA (delimited block, instruction-looking sentences removed, an echoed payload voids the draft);
 * personal data is masked before the model (phones, e-mails, GSTINs, UPI ids, long digit runs such as account or card
 * numbers; the requester's and shop's names are never sent); the draft never promises refunds, credits, discounts, dates or
 * times, never names internal systems, and carries no contact details. Category, urgency and language are checked in code.
 */

export interface TicketForTriage {
  subject: string;
  body: string;
  /** The screen the person was on and the help question they asked first, when the ticket came from the help panel. */
  screen?: string | null;
  question?: string | null;
}

const TAMIL = /[஀-௿]/;
const TANGLISH = /\b(eppadi|epdi|enna|illa|illai|irukku|varala|varudhu|aagala|aagudhu|pannanum|panna|podanum|mudiyala|vendum|venum|sir|anna|konjam|seekiram|udane)\b/i;

/** The ticket's language, decided in code (Tamil script, or common Tanglish words), never by the model. */
export function ticketLanguage(text: string): "en" | "ta" {
  if (TAMIL.test(text)) return "ta";
  const hits = text.match(new RegExp(TANGLISH.source, "gi"))?.length ?? 0;
  return hits >= 2 ? "ta" : "en";
}

/** Extra masking for support text, on top of the standard phones / e-mails: UPI ids, runs of 11 or more digits (account, card, Aadhaar). */
export function maskTicketText(text: string): string {
  return maskText(text, { phones: true, emails: true, gstin: true })
    .replace(/\b[\w.-]{2,64}@(?:ok)?[a-z]{2,20}\b/gi, "[upi id]")
    .replace(/(?<![\w])(?:\d[ -]?){10,19}\d(?![\w])/g, (m) => (/^X/.test(m) ? m : "[number]"));
}

// ------------------------------------------------------------------ urgency and category rules (code)

const URGENT_RULES: { urgency: TicketUrgency; rx: RegExp; why: string }[] = [
  {
    urgency: "urgent",
    rx: /\b(cannot|can't|cant|unable to|not able to)\s+(make|create|print|save|issue)\s+(a\s+|any\s+)?(bills?|invoices?)|\b(billing|pos|app|website|store)\s+(is\s+)?(down|stopped|not opening|not loading|crash(?:ed|ing)?)|\bmoney (deducted|debited|cut)\b|\b(charged twice|double charged|charged two times)\b|\b(data|bills?|invoices?|stock)\s+(lost|missing|deleted|gone|disappeared)|பில் போட முடிய|பில் போடவே முடிய|பணம் (கழிந்தது|எடுக்கப்பட்டது|பிடிக்கப்பட்டது)|தரவு (காணவில்லை|அழிந்தது)|bill poda mudiyala|bill podave mudiyala/i,
    why: "billing stopped, money taken or data missing",
  },
  {
    urgency: "high",
    rx: /\b(payment failed|charged twice|double charged|not printing|printer (not|isn't|is not)|cannot (log ?in|sign ?in)|can't (log ?in|sign ?in)|otp (not|never) (coming|received|came)|locked out|gst (return|filing).*(due|tomorrow|today|deadline))|\b(urgent|asap|immediately)\b|அவசர|உடனே|seekiram|udane/i,
    why: "payment, printing, sign-in or a stated deadline",
  },
];
const RANK: Record<TicketUrgency, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/** The urgency floor the words of the ticket set (the model may raise it, never lower it below this). */
export function urgencyFloor(text: string): { urgency: TicketUrgency; why: string | null } {
  for (const r of URGENT_RULES) if (r.rx.test(text)) return { urgency: r.urgency, why: r.why };
  return { urgency: "low", why: null };
}

const CATEGORY_RULES: { category: TicketCategory; rx: RegExp }[] = [
  { category: "subscription", rx: /\b(plan|subscription|renew|upgrade|downgrade|trial|cancel my|refund|invoice from rbms|charged|mandate|autopay)\b|சந்தா|பிளான்/i },
  { category: "printing", rx: /\b(print|printer|thermal|receipt paper|bluetooth printer|label printer)\b|பிரிண்ட்|அச்சு/i },
  { category: "payments", rx: /\b(upi|razorpay|payment link|card machine|qr code|paytm|phonepe|gpay|settlement)\b|பணம் செலுத்த/i },
  { category: "gst", rx: /\b(gst|gstr|hsn|e-?invoice|e-?way|tax rate|itc)\b|ஜிஎஸ்டி|வரி/i },
  { category: "stock", rx: /\b(stock|inventory|batch|expiry|purchase|supplier|barcode)\b|இருப்பு|ஸ்டாக்/i },
  { category: "online-store", rx: /\b(online store|website|storefront|domain|shopper|cart|checkout|order(s)? from (the )?(store|website))\b|ஆன்லைன்|இணையதள/i },
  { category: "login", rx: /\b(log ?in|sign ?in|otp|password|pin|locked out|two-factor)\b|லாகின்|உள்நுழை|கடவுச்சொல்/i },
  { category: "messages", rx: /\b(whatsapp|sms|e-?mail|reminder message|template)\b|வாட்ஸ்அப்/i },
  { category: "import", rx: /\b(import|excel|spreadsheet|csv|tally|vyapar|busy|marg)\b|இறக்குமதி|எக்செல்/i },
  { category: "billing", rx: /\b(bill|bills|invoice|invoices|quotation|credit note|discount|pos|counter|receipt)\b|பில்|இன்வாய்ஸ்/i },
  { category: "feature-request", rx: /\b(please add|can you add|feature|would like|wish|suggest(ion)?|option to)\b|சேர்க்க முடியுமா|வசதி வேண்டும்/i },
  { category: "bug", rx: /\b(error|bug|crash|blank|stuck|not working|wrong|freez)/i },
];

/** A category from keywords (used when AI is unavailable, and to sanity-check the model's choice in the evals). */
export function guessCategory(text: string): TicketCategory {
  return CATEGORY_RULES.find((r) => r.rx.test(text))?.category ?? "other";
}

// ------------------------------------------------------------------ the draft's checks

/**
 * Promises a support reply must never make on its own. A date or time only counts with a commitment ("we will ... by
 * tomorrow", "you will get it within 2 days"): a screen called "Today (X report)" or "the Return month box" is not a
 * promise. Money words (refund, cashback, discount, free months, compensation) are removed in any sentence: those replies
 * are written by a person. Outcome promises ("we will fix", "guaranteed") are removed too.
 */
const TIME_WORDS =
  /\b(today|tonight|tomorrow|this (evening|afternoon|week|weekend|month)|next (week|month|update|release|version)|within\s+(\d+|a few|an?|one|two|three|24|48)|in\s+(\d+|a few|an?|one|two|three|24|48)\s+(minutes?|hours?|days?|weeks?)|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|end of|tomorrow|next|the \d)|(?:on|by)\s+\d{1,2}(st|nd|rd|th)?\s+[a-z]{3}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b|இன்று|இன்றைக்கு|நாளை|மணி நேரத்தில்|நாட்களில்|அடுத்த வாரம்|அடுத்த மாதம்/i;
const STRONG_TIME = /\b(soon|shortly|asap|right away|immediately|at the earliest|eta)\b|உடனே|உடனடியாக|விரைவில்|சீக்கிரம்/i;
const COMMITMENT = /\b(will|'ll|shall|going to|expect(ed)?|should (be|get|receive|have|see))\b|வோம்|வீர்கள்|ப்படும்|கிடைக்கும்/i;
const MONEY =
  /\b(refund(s|ed|ing)?|money back|reimburs\w*|compensat\w*|cashback|discount(s|ed)?|coupons?|free (month|months|plan|upgrade|credits?|of charge)|waive[ds]?|waiver|credit (it |the amount |the money )?(back|to your account))\b|ரீஃபண்ட்|பணம் திரும்ப|பணத்தை(த்)? திருப்பி|திருப்பித் தர|தள்ளுபடி|இலவச/i;
const OUTCOME_PROMISE =
  /\b(we|i|our team|the team)\s*(will|'ll|shall)\s+(definitely\s+|surely\s+)?(fix|resolve|solve|reverse|restore|add|build|release|launch|ship|enable|update)\b|\b(guarantee[ds]?|guaranteed|promise[ds]?|for sure|100%|assure[ds]?|definitely|surely)\b|சரிசெய்து (விடுவோம்|தருவோம்)|சரி செய்வோம்|உறுதியளிக்கிறோம்|உறுதியாக/i;
/** Internal names and talk owners must never see. */
export const INTERNAL_WORDS =
  /\b(srikit|sri ?realtime|srirealtime|claude|anthropic|haiku|opus|sonnet|openai|gpt|llm|language model|ai model|the model|prompt|github|commit|pull request|repo(sitory)?|drizzle|fastify|next\.?js|typescript|postgres|redis|database table|stack ?trace|agent)\b|@srirealtime|\b[\w/-]+\.(tsx?|jsx?|mjs|json|sql|md)\b|\b(packages|apps)\/[\w-]/i;
const CONTACT = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}|[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/\S+|www\.(?!your|example)\S+|\bwa\.me\b/i;

export interface DraftCheck {
  text: string;
  removed: { sentence: string; reason: string }[];
}

/** Why a draft sentence must go, or null. */
function draftProblem(s: string): string | null {
  if (STRONG_TIME.test(s) || (TIME_WORDS.test(s) && COMMITMENT.test(s))) return "date_or_time";
  if (MONEY.test(s)) return "money";
  if (OUTCOME_PROMISE.test(s)) return "promise";
  if (INTERNAL_WORDS.test(s)) return "internal";
  if (CONTACT.test(s)) return "contact";
  return null;
}

/** Numbered steps left with a hole ("2. 3." after a removed step) are closed up and renumbered 1, 2, 3... */
export function tidySteps(text: string, afterRemoval = false): string {
  const closed = text.replace(/(^|\s)\d{1,2}\.(?=\s+\d{1,2}\.\s|\s*$)/g, "$1").replace(/[ \t]{2,}/g, " ");
  const nums = [...closed.matchAll(/(?:^|\s)(\d{1,2})\.\s(?=\S)/g)].map((m) => Number(m[1]));
  // Renumber a clean 1..n run with holes, or (after a removal took the first steps) a run that starts at 2 or 3.
  const increasing = nums.length > (afterRemoval ? 0 : 1) && (nums[0] === 1 || (afterRemoval && nums[0]! <= 3)) && nums.every((n, i) => i === 0 || n > nums[i - 1]!);
  if (!increasing || nums.every((n, i) => n === i + 1)) return closed.trim();
  let k = 0;
  return closed.replace(/(^|\s)(\d{1,2})\.\s(?=\S)/g, (_m, pre: string) => `${pre}${++k}. `).trim();
}

/**
 * Removes every sentence of a draft reply that promises a date, time, refund, credit or outcome, names internals, or carries
 * contact details. Line breaks the model wrote are kept; step numbers are closed up after a removal.
 */
export function checkDraft(draft: string): DraftCheck {
  const removed: DraftCheck["removed"] = [];
  const lines: string[] = [];
  for (const line of draft.split(/\n/)) {
    const kept: string[] = [];
    for (const s of sentences(line)) {
      const reason = draftProblem(s);
      if (reason) removed.push({ sentence: s, reason });
      else kept.push(s);
    }
    const t = kept.join(" ").replace(/[ \t]+/g, " ").trim();
    // A line left with only its step number ("3.") or emptied by a removal goes; blank lines the model wrote stay.
    if ((t === "" || /^\d{1,2}\.$/.test(t)) && line.trim() !== "") continue;
    lines.push(t);
  }
  const text = tidySteps(lines.join("\n").replace(/\n{3,}/g, "\n\n"), removed.length > 0);
  return { text: text.trim(), removed };
}

const HOLDING = {
  en: "Thank you for writing to RBMS support. We have your message and a person from our team will look at it and reply here.",
  ta: "RBMS ஆதரவுக்கு எழுதியதற்கு நன்றி. உங்கள் செய்தி எங்களுக்குக் கிடைத்தது; எங்கள் குழுவில் ஒருவர் பார்த்து இங்கே பதில் அளிப்பார்.",
};
const GUIDE_LINE = {
  en: (s: GuideSection) => `From the RBMS user guide: "${s.chapter} > ${s.title}".`,
  ta: (s: GuideSection) => `RBMS பயனர் கையேட்டில் பார்க்கவும்: "${s.chapter} > ${s.title}".`,
};

/** The fixed reply used when AI is unavailable or our checks emptied the model's draft. */
export function holdingDraft(lang: "en" | "ta", section?: GuideSection | null): string {
  return [HOLDING[lang], section ? GUIDE_LINE[lang](section) : ""].filter(Boolean).join("\n\n");
}

// ------------------------------------------------------------------ the model call

const TriageSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  urgency: z.enum(TICKET_URGENCIES),
  summary: z.string(),
  topic: z.string(),
  draft: z.string(),
  sections: z.array(z.string()),
  answerable: z.boolean(),
});
type TriageOut = z.infer<typeof TriageSchema>;
const TRIAGE_JSON = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...TICKET_CATEGORIES] },
    urgency: { type: "string", enum: [...TICKET_URGENCIES] },
    summary: { type: "string" },
    topic: { type: "string" },
    draft: { type: "string" },
    sections: { type: "array", items: { type: "string" } },
    answerable: { type: "boolean" },
  },
  required: ["category", "urgency", "summary", "topic", "draft", "sections", "answerable"],
  additionalProperties: false,
} as const;

/** The stable system prompt (cached): the rules only; the ticket and the guide sections come with each request. */
export const TRIAGE_SYSTEM = [
  "You help the support team of RBMS (Retail & Business Management Suite), a billing, stock and online-store app for small Indian shops. A shop owner or their staff wrote a support ticket. You sort it and draft a reply that a person on the team will read, edit and send.",
  `category: one of ${TICKET_CATEGORIES.join(", ")}. "subscription" is the shop's RBMS plan and payments to RBMS; "payments" is the shop taking money from its customers (UPI, cards); "import" is bringing items, customers or bills in from a spreadsheet or another software (Excel, Tally, Vyapar); "messages" is WhatsApp, SMS and e-mail from the app; "login" is signing in, OTP, PIN and staff access; "bug" is something that breaks or shows wrong results.`,
  "urgency: urgent = the shop cannot bill at all, money was taken wrongly, or data is missing; high = payments, printing, sign-in or a deadline the ticket states; normal = a how-to question or a problem with a workaround; low = a suggestion or a question with no hurry.",
  "summary: one short English sentence for the team. topic: two to four plain English words naming the problem (for example: printer not printing, GST rate wrong, OTP not received).",
  "draft: the reply to the shop, in the language given with the request (Tamil script for ta). Polite, short, plain words, numbered steps when you explain how to do something. Use ONLY the guide sections given with the ticket; name screens and buttons exactly as they do. If the sections do not answer the ticket, set answerable to false and write a short reply that says the team will look into it.",
  "Never promise a refund, credit, discount, free months, compensation, a fix, a feature, a date, a day or a time (no 'today', 'tomorrow', 'within 24 hours', 'soon'). Never ask for passwords, OTPs, card or bank numbers. Never mention the AI, the model, internal systems, code or the company's internal names. Do not add phone numbers, e-mails or links.",
  "sections: the ids of the guide sections you used.",
  DATA_RULES,
].join("\n");

export interface TriageResult {
  triage: TicketTriage;
  runId: string | null;
  credits: number;
}

/** Guide sections for a ticket (BM25 in code). Tamil tickets search the English manual through the glossary, plus the Tamil guide. */
export function sectionsFor(guides: GuideIndex, text: string): GuideSection[] {
  const hits = TAMIL.test(text) ? [...guides.search(text, 3, { lang: "en" }), ...guides.search(text, 1, { lang: "ta" })] : guides.search(text, 4);
  return hits.filter((h) => h.score >= 0.5).map((h) => h.section);
}

/**
 * Triage one ticket. Never throws for AI problems (off, busy, failed): the result is then the code's own category and urgency
 * with the holding draft, and `note` says why. Throws only for a programming error.
 */
export async function triageTicket(ai: AiRunner, guides: GuideIndex, t: TicketForTriage): Promise<TriageResult> {
  const subject = neutralise(maskTicketText(t.subject));
  const body = neutralise(maskTicketText(t.body));
  const question = t.question ? neutralise(maskTicketText(t.question)) : null;
  const all = [t.subject, t.body, t.question ?? ""].join("\n");
  const lang = ticketLanguage(all);
  const floor = urgencyFloor(all);
  const searchText = [subject.text, body.text, question?.text ?? ""].join(" ").slice(0, 1500);
  const sections = sectionsFor(guides, searchText);
  const fallbackCategory = guessCategory(all);
  const payloads = [...subject.payloads, ...body.payloads, ...(question?.payloads ?? [])];
  const base = (note: string | null): TicketTriage => ({
    category: fallbackCategory,
    urgency: RANK[floor.urgency] >= RANK.normal ? floor.urgency : "normal",
    language: lang,
    summary: subject.text.slice(0, 160),
    topic: keyTopic(`${subject.text} ${body.text}`),
    draft: holdingDraft(lang, sections[0] ?? null),
    sources: sections[0] ? [src(sections[0])] : [],
    source: "template",
    removed: [],
    urgencyReason: floor.why,
    note,
  });

  const text = [
    `Reply language: ${lang === "ta" ? "ta (Tamil script)" : "en (English)"}.`,
    t.screen ? `Screen the person was on: ${cleanScreen(t.screen)}` : "",
    dataBlock("ticket subject", subject.text.slice(0, 200)),
    dataBlock("ticket message", body.text.slice(0, 3000)),
    question?.text ? dataBlock("question asked in the help panel first", question.text.slice(0, 400)) : "",
    sections.length ? sections.map((s) => `[section ${s.id}] ${s.chapter} > ${s.title}\n${s.text}`).join("\n\n") : "No guide section matched this ticket.",
  ]
    .filter(Boolean)
    .join("\n\n");

  let r: Awaited<ReturnType<AiRunner["run"]>> & { output: TriageOut };
  try {
    r = (await ai.run<TriageOut>({
      tenantId: PLATFORM_TENANT_ID,
      platform: true,
      feature: TRIAGE_FEATURE,
      tier: "light",
      system: TRIAGE_SYSTEM,
      input: { text },
      schema: { name: "ticket_triage", jsonSchema: TRIAGE_JSON as unknown as Record<string, unknown>, zod: TriageSchema },
      mask: { phones: true, emails: true, gstin: true },
      maxTokens: 2500,
    })) as typeof r;
  } catch (e) {
    return { triage: base(`AI not used: ${(e as { code?: string }).code ?? "error"}`), runId: null, credits: 0 };
  }
  const o = r.output;
  const injected = outputLooksInjected(o, payloads);
  const urgency = RANK[o.urgency] >= RANK[floor.urgency] ? o.urgency : floor.urgency;
  const usedSections = sections.filter((s) => o.sections.includes(s.id));
  const cite = usedSections[0] ?? (o.answerable ? sections[0] : null) ?? null;
  const checked = checkDraft(injected ? "" : o.draft);
  const wrongLanguage = lang === "ta" ? !TAMIL.test(checked.text) : TAMIL.test(checked.text);
  const keep = !injected && checked.text.length >= 20 && !wrongLanguage && !/^sample$/i.test(checked.text.trim());
  const draft = keep ? [checked.text, cite ? GUIDE_LINE[lang](cite) : ""].filter(Boolean).join("\n\n") : holdingDraft(lang, cite ?? sections[0] ?? null);
  const summary = cleanLine(o.summary, 200);
  const topic = cleanLine(o.topic, 60).toLowerCase();
  return {
    triage: {
      category: o.category,
      urgency,
      language: lang,
      summary: summary && !INTERNAL_WORDS.test(summary) && !injected ? summary : subject.text.slice(0, 160),
      topic: topic && topic !== "sample" && !injected ? topic : keyTopic(`${subject.text} ${body.text}`),
      draft,
      sources: (cite ? [cite, ...usedSections.filter((s) => s.id !== cite.id)] : []).slice(0, 3).map(src),
      source: keep ? "ai" : "template",
      removed: [...checked.removed, ...(injected ? [{ sentence: "(whole draft)", reason: "echoed an instruction from the ticket" }] : []), ...(wrongLanguage && checked.text ? [{ sentence: "(whole draft)", reason: "wrong language" }] : [])],
      urgencyReason: urgency !== o.urgency ? floor.why : null,
      note: null,
    },
    runId: r.runId,
    credits: r.credits,
  };
}

const src = (s: GuideSection) => ({ id: s.id, guide: s.guide, chapter: s.chapter, title: s.title });
const cleanLine = (s: string, max: number) => s.replace(/\s+/g, " ").replace(/<<<DATA|DATA>>>/g, "").trim().slice(0, max);
const cleanScreen = (s: string) => s.replace(/[^\w/ -]/g, "").slice(0, 120);
/** Topic words from the text when the model gave none: the first three content words. */
export function keyTopic(text: string): string {
  return [...new Set(tokenize(text).filter((w) => w.length > 2 && !/^[஀-௿]/.test(w)))].slice(0, 3).join(" ") || "other";
}
