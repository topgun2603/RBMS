import { withPriceBandGst } from "./gst-band";
import type { DemoProduct, DemoStore } from "./types";

/**
 * Store #6 of the series: Arasan Menswear, Coimbatore (arasan.localhost:3003). A men's clothing and accessories store on
 * Cross Cut Road, Gandhipuram, on the online store app (EC) with the `fashion` trade (size guide on) and the "tailored"
 * look (deep navy on crisp white with a tan-leather surface, wide geometric capitals). Arasan (அரசன்) is Tamil for
 * king. Formal and casual shirts with sizes and fits, chinos and trousers by waist, jeans, T-shirts and polos, blazers
 * and winter wear, innerwear, ethnic wear (veshti, silk kurta, Nehru jacket) and every men's accessory in its own
 * category: belts, wallets, watches, sunglasses, ties, cufflinks, caps, socks, handkerchiefs, perfumes, grooming, bags,
 * key rings and umbrellas. Names are generic (no brands); prices are typical Coimbatore showroom prices in 2026, GST
 * included. Address, phone and GSTIN are placeholders like the other demo shops.
 *
 * GST (CGST notification 9/2025-Central Tax (Rate) of 17 Sept 2025, in force from 22 Sept 2025, which replaced
 * 1/2017; 12% and 28% slabs gone):
 * - Garments and clothing accessories of chapters 61 / 62 (shirts 6205, trousers, jeans and blazers 6203, jackets 6201,
 *   T-shirts and vests 6109, polos 6105, sweaters 6110, trunks 6107, sleepwear 6207, socks 6115, ties 6215,
 *   handkerchiefs and pocket squares 6213, canvas belts 6217): 5% when the sale value is at most ₹2,500 a piece, 18%
 *   above. A product carries one rate, so each one's variants stay on one side of the band, clear of the edge: a 5%
 *   piece is at most ₹2,450 with GST (₹2,333 before), an 18% piece at least ₹2,999 (₹2,541 before). The blazers, the
 *   puffer jacket, the silk kurta and the Nehru jacket are the 18% pieces. Packs (vests, trunks, socks, handkerchiefs)
 *   are priced per pack well below the band, so every piece in them is too.
 * - The silk veshti is a woven fabric length (5007), not a garment: 5% at any price.
 * - Leather goods: belts 4203 30, wallets and card holders 4202 31, briefcase 4202 11, duffel 4202 91, canvas rucksack
 *   4202 92, leather key fob 4205: 18% (only cotton / jute bags and handicraft handbags moved to 5%).
 * - Wrist watches 9102: 18%. Sunglasses 9004 10: 18% (corrective spectacles are the 5% entry).
 * - Perfumes 3303 and deodorants 3307 20: 18%. Hair oil (beard oil, 3305 90), shaving preparations (the shaving kit,
 *   3307 10) and combs 9615: 5%.
 * - Imitation jewellery 7117 (cufflinks): 3%. Textile caps and hats 6505: 5% up to ₹2,500. Umbrellas 6601: 5%.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500066";
const WHATSAPP = "919876500066";
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

/** One option row at one price; the middle values get the most stock. */
const sized = (option: string, values: string[], price: number, mrp: number, stock = [3, 6, 8, 6, 4, 3, 2]) =>
  one(
    option,
    values.map((s, i) => [s, price, mrp, stock[i] ?? 2]),
  );

const SIZES = ["S", "M", "L", "XL", "XXL"];
const FITS = ["Slim", "Regular"];
const WAISTS = ["28", "30", "32", "34", "36", "38", "40"];
const BELT_SIZES = ["30", "32", "34", "36", "38", "40", "42"];
const CHEST = ["38", "40", "42", "44", "46"];
/** Middle sizes and waists stock deepest. */
const midStock = (_a: string, b: string) => (["M", "L", "32", "34", "40", "42", "Regular"].includes(b) ? 6 : 3);
const fitStock = (fit: string, size: string) => (size === "M" || size === "L" ? 7 : 3) - (fit === "Slim" ? 1 : 0);

// Category names (the pack's "Accessories" is reused; "Men", "Sarees", "Kurtis" and "Kids" are dropped while empty).
const CLOTHING = "Clothing";
const FORMAL = "Formal shirts";
const CASUAL = "Casual shirts";
const TROUSERS = "Trousers & chinos";
const JEANS = "Jeans";
const TEES = "T-shirts & polos";
const BLAZERS = "Blazers & winter wear";
const INNER = "Innerwear & loungewear";
const ETHNIC = "Ethnic wear";
const ACCESSORIES = "Accessories";
const BELTS = "Belts";
const WALLETS = "Wallets & card holders";
const WATCHES = "Watches";
const SUNGLASSES = "Sunglasses";
const TIES = "Ties";
const CUFFLINKS = "Cufflinks & pocket squares";
const CAPS = "Caps & hats";
const SOCKS = "Socks";
const HANKIES = "Handkerchiefs";
const PERFUMES = "Perfumes & deodorants";
const GROOMING = "Grooming kits";
const BAGS = "Bags";
const KEYRINGS = "Keychains";
const UMBRELLAS = "Umbrellas";

/** The category slug the catalogue gives a name (catalogue `slugify`), for menu links. */
const catSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const SHIRT_NOTE = "\n\nSizes S–XXL in two fits: **Slim** (tapered through the waist) and **Regular** (straight, a little more room). See the size guide for chest and length; we taper or shorten sleeves at the shop in an hour.";
const TROUSER_NOTE = "\n\nWaist 28–40. Sold unhemmed with a 34-inch inseam: we hem them free while you wait at the shop, or to the length you send us online.";

