/**
 * Interaction and duplicate-salt warnings for a pharmacy bill (advisory).
 *
 * CURATED - MUST BE REVIEWED BY A PHARMACIST BEFORE ANY SHOP RELIES ON IT.
 * The table below is a short, hand-written list of well-known major or moderate interactions among the medicines a
 * typical Tamil Nadu pharmacy stocks (the srikit demo catalogue). It is NOT a complete drug-interaction database:
 *   - a pair that is not in the table is reported as "no pair found in the reference table", never as "safe";
 *   - nothing here gives doses, timings or a decision: the pharmacist decides, and a sale is never blocked;
 *   - the model may only explain a pair the table found, in simple words, from the note written here.
 * Sources the entries were written from: standard references (BNF / Stockley's / product labelling) for the effects
 * named. Each entry needs a pharmacist's sign-off (set `reviewedBy` below once done).
 */
import { ingredientsOf, isTopical } from "./salts";

export const INTERACTION_TABLE_REVIEW = { reviewed: false, reviewedBy: null as string | null, note: "Curated by an engineer from standard references; a pharmacist must review every row before this is relied on." } as const;

export type InteractionSeverity = "major" | "moderate";

export interface InteractionEntry {
  id: string;
  /** Canonical ingredient names (see salts.ts) for one side and the other. A pair matches when the two bill items hold one of each. */
  a: readonly string[];
  b: readonly string[];
  severity: InteractionSeverity;
  /** What the table says happens: plain, factual, no doses. English. */
  note: string;
  noteTa: string;
}

const NSAID = ["ibuprofen", "diclofenac", "aceclofenac", "naproxen", "ketorolac", "nimesulide"] as const;
const FLUOROQUINOLONE = ["ciprofloxacin", "levofloxacin", "ofloxacin", "moxifloxacin"] as const;
const BENZO = ["alprazolam", "clonazepam", "diazepam", "lorazepam"] as const;
const QT = ["azithromycin", "ondansetron", "domperidone", "levofloxacin", "ciprofloxacin", "moxifloxacin"] as const;
const METALS = ["calcium", "iron", "zinc", "antacid"] as const;
const SUGAR_LOWERING = ["metformin", "glimepiride", "insulin", "gliclazide", "glipizide"] as const;
const ARB = ["losartan", "telmisartan", "valsartan", "olmesartan"] as const;

