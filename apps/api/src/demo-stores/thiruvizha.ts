import type { DemoProduct, DemoStore } from "./types";

/**
 * Store #11 of the series: Thiruvizha Crackers, Sivakasi (thiruvizha.localhost:3003). A licensed Sivakasi
 * (Virudhunagar district) crackers dealer on Sattur Road selling across Tamil Nadu for Deepavali, weddings and temple
 * festivals, on the online store app (EC) with the `crackers` trade and the "starburst" look (firework pink on a
 * midnight-indigo night sky). Thiruvizha (திருவிழா) is Tamil for festival. Sparklers by length, flower pots and
 * chakkars by size, rockets and multi-shot sky cakes by shot count, sound crackers, kids' crackers, fancy fountains
 * and gift boxes priced by size with their contents. Names are generic (no makers' brands); prices follow the
 * Sivakasi custom of a printed MRP with a large "offer price" (65–80% off MRP on loose items, a little less on gift
 * boxes), GST included. Address, phone, GSTIN and the explosives licence number are placeholders like the other demo
 * shops.
 *
 * Compliance, as the copy states it (store policies, the safety guide, how-to-order page and FAQ):
 * - Supreme Court, Arjun Gopal v. Union of India (23 Oct 2018, and later orders): only green crackers (reduced-emission
 *   formulations, CSIR-NEERI logo and QR code) may be made and sold, through licensed traders; no barium salts; no
 *   joined / series crackers ("laris", wala garlands), which is why this shop sells bijili and sound crackers loose
 *   in boxes and no 1000/2000/5000/10000-wala garlands; e-commerce marketplaces may not accept online orders for
 *   crackers. So this site is the licensed dealer's own price list and booking form: nothing is charged online, the
 *   shop calls to confirm every booking, and payment is taken after confirmation (checkout uses "cash on delivery" as
 *   "pay on confirmation").
 * - Timings: the Supreme Court's 2018 order allows two hours on Deepavali; Tamil Nadu fixed 6–7 am and 7–8 pm in 2018
 *   and again in 2024 and 2025 (G.O. announced 15 Oct 2025). The copy says to follow the timings your district
 *   announces for 2026, citing 2025's slots as the last ones announced.
 * - Transport: crackers are explosives (Explosives Act 1884, Explosives Rules 2008): no courier, post, rail or air;
 *   they travel only by licensed goods transport, here to Tamil Nadu districts only (delivery zones: no other state).
 * - Age: orders only from adults (18+); no sales to minors; children use the kids' range only with an adult.
 * - Noise: sound crackers stay within the 125 dB(AI) at 4 m limit (Environment (Protection) Rules, noise standards
 *   for firecrackers, 1999).
 *
 * GST: fireworks, signalling flares, rain rockets and other pyrotechnic articles, heading 3604 (fireworks 3604 10 00),
 * are 18% under CGST notification 9/2025-Central Tax (Rate) of 17 Sept 2025 (Schedule II, S. No. 80), in force from
 * 22 Sept 2025; the GST Council's September 2025 rate cuts left fireworks at 18% (it was 18% under 1/2017 too).
 * Gift boxes are assortments of fireworks and are billed at the same 18%. The packing charge is a service (9985) at 18%.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500044";
const WHATSAPP = "919876500044";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
const LICENCE = "LE-5 No. E/SC/TN/26/0000 (demo placeholder)";

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({
      values: { [option]: value },
      price: rs(price),
      mrp: rs(mrp),
      stock,
    })),
  };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({
  variants: [{ price: rs(price), mrp: rs(mrp), stock }],
});

const SPARKLERS = "Sparklers";
const POTS = "Flower pots & chakkars";
const SKY = "Rockets & sky shots";
const SOUND = "Sound crackers";
const KIDS = "Kids' crackers";
const FANCY = "Fancy crackers";
const BOXES = "Gift boxes";

const GREEN = "Yes: CSIR-NEERI green logo and QR code on every box";
const SAFE_HAND = "Hold at arm's length, pointing away from the face and clothes; drop the hot wire into a bucket of water.";
const SAFE_GROUND = "Place on flat, open ground, light the tip from the side at arm's length and step back 5 m. Never bend over it.";
const SAFE_SKY =
  "Light from a distance on open ground, away from roofs, trees, wires and thatch; step back 10 m. Never relight a dud: soak it in water after 15 minutes.";
const SAFE_SOUND = "Light with an incense stick at arm's length on open ground and walk 5 m away. Never hold it, never inside a tin, pot or bottle.";
const SAFE_KIDS = "Only with an adult beside the child, outdoors, with a bucket of water ready.";

/** Product attributes every cracker carries: what it is, how long and how loud, who may use it and how to light it. */
const attrs = (pieces: string, effect: string, burn: string, noise: string, age: string, safety: string) => ({
  Pieces: pieces,
  Effect: effect,
  "Burn time": burn,
  "Noise level": noise,
  "Age guidance": age,
  "Green cracker": GREEN,
  "Safe distance": safety,
});

const NOTE =
  "\n\nGreen cracker made in Sivakasi by a licensed factory, this season's stock. Sold only to adults (18+). Travels only by licensed lorry to Tamil Nadu districts. Read our [safety guide](/pages/safety-guide) before lighting.";

/** A translated value (cms TranslationValue): chapters with and without a button share one array. */
type Tr = string | Tr[] | { [key: string]: Tr };

/** Gift box contents: [quantity, item, kind]. */
type Kind = "sparklers" | "pots" | "sky" | "sound" | "fancy" | "kids";
type Contents = [number, string, Kind][];

const FAMILY: Contents = [
  [3, "10 cm electric sparklers (box of 10)", "sparklers"],
  [1, "15 cm electric sparklers (box of 10)", "sparklers"],
  [1, "15 cm colour sparklers (box of 10)", "sparklers"],
  [1, "Twinkling star (box of 10)", "sparklers"],
  [2, "Small flower pots (box of 10)", "pots"],
  [2, "Big ground chakkars (box of 10)", "pots"],
  [1, "Baby rockets (box of 10)", "sky"],
  [1, "Single colour sky shot (pack of 5)", "sky"],
  [2, "Kuruvi crackers (box of 10)", "sound"],
  [1, "3.5-inch crackers (box of 10)", "sound"],
  [1, "Red bijili, 100 pcs", "sound"],
  [2, "Colour pencil sparklers (box of 10)", "kids"],
  [1, "Snake tablets (box of 6)", "kids"],
  [1, "Colour matches (box of 10)", "kids"],
  [1, "Rail chakkar (pack of 5)", "kids"],
];
const KIDS_BOX: Contents = [
  [2, "7 cm electric sparklers (box of 10)", "sparklers"],
  [2, "10 cm electric sparklers (box of 10)", "sparklers"],
  [1, "10 cm colour sparklers (box of 10)", "sparklers"],
  [2, "Twinkling star (box of 10)", "sparklers"],
  [2, "Mini flower pots (box of 10)", "pots"],
  [2, "Big ground chakkars (box of 10)", "pots"],
  [3, "Colour pencil sparklers (box of 10)", "kids"],
  [2, "Snake tablets (box of 6)", "kids"],
  [2, "Colour matches (box of 10)", "kids"],
  [1, "Rail chakkar (pack of 5)", "kids"],
  [1, "Roll caps (10 rolls)", "kids"],
];
const CELEBRATION: Contents = [
  [4, "10 cm electric sparklers (box of 10)", "sparklers"],
  [2, "12 cm electric sparklers (box of 10)", "sparklers"],
  [2, "15 cm electric sparklers (box of 10)", "sparklers"],
  [2, "15 cm colour sparklers (box of 10)", "sparklers"],
  [1, "Crackling sparklers 12 cm (box of 10)", "sparklers"],
  [1, "Twinkling star (box of 10)", "sparklers"],
  [2, "Big flower pots (box of 10)", "pots"],
  [1, "Small flower pots (box of 10)", "pots"],
  [2, "Big ground chakkars (box of 10)", "pots"],
  [1, "Colour-changing ground chakkar (box of 10)", "pots"],
  [1, "Baby rockets (box of 10)", "sky"],
  [1, "Colour rockets (box of 10)", "sky"],
  [1, "12-shot sky cake", "sky"],
  [2, "Kuruvi crackers (box of 10)", "sound"],
  [2, "3.5-inch crackers (box of 10)", "sound"],
  [1, "4-inch deluxe crackers (box of 10)", "sound"],
  [1, "Red bijili, 100 pcs", "sound"],
  [2, "Colour pencil sparklers (box of 10)", "kids"],
  [1, "Snake tablets (box of 6)", "kids"],
  [1, "Colour matches (box of 10)", "kids"],
  [1, "Rail chakkar (pack of 5)", "kids"],
];
const DELIGHT: Contents = [
  [4, "10 cm electric sparklers (box of 10)", "sparklers"],
  [3, "12 cm electric sparklers (box of 10)", "sparklers"],
  [3, "15 cm electric sparklers (box of 10)", "sparklers"],
  [1, "30 cm electric sparklers (box of 10)", "sparklers"],
  [2, "15 cm colour sparklers (box of 10)", "sparklers"],
  [2, "Crackling sparklers 12 cm (box of 10)", "sparklers"],
  [1, "Twinkling star (box of 10)", "sparklers"],
  [2, "Small flower pots (box of 10)", "pots"],
  [2, "Big flower pots (box of 10)", "pots"],
  [1, "Special flower pots (box of 10)", "pots"],
  [1, "Colour flower pots (box of 10)", "pots"],
  [2, "Big ground chakkars (box of 10)", "pots"],
  [1, "Special ground chakkars (box of 10)", "pots"],
  [1, "Colour-changing ground chakkar (box of 10)", "pots"],
  [1, "Baby rockets (box of 10)", "sky"],
  [1, "Colour rockets (box of 10)", "sky"],
  [1, "Whistling rockets (box of 10)", "sky"],
  [1, "12-shot sky cake", "sky"],
  [1, "30-shot sky cake", "sky"],
  [2, "Kuruvi crackers (box of 10)", "sound"],
  [2, "3.5-inch crackers (box of 10)", "sound"],
  [2, "4-inch deluxe crackers (box of 10)", "sound"],
  [1, "Red bijili, 100 pcs", "sound"],
  [1, "Two-sound crackers (box of 5)", "sound"],
  [1, "Colour pearls, 5 shots", "fancy"],
  [1, "Flying butterflies (box of 10)", "fancy"],
  [1, "Peacock fountain", "fancy"],
  [1, "Colour pencil sparklers (box of 10)", "kids"],
  [1, "Snake tablets (box of 6)", "kids"],
  [1, "Colour matches (box of 10)", "kids"],
];
const GRAND: Contents = [
  [5, "10 cm electric sparklers (box of 10)", "sparklers"],
  [3, "12 cm electric sparklers (box of 10)", "sparklers"],
  [3, "15 cm electric sparklers (box of 10)", "sparklers"],
  [2, "30 cm electric sparklers (box of 10)", "sparklers"],
  [2, "15 cm colour sparklers (box of 10)", "sparklers"],
  [1, "30 cm colour sparklers (box of 10)", "sparklers"],
  [2, "Crackling sparklers 12 cm (box of 10)", "sparklers"],
  [1, "Giant 50 cm sparklers (box of 5)", "sparklers"],
  [1, "Twinkling star (box of 10)", "sparklers"],
  [2, "Small flower pots (box of 10)", "pots"],
  [3, "Big flower pots (box of 10)", "pots"],
  [2, "Special flower pots (box of 10)", "pots"],
  [1, "Deluxe flower pots (box of 5)", "pots"],
  [1, "Colour flower pots (box of 10)", "pots"],
  [2, "Big ground chakkars (box of 10)", "pots"],
  [2, "Special ground chakkars (box of 10)", "pots"],
  [1, "Deluxe ground chakkars (box of 10)", "pots"],
  [1, "Colour-changing ground chakkar (box of 10)", "pots"],
  [1, "Whistling chakkar (box of 5)", "pots"],
  [1, "Baby rockets (box of 10)", "sky"],
  [2, "Colour rockets (box of 10)", "sky"],
  [1, "Whistling rockets (box of 10)", "sky"],
  [1, "30-shot sky cake", "sky"],
  [1, "60-shot sky cake", "sky"],
  [1, "Single colour sky shot (pack of 5)", "sky"],
  [2, "Kuruvi crackers (box of 10)", "sound"],
  [2, "3.5-inch crackers (box of 10)", "sound"],
  [2, "4-inch deluxe crackers (box of 10)", "sound"],
  [1, "Red bijili, 500 pcs", "sound"],
  [1, "Hydro bomb (box of 10)", "sound"],
  [1, "Two-sound crackers (box of 5)", "sound"],
  [1, "Colour pearls, 10 shots", "fancy"],
  [1, "Tri-colour fountain (box of 2)", "fancy"],
  [1, "Flying butterflies (box of 10)", "fancy"],
  [1, "Helicopter spinners (box of 5)", "fancy"],
  [2, "Colour pencil sparklers (box of 10)", "kids"],
  [1, "Snake tablets (box of 6)", "kids"],
  [1, "Colour matches (box of 10)", "kids"],
];
const MEGA: Contents = [
  [6, "10 cm electric sparklers (box of 10)", "sparklers"],
  [4, "12 cm electric sparklers (box of 10)", "sparklers"],
  [4, "15 cm electric sparklers (box of 10)", "sparklers"],
  [3, "30 cm electric sparklers (box of 10)", "sparklers"],
  [2, "15 cm colour sparklers (box of 10)", "sparklers"],
  [2, "30 cm colour sparklers (box of 10)", "sparklers"],
  [2, "Crackling sparklers 12 cm (box of 10)", "sparklers"],
  [2, "Giant 50 cm sparklers (box of 5)", "sparklers"],
  [2, "Low-smoke sparklers 15 cm (box of 10)", "sparklers"],
  [1, "Twinkling star (box of 10)", "sparklers"],
  [2, "Small flower pots (box of 10)", "pots"],
  [3, "Big flower pots (box of 10)", "pots"],
  [3, "Special flower pots (box of 10)", "pots"],
  [2, "Deluxe flower pots (box of 5)", "pots"],
  [2, "Colour flower pots (box of 10)", "pots"],
  [1, "Giant colour fountain (box of 2)", "pots"],
  [2, "Big ground chakkars (box of 10)", "pots"],
  [2, "Special ground chakkars (box of 10)", "pots"],
  [2, "Deluxe ground chakkars (box of 10)", "pots"],
  [2, "Colour-changing ground chakkar (box of 10)", "pots"],
  [1, "Whistling chakkar (box of 5)", "pots"],
  [2, "Baby rockets (box of 10)", "sky"],
  [2, "Colour rockets (box of 10)", "sky"],
  [1, "Whistling rockets (box of 10)", "sky"],
  [1, "Single colour sky shot (pack of 5)", "sky"],
  [1, "60-shot sky cake", "sky"],
  [1, "120-shot sky cake", "sky"],
  [1, "Whistling sky cake, 25 shots", "sky"],
  [2, "Kuruvi crackers (box of 10)", "sound"],
  [2, "3.5-inch crackers (box of 10)", "sound"],
  [2, "4-inch deluxe crackers (box of 10)", "sound"],
  [1, "Red bijili, 1000 pcs", "sound"],
  [1, "Hydro bomb (box of 10)", "sound"],
  [1, "Bullet bomb (box of 10)", "sound"],
  [1, "Two-sound crackers (box of 5)", "sound"],
  [2, "Colour pearls, 10 shots", "fancy"],
  [1, "Tri-colour fountain (box of 2)", "fancy"],
  [1, "Peacock fountain", "fancy"],
  [1, "Flying butterflies (box of 10)", "fancy"],
  [1, "Helicopter spinners (box of 5)", "fancy"],
  [1, "Magic colour fountain (box of 2)", "fancy"],
  [1, "Daytime colour smoke (box of 5)", "fancy"],
  [3, "Colour pencil sparklers (box of 10)", "kids"],
  [2, "Snake tablets (box of 6)", "kids"],
  [2, "Colour matches (box of 10)", "kids"],
  [1, "Rail chakkar (pack of 5)", "kids"],
];
const WEDDING: Contents = [
  [1, "Wedding sky cake, 100 shots", "sky"],
  [2, "60-shot sky cake", "sky"],
  [2, "30-shot sky cake", "sky"],
  [2, "Colour rockets (box of 10)", "sky"],
  [2, "Colour pearls, 10 shots", "fancy"],
  [2, "Tri-colour fountain (box of 2)", "fancy"],
  [2, "Daytime colour smoke (box of 5)", "fancy"],
  [4, "Giant 50 cm sparklers (box of 5)", "sparklers"],
  [2, "Giant colour fountain (box of 2)", "pots"],
];
const TEMPLE: Contents = [
  [1, "120-shot sky cake", "sky"],
  [2, "30-shot sky cake", "sky"],
  [2, "Whistling rockets (box of 10)", "sky"],
  [1, "Red bijili, 1000 pcs", "sound"],
  [3, "4-inch deluxe crackers (box of 10)", "sound"],
  [2, "Hydro bomb (box of 10)", "sound"],
  [2, "Giant colour fountain (box of 2)", "pots"],
  [2, "Colour flower pots (box of 10)", "pots"],
  [2, "Giant 50 cm sparklers (box of 5)", "sparklers"],
];

