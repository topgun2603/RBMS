import { skeleton } from "./phonetic";

/**
 * Words the voice-billing parser knows: Tamil, Tanglish and English number words, fractions, units and fillers. Everything is
 * plain data so a shop's owner (or a test) can read what is understood. Latin spellings are folded with `skeleton` before they
 * are compared, so "rendu", "randu" and "rendhu" are one entry.
 */

export type Unit = "kg" | "g" | "l" | "ml" | "pkt" | "dozen" | "pcs" | "box" | "bottle" | "m" | "bunch" | "strip";

// ------------------------------------------------------------------ numbers 0 to 1000

/** Spellings per value. Tamil script first, then Tanglish, then English. */
const ONES: Record<number, string[]> = {
  1: ["ஒன்று", "ஒண்ணு", "ஒன்னு", "ஒண்டு", "ஒரு", "onnu", "ondru", "ondu", "onru", "oru", "one", "ஒன்", "ஒண்ணே"],
  2: ["இரண்டு", "ரெண்டு", "இரெண்டு", "இரன்டு", "ரண்டு", "இரு", "rendu", "irandu", "randu", "two", "irendu"],
  3: ["மூன்று", "மூணு", "மூனு", "முன்னு", "மூண்ணு", "moonu", "moondru", "munu", "moondru", "three", "mooni", "munnu"],
  4: ["நான்கு", "நாலு", "நாங்கு", "நாளு", "naalu", "nalu", "naangu", "nangu", "four"],
  5: ["ஐந்து", "அஞ்சு", "ஐஞ்சு", "அய்ந்து", "ஐந்", "anju", "ainthu", "aindhu", "ainju", "anchu", "five"],
  6: ["ஆறு", "aaru", "aru", "six"],
  7: ["ஏழு", "ezhu", "elu", "yezhu", "eelu", "seven"],
  8: ["எட்டு", "ettu", "eight"],
  9: ["ஒன்பது", "ஒம்பது", "ஒம்போது", "ஒன்போது", "onbathu", "ombathu", "ombodhu", "onbadhu", "nine"],
  10: ["பத்து", "pathu", "pattu", "paththu", "patthu", "ten"],
  11: ["பதினொன்று", "பதினொண்ணு", "பதினொன்னு", "பதிநொன்னு", "pathinonnu", "padhinonnu", "eleven"],
  12: ["பன்னிரண்டு", "பன்னெண்டு", "பன்னிரெண்டு", "பன்னண்டு", "pannendu", "pannirandu", "panniranduu", "twelve"],
  13: ["பதிமூன்று", "பதிமூணு", "பதின்மூன்று", "பதின்மூணு", "pathimoonu", "padhimoonu", "thirteen"],
  14: ["பதினான்கு", "பதினாலு", "பதிநாலு", "பதினாங்கு", "pathinaalu", "padhinaalu", "pathinalu", "fourteen"],
  15: ["பதினைந்து", "பதினஞ்சு", "பதினைஞ்சு", "பதிநஞ்சு", "பதினஞ்", "pathinanju", "padhinanju", "pathinainthu", "fifteen"],
  16: ["பதினாறு", "பதினாரு", "pathinaaru", "padhinaaru", "sixteen"],
  17: ["பதினேழு", "பதினேழ்", "pathinezhu", "padhinezhu", "seventeen"],
  18: ["பதினெட்டு", "பதிணெட்டு", "pathinettu", "padhinettu", "eighteen"],
  19: ["பத்தொன்பது", "பத்தொம்பது", "பத்தொன்போது", "paththonbathu", "pathombathu", "pathonbathu", "nineteen"],
};
const TENS: Record<number, string[]> = {
  20: ["இருபது", "இருவது", "irupathu", "iruvathu", "irubathu", "twenty"],
  30: ["முப்பது", "muppathu", "muppadhu", "thirty"],
  40: ["நாற்பது", "நாப்பது", "narpathu", "naarpathu", "nappathu", "forty"],
  50: ["ஐம்பது", "அம்பது", "aimpathu", "ambathu", "fifty"],
  60: ["அறுபது", "arupathu", "arubathu", "sixty"],
  70: ["எழுபது", "எழுவது", "ezhupathu", "elupathu", "seventy"],
  80: ["எண்பது", "எம்பது", "enbathu", "embathu", "eighty"],
  90: ["தொண்ணூறு", "தொன்னூறு", "thonnooru", "thonnuru", "ninety"],
};
/** Tens stems that continue into a single word with the ones ("இருபத்தஞ்சு" = 20 + 5). Longest first. */
const TENS_STEMS: [string, number][] = [
  ["இருபத்", 20],
  ["இருவத்", 20],
  ["முப்பத்", 30],
  ["நாற்பத்", 40],
  ["நாப்பத்", 40],
  ["ஐம்பத்", 50],
  ["அம்பத்", 50],
  ["அறுபத்", 60],
  ["எழுபத்", 70],
  ["எழுவத்", 70],
  ["எண்பத்", 80],
  ["எம்பத்", 80],
  ["தொண்ணூற்று", 90],
  ["தொன்னூற்று", 90],
  ["நூற்று", 100],
  ["நூற்றி", 100],
];
const HUNDREDS: Record<number, string[]> = {
  100: ["நூறு", "nooru", "hundred", "நூத்து"],
  200: ["இருநூறு", "இரு நூறு", "இரநூறு", "irunooru", "ரெண்டு நூறு"],
  300: ["முன்னூறு", "munnooru"],
  400: ["நானூறு", "naanooru", "nanooru"],
  500: ["ஐநூறு", "ஐந்நூறு", "ஐநூத்து", "ainooru", "ainnooru", "ஐநூறு"],
  600: ["அறுநூறு", "arunooru"],
  700: ["எழுநூறு", "ezhunooru"],
  800: ["எண்ணூறு", "ennooru"],
  900: ["தொள்ளாயிரம்", "thollayiram"],
  1000: ["ஆயிரம்", "aayiram", "ayiram", "thousand"],
};