const PRODUCTS: DemoProduct[] = [
  // ---- formal shirts (6205: 5% up to ₹2,500)
  {
    name: "Cotton formal shirt, white",
    category: FORMAL,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-FWH",
    photo: 14072176,
    tags: ["shirt", "office", "bestseller"],
    description: `The one every wardrobe starts with: a two-ply 100% cotton poplin in crisp white, a semi-spread collar that holds a tie and sits flat without one, and single-button cuffs. Wrinkle-resistant finish, so it comes out of the wash ready for a quick press.${SHIRT_NOTE}`,
    attributes: { Fabric: "100% cotton poplin, 2-ply", Collar: "Semi-spread", Cuff: "Single button", Occasion: "Office, interviews", Care: "Machine wash 30°" },
    ...grid(["Fit", FITS], ["Size", SIZES], 1_499, 1_699, fitStock),
  },
  {
    name: "Oxford formal shirt, sky blue",
    category: FORMAL,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-FSB",
    photo: 11527807,
    tags: ["shirt", "office"],
    description: `Soft, textured oxford cotton in pale sky blue with a button-down collar: smart enough under a blazer, relaxed enough with chinos on Friday.${SHIRT_NOTE}`,
    attributes: { Fabric: "Oxford cotton", Collar: "Button-down", Cuff: "Single button", Occasion: "Office, smart casual", Care: "Machine wash 30°" },
    ...grid(["Fit", FITS], ["Size", SIZES], 1_399, 1_599, fitStock),
  },
  {
    name: "Cotton-linen formal shirt, pale pink",
    category: FORMAL,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-FPP",
    photo: 35415004,
    tags: ["shirt", "office", "linen"],
    description: `A cool cotton-linen blend in a soft pink that goes with grey, navy and charcoal trousers. Breathes through a Coimbatore afternoon.${SHIRT_NOTE}`,
    attributes: { Fabric: "60% cotton, 40% linen", Collar: "Spread", Cuff: "Single button", Occasion: "Office, weddings", Care: "Machine wash 30°, iron damp" },
    ...grid(["Fit", FITS], ["Size", SIZES], 1_599, 1_799, fitStock),
  },
  {
    name: "Micro-print formal shirt, navy",
    category: FORMAL,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-FMN",
    photo: 4443831,
    tags: ["shirt", "office", "complete-look", "bestseller"],
    description: `Deep navy cotton with a tiny white dot print that reads plain from across the room. Our pick for the "complete the look": with grey trousers, a black leather belt and a steel watch.${SHIRT_NOTE}`,
    attributes: { Fabric: "100% cotton, printed", Collar: "Semi-spread", Cuff: "Single button", Occasion: "Office, evenings out", Care: "Machine wash 30°, inside out" },
    ...grid(["Fit", FITS], ["Size", SIZES], 1_449, 1_649, fitStock),
  },

  // ---- casual shirts (6205: 5%)
  {
    name: "Linen-blend casual shirt, stone grey",
    category: CASUAL,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-CLG",
    photo: 31618286,
    tags: ["shirt", "linen", "bestseller"],
    description: `Linen-cotton in a soft stone grey with a curved hem you can leave out. Gets better with every wash.${SHIRT_NOTE}`,
    attributes: { Fabric: "55% linen, 45% cotton", Collar: "Cutaway", Hem: "Curved, wear untucked", Care: "Machine wash 30°" },
    ...grid(["Fit", FITS], ["Size", SIZES], 1_699, 1_899, fitStock),
  },
  {
    name: "Printed rayon shirt, rose",
    category: CASUAL,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-CPR",
    photo: 17901262,
    tags: ["shirt"],
    description: "Fluid rayon with a leafy print in rose and white, full sleeves you can roll up, and a relaxed cut. For weekends, beach trips and sangeet nights.\n\nSizes S–XXL, regular fit.",
    attributes: { Fabric: "100% rayon", Print: "Leaf", Fit: "Regular", Care: "Hand wash cold, dry in shade" },
    ...sized("Size", SIZES, 1_199, 1_399),
  },
  {
    name: "Polka dot shirt, maroon",
    category: CASUAL,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-CPD",
    photo: 29359888,
    tags: ["shirt", "festive"],
    description: "Maroon cotton-viscose with bold white polka dots and a Cuban collar: a holiday shirt that also works at a Deepavali get-together.\n\nSizes S–XXL, regular fit.",
    attributes: { Fabric: "Cotton-viscose", Collar: "Cuban", Fit: "Regular", Care: "Machine wash 30°" },
    ...sized("Size", SIZES, 1_099, 1_299),
  },

  // ---- trousers and chinos (6203 42 / 43: 5%)
  {
    name: "Stretch cotton chinos",
    category: TROUSERS,
    hsn: "6203",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-TSC",
    photo: 9464625,
    tags: ["trousers", "office", "bestseller"],
    description: `Our best-selling chinos: a mid-weight cotton twill with 2% stretch, slim through the thigh and tapered to the ankle, in three colours that go with every shirt in the shop.${TROUSER_NOTE}`,
    attributes: { Fabric: "98% cotton, 2% elastane", Fit: "Slim tapered", Rise: "Mid", Care: "Machine wash 30°" },
    ...grid(["Colour", ["Khaki", "Olive", "Navy"]], ["Waist", WAISTS], 1_599, 1_799, midStock),
  },
  {
    name: "Slim chinos, beige",
    category: TROUSERS,
    hsn: "6203",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-TSB",
    photo: 13756086,
    tags: ["trousers"],
    description: `A lighter beige chino in a fine twill for weekends and summer weddings, with a coin pocket and a hidden zip.${TROUSER_NOTE}`,
    attributes: { Fabric: "100% cotton twill", Fit: "Slim", Rise: "Mid", Care: "Machine wash 30°" },
    ...sized("Waist", WAISTS, 1_499, 1_699),
  },
  {
    name: "Checked formal trousers, grey",
    category: TROUSERS,
    hsn: "6203",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-TCG",
    photo: 2897533,
    tags: ["trousers", "office", "complete-look"],
    description: `Charcoal-grey trousers with a subtle Prince of Wales check, flat front and side adjusters, so you can wear them without a belt. Pairs with any plain shirt.${TROUSER_NOTE}`,
    attributes: { Fabric: "Poly-viscose suiting", Fit: "Slim", Front: "Flat, side adjusters", Care: "Dry-clean or gentle wash" },
    ...sized("Waist", WAISTS, 1_799, 1_999),
  },
  {
    name: "Pleated trousers, tobacco brown",
    category: TROUSERS,
    hsn: "6203",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-TPB",
    photo: 37330070,
    tags: ["trousers", "festive"],
    description: `A relaxed, high-rise trouser with a single forward pleat and a wider leg, in a warm tobacco brown. Wear it with a tucked-in knit or a white shirt.${TROUSER_NOTE}`,
    attributes: { Fabric: "Viscose-linen", Fit: "Relaxed, wide leg", Front: "Single pleat", Care: "Dry-clean recommended" },
    ...sized("Waist", WAISTS, 1_999, 2_299),
  },

  // ---- jeans (6203 42: 5%)
  {
    name: "Slim-fit stretch jeans, mid blue",
    category: JEANS,
    hsn: "6203",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-JSM",
    photo: 30710244,
    tags: ["jeans", "bestseller"],
    description: `11-oz stretch denim in a clean mid-blue wash, slim from hip to hem. Moves when you do and keeps its shape.${TROUSER_NOTE}`,
    attributes: { Fabric: "11 oz denim, 2% stretch", Fit: "Slim", Wash: "Mid blue", Care: "Wash inside out, cold" },
    ...sized("Waist", WAISTS, 1_899, 2_199),
  },
  {
    name: "Relaxed jeans, washed grey",
    category: JEANS,
    hsn: "6203",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-JRG",
    photo: 28439284,
    tags: ["jeans"],
    description: `A roomy straight leg in rigid cotton denim with an acid-washed grey finish. Wear them long over sneakers.${TROUSER_NOTE}`,
    attributes: { Fabric: "13 oz cotton denim", Fit: "Relaxed straight", Wash: "Washed grey", Care: "Wash inside out, cold" },
    ...sized("Waist", WAISTS, 1_999, 2_299),
  },
  {
    name: "Straight-fit jeans, light blue",
    category: JEANS,
    hsn: "6203",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-JSL",
    photo: 16069736,
    tags: ["jeans"],
    description: `A classic five-pocket straight leg in a light summer wash, comfortable from the first wear.${TROUSER_NOTE}`,
    attributes: { Fabric: "12 oz cotton denim", Fit: "Straight", Wash: "Light blue", Care: "Wash inside out, cold" },
    ...sized("Waist", WAISTS, 1_799, 1_999),
  },

  // ---- T-shirts and polos (6109 / 6105: 5%)
  {
    name: "Combed-cotton crew T-shirt",
    category: TEES,
    hsn: "6109",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-TCC",
    photo: 6250760,
    tags: ["tee", "under-999", "bestseller"],
    description: "180 GSM combed cotton from Tiruppur, a ribbed crew neck that doesn't stretch out and a straight hem. The everyday tee in three colours.\n\nSizes S–XXL, regular fit.",
    attributes: { Fabric: "100% combed cotton, 180 GSM", Neck: "Crew", Fit: "Regular", Origin: "Tiruppur", Care: "Machine wash 30°" },
    ...grid(["Colour", ["Black", "White", "Navy"]], ["Size", SIZES], 599, 699, midStock),
  },
  {
    name: "Pocket T-shirt, heather grey",
    category: TEES,
    hsn: "6109",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-TPG",
    photo: 9157771,
    tags: ["tee", "under-999"],
    description: "Soft heather-grey cotton-poly jersey with a chest pocket. Washes without fading or shrinking.\n\nSizes S–XXL, regular fit.",
    attributes: { Fabric: "60% cotton, 40% polyester", Neck: "Crew", Fit: "Regular", Care: "Machine wash 30°" },
    ...sized("Size", SIZES, 549, 649),
  },
  {
    name: "Piqué polo T-shirt",
    category: TEES,
    hsn: "6105",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-PPQ",
    photo: 38928670,
    tags: ["tee", "polo", "under-999", "bestseller"],
    description: "Breathable cotton piqué with a ribbed collar and two-button placket, in six colours. Smart enough for a client visit, easy enough for the weekend.\n\nSizes S–XXL, regular fit.",
    attributes: { Fabric: "100% cotton piqué, 220 GSM", Collar: "Ribbed", Fit: "Regular", Origin: "Tiruppur", Care: "Machine wash 30°" },
    ...grid(["Colour", ["White", "Navy", "Red", "Yellow", "Teal", "Wine"]], ["Size", SIZES], 899, 999, (_c, s) => (s === "M" || s === "L" ? 5 : 2)),
  },
  {
    name: "Tipped polo, navy",
    category: TEES,
    hsn: "6105",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-PTN",
    photo: 38010898,
    tags: ["tee", "polo", "office"],
    description: "Navy fine-knit polo with white tipping on the collar and sleeves, slightly tailored through the body.\n\nSizes S–XXL, slim fit.",
    attributes: { Fabric: "Cotton fine-knit", Collar: "Tipped", Fit: "Slim", Care: "Machine wash 30°" },
    ...sized("Size", SIZES, 999, 1_199),
  },

  // ---- blazers and winter wear (6203 / 6201 above ₹2,500: 18%; sweater 6110 at 5%)
  {
    name: "Unstructured cotton blazer, navy",
    category: BLAZERS,
    hsn: "6203",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-BUN",
    photo: 8605789,
    tags: ["blazer", "office", "festive"],
    description: "A soft-shouldered navy blazer in cotton-blend twill, half-lined and light enough for our weather. Over a shirt to the office, over a tee on a Saturday.\n\nChest sizes 38–46 (see the size guide). Sleeves shortened free at the shop.\n\nAbove ₹2,500 a piece, so GST is 18% (included).",
    attributes: { Fabric: "Cotton-blend twill", Lining: "Half-lined", Fit: "Slim", Buttons: "Two", Care: "Dry-clean only" },
    ...sized("Chest", CHEST, 5_999, 6_999, [2, 4, 4, 3, 2]),
  },
  {
    name: "Wool-blend blazer, grey",
    category: BLAZERS,
    hsn: "6203",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-BWG",
    photo: 30303672,
    tags: ["blazer", "office"],
    description: "A fully lined grey blazer in a wool-polyester blend with notch lapels, patch pockets and a ticket pocket. For interviews, board meetings and reception evenings.\n\nChest sizes 38–46.\n\nAbove ₹2,500 a piece, so GST is 18% (included).",
    attributes: { Fabric: "Wool-polyester blend", Lining: "Fully lined", Fit: "Regular", Buttons: "Two", Care: "Dry-clean only" },
    ...sized("Chest", CHEST, 7_499, 7_999, [1, 3, 3, 2, 1]),
  },
  {
    name: "Quilted puffer jacket, black",
    category: BLAZERS,
    hsn: "6201",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-JPB",
    photo: 6182171,
    tags: ["winter", "jacket"],
    description: "A light, water-repellent puffer with a stand collar, two zip pockets and a packable feel: Ooty weekends, Kodai drives and December trips up north.\n\nSizes S–XXL.\n\nAbove ₹2,500 a piece, so GST is 18% (included).",
    attributes: { Shell: "Water-repellent nylon", Fill: "Polyester wadding", Closure: "Zip", Care: "Gentle machine wash" },
    ...sized("Size", SIZES, 3_999, 4_499, [2, 4, 4, 3, 1]),
  },
  {
    name: "Knit turtleneck sweater, off-white",
    category: BLAZERS,
    hsn: "6110",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-SCK",
    photo: 14668121,
    tags: ["winter", "sweater"],
    description: "A ribbed turtleneck in soft off-white acrylic-wool, warm without the itch. Under a blazer or on its own for winter evenings.\n\nSizes S–XXL.",
    attributes: { Fabric: "Acrylic-wool blend", Knit: "Rib", Neck: "Turtleneck", Care: "Hand wash cold, dry flat" },
    ...sized("Size", SIZES, 1_799, 1_999, [2, 4, 4, 3, 1]),
  },

  // ---- innerwear and loungewear (6109 / 6107 / 6207: 5%)
  {
    name: "Ribbed cotton vests (pack of 3), white",
    category: INNER,
    hsn: "6109",
    gstRate: 5,
    unit: "pack",
    sku: "AM-IVW",
    photo: 20550912,
    tags: ["innerwear", "under-999"],
    description: "Three fine-rib cotton vests that stay white and stay in shape: under a formal shirt they keep sweat off the cotton.\n\nSizes S–XXL (chest 34–44 in).",
    attributes: { Fabric: "100% combed cotton rib", Pieces: "3", Care: "Machine wash" },
    ...sized("Size", SIZES, 549, 599, [6, 12, 12, 8, 5]),
  },
  {
    name: "Cotton stretch trunks (pack of 3)",
    category: INNER,
    hsn: "6107",
    gstRate: 5,
    unit: "pack",
    sku: "AM-ITR",
    photo: 8874933,
    tags: ["innerwear", "under-999"],
    description: "Three cotton-elastane trunks with a soft covered waistband, in white, grey and navy.\n\nSizes S–XXL (waist 28–40 in).",
    attributes: { Fabric: "95% cotton, 5% elastane", Pieces: "3 (white, grey, navy)", Care: "Machine wash" },
    ...sized("Size", SIZES, 699, 799, [6, 12, 12, 8, 5]),
  },
  {
    name: "Cotton pyjama set, black",
    category: INNER,
    hsn: "6207",
    gstRate: 5,
    unit: "set",
    sku: "AM-IPS",
    photo: 20364754,
    tags: ["loungewear"],
    description: "A long-sleeve notch-collar shirt and drawstring pyjama in soft black cotton with white piping. A good gift.\n\nSizes S–XXL.",
    attributes: { Fabric: "100% cotton", Set: "Shirt + pyjama", Care: "Machine wash" },
    ...sized("Size", SIZES, 1_499, 1_699),
  },

  // ---- ethnic wear (veshti 5007 at 5% at any price; set and kurtas 6205, Nehru jacket 6203)
  {
    name: "Pure silk veshti with angavastram",
    category: ETHNIC,
    hsn: "5007",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-ESV",
    photo: 34538891,
    tags: ["ethnic", "festive", "wedding", "silk"],
    description: "Cream pure-silk veshti (4 m, double) with a matching angavastram, woven with a gold zari border. For the muhurtham, temple festivals and Pongal.\n\nA woven fabric length, so GST is 5% at any price.",
    attributes: { Fabric: "Pure silk", Length: "4 m (double) + angavastram", Border: "Gold zari", Care: "Dry-clean only" },
    ...one("Border", [
      ["1-inch gold zari", 3_800, 3_800, 5],
      ["2-inch gold zari", 4_600, 4_600, 3],
    ]),
  },
  {
    name: "Cotton veshti and shirt set, cream",
    category: ETHNIC,
    hsn: "6205",
    gstRate: 5,
    unit: "set",
    sku: "AM-ECS",
    photo: 7669974,
    tags: ["ethnic", "festive", "bestseller"],
    description: "A cream cotton shirt with a matching single veshti (2 m) with a thin gold border: the Friday-at-the-office and family-function set. The shirt comes in sizes S–XXL; the veshti is free size.",
    attributes: { Fabric: "Fine cotton", Set: "Shirt + veshti (2 m)", Border: "½-inch gold", Care: "Hand wash, starch lightly" },
    ...sized("Size", SIZES, 1_299, 1_499),
  },
  {
    name: "Silk kurta, pista green",
    category: ETHNIC,
    hsn: "6205",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-EKP",
    photo: 28113612,
    tags: ["ethnic", "festive", "wedding"],
    description: "Pista-green art-silk jacquard kurta with tone-on-tone embroidery at the neck and placket, knee length. Pair it with a churidar or a veshti.\n\nSizes S–XXL.\n\nAbove ₹2,500 a piece, so GST is 18% (included).",
    attributes: { Fabric: "Art-silk jacquard", Length: "Knee", Work: "Neck embroidery", Care: "Dry-clean only" },
    ...sized("Size", SIZES, 3_299, 3_799, [2, 4, 4, 3, 1]),
  },
  {
    name: "Cotton kurta, tan",
    category: ETHNIC,
    hsn: "6205",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-EKT",
    photo: 9816885,
    tags: ["ethnic", "festive"],
    description: "Tan cotton kurta with a band collar and contrast stitching around the placket. Easy for poojas and evening functions.\n\nSizes S–XXL.",
    attributes: { Fabric: "100% cotton", Length: "Mid-thigh", Collar: "Band", Care: "Machine wash 30°" },
    ...sized("Size", SIZES, 1_299, 1_499),
  },
  {
    name: "Nehru jacket, charcoal",
    category: ETHNIC,
    hsn: "6203",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-ENJ",
    photo: 5975299,
    tags: ["ethnic", "festive", "wedding"],
    description: "A sleeveless bandhgala in charcoal textured suiting with self-covered buttons. Over a white kurta for a reception, over a shirt for the office party.\n\nChest sizes 38–46.\n\nAbove ₹2,500 a piece, so GST is 18% (included).",
    attributes: { Fabric: "Poly-viscose suiting", Collar: "Band", Lining: "Fully lined", Care: "Dry-clean only" },
    ...sized("Chest", CHEST, 3_499, 3_999, [2, 4, 4, 3, 1]),
  },

  // ---- belts (leather 4203 30: 18%; canvas 6217: 5%)
  {
    name: "Full-grain leather formal belt",
    category: BELTS,
    hsn: "4203",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-LBF",
    photo: 35322147,
    tags: ["belt", "leather", "office"],
    description: "A 35 mm full-grain leather belt with a brushed-brass pin buckle and stitched edges. Pick your trouser waist size plus 2 (a 32 waist takes a 34 belt).",
    attributes: { Material: "Full-grain buffalo leather", Width: "35 mm", Buckle: "Brushed brass pin", Origin: "Chennai tanneries" },
    ...grid(["Colour", ["Brown", "Black"]], ["Size", BELT_SIZES], 1_299, 1_499, midStock),
  },
  {
    name: "Reversible leather belt, black and brown",
    category: BELTS,
    hsn: "4203",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-LBR",
    photo: 35322165,
    tags: ["belt", "leather", "office", "complete-look", "bestseller"],
    description: "Two belts in one: black on one side, brown on the other, with a turning buckle. Packs light for a work trip.",
    attributes: { Material: "Genuine leather, two-sided", Width: "35 mm", Buckle: "Turning, gunmetal" },
    ...sized("Size", BELT_SIZES, 1_499, 1_799),
  },
  {
    name: "Canvas web belt",
    category: BELTS,
    hsn: "6217",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-CWB",
    photo: 39984088,
    tags: ["belt", "under-999"],
    description: "A woven cotton-canvas belt with leather tabs and a slide buckle, adjustable to any length within its size. For chinos, jeans and shorts.",
    attributes: { Material: "Cotton canvas, leather tabs", Width: "32 mm", Buckle: "Slide, matt brass" },
    ...grid(["Colour", ["Khaki", "Olive", "Navy"]], ["Size", ["30–34", "36–42"]], 599, 699, () => 6),
  },

  // ---- wallets and card holders (4202 31: 18%)
  {
    name: "Leather bifold wallet",
    category: WALLETS,
    hsn: "4202",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-WBF",
    photo: 30217717,
    tags: ["wallet", "leather", "gift"],
    description: "A slim bifold in soft milled leather: eight card slots, two note sections and a hidden pocket, with RFID-blocking lining.",
    attributes: { Material: "Milled leather", Slots: "8 cards, 2 notes", Lining: "RFID-blocking", Size: "11.5 × 9.5 cm" },
    ...one("Colour", [
      ["Brown", 1_199, 1_399, 12],
      ["Black", 1_199, 1_399, 10],
    ]),
  },
  {
    name: "Slim leather card holder",
    category: WALLETS,
    hsn: "4202",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-WCH",
    photo: 37326681,
    tags: ["wallet", "leather", "gift", "under-999"],
    description: "Four card slots and a centre pocket for folded notes, hand-stitched in vegetable-tanned leather that darkens with use.",
    attributes: { Material: "Vegetable-tanned leather", Slots: "4 + centre pocket", Size: "10 × 7 cm" },
    ...one("Colour", [
      ["Tan", 699, 799, 15],
      ["Black", 699, 799, 12],
    ]),
  },

  // ---- watches (9102: 18%)
  {
    name: "Steel mesh-strap analog watch, white dial",
    category: WATCHES,
    hsn: "9102",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-WSM",
    photo: 1190830,
    tags: ["watch", "office", "complete-look", "gift", "bestseller"],
    description: "A slim 38 mm stainless-steel watch with a clean white dial, rose-gold baton markers and a Milanese mesh strap that we size to your wrist at the shop. Quartz movement, 30 m water resistant. One-year warranty.",
    attributes: { Case: "38 mm stainless steel", Strap: "Milanese mesh", Movement: "Quartz", "Water resistance": "30 m", Warranty: "1 year" },
    ...single(3_499, 3_999, 8),
  },
  {
    name: "Minimal analog watch, leather strap",
    category: WATCHES,
    hsn: "9102",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-WML",
    photo: 1265619,
    tags: ["watch", "gift"],
    description: "A clean dark dial with slim baton hands on a 41 mm case and a quick-release leather strap. One-year warranty.",
    attributes: { Case: "41 mm, gunmetal", Movement: "Quartz", "Water resistance": "30 m", Warranty: "1 year" },
    ...one("Strap", [
      ["Tan", 2_499, 2_799, 6],
      ["Brown", 2_499, 2_799, 5],
      ["Black", 2_499, 2_799, 6],
    ]),
  },
  {
    name: "Digital sports watch",
    category: WATCHES,
    hsn: "9102",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-WDS",
    photo: 11700618,
    tags: ["watch", "sport"],
    description: "A square digital watch with backlight, stopwatch, alarm and a soft silicone strap. Swim-proof to 50 m. One-year warranty.",
    attributes: { Display: "Digital, backlit", Functions: "Stopwatch, alarm, date", "Water resistance": "50 m", Warranty: "1 year" },
    ...one("Strap", [
      ["Black", 1_299, 1_499, 10],
      ["Olive", 1_299, 1_499, 6],
    ]),
  },

  // ---- sunglasses (9004 10: 18%)
  {
    name: "Square polarised sunglasses",
    category: SUNGLASSES,
    hsn: "9004",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-SSQ",
    photo: 26575042,
    tags: ["sunglasses"],
    description: "A classic square acetate frame with polarised, UV400 lenses that cut glare off the road. Comes with a hard case and cloth.",
    attributes: { Frame: "Acetate", Lens: "Polarised, UV400", Includes: "Hard case, cloth" },
    ...one("Frame", [
      ["Black", 1_299, 1_599, 10],
      ["Tortoise", 1_299, 1_599, 7],
    ]),
  },
  {
    name: "Round metal-frame sunglasses",
    category: SUNGLASSES,
    hsn: "9004",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-SRM",
    photo: 11882776,
    tags: ["sunglasses"],
    description: "Round lenses in a light metal frame with adjustable nose pads. UV400 protection.",
    attributes: { Frame: "Metal", Lens: "UV400, gradient", Includes: "Pouch" },
    ...one("Frame", [
      ["Tortoise", 1_499, 1_799, 6],
      ["Gold", 1_499, 1_799, 5],
    ]),
  },

  // ---- ties (6215: 5%)
  {
    name: "Striped silk tie",
    category: TIES,
    hsn: "6215",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-TSS",
    photo: 130855,
    tags: ["tie", "office", "under-999", "gift"],
    description: "Woven silk with a regimental stripe, 7 cm wide, hand-finished with a slip stitch so the knot sits right.",
    attributes: { Material: "Woven silk", Width: "7 cm", Length: "148 cm" },
    ...one("Colour", [
      ["Mustard", 899, 999, 8],
      ["Olive", 899, 999, 6],
      ["Black & gold", 899, 999, 6],
    ]),
  },
  {
    name: "Micro-dot tie, navy",
    category: TIES,
    hsn: "6215",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-TMD",
    photo: 35331038,
    tags: ["tie", "office", "under-999"],
    description: "Navy microfibre with a white pin-dot: the tie for interviews and weddings alike. 6.5 cm, a modern width.",
    attributes: { Material: "Polyester microfibre", Width: "6.5 cm", Length: "148 cm" },
    ...single(699, 799, 15),
  },

  // ---- cufflinks (7117 imitation jewellery: 3%) and pocket squares (6213: 5%)
  {
    name: "Malachite cufflinks",
    category: CUFFLINKS,
    hsn: "7117",
    gstRate: 3,
    unit: "pair",
    sku: "AM-CML",
    photo: 3859935,
    tags: ["cufflinks", "gift", "wedding", "under-999"],
    description: "Round green malachite-stone cufflinks set in polished rhodium-plated brass, with a bullet back. In a gift box.",
    attributes: { Material: "Rhodium-plated brass, malachite stone", Back: "Bullet", Includes: "Gift box" },
    ...single(999, 1_199, 10),
  },
  {
    name: "Silk pocket square",
    category: CUFFLINKS,
    hsn: "6213",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-PSQ",
    photo: 11911796,
    tags: ["pocket-square", "wedding", "under-999"],
    description: "A 30 cm square of silk with hand-rolled edges. Fold it flat for the office, puff it for a reception.",
    attributes: { Material: "Silk", Size: "30 × 30 cm", Edges: "Hand-rolled" },
    ...one("Colour", [
      ["Ivory", 449, 499, 12],
      ["Wine", 449, 499, 10],
      ["Navy", 449, 499, 10],
    ]),
  },

  // ---- caps and hats (6505: 5% up to ₹2,500)
  {
    name: "Washed cotton cap",
    category: CAPS,
    hsn: "6505",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-CWC",
    photo: 7562957,
    tags: ["cap", "under-999"],
    description: "A soft, garment-washed cotton twill cap with a curved peak and a brass-buckle strap at the back. One size fits most.",
    attributes: { Material: "Cotton twill", Fit: "Adjustable strap", Size: "One size" },
    ...one("Colour", [
      ["Khaki", 499, 599, 12],
      ["Navy", 499, 599, 10],
      ["Black", 499, 599, 10],
    ]),
  },
  {
    name: "Wool-felt fedora, brown",
    category: CAPS,
    hsn: "6505",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-CFB",
    photo: 13025020,
    tags: ["hat"],
    description: "A wide-brim brown fedora in soft wool felt with a grosgrain band. Holds its shape; folds into a suitcase without creasing.",
    attributes: { Material: "Wool felt", Brim: "7 cm", Band: "Grosgrain" },
    ...one("Size", [
      ["M (57 cm)", 1_499, 1_699, 5],
      ["L (59 cm)", 1_499, 1_699, 4],
    ]),
  },

  // ---- socks (6115: 5%)
  {
    name: "Cotton dress socks (pack of 3)",
    category: SOCKS,
    hsn: "6115",
    gstRate: 5,
    unit: "pack",
    sku: "AM-SDS",
    photo: 19882187,
    tags: ["socks", "office", "under-999"],
    description: "Fine combed-cotton crew socks with a reinforced heel and toe and a soft cuff that doesn't leave marks. Three pairs per pack. UK size 7–10.",
    attributes: { Material: "80% combed cotton, nylon, elastane", Pairs: "3", Size: "UK 7–10" },
    ...one("Colours", [
      ["Brown, navy, black", 449, 499, 20],
      ["Black × 3", 449, 499, 20],
    ]),
  },
  {
    name: "Striped ankle socks (pack of 5)",
    category: SOCKS,
    hsn: "6115",
    gstRate: 5,
    unit: "pack",
    sku: "AM-SAS",
    photo: 10563910,
    tags: ["socks", "under-999"],
    description: "Five pairs of cushioned cotton ankle socks in cheerful stripes, for sneakers and loafers. UK size 7–10.",
    attributes: { Material: "Cotton, nylon, elastane", Pairs: "5", Size: "UK 7–10" },
    ...single(499, 599, 25),
  },

  // ---- handkerchiefs (6213: 5%)
  {
    name: "Cotton handkerchiefs (pack of 6)",
    category: HANKIES,
    hsn: "6213",
    gstRate: 5,
    unit: "pack",
    sku: "AM-HCP",
    photo: 7949046,
    tags: ["handkerchief", "under-999"],
    description: "Six soft mulmul-cotton handkerchiefs, 45 cm square, with a woven border. Gets softer with every wash.",
    attributes: { Material: "Mulmul cotton", Size: "45 × 45 cm", Pieces: "6" },
    ...one("Colours", [
      ["White", 299, 349, 30],
      ["Assorted checks", 299, 349, 25],
    ]),
  },

  // ---- perfumes (3303: 18%) and deodorants (3307 20: 18%)
  {
    name: "Eau de parfum, vetiver and cedar",
    category: PERFUMES,
    hsn: "3303",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-PVC",
    photo: 15574229,
    tags: ["perfume", "gift", "bestseller"],
    description: "A fresh woody scent: bergamot at the top, vetiver and cedar underneath. Lasts through a working day. Made in Kannauj.",
    attributes: { Notes: "Bergamot, vetiver, cedarwood", Concentration: "Eau de parfum", Origin: "Kannauj" },
    ...one("Size", [
      ["50 ml", 1_299, 1_499, 12],
      ["100 ml", 1_999, 2_299, 8],
    ]),
  },
  {
    name: "Eau de parfum, oud and amber",
    category: PERFUMES,
    hsn: "3303",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-POA",
    photo: 28745493,
    tags: ["perfume", "gift", "festive"],
    description: "A warm evening scent of oud, amber and a little rose. Two sprays are enough for a wedding reception.",
    attributes: { Notes: "Oud, amber, rose", Concentration: "Eau de parfum", Origin: "Kannauj" },
    ...one("Size", [
      ["50 ml", 1_499, 1_699, 10],
      ["100 ml", 2_299, 2_599, 6],
    ]),
  },
  {
    name: "Deodorant body spray, fresh citrus",
    category: PERFUMES,
    hsn: "3307",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-DBS",
    photo: 15369086,
    tags: ["deodorant", "under-999"],
    description: "A light citrus-and-mint body spray without gas-heavy propellant smell, 48-hour freshness.",
    attributes: { Notes: "Lemon, mint, musk", Volume: "150 ml" },
    ...one("Pack", [
      ["Single (150 ml)", 299, 349, 30],
      ["Pack of 3", 799, 1_047, 12],
    ]),
  },

  // ---- grooming (beard oil 3305 90, shaving kit 3307 10, combs 9615: 5%)
  {
    name: "Beard oil, sandalwood",
    category: GROOMING,
    hsn: "3305",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-GBO",
    photo: 7796810,
    tags: ["grooming", "under-999", "gift"],
    description: "Cold-pressed coconut, jojoba and almond oils with Mysore sandalwood: softens the beard and stops the itch. A few drops after a shower.",
    attributes: { Ingredients: "Coconut, jojoba, almond oils, sandalwood", Bottle: "Amber glass, dropper" },
    ...one("Size", [
      ["30 ml", 449, 499, 15],
      ["50 ml", 649, 699, 10],
    ]),
  },
  {
    name: "Wooden and carbon comb set",
    category: GROOMING,
    hsn: "9615",
    gstRate: 5,
    unit: "set",
    sku: "AM-GCS",
    photo: 7428093,
    tags: ["grooming", "under-999"],
    description: "A wide-tooth neem-wood comb for the beard and an anti-static carbon comb for the hair. Neither pulls nor snaps.",
    attributes: { Pieces: "2", Material: "Neem wood, carbon" },
    ...single(349, 399, 20),
  },
  {
    name: "Shaving kit: brush, cream and after-shave",
    category: GROOMING,
    hsn: "3307",
    gstRate: 5,
    unit: "set",
    sku: "AM-GSK",
    photo: 8789612,
    tags: ["grooming", "gift"],
    description: "A soft synthetic shaving brush on a wooden handle, a 100 g tub of sandalwood shaving cream and a 100 ml alcohol-free after-shave balm, in a gift box. No razor or trimmer included.",
    attributes: { Includes: "Brush, shaving cream 100 g, after-shave 100 ml", Scent: "Sandalwood" },
    ...single(999, 1_199, 10),
  },

  // ---- bags (4202: 18%)
  {
    name: "Canvas rucksack with leather trims",
    category: BAGS,
    hsn: "4202",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-BCR",
    photo: 16647866,
    tags: ["bag", "travel"],
    description: "Waxed cotton-canvas rucksack with leather straps and buckles, a padded 15-inch laptop sleeve and two side pockets. 22 litres.",
    attributes: { Material: "Waxed canvas, leather trims", Capacity: "22 L", Laptop: "Up to 15 in" },
    ...one("Colour", [
      ["Khaki", 2_499, 2_999, 6],
      ["Olive", 2_499, 2_999, 5],
    ]),
  },
  {
    name: "Leather laptop briefcase",
    category: BAGS,
    hsn: "4202",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-BLB",
    photo: 6648407,
    tags: ["bag", "leather", "office", "gift"],
    description: "A structured black leather briefcase with a padded compartment for a 15.6-inch laptop, an organiser panel, a lock and a detachable shoulder strap.",
    attributes: { Material: "Genuine leather", Laptop: "Up to 15.6 in", Closure: "Flap with lock" },
    ...single(4_999, 5_999, 4),
  },
  {
    name: "Leather weekender duffel",
    category: BAGS,
    hsn: "4202",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-BWD",
    photo: 14842175,
    tags: ["bag", "leather", "travel"],
    description: "A dark brown leather duffel big enough for three days, with a shoe compartment at one end and a padded shoulder strap. Fits airline overhead bins.",
    attributes: { Material: "Genuine leather, cotton lining", Capacity: "40 L", Size: "50 × 26 × 28 cm" },
    ...single(5_499, 6_499, 3),
  },

  // ---- key rings (leather fob 4205: 18%) and umbrellas (6601: 5%)
  {
    name: "Leather-strap key ring",
    category: KEYRINGS,
    hsn: "4205",
    gstRate: 18,
    unit: "pcs",
    sku: "AM-KLS",
    photo: 109361,
    tags: ["keychain", "leather", "gift", "under-999"],
    description: "A stitched leather loop on a solid steel split ring with a quick-release clip for the car key.",
    attributes: { Material: "Leather, stainless steel" },
    ...one("Colour", [
      ["Tan", 349, 399, 20],
      ["Black", 349, 399, 15],
    ]),
  },
  {
    name: "Auto-open umbrella, black",
    category: UMBRELLAS,
    hsn: "6601",
    gstRate: 5,
    unit: "pcs",
    sku: "AM-UAO",
    photo: 5052681,
    tags: ["umbrella", "under-999"],
    description: "A windproof black umbrella with a fibreglass frame, one-touch open and a Teflon-coated canopy that sheds water. For the Coimbatore monsoon and the Ooty drizzle.",
    attributes: { Frame: "Fibreglass, windproof", Canopy: "Teflon-coated polyester" },
    ...one("Size", [
      ["Compact (3-fold)", 599, 699, 20],
      ["Long (golf, 30 in)", 899, 999, 10],
    ]),
  },
];