export const INTERACTION_TABLE: readonly InteractionEntry[] = [
  { id: "nsaid-aspirin", a: NSAID, b: ["aspirin"], severity: "major", note: "Taken together, the pain-killer and aspirin raise the chance of stomach bleeding, and some of them can weaken aspirin's protective effect on the heart.", noteTa: "இரண்டையும் சேர்த்து எடுத்தால் வயிற்றில் இரத்தக்கசிவு வரும் வாய்ப்பு கூடும்; சில வலி நிவாரணிகள் இதயத்தைக் காக்கும் ஆஸ்பிரினின் பலனையும் குறைக்கலாம்." },
  { id: "nsaid-nsaid", a: NSAID, b: NSAID, severity: "major", note: "Two anti-inflammatory pain-killers together add to the risk of stomach bleeding and kidney harm without more relief.", noteTa: "இரண்டு வலி நிவாரணி (அழற்சி எதிர்ப்பு) மருந்துகளை சேர்த்தால் கூடுதல் நிவாரணம் இல்லாமல் வயிற்று இரத்தக்கசிவு, சிறுநீரக பாதிப்பு ஆபத்து கூடும்." },
  { id: "clopidogrel-ppi", a: ["clopidogrel"], b: ["omeprazole", "esomeprazole"], severity: "major", note: "Omeprazole can reduce how well clopidogrel works to prevent clots.", noteTa: "ஒமிப்ரசோல், க்ளோபிடோக்ரெல் இரத்த உறைவைத் தடுக்கும் திறனைக் குறைக்கலாம்." },
  { id: "clopidogrel-nsaid", a: ["clopidogrel"], b: [...NSAID], severity: "major", note: "Clopidogrel with an anti-inflammatory pain-killer raises the chance of bleeding.", noteTa: "க்ளோபிடோக்ரெலுடன் வலி நிவாரணி (அழற்சி எதிர்ப்பு) சேர்த்தால் இரத்தக்கசிவு வாய்ப்பு கூடும்." },
  { id: "clopidogrel-aspirin", a: ["clopidogrel"], b: ["aspirin"], severity: "moderate", note: "Clopidogrel and aspirin together raise the chance of bleeding. Doctors sometimes prescribe them together on purpose.", noteTa: "க்ளோபிடோக்ரெல், ஆஸ்பிரின் இரண்டும் சேர்ந்தால் இரத்தக்கசிவு வாய்ப்பு கூடும். சில நேரங்களில் மருத்துவர் வேண்டுமென்றே இரண்டையும் எழுதுவதுண்டு." },
  { id: "opioid-benzo", a: ["tramadol"], b: [...BENZO], severity: "major", note: "Tramadol with a sedative tablet (benzodiazepine) can cause deep drowsiness and slowed breathing.", noteTa: "ட்ராமடாலுடன் தூக்க மாத்திரை (பென்சோடயாசெபின்) சேர்த்தால் அதிக தூக்கமும் மூச்சு மெதுவாவதும் ஏற்படலாம்." },
  { id: "opioid-gabapentinoid", a: ["tramadol"], b: ["pregabalin", "gabapentin"], severity: "major", note: "Tramadol with pregabalin can add to drowsiness and slow breathing.", noteTa: "ட்ராமடாலுடன் ப்ரீகபாலின் சேர்த்தால் தூக்கக் கலக்கமும் மூச்சு மெதுவாவதும் கூடலாம்." },
  { id: "benzo-benzo", a: [...BENZO], b: [...BENZO], severity: "moderate", note: "Two sedative tablets of the same family together add to drowsiness and confusion.", noteTa: "ஒரே வகை இரண்டு தூக்க மாத்திரைகளை சேர்த்தால் தூக்கக் கலக்கமும் குழப்பமும் கூடும்." },
  { id: "benzo-gabapentinoid", a: [...BENZO], b: ["pregabalin", "gabapentin"], severity: "moderate", note: "A sedative tablet with pregabalin adds to drowsiness and dizziness.", noteTa: "தூக்க மாத்திரையுடன் ப்ரீகபாலின் சேர்த்தால் தூக்கக் கலக்கமும் தலைசுற்றலும் கூடும்." },
  { id: "fq-steroid", a: [...FLUOROQUINOLONE], b: ["prednisolone", "dexamethasone", "methylprednisolone"], severity: "major", note: "A quinolone antibiotic with a steroid tablet raises the chance of tendon (heel or muscle cord) injury.", noteTa: "குயினோலோன் வகை நுண்ணுயிர் எதிர்ப்பி, ஸ்டீராய்டு மாத்திரையுடன் சேர்ந்தால் தசைநார் (குதிகால் நரம்பு) பாதிப்பு வாய்ப்பு கூடும்." },
  { id: "fq-metals", a: [...FLUOROQUINOLONE], b: [...METALS], severity: "moderate", note: "Calcium, iron, zinc or antacid can stop the antibiotic from being absorbed fully, so it may work less well.", noteTa: "கால்சியம், இரும்பு, துத்தநாகம் அல்லது அமிலம் நீக்கும் மருந்து, நுண்ணுயிர் எதிர்ப்பி முழுமையாக உடலில் சேராமல் செய்து அதன் பலனைக் குறைக்கலாம்." },
  { id: "doxycycline-metals", a: ["doxycycline"], b: [...METALS], severity: "moderate", note: "Calcium, iron, zinc or antacid can stop doxycycline from being absorbed fully, so it may work less well.", noteTa: "கால்சியம், இரும்பு, துத்தநாகம் அல்லது அமிலம் நீக்கும் மருந்து, டாக்ஸிசைக்ளின் முழுமையாக உடலில் சேராமல் செய்து அதன் பலனைக் குறைக்கலாம்." },
  { id: "fq-sugar", a: [...FLUOROQUINOLONE], b: ["glimepiride", "insulin", "gliclazide", "glipizide"], severity: "moderate", note: "A quinolone antibiotic can make blood sugar swing, low or high, in people on diabetes medicines.", noteTa: "குயினோலோன் வகை நுண்ணுயிர் எதிர்ப்பி, சர்க்கரை நோய் மருந்து எடுப்பவர்களுக்கு இரத்த சர்க்கரையை குறைக்கவோ கூட்டவோ செய்யலாம்." },
  { id: "levothyroxine-metals", a: ["levothyroxine"], b: ["calcium", "iron", "antacid"], severity: "moderate", note: "Calcium, iron or antacid can reduce how much levothyroxine the body absorbs.", noteTa: "கால்சியம், இரும்பு அல்லது அமிலம் நீக்கும் மருந்து, லெவோதைராக்சின் உடலில் சேரும் அளவைக் குறைக்கலாம்." },
  { id: "arb-nsaid", a: [...ARB], b: [...NSAID], severity: "major", note: "An anti-inflammatory pain-killer can weaken a blood-pressure tablet like this and, together, can harm the kidneys.", noteTa: "வலி நிவாரணி (அழற்சி எதிர்ப்பு) மருந்து, இந்த வகை இரத்த அழுத்த மாத்திரையின் பலனைக் குறைக்கலாம்; சேர்ந்து எடுத்தால் சிறுநீரகத்தை பாதிக்கலாம்." },
  { id: "arb-arb", a: [...ARB], b: [...ARB], severity: "major", note: "Two blood-pressure tablets of this same family together are not normally combined and can harm the kidneys and raise potassium.", noteTa: "இந்த ஒரே வகையைச் சேர்ந்த இரண்டு இரத்த அழுத்த மாத்திரைகளை பொதுவாக சேர்ப்பதில்லை; சிறுநீரகத்தை பாதித்து பொட்டாசியத்தை கூட்டலாம்." },
  { id: "betablocker-sugar", a: ["atenolol", "propranolol", "metoprolol"], b: ["glimepiride", "insulin", "gliclazide", "glipizide"], severity: "moderate", note: "A beta-blocker can hide the warning signs of low blood sugar (shaking, fast heartbeat) in people on diabetes medicines.", noteTa: "பீட்டா-பிளாக்கர் மாத்திரை, சர்க்கரை நோய் மருந்து எடுப்பவர்களுக்கு சர்க்கரை குறைவதன் அறிகுறிகளை (நடுக்கம், வேகமான இதயத் துடிப்பு) மறைத்துவிடலாம்." },
  { id: "steroid-nsaid", a: ["prednisolone", "dexamethasone", "methylprednisolone"], b: [...NSAID, "aspirin"], severity: "major", note: "A steroid tablet with an anti-inflammatory pain-killer or aspirin raises the chance of stomach ulcers and bleeding.", noteTa: "ஸ்டீராய்டு மாத்திரையுடன் வலி நிவாரணி அல்லது ஆஸ்பிரின் சேர்த்தால் வயிற்றுப் புண், இரத்தக்கசிவு வாய்ப்பு கூடும்." },
  { id: "steroid-sugar", a: ["prednisolone", "dexamethasone", "methylprednisolone"], b: [...SUGAR_LOWERING], severity: "moderate", note: "A steroid tablet can raise blood sugar and make diabetes medicines work less well.", noteTa: "ஸ்டீராய்டு மாத்திரை இரத்த சர்க்கரையை உயர்த்தி, சர்க்கரை நோய் மருந்தின் பலனைக் குறைக்கலாம்." },
  { id: "qt-qt", a: [...QT], b: [...QT], severity: "moderate", note: "Both medicines can affect the heart's rhythm (QT interval); together the effect adds up, mainly in people with heart problems.", noteTa: "இரண்டு மருந்துகளும் இதயத் துடிப்பின் ஒழுங்கை (QT இடைவெளி) பாதிக்கலாம்; சேர்ந்தால் விளைவு கூடும், குறிப்பாக இதய நோய் உள்ளவர்களுக்கு." },
  { id: "aspirin-ketorolac", a: ["aspirin"], b: ["ketorolac"], severity: "major", note: "Aspirin with ketorolac raises the chance of stomach bleeding.", noteTa: "ஆஸ்பிரினுடன் கெட்டோரோலாக் சேர்த்தால் வயிற்று இரத்தக்கசிவு வாய்ப்பு கூடும்." },
  { id: "metformin-cimetidine", a: ["metformin"], b: ["cimetidine"], severity: "moderate", note: "Cimetidine can raise the level of metformin in the body.", noteTa: "சிமெடிடின், உடலில் மெட்ஃபார்மின் அளவை உயர்த்தலாம்." },
  { id: "statin-gemfibrozil", a: ["atorvastatin", "rosuvastatin", "simvastatin"], b: ["gemfibrozil"], severity: "major", note: "A statin with gemfibrozil raises the chance of serious muscle damage.", noteTa: "ஸ்டாடின் மாத்திரையுடன் ஜெம்ஃபைப்ரோசில் சேர்த்தால் தீவிர தசை பாதிப்பு வாய்ப்பு கூடும்." },
  { id: "warfarin-nsaid", a: ["warfarin"], b: [...NSAID, "aspirin"], severity: "major", note: "Warfarin with a pain-killer or aspirin raises the chance of serious bleeding.", noteTa: "வார்ஃபரினுடன் வலி நிவாரணி அல்லது ஆஸ்பிரின் சேர்த்தால் தீவிர இரத்தக்கசிவு வாய்ப்பு கூடும்." },
  { id: "warfarin-antibiotic", a: ["warfarin"], b: ["metronidazole", "ciprofloxacin", "levofloxacin", "azithromycin", "doxycycline"], severity: "major", note: "This antibiotic can make warfarin stronger, so the blood becomes too thin and bleeds easily.", noteTa: "இந்த நுண்ணுயிர் எதிர்ப்பி வார்ஃபரினின் வீரியத்தைக் கூட்டி இரத்தம் மிகவும் நீர்த்து எளிதில் கசியச் செய்யலாம்." },
] satisfies InteractionEntry[];