/** Words that only mean "glue" after a tens word: "இருபத்தி" in "இருபத்தி ஐந்து". They count as that tens value. */
const TENS_GLUE: [string, number][] = [
  ["இருபத்தி", 20], ["இருபத்து", 20], ["இருவத்தி", 20], ["இருவத்து", 20], ["முப்பத்தி", 30], ["முப்பத்து", 30], ["நாற்பத்தி", 40], ["நாப்பத்தி", 40], ["ஐம்பத்தி", 50], ["அம்பத்தி", 50],
  ["அறுபத்தி", 60], ["எழுபத்தி", 70], ["எண்பத்தி", 80], ["தொண்ணூற்றி", 90], ["நூற்றி", 100], ["நூற்று", 100],
];

const numMap = new Map<string, number>();
const put = (spelling: string, value: number) => {
  numMap.set(/[஀-௿]/.test(spelling) ? spelling.normalize("NFC") : `~${skeleton(spelling)}`, value);
};
for (const [v, list] of Object.entries(ONES)) for (const s of list) put(s, Number(v));
for (const [v, list] of Object.entries(TENS)) for (const s of list) put(s, Number(v));
for (const [v, list] of Object.entries(HUNDREDS)) for (const s of list) put(s, Number(v));
for (const [s, v] of TENS_GLUE) put(s, v);

// Compounds in one word: stem + glue + ones, with the ones' first vowel merged into "த்" ("இருபத்" + "ஐந்து" = "இருபத்தைந்து").
const VOWEL_MERGE: Record<string, string> = { அ: "த", ஆ: "தா", இ: "தி", ஈ: "தீ", உ: "து", ஊ: "தூ", எ: "தெ", ஏ: "தே", ஐ: "தை", ஒ: "தொ", ஓ: "தோ" };
const compound = new Map<string, number>();
for (const [stem, tens] of TENS_STEMS) {
  for (let d = 1; d <= 9; d++) {
    for (const w of ONES[d]!) {
      if (!/[஀-௿]/.test(w)) continue;
      const first = w[0]!;
      const merged = VOWEL_MERGE[first];
      if (merged) compound.set(stem + merged + w.slice(1), tens + d);
      else for (const glue of ["தி", "து", "த", "த்தி", ""]) compound.set(stem + glue + w, tens + d);
      // spoken: "இருபத்தி" + "ஐந்து" without a space
      for (const glue of ["தி", "து"]) compound.set(stem + glue + w, tens + d);
    }
  }
}

/** Mixed fractions in one word: ஒண்ணரை 1.5, ரெண்டேகால் 2.25, மூணேமுக்கால் 3.75 (Tamil script only; Tanglish through `latinFraction`). */
const fused = new Map<string, number>();
for (let d = 1; d <= 10; d++) {
  for (const w of ONES[d]!) {
    if (!/[஀-௿]/.test(w) || !w.endsWith("ு")) continue;
    const base = w.slice(0, -1);
    fused.set(`${base}ரை`, d + 0.5);
    fused.set(`${base}ேகால்`, d + 0.25);
    fused.set(`${base}ேமுக்கால்`, d + 0.75);
    fused.set(`${base}ேகால`, d + 0.25);
  }
}

