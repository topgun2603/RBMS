import type { DemoProduct, DemoStore } from "./types";

/**
 * Store #12 of the series: Malligai Flowers & Pooja Stores, Madurai (malligai.localhost:3003). A poo kadai and pooja
 * store on East Chithirai Street, a minute from the East Gopuram of the Meenakshi Amman temple, on the online store
 * app (EC) with the `florist_pooja` trade (weighing scales and `pos.weighing` on: loose flowers go on the counter
 * scale by the kilo) and the "kumkum-manjal" look (vermilion, turmeric and jasmine white). Malligai (மல்லிகை) is
 * Tamil for jasmine; Madurai malli has a GI tag and is bought every dawn at the Mattuthavani flower market. The shop
 * sells loose flowers by weight, jasmine strings by the muzham and the metre, garlands by length, wedding garland
 * pairs and stage decoration to order, pooja items, festival kits, temple offerings, brass and clay lamps and bouquets.
 * Names are generic (no brands); prices are typical Madurai prices in Deepavali week, October 2026, GST included.
 * Address, phone and GSTIN are placeholders like the other demo shops.
 *
 * Units, consistent with the scales feature: loose flowers are `kg` products with Weight options (100 g … 1 kg),
 * weighed in front of the shopper (store #3's convention for loose goods); strings are `m` with Length options
 * (1 muzham ≈ 45 cm, 1 m, 2 m); garlands `pcs` with a Size in feet; decoration a `package`.
 *
 * GST (CGST notification 9/2025-Central Tax (Rate), rate schedules, and 10/2025-Central Tax (Rate), the nil-rate
 * schedule that replaced 2/2017, both of 17 Sept 2025, in force from 22 Sept 2025; text read from the notifications):
 * - Fresh flowers, garlands and bouquets of fresh flowers, lotus, thulasi and mango leaves (chapter 06, "live trees and
 *   other plants … cut flowers and ornamental foliage"): nil, 10/2025 S. No. 26.
 * - Coconuts (0801, S. No. 45), bananas, betel leaves (1404 90 40, S. No. 93): nil.
 * - Kumkum (3304): nil, 10/2025 S. No. 117 ("Kajal …, Kumkum, Bindi, Sindur, Alta").
 * - Earthen / clay lamps, agal vilakku (6912 00 40): nil, 10/2025 S. No. 151 ("Earthen pot and clay lamps").
 *   UNCERTAIN: painted terracotta diyas sold as décor could be argued as ornamental ceramics (6913, 5%).
 * - Cotton wicks: nil, 10/2025 S. No. 167 (vii) "Wick for diya" (puja samagri). Sandal (chandanam) powder for tilak:
 *   nil as 167 (x) "Chandan tika" — UNCERTAIN: sandalwood powder sold otherwise is 1211 (dried, 5%) or 3304 (18%).
 * - Agarbathi (3307 41 00, "Agarbatti, lobhan, dhoop batti, dhoop, sambraani"): 5%, 9/2025 Schedule I.
 * - Turmeric powder (0910 30, other than fresh turmeric): 5%, Schedule I. Lamp oil (deepam oil blend, 1515): 5%,
 *   Schedule I entry 96 as read by the Maharashtra AAR on "pooja oil" (2025) — UNCERTAIN for other blends.
 * - Brass lamps (kuthuvilakku, swan deepam) as household articles of copper alloy (7418): 5%, Schedule I S. No. 417.
 *   UNCERTAIN: if classed as lamps (9405) they are 18%, or 5% only as certified handicrafts (13/2025).
 * - Camphor (2914): 18%, Schedule II (chapter 29; camphor is not in the puja samagri list). UNCERTAIN: sources
 *   differ on camphor tablets; we charge the higher rate.
 * - Pooja kits and the archanai basket are mixed supplies (CGST Act s. 8(b)): taxed at the highest rate of any item in
 *   them, so a kit with camphor is 18% (HSN of camphor), the Karthigai kit (agal, wicks, oil, no camphor) 5% and the
 *   coconut-and-banana plate nil.
 * - Flower decoration (labour + flowers, a composite supply of a service): SAC 998596 (event assistance services), 18%
 *   — UNCERTAIN classification (998599 "other support services" is also used); the rate is 18% either way.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500021";
const WHATSAPP = "919876500021";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

/** Loose flowers on the scale: 100 g, 250 g, 500 g and 1 kg from the per-kg rate (small packs round up a little). */
const byWeight = (perKg: number, g100: number, g250: number, g500: number, stock = 40) =>
  one("Weight", [
    ["100 g", g100, g100, stock],
    ["250 g", g250, g250, stock],
    ["500 g", g500, g500, Math.round(stock / 2)],
    ["1 kg", perKg, perKg, Math.round(stock / 4)],
  ]);

/** Strings by length: one muzham (elbow to fingertip, about 45 cm), 1 m and 2 m. */
const byLength = (muzham: number, m1: number, m2: number) =>
  one("Length", [
    ["1 muzham (≈45 cm)", muzham, muzham, 60],
    ["1 m", m1, m1, 40],
    ["2 m", m2, m2, 20],
  ]);

/** Garlands by length in feet. */
const bySize = (rows: [string, number, number][]) => one("Size", rows.map(([s, p, stock]) => [s, p, p, stock]));

const LOOSE = "Loose flowers";
const STRINGS = "Jasmine strings";
const GARLANDS = "Garlands";
const WEDDING = "Wedding garlands";
const DECOR = "Flower decoration";
const POOJA = "Pooja items";
const KITS = "Festival pooja kits";
const TEMPLE = "Temple offerings";
const LAMPS = "Lamps & diyas";
const BOUQUETS = "Bouquets & gifting";

const DAWN = "\n\nBought at the Mattuthavani flower market at 4:30 am and weighed in front of you (or packed by weight for delivery). Order by midnight for delivery between 6 and 8 am in Madurai city.";
const STRUNG = "\n\nStrung by hand in the shop every morning, close and even. Keep it wrapped in a damp cloth or a banana leaf in the coolest corner (not the fridge's freezer) and it stays fragrant till night.";
const ORDER_AHEAD = "\n\nMade to order: book at least";
const NO_SHIP = " Fresh flowers are not couriered: Madurai city and temple delivery only.";

