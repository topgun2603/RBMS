import { BUSINESS_TYPES, PACKS, packFor, type BusinessType } from "@rbms/verticals";
import { neutralise } from "../assist/safety";

/**
 * The deterministic reading of the five answers (docs/ai.md, Phase 7 part A): keyword tables in English, Tanglish and
 * Tamil for the trade, the product groups split from the owner's own list, the look and colour words, and what the
 * owner said about delivery, pickup and languages. It runs on every request: it is the whole answer when AI is off,
 * out of credits or on the mock provider, and the cross-check for what the model says.
 */

export const ANSWER_KEYS = ["sell", "buyers", "groups", "look", "extras"] as const;
export type AnswerKey = (typeof ANSWER_KEYS)[number];
export type Answers = Record<AnswerKey, string>;
export const MAX_ANSWER = 400;

export type Confidence = "high" | "medium" | "low";

// ------------------------------------------------------------------ text helpers

const TAMIL = /[஀-௿]/;
export const hasTamil = (s: string) => TAMIL.test(s);
/** Share of letters that are Tamil script. */
export function tamilShare(s: string): number {
  const letters = [...s].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return 0;
  return letters.filter((c) => TAMIL.test(c)).length / letters.length;
}
export const fold = (s: string) => s.normalize("NFC").toLowerCase().replace(/[‘’`]/g, "'").replace(/\s+/g, " ").trim();
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Latin words match on word edges (with a plural s / es); Tamil words match anywhere, without a final pulli (்), because
 * suffixes replace it: தமிழ் -> தமிழும், தமிழில்; பூக்கள் -> பூக்களும்.
 */
function rxFor(kw: string): RegExp {
  return hasTamil(kw) ? new RegExp(escapeRx(kw.replace(/்$/, "")), "g") : new RegExp(`(?<![a-z])${escapeRx(kw)}(?:s|es)?(?![a-z])`, "g");
}

// ------------------------------------------------------------------ trades

type Kw = [word: string, weight: number];
const k = (weight: number, ...words: string[]): Kw[] => words.map((w) => [w, weight]);

/** Words that point at a trade. Longer phrases win over the words inside them ("gym equipment" is sports, not gym). */
export const TRADE_WORDS: Record<BusinessType, Kw[]> = {
  fashion: [
    ...k(3, "saree", "sari", "kurti", "chudidar", "churidar", "salwar", "lehenga", "clothes", "clothing", "garment", "textile", "readymade", "ready made", "boutique", "menswear", "kidswear", "womenswear", "veshti", "pudavai", "selai", "javuli", "dress material", "nighties", "silk saree"),
    ...k(2, "dress", "kurta", "shirt", "jeans", "dhoti", "thuni", "ethnic wear", "leggings", "tops"),
    ...k(3, "புடவை", "சேலை", "ஆடை", "ஜவுளி", "சுடிதார்", "குர்தி", "வேட்டி", "ரெடிமேட்", "டிரஸ்"),
    ...k(2, "துணி", "சட்டை", "பட்டு"),
  ],
  pharmacy: [...k(3, "medical shop", "medical store", "medicine", "pharmacy", "chemist", "druggist", "marunthu", "mathirai", "மருந்து", "மருந்தகம்", "மாத்திரை", "மெடிக்கல்", "tablets and syrups"), ...k(2, "medical", "tablet", "syrup", "drugs")],
  restaurant: [
    ...k(3, "restaurant", "mess", "meals", "biryani", "tiffin", "parotta", "saapadu", "unavagam", "family restaurant", "dine in", "உணவகம்", "மெஸ்", "சாப்பாடு", "பிரியாணி", "டிபன்", "பரோட்டா", "ஹோட்டல்"),
    ...k(2, "hotel", "dosa", "idli", "dining", "chettinad", "thali", "veg meals", "non veg"),
  ],
  cloud_kitchen: [...k(5, "cloud kitchen", "home kitchen", "homemade food", "home made food", "home food", "online kitchen", "veetu saapadu", "veettu saapadu", "வீட்டு சாப்பாடு", "கிளவுட் கிச்சன்"), ...k(1, "kitchen")],
  grocery: [
    ...k(3, "grocery", "groceries", "kirana", "provision", "supermarket", "super market", "departmental store", "maligai", "malligai kadai", "மளிகை", "சூப்பர் மார்க்கெட்", "provision store"),
    ...k(2, "dal", "pulses", "பருப்பு", "rice bags"),
    ...k(1, "rice", "oil", "masala", "atta", "அரிசி", "எண்ணெய்"),
  ],
  bakery: [...k(3, "bakery", "cake", "mithai", "mittai", "puffs", "பேக்கரி", "கேக்", "இனிப்பு", "ஸ்வீட்", "sweet stall", "sweet shop"), ...k(2, "sweets", "sweet", "cookies"), ...k(1, "biscuit", "snacks")],
  fresh: [
    ...k(3, "vegetable", "meat", "chicken", "mutton", "kaikari", "kaaikari", "kaikari kadai", "meen", "kozhi", "காய்கறி", "மீன்", "கோழி", "சிக்கன்", "மட்டன்", "fish stall", "fish market", "butcher"),
    ...k(2, "fruit", "fish", "பழம்", "பழங்கள்", "கறி", "prawns", "seafood"),
    ...k(1, "egg", "முட்டை"),
  ],
  electronics: [
    ...k(3, "electronics", "electronic", "laptop", "appliances", "home appliances", "washing machine", "எலக்ட்ரானிக்ஸ்", "லேப்டாப்", "smart tv", "led tv"),
    ...k(2, "television", "computer", "fridge", "refrigerator", "mobile phones", "smartphone", "smartphones", "டிவி", "tv"),
    ...k(1, "mobiles", "mobile shop", "speakers"),
  ],
  repair: [
    ...k(3, "repair", "service centre", "service center", "ripair", "rippair", "பழுது", "ரிப்பேர்", "phone repair", "mobile repair", "laptop repair", "mobile service"),
    ...k(2, "servicing", "fixing", "சர்வீஸ்", "சரிசெய்"),
  ],
  salon: [...k(3, "salon", "saloon", "parlour", "parlor", "haircut", "hair cut", "bridal makeup", "beautician", "unisex salon", "சலூன்", "பார்லர்", "முடி வெட்டு"), ...k(4, "beauty parlour", "beauty parlor", "அழகு நிலையம்"), ...k(2, "facial", "threading", "waxing", "hair spa")],
  gym: [...k(3, "gym", "fitness centre", "fitness center", "fitness studio", "workout", "crossfit", "ஜிம்", "உடற்பயிற்சி"), ...k(2, "fitness", "zumba", "personal training"), ...k(1, "yoga")],
  jewellery: [
    ...k(3, "jewellery", "jewelry", "jewels", "ornaments", "nagai", "thangam", "நகை", "தங்கம்", "ஆபரணம்", "gold shop", "jewellers", "jewellery shop"),
    ...k(2, "gold", "silver", "hallmark", "kammal", "வெள்ளி", "கம்மல்", "diamond"),
    ...k(1, "chain", "bangle"),
  ],
  hardware: [
    ...k(3, "hardware", "plumbing", "cement", "ஹார்டுவேர்", "சிமெண்ட்", "building materials", "sanitaryware", "paint shop"),
    ...k(2, "tools", "paint", "sanitary", "electricals", "electrical", "pipes", "bolts", "பெயிண்ட்", "இரும்பு"),
    ...k(1, "steel", "iron", "pipe", "nuts"),
  ],
  optical: [
    ...k(3, "optical", "optician", "spectacles", "eyewear", "eye glasses", "eyeglasses", "contact lens", "eye test", "கண் பரிசோதனை"),
    ...k(4, "மூக்குக் கண்ணாடி", "மூக்கு கண்ணாடி", "கண்ணாடி கடை", "kannadi kadai"),
    ...k(2, "specs", "sunglasses", "kannadi"),
    ...k(1, "frames"),
  ],
  tailoring: [
    ...k(3, "tailor", "tailoring", "stitching", "alteration", "thaiyal", "thayal", "தையல்", "டெய்லர்", "ஆல்டரேஷன்"),
    ...k(4, "blouse stitching", "ladies tailoring", "gents tailoring"),
    ...k(2, "stitch"),
  ],
  organic: [
    ...k(3, "organic", "millet", "chekku", "cold pressed", "siruthaniyam", "nattu sakkarai", "சிறுதானியம்", "செக்கு", "ஆர்கானிக்", "நாட்டு சர்க்கரை", "natural foods"),
    ...k(2, "country sugar", "இயற்கை"),
    ...k(1, "natural", "herbal"),
  ],
  footwear: [...k(3, "footwear", "shoe", "chappal", "slippers", "sandals", "seruppu", "செருப்பு", "காலணி", "ஷூ"), ...k(2, "heels", "sneakers")],
  stationery: [...k(3, "stationery", "stationary", "notebook", "school supplies", "office supplies", "எழுதுபொருள்", "ஸ்டேஷனரி"), ...k(2, "books", "pens", "xerox", "புத்தகம்", "நோட்டு"), ...k(1, "pen")],
  toys: [...k(3, "toy", "soft toys", "bommai", "பொம்மை", "விளையாட்டுப் பொருள்"), ...k(1, "games")],
  cosmetics: [
    ...k(3, "cosmetics", "cosmetic", "beauty products", "skincare", "skin care", "fancy store", "fancy shop", "காஸ்மெட்டிக்ஸ்", "அழகு சாதன", "ஃபேன்சி"),
    ...k(2, "makeup", "make-up", "lipstick", "perfume", "fancy"),
  ],
  crackers: [...k(3, "crackers", "cracker", "pattasu", "patasu", "fireworks", "sparklers", "sivakasi", "பட்டாசு", "மத்தாப்பு"), ...k(2, "வெடி")],
  florist_pooja: [
    ...k(3, "flowers", "flower", "florist", "garland", "pooja", "puja", "poo kadai", "pookadai", "பூக்கள்", "பூக்கடை", "பூஜை", "pooja items", "pooja store"),
    ...k(2, "jasmine", "malli", "camphor", "agarbatti", "incense", "மல்லிகை", "கற்பூரம்", "ஊதுபத்தி", "மாலை"),
  ],
  mobile_accessories: [
    ...k(5, "mobile accessories", "phone accessories", "mobile covers", "phone case", "back cover", "மொபைல் கவர்", "மொபைல் உதிரி"),
    ...k(3, "tempered glass", "screen guard"),
    ...k(2, "charger", "earphones", "power bank", "சார்ஜர்"),
    ...k(1, "accessories", "headphones"),
  ],
  furniture: [...k(3, "furniture", "sofa", "mattress", "dining table", "wardrobe", "பர்னிச்சர்", "மரச்சாமான்", "கட்டில்", "சோபா", "மெத்தை"), ...k(2, "cot", "chairs", "cupboard"), ...k(1, "bed", "chair")],
  home_decor: [
    ...k(4, "home decor", "home décor"),
    ...k(3, "decor", "handicraft", "gift articles", "showpiece", "wall hanging", "கைவினை", "பரிசுப் பொருள்", "அலங்காரப் பொருள்"),
    ...k(2, "gift", "brass", "vases"),
    ...k(1, "lamps"),
  ],
  pet_shop: [...k(4, "pet food", "pet shop", "pet store"), ...k(3, "pet", "aquarium", "fish tank", "செல்லப்பிராணி"), ...k(2, "dog", "cat", "birds", "puppy", "நாய்", "பூனை")],
  sports: [
    ...k(4, "sports goods", "gym equipment", "fitness equipment", "sports shop"),
    ...k(3, "sports", "sport", "cricket", "badminton", "sportswear", "ஸ்போர்ட்ஸ்", "கிரிக்கெட்"),
    ...k(2, "football", "விளையாட்டு"),
    ...k(1, "bat"),
  ],
  tea_stall: [
    ...k(4, "tea stall", "tea shop", "tea kadai", "teakadai", "juice shop", "juice bar", "டீக்கடை", "டீ கடை", "ஜூஸ் கடை"),
    ...k(3, "chai", "filter coffee", "juice", "milkshake", "ஜூஸ்", "டீ"),
    ...k(2, "tea", "coffee", "bajji", "காபி"),
  ],
  spa: [...k(4, "spa", "ஸ்பா"), ...k(3, "massage", "wellness", "aromatherapy", "reflexology", "மசாஜ்"), ...k(2, "ayurvedic", "ayurveda", "therapy")],
  school: [
    ...k(4, "school", "matriculation", "cbse", "icse", "play school", "playschool", "preschool", "kindergarten", "பள்ளி", "மெட்ரிக்"),
    ...k(3, "admission", "admissions", "students", "classes", "மாணவர்", "மாணவர்கள்", "சேர்க்கை"),
    ...k(2, "montessori", "nursery", "campus", "பாலர் பள்ளி"),
  ],  // Batch 8/9. The general packs have no words: they are what an unmatched trade falls back to.
  general_shop: [],
  general_counter: [],
  general_services: [],
  textiles_wholesale: [
    ...k(4, "wholesale cloth", "cloth wholesale", "textile wholesale", "wholesale textile", "wholesale fabric", "fabric shop", "cloth merchant", "bale", "மொத்த துணி", "துணிக்கடை மொத்த"),
    ...k(3, "fabrics", "fabric", "by the metre", "by the meter", "per metre", "suiting", "shirting", "lining cloth", "handloom"),
  ],
  catering: [
    ...k(4, "catering", "caterer", "caterers", "tiffin service", "event food", "bulk food", "கேட்டரிங்", "சமையல் ஒப்பந்தம்"),
    ...k(3, "wedding food", "party food", "lunch box service", "canteen", "samayal"),
  ],
  pet_grooming: [...k(4, "pet grooming", "dog grooming", "pet spa", "pet boarding", "dog training", "வளர்ப்புப் பிராணி அழகுபடுத்தல்"), ...k(3, "grooming", "vet clinic", "veterinary")],
  photo_studio: [
    ...k(4, "photo studio", "photography", "videography", "wedding photography", "photographer", "ஸ்டுடியோ", "புகைப்படம்", "போட்டோ ஸ்டுடியோ"),
    ...k(3, "photo frames", "album", "albums", "passport photo", "drone shoot"),
  ],
  laundry: [
    ...k(4, "laundry", "dry cleaning", "dry clean", "dry cleaners", "dhobi", "laundromat", "சலவை", "வண்ணார்", "டிரை கிளீனிங்"),
    ...k(3, "ironing shop", "iron shop", "washing service", "steam ironing", "அயர்ன்"),
  ],
  event_decor: [
    ...k(4, "event decoration", "event decor", "event management", "event planner", "wedding decoration", "stage decoration", "decorators", "tent house", "mandap", "marriage hall", "function hall", "அலங்காரம்", "மேடை அலங்காரம்", "பந்தல்"),
    ...k(3, "decorator", "balloon decoration", "shamiyana", "party rentals", "sound and light"),
  ],
  ac_service: [
    ...k(4, "ac service", "ac repair", "ac mechanic", "air conditioner service", "fridge repair", "refrigerator repair", "washing machine repair", "appliance repair", "appliance service", "water purifier service", "ro service", "ஏசி சர்வீஸ்", "ஏசி பழுது"),
    ...k(3, "ac installation", "split ac", "gas refill", "amc"),
  ],
  print_shop: [
    ...k(4, "xerox", "photocopy", "photocopier", "printing press", "digital printing", "flex printing", "flex banner", "visiting cards", "offset printing", "cyber cafe", "internet cafe", "ஜெராக்ஸ்", "ஃபிளெக்ஸ்", "பிரிண்டிங்", "அச்சகம்"),
    ...k(3, "printing", "flex", "lamination", "binding", "banner", "dtp", "jerox", "zerox"),
  ],
  tuition: [
    ...k(4, "tuition", "tuitions", "tuition centre", "tuition center", "coaching centre", "coaching center", "coaching classes", "neet coaching", "jee coaching", "spoken english", "abacus", "டியூஷன்", "டியூசன்", "பயிற்சி மையம்"),
    ...k(3, "coaching", "home tuition", "computer classes", "computer training", "training institute", "வகுப்பு"),
  ],
  dance_music: [
    ...k(4, "dance classes", "dance school", "dance academy", "music classes", "music school", "music academy", "bharatanatyam", "carnatic", "vocal classes", "guitar classes", "keyboard classes", "நடன வகுப்பு", "இசை வகுப்பு", "பரதநாட்டியம்", "நடனம்"),
    ...k(3, "dance", "singing classes", "veena", "violin", "drums class", "இசை"),
  ],
  yoga: [...k(5, "yoga centre", "yoga center", "yoga classes", "yoga studio", "yoga school", "meditation centre", "யோகா மையம்", "யோகா வகுப்பு"), ...k(3, "yoga", "pranayama", "meditation", "யோகா", "தியானம்")],
  driving_school: [...k(5, "driving school", "driving classes", "driving institute", "car driving", "two wheeler driving", "ஓட்டுநர் பயிற்சி", "டிரைவிங் ஸ்கூல்"), ...k(3, "learner licence", "learners licence", "licence classes", "driving")],
  paints: [
    ...k(5, "paint shop", "paints shop", "paint store", "paints and hardware", "wall paint", "asian paints", "பெயிண்ட் கடை"),
    ...k(3, "paints", "emulsion", "distemper", "wall putty", "primer", "enamel", "varnish", "waterproofing", "பெயிண்ட்"),
  ],
  electricals: [
    ...k(5, "electrical shop", "electricals shop", "electrical store", "electrical goods", "electrical hardware", "lighting shop", "electricals and lighting", "எலக்ட்ரிக்கல்"),
    ...k(3, "electricals", "led lights", "fans and lights", "switches and sockets", "wires and cables", "mcb", "pump shop", "ஃபேன்"),
  ],
  tiles_sanitary: [
    ...k(5, "tiles and sanitary", "tiles shop", "tile shop", "tiles store", "sanitaryware shop", "bathroom fittings", "bath fittings", "granite and marble", "டைல்ஸ்"),
    ...k(3, "tiles", "tile", "sanitary ware", "vitrified", "floor tiles", "wall tiles", "granite", "marble", "closet", "washbasin"),
  ],
  two_wheeler_service: [
    ...k(5, "two wheeler service", "two wheeler workshop", "bike service", "bike service centre", "bike workshop", "bike garage", "scooter service", "motorcycle service", "இருசக்கர வாகன சர்வீஸ்", "பைக் சர்வீஸ்"),
    ...k(3, "bike repair", "scooter repair", "motorcycle repair", "two wheeler mechanic", "puncture", "பைக் பழுது"),
  ],
  car_service: [
    ...k(5, "car service", "car service centre", "car garage", "car workshop", "car repair", "car mechanic", "automobile workshop", "கார் சர்வீஸ்", "கார் கேரேஜ்"),
    ...k(3, "car wash", "car detailing", "denting and painting", "four wheeler service", "garage", "கார் வாஷ்"),
  ],
  agri_inputs: [
    ...k(5, "agri inputs", "agri shop", "agro centre", "agro shop", "fertiliser shop", "fertilizer shop", "seed shop", "pesticide shop", "farm supplies", "விவசாய இடுபொருள்", "உரக்கடை"),
    ...k(3, "fertiliser", "fertilizer", "pesticide", "seeds", "insecticide", "sprayer", "drip irrigation", "agriculture", "உரம்", "விதை"),
  ],
  auto_parts: [
    ...k(5, "auto parts", "auto spares", "spare parts shop", "automobile spares", "bike spares", "car spares", "two wheeler spares", "vehicle spares", "motor parts", "ஆட்டோ உதிரிபாகம்"),
    ...k(3, "spares", "brake pads", "filters", "clutch plate", "tyre shop", "battery shop", "lubricants", "engine oil"),
  ],
};

const ORDERED_WORDS: { trade: BusinessType; word: string; weight: number; rx: RegExp }[] = BUSINESS_TYPES.flatMap((trade) => TRADE_WORDS[trade].map(([word, weight]) => ({ trade, word: fold(word), weight, rx: rxFor(fold(word)) }))).sort(
  (a, b) => b.word.length - a.word.length,
);

/** Trade scores for a piece of text: longest phrases first, each match blanked so its inner words do not count again. */
export function tradeScores(text: string): Map<BusinessType, number> {
  let t = ` ${fold(text)} `;
  const scores = new Map<BusinessType, number>();
  for (const w of ORDERED_WORDS) {
    w.rx.lastIndex = 0;
    if (!w.rx.test(t)) continue;
    scores.set(w.trade, (scores.get(w.trade) ?? 0) + w.weight);
    w.rx.lastIndex = 0;
    t = t.replace(w.rx, (m) => " ".repeat(m.length));
  }
  return scores;
}

export interface TradeGuess {
  id: BusinessType | null;
  confidence: Confidence;
  score: number;
  /** The runner-up, when close. */
  alternative: BusinessType | null;
}

/** The trade from the answers: "what you sell" counts twice, the product groups once, the rest half. */
export function guessTrade(a: Answers): TradeGuess {
  const total = new Map<BusinessType, number>();
  const add = (text: string, f: number) => {
    for (const [t, s] of tradeScores(text)) total.set(t, (total.get(t) ?? 0) + s * f);
  };
  add(a.sell, 2);
  add(a.groups, 1);
  add(`${a.buyers} ${a.extras}`, 0.5);
  // A trade id or alias typed as is ("pharmacy", "kirana") counts like a strong word.
  const alias = packFor(a.sell.trim());
  if (alias) total.set(alias.id, (total.get(alias.id) ?? 0) + 6);
  const ranked = [...total].sort((x, y) => y[1] - x[1]);
  const [best, second] = ranked;
  if (!best || best[1] < 2) return { id: null, confidence: "low", score: best?.[1] ?? 0, alternative: null };
  const margin = best[1] - (second?.[1] ?? 0);
  const confidence: Confidence = best[1] >= 6 && margin >= 3 ? "high" : best[1] >= 3 && margin >= 1.5 ? "medium" : "low";
  return { id: best[0], confidence, score: best[1], alternative: second && margin < 3 ? second[0] : null };
}

// ------------------------------------------------------------------ product groups

const FILLER = /^(?:we (?:mainly |mostly )?(?:sell|have|stock|keep)|mainly|mostly|items? like|things like|like|such as|also|and|naanga|nanga|engalidam|எங்களிடம்|நாங்கள்|முக்கியமாக|etc\.?|all types of|all kinds of|varieties of)\s+/i;
const TAIL = /\s+(?:etc\.?|and more|and so on|மற்றும் பல|போன்றவை|items)$/i;

/** Splits the owner's list ("sarees, kurtis and dress materials" / "புடவை, சுடிதார் மற்றும் குழந்தை ஆடை") into clean group names. */
export function splitGroups(text: string): string[] {
  const n = neutralise(text.slice(0, MAX_ANSWER));
  if (!n.text) return [];
  const parts = n.text
    .split(/[,;/|\n•·]+|\s+&\s+|\s+and\s+|\s+மற்றும்\s+|\s+அப்புறம்\s+|\s+innum\s+|\s+matrum\s+|\.\s+/i)
    .map((p) => p.replace(FILLER, "").replace(FILLER, "").replace(TAIL, "").replace(/^[\s\-–:.()]+|[\s\-–:.()]+$/g, "").replace(/\s+/g, " "));
  const out: string[] = [];
  for (const p of parts) {
    if (p.length < 2 || p.length > 40) continue;
    if (/\d{3,}|₹|\brs\.?\s*\d|@|https?:|www\./i.test(p)) continue;
    if (/^(?:etc|items?|products?|things|others?|all|and|more)$/i.test(p)) continue;
    const name = hasTamil(p) ? p : p.charAt(0).toUpperCase() + p.slice(1);
    if (!out.some((x) => fold(x) === fold(name))) out.push(name);
    if (out.length >= 12) break;
  }
  return out;
}

// ------------------------------------------------------------------ look and colour

export const COLOURS = {
  red: "#b91c1c",
  maroon: "#7f1d1d",
  pink: "#be185d",
  orange: "#c2410c",
  yellow: "#a16207",
  gold: "#a67c1a",
  green: "#15803d",
  teal: "#0f766e",
  blue: "#1d4ed8",
  navy: "#1e3a8a",
  purple: "#6d28d9",
  brown: "#7c2d12",
  black: "#111111",
  grey: "#4b5563",
} as const;
export type ColourName = keyof typeof COLOURS;
export const COLOUR_NAMES = Object.keys(COLOURS) as ColourName[];

const COLOUR_WORDS: Record<ColourName, string[]> = {
  red: ["red", "sivappu", "சிவப்பு", "சிகப்பு"],
  maroon: ["maroon", "arakku", "அரக்கு", "மெரூன்", "kumkum"],
  pink: ["pink", "rose", "இளஞ்சிவப்பு", "பிங்க்", "ரோஸ்"],
  orange: ["orange", "saffron", "ஆரஞ்சு", "காவி"],
  yellow: ["yellow", "manjal", "மஞ்சள்"],
  gold: ["gold", "golden", "thanga", "தங்க நிற", "தங்க கலர்", "தங்கக்"],
  green: ["green", "pachai", "பச்சை"],
  teal: ["teal", "peacock", "மயில்"],
  blue: ["blue", "neelam", "neela", "நீலம்", "நீல"],
  navy: ["navy", "dark blue", "கருநீலம்"],
  purple: ["purple", "violet", "ஊதா"],
  brown: ["brown", "coffee colour", "பழுப்பு", "பிரவுன்"],
  black: ["black", "karuppu", "கருப்பு"],
  grey: ["grey", "gray", "சாம்பல்"],
};

/** The first colour the owner named (its position in the text), or null. */
export function colourFrom(text: string): ColourName | null {
  const t = ` ${fold(text)} `;
  let best: { c: ColourName; at: number; len: number } | null = null;
  for (const c of COLOUR_NAMES) {
    for (const w of COLOUR_WORDS[c]) {
      const m = rxFor(fold(w)).exec(t);
      if (m && (!best || m.index < best.at || (m.index === best.at && w.length > best.len))) best = { c, at: m.index, len: w.length };
    }
  }
  return best?.c ?? null;
}

type Mood = "traditional" | "premium" | "modern" | "bright" | "natural" | "dark";
const MOOD_WORDS: Record<Mood, string[]> = {
  traditional: ["traditional", "heritage", "temple", "kolam", "classic", "ethnic", "paramparai", "பாரம்பரிய", "பாரம்பரியம்", "கோவில்", "கோலம்"],
  premium: ["premium", "luxury", "luxurious", "elegant", "rich", "classy", "royal", "grand", "பிரீமியம்", "ஆடம்பர", "ராயல்", "கம்பீர"],
  modern: ["modern", "minimal", "simple", "clean", "stylish", "trendy", "neat", "நவீன", "எளிமை", "எளிமையான", "ஸ்டைல்"],
  bright: ["bright", "colourful", "colorful", "fun", "cheerful", "playful", "festive", "vibrant", "வண்ண", "கலர்ஃபுல்", "பளிச்"],
  natural: ["natural", "earthy", "eco", "green look", "இயற்கை"],
  dark: ["dark", "night", "இருண்ட", "டார்க்"],
};
export function moodsFrom(text: string): Mood[] {
  const t = ` ${fold(text)} `;
  return (Object.keys(MOOD_WORDS) as Mood[]).filter((m) => MOOD_WORDS[m].some((w) => rxFor(fold(w)).test(t)));
}

/** A ready-made look for the trade and the mood words (the trade's own preset when nothing was said). */
export function presetFor(trade: BusinessType, text: string): string {
  const pack = PACKS[trade];
  // A school's site keeps its own look whatever the mood words (a fun or dark school site is the owner's call later).
  if (trade === "school") return pack.preset;
  const m = new Set(moodsFrom(text));
  const pick = (byTrade: Partial<Record<BusinessType, string>>, other: string) => byTrade[trade] ?? other;
  if (m.has("traditional")) return pick({ fashion: "kanchi-silk", jewellery: "temple-gold", bakery: "mithai", restaurant: "madras-cafe", tea_stall: "signboard", florist_pooja: "kumkum-manjal", home_decor: "polished-brass", tailoring: "madder-thread" }, "heritage");
  if (m.has("premium")) return pick({ jewellery: "temple-gold", fashion: "zari", electronics: "carbon-spec", salon: "lotus-mist", spa: "luxe", furniture: "walnut-linen" }, m.has("dark") ? "luxe" : "zari");
  if (m.has("natural")) return pick({ organic: "earthen", fresh: "farm-market", grocery: "crisp-greens", pet_shop: "lagoon-paws" }, "earthen");
  if (m.has("bright")) return pick({ toys: "toybox", crackers: "starburst", grocery: "kirana-fresh", cosmetics: "berry-bold", sports: "stride" }, "kirana-fresh");
  if (m.has("modern")) return pick({ electronics: "tech", mobile_accessories: "big-box", fashion: "boutique", footwear: "stride", gym: "power", pharmacy: "saline-blue", optical: "optic-clear", repair: "repair-bench" }, m.has("dark") ? "tech" : "boutique");
  if (m.has("dark")) return pick({ restaurant: "night-kitchen", cloud_kitchen: "street-bold", gym: "gym-iron", electronics: "gadget-neon" }, "luxe");
  return pack.preset;
}

// ------------------------------------------------------------------ delivery, pickup, languages

export type YesNo = boolean | null;
export interface Extras {
  delivery: YesNo;
  pickup: YesNo;
  languages: "en" | "ta" | "both" | null;
}

const has = (t: string, words: string[]) => words.some((w) => rxFor(fold(w)).test(t));
const NO_DELIVERY = ["no delivery", "no home delivery", "don't deliver", "dont deliver", "do not deliver", "only pickup", "pickup only", "only pick up", "delivery illa", "delivery illai", "delivery kidaiyathu", "டெலிவரி இல்லை", "டெலிவரி கிடையாது", "டெலிவரி செய்வதில்லை", "நேரில் மட்டும்", "shop only", "only at the shop", "only in shop"];
const DELIVERY = ["deliver", "delivery", "home delivery", "door delivery", "doorstep", "courier", "shipping", "ship", "veetuku", "veetukku", "anuppu", "டெலிவரி", "வீட்டுக்கு", "வீட்டுக்கே", "அனுப்பு", "கூரியர்"];
const NO_PICKUP = ["no pickup", "no pick up", "no takeaway", "delivery only", "only delivery", "online only", "pickup illa", "நேரில் வர வேண்டாம்"];
const PICKUP = ["pickup", "pick up", "pick-up", "collect", "takeaway", "take away", "parcel", "come to the shop", "come to shop", "visit the shop", "at the shop", "at our shop", "kadaiku vanthu", "kadaikku vanthu", "vanthu vaangi", "eduthu", "நேரில்", "கடைக்கு வந்து", "கடையில் வாங்கி", "எடுத்துச் செல்", "பார்சல்", "வந்து வாங்க"];

export function extrasFrom(text: string): Extras {
  const t = ` ${fold(text)} `;
  const noDel = has(t, NO_DELIVERY);
  const noPick = has(t, NO_PICKUP);
  const delivery: YesNo = noDel ? false : has(t, DELIVERY) ? true : null;
  // "No delivery, shop only" means pickup at the shop; a bare "no delivery" says nothing about pickup.
  const shopOnly = /(?:shop only|only at the shop|only in shop|நேரில் மட்டும்)/.test(t);
  const pickup: YesNo = noPick ? false : has(t, PICKUP) || (noDel && shopOnly) ? true : null;
  const ta = has(t, ["tamil", "thamizh", "tamizh", "தமிழ்"]);
  const en = has(t, ["english", "ஆங்கிலம்", "ஆங்கில", "இங்கிலீஷ்"]);
  const onlyTa = /(?:only tamil|tamil only|tamil mattum|தமிழ் மட்டும்|தமிழில் மட்டும்)/.test(t);
  const onlyEn = /(?:only english|english only|english mattum|ஆங்கிலம் மட்டும்)/.test(t);
  const languages = onlyTa ? "ta" : onlyEn ? "en" : ta && en ? "both" : ta ? "both" : en ? "en" : has(t, ["both", "rendum", "இரண்டும்", "இரண்டிலும்"]) ? "both" : null;
  return { delivery, pickup, languages };
}

/** True when the answers say anything at all about delivery (the model may only switch delivery when this is true). */
export const mentionsDelivery = (text: string) => has(` ${fold(text)} `, [...DELIVERY, ...NO_DELIVERY]);
export const mentionsPickup = (text: string) => has(` ${fold(text)} `, [...PICKUP, ...NO_PICKUP, ...NO_DELIVERY]);