const FRACTIONS: Record<string, number> = {
  அரை: 0.5, பாதி: 0.5, அரைக்: 0.5, half: 0.5, arai: 0.5, paadhi: 0.5, pathi: 0.5, "½": 0.5,
  கால்: 0.25, kaal: 0.25, quarter: 0.25, "¼": 0.25, கால: 0.25,
  முக்கால்: 0.75, mukkaal: 0.75, mukkal: 0.75, "¾": 0.75, முக்கால: 0.75,
};
const fractionSk = new Map<string, number>();
for (const [k, v] of Object.entries(FRACTIONS)) fractionSk.set(/[஀-௿½¼¾]/.test(k) ? k.normalize("NFC") : `~${skeleton(k)}`, v);

/** Fraction value of a word, or null. */
export function fractionOf(token: string): number | null {
  const t = token.normalize("NFC");
  return fractionSk.get(t) ?? fractionSk.get(`~${skeleton(t)}`) ?? null;
}

/** Tanglish mixed fractions: "onnarai" (1.5), "rendarai" (2.5), "moonarai", "onnekaal" (1.25). */
function latinFraction(sk: string): number | null {
  const m = sk.match(/^(.+?)(arai|rai|ekal|ekal|emukal)$/);
  if (!m) return null;
  const base = m[1]!;
  const add = m[2]!.endsWith("rai") ? 0.5 : m[2] === "emukal" ? 0.75 : 0.25;
  for (let d = 1; d <= 10; d++) {
    for (const w of ONES[d]!) {
      if (/[஀-௿]/.test(w)) continue;
      const wsk = skeleton(w).replace(/[aeiou]$/, "");
      if (wsk === base || wsk === base.replace(/[aeiou]$/, "")) return d + add;
    }
  }
  return null;
}

/** The value of a number word (Tamil, Tanglish or English, 1 to 1000), or null. Plain digits are the caller's job. */
export function numberWord(token: string): number | null {
  const t = token.normalize("NFC").toLowerCase();
  const direct = numMap.get(t) ?? numMap.get(`~${skeleton(t)}`);
  if (direct !== undefined) return direct;
  const c = compound.get(t);
  if (c !== undefined) return c;
  const f = fused.get(t);
  if (f !== undefined) return f;
  if (/^[a-z]+$/.test(t)) {
    const sk = skeleton(t);
    const lf = latinFraction(sk);
    if (lf !== null) return lf;
  }
  return null;
}

/** True for words that glue to the number before them ("இருபத்தி" before "ஐந்து"): the value is a tens/hundreds word. */
export const isTensWord = (n: number) => n >= 20 && n % 10 === 0 && n < 100;
export const isHundredsWord = (n: number) => n >= 100 && n % 100 === 0 && n < 1000;

// ------------------------------------------------------------------ units

interface UnitDef {
  unit: Unit;
  words: string[];
}
const UNIT_DEFS: UnitDef[] = [
  { unit: "kg", words: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "கிலோ", "கிலோகிராம்", "கிகி", "கேஜி", "கிலோவு", "கிலோவா", "கீலோ", "கிலோகிராமு"] },
  { unit: "g", words: ["g", "gm", "gms", "gram", "grams", "கிராம்", "கிராமு", "கிராம", "கிராம்ஸ்", "கிரா"] },
  { unit: "ml", words: ["ml", "mls", "millilitre", "milliliter", "மில்லி", "மிலி", "மில்லிலிட்டர்"] },
  { unit: "l", words: ["l", "lt", "ltr", "ltrs", "litre", "liter", "litres", "liters", "லிட்டர்", "லிட்டரு", "லிட்டர", "லிட்", "லீட்டர்"] },
  { unit: "pkt", words: ["packet", "packets", "pkt", "pkts", "pack", "packs", "பாக்கெட்", "பாக்கெட்டு", "பேக்கெட்", "பாக்கட்", "பேக்", "பாக்கெட்டுகள்", "பாக்கெட்கள்"] },
  { unit: "dozen", words: ["dozen", "dozens", "dz", "டஜன்", "டசன்", "டசனு"] },
  { unit: "pcs", words: ["piece", "pieces", "pc", "pcs", "nos", "number", "numbers", "நம்பர்", "பீஸ்", "பீசு", "துண்டு", "எண்", "எண்ணம்"] },
  { unit: "box", words: ["box", "boxes", "பெட்டி", "பாக்ஸ்", "பெட்டிகள்"] },
  { unit: "bottle", words: ["bottle", "bottles", "பாட்டில்", "பாட்டிலு", "போட்டில்", "பாட்டிள்"] },
  { unit: "m", words: ["metre", "meter", "metres", "meters", "மீட்டர்", "மீட்டரு", "மீட்டர"] },
  { unit: "bunch", words: ["bunch", "bunches", "கட்டு", "கட்டுகள்"] },
  { unit: "strip", words: ["strip", "strips", "ஸ்ட்ரிப்", "ஸ்டிரிப்"] },
];
const unitMap = new Map<string, Unit>();
for (const d of UNIT_DEFS) for (const w of d.words) unitMap.set(/[஀-௿]/.test(w) ? w.normalize("NFC") : w, d.unit);
const unitSk = new Map<string, Unit>();
for (const d of UNIT_DEFS) for (const w of d.words) if (!/[஀-௿]/.test(w) && w.length >= 3) unitSk.set(skeleton(w), d.unit);