/** Pexels photos used by the store (credited on /pages/photo-credits). */
const PHOTOS: DemoStore["photos"] = {
  14072176: { by: "Jibin Yesudasan", alt: "Man in a white formal shirt" },
  11527807: { by: "Sewupari Studio", alt: "Man in a pale blue formal shirt" },
  35415004: { by: "Milton Das", alt: "Man in a pale pink shirt and grey trousers" },
  4443831: { by: "Kayla S", alt: "Navy printed shirt with a black belt and a steel watch" },
  31618286: { by: "foad shariyati", alt: "Man in a stone grey casual shirt" },
  17901262: { by: "BD Jewel", alt: "Man in a rose printed shirt" },
  29359888: { by: "Asad Photo Maldives", alt: "Man in a maroon polka dot shirt" },
  9464625: { by: "Ron Lach", alt: "Khaki chinos" },
  13756086: { by: "Beyza Kaplan", alt: "Beige chinos" },
  2897533: { by: "Prayoon Sajeev", alt: "Grey checked trousers" },
  37330070: { by: "Efe Ersoy", alt: "Pleated brown trousers" },
  30710244: { by: "Luis Quintero", alt: "Mid blue slim jeans" },
  28439284: { by: "Aj Collins  Artistry", alt: "Washed grey jeans" },
  16069736: { by: "Luis Quintero", alt: "Light blue straight jeans" },
  6250760: { by: "behrouz sasani", alt: "Man in a black crew T-shirt" },
  9157771: { by: "Kate Andreeshcheva", alt: "Man in a heather grey T-shirt" },
  38928670: { by: "Pexels | Ly Vinh Duc", alt: "Polo T-shirts in many colours" },
  38010898: { by: "Yusif Iskandarov", alt: "Man in a navy polo" },
  8605789: { by: "Iskandar Qadamov", alt: "Man in a navy blazer" },
  30303672: { by: "Juan José Carranza", alt: "Man in a grey blazer" },
  6182171: { by: "behrouz sasani", alt: "Man in a black puffer jacket" },
  14668121: { by: "Gökhan Yetimova", alt: "Man in an off-white knit turtleneck" },
  20550912: { by: "Vinícius Vieira ft", alt: "Man in a white ribbed vest" },
  8874933: { by: "Mike Jones", alt: "White cotton trunks" },
  20364754: { by: "Sensory Soft", alt: "Man in a black pyjama set" },
  34538891: { by: "Anil  Sharma", alt: "Man in a silk shirt and gold-bordered veshti" },
  7669974: { by: "Anoop VS", alt: "Man in a cream shirt and veshti" },
  28113612: { by: "Sabir Khan Shourov", alt: "Man in a pista green silk kurta" },
  9816885: { by: "Adnan Mughal Photographer", alt: "Man in a tan cotton kurta" },
  5975299: { by: "Umar Creations", alt: "Man in a charcoal Nehru jacket over a white kurta" },
  35322147: { by: "BELTLEY COM", alt: "Brown leather belt with a brass buckle" },
  35322165: { by: "BELTLEY COM", alt: "Dark leather belt with a gold buckle" },
  39984088: { by: "Сокіл Sokil", alt: "Khaki canvas belt" },
  30217717: { by: "River Augustin", alt: "Brown leather bifold wallet" },
  37326681: { by: "Gül Işık", alt: "Tan leather card holder" },
  1190830: { by: "Diana ✨", alt: "Silver watch with a white dial on a mesh strap" },
  1265619: { by: "FOX ^.ᆽ.^= ∫", alt: "Analog watch with a tan leather strap" },
  11700618: { by: "pratik prasad", alt: "Square digital watch" },
  26575042: { by: "GlassesShop GS", alt: "Square sunglasses" },
  11882776: { by: "Justin L U C K", alt: "Round tortoise sunglasses" },
  130855: { by: "Mike Bird", alt: "Four striped silk ties" },
  35331038: { by: "Muhammad Shamaoon Malik", alt: "Navy dotted tie on a striped shirt" },
  3859935: { by: "The Lazy Artist Gallery", alt: "Green malachite cufflinks" },
  11911796: { by: "Mathias Reding", alt: "Pocket square in a grey jacket" },
  7562957: { by: "Chris F", alt: "Khaki cotton cap" },
  13025020: { by: "Wallace Chuck", alt: "Brown fedora" },
  19882187: { by: "Jonathan Borba", alt: "Man putting on brown dress socks" },
  10563910: { by: "Jan van der Wolf", alt: "Striped ankle socks" },
  7949046: { by: "Hatice Noğman", alt: "Embroidered cotton handkerchief on a wooden table" },
  15574229: { by: "Aziz Hasan AY", alt: "Clear perfume bottle" },
  28745493: { by: "Amar  Preciado", alt: "Perfume bottle in warm light" },
  15369086: { by: "Mich Graphics", alt: "Black and white body spray can" },
  7796810: { by: "Alesia  Kozik", alt: "Amber dropper bottle of beard oil" },
  7428093: { by: "cottonbro studio", alt: "Wooden and black combs" },
  8789612: { by: "Darina Belonogova", alt: "Shaving brush and jars" },
  16647866: { by: "khaled damlakhi", alt: "Canvas rucksack with leather straps" },
  6648407: { by: "cottonbro studio", alt: "Black leather briefcase" },
  14842175: { by: "Malcolm Garret", alt: "Brown leather duffel bag" },
  109361: { by: "revac film's&photography", alt: "Leather key ring with a car key" },
  5052681: { by: "Abhishek  Yadav", alt: "Black umbrella" },
  // categories, home and pages
  38285771: { by: "İslam Abruev", alt: "Inside a menswear store" },
  29765480: { by: "Magda Ehlers", alt: "Shelves of folded formal shirts" },
  17960004: { by: "Sagar Ahire", alt: "Man in a navy polka dot shirt" },
  16238583: { by: "Elina Volkova", alt: "Pleated beige trousers with a black belt" },
  4109759: { by: "Castorly Stock", alt: "Folded jeans" },
  17898555: { by: "Murat IŞIK", alt: "Man in a cream polo" },
  615003: { by: "David Bartus", alt: "Blazers on a rack" },
  20364763: { by: "Sensory Soft", alt: "Man in a black pyjama set" },
  24012944: { by: "Rupinder  Korpal", alt: "Man in a printed Nehru jacket and kurta" },
  28719728: { by: "Sekav Werna", alt: "Shoes, belt, watch and cufflinks laid out" },
  31959214: { by: "Shivam Patil", alt: "Leather belts" },
  28028234: { by: "Gül Işık", alt: "Tan leather card holders" },
  31642726: { by: "Oguz Kagan Cevik", alt: "Watches in a wooden box" },
  5202048: { by: "https://kaboompics.com/", alt: "Sunglasses on a display stand" },
  34342976: { by: "Fer ID", alt: "Rolled silk ties" },
  3023668: { by: "Caleb Oquendo", alt: "Cufflinks in a box" },
  396777: { by: "SevenStorm JUHASZIMRUS", alt: "Hats on shelves" },
  4495756: { by: "https://kaboompics.com/", alt: "Socks on a washing line" },
  1545348: { by: "Rene Terp", alt: "White pocket handkerchief in a jacket" },
  16239693: { by: "Kỳ Vĩ Lê Nguyễn", alt: "Perfume bottle on a dark table" },
  7428092: { by: "cottonbro studio", alt: "Grooming bottles and combs" },
  5827881: { by: "Polina ⠀", alt: "Leather backpack with a laptop" },
  15947229: { by: "COPPERTIST WU", alt: "Brass key ring" },
  11988729: { by: "Connor Scott McManus", alt: "Raindrops on a black umbrella" },
  16749986: { by: "Beard Kid", alt: "Man in a grey suit buttoning his jacket" },
  13222257: { by: "Abhishek  Shekhawat", alt: "Man in a green velvet Nehru jacket over a white kurta" },
  6764997: { by: "Tima Miroshnichenko", alt: "Tailor fitting a waistcoat on a customer" },
  31318445: { by: "Daniel Maurício Bertoli", alt: "Menswear store with folded shirts on a table" },
  5264929: { by: "Antoni Shkraba", alt: "Tailor measuring a jacket in a store" },
};

