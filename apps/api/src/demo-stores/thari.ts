import { withPriceBandGst } from "./gst-band";
import type { DemoProduct, DemoStore } from "./types";

/**
 * Store #5 of the series: Thari Silks, Kanchipuram (thari.localhost:3003). A saree and silk boutique on Gandhi Road on
 * the online store app (EC) with the `fashion` trade (size guide and "made in Tamil Nadu" on) and the "zari" look
 * (peacock teal and antique gold on champagne ivory, an editorial Didone serif). Thari (தறி) is Tamil for the
 * handloom. Kanchipuram silks, soft silks, Chettinad and Kovai cottons, Madurai Sungudi and linen sarees, ready-made
 * blouses with sizes, kurtis, dupattas, veshtis and festive wear for men and children. Names are generic (no brands);
 * prices are typical Kanchipuram showroom prices in 2026, GST included. Address, phone and GSTIN are placeholders like
 * the other demo shops.
 *
 * GST (CGST notification 9/2025-Central Tax (Rate) of 17 Sept 2025, in force from 22 Sept 2025, which replaced
 * 1/2017):
 * - Sarees and veshtis are woven fabric lengths, not garments, so they stay at 5% at any price: silk (5007) 5%,
 *   silk-cotton and cotton (5212 / 5208) 5%, linen (5309) 5%.
 * - Stitched apparel (chapter 62: blouses 6206, kurtis and girls' pavadai sets 6204, boys' sets 6203, men's shirts
 *   and kurtas 6205, dupattas 6214) and made-ups (6307): 5% when the sale value is at most ₹2,500 a piece, 18% above
 *   (the 12% slab is gone). Prices here include GST, so a 5% piece is at most ₹2,625 and an 18% piece more than
 *   ₹2,950: the zardosi bridal blouse, the silk dupatta and the zari pavadai set are the 18% pieces.
 * - Handbags of textile (4202 22, the potli bag): 18%.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500055";
const WHATSAPP = "919876500055";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

/** Every combination of two options at one price: `stock(a, b)` per combination. */
function grid(a: [string, string[]], b: [string, string[]], price: number, mrp: number, stock: (x: string, y: string) => number): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [
      { name: a[0], values: a[1] },
      { name: b[0], values: b[1] },
    ],
    variants: a[1].flatMap((x) => b[1].map((y) => ({ values: { [a[0]]: x, [b[0]]: y }, price: rs(price), mrp: rs(mrp), stock: stock(x, y) }))),
  };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

/** One size row at one price; the middle sizes get the most stock. */
const sized = (sizes: string[], price: number, mrp: number, stock = [3, 6, 8, 6, 4, 2]) =>
  one(
    "Size",
    sizes.map((s, i) => [s, price, mrp, stock[i] ?? 2]),
  );

const BLOUSE_SIZES = ["32", "34", "36", "38", "40", "42"];
const KURTI_SIZES = ["S", "M", "L", "XL", "XXL"];
const KID_AGES = ["2–3 years", "4–5 years", "6–7 years", "8–9 years"];
const midStock = (_c: string, s: string) => (s === "36" || s === "38" || s === "M" || s === "L" ? 5 : 3);

const SAREES = "Sarees";
const BLOUSES = "Blouses";
const KURTIS = "Kurtis";
const DUPATTAS = "Dupattas";
const MEN = "Men";
const KIDS = "Kids";
const ACCESSORIES = "Accessories";

const SILK_NOTE =
  "\n\nPure mulberry silk, woven on a pit loom in Kanchipuram; Silk Mark tagged, with a test certificate for the zari. 6.3 m with an unstitched blouse piece in the body or border colour. Dry-clean only. Every saree is handwoven, so the colour can differ a little from the picture.";
const COTTON_NOTE = "\n\n5.5 m without a separate blouse piece unless it says so. Gentle hand wash in cold water, dry in shade; starch lightly for crisp pleats.";
const LINEN_NOTE = "\n\n6.2 m with a running blouse piece. Linen softens with every wash: hand wash cold, iron while slightly damp.";

