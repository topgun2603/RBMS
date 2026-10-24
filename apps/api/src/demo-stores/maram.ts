import type { DemoProduct, DemoStore } from "./types";

/**
 * Store #14 of the series: Maram Furniture & Woodworks, Coimbatore (maram.localhost:3003). A furniture showroom on
 * Avinashi Road with its own carpentry workshop in Podanur, on the online store app (EC) with the `furniture` trade
 * and the "walnut-linen" look. Maram (மரம்) is Tamil for wood / tree. The shop sells sofas (3-seater, L-shape,
 * recliners; fabric colours), beds (queen / king, with or without storage) and mattresses (orthopaedic, memory foam,
 * pocket spring, rubberised coir; four sizes), wardrobes (2/3/4-door), dining sets, TV units and coffee tables, office
 * chairs and desks, kids' furniture, balcony furniture (rattan, rope weave, a macramé swing chair) and Chettinad-style
 * pieces (the saaru naarkali easy chair, a teak oonjal). Names are generic (no brands); prices are typical Coimbatore
 * showroom prices in October 2026, GST included. Address, phone and GSTIN are placeholders like the other demo shops.
 *
 * Every product carries Dimensions (W × D × H cm), Material, Finish, Assembly, Warranty and Delivery & installation
 * attributes; options are size, finish / wood, fabric colour, configuration or mechanism. Delivery and installation by
 * our own team are free in Coimbatore city above ₹20,000 (zones below); other installation work is a billing item.
 *
 * GST (CGST notification 9/2025-Central Tax (Rate) of 17 Sept 2025, in force from 22 Sept 2025, which replaced the
 * 1/2017 schedules; rates read from secondary summaries of the notification, as flagged):
 * - Wooden furniture: beds, wardrobes, TV units, tables, dining sets, desks, the oonjal (9403 30 / 50 / 60, and 9403 10
 *   for metal-legged office desks): 18%, unchanged (Schedule III).
 * - Seats with wooden or metal frames: sofas, recliners, armchairs, the Chettinad easy chair, rope-weave chairs (9401
 *   61 / 69 / 71 / 80), swivel office chairs (9401 30 00): 18%. UNCERTAIN: summaries of the notification mention 5%
 *   for "handicraft" wooden furniture; a hand-made easy chair could be argued as a handicraft. We charge 18% as a
 *   showroom piece, not a certified handicraft.
 * - Furniture and seats wholly of cane / rattan / bamboo (9401 53, 9403 83): 5% (down from 12%; Schedule I). The rattan
 *   balcony set and the peacock chair qualify; a cane seat on a teak frame does not ("wholly made" is the test).
 * - Mattresses of foam or springs (9404 21 / 29): 18%, unchanged. Rubberised coir mattress (9404 29, "of rubberised
 *   coir"): 5% — UNCERTAIN: the coir line moved down from 12% in the summaries we read; check the notification's
 *   Schedule I entry before invoicing.
 * - Installation / assembly services (SAC 998729 / 995468 as used by furniture fitters): 18%.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500041";
const WHATSAPP = "919876500041";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

/** Variants of two options: price ₹ of each combination (MRP is 12% above, rounded to ₹100). */
function two(o1: string, v1: string[], o2: string, v2: string[], price: (a: string, b: string) => number, stock = 3): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [
      { name: o1, values: v1 },
      { name: o2, values: v2 },
    ],
    variants: v1.flatMap((a) =>
      v2.map((b) => {
        const p = price(a, b);
        return { values: { [o1]: a, [o2]: b }, price: rs(p), mrp: rs(Math.ceil((p * 1.12) / 100) * 100), stock };
      }),
    ),
  };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

/** Mattress sizes in inches (Indian sizes), with the price of each. */
const MATTRESS_SIZES = ["Single 72×36 in", "Double 72×48 in", "Queen 78×60 in", "King 78×72 in"];
const mattress = (prices: [number, number, number, number], mrpUp = 1.25) =>
  one(
    "Size",
    MATTRESS_SIZES.map((s, i) => [s, prices[i]!, Math.ceil((prices[i]! * mrpUp) / 100) * 100, [8, 6, 10, 6][i]!] as [string, number, number, number]),
  );

const SOFAS = "Sofas";
const LIVING = "Living room";
const BEDS = "Beds & mattresses";
const MATTRESSES = "Mattresses";
const WARDROBES = "Wardrobes";
const DINING = "Dining sets";
const OFFICE = "Office chairs & desks";
const KIDS = "Kids' furniture";
const BALCONY = "Balcony & outdoor";
const HERITAGE = "Chettinad heritage";

const CITY = "Free delivery and installation in Coimbatore city above ₹20,000; Tiruppur, Erode and Pollachi in 3–6 days; the rest of Tamil Nadu by our truck in 7–12 days.";
const TEAK = "\n\nMade in our Podanur workshop from seasoned teak (Nilambur and Burma plantation stock), kiln-dried to 10–12% moisture so it doesn't crack in the Coimbatore dry season, joined with mortise and tenon and finished in hand-rubbed PU.";
const INSPECT = " Check it with our fitter at delivery: anything damaged in transit is replaced, and you can still report transit damage within 48 hours with photos.";

/** The common attributes of a piece. */
const attrs = (dims: string, material: string, finish: string, assembly: string, warranty: string, extra: Record<string, string> = {}) => ({
  "Dimensions (W × D × H)": dims,
  Material: material,
  Finish: finish,
  Assembly: assembly,
  Warranty: warranty,
  "Delivery & installation": CITY,
  ...extra,
});