const PRODUCTS: DemoProduct[] = [
  // ---- loose flowers (chapter 06, nil) — on the counter scale
  {
    name: "Madurai malli (jasmine), loose",
    category: LOOSE,
    hsn: "0603",
    gstRate: 0,
    unit: "kg",
    sku: "MF-MAL",
    photo: 38784646,
    tags: ["fresh-today", "malli", "bestseller", "daily"],
    description: `Madurai malli with the GI tag: thick, creamy buds picked the evening before, opening by sunset with the scent the town is known for. For hair, for the pooja room and for stringing at home.${DAWN}${NO_SHIP}`,
    attributes: { Flower: "Jasmine (Jasminum sambac), Madurai malli", Colour: "White", "Stays fresh": "1 day (buds open by evening)", Occasion: "Daily pooja, hair, weddings" },
    ...byWeight(1_200, 130, 310, 610),
  },
  {
    name: "Mullai (wild jasmine), loose",
    category: LOOSE,
    hsn: "0603",
    gstRate: 0,
    unit: "kg",
    sku: "MF-MUL",
    photo: 8311243,
    tags: ["fresh-today", "malli", "daily"],
    description: `Slender, pointed mullai buds with a lighter, sweeter scent than malli; the flower for Friday poojas and for Andal at Srivilliputhur.${DAWN}${NO_SHIP}`,
    attributes: { Flower: "Mullai (Jasminum auriculatum)", Colour: "White", "Stays fresh": "1 day", Occasion: "Daily pooja, hair" },
    ...byWeight(900, 95, 230, 460),
  },
  {
    name: "Kanakambaram (firecracker flower), loose",
    category: LOOSE,
    hsn: "0603",
    gstRate: 0,
    unit: "kg",
    sku: "MF-KAN",
    photo: 40182083,
    tags: ["fresh-today", "daily"],
    description: `Saffron-orange kanakambaram from Thovalai and Nilakottai: no scent, but it keeps its colour for two days, so it goes between malli in strings and on the deity's crown.${DAWN}${NO_SHIP}`,
    attributes: { Flower: "Kanakambaram (Crossandra)", Colour: "Saffron orange", "Stays fresh": "2 days", Occasion: "Strings, hair, temple" },
    ...byWeight(800, 85, 205, 410),
  },
  {
    name: "Paneer rose, loose",
    category: LOOSE,
    hsn: "0603",
    gstRate: 0,
    unit: "kg",
    sku: "MF-ROS",
    photo: 32503416,
    tags: ["fresh-today", "rose", "temple"],
    description: `Fragrant country (paneer) roses from Hosur and Kodaikanal growers, pink to deep red: whole heads for the pooja plate, petals for archanai and showering at weddings.${DAWN}${NO_SHIP}`,
    attributes: { Flower: "Paneer rose (Rosa damascena type)", Colour: "Pink to red, mixed", "Stays fresh": "2 days", Occasion: "Archanai, weddings, pooja" },
    ...byWeight(240, 30, 65, 125, 60),
  },
  {
    name: "Samanthi (marigold), loose",
    category: LOOSE,
    hsn: "0603",
    gstRate: 0,
    unit: "kg",
    sku: "MF-SAM",
    photo: 35408422,
    tags: ["fresh-today", "samanthi", "temple", "deepavali"],
    description: `Big orange samanthi heads, tight and dry (they don't rot in the string): for door garlands, kolam centres, the vehicle pooja and festival thoranams.${DAWN}${NO_SHIP}`,
    attributes: { Flower: "Marigold (Tagetes)", Colour: "Orange and yellow", "Stays fresh": "3 days", Occasion: "Festivals, doorways, vehicle pooja" },
    ...byWeight(110, 15, 30, 58, 80),
  },
  {
    name: "Sevanthi (chrysanthemum), loose",
    category: LOOSE,
    hsn: "0603",
    gstRate: 0,
    unit: "kg",
    sku: "MF-SEV",
    photo: 35894441,
    tags: ["fresh-today", "temple"],
    description: `White sevanthi from Hosur, full and long-lasting: the flower for elders' photographs, for Perumal temples and for layering between roses in garlands.${DAWN}${NO_SHIP}`,
    attributes: { Flower: "Chrysanthemum (sevanthi)", Colour: "White, cream", "Stays fresh": "3 days", Occasion: "Photographs, temple, garlands" },
    ...byWeight(180, 20, 48, 92, 50),
  },
  {
    name: "Arali (oleander), loose",
    category: LOOSE,
    hsn: "0603",
    gstRate: 0,
    unit: "kg",
    sku: "MF-ARA",
    photo: 17489850,
    tags: ["fresh-today", "temple"],
    description: `Pink and red double arali for Amman and Vinayagar poojas, picked with a little stem so it sits upright on the plate. For offering only: arali is not to be eaten.${DAWN}${NO_SHIP}`,
    attributes: { Flower: "Oleander (arali)", Colour: "Pink, red", "Stays fresh": "2 days", Occasion: "Amman and Vinayagar pooja" },
    ...byWeight(260, 30, 70, 135, 30),
  },
  {
    name: "Thamarai (lotus)",
    category: LOOSE,
    hsn: "0603",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-LOT",
    photo: 13861388,
    tags: ["fresh-today", "temple", "deepavali"],
    description: `Pink lotus buds from the tanks near Thiruparankundram, sold by the flower with a hand's length of stem. They open in the pooja room by mid-morning: the flower for Lakshmi and for Friday poojas.${NO_SHIP}`,
    attributes: { Flower: "Lotus (Nelumbo nucifera)", Colour: "Pink", "Stays fresh": "1–2 days in water", Occasion: "Lakshmi pooja, Fridays, Deepavali" },
    ...one("Count", [
      ["1 flower", 20, 20, 80],
      ["5 flowers", 95, 100, 30],
      ["11 flowers", 200, 220, 15],
    ]),
  },

  // ---- jasmine strings by length (nil)
  {
    name: "Madurai malli string",
    category: STRINGS,
    hsn: "0603",
    gstRate: 0,
    unit: "m",
    sku: "MF-SMA",
    photo: 39143270,
    tags: ["fresh-today", "malli", "bestseller", "daily"],
    description: `Our everyday string: Madurai malli buds strung two-deep on banana fibre, the way it's sold outside the temple. One muzham for a plait, a metre for the pooja-room photo frames.${STRUNG}${NO_SHIP}`,
    attributes: { Flower: "Madurai malli", "Stays fresh": "Till night", Occasion: "Hair, daily pooja" },
    ...byLength(40, 85, 165),
  },
  {
    name: "Mullai string",
    category: STRINGS,
    hsn: "0603",
    gstRate: 0,
    unit: "m",
    sku: "MF-SMU",
    photo: 39139873,
    tags: ["fresh-today", "malli", "daily"],
    description: `A thick mullai string, lighter in scent than malli and lovely for children's plaits and the Friday pooja.${STRUNG}${NO_SHIP}`,
    attributes: { Flower: "Mullai", "Stays fresh": "Till night", Occasion: "Hair, Friday pooja" },
    ...byLength(35, 75, 145),
  },
  {
    name: "Kanakambaram string",
    category: STRINGS,
    hsn: "0603",
    gstRate: 0,
    unit: "m",
    sku: "MF-SKA",
    photo: 5719462,
    tags: ["fresh-today", "daily"],
    description: `Bright saffron kanakambaram strung close: it keeps its colour for two days, so it's the string for travel and long functions.${STRUNG}${NO_SHIP}`,
    attributes: { Flower: "Kanakambaram", "Stays fresh": "2 days", Occasion: "Hair, functions" },
    ...byLength(30, 65, 125),
  },
  {
    name: "Malli and kanakambaram string",
    category: STRINGS,
    hsn: "0603",
    gstRate: 0,
    unit: "m",
    sku: "MF-SMK",
    photo: 40004833,
    tags: ["fresh-today", "malli", "wedding"],
    description: `White malli and saffron kanakambaram in alternate bands: the classic Madurai two-colour string for weddings, seemantham and festival mornings.${STRUNG}${NO_SHIP}`,
    attributes: { Flower: "Malli, kanakambaram", "Stays fresh": "Till night", Occasion: "Weddings, festivals" },
    ...byLength(40, 85, 165),
  },
  {
    name: "Jathi malli (pichi) string",
    category: STRINGS,
    hsn: "0603",
    gstRate: 0,
    unit: "m",
    sku: "MF-SJA",
    photo: 29558121,
    tags: ["fresh-today", "malli"],
    description: `Long-stemmed jathi malli (pichi poo) strung loose and airy, with a scent that fills a room in the evening. Lovely draped over the pooja-room door.${STRUNG}${NO_SHIP}`,
    attributes: { Flower: "Jathi malli (Jasminum grandiflorum)", "Stays fresh": "Till night", Occasion: "Evening pooja, hair" },
    ...byLength(30, 65, 125),
  },

  // ---- garlands by length (nil)
  {
    name: "Temple garland, rose and samanthi",
    category: GARLANDS,
    hsn: "0603",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-GTR",
    photo: 13333358,
    tags: ["temple", "rose", "samanthi", "bestseller"],
    description: `Rings of orange samanthi and deep-pink rose on a strong cotton core, the garland we tie most for the sannidhi. 1 ft for a photo frame, 2 ft for the home deity, 3 ft for a temple idol.${STRUNG}${NO_SHIP}`,
    attributes: { Flower: "Samanthi, rose", "Stays fresh": "2 days", Occasion: "Temple, home deity", "Deity / temple": "Any" },
    ...bySize([
      ["1 ft", 60, 40],
      ["2 ft", 120, 30],
      ["3 ft", 220, 15],
    ]),
  },
  {
    name: "Rose garland",
    category: GARLANDS,
    hsn: "0603",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-GRO",
    photo: 27785418,
    tags: ["temple", "rose", "welcome", "photo"],
    description: `Paneer rose heads tied tight with a malli edge and a tassel: for felicitations, a guest of honour and the elders' photographs on anniversaries.${STRUNG}${NO_SHIP}`,
    attributes: { Flower: "Paneer rose, malli edge", "Stays fresh": "2 days", Occasion: "Felicitation, photographs, temple" },
    ...bySize([
      ["1 ft", 120, 30],
      ["2 ft", 250, 20],
      ["3 ft", 450, 10],
    ]),
  },
  {
    name: "Samanthi garland",
    category: GARLANDS,
    hsn: "0603",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-GSA",
    photo: 35124359,
    tags: ["temple", "samanthi", "housewarming", "photo", "deepavali"],
    description: `Dense orange samanthi on a cotton core: for doorways, vehicles at Ayudha Pooja, shop openings and Deepavali. Lasts three days in the shade.${NO_SHIP}`,
    attributes: { Flower: "Samanthi", "Stays fresh": "3 days", Occasion: "Doorways, vehicles, festivals" },
    ...bySize([
      ["1 ft", 40, 60],
      ["2 ft", 80, 40],
      ["3 ft", 150, 25],
    ]),
  },
  {
    name: "Malli and samanthi garland",
    category: GARLANDS,
    hsn: "0603",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-GMS",
    photo: 38705730,
    tags: ["temple", "malli", "samanthi", "welcome", "housewarming"],
    description: `Plaited malli with samanthi bunches every hand-span, laid on banana leaf for you: for welcoming guests, a house-warming entrance and the bride's family.${STRUNG}${NO_SHIP}`,
    attributes: { Flower: "Malli, samanthi", "Stays fresh": "1 day", Occasion: "Welcome, house-warming" },
    ...bySize([
      ["1 ft", 90, 30],
      ["2 ft", 180, 20],
      ["3 ft", 340, 10],
    ]),
  },
  {
    name: "Layered sevanthi and leaf garland",
    category: GARLANDS,
    hsn: "0603",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-GLL",
    photo: 10271106,
    tags: ["temple", "housewarming"],
    description: `Bands of yellow sevanthi, folded green leaves and orange samanthi, the layered garland temple priests ask for on festival days. It holds its shape for two days.${ORDER_AHEAD} 1 day ahead for the 3 ft size.${NO_SHIP}`,
    attributes: { Flower: "Sevanthi, samanthi, leaves", "Stays fresh": "2 days", Occasion: "Temple festivals", "Order ahead": "1 day (3 ft)" },
    ...bySize([
      ["1 ft", 90, 20],
      ["2 ft", 170, 15],
      ["3 ft", 320, 8],
    ]),
  },
  {
    name: "Thulasi garland",
    category: GARLANDS,
    hsn: "0604",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-GTU",
    photo: 29657646,
    tags: ["temple", "thulasi"],
    description: `Fresh thulasi sprigs tied close with a few malli buds: the garland for Perumal on Saturdays, Purattasi and Vaikunta Ekadasi. Strung in the morning from our own thulasi bed.${STRUNG}${NO_SHIP}`,
    attributes: { Flower: "Thulasi (holy basil), malli", "Stays fresh": "2 days", Occasion: "Perumal temple, Saturdays", "Deity / temple": "Perumal (Vishnu)" },
    ...bySize([
      ["1 ft", 50, 30],
      ["2 ft", 100, 20],
      ["3 ft", 180, 10],
    ]),
  },

  // ---- wedding garlands (made to order, nil)
  {
    name: "Rose wedding garland pair",
    category: WEDDING,
    hsn: "0603",
    gstRate: 0,
    unit: "pair",
    sku: "MF-WRO",
    photo: 20626529,
    tags: ["wedding", "rose", "advance-order", "bestseller"],
    description: `The Madurai kalyana malai: two thick garlands of deep-red rose petals packed tight, with a jasmine collar and tassels, for the bride and groom to exchange. Delivered to the mandapam in a wet-cloth box an hour before the muhurtham.${ORDER_AHEAD} 3 days ahead (7 in the wedding months: Thai, Panguni, Vaikasi, Avani).${NO_SHIP}`,
    attributes: { Flower: "Rose petals, malli", "Stays fresh": "1 day", Occasion: "Wedding (malai maatral)", "Order ahead": "3 days" },
    ...bySize([
      ["4 ft", 3_200, 6],
      ["5 ft", 4_200, 4],
    ]),
  },
  {
    name: "Malli and rose wedding garland pair",
    category: WEDDING,
    hsn: "0603",
    gstRate: 0,
    unit: "pair",
    sku: "MF-WMR",
    photo: 39516594,
    tags: ["wedding", "malli", "rose", "advance-order"],
    description: `Our most fragrant pair: ropes of Madurai malli with red rose bunches and a rose-petal pendant, strung on the wedding morning so the malli opens during the ceremony.${ORDER_AHEAD} 3 days ahead.${NO_SHIP}`,
    attributes: { Flower: "Madurai malli, rose", "Stays fresh": "1 day", Occasion: "Wedding, reception", "Order ahead": "3 days" },
    ...bySize([
      ["4 ft", 4_500, 4],
      ["5 ft", 5_800, 3],
    ]),
  },
  {
    name: "Nichayathartham (engagement) garland pair",
    category: WEDDING,
    hsn: "0603",
    gstRate: 0,
    unit: "pair",
    sku: "MF-WEN",
    photo: 8886982,
    tags: ["wedding", "samanthi", "rose", "advance-order"],
    description: `A lighter pair of samanthi and rose with malli bands for the engagement, the seemantham or a 60th-birthday (shashtiapthapoorthi) blessing.${ORDER_AHEAD} 2 days ahead.${NO_SHIP}`,
    attributes: { Flower: "Samanthi, rose, malli", "Stays fresh": "1 day", Occasion: "Engagement, seemantham, 60th birthday", "Order ahead": "2 days" },
    ...bySize([
      ["4 ft", 1_800, 6],
      ["5 ft", 2_400, 4],
    ]),
  },
  {
    name: "Bridal poo jadai (jasmine braid)",
    category: WEDDING,
    hsn: "0603",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-WJA",
    photo: 36587827,
    tags: ["wedding", "malli", "advance-order"],
    description: `A jasmine cover for the bride's plait, sewn on a net base with malli rows and a kunjalam at the end; our florist pins it on at the mandapam if you book the dressing slot.${ORDER_AHEAD} 2 days ahead.${NO_SHIP}`,
    attributes: { Flower: "Madurai malli", "Stays fresh": "1 day", Occasion: "Wedding, reception", "Order ahead": "2 days" },
    ...one("Length", [
      ["Waist length", 1_500, 1_500, 6],
      ["Knee length", 2_400, 2_400, 4],
    ]),
  },

  // ---- flower decoration packages (service, 18%)
  {
    name: "Wedding stage decoration, Classic",
    category: DECOR,
    hsn: "998596",
    gstRate: 18,
    unit: "package",
    sku: "MF-DCL",
    photo: 34389342,
    tags: ["wedding", "decoration", "advance-order"],
    description: `A clean white-and-pastel stage: draped back cloth, carnation and rose clusters on the backdrop corners, two flower stands and a rose-petal aisle line. Our team sets it up in 3 hours and clears it after.${ORDER_AHEAD} 7 days ahead; 30% advance confirms the date.`,
    attributes: { Occasion: "Wedding, reception", "Order ahead": "7 days", Flowers: "Carnation, rose, gypsophila" },
    ...one("Size", [
      ["Hall up to 300 guests", 15_000, 15_000, 4],
      ["Hall 300–800 guests", 22_000, 22_000, 3],
    ]),
  },
  {
    name: "Wedding stage decoration, Kalyanam",
    category: DECOR,
    hsn: "998596",
    gstRate: 18,
    unit: "package",
    sku: "MF-DKA",
    photo: 12584803,
    tags: ["wedding", "decoration", "advance-order", "bestseller"],
    description: `The Madurai wedding look: a rose arch over the oonjal, malli curtains, banana-trunk and mango-leaf entrance, a samanthi kolam at the steps and the couple's garland pair included.${ORDER_AHEAD} 10 days ahead; 30% advance confirms the date.`,
    attributes: { Occasion: "Wedding", "Order ahead": "10 days", Flowers: "Rose, malli, samanthi, mango leaves" },
    ...one("Size", [
      ["Hall up to 300 guests", 28_000, 28_000, 3],
      ["Hall 300–800 guests", 38_000, 38_000, 2],
    ]),
  },
  {
    name: "Wedding stage decoration, Grand mandapam",
    category: DECOR,
    hsn: "998596",
    gstRate: 18,
    unit: "package",
    sku: "MF-DGR",
    photo: 33914531,
    tags: ["wedding", "decoration", "advance-order"],
    description: `A full mandapam: jasmine and rose arches across the stage, hanging malli chandeliers, lit brass kuthuvilakkus, a flower entrance tunnel and the dining-hall tables, with the garland pair and the bride's poo jadai included.${ORDER_AHEAD} 15 days ahead; 30% advance confirms the date.`,
    attributes: { Occasion: "Wedding", "Order ahead": "15 days", Flowers: "Malli, rose, orchids, samanthi" },
    ...one("Size", [
      ["Hall up to 300 guests", 48_000, 48_000, 2],
      ["Hall 300–800 guests", 65_000, 65_000, 2],
    ]),
  },
  {
    name: "House-warming (grihapravesam) flower decoration",
    category: DECOR,
    hsn: "998596",
    gstRate: 18,
    unit: "package",
    sku: "MF-DHW",
    photo: 39820649,
    tags: ["housewarming", "decoration", "advance-order"],
    description: `Mango-leaf thoranams on every door, a samanthi-and-malli entrance garland, a flower kolam at the threshold and the pooja corner done up for the homam; we come at 4 am for an early muhurtham.${ORDER_AHEAD} 3 days ahead.`,
    attributes: { Occasion: "House-warming", "Order ahead": "3 days", Flowers: "Samanthi, malli, rose, mango leaves" },
    ...one("Size", [
      ["Entrance and pooja room", 3_500, 3_500, 6],
      ["Full house (2 BHK)", 6_500, 6_500, 4],
      ["Full house (3 BHK and up)", 9_500, 9_500, 3],
    ]),
  },
  {
    name: "Wedding car flower decoration",
    category: DECOR,
    hsn: "998596",
    gstRate: 18,
    unit: "package",
    sku: "MF-DCA",
    photo: 11226703,
    tags: ["wedding", "decoration", "advance-order"],
    description: `Fresh roses and gerberas on a foam base that doesn't scratch the paint, tied with satin ribbon; done at your doorstep an hour before the procession.${ORDER_AHEAD} 2 days ahead.`,
    attributes: { Occasion: "Wedding, reception", "Order ahead": "2 days", Flowers: "Rose, gerbera, gypsophila" },
    ...one("Size", [
      ["Bonnet bouquet", 1_800, 1_800, 6],
      ["Full car (bonnet, doors, rear)", 4_500, 4_500, 4],
    ]),
  },

  // ---- pooja items
  {
    name: "Pure camphor tablets",
    category: POOJA,
    hsn: "2914",
    gstRate: 18,
    unit: "pack",
    sku: "MF-CAM",
    photo: 7750217,
    tags: ["ships", "daily", "deepavali"],
    description: "Clean-burning camphor (karpooram) tablets that leave no black residue on the aarti plate; sealed in a tin so they don't evaporate. Couriered across Tamil Nadu.",
    attributes: { Type: "Camphor tablets", Burns: "Clean, no residue" },
    ...one("Pack", [
      ["50 g", 65, 70, 80],
      ["100 g", 125, 135, 60],
      ["250 g", 295, 320, 30],
    ]),
  },
  {
    name: "Agarbathi, malli and sandal",
    category: POOJA,
    hsn: "33074100",
    gstRate: 5,
    unit: "pack",
    sku: "MF-AGA",
    photo: 7176691,
    tags: ["ships", "daily"],
    description: "Hand-rolled bamboo agarbathi in two scents, Madurai malli and sandal, about 45 minutes a stick. Rolled for us in Kumbakonam; couriered across Tamil Nadu.",
    attributes: { Scent: "Malli, sandal (mixed pack)", "Burns for": "About 45 minutes" },
    ...one("Pack", [
      ["100 g", 60, 65, 80],
      ["250 g", 140, 150, 40],
    ]),
  },
  {
    name: "Kumkum",
    category: POOJA,
    hsn: "3304",
    gstRate: 0,
    unit: "pack",
    sku: "MF-KUM",
    photo: 13149632,
    tags: ["ships", "daily"],
    description: "Deep-red kumkum made the old way from turmeric and lime, for the forehead, the threshold and the archanai plate. Sold in a resealable pouch; couriered across Tamil Nadu.",
    attributes: { "Made from": "Turmeric, slaked lime", Colour: "Deep red" },
    ...one("Pack", [
      ["50 g", 30, 30, 100],
      ["100 g", 55, 55, 60],
    ]),
  },
  {
    name: "Manjal (turmeric) powder for pooja",
    category: POOJA,
    hsn: "091030",
    gstRate: 5,
    unit: "pack",
    sku: "MF-MAN",
    photo: 33554840,
    tags: ["ships", "daily", "pongal"],
    description: "Erode turmeric ground fine for abishekam, for the Pillaiyar you shape on Fridays and for the threshold. Couriered across Tamil Nadu.",
    attributes: { Origin: "Erode", Use: "Abishekam, pooja" },
    ...one("Pack", [
      ["100 g", 35, 35, 80],
      ["250 g", 80, 80, 40],
    ]),
  },
  {
    name: "Chandanam (sandal) powder",
    category: POOJA,
    hsn: "3304",
    gstRate: 0,
    unit: "pack",
    sku: "MF-CHA",
    photo: 13471282,
    tags: ["ships", "daily"],
    description: "Fine sandal powder for the tilak and the deity's chandana kaapu: mix with rose water to a paste. Couriered across Tamil Nadu.",
    attributes: { Use: "Tilak, chandana kaapu", "Mix with": "Rose water or water" },
    ...one("Pack", [
      ["20 g", 90, 95, 50],
      ["50 g", 210, 225, 25],
    ]),
  },
  {
    name: "Cotton wicks (thiri)",
    category: POOJA,
    hsn: "5908",
    gstRate: 0,
    unit: "pack",
    sku: "MF-WIC",
    photo: 34385011,
    tags: ["ships", "daily", "karthigai", "deepavali"],
    description: "Hand-rolled cotton wicks: round poo thiri for the agal and the kamakshi vilakku, long thiri for the kuthuvilakku. 100 in a box; couriered across Tamil Nadu.",
    attributes: { Material: "Cotton" },
    ...one("Type", [
      ["Round (poo thiri), 100 pcs", 30, 30, 100],
      ["Long thiri, 100 pcs", 40, 40, 80],
    ]),
  },
  {
    name: "Deepam oil, five-oil blend",
    category: POOJA,
    hsn: "1515",
    gstRate: 5,
    unit: "bottle",
    sku: "MF-OIL",
    photo: 34705732,
    tags: ["ships", "daily", "karthigai", "deepavali"],
    description: "Panchadeepa ennai: gingelly, castor, coconut, mahua (iluppai) and ghee-scented oil blended for a steady, smokeless flame in brass and clay lamps. For lamps only, not for cooking. Couriered across Tamil Nadu.",
    attributes: { Oils: "Gingelly, castor, coconut, iluppai, ghee-scented", Use: "Lamps only" },
    ...one("Size", [
      ["500 ml", 120, 130, 60],
      ["1 litre", 230, 250, 40],
    ]),
  },
  {
    name: "Mango-leaf thoranam",
    category: POOJA,
    hsn: "0604",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-THO",
    photo: 12951503,
    tags: ["housewarming", "deepavali", "pongal"],
    description: `Fresh mango leaves folded and strung on coir for the main door: for festivals, the house-warming and the first day of Thai. Tie it on the morning you get it.${NO_SHIP}`,
    attributes: { Material: "Fresh mango leaves, coir", "Stays fresh": "3–4 days" },
    ...one("Length", [
      ["4 ft", 60, 60, 40],
      ["8 ft", 110, 110, 20],
    ]),
  },

  // ---- festival pooja kits (mixed supplies: highest rate)
  {
    name: "Deepavali Lakshmi pooja kit",
    category: KITS,
    hsn: "2914",
    gstRate: 18,
    unit: "kit",
    sku: "MF-KDE",
    photo: 38109564,
    tags: ["festival", "deepavali", "bestseller"],
    description: "Everything for the Lakshmi pooja on Deepavali evening: 5 lotus, a 2 ft samanthi garland, betel and areca, kumkum, manjal, chandanam, camphor, agarbathi, 11 agal vilakku with wicks and oil, and a printed pooja order in Tamil. Fresh flowers come with Madurai delivery; couriered kits come without them.\n\nGST: a mixed supply, taxed at the highest rate in the kit (camphor, 18%).",
    attributes: { Festival: "Deepavali", Contents: "Lotus, garland, kumkum, manjal, camphor, agarbathi, 11 agal, wicks, oil" },
    ...one("Size", [
      ["Standard", 750, 799, 40],
      ["Family (double)", 1_250, 1_399, 20],
    ]),
  },
  {
    name: "Karthigai Deepam kit",
    category: KITS,
    hsn: "691200",
    gstRate: 5,
    unit: "kit",
    sku: "MF-KKA",
    photo: 30604307,
    tags: ["festival", "karthigai", "ships", "bestseller"],
    description: "Clay agal vilakku from Manamadurai potters with round cotton wicks and deepam oil, to line the doorstep, the steps and the compound wall on Karthigai Deepam evening. Couriered across Tamil Nadu (packed in straw).\n\nGST: a mixed supply, taxed at the highest rate in the kit (deepam oil, 5%; the clay lamps and wicks are nil).",
    attributes: { Festival: "Karthigai Deepam", Contents: "Clay agal vilakku, cotton wicks, deepam oil" },
    ...one("Size", [
      ["27 agal", 299, 320, 60],
      ["51 agal", 499, 540, 40],
      ["108 agal", 899, 980, 20],
    ]),
  },
  {
    name: "Pongal pooja kit",
    category: KITS,
    hsn: "2914",
    gstRate: 18,
    unit: "kit",
    sku: "MF-KPO",
    photo: 30519624,
    tags: ["festival", "pongal", "advance-order"],
    description: "For Thai Pongal morning: a new Manamadurai clay pongal paanai, a pair of sugarcanes, fresh turmeric plants to tie round the pot, mango-leaf thoranam, kolam powder, camphor, kumkum and betel. Booked from 1 January, delivered in Madurai on Bhogi evening.\n\nGST: a mixed supply, taxed at the highest rate in the kit (camphor, 18%).",
    attributes: { Festival: "Thai Pongal", Contents: "Clay pot, sugarcane pair, turmeric plants, thoranam, kolam powder, camphor, kumkum, betel", "Order ahead": "From 1 January" },
    ...single(1_150, 1_250, 30),
  },
  {
    name: "Navaratri golu and pooja kit",
    category: KITS,
    hsn: "2914",
    gstRate: 18,
    unit: "kit",
    sku: "MF-KNA",
    photo: 32070636,
    tags: ["festival", "navaratri"],
    description: "For the nine nights of golu: kumkum and manjal for the visitors' thamboolam, 50 betel-and-areca packs, camphor, agarbathi, a kalasam cloth and nine days of loose-flower coupons (250 g a day, collected at the shop). Golu dolls are not included.\n\nGST: a mixed supply, taxed at the highest rate in the kit (camphor, 18%).",
    attributes: { Festival: "Navaratri", Contents: "Kumkum, manjal, betel packs, camphor, agarbathi, kalasam cloth, flower coupons" },
    ...single(890, 990, 20),
  },
  {
    name: "Vinayagar Chathurthi pooja kit",
    category: KITS,
    hsn: "2914",
    gstRate: 18,
    unit: "kit",
    sku: "MF-KVI",
    photo: 36854238,
    tags: ["festival", "advance-order"],
    description: "A 9-inch clay Pillaiyar (unpainted, dissolves in water), a small umbrella, an erukkam-flower garland, arugampul, kumkum, manjal, camphor and agarbathi. Booked from August; delivered in Madurai the evening before.\n\nGST: a mixed supply, taxed at the highest rate in the kit (camphor, 18%).",
    attributes: { Festival: "Vinayagar Chathurthi", Contents: "Clay Pillaiyar, umbrella, erukkam garland, arugampul, kumkum, manjal, camphor, agarbathi", "Order ahead": "From August" },
    ...single(650, 699, 15),
  },

  // ---- temple offerings
  {
    name: "Archanai basket",
    category: TEMPLE,
    hsn: "2914",
    gstRate: 18,
    unit: "pcs",
    sku: "MF-ARC",
    photo: 36608888,
    tags: ["temple", "daily", "bestseller"],
    description: `A palm-leaf basket for the archanai: a coconut, two bananas, betel and areca, a malli string, loose rose and arali, camphor and a stick of agarbathi. With temple delivery we hand it to you at the East Gopuram entrance before your darshan.${NO_SHIP}\n\nGST: a mixed supply, taxed at the highest rate in it (camphor, 18%); the coconut-and-banana plate without camphor is nil.`,
    attributes: { Contents: "Coconut, bananas, betel, areca, malli string, flowers, camphor, agarbathi", Occasion: "Archanai, temple visit" },
    ...one("Size", [
      ["Small", 180, 180, 40],
      ["Big (two coconuts)", 320, 320, 20],
    ]),
  },
  {
    name: "Coconut and banana thattu",
    category: TEMPLE,
    hsn: "0801",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-THA",
    photo: 12613434,
    tags: ["temple", "daily"],
    description: `A coconut with its tuft, a hand of poovan bananas, betel leaves and a small malli string on a leaf plate: the offering for the sannidhi and for breaking at the Pillaiyar shrine. No camphor (bring your own, or add the archanai basket).${NO_SHIP}`,
    attributes: { Contents: "Coconut, bananas, betel leaves, malli string", Occasion: "Temple visit" },
    ...single(120, 120, 50),
  },
  {
    name: "Vetrilai (betel leaves)",
    category: TEMPLE,
    hsn: "140490",
    gstRate: 0,
    unit: "pack",
    sku: "MF-VET",
    photo: 15378536,
    tags: ["temple", "daily", "wedding"],
    description: `Tender Sholavandan betel leaves, sorted and stacked, for thamboolam, the pooja plate and wedding return gifts.${NO_SHIP}`,
    attributes: { Origin: "Sholavandan", "Stays fresh": "4 days wrapped in a damp cloth" },
    ...one("Count", [
      ["25 leaves", 30, 30, 60],
      ["50 leaves", 55, 55, 40],
    ]),
  },

  // ---- lamps
  {
    name: "Clay agal vilakku",
    category: LAMPS,
    hsn: "69120040",
    gstRate: 0,
    unit: "pack",
    sku: "MF-AGL",
    photo: 38165696,
    tags: ["ships", "karthigai", "deepavali"],
    description: "Plain red-clay agal from Manamadurai potters, fired hard so they don't soak up the oil. Soak them in water for an hour before the first lighting. Couriered across Tamil Nadu in straw.",
    attributes: { Material: "Terracotta", "Made in": "Manamadurai" },
    ...one("Pack", [
      ["12 lamps", 60, 60, 80],
      ["27 lamps", 125, 135, 60],
      ["51 lamps", 220, 240, 40],
    ]),
  },
  {
    name: "Painted terracotta diyas, set of 6",
    category: LAMPS,
    hsn: "69120040",
    gstRate: 0,
    unit: "set",
    sku: "MF-PDI",
    photo: 34481848,
    tags: ["ships", "deepavali", "karthigai"],
    description: "Six hand-painted red-and-gold clay diyas for the pooja room and the kolam centre, painted on the outside only so the oil side stays bare clay. Couriered across Tamil Nadu.",
    attributes: { Material: "Terracotta, hand-painted", Pieces: "6" },
    ...single(240, 260, 40),
  },
  {
    name: "Brass kuthuvilakku, five-face",
    category: LAMPS,
    hsn: "7418",
    gstRate: 5,
    unit: "pcs",
    sku: "MF-KUT",
    photo: 5804720,
    tags: ["ships", "wedding", "housewarming"],
    description: "The tall standing lamp of every Tamil home and wedding stage, cast in brass with a five-face bowl and a swan (annam) top; the stem unscrews for cleaning. Polish with tamarind or a lemon half. Couriered across Tamil Nadu.",
    attributes: { Material: "Brass", Faces: "5", Top: "Annam (swan)" },
    ...one("Height", [
      ["12 in", 1_650, 1_790, 10],
      ["18 in", 2_950, 3_190, 6],
      ["24 in", 4_800, 5_200, 3],
    ]),
  },
  {
    name: "Brass swan deepam, three-tier",
    category: LAMPS,
    hsn: "7418",
    gstRate: 5,
    unit: "pcs",
    sku: "MF-SWA",
    photo: 16457616,
    tags: ["ships", "housewarming", "deepavali"],
    description: "A three-tier brass deepam with a swan on top, for the pooja-room shelf and the dining table on festival evenings. Couriered across Tamil Nadu.",
    attributes: { Material: "Brass", Tiers: "3", Top: "Annam (swan)" },
    ...one("Height", [
      ["9 in", 1_450, 1_590, 8],
      ["12 in", 2_250, 2_450, 5],
    ]),
  },

  // ---- bouquets
  {
    name: "Red rose bouquet",
    category: BOUQUETS,
    hsn: "0603",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-BRR",
    photo: 11196806,
    tags: ["gift", "rose"],
    description: `Long-stem red roses from Hosur with fern, wrapped in paper and tied with ribbon; a card with your message at no extra cost.${NO_SHIP}`,
    attributes: { Flower: "Red rose (long stem)", Occasion: "Birthdays, anniversaries, felicitation" },
    ...one("Count", [
      ["12 roses", 550, 599, 20],
      ["24 roses", 990, 1_099, 10],
    ]),
  },
  {
    name: "Rose and gypsophila bouquet",
    category: BOUQUETS,
    hsn: "0603",
    gstRate: 0,
    unit: "pcs",
    sku: "MF-BRG",
    photo: 13306125,
    tags: ["gift", "rose"],
    description: `Red and pink roses in a cloud of gypsophila (baby's breath), in a net wrap: for hospital visits, convocations and welcoming guests at the airport.${NO_SHIP}`,
    attributes: { Flower: "Rose, gypsophila", Occasion: "Get well, congratulations, welcome" },
    ...one("Size", [
      ["Medium", 650, 699, 15],
      ["Large", 1_100, 1_199, 8],
    ]),
  },
];