/** The unit a word means, or null. Short Latin words ("g", "l") must match exactly. */
export function unitOf(token: string): Unit | null {
  const t = token.normalize("NFC").toLowerCase().replace(/\.$/, "");
  const u = unitMap.get(t);
  if (u) return u;
  if (/^[a-z]+$/.test(t) && t.length >= 4) return unitSk.get(skeleton(t)) ?? null;
  return null;
}

/** All unit words (Tamil script) longest first: used to split "ரெண்டுகிலோ" and "அரைக்கிலோ" into number + unit. */
export const UNIT_SUFFIXES: [string, Unit][] = UNIT_DEFS.flatMap((d) => d.words.filter((w) => /[஀-௿]/.test(w)).map((w) => [w.normalize("NFC"), d.unit] as [string, Unit])).sort((a, b) => b[0].length - a[0].length);

/** Base unit family and the factor to the base (kg and l are the bases). */
export const UNIT_FAMILY: Record<Unit, { family: "weight" | "volume" | "count" | "length"; toBase: number }> = {
  kg: { family: "weight", toBase: 1 },
  g: { family: "weight", toBase: 0.001 },
  l: { family: "volume", toBase: 1 },
  ml: { family: "volume", toBase: 0.001 },
  pkt: { family: "count", toBase: 1 },
  dozen: { family: "count", toBase: 12 },
  pcs: { family: "count", toBase: 1 },
  box: { family: "count", toBase: 1 },
  bottle: { family: "count", toBase: 1 },
  m: { family: "length", toBase: 1 },
  bunch: { family: "count", toBase: 1 },
  strip: { family: "count", toBase: 1 },
};

// ------------------------------------------------------------------ fillers and connectors

/** Words that end the current item and start the next ("and", "அப்புறம்"). */
const CONNECTORS = [
  "அப்புறம்", "அப்புறமா", "அப்றம்", "அப்பறம்", "அப்பால", "பிறகு", "பின்னர்", "மற்றும்", "அத்தோட", "அதோட", "இன்னும்", "மேலும்", "அடுத்து", "அடுத்தது",
  "and", "also", "then", "next", "plus", "apram", "appuram", "apuram", "aprom", "appram", "piragu", "pirahu", "matrum", "mattrum", "innum", "adutha", "aduthu", "after",
];
/** Words dropped without ending the item ("please", "கொடுங்க"). */
const FILLERS = [
  "சரி", "ஆமா", "இப்போ", "இப்ப", "வேணும்", "வேண்டும்", "வேணுங்க", "வேனும்", "குடுங்க", "கொடுங்க", "கொடுப்பா", "குடுப்பா", "தாங்க", "தரவும்", "தாங்கோ", "போடுங்க", "போடு", "எழுதுங்க", "பில்", "பில்லு", "எடுங்க", "எடுத்துக்கோங்க",
  "ப்ளீஸ்", "பிளீஸ்", "தயவு", "செய்து", "அண்ணா", "அக்கா", "சார்", "மேடம்", "ஆ", "ம்", "ஹ்ம்", "அது", "இது", "அதுக்கு", "கொஞ்சம்", "ஒரு", "கூடவே",
  "ok", "okay", "please", "pls", "plz", "add", "give", "kudunga", "kodunga", "thanga", "tharunga", "podunga", "venum", "venumga", "bill", "anna", "akka", "sir", "madam", "uh", "um", "hmm", "yes", "the", "a", "an", "of", "some", "more", "extra", "another", "need", "want", "i", "me", "my", "to", "for", "with", "sari", "ippo", "ippa", "thaanga", "ezhuthunga", "podu",
];
const connectorSk = new Set(CONNECTORS.map((w) => (/[஀-௿]/.test(w) ? w.normalize("NFC") : `~${skeleton(w)}`)));
const fillerSk = new Set(FILLERS.map((w) => (/[஀-௿]/.test(w) ? w.normalize("NFC") : `~${skeleton(w)}`)));
const keyOf = (t: string) => (/[஀-௿]/.test(t) ? t.normalize("NFC") : `~${skeleton(t)}`);
export const isConnector = (t: string) => connectorSk.has(keyOf(t));
/** "ஒரு" is a number word too; the parser asks `numberWord` first, so listing it here only matters for item phrases. */
export const isFiller = (t: string) => fillerSk.has(keyOf(t));