const PRODUCTS: DemoProduct[] = [
  // ---- sofas (9401 61 / 71: seats with wooden or metal frames, upholstered — 18%)
  {
    name: "Kovai 3-seater fabric sofa, teak frame",
    category: SOFAS,
    hsn: "94016100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-S3F",
    photo: 8135269,
    tags: ["bestseller", "fabric", "medium-room", "large-room", "teak", "ready-stock"],
    description: `Our everyday 3-seater: a teak frame, 32-density seat foam over sinuous springs, fibre-filled back cushions and soft curved arms. The covers zip off for a dry clean before Pongal.${TEAK}${INSPECT}`,
    attributes: attrs("210 × 88 × 86 cm (seat height 44 cm)", "Teak frame, HR foam on sinuous springs, polyester blend fabric", "Fabric in four colours, teak legs in walnut stain", "Delivered assembled; legs fitted at your home", "5 years on the frame, 1 year on foam and fabric", { Seats: "3" }),
    ...one("Fabric colour", [
      ["Mist blue", 38_900, 46_500, 3],
      ["Linen beige", 38_900, 46_500, 4],
      ["Sage green", 38_900, 46_500, 2],
      ["Charcoal grey", 38_900, 46_500, 3],
    ]),
  },
  {
    name: "L-shape sectional sofa with chaise",
    category: SOFAS,
    hsn: "94016100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-SLS",
    photo: 12289394,
    tags: ["fabric", "large-room", "made-to-order", "bestseller"],
    description: `Five seats and a chaise to stretch out on: deep 60 cm seats, a low back and box cushions that stay square. Tell us which wall the chaise goes on; we measure your hall before we build it.${TEAK}${INSPECT}`,
    attributes: attrs("290 × 165 × 82 cm (chaise depth 165 cm)", "Teak and pine frame, HR foam, textured weave fabric", "Fabric in two colours", "Delivered in three parts, joined at your home (30 minutes)", "5 years on the frame, 1 year on foam and fabric", { Seats: "5", "Made to order": "18–21 days" }),
    ...two("Configuration", ["Left chaise", "Right chaise"], "Fabric colour", ["Charcoal grey", "Linen beige"], () => 72_500, 2),
  },
  {
    name: "Leatherette 3-seater sofa, button back",
    category: SOFAS,
    hsn: "94016100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-SLT",
    photo: 6480707,
    tags: ["leatherette", "medium-room", "large-room", "ready-stock"],
    description: `A slim tan sofa with a buttoned back and tapered teak legs: wipes clean (good with children and pets) and looks right in a flat or a doctor's waiting room.${TEAK}${INSPECT}`,
    attributes: attrs("196 × 84 × 80 cm", "Teak frame, PU leatherette, 40-density foam", "Tan or espresso leatherette, teak legs", "Delivered assembled", "3 years on the frame, 1 year on leatherette", { Seats: "3" }),
    ...one("Colour", [
      ["Tan", 42_000, 49_900, 3],
      ["Espresso", 42_000, 49_900, 2],
    ]),
  },
  {
    name: "Velvet 2-seater sofa, teak legs",
    category: SOFAS,
    hsn: "94016100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-SV2",
    photo: 4846097,
    tags: ["fabric", "compact-room", "medium-room", "small-homes", "ready-stock"],
    description: `A compact two-seater in soft velvet for a 2BHK hall or a bedroom corner, with a tight back, loose seat cushions and slender legs that keep the floor visible (the room looks bigger).${TEAK}${INSPECT}`,
    attributes: attrs("150 × 82 × 84 cm", "Teak frame, HR foam, cotton-backed velvet", "Velvet in three colours, walnut-stained legs", "Delivered assembled", "5 years on the frame, 1 year on foam and fabric", { Seats: "2" }),
    ...one("Fabric colour", [
      ["Bottle green", 29_500, 34_900, 3],
      ["Mustard", 29_500, 34_900, 2],
      ["Navy", 29_500, 34_900, 2],
    ]),
  },
  {
    name: "Single recliner chair",
    category: SOFAS,
    hsn: "94017100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-RC1",
    photo: 33100828,
    tags: ["recliner", "compact-room", "medium-room", "large-room", "bestseller"],
    description: `For Appa's evening news: a deep, padded recliner that leans back to 160° with the footrest up. The motorised one has a wired remote and a USB port; both need just 15 cm from the wall.${INSPECT}`,
    attributes: attrs("88 × 95 × 104 cm (reclined length 165 cm)", "Steel mechanism, pine frame, fabric-look suede", "Dove grey", "Delivered assembled; plug in and use", "3 years on the mechanism, 1 year on fabric", { Seats: "1" }),
    ...one("Mechanism", [
      ["Manual (lever)", 24_900, 29_900, 4],
      ["Motorised", 34_900, 41_500, 2],
    ]),
  },
  {
    name: "2-seater recliner sofa, leatherette",
    category: SOFAS,
    hsn: "94017100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-RC2",
    photo: 6933860,
    tags: ["recliner", "leatherette", "medium-room", "large-room"],
    description: `Two recliners in one sofa, on a slim chrome base: each seat reclines on its own, so one can sleep through the cricket while the other watches it.${INSPECT}`,
    attributes: attrs("172 × 98 × 100 cm", "Steel mechanism, hardwood frame, PU leatherette", "Graphite grey leatherette, chrome base", "Delivered assembled", "3 years on the mechanism, 1 year on leatherette", { Seats: "2" }),
    ...one("Mechanism", [
      ["Manual (lever)", 58_000, 66_900, 2],
      ["Motorised", 74_000, 84_900, 1],
    ]),
  },
  {
    name: "Sofa cum bed, 3-seater",
    category: SOFAS,
    hsn: "94014100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-SCB",
    photo: 6934180,
    tags: ["fabric", "compact-room", "medium-room", "small-homes"],
    description: `A sofa by day and a 72 × 54 in bed when your relatives come for the kumbabishekam: the seat pulls out on a steel slide, and the box under it holds the bedsheets.${TEAK}${INSPECT}`,
    attributes: attrs("200 × 90 × 84 cm (bed 183 × 137 cm)", "Teak and steel frame, HR foam, chenille fabric", "Fabric in two colours", "Delivered assembled", "3 years on the frame and slide, 1 year on fabric", { Seats: "3" }),
    ...one("Fabric colour", [
      ["Dusty rose", 27_800, 32_900, 3],
      ["Grey", 27_800, 32_900, 3],
    ]),
  },

  // ---- living room (9403 60: other wooden furniture — 18%; 9401 61 armchair)
  {
    name: "Floating TV console, walnut finish",
    category: LIVING,
    hsn: "94036000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-TVF",
    photo: 6297080,
    tags: ["small-homes", "ready-stock"],
    description: `A wall-hung TV console with two flap doors and a cable channel: the floor stays free for mopping and the wires disappear. Takes TVs up to 65 in on the wall above.\n\nOur fitter drills and mounts it on brick or concrete walls (included in Coimbatore).${INSPECT}`,
    attributes: attrs("150 or 180 × 35 × 30 cm", "18 mm BWP plywood, walnut veneer", "Walnut veneer, matt PU", "Wall-mounted by our fitter", "3 years"),
    ...one("Width", [
      ["150 cm", 14_500, 17_500, 5],
      ["180 cm", 16_900, 19_900, 4],
    ]),
  },
  {
    name: "Wall TV unit with shelves",
    category: LIVING,
    hsn: "94036000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-TVW",
    photo: 6489106,
    tags: ["made-to-order", "large-room"],
    description: `A full TV wall: low drawers, a back panel for the TV and open and closed shelves above for the brass lamps and the wedding album. Built to your wall's width after we measure it.${INSPECT}`,
    attributes: attrs("240 × 40 × 210 cm (made to your wall)", "BWP plywood, laminate and veneer", "Two-tone finishes", "Installed by our carpenters (half a day)", "5 years", { "Made to order": "21 days after measuring" }),
    ...one("Finish", [
      ["Walnut and white", 32_000, 37_900, 2],
      ["Oak and grey", 32_000, 37_900, 2],
    ]),
  },
  {
    name: "Sheesham coffee table with storage",
    category: LIVING,
    hsn: "94036000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-CTS",
    photo: 30440152,
    tags: ["bestseller", "ready-stock"],
    description: `A low solid sheesham table on splayed legs, with a shelf underneath for the newspapers and the TV remotes. Heavy enough that children can't tip it.\n\nSheesham (Indian rosewood) from Jodhpur mills, finished in our workshop.${INSPECT}`,
    attributes: attrs("120 × 60 × 42 cm", "Solid sheesham wood", "Natural or walnut, matt PU", "Delivered assembled", "3 years"),
    ...one("Finish", [
      ["Natural", 12_800, 15_500, 5],
      ["Walnut", 12_800, 15_500, 4],
    ]),
  },
  {
    name: "Round teak coffee table",
    category: LIVING,
    hsn: "94036000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-CTR",
    photo: 7607460,
    tags: ["teak", "small-homes", "ready-stock"],
    description: `A round top of edge-glued teak strips on a black steel base: no corners to bump into in a small hall, and the grain gets richer every year.${TEAK}${INSPECT}`,
    attributes: attrs("75 or 90 cm diameter × 40 cm", "Teak top, powder-coated steel base", "Natural teak, oil finish", "Base screwed on at delivery", "3 years"),
    ...one("Size", [
      ["75 cm", 11_500, 13_900, 4],
      ["90 cm", 13_900, 16_500, 3],
    ]),
  },
  {
    name: "Accent armchair, curved teak arms",
    category: LIVING,
    hsn: "94016100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-ACA",
    photo: 7195553,
    tags: ["fabric", "compact-room", "medium-room", "teak"],
    description: `A reading chair with steam-bent teak arms that run into the legs, a padded back and a lumbar cushion. Pairs with any of our sofas.${TEAK}${INSPECT}`,
    attributes: attrs("72 × 76 × 78 cm", "Teak frame, HR foam, textured fabric", "Fabric in two colours, natural teak", "Delivered assembled", "5 years on the frame, 1 year on fabric", { Seats: "1" }),
    ...one("Fabric colour", [
      ["Grey", 18_500, 21_900, 3],
      ["Navy", 18_500, 21_900, 2],
    ]),
  },

  // ---- beds (9403 50: wooden bedroom furniture — 18%)
  {
    name: "Chettinad carved teak bed",
    category: BEDS,
    hsn: "94035010",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-BCT",
    photo: 8135289,
    tags: ["chettinad", "teak", "made-to-order", "bestseller"],
    description: `Our signature cot: a high headboard and footboard with Chettinad-style carving (lotus, creeper and the athangudi rosette), turned legs and a 2-inch teak frame that will see your grandchildren. With storage, the base lifts on gas struts over a full-size box.${TEAK}\n\nCarved by hand by our two senior carvers: allow 25–30 days.${INSPECT}`,
    attributes: attrs("Queen 168 × 212 × 120 cm, King 198 × 212 × 120 cm", "Solid teak", "Honey teak, hand-rubbed PU", "Assembled at your home (about 1 hour)", "10 years on the frame", { "Made to order": "25–30 days" }),
    ...two("Size", ["Queen (78×60 in)", "King (78×72 in)"], "Storage", ["No storage", "Hydraulic box storage"], (s, st) => (s.startsWith("Queen") ? 92_000 : 1_04_000) + (st === "No storage" ? 0 : 12_000), 2),
  },
  {
    name: "Upholstered bed with hydraulic storage",
    category: BEDS,
    hsn: "94035090",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-BUH",
    photo: 6301179,
    tags: ["storage", "small-homes", "ready-stock"],
    description: `A buttoned, padded headboard and a base that lifts on two gas struts: the whole space under the mattress holds suitcases and the festival vessels. The best bed for a 2BHK without a loft.${INSPECT}`,
    attributes: attrs("Queen 172 × 215 × 110 cm, King 202 × 215 × 110 cm", "Engineered wood base, pine headboard frame, fabric", "Headboard fabric in two colours", "Assembled at your home (about 1 hour)", "5 years on the frame, 2 years on the struts"),
    ...two("Size", ["Queen (78×60 in)", "King (78×72 in)"], "Headboard colour", ["Ash grey", "Beige"], (s) => (s.startsWith("Queen") ? 46_500 : 52_500), 3),
  },
  {
    name: "Sheesham platform bed, low",
    category: BEDS,
    hsn: "94035010",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-BSP",
    photo: 545012,
    tags: ["ready-stock", "small-homes"],
    description: `A low, plain bed in solid sheesham with a slatted headboard and a slatted base that lets the mattress breathe in the humid months. No storage, nothing to break.${INSPECT}`,
    attributes: attrs("Queen 166 × 208 × 90 cm, King 196 × 208 × 90 cm", "Solid sheesham wood", "Natural, matt PU", "Assembled at your home (40 minutes)", "5 years"),
    ...one("Size", [
      ["Queen (78×60 in)", 34_500, 40_900, 3],
      ["King (78×72 in)", 39_500, 46_900, 3],
    ]),
  },
  {
    name: "Bedside table with cane drawer",
    category: BEDS,
    hsn: "94035090",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-BST",
    photo: 31967700,
    tags: ["teak", "ready-stock", "small-homes"],
    description: `A small teak bedside table with a woven cane drawer front and an open shelf for the phone charger and your glasses.${TEAK}${INSPECT}`,
    attributes: attrs("45 × 38 × 52 cm", "Teak, hand-woven cane", "Natural or walnut", "Delivered assembled", "3 years"),
    ...one("Finish", [
      ["Natural", 6_900, 8_200, 8],
      ["Walnut", 6_900, 8_200, 6],
    ]),
  },

  // ---- mattresses (9404 21 foam 18%, 9404 29 springs 18%, rubberised coir 5% — see the header)
  {
    name: "Orthopaedic mattress, firm",
    category: MATTRESSES,
    hsn: "94042100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-MOR",
    photo: 6489082,
    tags: ["bestseller", "mattress", "ready-stock"],
    description: `Firm support for back pain: a 6-inch core of 80-density bonded foam under 1.5 in of HR foam and a quilted, zip-off knitted cover. Doesn't sag in the middle, even for two people of different weights.\n\nRotate it head-to-foot every three months for the first year.${INSPECT}`,
    attributes: {
      Feel: "Firm",
      Thickness: "8 in (20 cm)",
      Material: "Bonded foam core, HR foam comfort layer, knitted cover",
      Assembly: "Delivered rolled flat; no assembly",
      Warranty: "10 years against sagging over 2.5 cm",
      "Delivery & installation": CITY,
    },
    ...mattress([13_900, 18_500, 21_900, 25_900]),
  },
  {
    name: "Memory foam mattress, medium",
    category: MATTRESSES,
    hsn: "94042100",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-MMF",
    photo: 7598140,
    tags: ["mattress", "ready-stock"],
    description: `Gel-infused memory foam that moulds to the shoulder and hip, over a high-resilience base: for side sleepers. The gel and an open-cell top keep it cooler than plain memory foam in a Coimbatore summer.${INSPECT}`,
    attributes: {
      Feel: "Medium",
      Thickness: "8 in (20 cm)",
      Material: "Gel memory foam, HR foam base, bamboo-blend cover",
      Assembly: "Delivered rolled; opens in 24 hours",
      Warranty: "10 years",
      "Delivery & installation": CITY,
    },
    ...mattress([15_900, 21_500, 24_900, 28_900]),
  },
  {
    name: "Pocket spring mattress, plush top",
    category: MATTRESSES,
    hsn: "94042900",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-MPS",
    photo: 7227615,
    tags: ["mattress"],
    description: `Individually pocketed springs (about 600 in a queen) under a plush pillow top: bouncy, airy and quiet, and your partner turning over doesn't wake you.${INSPECT}`,
    attributes: {
      Feel: "Medium-soft",
      Thickness: "10 in (25 cm)",
      Material: "Pocketed steel springs, foam encasement, pillow top",
      Assembly: "Delivered flat; no assembly",
      Warranty: "8 years",
      "Delivery & installation": CITY,
    },
    ...mattress([17_900, 24_500, 28_900, 33_500]),
  },
  {
    name: "Rubberised coir mattress",
    category: MATTRESSES,
    hsn: "94042900",
    gstRate: 5,
    unit: "pcs",
    sku: "MR-MCO",
    photo: 6585740,
    tags: ["mattress", "ready-stock", "made-in-tn"],
    description: `The traditional Tamil Nadu mattress: rubberised coconut coir from Pollachi, firm and airy, with a thin foam layer on top so it isn't hard. Doesn't trap heat; the one your grandparents slept on, made better.${INSPECT}`,
    attributes: {
      Feel: "Firm, airy",
      Thickness: "6 in (15 cm)",
      Material: "Rubberised coir from Pollachi, 1 in foam, cotton cover",
      Assembly: "Delivered flat; no assembly",
      Warranty: "5 years",
      "Delivery & installation": CITY,
    },
    ...mattress([7_900, 10_500, 12_500, 14_900]),
  },

  // ---- wardrobes and the dressing table (9403 50 — 18%)
  {
    name: "2-door wardrobe with mirror",
    category: WARDROBES,
    hsn: "94035090",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-W2D",
    photo: 6508349,
    tags: ["small-homes", "ready-stock"],
    description: `A 2-door wardrobe with a full-length mirror inside one door, a hanging rail, four shelves and a locker drawer for the jewellery box.${INSPECT}`,
    attributes: attrs("90 × 55 × 200 cm", "18 mm BWP plywood carcass, laminate shutters", "White or walnut laminate", "Assembled at your home (1–2 hours)", "5 years, soft-close hinges 3 years", { Doors: "2" }),
    ...one("Finish", [
      ["White", 21_500, 25_900, 4],
      ["Walnut", 21_500, 25_900, 3],
    ]),
  },
  {
    name: "3-door wardrobe with drawers",
    category: WARDROBES,
    hsn: "94035090",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-W3D",
    photo: 2708106,
    tags: ["ready-stock", "bestseller"],
    description: `Three doors: a long-hanging section for sarees and veshtis, a double rail for shirts and four drawers, two of them with locks. Handle-less push-to-open doors.${INSPECT}`,
    attributes: attrs("135 × 58 × 210 cm", "18 mm BWP plywood, laminate shutters", "Slate grey or ivory matt laminate", "Assembled at your home (2 hours)", "5 years", { Doors: "3" }),
    ...one("Finish", [
      ["Slate grey", 31_800, 37_900, 3],
      ["Ivory", 31_800, 37_900, 3],
    ]),
  },
  {
    name: "4-door sliding wardrobe",
    category: WARDROBES,
    hsn: "94035090",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-W4S",
    photo: 38697207,
    tags: ["made-to-order", "large-room"],
    description: `A floor-to-ceiling wardrobe on soft-close sliding tracks: no door swing, so it fits a bedroom with the cot close by. Fittings are chosen with you: rails, trouser pull-outs, a loft above.${INSPECT}`,
    attributes: attrs("240 × 62 × 240 cm (made to your wall)", "BWP plywood, oak or walnut veneer", "Natural oak or walnut veneer", "Installed by our carpenters (one day)", "5 years, sliding gear 5 years", { Doors: "4 (sliding)", "Made to order": "21 days after measuring" }),
    ...one("Finish", [
      ["Natural oak", 54_000, 62_900, 2],
      ["Walnut", 56_500, 64_900, 2],
    ]),
  },
  {
    name: "Teak almirah, antique finish",
    category: WARDROBES,
    hsn: "94035010",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-WTA",
    photo: 15692791,
    tags: ["teak", "chettinad", "made-to-order"],
    description: `A two-door almirah like the ones in Karaikudi houses: solid teak, panelled doors with an antique wash, iron strap hinges and a brass lock with two keys. Shelves inside for the silk sarees and the house papers.${TEAK}${INSPECT}`,
    attributes: attrs("110 × 55 × 195 cm", "Solid teak, iron and brass fittings", "Antique distressed wash", "Delivered assembled", "10 years", { Doors: "2", "Made to order": "25 days" }),
    ...single(68_000, 76_000, 1),
  },
  {
    name: "Dressing table with stool",
    category: WARDROBES,
    hsn: "94035090",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-DTS",
    photo: 7045829,
    tags: ["ready-stock"],
    description: `A dressing table with a shaped mirror, two side drawers for the bindi and bangles, and a padded stool that tucks underneath.${INSPECT}`,
    attributes: attrs("100 × 42 × 160 cm (with mirror)", "Hardwood frame, MDF drawers, mirror glass", "Ivory or walnut", "Mirror fixed at your home", "3 years"),
    ...one("Finish", [
      ["Ivory", 17_500, 20_900, 3],
      ["Walnut", 17_500, 20_900, 2],
    ]),
  },

  // ---- dining (9403 60 — 18%)
  {
    name: "Teak 6-seater dining set",
    category: DINING,
    hsn: "94036000",
    gstRate: 18,
    unit: "set",
    sku: "MR-D6T",
    photo: 3935317,
    tags: ["teak", "bestseller", "made-to-order", "large-room"],
    description: `A solid teak table with six slat-back chairs and cushioned seats: big enough for the Sunday biryani and the homework spread out afterwards. The top is 30 mm teak that takes a hot vessel on a trivet without a mark.${TEAK}${INSPECT}`,
    attributes: attrs("Table 180 × 90 × 76 cm; chairs 45 × 50 × 98 cm", "Solid teak, cotton seat cushions", "Honey teak or walnut, PU", "Table legs fitted at your home", "10 years", { Seats: "6", "Made to order": "20 days" }),
    ...one("Finish", [
      ["Honey teak", 78_000, 88_900, 2],
      ["Walnut", 78_000, 88_900, 2],
    ]),
  },
  {
    name: "Round 4-seater dining set, sheesham",
    category: DINING,
    hsn: "94036000",
    gstRate: 18,
    unit: "set",
    sku: "MR-D4R",
    photo: 8583537,
    tags: ["small-homes", "ready-stock"],
    description: `A 105 cm round table on a pedestal and four high-back chairs: everyone can reach the sambar, and it fits the dining corner of a 2BHK.${INSPECT}`,
    attributes: attrs("Table 105 cm diameter × 76 cm; chairs 46 × 52 × 100 cm", "Solid sheesham, fabric seats", "Walnut, PU", "Pedestal fixed at your home", "5 years", { Seats: "4" }),
    ...single(38_500, 44_900, 3),
  },
  {
    name: "Farmhouse dining set, painted chairs",
    category: DINING,
    hsn: "94036000",
    gstRate: 18,
    unit: "set",
    sku: "MR-D6F",
    photo: 12119318,
    tags: ["large-room"],
    description: `A trestle-leg oak-finish table with six cross-back chairs painted in pale grey: a lighter look for a white-walled villa. Sold as table and six chairs.${INSPECT}`,
    attributes: attrs("Table 180 × 90 × 76 cm; chairs 46 × 50 × 92 cm", "Rubberwood, painted chairs with linen seats", "Oak-finish table, pale grey chairs", "Delivered assembled", "5 years", { Seats: "6" }),
    ...single(62_000, 70_900, 2),
  },

  // ---- office (9401 30 swivel seats; 9403 10 / 30 desks — 18%)
  {
    name: "Ergonomic mesh chair with headrest",
    category: OFFICE,
    hsn: "94013000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-OEM",
    photo: 37468394,
    tags: ["office", "wfh", "bestseller", "ready-stock"],
    description: `For an eight-hour work-from-home day: an adjustable headrest, a sliding lumbar support, 3D arms, seat-depth adjustment and a breathable mesh back that doesn't stick to your shirt in May.`,
    attributes: attrs("66 × 64 × 118–128 cm", "Nylon frame, mesh back, moulded foam seat, class-4 gas lift", "Teal or black", "Self-assembly in 10 minutes (we do it free in Coimbatore)", "3 years, gas lift 5 years", { "Weight limit": "120 kg" }),
    ...one("Colour", [
      ["Teal", 14_900, 18_900, 6],
      ["Black", 14_900, 18_900, 8],
    ]),
  },
  {
    name: "Mid-back mesh office chair",
    category: OFFICE,
    hsn: "94013000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-OMB",
    photo: 12269763,
    tags: ["office", "wfh", "ready-stock"],
    description: `A simple, sturdy office chair for a shop counter, a clinic or a student: mesh back, fixed arms, tilt lock and height adjustment. We supply them by the dozen for offices.`,
    attributes: attrs("60 × 58 × 92–102 cm", "Nylon base, mesh back, foam seat", "Teal or black seat", "Self-assembly in 10 minutes", "1 year", { "Weight limit": "100 kg" }),
    ...one("Colour", [
      ["Teal", 7_900, 9_900, 10],
      ["Black", 7_900, 9_900, 12],
    ]),
  },
  {
    name: "Work desk, metal legs",
    category: OFFICE,
    hsn: "94031000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-ODK",
    photo: 36123565,
    tags: ["office", "wfh", "small-homes", "ready-stock"],
    description: `A clean work desk: a 25 mm laminated top with rounded corners on powder-coated steel legs, and a cable grommet at the back. The 120 cm fits a bedroom wall; the 140 cm takes two monitors.`,
    attributes: attrs("120 or 140 × 60 × 75 cm", "Pre-laminated board, steel legs", "White top, copper-brown legs", "Legs screwed on at delivery", "2 years"),
    ...one("Width", [
      ["120 cm", 9_800, 11_900, 6],
      ["140 cm", 11_200, 13_500, 4],
    ]),
  },
  {
    name: "Writing desk with drawers",
    category: OFFICE,
    hsn: "94033000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-OWD",
    photo: 6265942,
    tags: ["study", "office"],
    description: `A study table with a moulded edge, three drawers across the front and turned legs: the desk for board-exam years and the household accounts after.${INSPECT}`,
    attributes: attrs("120 × 60 × 78 cm", "Hardwood frame, MDF top", "Ivory or walnut", "Delivered assembled", "3 years"),
    ...one("Finish", [
      ["Ivory", 15_500, 18_500, 3],
      ["Walnut", 15_500, 18_500, 3],
    ]),
  },

  // ---- kids (9403 50 / 60 — 18%)
  {
    name: "Teak bunk bed with ladder",
    category: KIDS,
    hsn: "94035010",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-KBT",
    photo: 3958960,
    tags: ["kids", "teak", "small-homes", "made-to-order"],
    description: `Two single beds stacked in solid teak, with a fixed ladder, a full-length guard rail on top and 15 cm between the rail and the mattress top. Splits into two singles when they want their own rooms.${TEAK}${INSPECT}`,
    attributes: attrs("100 × 200 × 160 cm (each bed 72 × 36 in)", "Solid teak", "Natural walnut stain", "Assembled at your home (1.5 hours)", "10 years", { "Age": "6 years and up on the top bunk", "Made to order": "20 days" }),
    ...single(42_000, 48_500, 2),
  },
  {
    name: "Bunk bed with storage drawers",
    category: KIDS,
    hsn: "94035090",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-KBS",
    photo: 7031881,
    tags: ["kids", "storage", "small-homes"],
    description: `A single over a wider double bunk, with two big drawers under the bottom bed and a staircase ladder whose steps are toy boxes. Rounded corners everywhere.${INSPECT}`,
    attributes: attrs("Top 72 × 36 in, bottom 72 × 48 in; 140 × 200 × 165 cm", "Pine, BWP plywood drawers", "Grey or white, non-toxic paint", "Assembled at your home (2 hours)", "5 years", { Age: "6 years and up on the top bunk" }),
    ...one("Finish", [
      ["Grey", 48_500, 55_900, 2],
      ["White", 48_500, 55_900, 2],
    ]),
  },
  {
    name: "Kids' study desk and chair",
    category: KIDS,
    hsn: "94036000",
    gstRate: 18,
    unit: "set",
    sku: "MR-KSD",
    photo: 34992953,
    tags: ["kids", "study", "small-homes", "ready-stock"],
    description: `A curved study desk with a shelf above and a padded chair in matching colours, sized for 5–12 year olds: elbows at desk height and feet on the floor.`,
    attributes: attrs("Desk 100 × 50 × 64 cm; chair seat 38 cm high", "BWP plywood, fabric chair", "Blush pink or sky blue", "Delivered assembled", "2 years", { Age: "5–12 years" }),
    ...one("Colour", [
      ["Blush pink", 13_900, 16_500, 3],
      ["Sky blue", 13_900, 16_500, 3],
    ]),
  },
  {
    name: "Kids' single bed with bookshelf",
    category: KIDS,
    hsn: "94035090",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-KSB",
    photo: 7587803,
    tags: ["kids", "storage"],
    description: `A single bed with a bookshelf headboard (for the bedtime stories and the night lamp) and a drawer below. Bright colours, rounded edges, low enough to climb into.${INSPECT}`,
    attributes: attrs("100 × 200 × 90 cm (mattress 72 × 36 in)", "BWP plywood", "Leaf green or white", "Assembled at your home (1 hour)", "3 years", { Age: "3 years and up" }),
    ...one("Finish", [
      ["Leaf green", 23_500, 27_500, 2],
      ["White", 23_500, 27_500, 3],
    ]),
  },

  // ---- balcony & outdoor (rattan wholly: 9401 53 / 9403 83 — 5%; mixed frames 9401 69 / 80 — 18%)
  {
    name: "Rattan balcony set, two chairs and a table",
    category: BALCONY,
    hsn: "94015300",
    gstRate: 5,
    unit: "set",
    sku: "MR-BRS",
    photo: 14024758,
    tags: ["balcony", "cane", "bestseller", "ready-stock"],
    description: `Two curved rattan armchairs with cushions and a round rattan side table, woven by hand: for the sit-out, the balcony or the verandah filter-coffee hour. Wholly of rattan (so 5% GST).\n\nKeep it out of the direct rain; a coat of varnish every two years keeps it supple.`,
    attributes: attrs("Chairs 68 × 66 × 78 cm; table 55 cm diameter", "Natural rattan, cotton cushions", "Natural rattan, ivory cushions", "Delivered assembled", "1 year"),
    ...single(18_900, 22_500, 4),
  },
  {
    name: "Rope-weave balcony chair, teak legs",
    category: BALCONY,
    hsn: "94016900",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-BRP",
    photo: 16249628,
    tags: ["balcony", "teak", "ready-stock"],
    description: `An outdoor armchair wrapped in UV-stable polyester rope on an aluminium frame, with teak legs and a quick-dry seat cushion: rain doesn't harm it, sun doesn't fade it.`,
    attributes: attrs("62 × 60 × 82 cm", "Aluminium frame, polyester rope, teak legs", "Sea grey or natural rope", "Delivered assembled", "2 years"),
    ...one("Colour", [
      ["Sea grey", 12_500, 14_900, 4],
      ["Natural", 12_500, 14_900, 3],
    ]),
  },
  {
    name: "Hanging macramé swing chair",
    category: BALCONY,
    hsn: "94018000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-BHS",
    photo: 7141032,
    tags: ["balcony", "made-in-tn", "ready-stock"],
    description: `A cotton macramé hammock chair knotted by a self-help group in Karur, on a 75 cm hardwood ring, with a soft fringed cushion. Hangs from a ceiling hook (we fix it, rated 150 kg).`,
    attributes: attrs("75 cm diameter × 120 cm drop", "Cotton rope, hardwood ring", "Natural cotton", "Ceiling hook fixed by our fitter", "1 year", { "Weight limit": "120 kg" }),
    ...single(6_900, 8_200, 6),
  },
  {
    name: "Peacock rattan chair",
    category: BALCONY,
    hsn: "94015300",
    gstRate: 5,
    unit: "pcs",
    sku: "MR-BPC",
    photo: 9381048,
    tags: ["balcony", "cane"],
    description: `The tall fan-backed rattan chair from old studio photographs, woven by hand in one piece: a statement for a verandah corner. Wholly of rattan (5% GST).`,
    attributes: attrs("80 × 70 × 140 cm", "Natural rattan", "Natural", "Delivered assembled", "1 year"),
    ...single(15_900, 18_900, 2),
  },

  // ---- Chettinad heritage (9401 69 / 9403 60 — 18%, see the handicraft note)
  {
    name: "Chettinad easy chair (saaru naarkali)",
    category: HERITAGE,
    hsn: "94016900",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-HEC",
    photo: 4497540,
    tags: ["chettinad", "teak", "bestseller", "made-to-order"],
    description: `The long verandah chair of every Chettinad house: a reclining teak frame with long arms that swing out to rest your legs, and a seat in hand-woven cane or thick canvas. Folds flat for storage.${TEAK}`,
    attributes: attrs("62 × 140 × 90 cm (arms extended)", "Solid teak, cane or cotton canvas", "Honey teak", "Delivered assembled", "10 years on the frame", { "Made to order": "15 days" }),
    ...one("Seat", [
      ["Hand-woven cane", 21_500, 24_900, 2],
      ["Cotton canvas", 18_500, 21_900, 3],
    ]),
  },
  {
    name: "Teak oonjal with brass chains",
    category: HERITAGE,
    hsn: "94036000",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-HOJ",
    photo: 33332967,
    tags: ["chettinad", "teak", "made-to-order"],
    description: `A solid teak plank swing with a carved backrest and brass chains, hung from the ceiling beam the way the oonjal hangs in Karaikudi halls. We check your slab and fix the hooks (anchored into RCC).${TEAK}`,
    attributes: attrs("4 ft: 122 × 55 × 75 cm; 5 ft: 152 × 55 × 75 cm (chains to your ceiling)", "Solid teak, brass chains and hooks", "Honey teak, brass", "Hung by our carpenters (2 hours)", "10 years", { "Weight limit": "250 kg", "Made to order": "20 days" }),
    ...one("Length", [
      ["4 ft", 48_000, 54_900, 1],
      ["5 ft", 56_000, 63_900, 1],
    ]),
  },
  {
    name: "Cane-back teak lounge chair",
    category: HERITAGE,
    hsn: "94016900",
    gstRate: 18,
    unit: "pcs",
    sku: "MR-HCL",
    photo: 30059653,
    tags: ["chettinad", "teak", "cane", "ready-stock"],
    description: `A low, wide lounge chair with an angled teak frame and a cane-woven back and seat: the Chandigarh-era shape our carvers make with Chettinad teak. Lovely with a cushion and a book.${TEAK}`,
    attributes: attrs("60 × 70 × 75 cm", "Solid teak, hand-woven cane", "Walnut-stained teak", "Delivered assembled", "5 years"),
    ...single(16_500, 19_500, 3),
  },
];