const PRODUCTS: DemoProduct[] = [
  // ---- Kanchipuram silk (HSN 5007, woven silk fabric: 5% at any price)
  {
    name: "Kanchipuram silk saree, mango yellow with rani pink border",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KMY",
    photo: 9419023,
    tags: ["kanchipuram", "silk", "festive", "bestseller"],
    description: `The classic Kanchipuram pairing: a mango-yellow body with a contrast rani-pink korvai border and pallu, joined by hand so the border colour never bleeds into the body. Small zari buttas all over and a temple (rettai pettu) border.${SILK_NOTE}`,
    attributes: { Fabric: "Pure mulberry silk", Zari: "Pure zari (silver, gold plated)", Weave: "Korvai, temple border", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean only" },
    ...single(18_500, 18_500, 2),
  },
  {
    name: "Kanchipuram bridal silk saree, korvai border",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KBR",
    photo: 37602134,
    tags: ["kanchipuram", "silk", "wedding", "bestseller"],
    description: `Our muhurtham saree: a heavy 1,000-butta body, a broad zari korvai border and a rich pallu with peacocks and mango motifs, about 1.4 kg of silk and zari. Woven to order in three weeks in your choice of colours; the two colourways below are on the shelf.${SILK_NOTE}`,
    attributes: { Fabric: "Pure mulberry silk", Zari: "Pure zari, 1,000 buttas", Weave: "Korvai, broad border", Weight: "About 1.4 kg", Origin: "Kanchipuram", Care: "Dry-clean only" },
    ...one("Colour", [
      ["Parrot green & arakku red", 42_000, 42_000, 1],
      ["Arakku red & gold", 44_500, 44_500, 1],
    ]),
  },
  {
    name: "Kanchipuram silk saree, peacock blue with copper zari",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KPB",
    photo: 35108765,
    tags: ["kanchipuram", "silk", "wedding", "bestseller"],
    description: `Peacock-blue silk worked all over in copper zari brocade, with a copper border and a grand pallu. A reception and engagement favourite that photographs beautifully under lights.${SILK_NOTE}`,
    attributes: { Fabric: "Pure mulberry silk", Zari: "Copper-tone pure zari", Weave: "All-over brocade", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean only" },
    ...single(24_500, 24_500, 2),
  },
  {
    name: "Kanchipuram half-and-half silk saree, rose and mint",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KHH",
    photo: 35108768,
    tags: ["kanchipuram", "silk", "festive"],
    description: `A "pazhamudhir" half-and-half: the pleats in rose pink, the drape in mint, with a gold zari border running through both. Light enough for a long day of functions.${SILK_NOTE}`,
    attributes: { Fabric: "Pure mulberry silk", Zari: "Pure zari", Weave: "Half-and-half", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean only" },
    ...single(21_800, 23_500, 1),
  },
  {
    name: "Kanchipuram tissue silk saree, ivory and gold",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KTI",
    photo: 37054318,
    tags: ["kanchipuram", "silk", "festive"],
    description: `Ivory silk with a fine gold tissue weave that catches the light, a simple zari border and a striped pallu. Understated and timeless for Varalakshmi Vratham, housewarmings and evening receptions.${SILK_NOTE}`,
    attributes: { Fabric: "Silk with tissue zari", Zari: "Pure zari tissue", Weave: "Tissue", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean only" },
    ...single(16_900, 16_900, 3),
  },
  {
    name: "Kanchipuram silk saree, lavender with silver zari",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KLV",
    photo: 35108864,
    tags: ["kanchipuram", "silk"],
    description: `A soft lavender body with silver zari checks and a silver border: the modern Kanchipuram for brides' sisters and evening receptions.${SILK_NOTE}`,
    attributes: { Fabric: "Pure mulberry silk", Zari: "Pure silver zari", Weave: "Checks", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean only" },
    ...single(15_400, 15_400, 2),
  },
  {
    name: "Kanchipuram silk saree, ink blue with arakku border",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KIB",
    photo: 35108775,
    tags: ["kanchipuram", "silk", "wedding"],
    description: `Deep ink-blue silk with an arakku (lac red) border and pallu, woven in the old "MS blue" style with small gold buttas. A saree that is handed down.${SILK_NOTE}`,
    attributes: { Fabric: "Pure mulberry silk", Zari: "Pure zari", Weave: "Korvai border, buttas", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean only" },
    ...single(27_500, 27_500, 1),
  },
  {
    name: "Kanchipuram half-and-half silk saree, gold and sky blue",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KGS",
    photo: 35108861,
    tags: ["kanchipuram", "silk", "festive"],
    description: `Gold-tissue pleats with a sky-blue brocade drape and a parrot-green blouse piece: bright, festive and very Kanchipuram.${SILK_NOTE}`,
    attributes: { Fabric: "Pure mulberry silk", Zari: "Pure zari", Weave: "Half-and-half brocade", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean only" },
    ...single(19_900, 21_000, 2),
  },
  {
    name: "Arani silk saree, wine with gold border",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-ARW",
    photo: 17040977,
    tags: ["silk", "festive"],
    description: `Pure silk from the looms of Arani near Tiruvannamalai: lighter than a Kanchipuram, with a wine body and a plain gold zari border. A first pure-silk saree that won't break the budget.${SILK_NOTE.replace("woven on a pit loom in Kanchipuram", "woven in Arani")}`,
    attributes: { Fabric: "Pure silk", Zari: "Half-fine zari", Weave: "Plain body, zari border", Length: "6.3 m with blouse", Origin: "Arani", Care: "Dry-clean only" },
    ...single(8_900, 9_500, 4),
  },

  // ---- soft silk (HSN 5007, 5%)
  {
    name: "Soft silk saree with zari border",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-SSZ",
    photo: 27575104,
    tags: ["soft-silk", "silk", "festive", "bestseller"],
    description: "Feather-light soft silk that drapes like chiffon, with a woven zari border and pallu. Easy to carry all day: office functions, poojas and weddings in summer.\n\n6.3 m with blouse piece. Dry-clean the first time; after that a gentle cold hand wash is fine.",
    attributes: { Fabric: "Soft silk", Zari: "Tested zari", Weight: "About 550 g", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean first" },
    ...one("Colour", [
      ["Magenta", 9_800, 10_500, 3],
      ["Bottle green", 9_800, 10_500, 2],
      ["Mustard", 9_800, 10_500, 2],
    ]),
  },
  {
    name: "Soft silk saree, burnt orange",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-SSO",
    photo: 27575174,
    tags: ["soft-silk", "silk", "festive"],
    description: "Burnt-orange soft silk with a gold-zari body pattern and a heavy pallu. Bright for Deepavali and Pongal, light enough to wear for hours.\n\n6.3 m with blouse piece. Dry-clean the first time.",
    attributes: { Fabric: "Soft silk", Zari: "Tested zari", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean first" },
    ...single(10_500, 10_500, 3),
  },
  {
    name: "Soft silk saree, coral with zari buttas",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-SSC",
    photo: 28943531,
    tags: ["soft-silk", "silk"],
    description: "Coral soft silk scattered with small zari buttas and a slim border. Pairs with a gold or a contrast green blouse.\n\n6.3 m with blouse piece. Dry-clean the first time.",
    attributes: { Fabric: "Soft silk", Zari: "Tested zari", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean first" },
    ...single(8_600, 9_200, 4),
  },
  {
    name: "Soft silk saree, tangerine",
    category: SAREES,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-SST",
    photo: 28943474,
    tags: ["soft-silk", "silk", "festive"],
    description: "Tangerine soft silk with a tone-on-tone zari weave, a muted gold border and a plain blouse piece in the same colour.\n\n6.3 m with blouse piece. Dry-clean the first time.",
    attributes: { Fabric: "Soft silk", Zari: "Tested zari", Length: "6.3 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean first" },
    ...single(8_200, 8_200, 3),
  },

  // ---- silk-cotton, cottons and linen (HSN 5212 / 5208 / 5309, 5%)
  {
    name: "Kanchi silk-cotton saree, ivory with green border",
    category: SAREES,
    hsn: "5212",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-SCG",
    photo: 28054616,
    tags: ["cotton", "silk-cotton", "handloom", "bestseller"],
    description: `Silk warp, cotton weft: the sheen of silk with the comfort of cotton. An ivory body with a broad green-and-gold border, woven in Kanchipuram for daily office wear and temple visits.\n\n6.2 m with blouse piece. Dry-clean or a gentle cold hand wash.`,
    attributes: { Fabric: "Silk-cotton", Weave: "Handloom", Length: "6.2 m with blouse", Origin: "Kanchipuram", Care: "Dry-clean or gentle hand wash" },
    ...single(3_400, 3_600, 6),
  },
  {
    name: "Chettinad cotton saree, checked",
    category: SAREES,
    hsn: "5208",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-CCH",
    photo: 5704311,
    tags: ["cotton", "handloom", "bestseller"],
    description: `The Karaikudi classic: bold checks in strong colours with a thread-woven border and a contrast pallu, woven on handlooms around Chettinad. Thick, breathable and crisp after starch.${COTTON_NOTE}`,
    attributes: { Fabric: "Handloom cotton", Pattern: "Checks", Length: "5.5 m", Origin: "Chettinad", Care: "Hand wash, dry in shade" },
    ...one("Colour", [
      ["Red & mustard", 1_650, 1_750, 8],
      ["Black & white", 1_650, 1_750, 6],
      ["Green & pink", 1_650, 1_750, 5],
    ]),
  },
  {
    name: "Kovai cotton saree, natural with mustard border",
    category: SAREES,
    hsn: "5208",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KOV",
    photo: 19664431,
    tags: ["cotton", "handloom"],
    description: `Fine Coimbatore (Kovai) cotton in an unbleached natural body with a mustard-and-maroon temple border: soft from the first wear, cool in May.${COTTON_NOTE}`,
    attributes: { Fabric: "Kovai cotton", Pattern: "Temple border", Length: "5.5 m", Origin: "Coimbatore", Care: "Hand wash, dry in shade" },
    ...single(1_350, 1_450, 12),
  },
  {
    name: "Madurai Sungudi cotton saree",
    category: SAREES,
    hsn: "5208",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-SUN",
    photo: 33306338,
    tags: ["cotton", "handloom", "festive"],
    description: `Sungudi, the Saurashtra tie-and-dye of Madurai: thousands of dots knotted by hand before dyeing, on soft mill cotton with a woven border. Geographical Indication registered craft.${COTTON_NOTE}`,
    attributes: { Fabric: "Cotton", Pattern: "Hand tie-dye dots", Length: "5.5 m", Origin: "Madurai", Care: "Wash separately the first time" },
    ...one("Colour", [
      ["White & red", 1_150, 1_250, 10],
      ["Maroon", 1_150, 1_250, 8],
      ["Mustard", 1_150, 1_250, 6],
    ]),
  },
  {
    name: "Hand-block printed mul cotton saree, red",
    category: SAREES,
    hsn: "5208",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-HBP",
    photo: 36955984,
    tags: ["cotton"],
    description: `Feather-soft mul cotton printed by hand with wooden blocks in a vine pattern, with a printed border and pallu. The everyday saree you reach for first.${COTTON_NOTE}`,
    attributes: { Fabric: "Mul cotton", Pattern: "Hand-block print", Length: "5.5 m", Care: "Hand wash cold" },
    ...single(1_450, 1_450, 10),
  },
  {
    name: "Mul cotton saree, sunflower yellow",
    category: SAREES,
    hsn: "5208",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-MUL",
    photo: 40290263,
    tags: ["cotton"],
    description: `Plain sunflower-yellow mul cotton with a thin red border: light, quick to dry and lovely with a printed blouse.${COTTON_NOTE}`,
    attributes: { Fabric: "Mul cotton", Pattern: "Plain, thin border", Length: "5.5 m", Care: "Hand wash cold" },
    ...single(950, 1_050, 15),
  },
  {
    name: "Linen saree, ivory with silver border",
    category: SAREES,
    hsn: "5309",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-LIV",
    photo: 26078981,
    tags: ["linen", "festive"],
    description: `Pure linen in natural ivory with a fine silver-zari border and tassels on the pallu. Crisp, cool and elegant for summer weddings.${LINEN_NOTE}`,
    attributes: { Fabric: "Pure linen", Zari: "Silver tissue border", Length: "6.2 m with blouse", Care: "Hand wash cold" },
    ...single(3_200, 3_400, 6),
  },
  {
    name: "Linen saree, solid colour",
    category: SAREES,
    hsn: "5309",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-LSC",
    photo: 29286334,
    tags: ["linen"],
    description: `Solid-colour pure linen with a self border, in three soft colours. Looks pressed even after a long day at work.${LINEN_NOTE}`,
    attributes: { Fabric: "Pure linen", Pattern: "Solid, self border", Length: "6.2 m with blouse", Care: "Hand wash cold" },
    ...one("Colour", [
      ["Lavender", 2_850, 2_850, 6],
      ["Sage", 2_850, 2_850, 5],
      ["Powder blue", 2_850, 2_850, 4],
    ]),
  },
  {
    name: "Linen saree, peach",
    category: SAREES,
    hsn: "5309",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-LPE",
    photo: 40407305,
    tags: ["linen"],
    description: `Peach linen with a zari-stripe pallu: a gentle colour for day functions and baby showers.${LINEN_NOTE}`,
    attributes: { Fabric: "Pure linen", Pattern: "Zari-stripe pallu", Length: "6.2 m with blouse", Care: "Hand wash cold" },
    ...single(2_650, 2_850, 7),
  },
  {
    name: "Printed linen saree, watercolour florals",
    category: SAREES,
    hsn: "5309",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-LFL",
    photo: 27918889,
    tags: ["linen"],
    description: `Pure linen digitally printed with watercolour flowers on a cream ground, with a yellow border. Light and cheerful for brunches and daytime functions.${LINEN_NOTE}`,
    attributes: { Fabric: "Pure linen", Pattern: "Floral print", Length: "6.2 m with blouse", Care: "Hand wash cold" },
    ...single(3_450, 3_450, 5),
  },

  // ---- ready-made blouses (HSN 6206: 5% up to ₹2,500 a piece, 18% above)
  {
    name: "Zardosi bridal blouse, gold",
    category: BLOUSES,
    hsn: "6206",
    gstRate: 18,
    unit: "pcs",
    sku: "TS-BZG",
    photo: 15226363,
    tags: ["wedding", "blouse"],
    description: "Raw silk blouse worked by hand with zardosi, beads and sequins in gold, with three-quarter sleeves, a padded front and a back hook opening. Finished with 1.5-inch margins so we can fit it to you in a day.\n\nAbove ₹2,500 a piece, so GST is 18% (included).",
    attributes: { Fabric: "Raw silk, lined", Work: "Hand zardosi, beads, sequins", Sleeve: "Three-quarter", Opening: "Back hooks", Care: "Dry-clean only" },
    ...sized(BLOUSE_SIZES, 4_200, 4_200, [1, 2, 3, 3, 2, 1]),
  },
  {
    name: "Raw silk blouse with scalloped sleeves",
    category: BLOUSES,
    hsn: "6206",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-BRS",
    photo: 35399675,
    tags: ["blouse", "bestseller"],
    description: "A solid raw-silk blouse with a sweetheart neck and short scalloped sleeves, lined, with front hooks and 1-inch margins. The easy partner for any silk saree.",
    attributes: { Fabric: "Raw silk, cotton lining", Neck: "Sweetheart", Sleeve: "Short, scalloped", Opening: "Front hooks", Care: "Dry-clean" },
    ...grid(["Colour", ["Maroon", "Bottle green", "Mustard"]], ["Size", BLOUSE_SIZES], 1_650, 1_750, midStock),
  },
  {
    name: "Cotton blouse with deep back and tie",
    category: BLOUSES,
    hsn: "6206",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-BCT",
    photo: 29172767,
    tags: ["blouse"],
    description: "Black handloom cotton blouse with a deep back, a tasselled tie and front hooks. Goes with every cotton and linen saree in the shop.",
    attributes: { Fabric: "Handloom cotton, lined", Neck: "Deep back with tie", Sleeve: "Short", Opening: "Front hooks", Care: "Hand wash cold" },
    ...sized(BLOUSE_SIZES, 1_150, 1_250),
  },
  {
    name: "Silk blouse with lace-up back",
    category: BLOUSES,
    hsn: "6206",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-BLU",
    photo: 38995453,
    tags: ["blouse", "festive"],
    description: "Art-silk blouse with a criss-cross lace-up back and elbow sleeves, made to wear with Kerala-style and gold-border sarees. Adjustable at the back by a size either way.",
    attributes: { Fabric: "Art silk, lined", Back: "Lace-up", Sleeve: "Elbow", Opening: "Front hooks", Care: "Dry-clean" },
    ...grid(["Colour", ["Bottle green", "Maroon"]], ["Size", BLOUSE_SIZES], 1_950, 1_950, midStock),
  },

  // ---- kurtis (HSN 6204, 5% up to ₹2,500)
  {
    name: "Chikankari cotton kurti",
    category: KURTIS,
    hsn: "6204",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KCH",
    photo: 28512776,
    tags: ["kurti", "bestseller"],
    description: "Straight cotton kurti with fine hand chikankari on the yoke and sleeves, a round neck and side slits. Knee length; wears well with palazzos or leggings.",
    attributes: { Fabric: "Cotton", Work: "Hand chikankari", Length: "Knee (44 in)", Fit: "Straight", Care: "Hand wash cold" },
    ...grid(["Colour", ["White", "Pistachio"]], ["Size", KURTI_SIZES], 1_450, 1_600, midStock),
  },
  {
    name: "Embroidered cotton kurti, yellow",
    category: KURTIS,
    hsn: "6204",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KEY",
    photo: 8770996,
    tags: ["kurti", "festive"],
    description: "Sunny yellow cotton kurti with thread embroidery down the placket, three-quarter sleeves and a flared hem. Festive enough for a temple visit, light enough for every day.",
    attributes: { Fabric: "Cotton", Work: "Thread embroidery", Length: "Calf (46 in)", Fit: "A-line", Care: "Hand wash cold" },
    ...sized(KURTI_SIZES, 1_850, 1_950),
  },
  {
    name: "Floral print cotton kurti",
    category: KURTIS,
    hsn: "6204",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KFP",
    photo: 35504998,
    tags: ["kurti"],
    description: "Soft cotton kurti in a teal-and-cream floral print with striped sleeves and a notched neck. Hip length, for jeans and office days.",
    attributes: { Fabric: "Cotton", Pattern: "Floral print", Length: "Hip (36 in)", Fit: "Straight", Care: "Machine wash gentle" },
    ...sized(KURTI_SIZES, 890, 990),
  },
  {
    name: "Geometric print kurti, rose",
    category: KURTIS,
    hsn: "6204",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KGR",
    photo: 37738043,
    tags: ["kurti"],
    description: "Rose cotton-rayon kurti with a diamond print, a mandarin collar and a front placket. Falls straight and doesn't crush.",
    attributes: { Fabric: "Cotton-rayon", Pattern: "Geometric print", Length: "Knee (42 in)", Fit: "Straight", Care: "Machine wash gentle" },
    ...sized(KURTI_SIZES, 1_050, 1_150),
  },
  {
    name: "Indigo hand-block print kurti",
    category: KURTIS,
    hsn: "6204",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-KIN",
    photo: 39287860,
    tags: ["kurti", "handloom"],
    description: "Natural-indigo cotton kurti printed by hand with wooden blocks, with a V-neck, side pockets and three-quarter sleeves. Each piece varies a little.",
    attributes: { Fabric: "Cotton, natural indigo", Pattern: "Hand-block print", Length: "Hip (38 in)", Fit: "Relaxed", Care: "Wash separately, cold" },
    ...sized(KURTI_SIZES, 1_190, 1_190),
  },

  // ---- dupattas (HSN 6214, 5% up to ₹2,500, 18% above)
  {
    name: "Silk dupatta with zari stripes, bottle green",
    category: DUPATTAS,
    hsn: "6214",
    gstRate: 18,
    unit: "pcs",
    sku: "TS-DSG",
    photo: 13584942,
    tags: ["dupatta", "festive", "wedding"],
    description: "A bottle-green Kanchi silk dupatta with diagonal zari stripes and a zari border, 2.4 m long. Lifts a plain salwar or a lehenga for weddings.\n\nAbove ₹2,500 a piece, so GST is 18% (included).",
    attributes: { Fabric: "Silk", Zari: "Tested zari stripes", Size: "2.4 m × 1 m", Care: "Dry-clean only" },
    ...single(3_400, 3_400, 4),
  },
  {
    name: "Organza floral dupatta",
    category: DUPATTAS,
    hsn: "6214",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-DOF",
    photo: 13584937,
    tags: ["dupatta"],
    description: "Sheer organza dupatta printed with flowers and finished with a thin gota edge. Drapes with a light crisp fall.",
    attributes: { Fabric: "Organza", Pattern: "Floral print", Size: "2.25 m × 1 m", Care: "Dry-clean" },
    ...one("Colour", [
      ["Yellow", 1_250, 1_350, 8],
      ["Peach", 1_250, 1_350, 6],
    ]),
  },
  {
    name: "Chiffon dupatta, royal blue",
    category: DUPATTAS,
    hsn: "6214",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-DCB",
    photo: 13584972,
    tags: ["dupatta"],
    description: "Soft royal-blue chiffon with a self print and a fine lace border: a colour that goes with pastels and whites.",
    attributes: { Fabric: "Chiffon", Size: "2.25 m × 1 m", Care: "Hand wash cold" },
    ...single(690, 790, 12),
  },
  {
    name: "Leheriya chiffon dupatta, coral",
    category: DUPATTAS,
    hsn: "6214",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-DLC",
    photo: 13584931,
    tags: ["dupatta"],
    description: "Coral chiffon in leheriya waves, the wave tie-dye of Rajasthan, with a narrow gota edge.",
    attributes: { Fabric: "Chiffon", Pattern: "Leheriya tie-dye", Size: "2.25 m × 1 m", Care: "Dry-clean the first time" },
    ...single(850, 950, 10),
  },

  // ---- men (veshti: woven lengths, 5208 / 5007 at 5%; shirts and kurtas 6205: 5% up to ₹2,500)
  {
    name: "Pure silk veshti with gold zari border",
    category: MEN,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-MSV",
    photo: 7669970,
    tags: ["men", "wedding", "silk"],
    description: "Cream pure-silk veshti with a 1-inch gold zari border, woven in Kanchipuram for the groom and the family. Comes with a matching angavastram (shoulder cloth).",
    attributes: { Fabric: "Pure silk", Zari: "1-inch pure zari border", Includes: "Angavastram", Origin: "Kanchipuram", Care: "Dry-clean only" },
    ...one("Size", [
      ["Single (2 m)", 2_950, 2_950, 5],
      ["Double (4 m)", 4_900, 4_900, 3],
    ]),
  },
  {
    name: "Cotton veshti with gold border",
    category: MEN,
    hsn: "5208",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-MCV",
    photo: 33800060,
    tags: ["men", "cotton", "bestseller"],
    description: "Soft white cotton veshti with a slim gold border, for poojas, festivals and Fridays at the office.",
    attributes: { Fabric: "Fine cotton", Border: "½-inch gold border", Care: "Hand wash" },
    ...one("Size", [
      ["Single (2 m)", 650, 690, 20],
      ["Double (4 m)", 1_150, 1_250, 12],
    ]),
  },
  {
    name: "Silk-cotton festive shirt, cream",
    category: MEN,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-MSS",
    photo: 7669972,
    tags: ["men", "festive"],
    description: "Full-sleeve cream shirt in silk-cotton with a soft sheen, cut to go with a silk veshti. Matches the veshti in the same cream.",
    attributes: { Fabric: "Silk-cotton", Fit: "Regular", Sleeve: "Full", Care: "Dry-clean or gentle wash" },
    ...sized(["38", "40", "42", "44"], 1_850, 1_950, [4, 6, 6, 3]),
  },
  {
    name: "Linen kurta, white",
    category: MEN,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "TS-MLK",
    photo: 37045884,
    tags: ["men", "linen"],
    description: "White linen kurta with a mandarin collar and a half placket, mid-thigh length. Cool for summer weddings with a veshti or trousers.",
    attributes: { Fabric: "Linen", Fit: "Regular", Length: "Mid-thigh", Care: "Hand wash cold" },
    ...sized(["S", "M", "L", "XL"], 2_200, 2_400, [3, 5, 5, 3]),
  },

  // ---- kids (girls' pavadai sets 6204, boys' sets 6203: 5% up to ₹2,500, 18% above)
  {
    name: "Girls' pattu pavadai set, cream and gold",
    category: KIDS,
    hsn: "6204",
    gstRate: 5,
    unit: "set",
    sku: "TS-KPC",
    photo: 13594700,
    tags: ["kids", "festive"],
    description: "Pavadai and puff-sleeve blouse in cream art silk with a gold zari border: Onam, Pongal and temple days. Elastic and tie-back waist so it fits for two seasons.",
    attributes: { Fabric: "Art silk, cotton lining", Set: "Pavadai + blouse", Care: "Dry-clean or gentle hand wash" },
    ...one("Age", KID_AGES.map((a, i) => [a, 2_400, 2_500, [3, 4, 4, 2][i]!] as [string, number, number, number])),
  },
  {
    name: "Girls' silk pavadai set, orange",
    category: KIDS,
    hsn: "6204",
    gstRate: 5,
    unit: "set",
    sku: "TS-KPO",
    photo: 9323161,
    tags: ["kids"],
    description: "Bright orange silk-blend pavadai with a contrast stripe border and a matching crop blouse.",
    attributes: { Fabric: "Silk blend", Set: "Pavadai + blouse", Care: "Gentle hand wash" },
    ...one("Age", KID_AGES.map((a, i) => [a, 1_950, 2_100, [3, 5, 4, 2][i]!] as [string, number, number, number])),
  },
  {
    name: "Girls' zari pattu pavadai set, green and orange",
    category: KIDS,
    hsn: "6204",
    gstRate: 18,
    unit: "set",
    sku: "TS-KPZ",
    photo: 12100636,
    tags: ["kids", "wedding", "festive"],
    description: "A pure-silk pavadai woven with zari buttas, an orange body and a green blouse with a zari border, for weddings and the first day at a new school.\n\nAbove ₹2,500 a set, so GST is 18% (included).",
    attributes: { Fabric: "Pure silk, cotton lining", Set: "Pavadai + blouse", Care: "Dry-clean only" },
    ...one("Age", KID_AGES.map((a, i) => [a, 3_400, 3_400, [2, 3, 3, 1][i]!] as [string, number, number, number])),
  },
  {
    name: "Boys' veshti and shirt set",
    category: KIDS,
    hsn: "6203",
    gstRate: 5,
    unit: "set",
    sku: "TS-KBV",
    photo: 17781078,
    tags: ["kids", "festive"],
    description: "A ready-to-wear velcro veshti with a gold border and a half-sleeve shirt, for little boys who won't keep a veshti tied.",
    attributes: { Fabric: "Cotton", Set: "Velcro veshti + shirt", Care: "Machine wash gentle" },
    ...grid(["Shirt", ["Black", "Cream"]], ["Age", KID_AGES], 890, 990, (_c, a) => (a === "2–3 years" || a === "4–5 years" ? 6 : 4)),
  },

  // ---- accessories (potli bag 4202 22: 18%; saree storage bags 6307: 5%)
  {
    name: "Mirror-work potli bag",
    category: ACCESSORIES,
    hsn: "4202",
    gstRate: 18,
    unit: "pcs",
    sku: "TS-APB",
    photo: 10500964,
    tags: ["accessory", "festive"],
    description: "A drawstring potli in embroidered cotton with mirror work and a tassel, big enough for a phone, keys and flowers for the hair. Handmade, so each one differs.",
    attributes: { Material: "Cotton, mirror work", Size: "8 × 10 in", Closure: "Drawstring" },
    ...single(750, 850, 15),
  },
  {
    name: "Cotton saree storage bags (set of 3)",
    category: ACCESSORIES,
    hsn: "6307",
    gstRate: 5,
    unit: "set",
    sku: "TS-ASB",
    photo: 3850532,
    tags: ["accessory"],
    description: "Unbleached cotton drawstring bags sized for a folded silk saree. Silk needs to breathe: keep it in cotton, never plastic, and refold every three months so the zari doesn't crack.",
    attributes: { Material: "Cotton", Size: "16 × 18 in", Pieces: "3" },
    ...single(450, 450, 25),
  },
];

/** "Office & every day" for the home's saree finder (wedding and festive are tagged above); existing shops get it from the relayout tag step. */
const EVERYDAY = ["cotton", "linen", "kurti", "silk-cotton"];
for (const p of PRODUCTS) if (p.category !== MEN && p.tags?.some((t) => EVERYDAY.includes(t))) p.tags = [...p.tags, "everyday"];

/** Pexels photos used by the store (credited on /pages/photo-credits). */
const PHOTOS: DemoStore["photos"] = {
  9419023: { by: "Abhishek Kumar", alt: "Mango yellow silk saree with a pink border" },
  37602134: { by: "upender photography", alt: "Bride in a green silk saree with a red border" },
  35108765: { by: "Milton Das", alt: "Peacock blue silk saree with copper zari" },
  35108768: { by: "Milton Das", alt: "Rose and mint half-and-half silk saree" },
  37054318: { by: "Satyam Pixels", alt: "Ivory and gold tissue silk saree" },
  35108864: { by: "Milton Das", alt: "Lavender silk saree with silver zari" },
  35108775: { by: "Milton Das", alt: "Ink blue silk saree with a red border" },
  35108861: { by: "Milton Das", alt: "Gold and sky blue half-and-half silk saree" },
  17040977: { by: "BM Capture", alt: "Wine silk saree with a gold border" },
  27575104: { by: "Pexels User", alt: "Magenta soft silk saree with zari" },
  27575174: { by: "Pexels User", alt: "Burnt orange soft silk saree" },
  28943531: { by: "Manish Jangid", alt: "Coral soft silk saree with zari buttas" },
  28943474: { by: "Manish Jangid", alt: "Tangerine soft silk saree" },
  28054616: { by: "Bhoopal M", alt: "Ivory silk-cotton saree with a green border" },
  5704311: { by: "Atul Choudhary", alt: "Red and mustard checked cotton saree" },
  19664431: { by: "Rakesh Mondal", alt: "Natural cotton saree with a mustard border" },
  33306338: { by: "Sourov sarker", alt: "White cotton saree with red dot motifs" },
  36955984: { by: "Nafi's Eye", alt: "Red hand-block printed cotton saree" },
  40290263: { by: "Capture Point", alt: "Sunflower yellow cotton saree" },
  26078981: { by: "Rajib Ahmed", alt: "Ivory linen saree with a silver border" },
  29286334: { by: "Sameer M. Nadkarni", alt: "Lavender linen saree" },
  40407305: { by: "Sourov sarker", alt: "Peach linen saree" },
  27918889: { by: "Kewal Nagda", alt: "Floral printed linen saree" },
  15226363: { by: "Umair Ali", alt: "Gold hand-embroidered blouse" },
  35399675: { by: "hitesh kasat", alt: "Maroon blouse with scalloped sleeves" },
  29172767: { by: "Kevin Shervin Mascarenhas", alt: "Black blouse with a deep back" },
  38995453: { by: "Prasun Barma", alt: "Green blouse with a lace-up back" },
  28512776: { by: "Neha Mishra", alt: "White chikankari kurti" },
  8770996: { by: "Gustavo Fring", alt: "Yellow embroidered cotton kurti" },
  35504998: { by: "Anil Sharma", alt: "Floral print cotton kurti" },
  37738043: { by: "HEMANT SAINI", alt: "Rose kurti with a geometric print" },
  39287860: { by: "Michael Takahashi", alt: "Indigo block-printed kurti" },
  13584942: { by: "Abdullah khan", alt: "Green dupatta with zari stripes" },
  13584937: { by: "Abdullah khan", alt: "Yellow floral organza dupatta" },
  13584972: { by: "Abdullah khan", alt: "Royal blue chiffon dupatta" },
  13584931: { by: "Abdullah khan", alt: "Coral leheriya dupatta" },
  7669970: { by: "Anoop VS", alt: "Cream silk veshti with a gold border" },
  33800060: { by: "Jibin Yesudasan", alt: "White cotton veshti with a black shirt" },
  7669972: { by: "Anoop VS", alt: "Cream festive shirt with a veshti" },
  37045884: { by: "Udith Babu K N", alt: "White linen kurta" },
  13594700: { by: "ABHIJITH TS", alt: "Girl in a cream and gold pavadai" },
  9323161: { by: "Sourabh Narwade", alt: "Girl in an orange silk pavadai" },
  12100636: { by: "Shilbhadra Bhattacharya", alt: "Girl in a green and orange pattu pavadai" },
  17781078: { by: "Arshid Yousaf", alt: "Little boy in a veshti and black shirt" },
  10500964: { by: "Farhan Imaan Abro", alt: "Embroidered mirror-work potli bags" },
  3850532: { by: "ready made", alt: "Cotton drawstring storage bags" },
  // categories, home and pages
  10317106: { by: "Sharath G.", alt: "A stack of folded Kanchipuram silk sarees" },
  38995450: { by: "Prasun Barma", alt: "Green blouse with an ivory and gold saree" },
  28512787: { by: "Neha Mishra", alt: "Pistachio chikankari kurti" },
  13584943: { by: "Abdullah khan", alt: "Floral dupatta over a red kurta" },
  7669969: { by: "Anoop VS", alt: "Man in a cream shirt and silk veshti" },
  13056399: { by: "Jithin murali", alt: "Girl in a pavadai in a green paddy field" },
  30495690: { by: "Vikash Pareek", alt: "Wall of embroidered handbags" },
  10317113: { by: "Sharath G.", alt: "Close-up of Kanchipuram silk with zari" },
  9345930: { by: "Rezoana Amin Rayna", alt: "Woman holding out the pallu of a pink silk saree" },
  10317127: { by: "Sharath G.", alt: "Folds of orange and violet Kanchipuram silk" },
  14695808: { by: "Narasimhan AVPL", alt: "Weaver's hands on a silk handloom" },
  39762863: { by: "Anjali ..", alt: "Weaver at a pit loom" },
  6167463: { by: "Atul Choudhary", alt: "Folded teal silk saree with gold paisleys" },
  39070874: { by: "Kizhakke Vdu", alt: "Folded ivory saree with a lavender border" },
  39866209: { by: "Binte Kashem Fabiha", alt: "Folded handloom cotton sarees" },
  27918892: { by: "Kewal Nagda", alt: "Close-up of a floral linen saree" },
  29226150: { by: "@Ali Photographer@", alt: "Bride in a silk saree at a pre-wedding ritual" },
  5447529: { by: "Atul Choudhary", alt: "Silk sarees with gold bangles" },
  8886933: { by: "Lara Jameson", alt: "Close-up of hand embroidery on red fabric" },
  35059564: { by: "Punam Oishy", alt: "Bridal jewellery on a red zari saree" },
  35007881: { by: "Rahul Pandit", alt: "Silk sarees around a festival lamp" },
};

const HOURS = [
  { label: "Every day", value: "10:00 am – 9:00 pm" },
  { label: "Bridal (by appointment)", value: "9:00 am – 10:00 am" },
];

const FAQ = [
  {
    q: "How do I know the zari is pure?",
    a: "Every Kanchipuram silk we sell carries the **Silk Mark** tag and a zari test report: pure zari is silver thread plated with gold. At home, scrape a little zari from the pallu end: pure zari shows a red silk core and silver under the gold; burn a thread of the body silk and it smells like burnt hair and turns to ash. Bring any saree back within a year and we test it in front of you.",
  },
  {
    q: "Can I return or exchange a saree?",
    a: "Unused sarees with the tag and blouse piece intact can be exchanged within **7 days**, or refunded if they reach you damaged. Stitched blouses, sarees with a stitched fall or blouse, and bridal sarees woven to order can't be returned.",
  },
  {
    q: "Do you stitch blouses?",
    a: "Yes. Send your measurements (or a blouse that fits) and the style; our tailors stitch in **5–7 days** from ₹850 (lined, with hooks). Zardosi and aari work take 2–3 weeks. Every ready-made blouse has margins so we can alter it free once.",
  },
  {
    q: "How should I care for a silk saree?",
    a: "Dry-clean only, at least for Kanchipuram silk. After wearing, air it in the shade before folding. Wrap it in a cotton cloth or our storage bag, never plastic, and refold it along new lines every three months so the zari doesn't crack. Keep naphthalene balls away from the zari.",
  },
  { q: "Do you ship outside Tamil Nadu?", a: "Yes, anywhere in India in 3–6 days, insured, with a tracking link. Kanchipuram and Chennai get next-day delivery. Silk sarees above ₹10,000 ship by insured courier at no charge." },
  { q: "Can I see sarees on a video call?", a: "Yes. Book a video call on WhatsApp and we show you sarees in daylight at the window, drape them and hold them against your blouse colour. Most of our brides shop this way." },
];

const FAQ_TA = [
  {
    q: "ஜரிகை சுத்தமானதா என்று எப்படித் தெரியும்?",
    a: "நாங்கள் விற்கும் ஒவ்வொரு காஞ்சிபுரம் பட்டுக்கும் **சில்க் மார்க்** அடையாளச் சீட்டும் ஜரிகைச் சோதனை அறிக்கையும் உண்டு: சுத்தமான ஜரிகை என்பது தங்க முலாம் பூசிய வெள்ளி இழை. வீட்டில், முந்தானை ஓரத்தில் சிறிது ஜரிகையைச் சுரண்டுங்கள்: உள்ளே சிவப்புப் பட்டு இழையும் தங்கத்தின் கீழ் வெள்ளியும் தெரியும்; உடல் பகுதியிலிருந்து ஒரு இழையை எரித்தால் முடி கருகிய வாசனையுடன் சாம்பலாகும். ஒரு வருடத்துக்குள் எந்தச் சேலையைக் கொண்டு வந்தாலும் உங்கள் முன்னே சோதித்துக் காட்டுவோம்.",
  },
  {
    q: "சேலையைத் திருப்பித் தரலாமா, மாற்றலாமா?",
    a: "பயன்படுத்தாத, அடையாளச் சீட்டும் ரவிக்கைத் துணியும் அப்படியே உள்ள சேலைகளை **7 நாட்களுக்குள்** மாற்றலாம்; சேதமாக வந்தால் பணம் திருப்பித் தருவோம். தைத்த ரவிக்கைகள், ஃபால் அல்லது ரவிக்கை தைத்த சேலைகள், ஆர்டரில் நெய்த திருமணச் சேலைகளைத் திருப்பித் தர இயலாது.",
  },
  {
    q: "ரவிக்கை தைத்துத் தருவீர்களா?",
    a: "ஆம். உங்கள் அளவுகளை (அல்லது சரியாகப் பொருந்தும் ஒரு ரவிக்கையை) அனுப்பி, டிசைனைச் சொல்லுங்கள்; எங்கள் தையல்காரர்கள் **5–7 நாளில்** ₹850 முதல் (லைனிங், ஹூக்குடன்) தைத்துத் தருவார்கள். ஜர்தோசி, ஆரி வேலைக்கு 2–3 வாரம். ஒவ்வொரு ரெடிமேட் ரவிக்கையிலும் மார்ஜின் உண்டு; ஒருமுறை இலவசமாகச் சரிசெய்வோம்.",
  },
  {
    q: "பட்டுச் சேலையை எப்படிப் பராமரிப்பது?",
    a: "குறிப்பாகக் காஞ்சிபுரம் பட்டுக்கு டிரை கிளீனிங் மட்டுமே. அணிந்த பிறகு நிழலில் காற்றாட விட்டு மடியுங்கள். பருத்தித் துணியில் அல்லது எங்கள் பையில் சுற்றி வையுங்கள், பிளாஸ்டிக்கில் வேண்டாம்; ஜரிகை உடையாமல் இருக்க மூன்று மாதத்துக்கு ஒருமுறை புதிய மடிப்பில் மடியுங்கள். ரசகற்பூர உருண்டைகளை ஜரிகையிலிருந்து தள்ளி வையுங்கள்.",
  },
  { q: "தமிழ்நாட்டுக்கு வெளியே அனுப்புவீர்களா?", a: "ஆம், இந்தியா முழுவதும் 3–6 நாளில், காப்பீட்டுடன், டிராக்கிங் இணைப்புடன். காஞ்சிபுரம், சென்னைக்கு மறுநாள் டெலிவரி. ₹10,000-க்கு மேற்பட்ட பட்டுச் சேலைகள் கட்டணமின்றி காப்பீட்டுக் கூரியரில்." },
  { q: "வீடியோ காலில் சேலைகளைப் பார்க்கலாமா?", a: "ஆம். வாட்ஸ்அப்பில் வீடியோ காலுக்கு நேரம் பதிவு செய்யுங்கள்; ஜன்னல் வெளிச்சத்தில் சேலைகளைக் காட்டி, உடுத்திக் காட்டி, உங்கள் ரவிக்கை நிறத்துடன் ஒப்பிட்டுக் காட்டுவோம். எங்கள் மணப்பெண்களில் பலர் இப்படித்தான் வாங்குகிறார்கள்." },
];

/** A shop-by-fabric tile's words in Tamil (typed as plain words, as store #2's `dish()`). */

const BRIDAL_TEXT = "Hello Thari Silks, I'd like a bridal appointment. Wedding date: … Visit or video call: … Colours I like: … Budget: …";
const STITCH_TEXT = "Hello Thari Silks, I'd like a blouse stitched. Style: … Size / measurements: … Needed by: …";

const SIZE_TABLE =
  "| Size | Bust (in) | Waist (in) | Shoulder (in) | Blouse length (in) |\n|---|---|---|---|---|\n| 32 | 32 | 27 | 13.5 | 14 |\n| 34 | 34 | 29 | 14 | 14.5 |\n| 36 | 36 | 31 | 14.5 | 15 |\n| 38 | 38 | 33 | 15 | 15 |\n| 40 | 40 | 35 | 15.5 | 15.5 |\n| 42 | 42 | 37 | 16 | 16 |";
const KURTI_TABLE =
  "| Size | Bust (in) | Waist (in) | Hip (in) | Shoulder (in) |\n|---|---|---|---|---|\n| S | 36 | 32 | 38 | 14 |\n| M | 38 | 34 | 40 | 14.5 |\n| L | 40 | 36 | 42 | 15 |\n| XL | 42 | 38 | 44 | 15.5 |\n| XXL | 44 | 40 | 46 | 16 |";

export const THARI: DemoStore = {
  shop: {
    slug: "thari",
    appId: "EC",
    businessType: "fashion",
    planId: "pro",
    name: "Thari Silks",
    primary: "#0b4a4f",
    billing: {
      legalName: "Thari Silks",
      gstin: "33AAOFT2468N1ZJ",
      address: "47, Gandhi Road, near Ekambareswarar Temple",
      city: "Kanchipuram",
      pincode: "631501",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "TS",
      upiId: "tharisilks@okaxis",
    },
    items: [
      { name: "Blouse stitching (lined, with hooks)", hsn: "998821", unit: "pcs", rate: 80_952, gstRate: 5 },
      { name: "Saree fall and pico", hsn: "998821", unit: "pcs", rate: 19_048, gstRate: 5 },
    ],
  },
  preset: "zari",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 1_000_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "hello@tharisilks.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/tharisilks" },
    policies: {
      shipping:
        "**Kanchipuram & Chennai (631xxx, 600xxx–603xxx):** next day by our own courier. ₹100 per order, free above ₹2,000.\n\n**Rest of Tamil Nadu:** 2–3 days by courier, ₹150, free above ₹3,000.\n\n**Rest of India:** 3–6 days by insured courier, ₹250, free above ₹5,000. Silk sarees go in a cotton bag inside a sealed box, insured for their full value.",
      returns:
        "Unused sarees, kurtis and dupattas with tags and blouse piece intact can be exchanged within 7 days of delivery. If anything arrives damaged or not as described, send a photo on WhatsApp within 48 hours and we replace it or refund in full. Stitched blouses, altered pieces, sarees with a stitched fall and bridal sarees woven to order can't be returned.",
      privacy: "We use your details only to deliver your order, send your GST bill and, if you ask, keep your blouse measurements on file.",
      terms:
        "Prices include GST. Handwoven sarees vary a little in colour and weave from the pictures; we describe any flaw before you buy. Pure silk and zari are certified (Silk Mark and zari test report) and we buy back any saree that fails a test.",
    },
    businessType: "fashion",
  },
  zones: [
    {
      name: "Kanchipuram & Chennai",
      pincodePrefixes: ["631", "600", "601", "602", "603"],
      rate: { name: "Next-day delivery", type: "free_above", amount: 10_000, freeAbove: 200_000, etaMinDays: 1, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–3 days)", type: "free_above", amount: 15_000, freeAbove: 300_000, etaMinDays: 2, etaMaxDays: 3, codAllowed: true, codFee: 5_000 },
    },
    {
      name: "Rest of India",
      states: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "26", "27", "29", "30", "31", "32", "34", "35", "36", "37", "38"],
      rate: { name: "Insured courier (3–6 days)", type: "free_above", amount: 25_000, freeAbove: 500_000, etaMinDays: 3, etaMaxDays: 6, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: SAREES, description: "Kanchipuram and Arani silks, soft silks, Chettinad and Kovai cottons, Madurai Sungudi and pure linen.", photo: 10317106 },
    { name: BLOUSES, description: "Ready-made blouses in sizes 32–42 with margins for a free alteration, from raw silk to bridal zardosi.", photo: 38995450 },
    { name: KURTIS, description: "Chikankari, hand-block and printed cotton kurtis in sizes S–XXL.", photo: 28512787 },
    { name: DUPATTAS, description: "Silk, organza and chiffon dupattas to lift a plain salwar or a lehenga.", photo: 13584943 },
    { name: MEN, description: "Silk and cotton veshtis with zari borders, festive shirts and linen kurtas.", photo: 7669969 },
    { name: KIDS, description: "Pattu pavadai sets for girls and veshti sets for boys, by age.", photo: 13056399 },
    { name: ACCESSORIES, description: "Potli bags and cotton storage bags that keep your silks breathing.", photo: 30495690 },
  ],
  // Apparel / footwear: GST by price band (5% up to ₹2,500 a piece, 18% above).
  products: withPriceBandGst(PRODUCTS),
  collections: [
    { name: "New arrivals", slug: "new-arrivals", description: "Fresh off the looms this month.", rule: { sort: "new" } },
    { name: "Kanchipuram silk", slug: "kanchipuram-silk", description: "Pure mulberry silk with pure zari, woven on pit looms in Kanchipuram. Silk Mark certified.", rule: { tag: "kanchipuram", sort: "price-desc" } },
    { name: "Soft silk", slug: "soft-silk", description: "Feather-light silks you can wear all day.", rule: { tag: "soft-silk", sort: "price-asc" } },
    { name: "Handloom cotton", slug: "handloom-cotton", description: "Chettinad checks, Kovai cotton, Madurai Sungudi and silk-cotton from Tamil Nadu looms.", rule: { tag: "cotton", sort: "price-asc" } },
    { name: "Linen", slug: "linen", description: "Pure linen sarees and kurtas, crisp and cool.", rule: { tag: "linen", sort: "price-asc" } },
    { name: "The wedding collection", slug: "wedding", description: "Muhurtham silks, bridal blouses, veshtis and pavadais for the whole family.", rule: { tag: "wedding", sort: "price-desc" } },
    { name: "The festive edit", slug: "festive-edit", description: "Silks, cottons and kurtis for Deepavali, Pongal and the wedding season.", rule: { tag: "festive", sort: "new" } },
    { name: "Bestsellers", slug: "bestsellers", description: "The sarees and blouses our customers come back for.", rule: { tag: "bestseller", sort: "price-desc" } },
    { name: "On offer", slug: "on-offer", description: "Pieces below their tag price right now.", rule: { onSale: true, sort: "price-asc" } },
    { name: "Ready-made blouses", slug: "ready-blouses", description: "Blouses in sizes 32–42 with margins for a free alteration.", rule: { category: BLOUSES, sort: "price-asc" } },
  ],
  coupons: [
    {
      code: "PATTU5",
      description: "5% off orders above ₹10,000 (up to ₹1,500)",
      type: "percent",
      value: 5,
      minOrder: 1_000_000,
      maxDiscount: 150_000,
      channels: ["store", "manual"],
    },
  ],
  home: ({ photo, category, product }) => {
    const sarees = category(SAREES);
    const reel = (title: string, text: string, id: number, href: string, ctaLabel: string) => ({ title, text, imageUrl: photo(id, "tile"), href, ctaLabel });
    return {
      seo: {
        title: "Thari Silks, Kanchipuram — Kanchipuram silk and handloom sarees",
        description: "Silk Mark certified Kanchipuram silk sarees with pure zari, soft silks, Chettinad and Kovai cottons, Sungudi and linen. Bridal appointments, blouse stitching, delivery across India.",
        imageUrl: photo(10317113),
      },
      // Magazine layout (the look's page layout): numbered display headings, feature tiles in the product grids and an
      // editorial rhythm, so the home reads like a lookbook: the loom in reels, a saree picked in three questions, a look.
      sections: [
        {
          type: "hero",
          id: "th-hero",
          slides: [
            {
              imageUrl: photo(10317113),
              heading: "The wedding season collection",
              subheading: "New Kanchipuram silks off our looms: korvai borders, pure zari, Silk Mark certified.",
              cta: { label: "Explore the collection", href: "/collections/wedding" },
            },
            {
              imageUrl: photo(9345930),
              heading: "Woven for the muhurtham",
              subheading: "Book a bridal appointment at the shop or on a video call, and we bring out the sarees.",
              cta: { label: "Book an appointment", href: waLink(BRIDAL_TEXT) },
            },
            {
              imageUrl: photo(10317127),
              heading: "Soft silks for every day of the festival",
              subheading: "Light enough to wear from the morning pooja to the evening visit.",
              cta: { label: "Shop soft silk", href: "/collections/soft-silk" },
            },
          ],
        },
        {
          type: "stories",
          id: "th-reels",
          title: "On the loom this week",
          layout: "reels",
          items: [
            reel("The warp goes on", "Two weavers, one pit loom, three weeks for a Kanchipuram silk.", 14695808, "/pages/about", "Our story"),
            reel("Korvai, by hand", "Body and border woven apart and interlocked, so the border never comes loose.", 39762863, "/collections/kanchipuram-silk", "Kanchipuram silk"),
            reel("Pure zari", "Silver thread dipped in gold, tested and Silk Mark certified.", 6167463, "/collections/kanchipuram-silk", "Shop silk"),
            reel("Soft silk", "Festive, light, easy to carry through a long day.", 39070874, "/collections/soft-silk", "Shop soft silk"),
            reel("Handloom cotton", "Chettinad checks and Kovai cottons for every day.", 39866209, "/collections/handloom-cotton", "Shop cotton"),
            reel("Linen", "Watercolour florals that soften with every wash.", 27918892, "/collections/linen", "Shop linen"),
            reel("Hand embroidery", "Aari and zardosi blouses, fitted twice.", 8886933, "/collections/ready-blouses", "Blouses"),
            reel("The bridal look", "A red zari silk with temple jewellery.", 35059564, "/collections/wedding", "The wedding edit"),
          ],
        },
        {
          type: "finder",
          id: "th-finder",
          title: "Find your saree",
          text: "Three questions: the occasion, the weave, your budget. We bring out what fits, the way we would at the counter.",
          layout: "wizard",
          results: "button",
          buttonLabel: "Show my sarees",
          imageUrl: photo(5447529, "tile"),
          cta: { label: "Ask us on WhatsApp", href: waLink("Hello Thari Silks, I'm looking for a saree. Occasion: … Colours: … Budget: …") },
          questions: [
            {
              label: "What's the occasion?",
              options: [
                { label: "Wedding", tag: "wedding", imageUrl: photo(29226150, "tile") },
                { label: "Festival & pooja", tag: "festive", imageUrl: photo(35007881, "tile") },
                { label: "Office & every day", tag: "everyday", imageUrl: photo(39866209, "tile") },
              ],
            },
            {
              label: "Which weave?",
              options: [
                { label: "Kanchipuram silk", keywords: "Kanchipuram", categoryId: sarees },
                { label: "Soft silk", keywords: "soft silk", categoryId: sarees },
                { label: "Handloom cotton", keywords: "cotton", categoryId: sarees },
                { label: "Linen", keywords: "linen", categoryId: sarees },
              ],
            },
            {
              label: "Your budget?",
              options: [
                { label: "Under ₹3,000", priceMax: 300_000 },
                { label: "₹3,000 – ₹10,000", priceMin: 300_000, priceMax: 1_000_000 },
                { label: "₹10,000 – ₹25,000", priceMin: 1_000_000, priceMax: 2_500_000 },
                { label: "Above ₹25,000", priceMin: 2_500_000 },
              ],
            },
          ],
        },
        {
          type: "shop-the-look",
          id: "th-look",
          title: "Get the look: ivory, gold and a green blouse",
          text: "A Kanchipuram tissue silk with a silk blouse in bottle green. Tap a dot to see the piece.",
          imageUrl: photo(38995450),
          alt: "Green blouse with an ivory and gold saree",
          hotspots: [
            { x: 16, y: 20, productId: product("Silk blouse with lace-up back") },
            { x: 62, y: 78, productId: product("Kanchipuram tissue silk saree, ivory and gold") },
          ],
        },
        {
          type: "image-text",
          id: "th-heritage",
          imageUrl: photo(14695808, "tile"),
          imageSide: "left",
          heading: "Woven by hand in Kanchipuram, since 1962",
          markdown:
            "A Kanchipuram silk takes two weavers two to three weeks on a pit loom. The body and the border are woven separately and interlocked by hand (the **korvai**), so a contrast border never comes loose in fifty years.\n\nWe buy straight from **40 weaver families** in Kanchipuram, Arani and Chettinad, pay them before the saree is finished, and tell you whose loom your saree came from.",
          cta: { label: "Our story", href: "/pages/about" },
          style: { padding: "spacious" },
        },
        { type: "collection", id: "th-wedding", title: "The wedding collection", collectionSlug: "wedding", layout: "grid", limit: 5 },
        {
          type: "image-text",
          id: "th-bridal",
          imageUrl: photo(29226150, "tile"),
          imageSide: "left",
          heading: "The bridal appointment",
          markdown:
            "An hour with our bridal team, the muhurtham silks laid out in daylight, a cup of filter coffee and no hurry.\n\n- At the shop from **9 am**, or on a **video call**\n- Sarees woven to order in your colours in **three weeks**\n- Bridal blouses with zardosi and aari work, fitted twice",
          cta: { label: "Book on WhatsApp", href: waLink(BRIDAL_TEXT) },
          style: { background: "brand", span: "half" },
        },
        {
          type: "image-text",
          id: "th-stitching",
          imageUrl: photo(8886933, "tile"),
          imageSide: "right",
          heading: "Blouses that fit",
          markdown:
            "Ready-made blouses in sizes **32 to 42**, altered free once. Or let our tailors stitch your saree's blouse piece: lined and hooked from **₹850**, ready in **5–7 days**.",
          cta: { label: "See the size guide", href: "/pages/size-guide" },
          style: { background: "muted", span: "half" },
        },
        {
          type: "offer",
          id: "th-offer",
          eyebrow: "Wedding season",
          heading: "5% off silks above ₹10,000",
          text: "On any order above ₹10,000, up to ₹1,500 off. Use the code at checkout.",
          code: "PATTU5",
          cta: { label: "Shop Kanchipuram silk", href: "/collections/kanchipuram-silk" },
          style: { background: "image", imageUrl: photo(35007881), overlay: 55 },
        },
        {
          type: "testimonials",
          id: "th-testimonials",
          title: "Worn at their weddings",
          layout: "single",
          items: [
            { quote: "I chose my muhurtham saree on a video call from Pune. They showed me six greens in the morning light, sent the zari certificate, and the saree reached me insured in three days. Everyone asked where it was from.", name: "Divya Raghavan", role: "Bride, Pune", rating: 5 },
            { quote: "The blouse was stitched to my measurements in a week and fitted perfectly the first time. They even told me the name of the weaver who wove my saree.", name: "Meenakshi S.", role: "Kanchipuram", rating: 5 },
            { quote: "Chettinad cottons for office, a soft silk for my daughter's graduation and silk veshtis for my husband. Honest prices, no pressure and they explain every weave.", name: "Revathi Kumar", role: "Teacher, Chennai", rating: 5 },
          ],
        },
        { type: "faq", id: "th-faq", title: "Questions about silk", items: FAQ },
        {
          type: "location",
          id: "th-location",
          title: "Visit the boutique on Gandhi Road",
          address: "47, Gandhi Road, near Ekambareswarar Temple, Kanchipuram 631501",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "12.8389, 79.7049",
        },
      ],
      translations: {
        ta: {
          "th-hero": {
            slides: [
              {
                heading: "திருமணப் பருவத் தொகுப்பு",
                subheading: "எங்கள் தறிகளிலிருந்து புதிய காஞ்சிபுரம் பட்டுகள்: கொர்வை பார்டர், சுத்தமான ஜரிகை, சில்க் மார்க் சான்றிதழ்.",
                cta: { label: "தொகுப்பைப் பாருங்கள்" },
              },
              {
                heading: "முகூர்த்தத்துக்காக நெய்தது",
                subheading: "கடையிலோ வீடியோ காலிலோ மணப்பெண் சந்திப்புக்கு நேரம் பதிவு செய்யுங்கள்; சேலைகளை எடுத்துக் காட்டுவோம்.",
                cta: { label: "நேரம் பதிவு செய்" },
              },
              {
                heading: "பண்டிகை நாட்களுக்கு மென்பட்டு",
                subheading: "காலைப் பூஜை முதல் மாலை விசிட் வரை அணியும் அளவு லேசானது.",
                cta: { label: "மென்பட்டு" },
              },
            ],
          },
          "th-reels": {
            title: "இந்த வாரம் தறியில்",
            items: [
              { title: "பாவு ஏறுகிறது", text: "இரண்டு நெசவாளர்கள், ஒரு குழித் தறி, ஒரு காஞ்சிபுரம் பட்டுக்கு மூன்று வாரம்.", ctaLabel: "எங்கள் கதை" },
              { title: "கையால் கொர்வை", text: "உடலும் பார்டரும் தனியாக நெய்து பின்னப்படுகின்றன; பார்டர் ஒருபோதும் பிரியாது.", ctaLabel: "காஞ்சிபுரம் பட்டு" },
              { title: "சுத்த ஜரிகை", text: "தங்கத்தில் தோய்த்த வெள்ளி இழை, சோதித்து சில்க் மார்க் சான்றிதழுடன்.", ctaLabel: "பட்டு வாங்க" },
              { title: "மென்பட்டு", text: "பண்டிகைக்கு, லேசாக, நீண்ட நாளிலும் எளிதாக.", ctaLabel: "மென்பட்டு வாங்க" },
              { title: "கைத்தறிப் பருத்தி", text: "தினசரிக்குச் செட்டிநாடு கட்டங்கள், கோவைப் பருத்தி.", ctaLabel: "பருத்தி வாங்க" },
              { title: "லினன்", text: "ஒவ்வொரு துவைப்பிலும் மென்மையாகும் நீர்வண்ணப் பூக்கள்.", ctaLabel: "லினன் வாங்க" },
              { title: "கை எம்பிராய்டரி", text: "ஆரி, ஜர்தோசி ரவிக்கைகள், இருமுறை அளவு சரிபார்ப்பு.", ctaLabel: "ரவிக்கைகள்" },
              { title: "மணப்பெண் தோற்றம்", text: "கோயில் நகைகளுடன் சிவப்பு ஜரிகைப் பட்டு.", ctaLabel: "திருமணத் தொகுப்பு" },
            ],
          },
          "th-finder": {
            title: "உங்கள் சேலையைக் கண்டுபிடியுங்கள்",
            text: "மூன்று கேள்விகள்: நிகழ்ச்சி, நெசவு, உங்கள் பட்ஜெட். கவுண்டரில் செய்வது போலவே பொருந்துவதை எடுத்துக் காட்டுகிறோம்.",
            buttonLabel: "என் சேலைகளைக் காட்டு",
            cta: { label: "வாட்ஸ்அப்பில் கேளுங்கள்" },
            questions: [
              { label: "என்ன நிகழ்ச்சி?", options: [{ label: "திருமணம்" }, { label: "பண்டிகை, பூஜை" }, { label: "அலுவலகம், தினசரி" }] },
              { label: "எந்த நெசவு?", options: [{ label: "காஞ்சிபுரம் பட்டு" }, { label: "மென்பட்டு" }, { label: "கைத்தறிப் பருத்தி" }, { label: "லினன்" }] },
              { label: "உங்கள் பட்ஜெட்?", options: [{ label: "₹3,000-க்குள்" }, { label: "₹3,000 – ₹10,000" }, { label: "₹10,000 – ₹25,000" }, { label: "₹25,000-க்கு மேல்" }] },
            ],
          },
          "th-look": {
            title: "இந்தத் தோற்றம்: தந்தம், தங்கம், பச்சை ரவிக்கை",
            text: "பாட்டில் பச்சை பட்டு ரவிக்கையுடன் காஞ்சிபுரம் டிஷ்யூ பட்டு. ஒரு புள்ளியைத் தட்டிப் பாருங்கள்.",
            alt: "தந்தமும் தங்கமும் கலந்த சேலையுடன் பச்சை ரவிக்கை",
          },
          "th-heritage": {
            heading: "1962 முதல் காஞ்சிபுரத்தில் கையால் நெய்தவை",
            markdown:
              "ஒரு காஞ்சிபுரம் பட்டுச் சேலையை இரண்டு நெசவாளர்கள் குழித் தறியில் இரண்டு மூன்று வாரம் நெய்கிறார்கள். உடலும் பார்டரும் தனித்தனியாக நெய்யப்பட்டு கையால் பின்னப்படுகின்றன (**கொர்வை**); அதனால் மாறுபட்ட நிற பார்டர் ஐம்பது ஆண்டுகளிலும் பிரியாது.\n\nகாஞ்சிபுரம், ஆரணி, செட்டிநாட்டில் உள்ள **40 நெசவாளர் குடும்பங்களிடம்** நேரடியாக வாங்குகிறோம், சேலை முடியும் முன்பே பணம் தருகிறோம், உங்கள் சேலை யாருடைய தறியில் நெய்யப்பட்டது என்றும் சொல்கிறோம்.",
            cta: { label: "எங்கள் கதை" },
          },
          "th-wedding": { title: "திருமணத் தொகுப்பு" },
          "th-bridal": {
            heading: "மணப்பெண் சந்திப்பு",
            markdown:
              "எங்கள் மணப்பெண் குழுவுடன் ஒரு மணி நேரம்: பகல் வெளிச்சத்தில் விரித்த முகூர்த்தப் பட்டுகள், ஒரு கப் ஃபில்டர் காபி, அவசரமே இல்லை.\n\n- கடையில் **காலை 9 மணி** முதல், அல்லது **வீடியோ காலில்**\n- உங்கள் நிறங்களில் **மூன்று வாரத்தில்** ஆர்டரில் நெய்த சேலைகள்\n- ஜர்தோசி, ஆரி வேலைப்பாடுள்ள மணப்பெண் ரவிக்கைகள், இருமுறை அளவு சரிபார்ப்பு",
            cta: { label: "வாட்ஸ்அப்பில் பதிவு" },
          },
          "th-stitching": {
            heading: "பொருந்தும் ரவிக்கைகள்",
            markdown:
              "**32 முதல் 42** அளவுகளில் ரெடிமேட் ரவிக்கைகள், ஒருமுறை இலவசமாகச் சரிசெய்வோம். அல்லது உங்கள் சேலையின் ரவிக்கைத் துணியை எங்கள் தையல்காரர்கள் தைக்கட்டும்: லைனிங், ஹூக்குடன் **₹850** முதல், **5–7 நாளில்** தயார்.",
            cta: { label: "அளவு வழிகாட்டி" },
          },
          "th-offer": {
            eyebrow: "திருமணப் பருவம்",
            heading: "₹10,000-க்கு மேல் பட்டுக்கு 5% தள்ளுபடி",
            text: "₹10,000-க்கு மேற்பட்ட எந்த ஆர்டருக்கும், ₹1,500 வரை. செக்அவுட்டில் கோடைப் பயன்படுத்துங்கள்.",
            cta: { label: "காஞ்சிபுரம் பட்டு" },
          },
          "th-testimonials": {
            title: "அவர்கள் திருமணத்தில் அணிந்தவை",
            items: [
              { quote: "புனேவிலிருந்து வீடியோ காலில் என் முகூர்த்தச் சேலையைத் தேர்ந்தெடுத்தேன். காலை வெளிச்சத்தில் ஆறு பச்சை நிறங்களைக் காட்டி, ஜரிகைச் சான்றிதழை அனுப்பினார்கள்; மூன்று நாளில் காப்பீட்டுடன் சேலை வந்தது. எல்லோரும் எங்கே வாங்கினீர்கள் என்று கேட்டார்கள்.", role: "மணப்பெண், புனே" },
              { quote: "என் அளவுக்கு ஒரு வாரத்தில் ரவிக்கை தைத்து, முதல் முறையே கச்சிதமாகப் பொருந்தியது. என் சேலையை நெய்த நெசவாளரின் பெயரையும் சொன்னார்கள்.", role: "காஞ்சிபுரம்" },
              { quote: "அலுவலகத்துக்குச் செட்டிநாடு பருத்தி, மகளின் பட்டமளிப்புக்கு மென்பட்டு, கணவருக்குப் பட்டு வேட்டி. நியாயமான விலை, கட்டாயம் இல்லை, ஒவ்வொரு நெசவையும் விளக்குகிறார்கள்.", role: "ஆசிரியை, சென்னை" },
            ],
          },
          "th-faq": { title: "பட்டு பற்றிய கேள்விகள்", items: FAQ_TA },
          "th-location": {
            title: "காந்தி சாலையில் உள்ள பூட்டிக்குக்கு வாருங்கள்",
            address: "47, காந்தி சாலை, ஏகாம்பரேஸ்வரர் கோயில் அருகில், காஞ்சிபுரம் 631501",
            hours: [
              { label: "தினமும்", value: "காலை 10:00 – இரவு 9:00" },
              { label: "மணப்பெண் (முன்பதிவில்)", value: "காலை 9:00 – 10:00" },
            ],
          },
        },
      },
    };
  },
  pages: [
    {
      slug: "about",
      title: "Our story",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Thari Silks, Gandhi Road, since 1962" },
        {
          type: "paragraph",
          markdown:
            "Thari (தறி) is the Tamil word for the handloom. Our grandfather wove on one in Pillaiyarpalayam, Kanchipuram's weavers' quarter, before he opened a small shop on **Gandhi Road** to sell his own and his neighbours' sarees.\n\nThe third generation still buys the same way: straight from **40 weaver families** in Kanchipuram, Arani and around Chettinad, paying for the silk and zari up front so no weaver borrows to start a saree. Every Kanchipuram silk is Silk Mark certified and comes with its zari test report, and we can tell you whose loom it came off.",
        },
        { type: "image", url: photo(39762863, "tile"), alt: "Weaver at a pit loom" },
        {
          type: "paragraph",
          markdown: "Open every day, 10:00 am – 9:00 pm; bridal appointments from 9:00 am. Call or WhatsApp **+91 98765 00055**.",
        },
      ],
    },
    {
      slug: "size-guide",
      title: "Size guide & blouse stitching",
      blocks: () => [
        { type: "heading", level: 2, text: "Ready-made blouses (sizes 32–42)" },
        {
          type: "paragraph",
          markdown: `Measure over the fullest part of the bust with a soft tape, not too tight. Between two sizes? Take the bigger one: every blouse has 1–1.5 inch margins at the side seams and we alter it free once.\n\n${SIZE_TABLE}`,
        },
        { type: "heading", level: 2, text: "Kurtis (S–XXL)" },
        { type: "paragraph", markdown: `Garment measurements, with about 2 inches of ease over the body.\n\n${KURTI_TABLE}` },
        { type: "heading", level: 2, text: "Children's pavadai and veshti sets" },
        { type: "paragraph", markdown: "| Age | Height (in) | Pavadai length (in) |\n|---|---|---|\n| 2–3 years | 36 | 22 |\n| 4–5 years | 42 | 26 |\n| 6–7 years | 48 | 30 |\n| 8–9 years | 52 | 34 |\n\nWaists are elastic with a tie, so a set fits for two seasons." },
        { type: "heading", level: 2, text: "Blouse stitching" },
        {
          type: "paragraph",
          markdown:
            "1. **Send your measurements** (bust, waist, shoulder, blouse length, sleeve length and round, front and back neck depth) or post us a blouse that fits.\n2. **Choose the style:** neck, sleeve, back (hooks, zip, tie or lace-up), padding and lining.\n3. **We stitch in 5–7 days** from ₹850 (lined, hooks); princess cut ₹1,100; zardosi and aari work from ₹3,500 in 2–3 weeks.\n4. One free alteration within 30 days.",
        },
        { type: "button", label: "Send measurements on WhatsApp", href: waLink(STITCH_TEXT), style: "primary" },
      ],
    },
    {
      slug: "silk-care",
      title: "Silk care & the pure zari test",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "How to tell pure silk and pure zari" },
        {
          type: "paragraph",
          markdown:
            "- **Silk Mark:** the Silk Mark Organisation of India's tag on the saree, with a unique number.\n- **Burn test:** a thread from the body burns slowly, smells of burnt hair and leaves a crushable ash. Polyester melts into a hard bead.\n- **Zari test:** scrape the zari at the pallu end. Pure zari shows a red silk core wrapped in silver, gold plated on top; tested zari shows copper under the gold.\n- Ask for the **zari test report**: we give one with every Kanchipuram silk.",
        },
        { type: "image", url: photo(5447529, "tile"), alt: "Silk sarees with gold bangles" },
        { type: "heading", level: 2, text: "Caring for your silks" },
        {
          type: "paragraph",
          markdown:
            "- Dry-clean Kanchipuram silk; never machine wash or soak it.\n- Air it in the shade after wearing, then fold it with the zari inside.\n- Store in cotton, not plastic, and refold along new lines every three months so the zari doesn't crack.\n- Keep perfume, deodorant and naphthalene away from the zari: they tarnish it.\n- Iron on the reverse at a low silk setting, with a cotton cloth in between.",
        },
        { type: "faq", items: FAQ.slice(0, 4) },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' models, not our customers or staff.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(
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
      { label: "Kanchipuram silk", type: "collection", ref: "kanchipuram-silk" },
      { label: "Wedding", type: "collection", ref: "wedding" },
      { label: "Handloom cotton", type: "collection", ref: "handloom-cotton" },
      { label: "Blouses", type: "collection", ref: "ready-blouses" },
      { label: "Our story", type: "page", ref: "about" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Size guide & stitching", type: "page", ref: "size-guide" },
          { label: "Silk care & zari test", type: "page", ref: "silk-care" },
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Boutique",
        type: "url",
        children: [
          { label: "The wedding collection", type: "collection", ref: "wedding" },
          { label: "The festive edit", type: "collection", ref: "festive-edit" },
          { label: "Our story", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