const count = (c: Contents, kind?: Kind) => c.filter((x) => !kind || x[2] === kind).reduce((n, x) => n + x[0], 0);
const contentsList = (c: Contents) => c.map(([n, item]) => `- ${n} × ${item}`).join("\n");

function giftBox(
  name: string,
  sku: string,
  photo: number,
  price: number,
  mrp: number,
  stock: number,
  contents: Contents,
  intro: string,
  burn: string,
  tags: string[],
  age = "Adults to light the sky shots and sound crackers; children with an adult",
): DemoProduct {
  return {
    name,
    category: BOXES,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku,
    photo,
    tags: ["gift-box", ...tags],
    description: `${intro}\n\n**What's inside (${count(contents)} items):**\n\n${contentsList(contents)}\n\nPacked in a sealed corrugated carton with the contents list and our safety leaflet on top.${NOTE}`,
    attributes: {
      Items: String(count(contents)),
      // The full list is in the description (attributes hold at most 500 characters): here, boxes and packs by kind.
      Contents: (
        [
          ["sparklers", "sparklers"],
          ["pots", "flower pots & chakkars"],
          ["sky", "rockets & sky cakes"],
          ["sound", "sound crackers"],
          ["fancy", "fancy"],
          ["kids", "kids' items"],
        ] as [Kind, string][]
      )
        .filter(([k]) => count(contents, k) > 0)
        .map(([k, label]) => `${count(contents, k)} ${label}`)
        .join(", "),
      "Burn time": burn,
      "Noise level": count(contents, "sound") === 0 ? "Low: no sound crackers" : "Mixed: mostly light, a few loud crackers",
      "Age guidance": age,
      "Green cracker": GREEN,
      "Safe distance": "Each item carries its own distance; aerials 10 m, ground items 5 m, sparklers at arm's length.",
    },
    ...single(price, mrp, stock),
  };
}