/** Pexels photos used by the store (credited on /pages/photo-credits). */
const PHOTOS: DemoStore["photos"] = {
  8135269: { by: "Max Vakhtbovych", alt: "Light blue three-seater sofa" },
  12289394: { by: "dada _design", alt: "Grey L-shaped sectional sofa with round tables" },
  6480707: { by: "Leah Newhouse", alt: "Tan leather three-seater sofa in a bright room" },
  4846097: { by: "Rachel Claire", alt: "Green velvet sofa with a gold side table" },
  33100828: { by: "Blesson  Poulose", alt: "Grey padded recliner chair" },
  6933860: { by: "Max Vakhtbovych", alt: "Grey leather two-seater recliner sofa" },
  6934180: { by: "Max Vakhtbovych", alt: "Dusty pink sofa with cushions" },
  6297080: { by: "Max Vakhtbovych", alt: "Floating walnut TV console under a wall-mounted TV" },
  6489106: { by: "Max Vakhtbovych", alt: "Wall TV unit with walnut and white shelves" },
  30440152: { by: "Jyoti Mishra", alt: "Dark wood coffee table in front of a cream sofa" },
  7607460: { by: "Kaboompics", alt: "Round wooden coffee table" },
  7195553: { by: "Max Vakhtbovych", alt: "Fabric armchair with curved wooden arms" },
  8135289: { by: "Max Vakhtbovych", alt: "Carved wooden bed with a buttoned headboard" },
  6301179: { by: "Max Vakhtbovych", alt: "Bed with a tufted grey upholstered headboard" },
  545012: { by: "Burst", alt: "Wooden bed with white sheets" },
  31967700: { by: "Kader Azra Namuslu", alt: "Wooden bedside table with a cane drawer" },
  6489082: { by: "Max Vakhtbovych", alt: "White mattress on a bed frame" },
  7598140: { by: "Max Vakhtbovych", alt: "Quilted mattress on a bed in a bright room" },
  7227615: { by: "Max Vakhtbovych", alt: "Thick mattress on an upholstered bed" },
  6585740: { by: "Max Vakhtbovych", alt: "Mattress on a bed in a modern bedroom" },
  6508349: { by: "Max Vakhtbovych", alt: "White wardrobe with an open wood-lined door" },
  2708106: { by: "Javier Mix", alt: "Grey three-door wardrobe" },
  38697207: { by: "McFollis", alt: "Light oak floor-to-ceiling wardrobe" },
  15692791: { by: "hello aesthe", alt: "Wooden almirah with dark panelled doors" },
  7045829: { by: "Max Vakhtbovych", alt: "Ivory dressing table with a mirror and stool" },
  3935317: { by: "Curtis Adams", alt: "Wooden dining table with six chairs" },
  8583537: { by: "Curtis Adams", alt: "Round wooden dining table with high-back chairs" },
  12119318: { by: "Curtis Adams", alt: "Wooden dining table with painted chairs" },
  37468394: { by: "McFollis", alt: "Teal ergonomic office chair with a headrest" },
  12269763: { by: "Esteban Santiago Gonzalez", alt: "Two mesh office chairs" },
  36123565: { by: "Letícia Alvares", alt: "White work desk with metal legs and a laptop" },
  6265942: { by: "Max Vakhtbovych", alt: "Ivory writing desk with drawers" },
  3958960: { by: "Curtis Adams", alt: "Wooden bunk bed in a child's room" },
  7031881: { by: "Max Vakhtbovych", alt: "Grey bunk bed with storage drawers" },
  34992953: { by: "Hengga Wang", alt: "Child's curved study desk with a pink chair" },
  7587803: { by: "Max Vakhtbovych", alt: "Child's bed with a green bookshelf" },
  14024758: { by: "Quang Nguyen Vinh", alt: "Rattan armchairs and a round table on a verandah" },
  16249628: { by: "FOSHAN XANADU", alt: "Rope-woven armchair with wooden legs" },
  7141032: { by: "Julia Filirovska", alt: "Hanging macramé swing chair" },
  9381048: { by: "Mathias Reding", alt: "Peacock rattan chair and cane chairs" },
  4497540: { by: "Souranshi Fashion and Lifestyle Magazine", alt: "Wooden reclining easy chair on a verandah with plants" },
  33332967: { by: "Keith Cassill", alt: "Wooden porch swing on a verandah" },
  30059653: { by: "Pavel Morillo", alt: "Cane-back wooden lounge chair" },
  // categories, home and pages
  6538898: { by: "Max Vakhtbovych", alt: "Living room with a brown L-shaped sofa" },
  6782366: { by: "Max Vakhtbovych", alt: "Living room with a sectional sofa and a TV wall" },
  7614411: { by: "Max Vakhtbovych", alt: "Bedroom with a new mattress on a grey bed" },
  6487951: { by: "Max Vakhtbovych", alt: "Wood-lined wardrobe with open shelves" },
  5900807: { by: "Curtis Adams", alt: "Dining room with a wooden table and six chairs" },
  12913377: { by: "Pușcaș Adryan", alt: "Home office desk and chair" },
  6670652: { by: "Huy Quang Nguyễn", alt: "Child's bedroom with a bed and desk" },
  36609018: { by: "Thilina Alagiyawanna", alt: "Carved teak door panels with brass knobs" },
  7786775: { by: "Furkan Tumer", alt: "Living room with a beige L-shaped sofa, coffee table and TV console" },
  15456211: { by: "Đức Đào", alt: "Bedroom with a wooden bed, bedside tables and an armchair" },
  15401314: { by: "Murat Marangoz", alt: "Carpenter carrying a plank through a timber workshop" },
  32357250: { by: "HONG SON", alt: "Carpenter planing a plank on a machine" },
  18947381: { by: "GOWTHAM AGM", alt: "Carpenter shaping wood by hand" },
  4611337: { by: "Magda Ehlers", alt: "Close-up of carved flowers in dark wood" },
  7464266: { by: "RDNE Stock project", alt: "Two men carrying a green sofa into a room" },
  6835181: { by: "Curtis Adams", alt: "Empty room with a wooden floor" },
  6758237: { by: "Max Vakhtbovych", alt: "Furniture showroom with sofas and a dining set" },
  14653155: { by: "Mehmet Turgut  Kirkgoz", alt: "Carpenters at work in a workshop" },
};

