import type { DemoProduct } from "./types";

/**
 * Sukham Ayur Spa: the catalogue (therapies sold by duration, memberships, gift vouchers). Prices are GST-inclusive
 * rupees at 5% (beauty and physical well-being services, from 22 Sept 2025; see spa.ts for the notes). Every
 * therapy is also a bookable appointment service (spa-setup.ts): `rows` are its durations and prices.
 */
const rs = (rupees: number) => Math.round(rupees * 100);

export const MASSAGES = "Massages";
export const AYUR = "Ayurvedic therapies";
export const SCRUBS = "Body scrubs & wraps";
export const FACIALS = "Facials";
export const FOOT = "Foot reflexology";
export const COUPLE = "Couple packages";
export const STEAM = "Steam & sauna";
export const MEMBER = "Memberships";
export const VOUCHER = "Gift vouchers";

export const WELLNESS_HSN = "999723"; // physical well-being services (massage, steam, sauna, health club)
export const BEAUTY_HSN = "999722"; // beauty treatment services (facials, scrubs)
export const GST = 5;

/** A therapy: a product with one duration (no options) or several (option "Duration"). */
export interface Therapy {
  name: string;
  category: string;
  hsn: string;
  sku: string;
  photo: number;
  need: ("relax" | "recover" | "glow")[];
  /** [minutes, price ₹ incl. GST, MRP ₹ if different]. */
  rows: [number, number, number?][];
  /** Minutes of cleaning and turnover after the session. */
  buffer: number;
  description: string;
  attributes: Record<string, string>;
  extraTags?: string[];
}

const T = (t: Therapy): Therapy => t;