const HOURS = [
  { label: "Every day", value: "10:00 am – 9:30 pm" },
  { label: "Alterations desk", value: "10:30 am – 8:30 pm" },
];

const FAQ = [
  {
    q: "Slim or regular: which fit is mine?",
    a: "**Slim** is tapered through the chest and waist and sits close without pulling; **Regular** is straight from chest to hem with about 2 inches more room. If the buttons pull across your chest in a slim shirt, take Regular in the same size. The [size guide](/pages/size-guide) has the chest and length of every size, and our staff will measure you at the shop in a minute.",
  },
  {
    q: "Can I exchange or return something?",
    a: "Unworn clothing and accessories with tags can be exchanged within **15 days** at the shop or by courier (we pick up in Coimbatore). If something reaches you damaged or wrong, we refund in full. Innerwear, socks, perfumes once opened, and altered or hemmed pieces can't be returned for hygiene and fit reasons.",
  },
  {
    q: "Do you hem trousers and alter shirts?",
    a: "Yes. Trouser and jeans **hemming is free** and done while you wait (about 30 minutes) at the shop; online, tell us your inseam and we hem before dispatch. Shirt tapering ₹250, sleeve shortening ₹150, blazer sleeves free with a blazer. See [alterations](/pages/alterations).",
  },
  {
    q: "Is cash on delivery available?",
    a: "Yes, across Tamil Nadu on orders up to ₹10,000 (₹40 COD fee outside Coimbatore). You can also pay by UPI or card at the door. Outside Tamil Nadu we ship prepaid only.",
  },
  {
    q: "How do I pick a belt size?",
    a: "Take your **trouser waist size plus 2**: a 32 waist takes a 34 belt. Our belts have five holes an inch apart and the middle hole is the size on the tag.",
  },
  { q: "Do you gift wrap?", a: "Free gift wrapping on every order with a handwritten card: tell us the message at checkout. Wallets, watches, perfumes and cufflinks come in their own boxes." },
];