const PRODUCTS: DemoProduct[] = [
  // ---- sparklers (3604 10: 18%)
  {
    name: "Electric sparklers",
    category: SPARKLERS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SPE",
    photo: 34417005,
    tags: ["deepavali", "kids", "low-noise", "bestseller"],
    description: `The classic Deepavali sparkler: a wire coated with a gold-spark composition that burns from the tip down. Box of 10, five lengths: 7 cm (about 20 seconds each), 10 cm (30 s), 12 cm (40 s), 15 cm (50 s) and 30 cm (about 2 minutes). Light from a diya or an incense stick, never from a gas stove.${NOTE}`,
    attributes: attrs("10 per box", "Gold crackling sparks", "20 s (7 cm) to 2 min (30 cm) each", "Silent", "8+ with an adult holding the box", SAFE_HAND),
    ...one("Length", [
      ["7 cm", 18, 80, 140],
      ["10 cm", 28, 125, 180],
      ["12 cm", 40, 180, 140],
      ["15 cm", 60, 260, 120],
      ["30 cm", 150, 650, 60],
    ]),
  },
  {
    name: "Colour sparklers (red & green)",
    category: SPARKLERS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SPC",
    photo: 288478,
    tags: ["deepavali", "low-noise"],
    description: `Sparklers that burn red and green with gold sparks: five red and five green in every box of 10. The 30 cm length lasts about two minutes, long enough for a family photo.${NOTE}`,
    attributes: attrs(
      "10 per box (5 red, 5 green)",
      "Red and green flame with gold sparks",
      "30 s (10 cm) to 2 min (30 cm) each",
      "Silent",
      "8+ with an adult",
      SAFE_HAND,
    ),
    ...one("Length", [
      ["10 cm", 36, 160, 100],
      ["15 cm", 72, 320, 80],
      ["30 cm", 180, 780, 40],
    ]),
  },
  {
    name: "Crackling sparklers 12 cm",
    category: SPARKLERS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SPK",
    photo: 34416985,
    tags: ["deepavali", "low-noise"],
    description: `Sparklers that pop softly as they burn, like dry leaves crackling, with silver-white sparks. Box of 10, about 40 seconds each.${NOTE}`,
    attributes: attrs("10 per box", "Silver sparks with soft crackle", "About 40 s each", "Low (soft crackle)", "10+ with an adult", SAFE_HAND),
    ...single(55, 240, 90),
  },
  {
    name: "Giant 50 cm sparklers",
    category: SPARKLERS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SPG",
    photo: 10726384,
    tags: ["wedding", "temple", "deepavali", "low-noise"],
    description: `Half-metre sparklers for the bride and groom's entry, a temple procession or the last photo of Deepavali night: about 3 minutes of thick gold sparks each. Box of 5. Hold the bare end only, with the stick pointing up and away from silk and flowers.${NOTE}`,
    attributes: attrs("5 per box", "Thick gold sparks", "About 3 min each", "Silent", "14+ with an adult", SAFE_HAND),
    ...single(190, 850, 40),
  },
  {
    name: "Low-smoke sparklers 15 cm",
    category: SPARKLERS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SPL",
    photo: 34416989,
    tags: ["deepavali", "low-noise", "kids"],
    description: `A reduced-smoke green formulation for balconies and apartment courtyards: bright white sparks with far less smoke than the classic sparkler. Box of 10, about 50 seconds each.${NOTE}`,
    attributes: attrs("10 per box", "White sparks, low smoke", "About 50 s each", "Silent", "8+ with an adult", SAFE_HAND),
    ...single(70, 300, 80),
  },
  {
    name: "Twinkling star",
    category: SPARKLERS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SPT",
    photo: 714561,
    tags: ["deepavali", "kids", "low-noise"],
    description: `The small stick that blinks with tiny white stars as it burns: the first cracker most of us lit as children. Box of 10, 1.5 inch, about 30 seconds each.${NOTE}`,
    attributes: attrs("10 per box", "Blinking white stars", "About 30 s each", "Silent", "6+ with an adult", SAFE_HAND),
    ...single(45, 200, 100),
  },

  // ---- flower pots & chakkars
  {
    name: "Flower pots",
    category: POTS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-FPT",
    photo: 30067855,
    tags: ["deepavali", "kids", "low-noise", "bestseller"],
    description: `Clay-pot fountains (புஸ்வாணம்) that throw a 1–3 m column of gold sparks: Small and Big for the doorstep, Special and Deluxe for the street. Small, Big and Special come 10 to a box, Deluxe 5 to a box.${NOTE}`,
    attributes: attrs(
      "10 per box (Deluxe: 5)",
      "Gold fountain, 1–3 m high",
      "20 s (Small) to 60 s (Deluxe)",
      "Low (hiss)",
      "10+ with an adult lighting",
      SAFE_GROUND,
    ),
    ...one("Size", [
      ["Small", 90, 400, 100],
      ["Big", 150, 650, 90],
      ["Special", 230, 980, 70],
      ["Deluxe", 290, 1250, 50],
    ]),
  },
  {
    name: "Colour flower pots",
    category: POTS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-FPC",
    photo: 6054332,
    tags: ["deepavali", "wedding", "low-noise"],
    description: `Flower pots whose fountain turns red, green and violet as it burns, about 2 m high. Box of 10.${NOTE}`,
    attributes: attrs("10 per box", "Colour-changing fountain, about 2 m", "About 40 s each", "Low (hiss)", "12+ with an adult lighting", SAFE_GROUND),
    ...single(260, 1100, 60),
  },
  {
    name: "Giant colour fountain",
    category: POTS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-FPG",
    photo: 32871716,
    tags: ["wedding", "temple", "low-noise"],
    description: `A big ground fountain for a wedding entrance or the temple car's return: a 4 m fan of gold and colour sparks for over a minute. Box of 2. Needs a clear circle of 8 m.${NOTE}`,
    attributes: attrs(
      "2 per box",
      "Gold and colour fan, about 4 m",
      "About 75 s each",
      "Low (roar)",
      "18+ to light",
      "Clear 8 m around it; light at arm's length and walk back. Not on terraces or near pandals.",
    ),
    ...single(340, 1450, 40),
  },
  {
    name: "Ground chakkars",
    category: POTS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-CHK",
    photo: 19212789,
    tags: ["deepavali", "kids", "low-noise", "bestseller"],
    description: `Spinning wheels (தரைச் சக்கரம்) that whirl on the ground in a ring of gold sparks. Big for children to watch, Special spins longer, Deluxe changes colour at the end. Box of 10.${NOTE}`,
    attributes: attrs(
      "10 per box",
      "Spinning ring of sparks on the ground",
      "15 s (Big) to 30 s (Deluxe)",
      "Low (whirr)",
      "8+ to watch; an adult lights",
      SAFE_GROUND,
    ),
    ...one("Size", [
      ["Big", 85, 360, 120],
      ["Special", 140, 600, 90],
      ["Deluxe", 220, 950, 60],
    ]),
  },
  {
    name: "Colour-changing ground chakkar",
    category: POTS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-CHC",
    photo: 4579585,
    tags: ["deepavali", "kids", "low-noise"],
    description: `A ground chakkar that spins gold, then green, then red. Box of 10, about 25 seconds each. Light on a smooth floor (a cement yard, not sand) so it spins freely.${NOTE}`,
    attributes: attrs("10 per box", "Spinning wheel, gold → green → red", "About 25 s each", "Low (whirr)", "8+ to watch; an adult lights", SAFE_GROUND),
    ...single(180, 780, 60),
  },
  {
    name: "Whistling chakkar",
    category: POTS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-CHW",
    photo: 29189339,
    tags: ["deepavali"],
    description: `A ground chakkar with a rising whistle as it spins. Box of 5. The whistle is loud close up: keep small children and pets indoors.${NOTE}`,
    attributes: attrs("5 per box", "Spinning sparks with a whistle", "About 20 s each", "Medium (whistle)", "12+ to watch; an adult lights", SAFE_GROUND),
    ...single(150, 640, 50),
  },

  // ---- rockets & sky shots
  {
    name: "Baby rockets",
    category: SKY,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-RKB",
    photo: 1317366,
    tags: ["deepavali"],
    description: `Small stick rockets that climb about 20 m with a spark trail and a soft pop. Box of 10. Launch from an empty glass bottle standing in sand or a launch pipe, never from the hand.${NOTE}`,
    attributes: attrs("10 per box", "Spark trail, soft pop at the top", "About 3 s each", "Medium", "18+ to light", SAFE_SKY),
    ...single(70, 300, 100),
  },
  {
    name: "Colour rockets",
    category: SKY,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-RKC",
    photo: 35497600,
    tags: ["deepavali", "wedding"],
    description: `Rockets that climb about 40 m and open in a small burst of coloured stars. Box of 10. Launch from a pipe in open ground; check which way the wind blows.${NOTE}`,
    attributes: attrs("10 per box", "Coloured star burst at about 40 m", "About 4 s each", "Medium", "18+ to light", SAFE_SKY),
    ...single(140, 600, 80),
  },
  {
    name: "Whistling rockets",
    category: SKY,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-RKW",
    photo: 36490153,
    tags: ["deepavali", "temple"],
    description: `Rockets with a long rising whistle and a crackling tail. Box of 10.${NOTE}`,
    attributes: attrs("10 per box", "Whistle and crackling tail", "About 4 s each", "Medium (whistle)", "18+ to light", SAFE_SKY),
    ...single(160, 680, 60),
  },
  {
    name: "Multi-shot sky cake",
    category: SKY,
    hsn: "36041000",
    gstRate: 18,
    unit: "pcs",
    sku: "TZ-SKC",
    photo: 12767055,
    tags: ["deepavali", "wedding", "temple", "bestseller"],
    description: `A cake of tubes that fires one shot after another into the sky, each opening in coloured stars: the street's favourite. Pick by shot count: 12 shots (about 15 s), 30 (40 s), 60 (75 s), 120 (2.5 min) and 240 (5 min). One fuse; set it on flat hard ground and never stand over it.${NOTE}`,
    attributes: attrs(
      "1 cake",
      "Coloured aerial bursts, one after another",
      "15 s (12 shots) to 5 min (240 shots)",
      "Medium to loud (each shot within 125 dB(AI) at 4 m)",
      "18+ to light",
      SAFE_SKY,
    ),
    ...one("Shots", [
      ["12 shots", 220, 950, 60],
      ["30 shots", 480, 2100, 45],
      ["60 shots", 900, 3900, 30],
      ["120 shots", 1700, 7400, 20],
      ["240 shots", 3200, 13900, 10],
    ]),
  },
  {
    name: "Single colour sky shot",
    category: SKY,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SKS",
    photo: 5499990,
    tags: ["deepavali"],
    description: `One tube, one big red, green or gold burst: for when you want a single "boom-and-bloom" to close the evening. Pack of 5.${NOTE}`,
    attributes: attrs("5 per pack", "One coloured aerial burst", "About 3 s each", "Medium", "18+ to light", SAFE_SKY),
    ...single(180, 780, 60),
  },
  {
    name: "Whistling sky cake 25 shots",
    category: SKY,
    hsn: "36041000",
    gstRate: 18,
    unit: "pcs",
    sku: "TZ-SKW",
    photo: 35497602,
    tags: ["deepavali", "temple"],
    description: `25 whistling shots with gold tails that end in crackling flowers. About 35 seconds.${NOTE}`,
    attributes: attrs("1 cake", "Whistling gold tails, crackling flowers", "About 35 s", "Medium to loud", "18+ to light", SAFE_SKY),
    ...single(520, 2250, 30),
  },
  {
    name: "Wedding sky cake 100 shots",
    category: SKY,
    hsn: "36041000",
    gstRate: 18,
    unit: "pcs",
    sku: "TZ-SKG",
    photo: 8630836,
    tags: ["wedding", "temple"],
    description: `100 shots of gold willow and white glitter that hang in the sky: the reception finale. About 2 minutes. Needs an open ground of 25 m around it; ask the hall or the police station before firing at a venue.${NOTE}`,
    attributes: attrs(
      "1 cake",
      "Gold willow and white glitter",
      "About 2 min",
      "Medium to loud (each shot within 125 dB(AI) at 4 m)",
      "18+ to light",
      "Clear 25 m around it, away from pandals, shamianas and wires; one adult lights, everyone else behind a line.",
    ),
    ...single(1500, 6500, 15),
  },

  // ---- sound crackers (sold loose in boxes; joined / series crackers are banned)
  {
    name: "Kuruvi crackers",
    category: SOUND,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SDK",
    photo: 35027419,
    tags: ["deepavali"],
    description: `The small 2.75-inch "sparrow" cracker with a sharp crack. Box of 10, sold loose (not joined).${NOTE}`,
    attributes: attrs("10 per box", "Single crack", "Instant", "Loud (within 125 dB(AI) at 4 m)", "16+; an adult lights", SAFE_SOUND),
    ...single(30, 130, 200),
  },
  {
    name: "3.5-inch crackers",
    category: SOUND,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SD3",
    photo: 37828277,
    tags: ["deepavali", "temple"],
    description: `A 3.5-inch paper-wound cracker with a deep bang. Box of 10.${NOTE}`,
    attributes: attrs("10 per box", "Single bang", "Instant", "Loud (within 125 dB(AI) at 4 m)", "16+; an adult lights", SAFE_SOUND),
    ...single(55, 240, 150),
  },
  {
    name: "4-inch deluxe crackers",
    category: SOUND,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SD4",
    photo: 15497730,
    tags: ["deepavali", "temple"],
    description: `The biggest single cracker we sell: a 4-inch deluxe with a deep, round bang. Box of 10.${NOTE}`,
    attributes: attrs("10 per box", "Single deep bang", "Instant", "Very loud (within 125 dB(AI) at 4 m)", "18+ to light", SAFE_SOUND),
    ...single(90, 390, 120),
  },
  {
    name: "Red bijili crackers",
    category: SOUND,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SDB",
    photo: 6358545,
    tags: ["deepavali", "temple", "bestseller"],
    description: `Small red bijili crackers sold loose in boxes of 100, 500 or 1000 pieces. Why not a 1000-wala garland? The Supreme Court has banned joined (series) crackers, so we sell them loose: light a few at a time.${NOTE}`,
    attributes: attrs(
      "100, 500 or 1000 loose pieces",
      "Small sharp crack",
      "Instant",
      "Medium (within 125 dB(AI) at 4 m)",
      "14+; an adult supervises",
      SAFE_SOUND,
    ),
    ...one("Pack size", [
      ["100 pcs", 60, 260, 150],
      ["500 pcs", 280, 1200, 60],
      ["1000 pcs", 540, 2300, 40],
    ]),
  },
  {
    name: "Hydro bomb",
    category: SOUND,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SDH",
    photo: 14951678,
    tags: ["deepavali", "temple"],
    description: `A round cracker with a flash and a heavy bang. Box of 10. Not near hospitals, schools, courts, places of worship or thatched roofs.${NOTE}`,
    attributes: attrs("10 per box", "Flash and heavy bang", "Instant", "Very loud (within 125 dB(AI) at 4 m)", "18+ to light", SAFE_SOUND),
    ...single(140, 600, 80),
  },
  {
    name: "Bullet bomb",
    category: SOUND,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SDU",
    photo: 9665368,
    tags: ["deepavali"],
    description: `A short, sharp cracker in a bullet-shaped casing. Box of 10.${NOTE}`,
    attributes: attrs("10 per box", "Sharp bang", "Instant", "Loud (within 125 dB(AI) at 4 m)", "16+; an adult lights", SAFE_SOUND),
    ...single(110, 480, 80),
  },
  {
    name: "Two-sound crackers",
    category: SOUND,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-SD2",
    photo: 4900158,
    tags: ["deepavali"],
    description: `One bang on the ground, a second one in the air a moment later. Box of 5.${NOTE}`,
    attributes: attrs("5 per box", "Ground bang, then an air bang", "About 2 s each", "Loud (within 125 dB(AI) at 4 m)", "18+ to light", SAFE_SOUND),
    ...single(120, 520, 60),
  },

  // ---- kids' crackers (always with an adult)
  {
    name: "Colour pencil sparklers",
    category: KIDS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-KPC",
    photo: 15143047,
    tags: ["kids", "deepavali", "low-noise", "bestseller"],
    description: `Pencil-thin sparklers that burn red, green and yellow with tiny sparks. Box of 10, about 20 seconds each.${NOTE}`,
    attributes: attrs("10 per box", "Coloured flame, tiny sparks", "About 20 s each", "Silent", "5+ with an adult", SAFE_KIDS),
    ...single(40, 170, 150),
  },
  {
    name: "Snake tablets",
    category: KIDS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-KSN",
    photo: 11364121,
    tags: ["kids", "deepavali", "low-noise"],
    description: `Light the tablet on a tile and a long grey "snake" of ash grows out of it (பாம்பு மாத்திரை). Box of 6. Outdoors only: don't breathe the smoke, keep tablets away from food and wash hands after.${NOTE}`,
    attributes: attrs(
      "6 per box",
      "Growing ash snake",
      "About 30 s each",
      "Silent",
      "5+ with an adult lighting",
      `${SAFE_KIDS} Not for mouths: keep away from toddlers.`,
    ),
    ...single(25, 110, 200),
  },
  {
    name: "Rail chakkar",
    category: KIDS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-KRL",
    photo: 10834221,
    tags: ["kids", "deepavali", "low-noise"],
    description: `A spark "train" that runs along a string tied between two poles. Pack of 5. Tie the string tight at shoulder height, 5 m long, away from clothes lines and curtains.${NOTE}`,
    attributes: attrs("5 per pack", "Spark train running along a string", "About 10 s each", "Low (whirr)", "6+ to watch; an adult lights", SAFE_KIDS),
    ...single(75, 320, 80),
  },
  {
    name: "Roll caps",
    category: KIDS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-KCP",
    photo: 8615548,
    tags: ["kids", "deepavali"],
    description: `Paper roll caps for toy cap pistols: 10 rolls. A small pop, no flame. Fire pointing at the ground, never at faces or ears.${NOTE}`,
    attributes: attrs("10 rolls", "Small pops", "Instant", "Low", "5+ with an adult", SAFE_KIDS),
    ...single(30, 120, 150),
  },
  {
    name: "Mini flower pots",
    category: KIDS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-KFP",
    photo: 18168964,
    tags: ["kids", "deepavali", "low-noise"],
    description: `A small flower pot made for little hands to watch from the step: a 1 m gold fountain. Box of 10.${NOTE}`,
    attributes: attrs("10 per box", "Small gold fountain, about 1 m", "About 15 s each", "Low (hiss)", "5+ to watch; an adult lights", SAFE_KIDS),
    ...single(60, 260, 100),
  },
  {
    name: "Colour matches",
    category: KIDS,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-KMT",
    photo: 14154985,
    tags: ["kids", "deepavali", "low-noise"],
    description: `Matchsticks that burn with a red, green or yellow flame for a few seconds. Box of 10 small boxes. Strike away from the body.${NOTE}`,
    attributes: attrs("10 small boxes", "Coloured match flame", "About 5 s each", "Silent", "8+ with an adult", SAFE_KIDS),
    ...single(20, 90, 200),
  },

  // ---- fancy crackers
  {
    name: "Colour pearls",
    category: FANCY,
    hsn: "36041000",
    gstRate: 18,
    unit: "pcs",
    sku: "TZ-FCP",
    photo: 33672866,
    tags: ["deepavali", "wedding"],
    description: `A tube that pops coloured "pearls" one after another, 10–15 m up: red, green, gold and violet. 5 or 10 shots.${NOTE}`,
    attributes: attrs("1 tube", "Coloured pearls, one at a time", "About 10 s (5 shots) or 20 s (10 shots)", "Low (soft pops)", "18+ to light", SAFE_SKY),
    ...one("Shots", [
      ["5 shots", 160, 700, 60],
      ["10 shots", 290, 1250, 40],
    ]),
  },
  {
    name: "Tri-colour fountain",
    category: FANCY,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-FTC",
    photo: 37094397,
    tags: ["deepavali", "wedding", "low-noise"],
    description: `A ground fountain in three stages: saffron, white, then green. Box of 2, about 45 seconds each.${NOTE}`,
    attributes: attrs("2 per box", "Saffron, white and green fountain", "About 45 s each", "Low (hiss)", "12+ with an adult lighting", SAFE_GROUND),
    ...single(260, 1100, 40),
  },
  {
    name: "Peacock fountain",
    category: FANCY,
    hsn: "36041000",
    gstRate: 18,
    unit: "pcs",
    sku: "TZ-FPK",
    photo: 8621919,
    tags: ["deepavali", "wedding", "low-noise"],
    description: `Four fountains fanned out like a peacock's tail, firing one after another in gold and green. About a minute.${NOTE}`,
    attributes: attrs("1 piece (4 fountains)", "Fan of gold and green fountains", "About 60 s", "Low (hiss)", "12+ with an adult lighting", SAFE_GROUND),
    ...single(220, 950, 40),
  },
  {
    name: "Flying butterflies",
    category: FANCY,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-FBF",
    photo: 34440555,
    tags: ["deepavali", "kids"],
    description: `Small spinners that lift off the ground and flutter 3–5 m up in pink and gold sparks. Box of 10. They land where they like: use only in an open yard.${NOTE}`,
    attributes: attrs("10 per box", "Fluttering pink and gold spinners", "About 8 s each", "Low (whirr)", "12+ to watch; an adult lights", SAFE_SKY),
    ...single(120, 520, 60),
  },
  {
    name: "Helicopter spinners",
    category: FANCY,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-FHL",
    photo: 34563006,
    tags: ["deepavali"],
    description: `Bigger spinners with plastic-free paper wings that climb about 10 m in green sparks. Box of 5.${NOTE}`,
    attributes: attrs("5 per box", "Climbing green spinner", "About 10 s each", "Low (whirr)", "14+ to watch; an adult lights", SAFE_SKY),
    ...single(140, 600, 50),
  },
  {
    name: "Magic colour fountain",
    category: FANCY,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-FMG",
    photo: 10802089,
    tags: ["deepavali", "wedding", "low-noise"],
    description: `A tall fountain that changes colour seven times and ends in falling gold. Box of 2, about 70 seconds each.${NOTE}`,
    attributes: attrs("2 per box", "Seven-colour fountain, gold finish", "About 70 s each", "Low (hiss)", "14+ with an adult lighting", SAFE_GROUND),
    ...single(300, 1300, 40),
  },
  {
    name: "Daytime colour smoke",
    category: FANCY,
    hsn: "36041000",
    gstRate: 18,
    unit: "box",
    sku: "TZ-FSM",
    photo: 12493042,
    tags: ["wedding", "temple", "low-noise"],
    description: `Coloured smoke fountains for daytime: pink, green, blue, yellow and orange, about 60 seconds each. Box of 5. For outdoor photos and processions only, downwind of people, never indoors or in a hall.${NOTE}`,
    attributes: attrs(
      "5 per box (one of each colour)",
      "Thick coloured smoke",
      "About 60 s each",
      "Silent",
      "18+ to light",
      "Stand it on the ground, light and step back 3 m; keep it downwind of guests and away from anyone with asthma.",
    ),
    ...single(240, 1000, 40),
  },

  // ---- gift boxes (assortments of 3604: 18%)
  giftBox(
    "Kids' safe gift box",
    "TZ-GBK",
    8819577,
    799,
    2600,
    40,
    KIDS_BOX,
    "Twenty items chosen for children: sparklers, mini flower pots, chakkars, pencils, snake tablets and roll caps. No loud sound crackers, no rockets.",
    "About 35 minutes",
    ["kids", "deepavali", "low-noise"],
    "5+ with an adult lighting and watching",
  ),
  giftBox(
    "Family gift box",
    "TZ-GBF",
    8819840,
    999,
    3800,
    60,
    FAMILY,
    "Our starter box for a family of four on Deepavali morning and evening: a little of everything, mostly sparklers and ground items.",
    "About 40 minutes",
    ["deepavali", "bestseller"],
  ),
  giftBox(
    "Celebration gift box",
    "TZ-GBC",
    8819776,
    1999,
    7200,
    40,
    CELEBRATION,
    "Thirty-two items for a bigger house or two families together, with a 12-shot sky cake for the evening.",
    "About 1 hour",
    ["deepavali"],
  ),
  giftBox(
    "Deepavali delight gift box",
    "TZ-GBD",
    8819772,
    2499,
    9000,
    35,
    DELIGHT,
    "The box most families book: 45 items with a 30-shot sky cake, colour pearls and a peacock fountain for the evening finale.",
    "About 1 hour 20 minutes",
    ["deepavali", "bestseller"],
  ),
  giftBox(
    "Grand gift box",
    "TZ-GBG",
    19720556,
    4999,
    17500,
    20,
    GRAND,
    "Sixty items for a street or a joint family: two sky cakes, giant sparklers, deluxe flower pots and fancy fountains.",
    "About 2 hours",
    ["deepavali"],
  ),
  giftBox(
    "Mega gift box",
    "TZ-GBM",
    36715170,
    9999,
    34000,
    10,
    MEGA,
    "Our biggest box: 85 items for an apartment association or a whole street, with a 120-shot cake, smoke fountains for the morning and something from every shelf.",
    "About 3 hours 30 minutes",
    ["deepavali", "temple"],
  ),
  giftBox(
    "Wedding sky-shot set",
    "TZ-GBW",
    31210632,
    5499,
    19500,
    12,
    WEDDING,
    "For the reception and the baraat: sky cakes, colour pearls and giant sparklers, almost no loud crackers. Ask the venue and the local police station before firing.",
    "About 25 minutes of sky shots",
    ["wedding"],
    "18+ only: one adult fires, guests watch from behind a line",
  ),
  giftBox(
    "Temple festival set",
    "TZ-GBT",
    1580085,
    3999,
    14000,
    12,
    TEMPLE,
    "For the kodai, the ther and the festival night: sky cakes, whistling rockets, a bijili box and fountains for the procession. Fire only where the festival committee and the police allow.",
    "About 30 minutes",
    ["temple"],
    "18+ only: the festival committee's volunteers light",
  ),
];