export const THERAPIES: Therapy[] = [
  // ---- massages
  T({ name: "Swedish relaxation massage", category: MASSAGES, hsn: WELLNESS_HSN, sku: "SK-SWE", photo: 6187418, need: ["relax"], rows: [[60, 1800], [90, 2500]], buffer: 15, description: "Long, flowing strokes with warm coconut-and-almond oil to loosen the shoulders, back, arms and legs. Light to medium pressure; the one to book when you simply want to switch off.", attributes: { Pressure: "Light to medium", Oils: "Warm coconut and almond", "Suitable for": "First-timers, stress, poor sleep" }, extraTags: ["bestseller"] }),
  T({ name: "Deep tissue massage", category: MASSAGES, hsn: WELLNESS_HSN, sku: "SK-DEP", photo: 19641818, need: ["recover"], rows: [[60, 2200], [90, 3000]], buffer: 15, description: "Slow, firm pressure into the tight bands of the neck, back and hips, with forearm work on knots. For desk workers, drivers and weekend sportspeople. Tell your therapist where it hurts; we go as deep as you like.", attributes: { Pressure: "Firm", Oils: "Warm sesame blend", "Suitable for": "Desk-job stiffness, sports recovery" }, extraTags: ["bestseller"] }),
  T({ name: "Thai massage", category: MASSAGES, hsn: WELLNESS_HSN, sku: "SK-THA", photo: 6628649, need: ["recover", "relax"], rows: [[60, 2400], [90, 3200]], buffer: 15, description: "A dry massage on a floor mat in loose cotton clothes: acupressure along the energy lines with gentle stretches and rocking. No oil, so it suits those who dislike it.", attributes: { Pressure: "Medium to firm", Oils: "None (dry)", "Suitable for": "Stiff joints, low energy" } }),
  T({ name: "Aromatherapy massage", category: MASSAGES, hsn: WELLNESS_HSN, sku: "SK-ARO", photo: 19641816, need: ["relax"], rows: [[60, 2100], [90, 2900]], buffer: 15, description: "A medium-pressure full-body massage with a blend you choose at the start: lavender for sleep, lemongrass and mint to lift, sandalwood to calm.", attributes: { Pressure: "Light to medium", Oils: "Lavender, lemongrass or sandalwood blend", "Suitable for": "Anxiety, headaches, poor sleep" } }),
  T({ name: "Hot stone massage", category: MASSAGES, hsn: WELLNESS_HSN, sku: "SK-HOT", photo: 6628701, need: ["relax", "recover"], rows: [[75, 2900]], buffer: 15, description: "Smooth basalt stones, warmed to body heat, are glided and rested along the spine and legs while the therapist massages around them. Deeply warming.", attributes: { Pressure: "Medium", Oils: "Warm sesame blend", "Suitable for": "Cold hands and feet, back tension" } }),
  T({ name: "Head, neck and shoulder massage", category: MASSAGES, hsn: WELLNESS_HSN, sku: "SK-HNS", photo: 19666192, need: ["recover", "relax"], rows: [[30, 900]], buffer: 10, description: "A seated or table massage of the scalp, neck, shoulders and upper back. The quickest way to lose a screen headache in a lunch break.", attributes: { Pressure: "Medium", "Suitable for": "Headaches, screen fatigue" }, extraTags: ["bestseller"] }),
  T({ name: "Back and shoulder relief", category: MASSAGES, hsn: WELLNESS_HSN, sku: "SK-BSR", photo: 9146372, need: ["recover"], rows: [[45, 1300]], buffer: 10, description: "Focused work on the whole back with a hot herbal compress to finish. A good 45 minutes for a stiff back.", attributes: { Pressure: "Medium to firm", "Suitable for": "Back ache, long drives" } }),
  // ---- Ayurvedic therapies
  T({ name: "Abhyanga (herbal oil massage)", category: AYUR, hsn: WELLNESS_HSN, sku: "SK-ABH", photo: 6187421, need: ["relax", "recover"], rows: [[60, 2200], [90, 2900]], buffer: 20, description: "The classical full-body Ayurvedic oil massage by two-handed, rhythmic strokes with warm medicated oil chosen for your body type. Traditional, unhurried and grounding.", attributes: { Oils: "Medicated oil (Bala or Dhanwantharam)", "Suitable for": "Stress, dry skin, sleep, joint stiffness", Note: "Plan a bath two hours after" }, extraTags: ["ayurveda", "bestseller"] }),
  T({ name: "Shirodhara", category: AYUR, hsn: WELLNESS_HSN, sku: "SK-SHI", photo: 20689447, need: ["relax"], rows: [[45, 2400]], buffer: 25, description: "A thin stream of warm herbal oil flows over the forehead in a slow, steady rhythm while you rest, after a short head and neck massage. Deeply calming for the mind.", attributes: { Oils: "Warm herbal oil or buttermilk", "Suitable for": "Insomnia, anxiety, migraine", Note: "Oil stays in the hair for the day" }, extraTags: ["ayurveda"] }),
  T({ name: "Shiro abhyanga (head and shoulder oil)", category: AYUR, hsn: WELLNESS_HSN, sku: "SK-SAB", photo: 39344587, need: ["relax"], rows: [[30, 1100]], buffer: 15, description: "A warm oil massage of the scalp, forehead, neck and shoulders, ending with a gentle pressure on the crown. Cooling in summer.", attributes: { Oils: "Brahmi or coconut-bhringraj", "Suitable for": "Headaches, hair fall, sleeplessness" }, extraTags: ["ayurveda"] }),
  T({ name: "Kizhi / potli herbal bolus massage", category: AYUR, hsn: WELLNESS_HSN, sku: "SK-KIZ", photo: 11627566, need: ["recover"], rows: [[60, 2800], [90, 3600]], buffer: 20, description: "Warm cloth boluses (potli) packed with herbs, rock salt and medicinal leaves are dipped in oil and pressed over the body. Eases joint pain, muscle spasm and cold-weather stiffness.", attributes: { Oils: "Medicated oil, herb potli (nirgundi, castor leaf, tamarind)", "Suitable for": "Joint and muscle pain, stiffness" }, extraTags: ["ayurveda", "bestseller"] }),
  T({ name: "Udvartana (herbal powder massage)", category: AYUR, hsn: WELLNESS_HSN, sku: "SK-UDV", photo: 20689436, need: ["recover", "glow"], rows: [[60, 2500]], buffer: 25, description: "A brisk, upward massage with warm herbal powders (horse gram, green gram, triphala) that scrubs, tones and warms. Traditionally for weight management and sluggish circulation.", attributes: { Products: "Herbal powder blend with warm oil", "Suitable for": "Heaviness, cellulite, dull skin" }, extraTags: ["ayurveda"] }),
  T({ name: "Kati basti (lower back oil pool)", category: AYUR, hsn: WELLNESS_HSN, sku: "SK-KAT", photo: 6560267, need: ["recover"], rows: [[45, 1900]], buffer: 20, description: "A ring of dough is placed on the lower back and filled with warm medicated oil, held there for 30 minutes. Soothing for chronic lower back ache.", attributes: { Oils: "Warm Dhanwantharam oil", "Suitable for": "Lower back ache, sciatica, disc strain" }, extraTags: ["ayurveda"] }),
  T({ name: "Pizhichil (warm oil bath)", category: AYUR, hsn: WELLNESS_HSN, sku: "SK-PIZ", photo: 28321583, need: ["recover", "relax"], rows: [[75, 3800]], buffer: 30, description: "Streams of warm medicated oil are poured over the whole body by two therapists in synchronised strokes. The most indulgent of the Kerala-style therapies.", attributes: { Oils: "Warm medicated oil", "Suitable for": "Arthritis, nerve weakness, fatigue" }, extraTags: ["ayurveda"] }),
  // ---- scrubs and wraps
  T({ name: "Coffee body scrub", category: SCRUBS, hsn: BEAUTY_HSN, sku: "SK-COF", photo: 5308675, need: ["glow"], rows: [[45, 1800]], buffer: 20, description: "Freshly ground filter coffee and coconut oil buff away dead skin, followed by a body moisturiser. Leaves skin smooth and glowing.", attributes: { Products: "Coffee, coconut oil, brown sugar", "Suitable for": "Rough, tanned skin" } }),
  T({ name: "Sandalwood and turmeric body polish", category: SCRUBS, hsn: BEAUTY_HSN, sku: "SK-SAN", photo: 27860845, need: ["glow"], rows: [[60, 2200]], buffer: 20, description: "A paste of sandalwood, turmeric and gram flour, applied the way brides have used it for generations, then a milk-and-rose rinse.", attributes: { Products: "Sandalwood, turmeric, gram flour", "Suitable for": "Dull skin, pre-wedding" }, extraTags: ["bestseller"] }),
  T({ name: "Rice and coconut body scrub", category: SCRUBS, hsn: BEAUTY_HSN, sku: "SK-RIC", photo: 11635432, need: ["glow"], rows: [[45, 1700]], buffer: 20, description: "Ground rice and fresh coconut with a hint of vetiver. A gentle scrub for sensitive skin.", attributes: { Products: "Rice, coconut, vetiver", "Suitable for": "Sensitive skin" } }),
  T({ name: "Detox mud wrap", category: SCRUBS, hsn: BEAUTY_HSN, sku: "SK-MUD", photo: 27860842, need: ["glow", "relax"], rows: [[60, 2300]], buffer: 25, description: "Mineral clay is brushed on and you are wrapped warm for 25 minutes before a scalp massage and a shower.", attributes: { Products: "Mineral clay, neem", "Suitable for": "Congested skin, water retention" } }),
  T({ name: "Aloe cooling wrap", category: SCRUBS, hsn: BEAUTY_HSN, sku: "SK-ALO", photo: 7148526, need: ["glow", "relax"], rows: [[45, 1900]], buffer: 20, description: "Fresh aloe and cucumber, chilled, smoothed over sun-tired shoulders, arms and legs. The one for a hot Coimbatore summer.", attributes: { Products: "Aloe, cucumber, mint", "Suitable for": "Sunburn, heat, tired skin" } }),
  // ---- facials
  T({ name: "Classic cleansing facial", category: FACIALS, hsn: BEAUTY_HSN, sku: "SK-CLA", photo: 37229309, need: ["glow"], rows: [[45, 1100]], buffer: 10, description: "Cleansing, steam, gentle exfoliation, a facial massage and a mask matched to your skin.", attributes: { Skin: "All types", "Suitable for": "Monthly care" } }),
  T({ name: "Fruit radiance facial", category: FACIALS, hsn: BEAUTY_HSN, sku: "SK-FRU", photo: 37229301, need: ["glow"], rows: [[60, 1400]], buffer: 10, description: "Papaya and orange pulp with a vitamin-C mask for dull, tired skin before an event.", attributes: { Skin: "Normal, dull", "Suitable for": "Event prep" }, extraTags: ["bestseller"] }),
  T({ name: "Kumkumadi glow facial", category: FACIALS, hsn: BEAUTY_HSN, sku: "SK-KUM", photo: 6978043, need: ["glow"], rows: [[60, 2200]], buffer: 10, description: "Kumkumadi oil, saffron and sandalwood with a lymphatic facial massage. Evens tone and brings back radiance.", attributes: { Skin: "Dull, uneven tone", "Suitable for": "Pigmentation, dull skin" }, extraTags: ["ayurveda"] }),
  T({ name: "Hydra moisture facial", category: FACIALS, hsn: BEAUTY_HSN, sku: "SK-HYD", photo: 12115040, need: ["glow", "relax"], rows: [[60, 1900]], buffer: 10, description: "Hyaluronic serum, a cooling gel mask and a cucumber compress for dry, dehydrated skin.", attributes: { Skin: "Dry, dehydrated", "Suitable for": "Air-conditioned offices" } }),
  T({ name: "Men's deep-cleanse facial", category: FACIALS, hsn: BEAUTY_HSN, sku: "SK-MEN", photo: 7446659, need: ["glow"], rows: [[45, 1200]], buffer: 10, description: "Charcoal cleanse, steam, shoulder massage and an oil-balancing mask.", attributes: { Skin: "Oily, combination", "Suitable for": "Shaving bumps, oily skin" } }),
  // ---- foot reflexology
  T({ name: "Foot reflexology", category: FOOT, hsn: WELLNESS_HSN, sku: "SK-FRE", photo: 5793888, need: ["recover", "relax"], rows: [[30, 800], [45, 1100], [60, 1400]], buffer: 10, description: "Pressure on the reflex points of the soles with a warm foot soak first. 30 minutes works the soles; 60 adds the calves and knees.", attributes: { Pressure: "Medium to firm", "Suitable for": "Standing all day, travellers" }, extraTags: ["bestseller"] }),
  T({ name: "Herbal foot soak and scrub", category: FOOT, hsn: WELLNESS_HSN, sku: "SK-HFS", photo: 15949782, need: ["relax", "glow"], rows: [[45, 1000]], buffer: 15, description: "A warm soak with rock salt, neem and rose petals, a scrub for cracked heels and a short massage.", attributes: { Products: "Rock salt, neem, rose petals", "Suitable for": "Cracked heels, tired feet" } }),
  // ---- couple packages
  T({ name: "Couple relaxation (Swedish, 60 min)", category: COUPLE, hsn: WELLNESS_HSN, sku: "SK-CR1", photo: 18120174, need: ["relax"], rows: [[60, 3400]], buffer: 20, description: "Two therapists, one private room. A Swedish massage side by side, with a cup of herbal tea after. Price is for two.", attributes: { Guests: "2", Room: "Couple suite" }, extraTags: ["couple"] }),
  T({ name: "Couple abhyanga and steam (90 min)", category: COUPLE, hsn: WELLNESS_HSN, sku: "SK-CR2", photo: 6634900, need: ["relax", "recover"], rows: [[90, 5200]], buffer: 30, description: "Abhyanga for two followed by a herbal steam each. Price is for two.", attributes: { Guests: "2", Room: "Couple suite" }, extraTags: ["couple", "ayurveda"] }),
  T({ name: "Anniversary ritual (120 min, for two)", category: COUPLE, hsn: WELLNESS_HSN, sku: "SK-CR3", photo: 6634892, need: ["relax"], rows: [[120, 7800]], buffer: 30, description: "A foot ritual, a 60-minute aromatherapy massage, a rose-petal soak and a sweet treat, in a candle-lit suite. Price is for two.", attributes: { Guests: "2", Room: "Couple suite" }, extraTags: ["couple"] }),
  // ---- steam and sauna
  T({ name: "Herbal steam bath", category: STEAM, hsn: WELLNESS_HSN, sku: "SK-STE", photo: 7598363, need: ["relax", "recover"], rows: [[20, 600]], buffer: 15, description: "A private steam cabin infused with nirgundi and eucalyptus. Opens the pores and eases the chest.", attributes: { Temperature: "42 to 45 degrees C", "Suitable for": "Colds, aches, after abhyanga" } }),
  T({ name: "Sauna session", category: STEAM, hsn: WELLNESS_HSN, sku: "SK-SAU", photo: 34097625, need: ["relax", "recover"], rows: [[30, 700]], buffer: 15, description: "A dry cedar sauna, for one or two. Towels, a cold towel and water included.", attributes: { Temperature: "70 to 80 degrees C", "Suitable for": "Muscle recovery" } }),
  T({ name: "Steam and sauna combo", category: STEAM, hsn: WELLNESS_HSN, sku: "SK-COM", photo: 32504769, need: ["relax", "recover"], rows: [[45, 1000]], buffer: 15, description: "Ten minutes of steam, then twenty of sauna, with a shower break between.", attributes: { Temperature: "Steam 42, sauna 75 degrees C", "Suitable for": "A full reset" } }),
];