const HOURS = [
  { label: "Showroom, every day", value: "10:00 am – 9:00 pm" },
  { label: "Workshop visits", value: "Mon – Sat, 10 am – 5 pm" },
];

const FAQ = [
  {
    q: "What do delivery and installation cost?",
    a: "**Coimbatore city: free above ₹20,000** (₹750 below), delivered and fitted by our own team in 2–4 days for ready stock. **Tiruppur, Erode and Pollachi:** ₹1,500, free above ₹60,000, 3–6 days. **Rest of Tamil Nadu:** ₹3,500 by our truck in 7–12 days; a carpenter travels with it to assemble beds and wardrobes. Wall-mounting a TV unit, hanging an oonjal or fixing a swing hook is included.",
  },
  {
    q: "Do you offer EMI?",
    a: "Yes: **no-cost EMI for 3 or 6 months** on credit cards above ₹15,000 at checkout (the bank's interest is borne by us), and 9–12 month EMI on cards and consumer finance at the showroom with an Aadhaar and PAN. The EMI is on the GST-inclusive price.",
  },
  {
    q: "How long does made-to-order furniture take?",
    a: "Ready-stock pieces leave in 2–4 days. Made-to-order pieces (the carved teak bed, the oonjal, sliding wardrobes, TV walls) take **15–30 days**; we visit to measure first for anything built to your wall. A 25% advance starts production; the rest is paid on delivery.",
  },
  {
    q: "What if something arrives damaged?",
    a: "Our fitter unpacks and assembles everything in front of you: **check it before he leaves**, and anything damaged in transit is replaced. If you notice transit damage later, send photos on WhatsApp **within 48 hours** and we come back. Ready-stock pieces in their packing can be returned within 7 days (pickup ₹750 in Coimbatore); made-to-order and mattresses once unwrapped can't, for hygiene and because they're built for you.",
  },
  {
    q: "Can I see the workshop?",
    a: "Yes. Our workshop in **Podanur** is open for visits Monday to Saturday, 10 am – 5 pm: see the teak being seasoned, joined and carved. Call ahead and we'll show you your own piece in progress.",
  },
];