export interface BillMedicine {
  /** Any stable id of the bill line (item id). */
  id: string;
  name: string;
  composition: string | null;
}

export interface InteractionPair {
  /** Table entry id. */
  id: string;
  severity: InteractionSeverity;
  a: { id: string; name: string };
  b: { id: string; name: string };
  note: string;
  noteTa: string;
}

export interface DuplicateSalt {
  ingredient: string;
  items: { id: string; name: string }[];
}

export interface BillCheck {
  duplicates: DuplicateSalt[];
  interactions: InteractionPair[];
  /** Medicines whose composition could not be read, so they were not checked. */
  unchecked: { id: string; name: string }[];
}

/** Same active ingredient in two different medicines of the bill (code only). A cream and a tablet are not compared. */
export function findDuplicateSalts(meds: BillMedicine[]): DuplicateSalt[] {
  const byIngredient = new Map<string, { id: string; name: string; topical: boolean }[]>();
  for (const m of meds) {
    const topical = isTopical(`${m.name} ${m.composition ?? ""}`);
    for (const ing of ingredientsOf(m.composition)) {
      const list = byIngredient.get(ing) ?? [];
      if (!list.some((x) => x.id === m.id)) list.push({ id: m.id, name: m.name, topical });
      byIngredient.set(ing, list);
    }
  }
  const out: DuplicateSalt[] = [];
  for (const [ingredient, list] of byIngredient) {
    // Mixed routes (tablet + gel) are not the same dose twice; compare within a route.
    for (const route of [false, true]) {
      const same = list.filter((x) => x.topical === route);
      if (same.length >= 2) out.push({ ingredient, items: same.map(({ id, name }) => ({ id, name })) });
    }
  }
  return out;
}