/** Pexels photos used by the store (credited on /pages/photo-credits). */
const PHOTOS: DemoStore["photos"] = {
  38784646: { by: "Shobhit Kushwaha", alt: "Heap of white jasmine buds" },
  8311243: { by: "Abdul Subahan", alt: "White jasmine flowers in a bowl" },
  40182083: { by: "Sharath G.", alt: "Heap of saffron kanakambaram flowers" },
  32503416: { by: "syd.trgt", alt: "Pink and red roses in a bowl" },
  35408422: { by: "Sujata Sankhyan", alt: "Pile of orange marigold heads" },
  35894441: { by: "Nour Alhoda", alt: "White chrysanthemums" },
  17489850: { by: "Yana Kangal", alt: "Pink double oleander flowers" },
  13861388: { by: "Tom Shih", alt: "Pink lotus flower and bud" },
  39143270: { by: "Tasnima Fariha", alt: "Hand holding a jasmine string" },
  39139873: { by: "Sagar Das", alt: "Flower seller holding up thick jasmine strings" },
  5719462: { by: "MaHiPal Reddy R", alt: "Saffron kanakambaram flowers" },
  40004833: { by: "Aditya Oberai", alt: "Jasmine and red flower strings hanging at a stall" },
  29558121: { by: "Dibakar Roy", alt: "Jasmine strings hanging from a seller's hand" },
  13333358: { by: "Gandhar Thakur", alt: "Rings of marigold and rose garlands" },
  27785418: { by: "G N", alt: "Rose, jasmine and marigold garlands at a stall" },
  35124359: { by: "Sunannya Das", alt: "Orange marigold garlands" },
  38705730: { by: "Dale Mohagan", alt: "Jasmine and marigold garlands on a banana leaf" },
  10271106: { by: "Sharath G.", alt: "Layered garlands of yellow flowers and green leaves" },
  29657646: { by: "Tuấn Kiệt Jr.", alt: "Holy basil (thulasi) plant in flower" },
  20626529: { by: "Perfect Tips 360", alt: "Pair of red rose and jasmine wedding garlands on banana leaves" },
  39516594: { by: "Rupam Modak", alt: "Red roses and jasmine on a tray" },
  8886982: { by: "Lara Jameson", alt: "Hands holding a marigold, rose and jasmine garland" },
  36587827: { by: "Thilina Alagiyawanna", alt: "Jasmine strands on a bride's plait" },
  34389342: { by: "Prince Nature", alt: "White wedding stage with flower clusters" },
  12584803: { by: "BANU FILM ADS", alt: "Wedding stage with a rose arch and a swing" },
  33914531: { by: "The Visionary Vows", alt: "Wedding stage with flower arches and lamps" },
  39820649: { by: "Perry", alt: "Marigold decoration with lamps at a pooja corner" },
  11226703: { by: "SERHAT TUĞ", alt: "Flower arrangement on a car bonnet" },
  7750217: { by: "Shootcase Chronicles", alt: "Camphor flame in a brass aarti cup" },
  7176691: { by: "Alena Darmel", alt: "Incense stick burning on a holder" },
  13149632: { by: "Extro Vision", alt: "Red kumkum in a clay bowl" },
  33554840: { by: "Writchid Snipes", alt: "Bowls of yellow turmeric and red powder" },
  13471282: { by: "star photography", alt: "Sandal, kumkum and turmeric in a silver tray" },
  34385011: { by: "Abhishek", alt: "A lit clay diya with a cotton wick" },
  34705732: { by: "Ajeesh p", alt: "Lit brass oil lamp" },
  12951503: { by: "ArrN Capture", alt: "Fresh mango leaves" },
  36854238: { by: "Nayan Desai", alt: "Small Vinayagar on a pooja plate with flowers" },
  32070636: { by: "Kamakshi", alt: "Navaratri golu dolls" },
  38109564: { by: "aksinfo7 universe", alt: "Pooja plate with flowers, a mango and a copper kalasam" },
  30604307: { by: "Rajesh S Balouria", alt: "Rows of lit clay lamps" },
  30519624: { by: "Narasimhan AVPL", alt: "Pongal boiling in a pot tied with turmeric" },
  36608888: { by: "Thilina Alagiyawanna", alt: "Plate of coconut, bananas and fruit for an offering" },
  12613434: { by: "BANU FILM ADS", alt: "Coconut with jasmine on a brass plate" },
  15378536: { by: "Jabir Ms", alt: "Betel leaves stacked in a basket" },
  38165696: { by: "Ashutosh Kumar", alt: "Pile of unfired clay lamps" },
  34481848: { by: "AJAY KUMAR", alt: "Red painted diyas lit" },
  5804720: { by: "Sohani Kamat", alt: "Brass kuthuvilakku lit, with marigolds" },
  16457616: { by: "Prasad Madushan", alt: "Tiered brass lamp with a swan on top" },
  11196806: { by: "Shameel mukkath", alt: "Red rose bouquet in orange paper" },
  13306125: { by: "Stuti", alt: "Red and pink roses with gypsophila" },
  // categories, home and pages
  40182071: { by: "Sharath G.", alt: "Heap of jasmine at a flower market" },
  39160403: { by: "Subhadip Banerjee", alt: "Flower seller holding jasmine strings" },
  37102616: { by: "Emadul Islam Akash", alt: "Garlands hanging at a market stall" },
  8886979: { by: "Lara Jameson", alt: "Hands tying wedding garlands" },
  36595218: { by: "ornob Sadi", alt: "Pooja tray with incense and a lamp" },
  14855916: { by: "Vijay Krishnawat", alt: "Pooja plate with a copper kalasam" },
  10757395: { by: "Rajeshmegi King", alt: "Coconut dressed with jasmine and rose for an offering" },
  39725718: { by: "Farhad Reza", alt: "White flower stage" },
  40182060: { by: "Sharath G.", alt: "Rose bouquets in many colours" },
  34096454: { by: "Tahamie Farooqui", alt: "Hands stringing jasmine buds" },
  37139339: { by: "AMOL NAKVE", alt: "Fingers tying jasmine on thread" },
  39533668: { by: "Anil Sharma", alt: "Woman tying a garland on a verandah" },
  39662265: { by: "Soumalya Halder", alt: "Garland maker at work" },
  33265563: { by: "Sunannya Das", alt: "Elderly garland maker in his shop" },
  18883449: { by: "Mouli Ghosh", alt: "Hundreds of lit clay lamps" },
  35519271: { by: "Shiju M S", alt: "Woman drawing a kolam on the street at dawn" },
  37650548: { by: "Nishant Vyas", alt: "A line of lit diyas on a step" },
};