/** Pexels photos used by the store (credited on /pages/photo-credits). */
const PHOTOS: DemoStore["photos"] = {
  34417005: {
    by: "Marije Kouyzer",
    alt: "Bright sparkler burning against a dark background",
  },
  288478: {
    by: "energepic.com",
    alt: "Sparkler glowing with warm bokeh lights behind it",
  },
  34416985: {
    by: "Marije Kouyzer",
    alt: "Sparkler throwing white sparks in the dark",
  },
  10726384: { by: "Yulia Ilina", alt: "Close-up of a big gold sparkler burst" },
  34416989: {
    by: "Marije Kouyzer",
    alt: "Sparkler with fine white sparks on black",
  },
  714561: { by: "Three-shots", alt: "Small sparkler glowing in the dark" },
  30067855: {
    by: "Christian Reinke",
    alt: "Fountain firework burning beside a clay pot on the ground",
  },
  6054332: { by: "subhash", alt: "Violet ground fountain on Deepavali night" },
  32871716: {
    by: "Dmytro Koplyk",
    alt: "Wide gold fan of sparks from a ground fountain",
  },
  19212789: {
    by: "Anurag Photography",
    alt: "Ground chakkar spinning in a ring of sparks",
  },
  4579585: {
    by: "Davner Ribeiro",
    alt: "Circle of light from a spinning spark wheel",
  },
  29189339: {
    by: "Shivansh Sharma",
    alt: "Spray of orange sparks close to the ground",
  },
  1317366: {
    by: "Peter Spencer",
    alt: "Rocket trails climbing to a pink burst",
  },
  35497600: {
    by: "Alexander Aubin",
    alt: "Rising gold rocket trails in the night sky",
  },
  36490153: { by: "Edward", alt: "Rocket climbing on a red trail to a burst" },
  12767055: {
    by: "Pete Alexopoulos",
    alt: "Sky shot bursting white and gold over a rising trail",
  },
  5499990: { by: "Alex Toi", alt: "Single red aerial burst" },
  35497602: {
    by: "Alexander Aubin",
    alt: "Several orange shots climbing at once",
  },
  8630836: {
    by: "Brixiv",
    alt: "White glitter burst hanging in a grey evening sky",
  },
  35027419: {
    by: "Ram Kondisetti",
    alt: "Close-up of a lit cracker fuse with sparks and smoke",
  },
  37828277: {
    by: "Bilal Yasin",
    alt: "Long exposure of an orange cracker flash",
  },
  15497730: {
    by: "Derek French",
    alt: "Street after crackers, red paper on the ground and a fountain behind",
  },
  6358545: { by: "Lucas Pezeta", alt: "Red sparks bursting in the dark" },
  14951678: { by: "Suki Lee", alt: "Bright white flash and sparks at night" },
  9665368: {
    by: "cottonbro studio",
    alt: "Streak of sparks shooting sideways",
  },
  4900158: { by: "Михаил Марченко", alt: "Round gold and violet aerial burst" },
  15143047: { by: "Ann Perkas", alt: "Thin sparklers held at arm's length" },
  11364121: { by: "Pascal Küffer", alt: "Small sparks crackling in the dark" },
  10834221: { by: "Josue Rosales", alt: "Two sparklers throwing gold sparks" },
  8615548: {
    by: "Georgie Devlin",
    alt: "Close-up of a sparkler and flying sparks",
  },
  18168964: {
    by: "Ch Jawad",
    alt: "Small ground fountain throwing silver sparks",
  },
  14154985: {
    by: "Soubhagya Maharana",
    alt: "Small flame and sparks held at arm's length",
  },
  33672866: { by: "John Davis", alt: "Multicoloured aerial bursts" },
  37094397: {
    by: "Bliss",
    alt: "Two tall ground fountains on Deepavali night in India",
  },
  8621919: { by: "TYPHOON BRO", alt: "Fan-shaped fountain of white sparks" },
  34440555: {
    by: "Mehul",
    alt: "Pink and violet burst in the night sky over Patna",
  },
  34563006: { by: "aman vishwakarma", alt: "Green burst in the night sky" },
  10802089: {
    by: "Davide Compagnoni",
    alt: "Tall fountain with falling gold sparks",
  },
  12493042: {
    by: "Eathan Hood",
    alt: "Green smoke drifting from a smoke can on a country road",
  },
  8819577: {
    by: "Yan Krukau",
    alt: "Wrapped gift boxes on a tray with marigolds and lights",
  },
  8819840: {
    by: "Yan Krukau",
    alt: "Stack of red and gold gift boxes with marigolds",
  },
  8819776: {
    by: "Yan Krukau",
    alt: "Man in a kurta holding a tray of Deepavali gift boxes",
  },
  8819772: {
    by: "Yan Krukau",
    alt: "Smiling man holding a tray of gift boxes for Deepavali",
  },
  19720556: {
    by: "Hoàng Tiến Việt",
    alt: "Many fountains and bursts over water",
  },
  36715170: {
    by: "Jobert Enamno",
    alt: "Wide display of white and red bursts",
  },
  31210632: {
    by: "Jobert Enamno",
    alt: "Gold and green bursts filling the sky",
  },
  1580085: {
    by: "Suvan Chowdhury",
    alt: "Fireworks over an Indian city on festival night",
  },
  34641279: { by: "Soummyo Sarker", alt: "Lit clay diyas" },
  8887374: { by: "Lara Jameson", alt: "Rangoli of lit diyas on Deepavali" },
  36609000: {
    by: "Thilina Alagiyawanna",
    alt: "Lit temple chariot at a night festival",
  },
  27443997: {
    by: "Sabir Khan Shourov",
    alt: "Couple dancing at a night-time Indian wedding",
  },
  29057942: {
    by: "Shantum Singh",
    alt: "Goods lorry with a tarpaulin load on a highway",
  },
  12354555: { by: "Ayrat", alt: "Taped cardboard cartons stacked on a shelf" },
  704745: { by: "Kristina Paukshtite", alt: "Sparkler held at arm's length" },
  9403488: { by: "Ramon Linares", alt: "Metal water pail on a wooden table" },
};