/** Table pairs found among the bill's medicines (code only). */
export function findInteractions(meds: BillMedicine[], table: readonly InteractionEntry[] = INTERACTION_TABLE): InteractionPair[] {
  const parsed = meds.map((m) => ({ m, ing: ingredientsOf(m.composition) }));
  const out: InteractionPair[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const p = parsed[i]!;
      const q = parsed[j]!;
      for (const e of table) {
        // Same-family entries (both sides list the same names) need two different ingredients; others one on each side.
        const sameFamily = e.a.length === e.b.length && e.a.every((s) => e.b.includes(s));
        const pair = (x: string[], y: string[]) => x.some((s) => e.a.includes(s) && y.some((t) => e.b.includes(t) && (!sameFamily || s !== t)));
        if (pair(p.ing, q.ing) || pair(q.ing, p.ing)) {
          const key = `${e.id}|${[p.m.id, q.m.id].sort().join("|")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ id: e.id, severity: e.severity, a: { id: p.m.id, name: p.m.name }, b: { id: q.m.id, name: q.m.name }, note: e.note, noteTa: e.noteTa });
        }
      }
    }
  }
  return out.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "major" ? -1 : 1));
}

export function checkBill(meds: BillMedicine[]): BillCheck {
  const distinct = [...new Map(meds.map((m) => [m.id, m])).values()];
  return {
    duplicates: findDuplicateSalts(distinct),
    interactions: findInteractions(distinct),
    unchecked: distinct.filter((m) => ingredientsOf(m.composition).length === 0).map(({ id, name }) => ({ id, name })),
  };
}

/** Shown with every warning, in both languages. */
export const ADVISORY = {
  en: "Advisory only - the pharmacist decides. This is a short reference list, not a full interaction check; a medicine pair that is not listed is not proven safe.",
  ta: "ஆலோசனை மட்டுமே - மருந்தாளரே முடிவு செய்வார். இது சிறு குறிப்புப் பட்டியல் மட்டுமே, முழுமையான இடைவினைச் சோதனை அல்ல; பட்டியலில் இல்லாத ஜோடி பாதுகாப்பானது என்று பொருள் அல்ல.",
} as const;