const HOURS = [
  { label: "Every day", value: "4:30 am – 10:00 pm" },
  { label: "Temple delivery", value: "5:00 am – 9:00 pm" },
];

const FAQ = [
  {
    q: "How fresh are the flowers?",
    a: "We buy at the **Mattuthavani flower market at 4:30 am** every day and string by 6. Loose flowers are weighed in front of you at the counter, or packed by weight for delivery. Malli and mullai are for the same day; kanakambaram, samanthi and sevanthi last two to three days.",
  },
  {
    q: "When do I need to order wedding garlands and decoration?",
    a: "Garland pairs **3 days** ahead (**7 days** in the wedding months of Thai, Panguni, Vaikasi and Avani), the poo jadai 2 days, house-warming decoration 3 days, stage decoration 7–15 days. A **30% advance** confirms a decoration date; the rest is paid after set-up.",
  },
  {
    q: "Can you send flowers outside Madurai?",
    a: "No: fresh flowers, strings and garlands go only to **Madurai city and temple delivery**. Pooja items, lamps and the Karthigai kit are couriered to the **rest of Tamil Nadu** in 2–4 days; if an order outside Madurai has flowers in it, we call you and refund those lines.",
  },
  {
    q: "What is temple delivery?",
    a: "Order an archanai basket, garland or strings with the **temple delivery** option and pick a time: our runner meets you at the **East Gopuram entrance** of the Meenakshi Amman temple (or the Koodal Azhagar and Thiruparankundram temples by arrangement) with your order, 5 am – 9 pm.",
  },
  {
    q: "Can I return flowers?",
    a: "Flowers, strings and garlands can't be returned, as they are perishable. If something arrives wilted, short in weight or not as ordered, send a photo on WhatsApp within **2 hours** of delivery and we replace it the same day or refund it. Unused pooja items and lamps can be returned within 7 days.",
  },
];