const HOURS = [
  { label: "Every day, Aug – Dec", value: "8:00 am – 10:00 pm" },
  { label: "Jan – Jul", value: "9:30 am – 7:00 pm (closed Sundays)" },
];

const TIMINGS =
  "Follow the bursting timings your district announces for Deepavali 2026. For Deepavali 2025 the Tamil Nadu government allowed **6:00–7:00 am and 7:00–8:00 pm** only (under the Supreme Court's 2018 order), and police booked people for bursting outside those hours. Never near hospitals, schools, courts, places of worship or thatched huts.";
const TIMINGS_TA =
  "தீபாவளி 2026-க்கு உங்கள் மாவட்டம் அறிவிக்கும் நேரத்தில் மட்டும் வெடியுங்கள். தீபாவளி 2025-க்கு தமிழ்நாடு அரசு (உச்ச நீதிமன்றத்தின் 2018 உத்தரவின்படி) **காலை 6:00–7:00, இரவு 7:00–8:00** மட்டுமே அனுமதித்தது; அந்த நேரத்துக்கு வெளியே வெடித்தவர்கள் மீது காவல்துறை வழக்குப் பதிவு செய்தது. மருத்துவமனை, பள்ளி, நீதிமன்றம், வழிபாட்டுத் தலம், குடிசைகள் அருகே ஒருபோதும் வேண்டாம்.";

const FAQ = [
  {
    q: "Can I pay online and get it couriered?",
    a: "No. The Supreme Court has barred online sales of crackers through e-commerce, and crackers can't travel by courier, post, rail or air. This site is our licensed shop's **price list and booking form**: choose **Pay on confirmation (cash on delivery)** at checkout and nothing is charged. We call you within one working day to confirm the list, the transport and the payment (UPI or bank transfer before dispatch, or cash at our Sivakasi counter). See [how to order](/pages/how-to-order).",
  },
  {
    q: "Where do you deliver, and how?",
    a: "**Tamil Nadu districts only**, by licensed goods transport (lorry) to your town's transport office, where you collect with your ID and booking number. Sivakasi and Virudhunagar district get our own licensed van. We can't send crackers to other states or to Puducherry.",
  },
  {
    q: "Who can order?",
    a: "Adults only: you must be **18 or older** to order and to collect. We don't sell to minors, and the kids' range is meant for children only with an adult beside them.",
  },
  {
    q: "Are these green crackers?",
    a: "Yes. Every item is a green cracker from a licensed Sivakasi factory, made with reduced-emission formulations, with the **CSIR-NEERI green logo and QR code** on the box. No barium salts, and no joined (series) crackers or wala garlands, which the Supreme Court has banned: bijili comes loose in boxes of 100, 500 or 1000.",
  },
  { q: "When can we burst crackers?", a: TIMINGS },
  {
    q: "What's the last day to book for Deepavali?",
    a: "**3 November 2026** for lorry delivery anywhere in Tamil Nadu (transport takes 2–5 days in the festival rush). Sivakasi and Virudhunagar bookings until 6 November. Counter sales until Deepavali eve.",
  },
  {
    q: "Is there a minimum order?",
    a: "₹2,500 after discount, so a lorry consignment is worth sending. Combine with neighbours: one booking, one transport charge.",
  },
  {
    q: "A box arrived damp or damaged. What now?",
    a: "Don't use damp or crushed crackers. Photograph the carton at the transport office before you open it, and send the photos on WhatsApp within 24 hours of collection: we replace damaged items in the next consignment or refund them. Because crackers are explosives, we can't take returns of goods that were opened and stored at home.",
  },
];

const FAQ_TA = [
  {
    q: "ஆன்லைனில் பணம் கட்டி கூரியரில் பெறலாமா?",
    a: "இல்லை. இ-காமர்ஸ் மூலம் பட்டாசு ஆன்லைன் விற்பனையை உச்ச நீதிமன்றம் தடை செய்துள்ளது; பட்டாசுகளை கூரியர், தபால், ரயில், விமானத்தில் அனுப்ப முடியாது. இந்தத் தளம் எங்கள் உரிமம் பெற்ற கடையின் **விலைப்பட்டியலும் முன்பதிவுப் படிவமும்**: செக்அவுட்டில் **உறுதிப்படுத்திய பின் பணம் (டெலிவரியில் பணம்)** என்பதைத் தேர்ந்தெடுங்கள்; எதுவும் வசூலிக்கப்படாது. ஒரு வேலை நாளுக்குள் அழைத்து பட்டியல், போக்குவரத்து, பணம் (அனுப்பும் முன் UPI அல்லது வங்கிப் பரிமாற்றம், அல்லது சிவகாசிக் கவுண்டரில் ரொக்கம்) ஆகியவற்றை உறுதி செய்வோம். [எப்படி ஆர்டர் செய்வது](/pages/how-to-order) பாருங்கள்.",
  },
  {
    q: "எங்கே, எப்படி டெலிவரி செய்வீர்கள்?",
    a: "**தமிழ்நாட்டு மாவட்டங்களுக்கு மட்டும்**, உரிமம் பெற்ற சரக்கு லாரியில் உங்கள் ஊரின் டிரான்ஸ்போர்ட் அலுவலகம் வரை; அங்கே உங்கள் அடையாள அட்டையும் முன்பதிவு எண்ணும் காட்டிப் பெற்றுக்கொள்ளுங்கள். சிவகாசி, விருதுநகர் மாவட்டத்துக்கு எங்கள் உரிமம் பெற்ற வேனில். பிற மாநிலங்களுக்கும் புதுச்சேரிக்கும் அனுப்ப இயலாது.",
  },
  {
    q: "யார் ஆர்டர் செய்யலாம்?",
    a: "பெரியவர்கள் மட்டும்: ஆர்டர் செய்யவும் பெற்றுக்கொள்ளவும் **18 வயது நிரம்பியிருக்க வேண்டும்**. சிறார்களுக்கு விற்பதில்லை; குழந்தைகள் பட்டாசுகள் பெரியவர் அருகில் இருக்கும்போது மட்டுமே.",
  },
  {
    q: "இவை பசுமைப் பட்டாசுகளா?",
    a: "ஆம். ஒவ்வொன்றும் உரிமம் பெற்ற சிவகாசி ஆலையின் பசுமைப் பட்டாசு; குறைந்த மாசு கலவையுடன், பெட்டியில் **CSIR-NEERI பசுமை முத்திரையும் QR குறியீடும்** உண்டு. பேரியம் உப்புகள் இல்லை; உச்ச நீதிமன்றம் தடை செய்த இணைப்புப் பட்டாசுகளும் (சரம்) வாலா மாலைகளும் இல்லை: பிஜிலி 100, 500, 1000 தனித்தனியாகப் பெட்டியில்.",
  },
  { q: "எப்போது வெடிக்கலாம்?", a: TIMINGS_TA },
  {
    q: "தீபாவளிக்கு முன்பதிவுக்குக் கடைசி நாள் எது?",
    a: "தமிழ்நாடு முழுவதும் லாரி டெலிவரிக்கு **3 நவம்பர் 2026** (பண்டிகைக் கூட்டத்தில் போக்குவரத்துக்கு 2–5 நாள் ஆகும்). சிவகாசி, விருதுநகர் முன்பதிவுகள் 6 நவம்பர் வரை. கவுண்டர் விற்பனை தீபாவளிக்கு முந்தைய நாள் வரை.",
  },
  {
    q: "குறைந்தபட்ச ஆர்டர் உண்டா?",
    a: "தள்ளுபடிக்குப் பின் ₹2,500; அப்போதுதான் ஒரு லாரி சரக்கு அனுப்புவது பயனுள்ளது. அக்கம்பக்கத்தாருடன் சேர்ந்து ஒரே முன்பதிவு, ஒரே போக்குவரத்துக் கட்டணம்.",
  },
  {
    q: "பெட்டி ஈரமாக அல்லது சேதமாக வந்தால்?",
    a: "ஈரமான அல்லது நசுங்கிய பட்டாசுகளைப் பயன்படுத்த வேண்டாம். திறக்கும் முன் டிரான்ஸ்போர்ட் அலுவலகத்திலேயே அட்டைப்பெட்டியைப் புகைப்படம் எடுத்து, பெற்ற 24 மணி நேரத்துக்குள் வாட்ஸ்அப்பில் அனுப்புங்கள்: அடுத்த சரக்கில் மாற்றித் தருவோம் அல்லது பணம் திருப்பித் தருவோம். பட்டாசுகள் வெடிபொருட்கள் என்பதால், திறந்து வீட்டில் வைத்த பொருட்களைத் திரும்பப் பெற இயலாது.",
  },
];

const SAFETY_RULES = [
  ["Light at arm's length", "Side-on, with an incense stick or a long agarbatti, never a matchbox in the hand."],
  ["Bucket of water ready", "Two buckets of water and a bucket of sand beside you; drop used sparklers in."],
  ["Cotton clothes only", "No loose dupattas, nylon or silk near crackers; tie long hair back."],
  ["Never hold a sound cracker", "Not in the hand, not under a tin, pot or bottle; walk 5 m away."],
  ["Kids with an adult", "Children use the kids' range with an adult beside them; teenagers don't light aerials."],
  ["Follow your district's timings", "Burst only in the hours your district announces; away from hospitals and huts."],
] as const;
/** A picture per safety rule (same order as SAFETY_RULES). */
const SAFETY_PHOTOS = [704745, 9403488, 15143047, 35027419, 10834221, 1580085];
const SAFETY_RULES_TA = [
  ["கை நீட்டிய தூரத்தில் பற்றவையுங்கள்", "பக்கவாட்டில் இருந்து, நீண்ட ஊதுபத்தியால்; கையில் தீப்பெட்டி வேண்டாம்."],
  ["தண்ணீர் வாளி தயார்", "அருகில் இரண்டு வாளி தண்ணீர், ஒரு வாளி மணல்; எரிந்த மத்தாப்புகளை அதில் போடுங்கள்."],
  ["பருத்தி உடை மட்டும்", "தளர்வான துப்பட்டா, நைலான், பட்டு வேண்டாம்; நீண்ட கூந்தலைக் கட்டுங்கள்."],
  ["வெடியைக் கையில் பிடிக்காதீர்கள்", "கையிலும், டப்பா, பானை, பாட்டிலுக்குள்ளும் வேண்டாம்; 5 மீ விலகுங்கள்."],
  ["குழந்தைகளுடன் பெரியவர்", "குழந்தைகள் பெரியவர் அருகில் குழந்தைகள் பட்டாசுகள் மட்டும்; பதின்வயதினர் வான வெடிகளைப் பற்றவைக்க வேண்டாம்."],
  ["மாவட்ட நேரத்தைப் பின்பற்றுங்கள்", "மாவட்டம் அறிவிக்கும் நேரத்தில் மட்டும்; மருத்துவமனை, குடிசைகளிலிருந்து விலகி."],
] as const;

const BOX_ROWS = (boxes: Contents[]) => [
  { label: "Items in the box", values: boxes.map((b) => String(count(b))) },
  {
    label: "Sparklers",
    values: boxes.map((b) => String(count(b, "sparklers"))),
  },
  {
    label: "Flower pots & chakkars",
    values: boxes.map((b) => String(count(b, "pots"))),
  },
  {
    label: "Rockets & sky cakes",
    values: boxes.map((b) => String(count(b, "sky"))),
  },
  {
    label: "Sound crackers",
    values: boxes.map((b) => String(count(b, "sound"))),
  },
  {
    label: "Fancy & kids' items",
    values: boxes.map((b) => String(count(b, "fancy") + count(b, "kids"))),
  },
];

