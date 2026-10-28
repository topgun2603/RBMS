import { themePreset } from "@srirealtime/branding/theme";
import { BUSINESS_TYPES, PACKS, packOrDefault, type AppId, type BusinessType } from "@srirealtime/verticals";
import { filterClaims, neutralise, outputLooksInjected, sentences } from "../assist/safety";
import type { ModelReading, SetupModelOutput } from "./read";
import { ANSWER_KEYS, COLOURS, colourFrom, extrasFrom, fold, guessTrade, hasTamil, mentionsDelivery, mentionsPickup, moodsFrom, presetFor, splitGroups, tamilShare, type Answers, type ColourName, type Confidence } from "./rules";

type Bi = { en: string; ta: string };

/** The shop as it is now: what the proposal is compared with. */
export interface ShopContext {
  shopName: string;
  /** The app the shop runs on (BL, EC, PH, RS, SV, SC); a trade of another app is only suggested. */
  appId: string | null;
  /** The saved business type ("" when none). */
  trade: string;
}

export interface SetupProposal {
  language: "en" | "ta";
  trade: {
    id: BusinessType;
    /** Where the trade came from. "kept": the answers did not say, so the shop's current trade stays. */
    source: "ai" | "rules" | "kept";
    confidence: Confidence;
    /** The answers fit a trade that runs on another app: shown as a suggestion, nothing is changed. */
    otherApp: { id: BusinessType; appId: AppId } | null;
    /** What they sell fits no trade we have a pack for. */
    outOfScope: boolean;
  };
  categories: { names: string[]; namesTa: string[]; source: "owner" | "pack" };
  preset: string;
  colour: string | null;
  storeLanguages: "en" | "ta" | "both";
  fulfilment: { delivery: boolean | null; pickup: boolean | null };
  hero: { en: { heading: string; text: string }; ta: { heading: string; text: string } };
  /** Sentences of the model's words the checks removed (shown to the owner). */
  removed: string[];
  notes: Bi[];
  /** The answers carried instructions to the AI; they were ignored. */
  suspicious: boolean;
  /** "ai": the model's reading was used; "rules": the app's own rules only (AI off, no credits, mock...). */
  readBy: "ai" | "rules";
  skipped: string | null;
}

const FACT_WORDS_EN =
  /\b(best|no\.? ?1|number one|award\w*|famous|renowned|trusted|leading|top[- ]rated|years?|since|decades?|thousands|lakhs|happy customers|satisfied customers|5[- ]star|five[- ]star|guarantee\w*|assured|cheapest|lowest|authentic|genuine|original|certified|premium quality|finest|unmatched|legendary|loved by|favourite)\b/i;
const FACT_WORDS_TA = /சிறந்த|முதல் தர|நம்பர் ஒன்|புகழ்|நம்பக|விருது|ஆண்டுகளாக|வருடங்களாக|ஆயிரக்கணக்கான|லட்சக்கணக்கான|மகிழ்ந்த வாடிக்கையாளர்|உத்தரவாத|அசல்|மலிவான|தரமான/;
const CONTACT = /\+?\d[\d\s-]{6,}\d|@|https?:|www\.|\.com\b/i;

/**
 * Keeps only sentences that state nothing the owner did not say: promises (`filterClaims`), numbers that are not in the
 * answers, praise and "years in business" words, contact details, names of places or brands the answers never mention,
 * and echoed instructions. Returns the cleaned text and what was removed.
 */