const FAQ_TA = [
  {
    q: "பூக்கள் எவ்வளவு புதியவை?",
    a: "ஒவ்வொரு நாளும் **அதிகாலை 4:30-க்கு மாட்டுத்தாவணி பூ மார்க்கெட்டில்** வாங்கி, 6 மணிக்குள் கட்டுகிறோம். உதிரிப் பூக்கள் கடையில் உங்கள் முன்னால் எடை போடப்படும், டெலிவரிக்கு எடைப்படி கட்டப்படும். மல்லிகையும் முல்லையும் அன்றைக்கே; கனகாம்பரம், சாமந்தி, செவ்வந்தி இரண்டு மூன்று நாள் தாங்கும்.",
  },
  {
    q: "திருமண மாலைகளுக்கும் அலங்காரத்துக்கும் எப்போது ஆர்டர் செய்ய வேண்டும்?",
    a: "மாலை ஜோடிகள் **3 நாள்** முன்பே (தை, பங்குனி, வைகாசி, ஆவணி முகூர்த்த மாதங்களில் **7 நாள்**), பூ ஜடை 2 நாள், கிரகப்பிரவேச அலங்காரம் 3 நாள், மேடை அலங்காரம் 7–15 நாள். அலங்காரத் தேதியை **30% முன்பணம்** உறுதி செய்யும்; மீதியை அமைத்த பிறகு செலுத்தலாம்.",
  },
  {
    q: "மதுரைக்கு வெளியே பூ அனுப்புவீர்களா?",
    a: "இல்லை: புதிய பூக்கள், சரங்கள், மாலைகள் **மதுரை நகரத்துக்கும் கோயில் டெலிவரிக்கும்** மட்டுமே. பூஜைப் பொருட்கள், விளக்குகள், கார்த்திகை தீபத் தொகுப்பு **தமிழ்நாட்டின் பிற பகுதிகளுக்கு** 2–4 நாளில் கூரியரில் வரும்; மதுரைக்கு வெளியே உள்ள ஆர்டரில் பூ இருந்தால், அழைத்துச் சொல்லி அந்தப் பகுதியைத் திருப்பித் தருவோம்.",
  },
  {
    q: "கோயில் டெலிவரி என்றால் என்ன?",
    a: "அர்ச்சனைக் கூடை, மாலை அல்லது சரத்தை **கோயில் டெலிவரி** முறையில் ஆர்டர் செய்து நேரத்தைத் தேர்ந்தெடுங்கள்: மீனாட்சி அம்மன் கோயிலின் **கிழக்குக் கோபுர வாசலில்** (கூடலழகர், திருப்பரங்குன்றம் கோயில்களுக்கு முன்னேற்பாட்டுடன்) எங்கள் ஆள் உங்களிடம் கொடுப்பார், காலை 5 – இரவு 9.",
  },
  {
    q: "பூக்களைத் திருப்பித் தரலாமா?",
    a: "பூக்கள், சரங்கள், மாலைகள் விரைவில் வாடுபவை என்பதால் திருப்பி எடுக்க முடியாது. வாடியோ, எடை குறைந்தோ, ஆர்டர்படி இல்லாமலோ வந்தால், டெலிவரியான **2 மணி நேரத்துக்குள்** வாட்ஸ்அப்பில் படம் அனுப்புங்கள்; அன்றே மாற்றித் தருவோம் அல்லது பணத்தைத் திருப்புவோம். பயன்படுத்தாத பூஜைப் பொருட்களையும் விளக்குகளையும் 7 நாளுக்குள் திருப்பலாம்.",
  },
];

/** A rate-board line (name + price) and its Tamil words: plain records (docs/verticals.md step 4). */
const rate = (name: string, price: number, description?: string) => (description ? { name, price: rs(price), description } : { name, price: rs(price) });
const words = (name: string, description?: string): Record<string, string> => (description ? { name, description } : { name });
const ORDER_TEXT = "Hello Malligai Flowers, I'd like to order: … Date / time: … Delivery: home / temple (East Gopuram) / pick-up";