const FAQ_TA = [
  {
    q: "டெலிவரி, பொருத்துதல் கட்டணம் எவ்வளவு?",
    a: "**கோவை நகரம்: ₹20,000-க்கு மேல் இலவசம்** (குறைவானால் ₹750); ரெடி ஸ்டாக் 2–4 நாளில் எங்கள் குழுவே கொண்டு வந்து பொருத்தும். **திருப்பூர், ஈரோடு, பொள்ளாச்சி:** ₹1,500, ₹60,000-க்கு மேல் இலவசம், 3–6 நாள். **தமிழ்நாட்டின் பிற பகுதிகள்:** எங்கள் லாரியில் ₹3,500, 7–12 நாள்; கட்டில், அலமாரி பொருத்த ஒரு தச்சர் உடன் வருவார். டிவி யூனிட்டைச் சுவரில் பொருத்துதல், ஊஞ்சல் மாட்டுதல், ஸ்விங் கொக்கி அடித்தல் சேர்த்தே.",
  },
  {
    q: "EMI வசதி உண்டா?",
    a: "உண்டு: ₹15,000-க்கு மேல் கிரெடிட் கார்டில் **3 அல்லது 6 மாத வட்டியில்லா EMI** (வங்கி வட்டியை நாங்கள் ஏற்கிறோம்); ஷோரூமில் ஆதார், பான் கொண்டு கார்டு மற்றும் கன்ஸ்யூமர் ஃபைனான்ஸில் 9–12 மாத EMI. EMI ஜிஎஸ்டி சேர்ந்த விலைக்கே.",
  },
  {
    q: "ஆர்டர் செய்து செய்யப்படும் ஃபர்னிச்சருக்கு எவ்வளவு நாளாகும்?",
    a: "ரெடி ஸ்டாக் 2–4 நாளில் புறப்படும். ஆர்டர் செய்து செய்யப்படுபவை (செதுக்கிய தேக்குக் கட்டில், ஊஞ்சல், ஸ்லைடிங் அலமாரி, டிவி சுவர்) **15–30 நாள்**; உங்கள் சுவருக்கு ஏற்பச் செய்வதற்கு முதலில் வந்து அளந்துகொள்வோம். 25% முன்பணத்தில் வேலை தொடங்கும்; மீதி டெலிவரியில்.",
  },
  {
    q: "சேதமாக வந்தால் என்ன செய்வது?",
    a: "எங்கள் ஃபிட்டர் உங்கள் முன்னிலையில் பிரித்துப் பொருத்துவார்: **அவர் கிளம்பும் முன் சரிபாருங்கள்**; வழியில் ஏற்பட்ட சேதம் மாற்றித் தரப்படும். பிறகு கவனித்தால் **48 மணி நேரத்துக்குள்** வாட்ஸ்அப்பில் படங்கள் அனுப்புங்கள், மீண்டும் வருவோம். பேக்கிங்கில் உள்ள ரெடி ஸ்டாக் பொருட்களை 7 நாளுக்குள் திருப்பலாம் (கோவையில் எடுத்துச்செல்ல ₹750); ஆர்டர் செய்து செய்தவையும் பிரித்த மெத்தைகளும் திருப்ப முடியாது.",
  },
  {
    q: "பட்டறையைப் பார்க்கலாமா?",
    a: "பார்க்கலாம். **போத்தனூரில்** உள்ள எங்கள் பட்டறை திங்கள் முதல் சனி வரை காலை 10 – மாலை 5 திறந்திருக்கும்: தேக்கு உலர்த்துவது, இணைப்பது, செதுக்குவது எல்லாம் பார்க்கலாம். முன்பே அழைத்தால் உங்கள் பொருள் தயாராவதையே காட்டுவோம்.",
  },
];

/** Comparison rows and shades: plain records (docs/verticals.md step 4). */
const row = (label: string, values: string[]) => ({ label, values });
/** A sticky-story chapter's Tamil words (chapters differ in shape: only the last has a button). */
const chapter = (words: Record<string, string>, cta?: string): Record<string, string | { label: string }> => (cta ? { ...words, cta: { label: cta } } : words);