const FAQ_TA = [
  {
    q: "ஸ்லிம் அல்லது ரெகுலர்: எனக்கு எந்த ஃபிட்?",
    a: "**ஸ்லிம்** மார்பிலும் இடுப்பிலும் உடலோடு ஒட்டி, இழுக்காமல் இருக்கும்; **ரெகுலர்** மார்பிலிருந்து கீழ் வரை நேராக, சுமார் 2 அங்குலம் அதிக இடத்துடன் இருக்கும். ஸ்லிம் சட்டையில் பட்டன்கள் மார்பில் இழுத்தால், அதே அளவில் ரெகுலர் எடுங்கள். ஒவ்வொரு அளவின் மார்பளவும் நீளமும் [அளவு வழிகாட்டியில்](/pages/size-guide) உள்ளன; கடையில் எங்கள் பணியாளர்கள் ஒரு நிமிடத்தில் அளந்து சொல்வார்கள்.",
  },
  {
    q: "மாற்றவோ திருப்பித் தரவோ முடியுமா?",
    a: "அணியாத, அடையாளச் சீட்டுடன் உள்ள ஆடைகளையும் அக்சசரிகளையும் **15 நாட்களுக்குள்** கடையிலோ கூரியரிலோ மாற்றலாம் (கோவையில் நாங்களே வந்து எடுப்போம்). பொருள் சேதமாகவோ தவறாகவோ வந்தால் முழுப் பணத்தையும் திருப்பித் தருவோம். உள்ளாடைகள், சாக்ஸ், திறந்த பெர்ஃப்யூம், ஆல்டர் அல்லது ஹெம் செய்த பொருட்களைச் சுகாதாரம், அளவு காரணங்களால் திருப்பித் தர இயலாது.",
  },
  {
    q: "பேண்ட் ஹெம், சட்டை ஆல்டரேஷன் செய்வீர்களா?",
    a: "ஆம். பேண்ட், ஜீன்ஸ் **ஹெம்மிங் இலவசம்**; கடையில் காத்திருக்கும்போதே (சுமார் 30 நிமிடம்) செய்து தருவோம்; ஆன்லைனில் உங்கள் இன்சீம் அளவைச் சொன்னால் அனுப்பும் முன் ஹெம் செய்வோம். சட்டை டேப்பரிங் ₹250, கை நீளம் குறைத்தல் ₹150, பிளேசருடன் கை ஆல்டரேஷன் இலவசம். [ஆல்டரேஷன்](/pages/alterations) பக்கத்தைப் பாருங்கள்.",
  },
  {
    q: "கேஷ் ஆன் டெலிவரி உண்டா?",
    a: "ஆம், தமிழ்நாடு முழுவதும் ₹10,000 வரையிலான ஆர்டர்களுக்கு (கோவைக்கு வெளியே ₹40 COD கட்டணம்). வாசலில் UPI அல்லது கார்டிலும் செலுத்தலாம். தமிழ்நாட்டுக்கு வெளியே முன்பணம் செலுத்திய ஆர்டர்கள் மட்டும்.",
  },
  {
    q: "பெல்ட் அளவை எப்படித் தேர்வது?",
    a: "உங்கள் **பேண்ட் இடுப்பு அளவுடன் 2 சேர்த்துக்கொள்ளுங்கள்**: 32 இடுப்புக்கு 34 பெல்ட். எங்கள் பெல்ட்களில் ஒரு அங்குல இடைவெளியில் ஐந்து துளைகள்; நடுத் துளைதான் சீட்டில் உள்ள அளவு.",
  },
  { q: "கிஃப்ட் ராப் செய்வீர்களா?", a: "ஒவ்வொரு ஆர்டருக்கும் கையால் எழுதிய அட்டையுடன் இலவச கிஃப்ட் ராப்: செக்அவுட்டில் செய்தியைச் சொல்லுங்கள். வாலட், வாட்ச், பெர்ஃப்யூம், கஃப்லிங்க்ஸ் அவற்றின் சொந்தப் பெட்டியில் வரும்." },
];