export const MALLIGAI: DemoStore = {
  shop: {
    slug: "malligai",
    appId: "EC",
    businessType: "florist_pooja",
    planId: "pro",
    name: "Malligai Flowers & Pooja Stores",
    primary: "#a3201a",
    billing: {
      legalName: "Malligai Flowers & Pooja Stores",
      gstin: "33ABMFM4127K1Z4",
      address: "12, East Chithirai Street, near the East Gopuram",
      city: "Madurai",
      pincode: "625001",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "MF",
      upiId: "malligaiflowers@okaxis",
    },
    // Counter work (other support services, SAC 998599: 18%); rates are GST-exclusive.
    items: [
      { name: "Garland tying with your own flowers", hsn: "998599", unit: "pcs", rate: 4_237, gstRate: 18 },
      { name: "Brass lamp polishing", hsn: "998599", unit: "pcs", rate: 12_712, gstRate: 18 },
    ],
  },
  preset: "kumkum-manjal",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 500_000,
    minOrderValue: 10_000,
    contactPhone: PHONE,
    contactEmail: "orders@malligaiflowers.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/malligaiflowers" },
    policies: {
      shipping:
        "**Temple delivery and the old city (62500x):** handed to you at the East Gopuram entrance of the Meenakshi Amman temple, or at your door inside the old city, at your chosen time, 5 am – 9 pm, ₹20.\n\n**Madurai city (625xxx), early morning:** order by midnight, delivered between 6 and 8 am (or a slot you choose later in the day), ₹40, free above ₹499.\n\n**Rest of Tamil Nadu — pooja items only:** pooja items, lamps and the Karthigai kit by courier in 2–4 days, ₹70, free above ₹999. **Fresh flowers, strings, garlands and decoration are not couriered**: if an order outside Madurai includes them, we call you and refund those lines.",
      returns:
        "Flowers, strings, garlands and bouquets are perishable and can't be returned. If they arrive wilted, short in weight or length, or not as ordered, send a photo on WhatsApp within 2 hours of delivery and we replace them the same day or refund in full. Advance orders (wedding garlands, decoration) can be cancelled free up to 3 days before the date; after that the 30% advance is kept for the flowers bought. Unused pooja items and lamps can be returned within 7 days.",
      privacy: "We use your details only to deliver your order, send your GST bill and, if you ask, remind you before festivals and your family's temple days.",
      terms:
        "Prices include GST: nil on fresh flowers, garlands, kumkum, clay lamps and wicks; 5% on agarbathi, turmeric, lamp oil and brass lamps; 18% on camphor, kits containing camphor and decoration services. Loose-flower prices follow the morning market and can change daily; you pay the price shown when you order. Advance orders are confirmed by a 30% advance.",
    },
    businessType: "florist_pooja",
  },
  zones: [
    {
      name: "Temple delivery and the old city (62500x)",
      pincodePrefixes: ["62500"],
      rate: { name: "Temple gate or old-city delivery (at your time)", type: "flat", amount: 2_000, etaMinDays: 0, etaMaxDays: 0, codAllowed: true, codFee: 0 },
    },
    {
      name: "Madurai city (early morning)",
      pincodePrefixes: ["625"],
      rate: { name: "Early-morning delivery (6–8 am)", type: "free_above", amount: 4_000, freeAbove: 49_900, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu (pooja items only)",
      states: ["33"],
      rate: { name: "Courier, pooja items only (2–4 days)", type: "free_above", amount: 7_000, freeAbove: 99_900, etaMinDays: 2, etaMaxDays: 4, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: LOOSE, description: "Madurai malli, mullai, kanakambaram, rose, samanthi, sevanthi, arali and lotus, weighed in front of you: 100 g to 1 kg.", photo: 40182071 },
    { name: STRINGS, description: "Malli, mullai and kanakambaram strung by hand every morning, by the muzham or the metre.", photo: 39160403 },
    { name: GARLANDS, description: "Temple, rose, samanthi and thulasi garlands from 1 ft to 3 ft, tied the same morning.", photo: 37102616 },
    { name: WEDDING, description: "Kalyana malai pairs, engagement garlands and the bride's poo jadai, made to order.", photo: 8886979 },
    { name: DECOR, description: "Wedding stages, house-warming and car decoration, set up by our team.", photo: 39725718 },
    { name: POOJA, description: "Camphor, agarbathi, kumkum, manjal, chandanam, wicks, lamp oil and thoranams.", photo: 36595218 },
    { name: KITS, description: "Everything for Deepavali, Karthigai Deepam, Thai Pongal, Navaratri and Vinayagar Chathurthi.", photo: 14855916, parent: POOJA },
    { name: TEMPLE, description: "Archanai baskets, coconut plates and betel, handed to you at the temple gate if you like.", photo: 10757395 },
    { name: LAMPS, description: "Brass kuthuvilakku and deepams, clay agal from Manamadurai.", photo: 37650548 },
    { name: BOUQUETS, description: "Rose bouquets for birthdays, hospital visits and felicitations.", photo: 40182060 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "Fresh this morning", slug: "fresh-today", description: "Loose flowers and strings from today's 4:30 am market.", rule: { tag: "fresh-today", sort: "price-asc" } },
    { name: "Temple garlands", slug: "temple-garlands", description: "Garlands, strings and offerings for the sannidhi and the home deity.", rule: { tag: "temple", sort: "price-asc" } },
    { name: "Wedding flowers", slug: "wedding", description: "Garland pairs, poo jadai, two-colour strings, stage and car decoration.", rule: { tag: "wedding", sort: "price-desc" } },
    { name: "Order ahead", slug: "advance-order", description: "Made to order: wedding garlands, decoration and festival kits. See the lead time on each.", rule: { tag: "advance-order", sort: "price-asc" } },
    { name: "Festival pooja kits", slug: "festival-kits", description: "One box for each festival, with a pooja order in Tamil.", rule: { category: KITS, sort: "price-asc" } },
    { name: "Deepavali", slug: "deepavali", description: "Lakshmi pooja kit, lotus, samanthi, lamps, wicks and oil for Deepavali.", rule: { tag: "deepavali", sort: "price-asc" } },
    { name: "Karthigai Deepam", slug: "karthigai", description: "Agal vilakku, wicks, deepam oil and brass lamps.", rule: { tag: "karthigai", sort: "price-asc" } },
    { name: "Ships across Tamil Nadu", slug: "ships-tamil-nadu", description: "Pooja items and lamps we courier anywhere in Tamil Nadu (fresh flowers stay in Madurai).", rule: { tag: "ships", sort: "name" } },
    { name: "Lamps & diyas", slug: "lamps", description: "Brass and clay lamps.", rule: { category: LAMPS, sort: "price-asc" } },
    { name: "Bestsellers", slug: "bestsellers", description: "What Madurai orders most.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "On offer", slug: "on-offer", description: "Below MRP right now.", rule: { onSale: true, sort: "price-asc" } },
  ],
  coupons: [
    {
      code: "DEEPAM10",
      description: "Deepavali & Karthigai: 10% off orders above ₹999 (up to ₹200)",
      type: "percent",
      value: 10,
      minOrder: 99_900,
      maxDiscount: 20_000,
      channels: ["store", "manual"],
    },
    {
      code: "MALLI50",
      description: "₹50 off your first order above ₹499",
      type: "flat",
      value: 5_000,
      minOrder: 49_900,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      channels: ["store"],
    },
  ],
  home: ({ photo, category, product }) => {
    const stages = ["Wedding stage decoration, Classic", "Wedding stage decoration, Kalyanam", "Wedding stage decoration, Grand mandapam"].map(product);
    return {
      seo: {
        title: "Malligai Flowers & Pooja, Madurai — jasmine, garlands, pooja items",
        description:
          "Madurai malli and loose flowers by weight, jasmine strings by the muzham, temple and wedding garlands, stage decoration, pooja items, festival kits and brass lamps, next to the Meenakshi Amman temple's East Gopuram. Early-morning delivery in Madurai.",
        imageUrl: photo(40182071),
      },
      sections: [
        {
          type: "menu-board",
          id: "ml-rates",
          title: "Today's flower rates",
          style: { background: "muted" },
          groups: [
            {
              name: "Loose flowers, per kg",
              items: [
                rate("Madurai malli", 1_200, "GI-tag jasmine, Mattuthavani 4:30 am"),
                rate("Mullai", 900),
                rate("Kanakambaram", 800),
                rate("Arali", 260),
                rate("Paneer rose", 240),
                rate("Sevanthi", 180),
                rate("Samanthi", 110),
              ],
            },
            {
              name: "Strings, per muzham",
              items: [rate("Malli string", 40), rate("Malli & kanakambaram", 40), rate("Mullai string", 35), rate("Kanakambaram string", 30)],
            },
          ],
          cta: { label: "Order loose flowers", href: "/c/loose-flowers" },
        },
        {
          type: "deal",
          id: "ml-dawn",
          title: "Order by midnight, at your door by 6 am",
          text: "Today's Madurai malli, strung at dawn and delivered across Madurai between 6 and 8 am. The countdown is to tonight's cut-off.",
          productId: product("Madurai malli string"),
        },
        {
          type: "stories",
          id: "ml-reels",
          title: "Strung this morning",
          layout: "reels",
          items: [
            { imageUrl: photo(34096454, "tile"), title: "Malli, bud by bud", text: "Two buds at a time on banana fibre: 400 knots a metre.", href: "/c/jasmine-strings", ctaLabel: "Shop strings" },
            { imageUrl: photo(37139339, "tile"), title: "The knot", text: "Our oldest stringer ties a muzham in under two minutes.", href: "/search?q=malli", ctaLabel: "Shop malli" },
            { imageUrl: photo(39533668, "tile"), title: "Temple garlands", text: "Rose and samanthi rings for the sannidhi, tied by 6 am.", href: "/collections/temple-garlands", ctaLabel: "Temple garlands" },
            { imageUrl: photo(39662265, "tile"), title: "Wedding pairs", text: "A kalyana malai takes four hands and three hours.", href: "/collections/wedding", ctaLabel: "Wedding flowers" },
            { imageUrl: photo(33265563, "tile"), title: "Fifty years at it", text: "Our founder still checks every garland pair before it leaves.", href: "/pages/about", ctaLabel: "Our story" },
            { imageUrl: photo(40182071, "tile"), title: "Mattuthavani, 4:30 am", text: "Where the day's malli comes from, still wet with dew.", href: "/collections/fresh-today", ctaLabel: "Fresh today" },
          ],
        },
        {
          type: "timeline",
          id: "ml-calendar",
          title: "Festival calendar",
          text: "What to book, and by when, for the festivals ahead. Dates follow the Tamil panchangam for Madurai.",
          style: { background: "muted" },
          items: [
            { when: "Sun 8 Nov 2026", title: "Deepavali", text: "Lakshmi pooja kit, lotus, samanthi thoranam and lamps. Book by 6 November; we deliver from 5 am on the day.", imageUrl: photo(38109564, "square") },
            { when: "Tue 24 Nov 2026", title: "Karthigai Deepam", text: "27, 51 or 108 clay agal with wicks and oil; brass kuthuvilakku for the threshold. Couriered across Tamil Nadu till 19 November.", imageUrl: photo(18883449, "square") },
            { when: "Sun 20 Dec 2026", title: "Vaikunta Ekadasi", text: "Thulasi garlands and malli strings for Koodal Azhagar and Perumal temples, handed over at the gate from 4 am.", imageUrl: photo(29657646, "square") },
            { when: "Thu 14 – Fri 15 Jan 2027", title: "Bhogi and Thai Pongal", text: "Pongal pooja kit with a new clay pot, sugarcane and turmeric plants, booked from 1 January and delivered on Bhogi evening.", imageUrl: photo(30519624, "square") },
            { when: "Every Friday", title: "Velli kizhamai pooja", text: "Lotus, mullai and a 1 ft rose garland for the Friday lamp: set up a weekly order on WhatsApp.", imageUrl: photo(13861388, "square") },
          ],
        },
        {
          type: "offer",
          id: "ml-deepavali",
          eyebrow: "Deepavali · Sunday 8 November",
          heading: "Book your Deepavali pooja flowers now",
          text: "Lotus, samanthi garlands and the Lakshmi pooja kit, delivered from 5 am on Deepavali morning. 10% off orders above ₹999 (up to ₹200) till Deepavali eve.",
          code: "DEEPAM10",
          endsAt: "2026-11-07T22:00:00+05:30",
          cta: { label: "Shop for Deepavali", href: "/collections/deepavali" },
          style: { background: "image", imageUrl: photo(18883449), overlay: 55 },
        },
        {
          type: "finder",
          id: "ml-garland-finder",
          title: "Garland finder",
          text: "Three taps: the occasion, the length, the flower. Skip any step you're unsure of.",
          layout: "wizard",
          results: "inline",
          imageUrl: photo(37102616, "tile"),
          cta: { label: "Ask on WhatsApp", href: waLink(ORDER_TEXT) },
          limit: 6,
          questions: [
            {
              label: "What is it for?",
              options: [
                { label: "Temple or home deity", tag: "temple", imageUrl: photo(13333358, "square") },
                { label: "Wedding or engagement", tag: "wedding", imageUrl: photo(20626529, "square") },
                { label: "House-warming", tag: "housewarming", imageUrl: photo(38705730, "square") },
                { label: "Welcoming a guest", tag: "welcome", imageUrl: photo(27785418, "square") },
                { label: "Elders' photograph", tag: "photo", imageUrl: photo(35124359, "square") },
              ],
            },
            {
              label: "How long?",
              options: [
                { label: "1 ft · photo frame", filterName: "Size", filterValue: "1 ft" },
                { label: "2 ft · home deity", filterName: "Size", filterValue: "2 ft" },
                { label: "3 ft · temple idol", filterName: "Size", filterValue: "3 ft" },
                { label: "4–5 ft · wedding pair", filterName: "Size", filterValue: "4 ft" },
              ],
            },
            {
              label: "Which flower?",
              options: [
                { label: "Rose", keywords: "rose" },
                { label: "Malli", keywords: "malli" },
                { label: "Samanthi", keywords: "samanthi" },
                { label: "Thulasi", keywords: "thulasi" },
              ],
            },
          ],
        },
        { type: "categories", id: "ml-counters", title: "Our counters", layout: "banner-row", showCounts: true, categoryIds: [LOOSE, STRINGS, GARLANDS, WEDDING, POOJA, TEMPLE, LAMPS, DECOR].map(category) },
        {
          type: "comparison",
          id: "ml-stages",
          title: "Wedding stage packages, side by side",
          text: "Prices are per event for the hall size you pick, set-up and clearing included. A 30% advance confirms the date.",
          productIds: stages,
          highlightId: product("Wedding stage decoration, Kalyanam"),
          highlightLabel: "Most booked",
          showRating: false,
          rows: [
            { label: "Flowers", values: ["Carnation, rose, gypsophila", "Rose, malli, samanthi", "Malli, rose, orchids, samanthi"] },
            { label: "Backdrop", values: ["Draped cloth, corner clusters", "Rose arch over the oonjal, malli curtains", "Jasmine and rose arches, malli chandeliers"] },
            { label: "Entrance", values: ["Two flower stands", "Banana trunks, mango leaves, samanthi kolam", "Flower tunnel and lit kuthuvilakkus"] },
            { label: "Garland pair", values: ["Not included", "Included (rose, 4 ft)", "Included, with the poo jadai"] },
            { label: "Set-up time", values: ["3 hours", "5 hours", "8 hours, the night before"] },
            { label: "Book ahead", values: ["7 days", "10 days", "15 days"] },
          ],
        },
        { type: "collection", id: "ml-kits", title: "Festival pooja kits", collectionSlug: "festival-kits", layout: "grid", limit: 5 },
        {
          type: "hero-split",
          id: "ml-temple",
          imageUrl: photo(10757395, "tile"),
          imageSide: "left",
          eyebrow: "Temple delivery · East Gopuram",
          heading: "Your archanai basket, waiting at the temple gate",
          text: "Order the basket, a garland or strings with temple delivery and pick your darshan time: our runner meets you at the East Gopuram entrance of the Meenakshi Amman temple, 5 am – 9 pm, for ₹20. No queue at the flower stalls, no haggling, fresh from our counter a minute away.",
          cta: { label: "Archanai baskets", href: "/c/temple-offerings" },
          cta2: { label: "How it works", href: "/pages/temple-delivery" },
          style: { background: "brand" },
        },
        { type: "collection", id: "ml-lamps", title: "Brass and clay lamps", collectionSlug: "lamps", layout: "carousel", limit: 8 },
        {
          type: "testimonials",
          id: "ml-voices",
          title: "From the temple street",
          layout: "single",
          style: { span: "half" },
          items: [
            { quote: "I booked the Kalyanam stage and the rose garland pair from Chennai on WhatsApp. They sent photos at every step of the set-up, and the malli curtains were still fragrant at the reception.", name: "Revathi S.", role: "Bride's mother, Chennai", rating: 5 },
            { quote: "Every Friday at 6 am the lotus and mullai are at my door. In two years they have never missed one.", name: "Lakshmi N.", role: "Anna Nagar, Madurai", rating: 5 },
            { quote: "We came for darshan from Bengaluru; the archanai basket was waiting at the East Gopuram exactly at 7.", name: "Prakash R.", role: "Visitor, Bengaluru", rating: 5 },
          ],
        },
        { type: "faq", id: "ml-faq", title: "Freshness, advance orders and delivery", items: FAQ, style: { span: "half" } },
        {
          type: "usp",
          id: "ml-promise",
          layout: "inline",
          items: [
            { icon: "leaf", title: "Fresh at 4:30 am", text: "From Mattuthavani market, strung by 6" },
            { icon: "check", title: "Fair weight and length", text: "Weighed and measured in front of you" },
            { icon: "clock", title: "Order by midnight", text: "At your door in Madurai by 6–8 am" },
            { icon: "heart", title: "Temple delivery", text: "Handed to you at the East Gopuram" },
          ],
        },
        {
          type: "location",
          id: "ml-visit",
          title: "A minute from the East Gopuram",
          address: "12, East Chithirai Street, near the East Gopuram, Madurai 625001",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "9.9196, 78.1209",
        },
      ],
      translations: {
        ta: {
          "ml-rates": {
            title: "இன்றைய பூ விலை",
            groups: [
              {
                name: "உதிரிப் பூக்கள், கிலோவுக்கு",
                items: [
                  words("மதுரை மல்லி", "புவிசார் குறியீட்டு மல்லிகை, மாட்டுத்தாவணி அதிகாலை 4:30"),
                  words("முல்லை"),
                  words("கனகாம்பரம்"),
                  words("அரளி"),
                  words("பன்னீர் ரோஜா"),
                  words("செவ்வந்தி"),
                  words("சாமந்தி"),
                ],
              },
              { name: "சரங்கள், முழத்துக்கு", items: [words("மல்லிச் சரம்"), words("மல்லி & கனகாம்பரம்"), words("முல்லைச் சரம்"), words("கனகாம்பரச் சரம்")] },
            ],
            cta: { label: "உதிரிப் பூக்களை ஆர்டர் செய்" },
          },
          "ml-dawn": {
            title: "நள்ளிரவுக்குள் ஆர்டர், காலை 6-க்கு வாசலில்",
            text: "இன்றைய மதுரை மல்லி, விடியலில் கட்டி, மதுரை முழுவதும் காலை 6 – 8 மணிக்குள் டெலிவரி. கவுண்ட்டவுன் இன்றிரவு கடைசி நேரம் வரை.",
          },
          "ml-reels": {
            title: "இன்று காலை கட்டியவை",
            items: [
              { title: "மல்லி, மொட்டு மொட்டாக", text: "வாழைநாரில் இரண்டிரண்டு மொட்டு: மீட்டருக்கு 400 முடிச்சு.", ctaLabel: "சரங்கள்" },
              { title: "அந்த முடிச்சு", text: "எங்கள் மூத்த பூக்கட்டுபவர் ஒரு முழத்தை இரண்டு நிமிடத்துக்குள் கட்டுவார்.", ctaLabel: "மல்லி" },
              { title: "கோயில் மாலைகள்", text: "சன்னிதிக்கு ரோஜா, சாமந்தி வளையங்கள், காலை 6-க்குள் தயார்.", ctaLabel: "கோயில் மாலைகள்" },
              { title: "திருமண ஜோடிகள்", text: "ஒரு கல்யாண மாலைக்கு நான்கு கைகள், மூன்று மணி நேரம்.", ctaLabel: "திருமணப் பூக்கள்" },
              { title: "ஐம்பது ஆண்டுகளாக", text: "ஒவ்வொரு மாலை ஜோடியையும் எங்கள் நிறுவனர் இன்னும் பார்த்தே அனுப்புகிறார்.", ctaLabel: "எங்கள் கதை" },
              { title: "மாட்டுத்தாவணி, அதிகாலை 4:30", text: "இன்றைய மல்லி பனி ஈரத்துடன் வருவது இங்கிருந்துதான்.", ctaLabel: "இன்று புதிதாக" },
            ],
          },
          "ml-calendar": {
            title: "பண்டிகை நாட்காட்டி",
            text: "வரும் பண்டிகைகளுக்கு எதை, எப்போதுக்குள் முன்பதிவு செய்ய வேண்டும். தேதிகள் மதுரைக்கான தமிழ்ப் பஞ்சாங்கப்படி.",
            items: [
              { when: "ஞாயிறு, 8 நவம்பர் 2026", title: "தீபாவளி", text: "லட்சுமி பூஜைத் தொகுப்பு, தாமரை, சாமந்தித் தோரணம், விளக்குகள். நவம்பர் 6-க்குள் முன்பதிவு; அன்று அதிகாலை 5 முதல் டெலிவரி." },
              { when: "செவ்வாய், 24 நவம்பர் 2026", title: "கார்த்திகை தீபம்", text: "திரி, எண்ணெயுடன் 27, 51 அல்லது 108 அகல் விளக்குகள்; வாசலுக்குப் பித்தளைக் குத்துவிளக்கு. நவம்பர் 19 வரை தமிழ்நாடு முழுவதும் கூரியர்." },
              { when: "ஞாயிறு, 20 டிசம்பர் 2026", title: "வைகுண்ட ஏகாதசி", text: "கூடலழகர், பெருமாள் கோயில்களுக்குத் துளசி மாலைகள், மல்லிச் சரங்கள்; அதிகாலை 4 முதல் வாசலில் கொடுப்போம்." },
              { when: "வியாழன் 14 – வெள்ளி 15 ஜனவரி 2027", title: "போகி, தைப்பொங்கல்", text: "புதுப் பானை, கரும்பு, மஞ்சள் கொத்துடன் பொங்கல் பூஜைத் தொகுப்பு; ஜனவரி 1 முதல் முன்பதிவு, போகி மாலை டெலிவரி." },
              { when: "ஒவ்வொரு வெள்ளியும்", title: "வெள்ளிக்கிழமை பூஜை", text: "வெள்ளி விளக்குக்குத் தாமரை, முல்லை, ஒரு அடி ரோஜா மாலை: வாட்ஸ்அப்பில் வாராந்திர ஆர்டர் வைத்துக்கொள்ளுங்கள்." },
            ],
          },
          "ml-deepavali": {
            eyebrow: "தீபாவளி · ஞாயிறு, 8 நவம்பர்",
            heading: "தீபாவளி பூஜைப் பூக்களை இப்போதே முன்பதிவு செய்யுங்கள்",
            text: "தாமரை, சாமந்தி மாலைகள், லட்சுமி பூஜைத் தொகுப்பு, தீபாவளி அதிகாலை 5 முதல் டெலிவரி. தீபாவளிக்கு முந்தைய நாள் வரை ₹999-க்கு மேல் 10% தள்ளுபடி (₹200 வரை).",
            cta: { label: "தீபாவளிக்கு வாங்க" },
          },
          "ml-garland-finder": {
            title: "மாலை தேர்வி",
            text: "மூன்று தொடுதல்: நிகழ்ச்சி, நீளம், பூ. தெரியாத படியைத் தவிர்க்கலாம்.",
            cta: { label: "வாட்ஸ்அப்பில் கேளுங்கள்" },
            questions: [
              { label: "எதற்காக?", options: [{ label: "கோயில் அல்லது வீட்டுத் தெய்வம்" }, { label: "திருமணம் அல்லது நிச்சயதார்த்தம்" }, { label: "கிரகப்பிரவேசம்" }, { label: "விருந்தினர் வரவேற்பு" }, { label: "பெரியோர் படம்" }] },
              { label: "எவ்வளவு நீளம்?", options: [{ label: "1 அடி · படச்சட்டம்" }, { label: "2 அடி · வீட்டுத் தெய்வம்" }, { label: "3 அடி · கோயில் விக்கிரகம்" }, { label: "4–5 அடி · திருமண ஜோடி" }] },
              { label: "எந்தப் பூ?", options: [{ label: "ரோஜா" }, { label: "மல்லி" }, { label: "சாமந்தி" }, { label: "துளசி" }] },
            ],
          },
          "ml-counters": { title: "எங்கள் பகுதிகள்" },
          "ml-stages": {
            title: "திருமண மேடை அலங்காரங்கள், அருகருகே",
            text: "நீங்கள் தேர்ந்தெடுக்கும் மண்டப அளவுக்கு ஒரு நிகழ்ச்சிக்கான விலை, அமைப்பதும் அகற்றுவதும் சேர்த்து. 30% முன்பணம் தேதியை உறுதி செய்யும்.",
            highlightLabel: "அதிகம் முன்பதிவானது",
            rows: [
              { label: "பூக்கள்", values: ["கார்னேஷன், ரோஜா, ஜிப்சோபிலா", "ரோஜா, மல்லி, சாமந்தி", "மல்லி, ரோஜா, ஆர்க்கிட், சாமந்தி"] },
              { label: "பின்னணி", values: ["தொங்கும் துணி, மூலைப் பூக்கொத்துகள்", "ஊஞ்சலுக்கு மேல் ரோஜா வளைவு, மல்லித் திரைகள்", "மல்லி, ரோஜா வளைவுகள், மல்லிச் சரவிளக்குகள்"] },
              { label: "நுழைவாயில்", values: ["இரண்டு பூ ஸ்டாண்டுகள்", "வாழைமரம், மாவிலை, சாமந்திக் கோலம்", "பூச் சுரங்கம், ஏற்றிய குத்துவிளக்குகள்"] },
              { label: "மாலை ஜோடி", values: ["சேர்க்கப்படவில்லை", "சேர்த்து (ரோஜா, 4 அடி)", "சேர்த்து, பூ ஜடையுடன்"] },
              { label: "அமைக்கும் நேரம்", values: ["3 மணி நேரம்", "5 மணி நேரம்", "8 மணி நேரம், முந்தைய இரவு"] },
              { label: "முன்பதிவு", values: ["7 நாள் முன்", "10 நாள் முன்", "15 நாள் முன்"] },
            ],
          },
          "ml-kits": { title: "பண்டிகைப் பூஜைத் தொகுப்புகள்" },
          "ml-temple": {
            eyebrow: "கோயில் டெலிவரி · கிழக்குக் கோபுரம்",
            heading: "உங்கள் அர்ச்சனைக் கூடை, கோயில் வாசலில் காத்திருக்கும்",
            text: "கூடை, மாலை அல்லது சரத்தைக் கோயில் டெலிவரியுடன் ஆர்டர் செய்து தரிசன நேரத்தைத் தேர்ந்தெடுங்கள்: மீனாட்சி அம்மன் கோயிலின் கிழக்குக் கோபுர வாசலில் எங்கள் ஆள் உங்களைச் சந்திப்பார், காலை 5 – இரவு 9, ₹20 மட்டும். பூக்கடை வரிசை இல்லை, பேரம் இல்லை; ஒரு நிமிடத் தொலைவிலுள்ள எங்கள் கடையிலிருந்து புதிதாக.",
            cta: { label: "அர்ச்சனைக் கூடைகள்" },
            cta2: { label: "எப்படி வேலை செய்கிறது" },
          },
          "ml-lamps": { title: "பித்தளை, மண் விளக்குகள்" },
          "ml-voices": {
            title: "கோயில் தெருவிலிருந்து",
            items: [
              { quote: "சென்னையிலிருந்து வாட்ஸ்அப்பில் கல்யாண மேடையையும் ரோஜா மாலை ஜோடியையும் முன்பதிவு செய்தேன். அமைக்கும் ஒவ்வொரு படியிலும் படம் அனுப்பினார்கள்; வரவேற்பின்போதும் மல்லித் திரைகள் மணத்தன.", role: "மணமகளின் அம்மா, சென்னை" },
              { quote: "ஒவ்வொரு வெள்ளியும் காலை 6-க்குத் தாமரையும் முல்லையும் என் வாசலில். இரண்டு ஆண்டுகளில் ஒரு வாரம் கூடத் தவறியதில்லை.", role: "அண்ணா நகர், மதுரை" },
              { quote: "பெங்களூரிலிருந்து தரிசனத்துக்கு வந்தோம்; சரியாக 7 மணிக்குக் கிழக்குக் கோபுரத்தில் அர்ச்சனைக் கூடை காத்திருந்தது.", role: "பார்வையாளர், பெங்களூரு" },
            ],
          },
          "ml-visit": {
            title: "கிழக்குக் கோபுரத்திலிருந்து ஒரு நிமிடம்",
            address: "12, கிழக்குச் சித்திரை வீதி, கிழக்குக் கோபுரம் அருகில், மதுரை 625001",
            hours: [
              { label: "தினமும்", value: "அதிகாலை 4:30 – இரவு 10:00" },
              { label: "கோயில் டெலிவரி", value: "காலை 5:00 – இரவு 9:00" },
            ],
          },
          "ml-faq": { title: "புத்துணர்வு, முன்பதிவு, டெலிவரி", items: FAQ_TA },
          "ml-promise": {
            items: [
              { title: "அதிகாலை 4:30-க்குப் புதிது", text: "மாட்டுத்தாவணி மார்க்கெட்டிலிருந்து, 6-க்குள் கட்டியது" },
              { title: "சரியான எடை, சரியான அளவு", text: "உங்கள் முன்னால் எடை போட்டு, அளந்து" },
              { title: "நள்ளிரவுக்குள் ஆர்டர்", text: "மதுரையில் காலை 6–8-க்குள் வாசலில்" },
              { title: "கோயில் டெலிவரி", text: "கிழக்குக் கோபுர வாசலில் உங்கள் கையில்" },
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
        { type: "heading", level: 2, text: "Malligai, East Chithirai Street, since 1974" },
        {
          type: "paragraph",
          markdown:
            "Malligai began as a basket of Madurai malli on the steps of East Chithirai Street in **1974**, a minute from the East Gopuram of the Meenakshi Amman temple. Our grandmother strung jasmine for the morning darshan crowd; today three generations and twelve stringers tie strings, temple garlands and wedding pairs from 5 am, with the flowers bought at the Mattuthavani market at 4:30.\n\nWe added pooja items, festival kits, brass lamps from Nachiarkoil and clay agal from Manamadurai potters, and a decoration team for weddings and house-warmings across Madurai, Dindigul and Sivaganga.",
        },
        { type: "image", url: photo(33265563, "tile"), alt: "Elderly garland maker in his shop" },
        { type: "paragraph", markdown: "Open every day 4:30 am – 10:00 pm. Call or WhatsApp **+91 98765 00021**." },
      ],
    },
    {
      slug: "festival-calendar",
      title: "Festival calendar 2026–27",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Festivals ahead, and what to book" },
        {
          type: "paragraph",
          markdown:
            "Dates follow the Tamil panchangam for Madurai and can shift by a day elsewhere; we confirm the muhurtham on WhatsApp if you ask.\n\n| Date | Festival | Book by | What we suggest |\n|---|---|---|---|\n| Sun 8 Nov 2026 | Deepavali | 6 Nov | Lakshmi pooja kit, 5 lotus, samanthi thoranam, agal and oil |\n| Tue 24 Nov 2026 | Karthigai Deepam | 19 Nov (courier), 23 Nov (Madurai) | Karthigai kit of 27 / 51 / 108 agal, brass kuthuvilakku |\n| Sun 20 Dec 2026 | Vaikunta Ekadasi | 18 Dec | Thulasi garland, malli string |\n| Thu 14 Jan 2027 | Bhogi | 10 Jan | Mango-leaf thoranam, samanthi garlands |\n| Fri 15 Jan 2027 | Thai Pongal | 10 Jan | Pongal pooja kit (clay pot, sugarcane, turmeric plants) |\n| Every Friday | Velli kizhamai pooja | Thursday night | Lotus, mullai, 1 ft rose garland |\n| Every Saturday in Purattasi | Perumal pooja | Friday night | Thulasi garland, sevanthi |",
        },
        { type: "image", url: photo(18883449, "wide"), alt: "Hundreds of lit clay lamps" },
        { type: "paragraph", markdown: "Wedding months (Thai, Panguni, Vaikasi, Avani): book garland pairs **7 days** ahead and stages **15 days** ahead." },
        { type: "button", label: "Book on WhatsApp", href: waLink(ORDER_TEXT), style: "primary" },
      ],
    },
    {
      slug: "garland-guide",
      title: "Garland guide",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Which garland, how long, which flower" },
        {
          type: "paragraph",
          markdown:
            "| Length | For | Our pick |\n|---|---|---|\n| 1 ft | Photo frames, small pooja-room deities, vehicle | Samanthi, rose |\n| 2 ft | The home deity, a guest's welcome | Rose and samanthi, malli and samanthi |\n| 3 ft | A temple idol, a stage photograph | Temple garland, layered sevanthi |\n| 4–5 ft | The bride and groom (a pair) | Rose pair, malli and rose pair |\n\n- **Perumal temples:** thulasi garland; **Amman and Vinayagar:** arali and rose; **Siva temples:** vilvam with sevanthi (ask us).\n- **Elders' photographs:** white sevanthi or rose, never too heavy for the frame hook.\n- **Lasting:** samanthi and sevanthi 3 days, rose 2, malli and mullai a day. Keep garlands wrapped in a damp cloth in the shade.\n- **Measuring a muzham:** elbow to fingertip, about 45 cm; we measure strings on a marked board in front of you.",
        },
        { type: "image", url: photo(38705730, "tile"), alt: "Jasmine and marigold garlands on a banana leaf" },
      ],
    },
    {
      slug: "temple-delivery",
      title: "Temple delivery",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Handed to you at the East Gopuram" },
        {
          type: "paragraph",
          markdown:
            "1. Add an archanai basket, a garland or strings to your cart and choose **Temple delivery** at checkout (pincode 625001).\n2. Write your darshan time and a phone number in the order note.\n3. Our runner meets you at the **East Gopuram entrance** of the Meenakshi Amman temple ten minutes before that time, 5 am – 9 pm, and calls when he's there.\n\nThe charge is **₹20**. For the Koodal Azhagar, Thiruparankundram and Alagar Kovil temples, message us a day ahead. We are a private flower shop, not part of the temple; temple rules on what may be taken inside apply.",
        },
        { type: "image", url: photo(35519271, "tile"), alt: "Woman drawing a kolam on the street at dawn" },
        { type: "faq", items: FAQ.slice(2, 4) },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' subjects, not our customers or staff, and no temple's name or emblem is used.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Loose flowers", type: "category", ref: "loose-flowers", children: [{ label: "Jasmine strings", type: "category", ref: "jasmine-strings" }] },
      { label: "Garlands", type: "category", ref: "garlands", children: [{ label: "Wedding garlands", type: "category", ref: "wedding-garlands" }, { label: "Garland guide", type: "page", ref: "garland-guide" }] },
      { label: "Pooja", type: "category", ref: "pooja-items", children: [{ label: "Festival kits", type: "collection", ref: "festival-kits" }, { label: "Temple offerings", type: "category", ref: "temple-offerings" }, { label: "Lamps & diyas", type: "collection", ref: "lamps" }] },
      { label: "Decoration", type: "category", ref: "flower-decoration" },
      { label: "Festival calendar", type: "page", ref: "festival-calendar" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Temple delivery", type: "page", ref: "temple-delivery" },
          { label: "Garland guide", type: "page", ref: "garland-guide" },
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "Order ahead", type: "collection", ref: "advance-order" },
          { label: "Ships across Tamil Nadu", type: "collection", ref: "ships-tamil-nadu" },
          { label: "Our story", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