/** Label for a duration option: "60 min". */
export const minLabel = (m: number) => `${m} min`;

const timeTags = (rows: Therapy["rows"]) => {
  const out = new Set<string>();
  for (const [m] of rows) out.add(m <= 45 ? "time-short" : m <= 75 ? "time-hour" : "time-long");
  return [...out];
};
const budgetTags = (rows: Therapy["rows"]) => {
  const out = new Set<string>();
  for (const [, p] of rows) out.add(p < 1500 ? "budget-low" : p <= 3000 ? "budget-mid" : "budget-high");
  return [...out];
};

function therapyProduct(t: Therapy): DemoProduct {
  const base = {
    name: t.name,
    category: t.category,
    hsn: t.hsn,
    gstRate: GST,
    unit: "session",
    description: t.description,
    attributes: { ...t.attributes, Duration: t.rows.map(([m]) => minLabel(m)).join(" / ") },
    sku: t.sku,
    photo: t.photo,
    tags: [...t.need.map((n) => `need-${n}`), ...timeTags(t.rows), ...budgetTags(t.rows), ...(t.extraTags ?? [])],
    costShare: 0.35,
  };
  if (t.rows.length === 1) {
    const [, price, mrp] = t.rows[0]!;
    return { ...base, variants: [{ price: rs(price), mrp: rs(mrp ?? price), stock: 999 }] };
  }
  const labels = t.rows.map(([m]) => minLabel(m));
  return {
    ...base,
    options: [{ name: "Duration", values: labels }],
    variants: t.rows.map(([m, price, mrp]) => ({ values: { Duration: minLabel(m) }, price: rs(price), mrp: rs(mrp ?? price), stock: 999 })),
  };
}