const SHIRT_TABLE =
  "| Size | Fits chest (in) | Slim: garment chest (in) | Regular: garment chest (in) | Length (in) | Shoulder (in) |\n|---|---|---|---|---|---|\n| S (38) | 36–38 | 40 | 42 | 28.5 | 17 |\n| M (40) | 38–40 | 42 | 44 | 29 | 17.5 |\n| L (42) | 40–42 | 44 | 46 | 29.5 | 18 |\n| XL (44) | 42–44 | 46 | 48 | 30 | 18.5 |\n| XXL (46) | 44–46 | 48 | 50 | 30.5 | 19 |";
const TROUSER_TABLE =
  "| Waist size | Fits waist (in) | Hip (in) | Thigh, slim (in) | Inseam (unhemmed, in) |\n|---|---|---|---|---|\n| 28 | 28–29 | 36 | 21.5 | 34 |\n| 30 | 30–31 | 38 | 22.5 | 34 |\n| 32 | 32–33 | 40 | 23.5 | 34 |\n| 34 | 34–35 | 42 | 24.5 | 34 |\n| 36 | 36–37 | 44 | 25.5 | 34 |\n| 38 | 38–39 | 46 | 26.5 | 34 |\n| 40 | 40–41 | 48 | 27.5 | 34 |";
const BELT_TABLE =
  "| Trouser waist | Belt size | Belt length, buckle to middle hole (in) |\n|---|---|---|\n| 28 | 30 | 30 |\n| 30 | 32 | 32 |\n| 32 | 34 | 34 |\n| 34 | 36 | 36 |\n| 36 | 38 | 38 |\n| 38 | 40 | 40 |\n| 40 | 42 | 42 |";
const BLAZER_TABLE =
  "| Chest size | Fits chest (in) | Shoulder (in) | Sleeve (in) | Length (in) |\n|---|---|---|---|---|\n| 38 | 37–38 | 17.5 | 24.5 | 29 |\n| 40 | 39–40 | 18 | 25 | 29.5 |\n| 42 | 41–42 | 18.5 | 25.5 | 30 |\n| 44 | 43–44 | 19 | 26 | 30.5 |\n| 46 | 45–46 | 19.5 | 26.5 | 31 |";

const ALTER_TEXT = "Hello Arasan Menswear, I'd like an alteration. Item: … What to change: … Order number (if online): …";
const FIT_TEXT = "Hello Arasan Menswear, can you help me with my size? Height: … Usual shirt size: … Waist: …";

/** A stat's Tamil words (typed as plain words, as store #2's `dish()`). */
const stat = (label: string): Record<string, string> => ({ label });

const CLOTHING_CATS = [FORMAL, CASUAL, TROUSERS, JEANS, TEES, BLAZERS, INNER, ETHNIC];
const ACCESSORY_CATS = [BELTS, WALLETS, WATCHES, SUNGLASSES, TIES, CUFFLINKS, CAPS, SOCKS, HANKIES, PERFUMES, GROOMING, BAGS, KEYRINGS, UMBRELLAS];