export const THIRUVIZHA: DemoStore = {
  shop: {
    slug: "thiruvizha",
    appId: "EC",
    businessType: "crackers",
    planId: "pro",
    name: "Thiruvizha Crackers",
    primary: "#ff5fa8",
    billing: {
      legalName: "Thiruvizha Crackers",
      gstin: "33AAQFT5821K1ZS",
      address: "4/112, Sattur Road, Sivakasi (Virudhunagar district)",
      city: "Sivakasi",
      pincode: "626123",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "TZ",
      upiId: "thiruvizhacrackers@okaxis",
    },
    items: [
      {
        name: "Packing & forwarding to transport office",
        hsn: "998540",
        unit: "pcs",
        rate: 12_712,
        gstRate: 18,
      },
    ],
  },
  preset: "starburst",
  store: {
    open: true,
    codEnabled: true,
    // No limit: "cash on delivery" is how a shopper books without paying online (pay on confirmation).
    codMaxAmount: 0,
    minOrderValue: 250_000,
    contactPhone: PHONE,
    contactEmail: "book@thiruvizhacrackers.in",
    social: {
      whatsapp: PHONE,
      instagram: "https://instagram.com/thiruvizha.crackers",
      youtube: "https://youtube.com/@thiruvizhacrackers",
    },
    policies: {
      shipping: `**Tamil Nadu only, by licensed transport.** Crackers are explosives under the Explosives Act, 1884 and the Explosives Rules, 2008: they can't be sent by courier, post, rail or air, and we don't send them outside Tamil Nadu (not to Puducherry either).\n\n- **Sivakasi & Virudhunagar district (626xxx):** our licensed van to your door, 1–2 days, ₹150.\n- **Southern districts (Madurai, Theni, Dindigul, Ramanathapuram, Sivaganga, Tirunelveli, Tenkasi, Thoothukudi, Kanyakumari):** licensed lorry to your town's transport office, 2–3 days, ₹350.\n- **Rest of Tamil Nadu:** licensed lorry to your town's transport office, 3–5 days, ₹500, free on bookings above ₹10,000.\n\nYou collect from the transport office with a photo ID and your booking number; the collector must be 18 or older. Cartons are sealed, marked with the contents and kept upright and dry. **Last booking date for Deepavali 2026 lorry dispatch: 3 November.**`,
      returns:
        "Crackers are explosives, so **we can't take back goods once collected and opened**. Inspect the carton at the transport office: if it is damp, crushed or short, photograph it before opening and send the photos on WhatsApp within 24 hours. We replace damaged or missing items in the next consignment or refund them in full. A booking can be cancelled free of charge until we dispatch it.",
      privacy:
        "We use your name, phone, address and ID only to confirm your booking, hand it to the transport company and send your GST bill. We keep the dispatch register the law requires; we never sell your details.",
      terms: `**Booking, not online payment.** Following the Supreme Court's directions on the sale of crackers, this website is our licensed shop's price list and booking form: nothing is charged online. Choose "Pay on confirmation" (cash on delivery) at checkout; we call to confirm the list, the transport and the payment before anything is packed.\n\n**Adults only.** You must be 18 or older to book and to collect. We don't sell to minors.\n\n**Green crackers only.** Everything we sell is a green cracker from a licensed Sivakasi factory, with the CSIR-NEERI green logo and QR code; no barium salts and no joined (series) crackers.\n\n**Use.** Follow the bursting timings your district announces, the safety guide and the distances printed on every box. Sound crackers are within the 125 dB(AI) at 4 m limit.\n\n**Licence.** Thiruvizha Crackers holds an explosives licence to possess and sell fireworks, ${LICENCE}. Prices include 18% GST; MRP is the maker's printed price.`,
    },
    businessType: "crackers",
  },
  zones: [
    {
      name: "Sivakasi & Virudhunagar district",
      pincodePrefixes: ["626"],
      rate: {
        name: "Our licensed van (1–2 days)",
        type: "flat",
        amount: 15_000,
        etaMinDays: 1,
        etaMaxDays: 2,
        codAllowed: true,
        codFee: 0,
      },
    },
    {
      name: "Southern Tamil Nadu districts",
      pincodePrefixes: ["623", "624", "625", "627", "628", "629", "630"],
      rate: {
        name: "Licensed lorry to your transport office (2–3 days)",
        type: "flat",
        amount: 35_000,
        etaMinDays: 2,
        etaMaxDays: 3,
        codAllowed: true,
        codFee: 0,
      },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: {
        name: "Licensed lorry to your transport office (3–5 days)",
        type: "free_above",
        amount: 50_000,
        freeAbove: 1_000_000,
        etaMinDays: 3,
        etaMaxDays: 5,
        codAllowed: true,
        codFee: 0,
      },
    },
  ],
  categories: [
    {
      name: SPARKLERS,
      description: "Electric and colour sparklers from 7 cm to 50 cm, crackling and low-smoke sparklers, twinkling stars.",
      photo: 34417005,
    },
    {
      name: POTS,
      description: "Flower pots from Small to Deluxe, colour and giant fountains, ground chakkars that spin and whistle.",
      photo: 30067855,
    },
    {
      name: SKY,
      description: "Baby, colour and whistling rockets and multi-shot sky cakes from 12 to 240 shots.",
      photo: 12767055,
    },
    {
      name: SOUND,
      description: "Kuruvi, 3.5-inch and 4-inch crackers, loose bijili by the hundred and bombs, all within the legal noise limit.",
      photo: 37828277,
    },
    {
      name: KIDS,
      description: "Pencil sparklers, snake tablets, rail chakkars, roll caps, mini flower pots and colour matches: always with an adult.",
      photo: 15143047,
    },
    {
      name: FANCY,
      description: "Colour pearls, tri-colour and peacock fountains, flying butterflies, helicopter spinners and daytime colour smoke.",
      photo: 33672866,
    },
    {
      name: BOXES,
      description: "Assorted gift boxes from ₹799 to ₹9,999, each with its contents list, plus wedding and temple festival sets.",
      photo: 8819840,
    },
  ],
  products: PRODUCTS,
  collections: [
    {
      name: "Full price list",
      slug: "price-list",
      description: "Every cracker we sell, A to Z, with the Sivakasi offer price.",
      rule: { sort: "name" },
    },
    {
      name: "Deepavali",
      slug: "deepavali",
      description: "Everything for Deepavali morning and evening.",
      rule: { tag: "deepavali", sort: "price-asc" },
    },
    {
      name: "Weddings & receptions",
      slug: "wedding",
      description: "Sky cakes, giant sparklers, fountains and colour smoke for the baraat and the reception, light on noise.",
      rule: { tag: "wedding", sort: "price-asc" },
    },
    {
      name: "Temple festivals",
      slug: "temple-festival",
      description: "Sky cakes, rockets, bijili and fountains for the kodai, the ther and the procession.",
      rule: { tag: "temple", sort: "price-asc" },
    },
    {
      name: "Kids' corner (with an adult)",
      slug: "kids",
      description: "Sparklers, chakkars, pencils and snake tablets that children can enjoy with an adult beside them.",
      rule: { tag: "kids", sort: "price-asc" },
    },
    {
      name: "Low-noise crackers",
      slug: "low-noise",
      description: "Light, colour and sparks, no loud bangs: for streets with babies, elders, pets or a hospital nearby.",
      rule: { tag: "low-noise", sort: "price-asc" },
    },
    {
      name: "Gift boxes by size",
      slug: "gift-boxes",
      description: "From the ₹799 kids' box to the ₹9,999 mega box, with what's inside each.",
      rule: { category: BOXES, sort: "price-asc" },
    },
    {
      name: "Sky shots",
      slug: "sky-shots",
      description: "Rockets and multi-shot cakes by shot count.",
      rule: { category: SKY, sort: "price-asc" },
    },
    {
      name: "Bestsellers",
      slug: "bestsellers",
      description: "What Tamil Nadu books every year.",
      rule: { tag: "bestseller", sort: "price-asc" },
    },
    {
      name: "Sivakasi offer prices",
      slug: "on-offer",
      description: "Up to 80% below the printed MRP.",
      rule: { onSale: true, sort: "price-asc" },
    },
    {
      name: "New this season",
      slug: "new-this-season",
      description: "This season's stock as it arrives from the factories.",
      rule: { sort: "new" },
    },
  ],
  coupons: [
    {
      code: "DEEPAVALI5",
      description: "Extra 5% off bookings above ₹5,000 (up to ₹500)",
      type: "percent",
      value: 5,
      minOrder: 500_000,
      maxDiscount: 50_000,
      channels: ["store", "manual"],
    },
    {
      code: "FIRSTBOX",
      description: "₹100 off your first booking above ₹2,999",
      type: "flat",
      value: 10_000,
      minOrder: 299_900,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      channels: ["store"],
    },
  ],
  home: ({ photo, category, product }) => {
    const boxes = [FAMILY, DELIGHT, GRAND, MEGA];
    const rows = BOX_ROWS(boxes);
    return {
      seo: {
        title: "Thiruvizha Crackers, Sivakasi — green crackers and gift boxes",
        description:
          "A licensed Sivakasi crackers dealer: green sparklers, flower pots, sky shots and gift boxes at Sivakasi offer prices. Book online, pay on confirmation, licensed lorry delivery to Tamil Nadu districts.",
        imageUrl: photo(36715170),
      },
      sections: [
        {
          type: "flash-sale",
          id: "tz-countdown",
          title: "Deepavali countdown",
          text: "Sivakasi offer prices, up to 80% below MRP, until Deepavali night. Book by 3 November for lorry delivery anywhere in Tamil Nadu.",
          endsAt: "2026-11-08T00:00:00+05:30",
          source: "sale",
          layout: "carousel",
          limit: 12,
          cta: {
            label: "See the full price list",
            href: "/collections/price-list",
          },
        },
        {
          type: "stories",
          id: "tz-reels",
          title: "What lights up tonight",
          layout: "reels",
          items: [
            {
              imageUrl: photo(34417005, "tile"),
              title: "Sparklers",
              text: "7 cm for little hands, 50 cm for the bride's entry.",
              href: "/c/sparklers",
              ctaLabel: "Shop sparklers",
            },
            {
              imageUrl: photo(30067855, "tile"),
              title: "Flower pots",
              text: "A 1–3 m gold fountain from a clay pot.",
              href: "/c/flower-pots-and-chakkars",
              ctaLabel: "Shop flower pots",
            },
            {
              imageUrl: photo(19212789, "tile"),
              title: "Ground chakkars",
              text: "A spinning ring of sparks on the yard.",
              href: "/c/flower-pots-and-chakkars",
              ctaLabel: "Shop chakkars",
            },
            {
              imageUrl: photo(12767055, "tile"),
              title: "Sky cakes",
              text: "12 to 240 shots, one after another.",
              href: "/collections/sky-shots",
              ctaLabel: "Shop sky shots",
            },
            {
              imageUrl: photo(33672866, "tile"),
              title: "Colour pearls",
              text: "Red, green, gold and violet pearls, one at a time.",
              href: "/c/fancy-crackers",
              ctaLabel: "Shop fancy crackers",
            },
            {
              imageUrl: photo(32871716, "tile"),
              title: "Giant fountains",
              text: "A 4 m fan of sparks for weddings and the ther.",
              href: "/collections/wedding",
              ctaLabel: "Wedding picks",
            },
            {
              imageUrl: photo(8819840, "tile"),
              title: "Gift boxes",
              text: "₹799 to ₹9,999, every box with its contents list.",
              href: "/collections/gift-boxes",
              ctaLabel: "Compare boxes",
            },
          ],
        },
        {
          type: "finder",
          id: "tz-occasion",
          title: "Shop by occasion",
          text: "Two taps: what you're celebrating and what you'd like to spend. We list what fits.",
          layout: "wizard",
          results: "button",
          buttonLabel: "Show my list",
          imageUrl: photo(36609000, "tile"),
          cta: {
            label: "Send us your list on WhatsApp",
            href: waLink("Hello Thiruvizha Crackers, please suggest crackers for: … Budget: ₹… District: …"),
          },
          questions: [
            {
              label: "What are you celebrating?",
              options: [
                {
                  label: "Deepavali at home",
                  tag: "deepavali",
                  imageUrl: photo(34641279, "square"),
                },
                {
                  label: "Wedding or reception",
                  tag: "wedding",
                  imageUrl: photo(27443997, "square"),
                },
                {
                  label: "Temple festival",
                  tag: "temple",
                  imageUrl: photo(36609000, "square"),
                },
                {
                  label: "Kids' corner",
                  tag: "kids",
                  imageUrl: photo(10834221, "square"),
                },
                {
                  label: "Quiet street (low noise)",
                  tag: "low-noise",
                  imageUrl: photo(8887374, "square"),
                },
              ],
            },
            {
              label: "Your budget per item?",
              options: [
                { label: "Under ₹100", priceMax: 10_000 },
                { label: "₹100 – ₹500", priceMin: 10_000, priceMax: 50_000 },
                { label: "₹500 – ₹2,500", priceMin: 50_000, priceMax: 250_000 },
                { label: "Above ₹2,500", priceMin: 250_000 },
              ],
            },
          ],
        },
        {
          type: "comparison",
          id: "tz-boxes",
          title: "Gift boxes, side by side",
          text: "Every box has a printed contents list. Counts are boxes and packs, not single pieces.",
          productIds: [product("Family gift box"), product("Deepavali delight gift box"), product("Grand gift box"), product("Mega gift box")],
          highlightId: product("Deepavali delight gift box"),
          highlightLabel: "Most booked",
          showRating: false,
          rows: [
            ...rows,
            {
              label: "Lasts about",
              values: ["40 min", "1 h 20 min", "2 h", "3 h 30 min"],
            },
            {
              label: "Best for",
              values: ["A family of four", "Two families together", "A street or joint family", "An apartment association"],
            },
          ],
        },
        {
          type: "category-shelf",
          id: "tz-pricelist",
          title: "The price list, shelf by shelf",
          categoryIds: [SPARKLERS, POTS, SKY, FANCY, KIDS, SOUND, BOXES].map(category),
          showImages: true,
          limit: 8,
        },
        {
          type: "tiles",
          id: "tz-safety",
          title: "Six rules for a safe Deepavali",
          text: "Printed on every carton, and worth reading out to the family before the first sparkler.",
          layout: "grid",
          showCounts: false,
          items: SAFETY_RULES.map(([label, note], i) => ({
            label,
            note,
            imageUrl: photo(SAFETY_PHOTOS[i]!, "tile"),
            href: "/pages/safety-guide",
          })),
          style: { background: "muted" },
        },
        {
          type: "hero-split",
          id: "tz-licensed",
          imageUrl: photo(37094397, "tile"),
          imageSide: "left",
          eyebrow: "Sattur Road, Sivakasi · since 1987",
          heading: "Licensed, green and packed safely in Sivakasi",
          text: "Green crackers with the CSIR-NEERI logo, straight from licensed factories. Book here without paying online; we call to confirm and send it by licensed lorry to your town. Adults (18+) only.",
          cta: { label: "How booking works", href: "/pages/how-to-order" },
          cta2: { label: "Safety guide", href: "/pages/safety-guide" },
          style: { background: "gradient" },
        },
        {
          type: "sticky-story",
          id: "tz-journey",
          title: "From Sivakasi to your street",
          imageSide: "right",
          chapters: [
            {
              eyebrow: "Made",
              heading: "Made in Sivakasi's licensed factories",
              markdown:
                "Sivakasi makes most of India's crackers. We buy from licensed factories we visit every season, and only **green** formulations: reduced emissions, **no barium**, the CSIR-NEERI logo and QR code on the box.",
              imageUrl: photo(6054332, "tile"),
              alt: "Violet ground fountain on Deepavali night",
            },
            {
              eyebrow: "Booked",
              heading: "You book; we call",
              markdown:
                "Add what you want and choose **Pay on confirmation**. Nothing is charged online: we call within a working day to confirm the list, the transport charge and the payment.",
              imageUrl: photo(8819840, "tile"),
              alt: "Stack of gift boxes with marigolds",
              cta: { label: "How booking works", href: "/pages/how-to-order" },
            },
            {
              eyebrow: "Packed",
              heading: "Sealed cartons, contents on top",
              markdown:
                "Each booking is packed in sealed corrugated cartons, marked with the contents and kept upright and dry, with our safety leaflet inside.",
              imageUrl: photo(12354555, "tile"),
              alt: "Taped cardboard cartons",
            },
            {
              eyebrow: "Delivered",
              heading: "Licensed lorry to your town",
              markdown:
                "Crackers can't go by courier, post, rail or air. A licensed goods lorry takes them to your town's transport office in **Tamil Nadu**, where an adult collects with an ID.",
              imageUrl: photo(29057942, "tile"),
              alt: "Goods lorry with a tarpaulin load",
              cta: { label: "Delivery districts", href: "/policies/shipping" },
            },
          ],
        },
        {
          type: "collection",
          id: "tz-kids",
          title: "Kids' corner, with an adult beside",
          collectionSlug: "kids",
          layout: "grid",
          limit: 8,
        },
        {
          type: "testimonials",
          id: "tz-voices",
          title: "Booked from across Tamil Nadu",
          layout: "single",
          items: [
            {
              quote:
                "We book the Deepavali delight box every year for both our families. They called the same evening, the lorry reached Erode in three days, and the carton had the list right on top.",
              name: "Senthil K.",
              role: "Erode",
              rating: 5,
            },
            {
              quote:
                "For our daughter's reception they suggested sky cakes and giant sparklers instead of loud crackers, and reminded us to inform the hall. Everything was exactly as listed.",
              name: "Revathi M.",
              role: "Madurai",
              rating: 5,
            },
            {
              quote:
                "Our temple committee books here for the kodai. The festival set, the bijili boxes and the fountains came well packed, and they explained the timing rules to our volunteers.",
              name: "Muthupandi S.",
              role: "Kovilpatti",
              rating: 5,
            },
          ],
        },
        {
          // A slim strip; its points also feed the offer bar at the top of every page (instead of the generic
          // "Cash on delivery" / "Easy returns" lines, which don't fit a shop that books by phone and takes no returns).
          type: "usp",
          id: "tz-promise",
          layout: "inline",
          items: [
            { icon: "leaf", title: "Green crackers only", text: "CSIR-NEERI logo and QR code" },
            { icon: "phone", title: "Book now, pay on confirmation", text: "Nothing charged online" },
            { icon: "truck", title: "Tamil Nadu only", text: "By licensed lorry, never courier" },
            { icon: "shield", title: "Adults 18+ only", text: "No sales to minors" },
          ],
        },
        { type: "faq", id: "tz-faq", title: "Before you book", items: FAQ },
        {
          type: "location",
          id: "tz-visit",
          title: "Visit the shop on Sattur Road",
          address: "4/112, Sattur Road, Sivakasi 626123, Virudhunagar district",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "9.4533, 77.8024",
        },
      ],
      translations: {
        ta: {
          "tz-countdown": {
            title: "தீபாவளிக் கவுண்ட்டவுன்",
            text: "தீபாவளி இரவு வரை சிவகாசி சலுகை விலை, MRP-யில் 80% வரை தள்ளுபடி. தமிழ்நாடு முழுவதும் லாரி டெலிவரிக்கு நவம்பர் 3-க்குள் முன்பதிவு செய்யுங்கள்.",
            cta: { label: "முழு விலைப்பட்டியல்" },
          },
          "tz-reels": {
            title: "இன்றிரவு எது ஒளிரும்",
            items: [
              {
                title: "மத்தாப்புகள்",
                text: "சிறு கைகளுக்கு 7 செ.மீ., மணப்பெண் வருகைக்கு 50 செ.மீ.",
                ctaLabel: "மத்தாப்புகள்",
              },
              {
                title: "புஸ்வாணம்",
                text: "மண் பானையிலிருந்து 1–3 மீ தங்க நீரூற்று.",
                ctaLabel: "புஸ்வாணங்கள்",
              },
              {
                title: "தரைச் சக்கரம்",
                text: "முற்றத்தில் சுழலும் தீப்பொறி வளையம்.",
                ctaLabel: "சக்கரங்கள்",
              },
              {
                title: "வான வெடிக் கேக்",
                text: "12 முதல் 240 ஷாட்கள், ஒன்றன் பின் ஒன்றாக.",
                ctaLabel: "வான வெடிகள்",
              },
              {
                title: "கலர் முத்துகள்",
                text: "சிவப்பு, பச்சை, தங்கம், ஊதா முத்துகள், ஒவ்வொன்றாக.",
                ctaLabel: "ஃபேன்ஸி பட்டாசுகள்",
              },
              {
                title: "பெரிய நீரூற்றுகள்",
                text: "திருமணம், தேர்த் திருவிழாவுக்கு 4 மீ தீப்பொறி விசிறி.",
                ctaLabel: "திருமணத் தேர்வுகள்",
              },
              {
                title: "கிஃப்ட் பாக்ஸ்கள்",
                text: "₹799 முதல் ₹9,999 வரை, ஒவ்வொன்றிலும் உள்ளடக்கப் பட்டியல்.",
                ctaLabel: "பெட்டிகளை ஒப்பிடுங்கள்",
              },
            ],
          },
          "tz-occasion": {
            title: "நிகழ்ச்சி வாரியாக",
            text: "இரண்டு தட்டல்கள்: என்ன கொண்டாட்டம், எவ்வளவு செலவு. பொருந்துவதைப் பட்டியலிடுவோம்.",
            buttonLabel: "என் பட்டியலைக் காட்டு",
            cta: { label: "உங்கள் பட்டியலை வாட்ஸ்அப்பில் அனுப்புங்கள்" },
            questions: [
              {
                label: "என்ன கொண்டாட்டம்?",
                options: [
                  { label: "வீட்டில் தீபாவளி" },
                  { label: "திருமணம் / வரவேற்பு" },
                  { label: "கோயில் திருவிழா" },
                  { label: "குழந்தைகள் பகுதி" },
                  { label: "அமைதியான தெரு (குறைந்த சத்தம்)" },
                ],
              },
              {
                label: "ஒரு பொருளுக்கு உங்கள் பட்ஜெட்?",
                options: [{ label: "₹100-க்குள்" }, { label: "₹100 – ₹500" }, { label: "₹500 – ₹2,500" }, { label: "₹2,500-க்கு மேல்" }],
              },
            ],
          },
          "tz-boxes": {
            title: "கிஃப்ட் பாக்ஸ்கள், அருகருகே",
            text: "ஒவ்வொரு பெட்டியிலும் அச்சிட்ட உள்ளடக்கப் பட்டியல் உண்டு. எண்ணிக்கை பெட்டிகளும் பேக்குகளும், தனித் துண்டுகள் அல்ல.",
            highlightLabel: "அதிகம் முன்பதிவானது",
            rows: [
              // The counts stay as they are; only the labels are Tamil (one shape for every row: see docs, typing pitfall).
              ...["பெட்டியில் உள்ளவை", "மத்தாப்புகள்", "புஸ்வாணம் & சக்கரங்கள்", "ராக்கெட் & வான வெடிக் கேக்", "சத்த வெடிகள்", "ஃபேன்ஸி & குழந்தைகள்"].map(
                (label, i) => ({ label, values: rows[i]!.values }),
              ),
              {
                label: "நீடிக்கும் நேரம்",
                values: ["40 நிமி", "1 ம 20 நிமி", "2 ம", "3 ம 30 நிமி"],
              },
              {
                label: "யாருக்கு ஏற்றது",
                values: ["நால்வர் குடும்பம்", "இரண்டு குடும்பங்கள் சேர்ந்து", "ஒரு தெரு அல்லது கூட்டுக் குடும்பம்", "அடுக்குமாடிக் குடியிருப்போர் சங்கம்"],
              },
            ],
          },
          "tz-pricelist": { title: "விலைப்பட்டியல், அலமாரி வாரியாக" },
          "tz-safety": {
            title: "பாதுகாப்பான தீபாவளிக்கு ஆறு விதிகள்",
            text: "ஒவ்வொரு அட்டைப்பெட்டியிலும் அச்சிடப்பட்டவை; முதல் மத்தாப்புக்கு முன் குடும்பத்துக்குப் படித்துக் காட்டுங்கள்.",
            items: SAFETY_RULES_TA.map(([label, note]) => ({ label, note })),
          },
          "tz-licensed": {
            eyebrow: "சாத்தூர் சாலை, சிவகாசி · 1987 முதல்",
            heading: "உரிமம் பெற்றது, பசுமையானது, சிவகாசியில் பாதுகாப்பாக பேக் செய்யப்பட்டது",
            text: "CSIR-NEERI முத்திரையுடன் பசுமைப் பட்டாசுகள், உரிமம் பெற்ற ஆலைகளிலிருந்து நேரடியாக. ஆன்லைனில் பணம் கட்டாமல் இங்கே முன்பதிவு செய்யுங்கள்; அழைத்து உறுதி செய்து, உரிமம் பெற்ற லாரியில் உங்கள் ஊருக்கு அனுப்புவோம். பெரியவர்கள் (18+) மட்டும்.",
            cta: { label: "முன்பதிவு எப்படி" },
            cta2: { label: "பாதுகாப்பு வழிகாட்டி" },
          },
          "tz-journey": {
            title: "சிவகாசியிலிருந்து உங்கள் தெரு வரை",
            chapters: <Tr[]>[
              {
                eyebrow: "தயாரிப்பு",
                heading: "சிவகாசியின் உரிமம் பெற்ற ஆலைகளில் தயாரிப்பு",
                markdown:
                  "இந்தியாவின் பெரும்பாலான பட்டாசுகள் சிவகாசியில் தயாராகின்றன. ஒவ்வொரு சீசனிலும் நாங்கள் நேரில் பார்க்கும் உரிமம் பெற்ற ஆலைகளிடமிருந்து, **பசுமைக்** கலவைகளை மட்டும் வாங்குகிறோம்: குறைந்த மாசு, **பேரியம் இல்லை**, பெட்டியில் CSIR-NEERI முத்திரையும் QR குறியீடும்.",
                alt: "தீபாவளி இரவில் ஊதா நிறத் தரை நீரூற்று",
              },
              {
                eyebrow: "முன்பதிவு",
                heading: "நீங்கள் முன்பதிவு; நாங்கள் அழைப்போம்",
                markdown:
                  "வேண்டியதைச் சேர்த்து **உறுதிப்படுத்திய பின் பணம்** என்பதைத் தேர்ந்தெடுங்கள். ஆன்லைனில் எதுவும் வசூலிக்கப்படாது: ஒரு வேலை நாளுக்குள் அழைத்து பட்டியல், போக்குவரத்துக் கட்டணம், பணம் ஆகியவற்றை உறுதி செய்வோம்.",
                alt: "சாமந்திப் பூக்களுடன் அடுக்கிய கிஃப்ட் பாக்ஸ்கள்",
                cta: { label: "முன்பதிவு எப்படி" },
              },
              {
                eyebrow: "பேக்கிங்",
                heading: "சீல் செய்த அட்டைப்பெட்டி, மேலே உள்ளடக்கப் பட்டியல்",
                markdown:
                  "ஒவ்வொரு முன்பதிவும் சீல் செய்த நெளி அட்டைப்பெட்டிகளில், உள்ளடக்கம் குறிக்கப்பட்டு, நிமிர்த்தி, ஈரமின்றி, உள்ளே எங்கள் பாதுகாப்புக் குறிப்புடன் பேக் செய்யப்படுகிறது.",
                alt: "டேப் ஒட்டிய அட்டைப்பெட்டிகள்",
              },
              {
                eyebrow: "டெலிவரி",
                heading: "உரிமம் பெற்ற லாரியில் உங்கள் ஊருக்கு",
                markdown:
                  "பட்டாசுகளை கூரியர், தபால், ரயில், விமானத்தில் அனுப்ப முடியாது. உரிமம் பெற்ற சரக்கு லாரி **தமிழ்நாட்டில்** உங்கள் ஊரின் டிரான்ஸ்போர்ட் அலுவலகம் வரை கொண்டு செல்லும்; அங்கே ஒரு பெரியவர் அடையாள அட்டையுடன் பெற்றுக்கொள்ளலாம்.",
                alt: "தார்ப்பாய் போர்த்திய சரக்கு லாரி",
                cta: { label: "டெலிவரி மாவட்டங்கள்" },
              },
            ],
          },
          "tz-kids": { title: "குழந்தைகள் பகுதி, அருகில் பெரியவருடன்" },
          "tz-voices": {
            title: "தமிழ்நாடு முழுவதிலிருந்தும் முன்பதிவுகள்",
            items: [
              {
                quote:
                  "இரண்டு குடும்பங்களுக்கும் ஒவ்வொரு வருடமும் தீபாவளி டிலைட் பெட்டியை முன்பதிவு செய்கிறோம். அன்று மாலையே அழைத்தார்கள்; மூன்று நாளில் லாரி ஈரோடு வந்தது; அட்டைப்பெட்டியின் மேலேயே பட்டியல் இருந்தது.",
                role: "ஈரோடு",
              },
              {
                quote:
                  "எங்கள் மகளின் வரவேற்புக்கு, சத்த வெடிகளுக்குப் பதிலாக வான வெடிக் கேக்குகளையும் பெரிய மத்தாப்புகளையும் பரிந்துரைத்தார்கள்; மண்டபத்துக்குத் தெரிவிக்கவும் நினைவூட்டினார்கள். பட்டியலில் இருந்தபடியே எல்லாம் வந்தது.",
                role: "மதுரை",
              },
              {
                quote:
                  "எங்கள் கோயில் குழு கொடைக்கு இங்கேதான் முன்பதிவு செய்கிறது. திருவிழா செட், பிஜிலி பெட்டிகள், நீரூற்றுகள் நன்றாக பேக் செய்து வந்தன; எங்கள் தன்னார்வலர்களுக்கு நேர விதிகளையும் விளக்கினார்கள்.",
                role: "கோவில்பட்டி",
              },
            ],
          },
          "tz-promise": {
            items: [
              { title: "பசுமைப் பட்டாசுகள் மட்டும்", text: "CSIR-NEERI முத்திரை, QR குறியீடு" },
              { title: "இப்போது முன்பதிவு, உறுதிக்குப் பின் பணம்", text: "ஆன்லைனில் கட்டணம் இல்லை" },
              { title: "தமிழ்நாடு மட்டும்", text: "உரிமம் பெற்ற லாரியில், கூரியரில் இல்லை" },
              { title: "18+ பெரியவர்கள் மட்டும்", text: "சிறார்களுக்கு விற்பனை இல்லை" },
            ],
          },
          "tz-faq": { title: "முன்பதிவுக்கு முன்", items: FAQ_TA },
          "tz-visit": {
            title: "சாத்தூர் சாலைக் கடைக்கு வாருங்கள்",
            address: "4/112, சாத்தூர் சாலை, சிவகாசி 626123, விருதுநகர் மாவட்டம்",
            hours: [
              { label: "ஆக – டிச, தினமும்", value: "காலை 8:00 – இரவு 10:00" },
              {
                label: "ஜன – ஜூலை",
                value: "காலை 9:30 – மாலை 7:00 (ஞாயிறு விடுமுறை)",
              },
            ],
          },
        },
      },
    };
  },
  pages: [
    {
      slug: "safety-guide",
      title: "Safety guide",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Before you light anything" },
        {
          type: "paragraph",
          markdown:
            "- Read the label on each box: it gives the safe distance and who should light it.\n- Keep **two buckets of water and one of sand** beside you, and a first-aid kit indoors.\n- Wear **cotton clothes**; no loose dupattas, nylon or silk. Tie long hair back. Wear footwear.\n- Choose **open ground**: away from vehicles, thatched roofs, dry grass, electric wires, gas cylinders and pandals.\n- Store crackers in a closed box in a cool room, away from the kitchen, lamps and diyas, and out of children's reach.",
        },
        {
          type: "image",
          url: photo(9403488, "tile"),
          alt: "Metal water pail on a wooden table",
        },
        { type: "heading", level: 2, text: "Lighting" },
        {
          type: "paragraph",
          markdown:
            "- Light with a **long incense stick**, side-on, at **arm's length**. Never with a matchbox or lighter in the hand, never bending over the cracker.\n- **Sparklers:** hold at arm's length, pointing away from faces; drop the hot wire into water.\n- **Flower pots, chakkars, fountains:** on flat ground; step back **5 m**.\n- **Rockets and sky cakes:** from a launch pipe or on flat hard ground, never from the hand or a bottle in someone's hand; step back **10 m** (25 m for 100+ shot cakes).\n- **Sound crackers:** never in the hand, never under a tin, pot or bottle; walk **5 m** away.\n- **A dud?** Don't go near it or relight it. Wait 15 minutes, then pour water over it.",
        },
        { type: "heading", level: 2, text: "Children" },
        {
          type: "paragraph",
          markdown:
            "Children use only the **kids' range**, with an adult beside them every minute. Adults light the flower pots and chakkars; teenagers don't light rockets, sky cakes or sound crackers. We sell only to adults (18+).",
        },
        { type: "heading", level: 2, text: "Timings and places" },
        {
          type: "paragraph",
          markdown: `${TIMINGS}\n\nBurst only **green crackers** (CSIR-NEERI logo and QR code on the box). Joined (series) crackers and barium-based crackers are banned by the Supreme Court. Keep the noise down near homes with newborns, elders, patients and pets.`,
        },
        { type: "heading", level: 2, text: "If someone gets burnt" },
        {
          type: "paragraph",
          markdown:
            "Cool the burn under **running tap water for 20 minutes**; don't apply ink, toothpaste, oil or ice. Cover loosely with a clean cloth and go to a doctor for anything bigger than a coin, or any burn on the face, eyes, hands or a child. For an eye injury don't rub: rinse with clean water and go to a hospital. **Fire and rescue: 101 · Ambulance: 108.**",
        },
        {
          type: "button",
          label: "Ask us on WhatsApp",
          href: waLink("Hello Thiruvizha Crackers, a safety question: …"),
          style: "primary",
        },
      ],
    },
    {
      slug: "how-to-order",
      title: "How to order & transport",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Booking, not online payment" },
        {
          type: "paragraph",
          markdown:
            "The Supreme Court has barred the online sale of crackers through e-commerce, and crackers are explosives that only licensed transport may carry. So this website works as our licensed shop's **price list and booking form**:\n\n1. **Add** what you want to the cart (minimum ₹2,500 after discount) and check out with **Pay on confirmation (cash on delivery)**. Nothing is charged online.\n2. **We call you** within one working day to confirm the list, stock, the transport charge and your nearest transport office.\n3. **You pay** after the call: UPI or bank transfer before dispatch, or cash at our Sivakasi counter. We send a GST bill.\n4. **We pack** your booking in sealed, labelled cartons and hand it to a licensed goods transport company with the paperwork.\n5. **You collect** from your town's transport office with a photo ID and your booking number. The collector must be 18 or older. Check the cartons before you leave.",
        },
        {
          type: "image",
          url: photo(29057942, "tile"),
          alt: "Goods lorry with a tarpaulin load on a highway",
        },
        { type: "heading", level: 2, text: "Where we deliver" },
        {
          type: "paragraph",
          markdown:
            "| Area | How | Time | Charge |\n|---|---|---|---|\n| Sivakasi & Virudhunagar district | Our licensed van, to your door | 1–2 days | ₹150 |\n| Madurai, Theni, Dindigul, Ramanathapuram, Sivaganga, Tirunelveli, Tenkasi, Thoothukudi, Kanyakumari | Licensed lorry to your transport office | 2–3 days | ₹350 |\n| Rest of Tamil Nadu | Licensed lorry to your transport office | 3–5 days | ₹500; free above ₹10,000 |\n\n**Tamil Nadu only.** We don't send crackers to other states or Puducherry, and never by courier, post, rail or air.\n\n**Last booking date for Deepavali 2026:** 3 November (lorry), 6 November (Sivakasi & Virudhunagar).",
        },
        {
          type: "image",
          url: photo(12354555, "tile"),
          alt: "Taped cardboard cartons stacked on a shelf",
        },
        { type: "heading", level: 2, text: "Our licence" },
        {
          type: "paragraph",
          markdown: `Thiruvizha Crackers, 4/112, Sattur Road, Sivakasi 626123, holds a licence under the Explosives Rules, 2008 to possess and sell fireworks: **${LICENCE}**. GSTIN 33AAQFT5821K1ZS (demo). Every booking is entered in our sales register as the licence requires.`,
        },
        {
          type: "button",
          label: "Book on WhatsApp instead",
          href: waLink("Hello Thiruvizha Crackers, I'd like to book: … District: … Transport office: …"),
          style: "primary",
        },
      ],
    },
    {
      slug: "about",
      title: "About us",
      blocks: ({ photo }) => [
        {
          type: "heading",
          level: 2,
          text: "Thiruvizha Crackers, Sattur Road, since 1987",
        },
        {
          type: "paragraph",
          markdown:
            "Thiruvizha (திருவிழா) is Tamil for festival. We started as a small licensed shop on Sattur Road in **Sivakasi**, the town that makes most of India's crackers, selling to families who came down for Deepavali, wedding parties and temple committees from across the south. Today we book for all of Tamil Nadu, still from the same counter.\n\nWe sell only **green crackers** from licensed factories we visit every season, pack every booking ourselves and send it only by licensed transport.",
        },
        {
          type: "image",
          url: photo(8887374, "tile"),
          alt: "Rangoli of lit diyas on Deepavali",
        },
        {
          type: "paragraph",
          markdown: "Open every day from August to December, 8:00 am – 10:00 pm. Call or WhatsApp **+91 98765 00044**.",
        },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' models, not our customers or staff, and the effects shown are stand-ins for the generic products named.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(
            PHOTOS,
          )
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Gift boxes", type: "category", ref: "gift-boxes" },
      { label: "Sparklers", type: "category", ref: "sparklers" },
      { label: "Sky shots", type: "collection", ref: "sky-shots" },
      { label: "Kids' corner", type: "collection", ref: "kids" },
      { label: "Price list", type: "collection", ref: "price-list" },
      { label: "Safety", type: "page", ref: "safety-guide" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          {
            label: "How to order & transport",
            type: "page",
            ref: "how-to-order",
          },
          { label: "Safety guide", type: "page", ref: "safety-guide" },
          { label: "Track your booking", type: "url", href: "/track" },
          {
            label: "WhatsApp us",
            type: "url",
            href: `https://wa.me/${WHATSAPP}`,
          },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "Weddings", type: "collection", ref: "wedding" },
          {
            label: "Temple festivals",
            type: "collection",
            ref: "temple-festival",
          },
          { label: "Low-noise crackers", type: "collection", ref: "low-noise" },
          { label: "About us", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