/** Rupee words: "50 ரூபாய்க்கு" is an amount, not a quantity. */
export const isRupeeWord = (t: string) => /^(₹|rs\.?|rupees?|rupee|inr|ரூபாய்|ரூபாய்க்கு|ரூபா|ருபாய்|ரூ)$/i.test(t.normalize("NFC")) || /^ரூபாய/.test(t.normalize("NFC"));

// ------------------------------------------------------------------ item-word glossary (Tamil / Tanglish <-> English)

/**
 * Everyday Tamil words for things a Tamil shop sells, with the English word a catalogue usually uses. A spoken "அரிசி" finds
 * "Ponni rice" even when the owner never typed a Tamil name. Used on both sides: an item word and a spoken word that map to
 * the same English word match. (The shop's own AI search words and approved Tamil names are used as well, and win.)
 */
export const GLOSSARY: Record<string, string[]> = {
  rice: ["அரிசி", "arisi", "ari", "சாதம்", "பச்சரிசி", "புழுங்கல்"],
  oil: ["எண்ணெய்", "எண்ணை", "ennai", "yennai", "ennei"],
  gingelly: ["நல்லெண்ணெய்", "நல்லெண்ணை", "nallennai", "nallenai", "நல்லெண்ணெ", "sesame"],
  groundnut: ["கடலை", "கடலெண்ணெய்", "kadalai", "peanut", "verkadalai", "வேர்க்கடலை"],
  coconut: ["தேங்காய்", "thengai", "thenga", "தேங்கா"],
  sunflower: ["சூரியகாந்தி", "suriyakanthi", "sunflower"],
  dal: ["பருப்பு", "paruppu", "dhal", "daal", "dal"],
  toor: ["துவரம்", "துவரை", "thuvaram", "tuvar", "thuvarai", "arhar", "துவரம்பருப்பு"],
  urad: ["உளுந்து", "உளுத்தம்", "ulundhu", "ulunthu", "uluthampparuppu", "உளுந்தம்"],
  moong: ["பாசிப்பருப்பு", "பாசி", "pasiparuppu", "paasi", "pasi", "பயறு", "payaru"],
  sugar: ["சர்க்கரை", "சீனி", "sakkarai", "sarkarai", "seeni", "cheeni", "சக்கரை"],
  salt: ["உப்பு", "uppu"],
  milk: ["பால்", "paal", "pal", "பாலு"],
  curd: ["தயிர்", "thayir", "tayir", "yogurt", "curd"],
  ghee: ["நெய்", "nei", "ney", "நெய"],
  butter: ["வெண்ணெய்", "vennai", "butter"],
  tea: ["டீ", "தேநீர்", "chai", "tea", "டீத்தூள்", "theneer", "chaya"],
  coffee: ["காபி", "காப்பி", "coffee", "kaapi", "kapi"],
  wheat: ["கோதுமை", "godhumai", "kothumai", "gothumai", "wheat"],
  atta: ["ஆட்டா", "மாவு", "maavu", "atta", "aata"],
  maida: ["மைதா", "maida", "maithaa"],
  rava: ["ரவை", "ravai", "rava", "sooji", "semolina", "ரவா"],
  onion: ["வெங்காயம்", "வெங்காய", "vengayam", "venkayam", "ulli", "onion", "பெரிய வெங்காயம்"],
  tomato: ["தக்காளி", "thakkali", "takkali", "tamato", "tomatto"],
  potato: ["உருளைக்கிழங்கு", "உருளை", "urulai", "urulaikilangu", "potato", "kilangu", "கிழங்கு"],
  chilli: ["மிளகாய்", "மிளகா", "milagai", "milaga", "chilli", "chili", "மிளகாய்த்தூள்"],
  pepper: ["மிளகு", "milagu", "pepper"],
  turmeric: ["மஞ்சள்", "manjal", "manjaal", "haldi", "turmeric"],
  coriander: ["மல்லி", "கொத்தமல்லி", "malli", "kothamalli", "dhaniya", "coriander", "மல்லித்தூள்"],
  cumin: ["சீரகம்", "jeeragam", "seeragam", "jeera", "cumin"],
  mustard: ["கடுகு", "kadugu", "mustard"],
  tamarind: ["புளி", "puli", "tamarind"],
  jaggery: ["வெல்லம்", "vellam", "jaggery", "karuppatti", "கருப்பட்டி"],
  garlic: ["பூண்டு", "poondu", "garlic"],
  ginger: ["இஞ்சி", "inji", "ginger"],
  egg: ["முட்டை", "muttai", "eggs", "egg"],
  bread: ["ரொட்டி", "பிரெட்", "bread", "rotti"],
  biscuit: ["பிஸ்கட்", "பிஸ்கெட்", "biscuit", "biscuits", "biscuts"],
  soap: ["சோப்பு", "சோப்", "soap", "soappu"],
  powder: ["தூள்", "பவுடர்", "thool", "podi", "powder", "பொடி"],
  detergent: ["சலவை", "டிடர்ஜென்ட்", "detergent", "surf"],
  water: ["தண்ணீர்", "thanni", "thanneer", "water", "வாட்டர்"],
  banana: ["வாழைப்பழம்", "வாழை", "vazhaipazham", "vazhapazham", "banana"],
  lemon: ["எலுமிச்சை", "elumichai", "lemon", "எலுமிச்ச"],
  agarbathi: ["ஊதுபத்தி", "agarbathi", "agarbatti", "incense", "udhubathi", "ஊதுபத்தி"],
  candle: ["மெழுகுவர்த்தி", "candle", "candles"],
  matchbox: ["தீப்பெட்டி", "theepetti", "matchbox", "matches", "தீப்பெட்டி"],
  noodles: ["நூடுல்ஸ்", "noodles", "maggi"],
  pickle: ["ஊறுகாய்", "oorugai", "urugai", "pickle", "ஊறுகா"],
  cashew: ["முந்திரி", "munthiri", "cashew", "mundhiri"],
  cool: ["குளிர்பானம்", "cool", "colddrink", "cooldrink", "soda"],
  shampoo: ["ஷாம்பு", "shampoo", "சாம்பு"],
  toothpaste: ["பற்பசை", "டூத்பேஸ்ட்", "toothpaste", "paste", "பேஸ்ட்"],
  toothbrush: ["பிரஷ்", "toothbrush", "brush"],
  battery: ["பேட்டரி", "battery", "cell"],
  poha: ["அவல்", "aval", "poha"],
  saree: ["புடவை", "சேலை", "pudavai", "selai", "saree", "sari"],
  loose: ["உதிரி", "loose", "udhiri"],
  packet: ["பாக்கெட்", "packet", "pack"],
  raw: ["பச்சை", "pachai", "raw"],
  ponni: ["பொன்னி", "ponni", "ponny"],
  idli: ["இட்லி", "idli", "idly"],
  sambar: ["சாம்பார்", "sambar", "sambhar"],
  chocolate: ["சாக்லேட்", "சாக்லெட்", "chocolate", "choco"],
  floor: ["தரை", "floor"],
  cleaner: ["கிளீனர்", "cleaner"],
  dish: ["டிஷ்", "dish"],
  wash: ["வாஷ்", "wash", "washing"],
  gel: ["ஜெல்", "gel"],
  mixture: ["மிக்சர்", "mixture", "mixer"],
  namkeen: ["நம்கீன்", "namkeen"],
  camphor: ["கற்பூரம்", "karpooram", "camphor"],
  wicks: ["திரி", "thiri", "wicks"],
  bath: ["குளியல்", "bath"],
  red: ["சிவப்பு", "சிகப்பு", "sivappu", "red"],
  big: ["பெரிய", "periya", "big"],
  small: ["சின்ன", "chinna", "small"],
};