export const ARASAN: DemoStore = {
  shop: {
    slug: "arasan",
    appId: "EC",
    businessType: "fashion",
    planId: "pro",
    name: "Arasan Menswear",
    primary: "#14213d",
    billing: {
      legalName: "Arasan Menswear",
      gstin: "33AAPFA1357M1Z9",
      address: "112, Cross Cut Road, Gandhipuram",
      city: "Coimbatore",
      pincode: "641012",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "AM",
      upiId: "arasanmenswear@okaxis",
    },
    items: [
      { name: "Alteration: shirt tapering", hsn: "998821", unit: "pcs", rate: 23_810, gstRate: 5 },
      { name: "Alteration: sleeve shortening", hsn: "998821", unit: "pcs", rate: 14_286, gstRate: 5 },
    ],
  },
  preset: "tailored",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 1_000_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "hello@arasanmenswear.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/arasanmenswear" },
    policies: {
      shipping:
        "**Coimbatore (641xxx):** same day if you order by 2 pm, by our own delivery staff. ₹60, free above ₹1,499.\n\n**Rest of Tamil Nadu:** 2–3 days by courier, ₹99, free above ₹1,999. Cash on delivery up to ₹10,000 (₹40 fee).\n\n**Rest of India:** 3–6 days by courier, ₹149, free above ₹2,999. Prepaid only.",
      returns:
        "Unworn clothing and accessories with tags can be exchanged within 15 days of delivery, at the shop or by courier (free pick-up in Coimbatore). Anything that arrives damaged or wrong is replaced or refunded in full; send a photo on WhatsApp within 48 hours. Innerwear, socks, opened perfumes and grooming products, and hemmed or altered pieces can't be returned.",
      privacy: "We use your details only to deliver your order, send your GST bill and, if you ask, keep your sizes and alteration notes on file.",
      terms: "Prices include GST. Colours can look a little different on screen. Trouser hemming is free; other alterations are charged as listed on the alterations page and are final once done.",
    },
    businessType: "fashion",
  },
  zones: [
    {
      name: "Coimbatore",
      pincodePrefixes: ["641"],
      rate: { name: "Same-day delivery", type: "free_above", amount: 6_000, freeAbove: 149_900, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–3 days)", type: "free_above", amount: 9_900, freeAbove: 199_900, etaMinDays: 2, etaMaxDays: 3, codAllowed: true, codFee: 4_000 },
    },
    {
      name: "Rest of India",
      states: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "26", "27", "29", "30", "31", "32", "34", "35", "36", "37", "38"],
      rate: { name: "Courier (3–6 days)", type: "free_above", amount: 14_900, freeAbove: 299_900, etaMinDays: 3, etaMaxDays: 6, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: CLOTHING, description: "Shirts, trousers, jeans, T-shirts, blazers, winter wear and innerwear in every size, with free trouser hemming.", photo: 38285771 },
    { name: FORMAL, parent: CLOTHING, description: "Cotton, oxford and linen-blend office shirts in sizes S–XXL, slim or regular fit.", photo: 29765480 },
    { name: CASUAL, parent: CLOTHING, description: "Linen-blend, printed and polka-dot shirts for weekends and evenings.", photo: 17960004 },
    { name: TROUSERS, parent: CLOTHING, description: "Stretch chinos, formal and pleated trousers, waist 28–40, hemmed free.", photo: 16238583 },
    { name: JEANS, parent: CLOTHING, description: "Slim, straight and relaxed jeans, waist 28–40.", photo: 4109759 },
    { name: TEES, parent: CLOTHING, description: "Tiruppur cotton T-shirts and piqué polos in S–XXL.", photo: 17898555 },
    { name: BLAZERS, parent: CLOTHING, description: "Unstructured and wool-blend blazers, puffer jackets and sweaters.", photo: 615003 },
    { name: INNER, parent: CLOTHING, description: "Cotton vests, trunks and pyjama sets.", photo: 20364763 },
    { name: ETHNIC, description: "Silk veshtis, veshti and shirt sets, kurtas and Nehru jackets for festivals and weddings.", photo: 24012944 },
    { name: ACCESSORIES, description: "Every men's accessory in one place: belts, wallets, watches, sunglasses, ties, perfumes, grooming, bags and more.", photo: 28719728 },
    { name: BELTS, parent: ACCESSORIES, description: "Full-grain leather, reversible and canvas belts, sizes 30–42.", photo: 31959214 },
    { name: WALLETS, parent: ACCESSORIES, description: "Leather bifolds and slim card holders.", photo: 28028234 },
    { name: WATCHES, parent: ACCESSORIES, description: "Steel, leather-strap and digital watches with a one-year warranty.", photo: 31642726 },
    { name: SUNGLASSES, parent: ACCESSORIES, description: "Polarised square and round metal frames, UV400.", photo: 5202048 },
    { name: TIES, parent: ACCESSORIES, description: "Woven silk and microfibre ties.", photo: 34342976 },
    { name: CUFFLINKS, parent: ACCESSORIES, description: "Stone cufflinks and silk pocket squares.", photo: 3023668 },
    { name: CAPS, parent: ACCESSORIES, description: "Washed cotton caps and wool-felt hats.", photo: 396777 },
    { name: SOCKS, parent: ACCESSORIES, description: "Dress and ankle socks in value packs.", photo: 4495756 },
    { name: HANKIES, parent: ACCESSORIES, description: "Soft mulmul handkerchiefs in packs of six.", photo: 1545348 },
    { name: PERFUMES, parent: ACCESSORIES, description: "Kannauj eaux de parfum in 50 and 100 ml, and body sprays.", photo: 16239693 },
    { name: GROOMING, parent: ACCESSORIES, description: "Beard oil, combs and shaving kits (no trimmers).", photo: 7428092 },
    { name: BAGS, parent: ACCESSORIES, description: "Canvas rucksacks, leather briefcases and weekender duffels.", photo: 5827881 },
    { name: KEYRINGS, parent: ACCESSORIES, description: "Leather and brass keychains.", photo: 15947229 },
    { name: UMBRELLAS, parent: ACCESSORIES, description: "Windproof compact and golf umbrellas.", photo: 11988729 },
  ],
  // Apparel / footwear: GST by price band (5% up to ₹2,500 a piece, 18% above).
  products: withPriceBandGst(PRODUCTS),
  collections: [
    { name: "New season", slug: "new-season", description: "Just in on Cross Cut Road this month.", rule: { sort: "new" } },
    { name: "Complete the look", slug: "complete-the-look", description: "A navy shirt, grey trousers, a black leather belt and a steel watch: one outfit, head to wrist.", rule: { tag: "complete-look", sort: "price-asc" } },
    { name: "The office edit", slug: "office-edit", description: "Shirts, trousers, ties, belts and bags for Monday to Friday.", rule: { tag: "office", sort: "price-asc" } },
    { name: "Festive & ethnic", slug: "festive-ethnic", description: "Silk veshtis, kurtas, Nehru jackets and evening scents for Deepavali, Pongal and the wedding season.", rule: { tag: "festive", sort: "price-desc" } },
    { name: "Accessories under ₹999", slug: "accessories-under-999", description: "Small things that finish an outfit, all under ₹999.", rule: { tag: "under-999", sort: "price-asc" } },
    { name: "Bestsellers", slug: "bestsellers", description: "What Coimbatore buys again and again.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "Gifts for him", slug: "gifts-for-him", description: "Wallets, watches, perfumes, cufflinks and grooming kits, gift-wrapped free.", rule: { tag: "gift", sort: "price-asc" } },
    { name: "Leather goods", slug: "leather-goods", description: "Belts, wallets, bags and keychains in real leather.", rule: { tag: "leather", sort: "price-asc" } },
    { name: "Shirts", slug: "shirts", description: "Formal and casual shirts in S–XXL.", rule: { tag: "shirt", sort: "price-asc" } },
    { name: "On offer", slug: "on-offer", description: "Below MRP right now.", rule: { onSale: true, sort: "price-asc" } },
  ],
  coupons: [
    {
      code: "ARASAN10",
      description: "10% off your first order above ₹1,999 (up to ₹500)",
      type: "percent",
      value: 10,
      minOrder: 199_900,
      maxDiscount: 50_000,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      channels: ["store"],
    },
  ],
  home: ({ photo, category, product }) => ({
    seo: {
      title: "Arasan Menswear, Coimbatore — shirts, trousers and men's accessories",
      description: "Formal and casual shirts in slim and regular fits, chinos, jeans, blazers, veshtis and every men's accessory: belts, wallets, watches, perfumes, bags. Free trouser hemming, COD across Tamil Nadu.",
      imageUrl: photo(16749986),
    },
    sections: [
      {
        type: "hero-split",
        id: "ar-hero",
        imageUrl: photo(16749986),
        imageSide: "right",
        eyebrow: "New season · Cross Cut Road, Coimbatore",
        heading: "Sharp shirts. Better trousers. Every accessory.",
        text: "This season's shirts in slim and regular fits, chinos hemmed free while you wait, and fourteen kinds of accessories to finish the look. 10% off your first order with ARASAN10.",
        cta: { label: "Shop new season", href: "/collections/new-season" },
        cta2: { label: "Find your fit", href: "/pages/size-guide" },
      },
      {
        type: "categories",
        id: "ar-clothing",
        title: "Clothing",
        categoryIds: CLOTHING_CATS.map(category),
        layout: "big-grid",
        columns: "4",
        showCounts: false,
      },
      {
        type: "shop-the-look",
        id: "ar-look",
        title: "Complete the look",
        text: "Navy micro-print shirt, grey checked trousers, a reversible leather belt and a steel watch. Tap a dot to shop each piece.",
        imageUrl: photo(4443831, "tile"),
        alt: "Navy printed shirt with a black belt and a steel watch",
        hotspots: [
          { x: 45, y: 25, productId: product("Micro-print formal shirt, navy") },
          { x: 38, y: 79, productId: product("Reversible leather belt, black and brown") },
          { x: 77, y: 73, productId: product("Steel mesh-strap analog watch, white dial") },
          { x: 64, y: 92, productId: product("Checked formal trousers, grey") },
        ],
      },
      {
        type: "categories",
        id: "ar-accessories",
        title: "Accessories, all fourteen",
        categoryIds: ACCESSORY_CATS.map(category),
        layout: "rounded-squares",
        columns: "6",
        showCounts: true,
        style: { background: "muted" },
      },
      { type: "collection", id: "ar-office", title: "The office edit", collectionSlug: "office-edit", layout: "grid", limit: 8 },
      {
        type: "deal",
        id: "ar-deal",
        title: "Watch of the week",
        text: "Clean white dial, slim 38 mm steel case, a mesh strap sized to your wrist at the shop. One-year warranty.",
        productId: product("Steel mesh-strap analog watch, white dial"),
      },
      { type: "collection", id: "ar-under-999", title: "Accessories under ₹999", collectionSlug: "accessories-under-999", layout: "carousel", limit: 16 },
      {
        type: "image-text",
        id: "ar-festive",
        imageUrl: photo(13222257, "tile"),
        imageSide: "left",
        heading: "The festive and ethnic edit",
        markdown:
          "Pure silk veshtis with zari borders, veshti-and-shirt sets for Fridays, silk kurtas and Nehru jackets for the reception, and an oud evening scent to go with them.\n\n- Veshtis folded and tied for you at the shop\n- Kurta and Nehru jacket sizes 38–46\n- Gift-wrapped free for Deepavali and Pongal",
        cta: { label: "Shop festive & ethnic", href: "/collections/festive-ethnic" },
        style: { background: "brand", padding: "spacious" },
      },
      { type: "collection", id: "ar-festive-shelf", title: "Festive picks", collectionSlug: "festive-ethnic", layout: "carousel", limit: 10 },
      {
        type: "product-tabs",
        id: "ar-best",
        title: "Bestsellers",
        layout: "carousel",
        limit: 10,
        tabs: [
          { label: "All", source: "collection", collectionSlug: "bestsellers" },
          { label: "Shirts", source: "collection", collectionSlug: "shirts" },
          { label: "Leather goods", source: "collection", collectionSlug: "leather-goods" },
          { label: "Gifts for him", source: "collection", collectionSlug: "gifts-for-him" },
        ],
      },
      {
        type: "image-text",
        id: "ar-fit",
        imageUrl: photo(6764997, "tile"),
        imageSide: "left",
        heading: "Fit first: sizes, fits and alterations",
        markdown:
          "Shirts come in **S to XXL** and two fits: **Slim**, tapered through the waist, and **Regular**, straight with a little more room. Trousers and jeans run **waist 28 to 40** and come unhemmed, so they fit your length, not ours.\n\n- Trouser hemming **free**, done while you wait\n- Shirt tapering ₹250, sleeves ₹150\n- Belt size = trouser waist + 2",
        cta: { label: "Open the size guide", href: "/pages/size-guide" },
      },
      {
        type: "stats",
        id: "ar-stats",
        title: "Cross Cut Road since 1988",
        items: [
          { value: 38, suffix: " yrs", label: "On Cross Cut Road" },
          { value: 14, label: "Kinds of accessories" },
          { value: 30, suffix: " min", label: "Trouser hemming, while you wait" },
          { value: 15, suffix: " days", label: "Easy exchange" },
        ],
        style: { background: "dark" },
      },
      {
        type: "testimonials",
        id: "ar-testimonials",
        title: "Fitted at Arasan",
        layout: "cards",
        items: [
          { quote: "Bought three formal shirts and two chinos before my first job. They hemmed the chinos while I had a coffee, and the slim fit finally fits my shoulders.", name: "Karthik R.", role: "Software engineer, Saravanampatti", rating: 5 },
          { quote: "Silk veshti for my brother's wedding, a Nehru jacket for the reception and cufflinks for the groom. One shop, one bill, everything matched.", name: "Senthil Kumar", role: "Pollachi", rating: 5 },
          { quote: "Ordered a wallet and a watch as a gift to Chennai. Came gift-wrapped with my note in two days, and the COD was smooth.", name: "Priya N.", role: "Chennai", rating: 5 },
        ],
      },
      { type: "faq", id: "ar-faq", title: "Fit, exchange and delivery", items: FAQ },
      {
        type: "location",
        id: "ar-location",
        title: "Visit us on Cross Cut Road",
        address: "112, Cross Cut Road, Gandhipuram, Coimbatore 641012",
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "11.0176, 76.9628",
      },
      {
        type: "newsletter",
        id: "ar-newsletter",
        layout: "inline",
        heading: "New arrivals, once a fortnight",
        text: "New shirts and accessories as they land, and first word on the season sale. No spam.",
      },
    ],
    translations: {
      ta: {
        "ar-hero": {
          eyebrow: "புதிய சீசன் · கிராஸ் கட் ரோடு, கோவை",
          heading: "கச்சிதமான சட்டைகள். சிறந்த பேண்ட்கள். எல்லா அக்சசரிகளும்.",
          text: "இந்த சீசனின் சட்டைகள் ஸ்லிம், ரெகுலர் ஃபிட்களில், காத்திருக்கும்போதே இலவசமாக ஹெம் செய்யும் சினோஸ், லுக்கை முழுமையாக்கப் பதினான்கு வகை அக்சசரிகள். ARASAN10 கோடுடன் முதல் ஆர்டருக்கு 10% தள்ளுபடி.",
          cta: { label: "புதிய சீசன்" },
          cta2: { label: "உங்கள் ஃபிட்" },
        },
        "ar-clothing": { title: "ஆடைகள்" },
        "ar-look": {
          title: "முழு லுக்",
          text: "நேவி மைக்ரோ-பிரிண்ட் சட்டை, கிரே செக் பேண்ட், இருபக்க லெதர் பெல்ட், ஸ்டீல் வாட்ச். ஒவ்வொன்றையும் வாங்கப் புள்ளியைத் தொடுங்கள்.",
          alt: "கருப்பு பெல்ட், ஸ்டீல் வாட்சுடன் நேவி பிரிண்ட் சட்டை",
        },
        "ar-accessories": { title: "அக்சசரிகள், பதினான்கும்" },
        "ar-office": { title: "அலுவலகத் தேர்வு" },
        "ar-deal": { title: "இந்த வார வாட்ச்", text: "சன்பர்ஸ்ட் நீல டயல், 40 மி.மீ ஸ்டீல், கடையில் உங்கள் மணிக்கட்டுக்கு ஏற்ப அளவு சரிசெய்வோம். ஒரு வருட வாரண்டி." },
        "ar-under-999": { title: "₹999-க்குள் அக்சசரிகள்" },
        "ar-festive": {
          heading: "பண்டிகை, பாரம்பரியத் தேர்வு",
          markdown:
            "ஜரிகை பார்டருடன் சுத்தப் பட்டு வேட்டிகள், வெள்ளிக்கிழமைகளுக்கு வேட்டி-சட்டை செட்டுகள், வரவேற்புக்குப் பட்டு குர்தாக்கள், நேரு ஜாக்கெட்டுகள், அவற்றுடன் ஒரு ஊத் மாலை நறுமணம்.\n\n- கடையில் வேட்டியை மடித்துக் கட்டிக் காட்டுவோம்\n- குர்தா, நேரு ஜாக்கெட் அளவுகள் 38–46\n- தீபாவளி, பொங்கலுக்கு இலவச கிஃப்ட் ராப்",
          cta: { label: "பண்டிகைத் தேர்வு" },
        },
        "ar-festive-shelf": { title: "பண்டிகைத் தேர்வுகள்" },
        "ar-best": { title: "அதிகம் விற்பவை", tabs: [{ label: "அனைத்தும்" }, { label: "சட்டைகள்" }, { label: "லெதர் பொருட்கள்" }, { label: "அவருக்குப் பரிசு" }] },
        "ar-fit": {
          heading: "முதலில் ஃபிட்: அளவுகள், ஃபிட்கள், ஆல்டரேஷன்",
          markdown:
            "சட்டைகள் **S முதல் XXL** வரை, இரண்டு ஃபிட்களில்: இடுப்பில் குறுகிய **ஸ்லிம்**, சற்று அதிக இடத்துடன் நேரான **ரெகுலர்**. பேண்ட்களும் ஜீன்ஸும் **இடுப்பு 28 முதல் 40** வரை, ஹெம் செய்யாமல் வருகின்றன; அதனால் உங்கள் உயரத்துக்கே பொருந்தும்.\n\n- பேண்ட் ஹெம்மிங் **இலவசம்**, காத்திருக்கும்போதே\n- சட்டை டேப்பரிங் ₹250, கை ₹150\n- பெல்ட் அளவு = பேண்ட் இடுப்பு + 2",
          cta: { label: "அளவு வழிகாட்டி" },
        },
        "ar-stats": {
          title: "1988 முதல் கிராஸ் கட் ரோட்டில்",
          items: [stat("கிராஸ் கட் ரோட்டில்"), stat("அக்சசரி வகைகள்"), stat("பேண்ட் ஹெம்மிங், காத்திருக்கும்போதே"), stat("எளிய மாற்றம்")],
        },
        "ar-testimonials": {
          title: "அரசனில் அளவெடுத்தவர்கள்",
          items: [
            { quote: "முதல் வேலைக்கு முன் மூன்று ஃபார்மல் சட்டைகளும் இரண்டு சினோஸும் வாங்கினேன். நான் காபி குடிப்பதற்குள் சினோஸை ஹெம் செய்து தந்தார்கள்; ஸ்லிம் ஃபிட் இறுதியாக என் தோளுக்குப் பொருந்துகிறது.", role: "மென்பொருள் பொறியாளர், சரவணம்பட்டி" },
            { quote: "தம்பியின் திருமணத்துக்குப் பட்டு வேட்டி, வரவேற்புக்கு நேரு ஜாக்கெட், மாப்பிள்ளைக்குக் கஃப்லிங்க்ஸ். ஒரே கடை, ஒரே பில், எல்லாம் பொருத்தமாக.", role: "பொள்ளாச்சி" },
            { quote: "சென்னைக்குப் பரிசாக ஒரு வாலட்டும் வாட்சும் ஆர்டர் செய்தேன். இரண்டு நாளில் என் குறிப்புடன் கிஃப்ட் ராப் செய்து வந்தது; COD சுலபமாக இருந்தது.", role: "சென்னை" },
          ],
        },
        "ar-faq": { title: "ஃபிட், மாற்றம், டெலிவரி", items: FAQ_TA },
        "ar-location": {
          title: "கிராஸ் கட் ரோட்டில் எங்களைச் சந்தியுங்கள்",
          address: "112, கிராஸ் கட் ரோடு, காந்திபுரம், கோயம்புத்தூர் 641012",
          hours: [
            { label: "தினமும்", value: "காலை 10:00 – இரவு 9:30" },
            { label: "ஆல்டரேஷன் மேசை", value: "காலை 10:30 – இரவு 8:30" },
          ],
        },
        "ar-newsletter": { heading: "இரண்டு வாரத்துக்கு ஒருமுறை புதிய வரவுகள்", text: "புதிய சட்டைகளும் அக்சசரிகளும் வந்தவுடன், சீசன் சேல் பற்றி முதல் தகவல். ஸ்பேம் இல்லை." },
      },
    },
  }),
  pages: [
    {
      slug: "about",
      title: "Our story",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Arasan Menswear, Cross Cut Road, since 1988" },
        {
          type: "paragraph",
          markdown:
            "Arasan (அரசன்) means king. Our father opened a twelve-foot shirt counter on **Cross Cut Road** in 1988 with one promise: every man who walks in leaves with something that fits. Thirty-eight years on we fill three floors, but the alterations desk is still next to the billing counter, and trouser hemming is still free.\n\nOur shirts and T-shirts are cut in Tiruppur and Coimbatore, our belts and wallets come from Chennai and Ambur tanneries, and our perfumes from Kannauj. We stock every men's accessory under one roof so that a groom, a new graduate or a man buying a gift can finish the whole look in one visit.",
        },
        { type: "image", url: photo(31318445, "tile"), alt: "Menswear store with folded shirts on a table" },
        { type: "paragraph", markdown: "Open every day, 10:00 am – 9:30 pm. Call or WhatsApp **+91 98765 00066**." },
      ],
    },
    {
      slug: "size-guide",
      title: "Size guide: shirts, trousers, belts",
      blocks: () => [
        { type: "heading", level: 2, text: "Shirts (S–XXL, slim and regular)" },
        {
          type: "paragraph",
          markdown: `Measure round the fullest part of your chest, under the arms, with the tape level. Pick the size whose "fits chest" range holds your measurement; between two, take Regular in the smaller size or Slim in the larger.\n\n${SHIRT_TABLE}`,
        },
        { type: "heading", level: 2, text: "Trousers, chinos and jeans (waist 28–40)" },
        {
          type: "paragraph",
          markdown: `Measure where you wear your trousers, not your natural waist. All trousers come with a 34-inch unhemmed inseam: we hem them free at the shop, or before dispatch if you tell us your inseam (the inside leg of a pair that fits, crotch seam to hem).\n\n${TROUSER_TABLE}`,
        },
        { type: "heading", level: 2, text: "Belts (30–42)" },
        { type: "paragraph", markdown: `Belt size = trouser waist + 2. Five holes an inch apart; the tag size is the middle hole.\n\n${BELT_TABLE}` },
        { type: "heading", level: 2, text: "Blazers and Nehru jackets (chest 38–46)" },
        { type: "paragraph", markdown: `Measured over a shirt. Sleeves are shortened free with a blazer.\n\n${BLAZER_TABLE}` },
        { type: "button", label: "Ask us your size on WhatsApp", href: waLink(FIT_TEXT), style: "primary" },
      ],
    },
    {
      slug: "alterations",
      title: "Alterations",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Made to fit, at the shop" },
        {
          type: "paragraph",
          markdown:
            "Our alterations desk on the ground floor has two tailors from 10:30 am to 8:30 pm. Bring anything you bought from us; online orders can be hemmed before we dispatch them.\n\n| Alteration | Price | Time |\n|---|---|---|\n| Trouser and jeans hemming | Free | 30 minutes |\n| Waist in or out (up to 1.5 in) | ₹200 | Same day |\n| Shirt tapering (sides) | ₹250 | Same day |\n| Sleeve shortening, shirt | ₹150 | Same day |\n| Blazer sleeves | Free with a blazer, else ₹400 | 2 days |\n| Kurta length | ₹200 | Same day |",
        },
        { type: "image", url: photo(5264929, "tile"), alt: "Tailor measuring a jacket in a store" },
        { type: "paragraph", markdown: "Altered pieces can't be returned, so try them on at the desk before you leave; we redo anything that isn't right, free." },
        { type: "button", label: "Book an alteration on WhatsApp", href: waLink(ALTER_TEXT), style: "primary" },
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
      { label: "Clothing", type: "category", ref: catSlug(CLOTHING), children: [FORMAL, CASUAL, TROUSERS, JEANS, TEES, BLAZERS, INNER].map((c) => ({ label: c, type: "category" as const, ref: catSlug(c) })) },
      { label: "Accessories", type: "category", ref: catSlug(ACCESSORIES), children: ACCESSORY_CATS.map((c) => ({ label: c, type: "category" as const, ref: catSlug(c) })) },
      // Three items besides "Shop": longer Tamil labels in the bar must not run under the search box.
      { label: "Ethnic", type: "category", ref: catSlug(ETHNIC) },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Size guide", type: "page", ref: "size-guide" },
          { label: "Alterations", type: "page", ref: "alterations" },
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Arasan",
        type: "url",
        children: [
          { label: "Complete the look", type: "collection", ref: "complete-the-look" },
          { label: "The office edit", type: "collection", ref: "office-edit" },
          { label: "Gifts for him", type: "collection", ref: "gifts-for-him" },
          { label: "Accessories under ₹999", type: "collection", ref: "accessories-under-999" },
          { label: "Our story", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