export const MARAM: DemoStore = {
  shop: {
    slug: "maram",
    appId: "EC",
    businessType: "furniture",
    planId: "pro",
    name: "Maram Furniture & Woodworks",
    primary: "#5a3825",
    billing: {
      legalName: "Maram Furniture & Woodworks",
      gstin: "33AAMFM6284T1ZA",
      address: "418, Avinashi Road, Peelamedu",
      city: "Coimbatore",
      pincode: "641004",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "MR",
      upiId: "maramfurniture@okhdfcbank",
    },
    // Installation work done for furniture not bought from us (installation services, SAC 998729: 18%); GST-exclusive.
    items: [
      { name: "Assembly of furniture bought elsewhere", hsn: "998729", unit: "pcs", rate: 84_746, gstRate: 18 },
      { name: "Re-polishing (per seat or per sq ft of top)", hsn: "998729", unit: "pcs", rate: 33_898, gstRate: 18 },
    ],
  },
  preset: "walnut-linen",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 5_000_000,
    contactPhone: PHONE,
    contactEmail: "showroom@maramfurniture.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/maramfurniture" },
    policies: {
      shipping:
        "**Coimbatore city (6410xx):** delivered and installed by our own team, **free above ₹20,000** (₹750 below), ready stock in 2–4 days.\n\n**Tiruppur, Erode, Pollachi and the Kongu belt (641, 638, 642):** ₹1,500, free above ₹60,000, 3–6 days.\n\n**Rest of Tamil Nadu:** by our truck with a carpenter on board, ₹3,500, 7–12 days; we call you a day ahead with the time. Made-to-order pieces (marked on each product) leave 15–30 days after the order. We deliver within Tamil Nadu only.",
      returns:
        "**Inspect at delivery:** our fitter unpacks and assembles in front of you; anything damaged in transit is replaced, free. Hidden transit damage noticed later: send photos on WhatsApp **within 48 hours** of delivery and we return to repair or replace it. Ready-stock pieces still in their packing can be returned within 7 days for a full refund less ₹750 pickup in Coimbatore (₹3,500 outside). Made-to-order pieces and unwrapped mattresses can't be returned; manufacturing defects are covered by each piece's warranty, serviced at your home.",
      privacy: "We use your details only to deliver and install your order, send your GST bill and warranty card, and call you about service visits.",
      terms:
        "Prices include GST: 18% on wooden furniture, seats, office chairs and foam or spring mattresses; 5% on furniture wholly of rattan or cane and on the rubberised coir mattress. No-cost EMI for 3 or 6 months on credit cards above ₹15,000; 9–12 month EMI at the showroom. Made-to-order pieces need a 25% advance, the rest on delivery. Wood is natural: grain and shade vary from the photo.",
    },
    businessType: "furniture",
  },
  zones: [
    {
      name: "Coimbatore city (6410xx)",
      pincodePrefixes: ["6410"],
      rate: { name: "Delivery and installation by our team", type: "free_above", amount: 75_000, freeAbove: 2_000_000, etaMinDays: 2, etaMaxDays: 4, codAllowed: true, codFee: 0 },
    },
    {
      name: "Kongu belt: Tiruppur, Erode, Pollachi (641, 638, 642)",
      pincodePrefixes: ["641", "638", "642"],
      rate: { name: "Our van, with installation", type: "free_above", amount: 1_50_000, freeAbove: 6_000_000, etaMinDays: 3, etaMaxDays: 6, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu (by truck)",
      states: ["33"],
      rate: { name: "Truck with a carpenter (7–12 days)", type: "flat", amount: 3_50_000, etaMinDays: 7, etaMaxDays: 12, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: SOFAS, description: "Three-seaters, L-shapes, recliners and sofa beds on teak frames, in fabric, velvet and leatherette.", photo: 6538898 },
    { name: LIVING, description: "TV units, coffee tables and armchairs for the hall.", photo: 6782366 },
    { name: BEDS, description: "Carved teak, sheesham and storage beds in queen and king sizes, and bedside tables.", photo: 8135289 },
    { name: MATTRESSES, description: "Orthopaedic, memory foam, pocket spring and rubberised coir, in four sizes.", photo: 7614411, parent: BEDS },
    { name: WARDROBES, description: "Two-, three- and four-door wardrobes, a teak almirah and dressing tables.", photo: 6487951 },
    { name: DINING, description: "Four- and six-seater dining sets in teak and sheesham.", photo: 5900807 },
    { name: OFFICE, description: "Ergonomic and mesh chairs, work desks and study tables for home and office.", photo: 12913377 },
    { name: KIDS, description: "Bunk beds, study desks and single beds with rounded edges and safe finishes.", photo: 6670652 },
    { name: BALCONY, description: "Rattan sets, rope-weave chairs and a macramé swing for the balcony and sit-out.", photo: 14024758 },
    { name: HERITAGE, description: "The saaru naarkali easy chair, the teak oonjal and cane-back pieces from our carvers.", photo: 36609018 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "Ready stock, delivered this week", slug: "ready-stock", description: "In our Coimbatore godown: delivered and fitted in 2–4 days.", rule: { tag: "ready-stock", sort: "price-asc" } },
    { name: "Made to order", slug: "made-to-order", description: "Built for you in our Podanur workshop in 15–30 days.", rule: { tag: "made-to-order", sort: "price-desc" } },
    { name: "Solid teak", slug: "teak", description: "Seasoned teak from our own workshop.", rule: { tag: "teak", sort: "price-desc" } },
    { name: "Chettinad collection", slug: "chettinad", description: "Carved beds, the easy chair, the oonjal and the almirah.", rule: { tag: "chettinad", sort: "price-desc" } },
    { name: "For 2BHK homes", slug: "small-homes", description: "Compact, storage-first pieces for flats.", rule: { tag: "small-homes", sort: "price-asc" } },
    { name: "Work from home", slug: "work-from-home", description: "Chairs and desks for long days at home.", rule: { tag: "wfh", sort: "price-asc" } },
    { name: "Recliners", slug: "recliners", description: "Single and two-seater recliners, manual and motorised.", rule: { tag: "recliner", sort: "price-asc" } },
    { name: "Mattresses", slug: "mattresses", description: "Four kinds, four sizes.", rule: { category: MATTRESSES, sort: "price-asc" } },
    { name: "Balcony & cane", slug: "balcony", description: "Rattan, cane and rope for the sit-out.", rule: { tag: "balcony", sort: "price-asc" } },
    { name: "Bestsellers", slug: "bestsellers", description: "What Coimbatore homes buy most.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "On offer", slug: "on-offer", description: "Below MRP right now.", rule: { onSale: true, sort: "price-asc" } },
  ],
  coupons: [
    {
      code: "VEEDU5",
      description: "Deepavali home sale: 5% off orders above ₹50,000 (up to ₹7,500)",
      type: "percent",
      value: 5,
      minOrder: 5_000_000,
      maxDiscount: 750_000,
      channels: ["store", "manual"],
    },
    {
      code: "MARAM2000",
      description: "₹2,000 off your first order above ₹25,000",
      type: "flat",
      value: 200_000,
      minOrder: 2_500_000,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      channels: ["store"],
    },
  ],
  home: ({ photo, category, product }) => {
    const mattresses = ["Orthopaedic mattress, firm", "Memory foam mattress, medium", "Pocket spring mattress, plush top", "Rubberised coir mattress"].map(product);
    const fabricSofas = ["Kovai 3-seater fabric sofa, teak frame", "Velvet 2-seater sofa, teak legs", "L-shape sectional sofa with chaise", "Sofa cum bed, 3-seater"].map(product);
    return {
      seo: {
        title: "Maram Furniture & Woodworks, Coimbatore: sofas, teak beds, mattresses",
        description:
          "Sofas, carved teak beds, mattresses, wardrobes, dining sets, office chairs and Chettinad easy chairs from our own Podanur workshop. Free delivery and installation in Coimbatore above ₹20,000, our truck across Tamil Nadu, no-cost EMI.",
        imageUrl: photo(7786775),
      },
      sections: [
        {
          type: "shop-the-look",
          id: "mr-living",
          title: "Step into the living room",
          text: "Everything in this room is in our Avinashi Road showroom. Tap a dot to see the piece, its size and its price.",
          imageUrl: photo(7786775),
          alt: "Living room with a beige L-shaped sofa, coffee table and TV console",
          hotspots: [
            { x: 66, y: 58, productId: product("L-shape sectional sofa with chaise") },
            { x: 48, y: 72, productId: product("Sheesham coffee table with storage") },
            { x: 14, y: 64, productId: product("Floating TV console, walnut finish") },
          ],
          style: { width: "full", padding: "spacious" },
        },
        {
          type: "categories",
          id: "mr-rooms",
          title: "Walk through the showroom, room by room",
          layout: "bento",
          showCounts: true,
          categoryIds: [SOFAS, BEDS, DINING, WARDROBES, HERITAGE, LIVING, OFFICE, KIDS, BALCONY].map(category),
        },
        {
          type: "finder",
          id: "mr-sofa-finder",
          title: "Find your sofa",
          text: "Three questions: your hall, how many sit, the feel you like. Skip any you're unsure of; we'll measure the room for free before you decide.",
          layout: "wizard",
          results: "inline",
          imageUrl: photo(6538898, "tile"),
          cta: { label: "Send us your room size on WhatsApp", href: waLink("Hello Maram Furniture, my hall is … ft × … ft. I'm looking for a sofa for … people.") },
          limit: 6,
          questions: [
            {
              label: "How big is the room?",
              options: [
                { label: "Compact: under 10 × 12 ft", tag: "compact-room" },
                { label: "Medium: 12 × 14 ft", tag: "medium-room" },
                { label: "Large: 14 × 18 ft and up", tag: "large-room" },
              ],
            },
            {
              label: "How many seats?",
              options: [
                { label: "1: a reading chair", filterName: "Seats", filterValue: "1" },
                { label: "2", filterName: "Seats", filterValue: "2" },
                { label: "3", filterName: "Seats", filterValue: "3" },
                { label: "5 or more: an L-shape", filterName: "Seats", filterValue: "5" },
              ],
            },
            {
              label: "Which feel?",
              options: [
                { label: "Soft fabric", tag: "fabric" },
                { label: "Wipe-clean leatherette", tag: "leatherette" },
                { label: "A recliner", tag: "recliner" },
              ],
            },
          ],
        },
        {
          type: "shop-the-look",
          id: "mr-bedroom",
          title: "The bedroom",
          text: "A carved teak bed, a reading chair and bedside tables.",
          imageUrl: photo(15456211, "tile"),
          alt: "Bedroom with a wooden bed, bedside tables and an armchair",
          hotspots: [
            { x: 68, y: 66, productId: product("Chettinad carved teak bed") },
            { x: 66, y: 46, productId: product("Orthopaedic mattress, firm") },
            { x: 90, y: 50, productId: product("Bedside table with cane drawer") },
            { x: 14, y: 58, productId: product("Accent armchair, curved teak arms") },
          ],
        },
        {
          type: "swatches",
          id: "mr-fabrics",
          title: "Pick the fabric before you visit",
          text: "Our fabric sofas in every colour we stock. Swatch books of 60 more weaves are at the showroom, and we post three free cuttings anywhere in Tamil Nadu.",
          optionName: "Fabric colour",
          productIds: fabricSofas,
          shades: [
            { value: "Mist blue", hex: "#a9bccb" },
            { value: "Linen beige", hex: "#d8cbb3" },
            { value: "Sage green", hex: "#9caf88" },
            { value: "Charcoal grey", hex: "#4a4a4d" },
            { value: "Bottle green", hex: "#1f4d3a" },
            { value: "Mustard", hex: "#c99a2e" },
            { value: "Navy", hex: "#22304f" },
            { value: "Dusty rose", hex: "#b88a8a" },
            { value: "Grey", hex: "#8e8e8e" },
          ],
        },
        {
          type: "comparison",
          id: "mr-mattresses",
          title: "Four mattresses, side by side",
          text: "Lie on all four at the showroom. Prices are for the queen size (78 × 60 in); every size is on the product page.",
          productIds: mattresses,
          highlightId: product("Orthopaedic mattress, firm"),
          highlightLabel: "Most bought",
          showRating: false,
          rows: [
            row("Feel", ["Firm", "Medium, moulds to you", "Medium-soft, bouncy", "Firm and airy"]),
            row("Core", ["Bonded foam + HR foam", "Gel memory foam + HR base", "Pocketed springs + pillow top", "Pollachi rubberised coir + 1 in foam"]),
            row("Best for", ["Back pain, back sleepers", "Side sleepers, shoulder pain", "Couples, light sleepers", "Hot rooms, firm-bed lovers"]),
            row("Sleeps cool?", ["Average", "Good (gel, open cell)", "Very good (air between springs)", "Best (coir breathes)"]),
            row("Thickness", ["8 in", "8 in", "10 in", "6 in"]),
            row("Warranty", ["10 years", "10 years", "8 years", "5 years"]),
            row("GST", ["18%", "18%", "18%", "5%"]),
          ],
        },
        {
          type: "shop-the-look",
          id: "mr-dining",
          title: "The dining room",
          text: "Six chairs around solid teak, for the Sunday lunch.",
          imageUrl: photo(5900807, "tile"),
          alt: "Dining room with a wooden table and six chairs",
          hotspots: [
            { x: 52, y: 66, productId: product("Teak 6-seater dining set") },
            { x: 22, y: 60, productId: product("Round 4-seater dining set, sheesham") },
          ],
        },
        {
          type: "sticky-story",
          id: "mr-workshop",
          title: "How a Maram bed is made",
          imageSide: "left",
          chapters: [
            {
              eyebrow: "Week 1",
              heading: "Choosing and seasoning the teak",
              markdown: "We buy plantation teak logs from Nilambur depots and saw them in our **Podanur** yard. The planks rest in our kiln until the moisture is down to **10–12%**: wood that's rushed cracks in the first Coimbatore summer.",
              imageUrl: photo(15401314, "tile"),
              alt: "Carpenter carrying a plank through a timber workshop",
            },
            {
              eyebrow: "Week 2",
              heading: "Planing and joinery",
              markdown: "Every plank is planed true, then joined with **mortise and tenon** and dowels, glued and clamped overnight. No nails in a load-bearing joint, ever.",
              imageUrl: photo(32357250, "tile"),
              alt: "Carpenter planing a plank on a machine",
            },
            {
              eyebrow: "Weeks 2–3",
              heading: "Carving by hand",
              markdown: "Our two senior carvers, trained in **Karaikudi**, cut the lotus, creeper and athangudi-tile rosette into the headboard with chisels and mallets: about **60 hours** for a king-size bed.",
              imageUrl: photo(4611337, "tile"),
              alt: "Close-up of carved flowers in dark wood",
            },
            {
              eyebrow: "Week 4",
              heading: "Finishing",
              markdown: "Sanded through four grits, stained if you asked for it, then **hand-rubbed PU** in three coats with a day's rest between each, so the grain glows without a plastic shine.",
              imageUrl: photo(18947381, "tile"),
              alt: "Carpenter shaping wood by hand",
            },
            {
              eyebrow: "Delivery day",
              heading: "To your bedroom, assembled",
              markdown: "Two of our own men bring it on our truck, carry it up (yes, the fourth floor without a lift), assemble it and take the packing away. You check it before they leave.",
              imageUrl: photo(7464266, "tile"),
              alt: "Two men carrying a green sofa into a room",
              cta: { label: "See the Chettinad bed", href: "/collections/chettinad" },
            },
          ],
        },
        {
          type: "before-after",
          id: "mr-makeover",
          title: "An empty hall in Saravanampatti, three weeks later",
          text: "A young couple's new flat: we measured, drew the room and furnished it with a sofa, a TV unit and a coffee table inside their ₹1.2 lakh budget. Drag the handle.",
          beforeUrl: photo(6835181),
          afterUrl: photo(6782366),
          beforeLabel: "Key handover",
          afterLabel: "Three weeks later",
        },
        { type: "collection", id: "mr-ready", title: "Ready stock, delivered this week", collectionSlug: "ready-stock", layout: "carousel", limit: 10 },
        {
          type: "hero-split",
          id: "mr-showroom",
          imageUrl: photo(6758237, "tile"),
          imageSide: "right",
          eyebrow: "Avinashi Road · Peelamedu",
          heading: "Sit on it before you buy it",
          text: "Twelve thousand square feet of rooms on two floors, a mattress corner where you can lie down for as long as you like, and our workshop a twenty-minute drive away in Podanur. Free room measuring anywhere in Coimbatore, and no-cost EMI for 3 or 6 months on cards.",
          cta: { label: "Book a showroom visit", href: waLink("Hello Maram Furniture, I'd like to visit the showroom on … at … .") },
          cta2: { label: "Delivery & EMI", href: "/pages/delivery-and-installation" },
          style: { background: "muted" },
        },
        {
          type: "testimonials",
          id: "mr-voices",
          title: "From homes we've furnished",
          layout: "cards",
          items: [
            { quote: "The carved teak cot took four weeks, and they sent us photos from the workshop every week. It's the first thing visitors ask about.", name: "Kavitha R.", role: "R.S. Puram, Coimbatore", rating: 5 },
            { quote: "They carried an L-shape sofa up four floors without a lift, fitted it and took every bit of packing away. A screw was loose the next day; the fitter came back within hours.", name: "Arun M.", role: "Saravanampatti", rating: 5 },
            { quote: "Ordered two bunk beds and the oonjal for our house in Karur. The truck came on the day they said, with a carpenter who hung the swing from our beam.", name: "Senthil K.", role: "Karur", rating: 5 },
          ],
        },
        { type: "faq", id: "mr-faq", title: "Delivery, EMI and returns", items: FAQ },
        {
          type: "location",
          id: "mr-visit",
          title: "The showroom on Avinashi Road",
          address: "418, Avinashi Road, Peelamedu, Coimbatore 641004 (workshop: 22, Podanur Main Road, Podanur 641023)",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "11.0247, 77.0028",
        },
      ],
      translations: {
        ta: {
          "mr-living": {
            title: "வரவேற்பறைக்குள் வாருங்கள்",
            text: "இந்த அறையில் உள்ள ஒவ்வொன்றும் அவிநாசி சாலை ஷோரூமில் உள்ளது. புள்ளியைத் தொட்டு பொருள், அளவு, விலை பாருங்கள்.",
            alt: "பழுப்பு L-வடிவ சோஃபா, காபி மேசை, டிவி கன்சோலுடன் வரவேற்பறை",
          },
          "mr-rooms": { title: "அறை அறையாக ஷோரூமைச் சுற்றிப் பாருங்கள்" },
          "mr-sofa-finder": {
            title: "உங்கள் சோஃபாவைக் கண்டுபிடியுங்கள்",
            text: "மூன்று கேள்விகள்: உங்கள் ஹால், எத்தனை பேர் அமர்வார்கள், எந்த உணர்வு பிடிக்கும். தெரியாததைத் தவிர்க்கலாம்; முடிவு செய்யும் முன் அறையை இலவசமாக அளந்து தருவோம்.",
            cta: { label: "அறை அளவை வாட்ஸ்அப்பில் அனுப்புங்கள்" },
            questions: [
              { label: "அறை எவ்வளவு பெரியது?", options: [{ label: "சிறியது: 10 × 12 அடிக்குள்" }, { label: "நடுத்தரம்: 12 × 14 அடி" }, { label: "பெரியது: 14 × 18 அடியும் மேலும்" }] },
              { label: "எத்தனை இருக்கைகள்?", options: [{ label: "1: படிக்கும் நாற்காலி" }, { label: "2" }, { label: "3" }, { label: "5 அல்லது அதிகம்: L-வடிவம்" }] },
              { label: "எந்த உணர்வு?", options: [{ label: "மென்மையான துணி" }, { label: "துடைக்க எளிய லெதரெட்" }, { label: "ரிக்ளைனர்" }] },
            ],
          },
          "mr-fabrics": {
            title: "வருவதற்கு முன்பே துணியைத் தேர்ந்தெடுங்கள்",
            text: "நாங்கள் வைத்திருக்கும் ஒவ்வொரு நிறத்திலும் எங்கள் துணி சோஃபாக்கள். இன்னும் 60 நெசவுகளின் மாதிரிப் புத்தகங்கள் ஷோரூமில்; தமிழ்நாட்டில் எங்கும் மூன்று மாதிரித் துண்டுகளை இலவசமாக அனுப்புவோம்.",
          },
          "mr-bedroom": { title: "படுக்கையறை", text: "செதுக்கிய தேக்குக் கட்டில், படிக்கும் நாற்காலி, பக்க மேசைகள்.", alt: "மரக் கட்டில், பக்க மேசைகள், நாற்காலியுடன் படுக்கையறை" },
          "mr-dining": { title: "சாப்பாட்டு அறை", text: "ஞாயிறு மதிய உணவுக்கு, உறுதியான தேக்கைச் சுற்றி ஆறு நாற்காலிகள்.", alt: "மர மேசையும் ஆறு நாற்காலிகளும் உள்ள சாப்பாட்டு அறை" },
          "mr-mattresses": {
            title: "நான்கு மெத்தைகள், அருகருகே",
            text: "ஷோரூமில் நான்கிலும் படுத்துப் பாருங்கள். விலைகள் குயீன் அளவுக்கு (78 × 60 அங்குலம்); எல்லா அளவுகளும் பொருள் பக்கத்தில்.",
            highlightLabel: "அதிகம் வாங்கியது",
            rows: [
              { label: "உணர்வு", values: ["உறுதியானது", "நடுத்தரம், உடலுக்கேற்ப அமையும்", "சற்று மென்மை, துள்ளல்", "உறுதி, காற்றோட்டம்"] },
              { label: "உள்ளமைப்பு", values: ["பாண்டட் ஃபோம் + HR ஃபோம்", "ஜெல் மெமரி ஃபோம் + HR அடிப்பகுதி", "தனித்தனி ஸ்பிரிங்குகள் + தலையணை மேல்பகுதி", "பொள்ளாச்சி ரப்பர் தேங்காய்நார் + 1 அங்குல ஃபோம்"] },
              { label: "யாருக்கு ஏற்றது", values: ["முதுகுவலி, மல்லாந்து தூங்குபவர்", "ஒருக்களித்துத் தூங்குபவர், தோள்வலி", "தம்பதிகள், லேசாக விழிப்பவர்", "சூடான அறைகள், உறுதியான படுக்கை விரும்புவோர்"] },
              { label: "குளிர்ச்சியா?", values: ["சராசரி", "நன்று (ஜெல், திறந்த செல்)", "மிக நன்று (ஸ்பிரிங் இடையே காற்று)", "சிறந்தது (நார் சுவாசிக்கும்)"] },
              { label: "தடிமன்", values: ["8 அங்குலம்", "8 அங்குலம்", "10 அங்குலம்", "6 அங்குலம்"] },
              { label: "வாரண்டி", values: ["10 ஆண்டு", "10 ஆண்டு", "8 ஆண்டு", "5 ஆண்டு"] },
              { label: "ஜிஎஸ்டி", values: ["18%", "18%", "18%", "5%"] },
            ],
          },
          "mr-workshop": {
            title: "மரம் கட்டில் எப்படி உருவாகிறது",
            chapters: [
              chapter({ eyebrow: "வாரம் 1", heading: "தேக்கைத் தேர்ந்து உலர்த்துதல்", markdown: "நிலம்பூர் டிப்போக்களிலிருந்து வளர்ப்புத் தேக்கு மரங்களை வாங்கி, **போத்தனூர்** முற்றத்தில் அறுக்கிறோம். ஈரப்பதம் **10–12%** ஆகும் வரை பலகைகள் உலையில் ஓய்வெடுக்கும்: அவசரப்பட்ட மரம் முதல் கோவை வெயிலிலேயே விரிசல் விடும்.", alt: "மரப் பட்டறையில் பலகையைச் சுமக்கும் தச்சர்" }),
              chapter({ eyebrow: "வாரம் 2", heading: "இழைப்பும் இணைப்பும்", markdown: "ஒவ்வொரு பலகையும் நேராக இழைக்கப்பட்டு, **பொருத்து-நுழைப்பு** இணைப்புகளாலும் மரஆணிகளாலும் இணைத்து, பசை போட்டு இரவு முழுக்க இறுக்கி வைக்கப்படும். பாரம் தாங்கும் இணைப்பில் ஒருபோதும் இரும்பு ஆணி இல்லை.", alt: "இயந்திரத்தில் பலகையை இழைக்கும் தச்சர்" }),
              chapter({ eyebrow: "வாரம் 2–3", heading: "கையால் செதுக்குதல்", markdown: "**காரைக்குடியில்** பயின்ற எங்கள் இரண்டு மூத்த சிற்பிகள் உளியும் சுத்தியுமாகத் தாமரை, கொடி, ஆத்தங்குடி ஓடு வடிவங்களைத் தலைப்பலகையில் செதுக்குவார்கள்: கிங் சைஸ் கட்டிலுக்குச் சுமார் **60 மணி நேரம்**.", alt: "கருமரத்தில் செதுக்கிய பூக்களின் அருகாமைப் படம்" }),
              chapter({ eyebrow: "வாரம் 4", heading: "மெருகேற்றுதல்", markdown: "நான்கு வகை உப்புத்தாளில் தேய்த்து, கேட்டால் நிறமேற்றி, ஒவ்வொன்றுக்கும் இடையே ஒரு நாள் ஓய்வுடன் மூன்று அடுக்கு **கையால் தேய்த்த PU**: பிளாஸ்டிக் பளபளப்பு இல்லாமல் மர இழை ஒளிரும்.", alt: "கையால் மரத்தை வடிவமைக்கும் தச்சர்" }),
              chapter({ eyebrow: "டெலிவரி நாள்", heading: "உங்கள் படுக்கையறைக்கு, பொருத்தியபடி", markdown: "எங்கள் லாரியில் எங்கள் ஆட்கள் இருவர் கொண்டு வந்து, (லிஃப்ட் இல்லாத நான்காம் மாடியானாலும்) மேலே சுமந்து, பொருத்தி, பேக்கிங்கை எடுத்துச் செல்வார்கள். அவர்கள் கிளம்பும் முன் சரிபாருங்கள்.", alt: "பச்சை சோஃபாவை அறைக்குள் சுமக்கும் இருவர்" }, "செட்டிநாடு கட்டிலைப் பாருங்கள்"),
            ],
          },
          "mr-makeover": {
            title: "சரவணம்பட்டியில் ஒரு காலி ஹால், மூன்று வாரம் கழித்து",
            text: "ஓர் இளம் தம்பதியின் புதிய ஃபிளாட்: அளந்து, அறையை வரைந்து, அவர்களின் ₹1.2 லட்சம் பட்ஜெட்டுக்குள் சோஃபா, டிவி யூனிட், காபி மேசையால் அலங்கரித்தோம். கைப்பிடியை இழுத்துப் பாருங்கள்.",
            beforeLabel: "சாவி கிடைத்த நாள்",
            afterLabel: "மூன்று வாரம் கழித்து",
          },
          "mr-ready": { title: "ரெடி ஸ்டாக், இந்த வாரமே டெலிவரி" },
          "mr-showroom": {
            eyebrow: "அவிநாசி சாலை · பீளமேடு",
            heading: "வாங்கும் முன் அமர்ந்து பாருங்கள்",
            text: "இரண்டு தளங்களில் பன்னிரண்டாயிரம் சதுர அடி அறைகள், விரும்பும் வரை படுத்துப் பார்க்க ஒரு மெத்தை மூலை, இருபது நிமிடத் தொலைவில் போத்தனூரில் எங்கள் பட்டறை. கோவையில் எங்கும் இலவச அறை அளவீடு, கார்டில் 3 அல்லது 6 மாத வட்டியில்லா EMI.",
            cta: { label: "ஷோரூம் வருகையை முன்பதிவு செய்யுங்கள்" },
            cta2: { label: "டெலிவரி & EMI" },
          },
          "mr-voices": {
            title: "நாங்கள் அலங்கரித்த வீடுகளிலிருந்து",
            items: [
              { quote: "செதுக்கிய தேக்குக் கட்டிலுக்கு நான்கு வாரம் ஆனது; ஒவ்வொரு வாரமும் பட்டறையிலிருந்து படம் அனுப்பினார்கள். வருபவர்கள் முதலில் கேட்பது அதைப் பற்றித்தான்.", role: "ஆர்.எஸ். புரம், கோவை" },
              { quote: "லிஃப்ட் இல்லாமல் நான்கு மாடி L-வடிவ சோஃபாவைச் சுமந்து, பொருத்தி, பேக்கிங் முழுவதையும் எடுத்துச் சென்றார்கள். மறுநாள் ஒரு திருகு தளர்ந்திருந்தது; சில மணி நேரத்தில் ஃபிட்டர் திரும்ப வந்தார்.", role: "சரவணம்பட்டி" },
              { quote: "கரூர் வீட்டுக்கு இரண்டு பங்க் பெட்டும் ஊஞ்சலும் ஆர்டர் செய்தோம். சொன்ன நாளில் லாரி வந்தது; உடன் வந்த தச்சர் எங்கள் உத்தரத்தில் ஊஞ்சலை மாட்டினார்.", role: "கரூர்" },
            ],
          },
          "mr-faq": { title: "டெலிவரி, EMI, திருப்புதல்", items: FAQ_TA },
          "mr-visit": {
            title: "அவிநாசி சாலை ஷோரூம்",
            address: "418, அவிநாசி சாலை, பீளமேடு, கோயம்புத்தூர் 641004 (பட்டறை: 22, போத்தனூர் மெயின் ரோடு, போத்தனூர் 641023)",
            hours: [
              { label: "ஷோரூம், தினமும்", value: "காலை 10:00 – இரவு 9:00" },
              { label: "பட்டறை வருகை", value: "திங்கள் – சனி, காலை 10 – மாலை 5" },
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
        { type: "heading", level: 2, text: "Maram, from a Podanur workshop since 1987" },
        {
          type: "paragraph",
          markdown:
            "Maram began in **1987** as a two-man carpentry workshop in **Podanur**, making teak cots and almirahs for Coimbatore families to order. Our founder learned carving in Karaikudi, and the Chettinad bed, the easy chair and the oonjal are still made the way he taught.\n\nToday fourteen carpenters, carvers and polishers work in the same workshop, and the **Avinashi Road showroom** (opened in 2009) shows their pieces next to the sofas, mattresses and office chairs we source from makers in Tiruppur, Bengaluru and Pollachi. Every piece is delivered and fitted by our own people.",
        },
        { type: "image", url: photo(14653155, "tile"), alt: "Carpenters at work in a workshop" },
        { type: "paragraph", markdown: "Showroom open every day 10 am – 9 pm. Call or WhatsApp **+91 98765 00041**." },
      ],
    },
    {
      slug: "delivery-and-installation",
      title: "Delivery, installation and EMI",
      blocks: () => [
        { type: "heading", level: 2, text: "Delivered and fitted by our own team" },
        {
          type: "paragraph",
          markdown:
            "| Where | Charge | When |\n|---|---|---|\n| Coimbatore city (6410xx) | Free above ₹20,000, else ₹750 | Ready stock in 2–4 days |\n| Tiruppur, Erode, Pollachi (641, 638, 642) | ₹1,500, free above ₹60,000 | 3–6 days |\n| Rest of Tamil Nadu | ₹3,500 by our truck | 7–12 days |\n\nMade-to-order pieces leave **15–30 days** after the order (each product page says how long). Installation is always included: beds and wardrobes assembled, TV units wall-mounted, oonjal and swing hooks fixed into RCC.\n\n**At delivery:** check every piece with our fitter before he leaves; transit damage is replaced free. Hidden damage: photos on WhatsApp **within 48 hours**.\n\n**EMI:** no-cost 3 or 6 months on credit cards above ₹15,000 at checkout; 9–12 months on cards or consumer finance at the showroom (Aadhaar and PAN).",
        },
        { type: "faq", items: FAQ.slice(0, 4) },
      ],
    },
    {
      slug: "care-guide",
      title: "Caring for wood, cane and mattresses",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "So it lasts for the grandchildren" },
        {
          type: "paragraph",
          markdown:
            "- **Teak and sheesham:** dust with a dry cotton cloth; wipe spills at once. Keep 15 cm from walls that get damp in the monsoon and out of the afternoon sun. Use coasters and trivets.\n- **Cane and rattan:** keep out of the rain; a damp cloth and a coat of clear varnish every two years.\n- **Fabric sofas:** vacuum weekly; zip-off covers dry-clean only.\n- **Mattresses:** rotate head-to-foot every three months in the first year, then every six; use a protector; air it in the shade, never in the sun.\n- **Oonjal:** check the hooks and chains every Pongal; we re-tighten free for a year.",
        },
        { type: "image", url: photo(36609018, "tile"), alt: "Carved teak door panels with brass knobs" },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). They show furniture like ours, not our own pieces; people shown are photographers' subjects, not our customers or staff.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Living", type: "category", ref: "sofas", children: [{ label: "Living room", type: "category", ref: "living-room" }, { label: "Recliners", type: "collection", ref: "recliners" }] },
      { label: "Bedroom", type: "category", ref: "beds-and-mattresses", children: [{ label: "Mattresses", type: "collection", ref: "mattresses" }, { label: "Wardrobes", type: "category", ref: "wardrobes" }] },
      { label: "Dining", type: "category", ref: "dining-sets" },
      { label: "Work & study", type: "category", ref: "office-chairs-and-desks", children: [{ label: "Kids' furniture", type: "category", ref: "kids-furniture" }] },
      { label: "Chettinad", type: "collection", ref: "chettinad", children: [{ label: "Balcony & cane", type: "collection", ref: "balcony" }] },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Delivery, installation & EMI", type: "page", ref: "delivery-and-installation" },
          { label: "Care guide", type: "page", ref: "care-guide" },
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "Ready stock", type: "collection", ref: "ready-stock" },
          { label: "For 2BHK homes", type: "collection", ref: "small-homes" },
          { label: "Our story", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