export function cleanWords(text: string, facts: string, payloads: string[], allowed: Set<string>): { text: string; removed: string[] } {
  const removed: string[] = [];
  const t = text.replace(/[\u0000-\u001f​-‏‪-‮]/g, " ").replace(/[<>{}]/g, "").replace(/\s+/g, " ").trim();
  if (!t) return { text: "", removed };
  if (outputLooksInjected(t, payloads) || neutralise(t).suspicious) return { text: "", removed: [t] };
  const claims = filterClaims(t, facts);
  removed.push(...claims.removed.map((r) => r.sentence));
  const factsFold = fold(facts);
  const factNumbers = new Set((facts.match(/\d+/g) ?? []).map(String));
  const kept: string[] = [];
  for (const s of sentences(claims.text)) {
    const praise = s.match(FACT_WORDS_EN)?.[0] ?? s.match(FACT_WORDS_TA)?.[0];
    const numbers = (s.match(/\d+/g) ?? []).filter((n) => !factNumbers.has(n));
    // A capitalised word inside the sentence that the owner never wrote is a made-up name (a city, a brand, a festival).
    const names = s
      .split(/\s+/)
      .slice(1)
      .map((w) => w.replace(/[^\p{L}'-]/gu, ""))
      .filter((w) => /^[A-Z][a-z]{2,}/.test(w) && !allowed.has(fold(w)) && !factsFold.includes(fold(w)));
    if ((praise && !factsFold.includes(fold(praise))) || numbers.length || CONTACT.test(s) || names.length) {
      removed.push(s);
      continue;
    }
    kept.push(s);
  }
  return { text: kept.join(" ").trim(), removed };
}

const NEUTRAL = { en: { heading: "Welcome", text: "Take a look around." }, ta: { heading: "வரவேற்கிறோம்", text: "எங்கள் கடையைச் சுற்றிப் பாருங்கள்." } };
const list = (xs: string[], and: string) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${and} ${xs.at(-1)}`);

const FULFIL: Record<string, Bi> = {
  both: { en: "Home delivery, or pick up at the shop.", ta: "வீட்டு டெலிவரி, அல்லது கடையில் வந்து வாங்கலாம்." },
  delivery: { en: "Order online for home delivery.", ta: "ஆன்லைனில் ஆர்டர் செய்யுங்கள், வீட்டுக்கே டெலிவரி." },
  pickup: { en: "Order online and pick up at the shop.", ta: "ஆன்லைனில் ஆர்டர் செய்து கடையில் வாங்கிக்கொள்ளுங்கள்." },
};

/** Hero words built in code from the answers alone (no model): the trade's heading and the owner's own product groups. */
export function templateHero(pack: (typeof PACKS)[BusinessType], names: string[], namesTa: string[], f: { delivery: boolean | null; pickup: boolean | null }, facts: string, neutral = false) {
  // The trade is unknown or not ours (a tuition centre on a clothing setup): plain words, not the pack's own.
  const heading = (l: "en" | "ta") => (neutral ? NEUTRAL[l].heading : cleanWords(pack.copy[l].heroHeading, facts, [], new Set()).text || (l === "en" ? pack.name : pack.nameTa));
  const way = f.delivery && f.pickup ? FULFIL.both : f.delivery ? FULFIL.delivery : f.pickup ? FULFIL.pickup : null;
  const groupsEn = names.filter((n) => !hasTamil(n)).slice(0, 3);
  // Tamil words name the groups in Tamil only when they are in Tamil (English names would make the Tamil line English).
  const groupsTa = namesTa.filter(hasTamil).slice(0, 3);
  const sub = (l: "en" | "ta") => (neutral ? NEUTRAL[l].text : cleanWords(pack.copy[l].heroSubheading, facts, [], new Set()).text || NEUTRAL[l].text);
  const en = [groupsEn.length ? `${list(groupsEn, "and")}.` : "", way?.en ?? ""].filter(Boolean).join(" ") || sub("en");
  const ta = [groupsTa.length ? `${list(groupsTa, "மற்றும்")}.` : "", way?.ta ?? ""].filter(Boolean).join(" ") || sub("ta");
  return { en: { heading: heading("en"), text: en }, ta: { heading: heading("ta"), text: ta } };
}

const clipWords = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") : s);

/**
 * The setup proposal: the rules' reading of the answers, refined by the model's reading where the model is allowed to
 * decide (trade, look, group names, words) and checked against the answers where it is not (delivery and pickup only
 * when the owner mentioned them, group names only when they come from the owner's own words).
 */
export function buildProposal(answers: Answers, ctx: ShopContext, reading: Pick<ModelReading, "output" | "skipped" | "suspicious" | "payloads">): SetupProposal {
  const m: SetupModelOutput | null = reading.output;
  const all = ANSWER_KEYS.map((k) => answers[k]).join("\n");
  const facts = ANSWER_KEYS.map((k) => neutralise(answers[k]).text).join(". ");
  const notes: Bi[] = [];
  const suspicious = reading.suspicious || !!m?.ignored_instructions;

  // ---- trade
  const rules = guessTrade(answers);
  const current = packOrDefault(ctx.trade, ctx.appId).id;
  const modelTrade = m && (BUSINESS_TYPES as readonly string[]).includes(m.business_type) ? (m.business_type as BusinessType) : null;
  let id: BusinessType = current;
  let source: SetupProposal["trade"]["source"] = "kept";
  let confidence: Confidence = "low";
  const outOfScope = m?.business_type === "other" && !rules.id;
  if (modelTrade && (m!.trade_confidence !== "low" || !rules.id)) {
    id = modelTrade;
    source = "ai";
    confidence = m!.trade_confidence;
  } else if (rules.id && (rules.confidence !== "low" || !rules.alternative)) {
    // A weak rules guess is used only when no other trade comes close.
    id = rules.id;
    source = "rules";
    confidence = rules.confidence;
  }
  let otherApp: SetupProposal["trade"]["otherApp"] = null;
  if (source !== "kept" && ctx.appId && PACKS[id].appId !== ctx.appId) {
    otherApp = { id, appId: PACKS[id].appId };
    id = current;
    source = "kept";
  }
  const pack = PACKS[id];
  if (otherApp) notes.push({ en: `Your answers fit "${PACKS[otherApp.id].name}", which runs on another RBMS app. Your app and plan are not changed; contact support if you want to move.`, ta: `உங்கள் பதில்கள் "${PACKS[otherApp.id].nameTa}" வகைக்குப் பொருந்துகின்றன; அது வேறு RBMS செயலியில் இயங்குகிறது. உங்கள் செயலியும் திட்டமும் மாற்றப்படவில்லை; மாற வேண்டுமானால் உதவிக் குழுவைத் தொடர்புகொள்ளுங்கள்.` });
  if (outOfScope && !otherApp) notes.push({ en: `We do not have a ready setup for that trade yet, so your shop keeps the "${pack.name}" setup. You can change any of it later.`, ta: `அந்த வணிகத்துக்கு இன்னும் தயார் அமைப்பு இல்லை, அதனால் உங்கள் கடை "${pack.nameTa}" அமைப்புடன் தொடர்கிறது. பின்னர் எதையும் மாற்றலாம்.` });
  else if (source === "kept" && !otherApp) notes.push({ en: `I could not tell your trade from the answers, so the "${pack.name}" setup stays. Add a few words about what you sell to get a better match.`, ta: `பதில்களிலிருந்து உங்கள் வணிக வகையைக் கண்டறிய முடியவில்லை, அதனால் "${pack.nameTa}" அமைப்பே தொடர்கிறது. நீங்கள் விற்பதைப் பற்றி இன்னும் சில வார்த்தைகள் சொன்னால் சரியாகப் பொருத்தலாம்.` });
  if (pack.features?.length && source !== "kept" && id !== current) notes.push({ en: `Shops like yours often switch on: ${pack.features.join(", ")} (Settings > Features). Nothing was switched on for you.`, ta: `உங்களைப் போன்ற கடைகள் பொதுவாக இயக்குவது: ${pack.features.join(", ")} (அமைப்புகள் > வசதிகள்). உங்களுக்காக எதுவும் இயக்கப்படவில்லை.` });

  // ---- product groups: the model's names only when they come from the owner's own words
  const allFold = fold(all);
  // Without an answer to the groups question, one product word ("sarees") is the trade, not a list of groups.
  const modelGroups = m?.categories ?? [];
  const fromOwner = (answers.groups.trim() || modelGroups.length >= 2 ? modelGroups : []).filter((c) => {
    const from = fold(c.from);
    return from.length >= 2 && (allFold.includes(from) || from.split(" ").every((w) => w.length < 2 || allFold.includes(w)));
  });
  const ownList = splitGroups(answers.groups);
  let names: string[] = [];
  let namesTa: string[] = [];
  const cleanName = (s: string) => {
    const n = neutralise(s).text.replace(/[<>{}\\"]/g, "").replace(/\s+/g, " ").trim();
    return n.length >= 2 && n.length <= 40 && !/\d{3,}|₹|@|https?:/i.test(n) ? n : "";
  };
  if (fromOwner.length) {
    for (const c of fromOwner.slice(0, 12)) {
      const en = cleanName(c.name_en);
      const ta = cleanName(c.name_ta);
      if (!en && !ta) continue;
      names.push(en || ta);
      namesTa.push(ta && hasTamil(ta) ? ta : en);
    }
  }
  if (!names.length && ownList.length) {
    names = ownList;
    namesTa = ownList;
  }
  const catSource: "owner" | "pack" = names.length ? "owner" : "pack";
  if (!names.length) {
    names = [...pack.categories];
    namesTa = [...pack.categories];
  }
  // Dedupe on the shown name.
  const seen = new Set<string>();
  const keep = names.map((n, i) => (seen.has(fold(n)) ? -1 : (seen.add(fold(n)), i))).filter((i) => i >= 0);
  names = keep.map((i) => names[i]!);
  namesTa = keep.map((i) => namesTa[i]!);

  // ---- look
  const lookText = `${answers.look} ${answers.buyers}`;
  const modelPreset = m && m.look_preset !== "keep" && themePreset(m.look_preset) ? m.look_preset : null;
  const saidLook = moodsFrom(lookText).length > 0;
  const preset = modelPreset ?? (saidLook || source !== "kept" ? presetFor(id, lookText) : pack.preset);
  const ruleColour = colourFrom(answers.look);
  const modelColour = m && (Object.keys(COLOURS) as string[]).includes(m.main_colour) ? (m.main_colour as ColourName) : null;
  // A colour only when the owner named one (the model may translate the word, not invent it).
  const colourName = ruleColour ?? (modelColour && answers.look.trim().length > 0 && hasColourWord(answers.look) ? modelColour : null);
  const colour = colourName ? COLOURS[colourName] : null;

  // ---- delivery, pickup, languages
  const ex = extrasFrom(`${answers.extras} ${answers.buyers}`);
  const yn = (v: "unknown" | "yes" | "no" | undefined) => (v === "yes" ? true : v === "no" ? false : null);
  const delivery = ex.delivery ?? (mentionsDelivery(all) ? yn(m?.delivery) : null);
  const pickup = ex.pickup ?? (mentionsPickup(all) ? yn(m?.pickup) : null);
  const tamilAnswers = tamilShare(all) > 0.3 || (m?.language === "ta" && hasTamil(all));
  // Not said: both (the home page gets Tamil words for shoppers who browse in Tamil).
  const storeLanguages = ex.languages ?? (m && m.store_languages !== "unknown" && /tamil|english|தமிழ்|ஆங்கில|both|rendum|இரண்டு/i.test(answers.extras) ? m.store_languages : "both");
  const language: "en" | "ta" = m?.language ?? (tamilAnswers || /\b(naanga|enga|kadai|vikkirom|irukku|venum)\b/i.test(all) ? "ta" : "en");

  // ---- hero words: the model's, cleaned; the template for anything that does not survive
  const removed: string[] = [];
  const allowed = new Set([...names, ...namesTa, pack.name, ctx.shopName, "RBMS", "UPI", "Tamil", "English"].flatMap((s) => fold(s).split(" ")));
  const tpl = templateHero(pack, names, namesTa, { delivery, pickup }, facts, source === "kept" && (outOfScope || !!otherApp || !rules.id));
  const pickWords = (raw: string | undefined, fallback: string, max: number, ta: boolean) => {
    if (!raw) return fallback;
    const c = cleanWords(raw, facts, reading.payloads, allowed);
    removed.push(...c.removed);
    const ok = c.text && (ta ? tamilShare(c.text) >= 0.5 : tamilShare(c.text) < 0.2);
    return ok ? clipWords(c.text, max) : fallback;
  };
  const hero = {
    en: { heading: pickWords(m?.hero_heading_en, tpl.en.heading, 80, false), text: pickWords(m?.hero_text_en, tpl.en.text, 200, false) },
    ta: { heading: pickWords(m?.hero_heading_ta, tpl.ta.heading, 80, true), text: pickWords(m?.hero_text_ta, tpl.ta.text, 200, true) },
  };
  if (suspicious) notes.push({ en: "Some of your answers looked like instructions to the AI. They were ignored.", ta: "உங்கள் பதில்களில் சில AI-க்கான கட்டளைகள் போல இருந்தன. அவை புறக்கணிக்கப்பட்டன." });

  return {
    language,
    trade: { id, source, confidence, otherApp, outOfScope },
    categories: { names, namesTa, source: catSource },
    preset,
    colour,
    storeLanguages,
    fulfilment: { delivery, pickup },
    hero,
    removed: [...new Set(removed)].slice(0, 10),
    notes,
    suspicious,
    readBy: m ? "ai" : "rules",
    skipped: reading.skipped,
  };
}

const hasColourWord = (s: string) => colourFrom(s) !== null || /colou?r|கலர்|நிற|niram/i.test(s);