const GIFT_NOTE = "\n\nA gift voucher is delivered by WhatsApp or email as a code the same day. Valid for 12 months on any therapy, steam or package; no cash refund; transferable.";
const MEMBER_NOTE = "\n\nSessions can be used for any single-person therapy up to the length shown, steam and sauna included. Book online or at the desk; the membership is checked in at reception. GST at 5% is on the bill.";

const plan = (name: string, sku: string, price: number, mrp: number, tags: string[], description: string, attributes: Record<string, string>): DemoProduct => ({
  name,
  category: MEMBER,
  hsn: WELLNESS_HSN,
  gstRate: GST,
  unit: "plan",
  sku,
  photo: 7795824,
  tags: ["membership", ...tags],
  description: description + MEMBER_NOTE,
  attributes,
  costShare: 0.35,
  variants: [{ price: rs(price), mrp: rs(mrp), stock: 999 }],
});

const gift = (value: number) => ({ values: { Value: `₹${value.toLocaleString("en-IN")}` }, price: rs(value), mrp: rs(value), stock: 999 });

const extras: DemoProduct[] = [
  plan("Monthly relax membership", "SK-MM", 6500, 7400, ["need-relax", "need-recover"], "4 sessions in 30 days, one a week. Any single-person therapy up to 60 minutes.", { Sessions: "4", Valid: "30 days", Freeze: "None" }),
  plan("Quarterly renew membership", "SK-QM", 18000, 22200, ["need-relax", "need-recover", "bestseller"], "12 sessions in 90 days. Any therapy up to 90 minutes, a free herbal steam with each, and 7 freeze days.", { Sessions: "12", Valid: "90 days", Freeze: "7 days" }),
  plan("Annual wellness membership", "SK-AM", 54000, 72000, ["need-relax", "need-recover", "need-glow"], "48 sessions in 365 days, any therapy, unlimited steam and sauna, two guest passes and 30 freeze days.", { Sessions: "48", Valid: "365 days", Freeze: "30 days" }),
  {
    name: "Gift voucher",
    category: VOUCHER,
    hsn: WELLNESS_HSN,
    gstRate: GST,
    unit: "voucher",
    sku: "SK-GV",
    photo: 7795393,
    tags: ["voucher", "gift"],
    description: `Give a calm hour. Pick an amount; the person you gift chooses the therapy.${GIFT_NOTE}`,
    attributes: { Valid: "12 months", Delivery: "WhatsApp or email" },
    costShare: 0.1,
    options: [{ name: "Value", values: ["₹1,000", "₹2,500", "₹5,000"] }],
    variants: [gift(1000), gift(2500), gift(5000)],
  },
];

export const PRODUCTS: DemoProduct[] = [...THERAPIES.map(therapyProduct), ...extras];

/** Membership plans (memberships engine), matching the three membership products. */
export const PLANS = [
  { product: "Monthly relax membership", name: "Monthly relax", description: "4 sessions in 30 days", durationDays: 30, sessions: 4, price: 6500, freezeDaysAllowed: 0 },
  { product: "Quarterly renew membership", name: "Quarterly renew", description: "12 sessions in 90 days", durationDays: 90, sessions: 12, price: 18000, freezeDaysAllowed: 7 },
  { product: "Annual wellness membership", name: "Annual wellness", description: "48 sessions in 365 days", durationDays: 365, sessions: 48, price: 54000, freezeDaysAllowed: 30 },
] as const;
