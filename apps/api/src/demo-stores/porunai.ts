import type { DemoProduct, DemoStore, DemoVariant } from "./types";

/**
 * Store #2 of the series: Porunai Sweets & Bakery, Tirunelveli (porunai.localhost:3003). A sweet stall and bakery on
 * the online store app (EC) with the `bakery` trade (weighing scales on) and the "mithai" look (ivory, maroon and
 * saffron, sweet-box lace). Porunai is the old Tamil name of the Thamirabarani river. Names are generic (no brands);
 * prices are typical Tirunelveli counter prices in 2026, GST included. Address, phone and GSTIN are placeholders like
 * the other demo shops.
 *
 * GST (CGST notification 9/2025-Central Tax (Rate), in force from 22 Sept 2025): cakes, pastries, biscuits, cookies,
 * puffs and rusks (HSN 1905) 5%; sweetmeats, namkeen / mixture (2106 90) 5%; banana chips (2008) 5%; puffed-rice
 * balls (1904) 5%; plain bread and pav (1905 90 10) nil. Gift boxes and hampers are mixed supplies of 5% goods: 5%.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500014";
const WHATSAPP = "919876500014";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

/** Sweets by weight: 250 g / 500 g / 1 kg boxes, prices [₹, MRP ₹] per size. */
const byWeight = (q: [number, number], h: [number, number], k: [number, number], stock = [40, 30, 20]) =>
  one("Weight", [
    ["250 g", q[0], q[1], stock[0]!],
    ["500 g", h[0], h[1], stock[1]!],
    ["1 kg", k[0], k[1], stock[2]!],
  ]);

/** Cakes: every weight with egg or eggless; eggless costs `extra` ₹ more per ½ kg. Rows: [weight, ₹, MRP ₹, stock]. */
function cake(rows: [string, number, number, number][], extra = 50): Pick<DemoProduct, "options" | "variants"> {
  const types = ["With egg", "Eggless"];
  const variants: DemoVariant[] = [];
  for (const [w, price, mrp, stock] of rows) {
    const halves = w === "½ kg" ? 1 : w === "1 kg" ? 2 : 4;
    for (const t of types) {
      const add = t === "Eggless" ? extra * halves : 0;
      variants.push({ values: { Weight: w, Type: t }, price: rs(price + add), mrp: rs(mrp + add), stock });
    }
  }
  return { options: [{ name: "Weight", values: rows.map((r) => r[0]) }, { name: "Type", values: types }], variants };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

const CAKES = "Cakes";
const SWEETS = "Sweets";
const SAVOURIES = "Savouries";
const BREADS = "Breads";
const COOKIES = "Cookies";
const GIFTS = "Gift boxes";

const CAKE_NOTE = "\n\nBaked to order: order by 6 pm for the next day (4 hours ahead for ½ kg and 1 kg in store hours). Message on the cake free; choose eggless at no wait. Keep refrigerated, best within 2 days.";

const PRODUCTS: DemoProduct[] = [
  // ---- cakes (HSN 1905 90 90, 5%)
  {
    name: "Black forest cake",
    category: CAKES,
    hsn: "19059090",
    gstRate: 5,
    unit: "pcs",
    sku: "PS-BF",
    photo: 19202782,
    tags: ["eggless", "celebration", "bestseller"],
    description: `Chocolate sponge soaked in cherry syrup, layered with fresh whipped cream and dark cherries, finished with chocolate shavings. Our most ordered birthday cake.${CAKE_NOTE}`,
    attributes: { Flavour: "Chocolate & cherry", Cream: "Fresh whipped cream", Serves: "½ kg: 6–8, 1 kg: 12–15" },
    ...cake([
      ["½ kg", 450, 500, 8],
      ["1 kg", 850, 950, 6],
    ]),
  },
  {
    name: "Chocolate truffle cake",
    category: CAKES,
    hsn: "19059090",
    gstRate: 5,
    unit: "pcs",
    sku: "PS-CT",
    photo: 30873820,
    tags: ["eggless", "celebration", "bestseller"],
    description: `Dense chocolate sponge layered and covered with dark chocolate ganache, with a glossy drip and truffle balls on top. For chocolate lovers.${CAKE_NOTE}`,
    attributes: { Flavour: "Dark chocolate", Cream: "Chocolate ganache", Serves: "½ kg: 6–8, 1 kg: 12–15, 2 kg: 25–30" },
    ...cake([
      ["½ kg", 550, 600, 6],
      ["1 kg", 1050, 1150, 4],
      ["2 kg", 2000, 2200, 2],
    ]),
  },
  {
    name: "Red velvet cake",
    category: CAKES,
    hsn: "19059090",
    gstRate: 5,
    unit: "pcs",
    sku: "PS-RV",
    photo: 5112676,
    tags: ["eggless", "celebration"],
    description: `Soft cocoa-red sponge with cream cheese frosting between every layer, topped with red velvet crumbs and berries. Anniversaries and engagements.${CAKE_NOTE}`,
    attributes: { Flavour: "Red velvet", Cream: "Cream cheese frosting", Serves: "½ kg: 6–8, 1 kg: 12–15" },
    ...cake([
      ["½ kg", 600, 650, 4],
      ["1 kg", 1150, 1250, 3],
    ]),
  },
  {
    name: "Strawberry fresh cream cake",
    category: CAKES,
    hsn: "19059090",
    gstRate: 5,
    unit: "pcs",
    sku: "PS-SB",
    photo: 16134542,
    tags: ["eggless", "celebration"],
    description: `Vanilla sponge with strawberry crush and fresh cream, crowned with berries. Light, not too sweet: children's birthdays.${CAKE_NOTE}`,
    attributes: { Flavour: "Strawberry & vanilla", Cream: "Fresh whipped cream", Serves: "½ kg: 6–8, 1 kg: 12–15" },
    ...cake([
      ["½ kg", 500, 550, 6],
      ["1 kg", 950, 1050, 4],
    ]),
  },
  {
    name: "Butterscotch cake",
    category: CAKES,
    hsn: "19059090",
    gstRate: 5,
    unit: "pcs",
    sku: "PS-BS",
    photo: 19036040,
    tags: ["eggless", "celebration"],
    description: `Vanilla sponge with butterscotch cream and crunchy caramel praline, finished with a caramel drip. The office-party favourite.${CAKE_NOTE}`,
    attributes: { Flavour: "Butterscotch", Cream: "Butterscotch cream, praline", Serves: "½ kg: 6–8, 1 kg: 12–15" },
    ...cake([
      ["½ kg", 450, 500, 8],
      ["1 kg", 850, 950, 6],
    ]),
  },
  {
    name: "Rich plum cake",
    category: CAKES,
    hsn: "19059090",
    gstRate: 5,
    unit: "pcs",
    sku: "PS-PLUM",
    photo: 7354613,
    tags: ["festive"],
    description: "Dark, moist fruit cake with rum-free soaked raisins, dates, orange peel, cashews and warm spices, baked in a loaf. Keeps for two weeks without a fridge; the Christmas and New Year favourite.",
    attributes: { Contains: "Egg, nuts", "Best before": "14 days" },
    ...one("Weight", [
      ["400 g", 280, 320, 40],
      ["800 g", 540, 600, 25],
    ]),
  },
  {
    name: "Cupcakes (box of 6)",
    category: CAKES,
    hsn: "19059090",
    gstRate: 5,
    unit: "box",
    sku: "PS-CUP",
    photo: 9045540,
    tags: ["celebration"],
    description: "Six soft cupcakes with a swirl of buttercream, packed in a window box. Return gifts and school birthdays: order 12 boxes or more a day ahead.",
    attributes: { Pieces: "6", "Best before": "2 days" },
    ...one("Flavour", [
      ["Vanilla", 240, 270, 20],
      ["Chocolate", 270, 300, 20],
      ["Red velvet", 300, 330, 12],
    ]),
  },

  // ---- sweets (HSN 2106 90 99 sweetmeats, 5%)
  {
    name: "Tirunelveli wheat halwa",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-HAL",
    photo: 8820715,
    tags: ["bestseller", "festive", "signature"],
    description: "Our town's own sweet: wheat milk slow-cooked with sugar and pure ghee for hours over a wood fire until it turns glossy and dark, finished with cashews. Served warm at the counter from 4 pm.\n\nPacked hot in leaf-lined boxes. Keeps 10 days without a fridge.",
    attributes: { "Made with": "Wheat, sugar, pure ghee, cashew", "Best before": "10 days", Eggless: "Yes" },
    ...byWeight([120, 130], [230, 250], [450, 480], [80, 60, 40]),
  },
  {
    name: "Ghee Mysore pak",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-MP",
    photo: 35065605,
    tags: ["bestseller", "festive"],
    description: "Soft, melt-in-the-mouth Mysore pak made with roasted gram flour, sugar and a generous pour of pure cow ghee. Porous and buttery, not the hard kind.",
    attributes: { "Made with": "Gram flour, sugar, pure ghee", "Best before": "15 days", Eggless: "Yes" },
    ...byWeight([180, 200], [350, 390], [680, 760]),
  },
  {
    name: "Boondi laddu",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-LAD",
    photo: 5350676,
    tags: ["bestseller", "festive"],
    description: "Fine saffron boondi fried in ghee, bound in cardamom syrup with cashews, raisins and a touch of edible camphor, the way temple laddus are made. About 16 pieces to the kilo.",
    attributes: { "Made with": "Gram flour, sugar, ghee, cashew, raisin", "Best before": "7 days", Eggless: "Yes" },
    ...byWeight([100, 110], [190, 210], [370, 400], [60, 40, 30]),
  },
  {
    name: "Kaju katli",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-KK",
    photo: 10514163,
    tags: ["festive"],
    description: "Thin cashew diamonds with a silver leaf, made from whole W320 cashews ground fresh every morning. Not too sweet; the gift everyone is happy to get.",
    attributes: { "Made with": "Cashew, sugar, silver leaf", "Best before": "15 days", Eggless: "Yes" },
    ...byWeight([320, 350], [620, 680], [1200, 1320]),
  },
  {
    name: "Kalakand (milk cake)",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-KAL",
    photo: 38883078,
    description: "Grainy, moist milk cake made by reducing fresh milk with sugar, topped with silver leaf and pistachio. Made every morning; keep refrigerated.",
    attributes: { "Made with": "Milk, sugar, pistachio", "Best before": "4 days (refrigerated)", Eggless: "Yes" },
    ...byWeight([160, 180], [310, 340], [600, 660], [25, 20, 12]),
  },
  {
    name: "Milk peda",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-PEDA",
    photo: 9672994,
    description: "Soft peda made from slow-reduced milk khoa with cardamom and a hint of saffron. Temple offerings and baby-naming ceremonies.",
    attributes: { "Made with": "Milk khoa, sugar, cardamom", "Best before": "7 days", Eggless: "Yes" },
    ...byWeight([150, 165], [290, 320], [560, 620]),
  },
  {
    name: "Jangiri",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-JAN",
    photo: 36672621,
    tags: ["festive"],
    description: "Urad dal jangiri piped into flower rings, fried in ghee and soaked in saffron syrup. Crisp outside, juicy inside; best on the day.",
    attributes: { "Made with": "Urad dal, sugar, ghee", "Best before": "3 days", Eggless: "Yes" },
    ...byWeight([100, 110], [190, 210], [360, 400], [30, 25, 15]),
  },
  {
    name: "Gulab jamun",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "tin",
    sku: "PS-GJ",
    photo: 15014919,
    description: "Soft khoa jamuns fried golden and soaked in rose-cardamom syrup, packed with the syrup in a sealed tin. Warm them for 20 seconds before serving.",
    attributes: { "Made with": "Milk khoa, sugar, rose water", "Best before": "10 days (sealed)", Eggless: "Yes" },
    ...one("Pack", [
      ["500 g tin", 160, 180, 40],
      ["1 kg tin", 300, 340, 30],
    ]),
  },
  {
    name: "Carrot halwa",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-CAR",
    photo: 5453716,
    tags: ["seasonal"],
    description: "Grated Ooty carrots slow-cooked in milk with ghee, khoa and cashews. A winter special, made fresh in small batches; keep refrigerated.",
    attributes: { "Made with": "Carrot, milk, khoa, ghee, cashew", "Best before": "3 days (refrigerated)", Eggless: "Yes" },
    ...one("Weight", [
      ["250 g", 120, 135, 20],
      ["500 g", 230, 260, 12],
    ]),
  },
  {
    name: "Dry fruit burfi",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-DFB",
    photo: 18488301,
    tags: ["festive"],
    description: "Sugar-light burfi of dates, figs, almonds, cashews and pistachios pressed with a little ghee. A rich sweet for those cutting down on sugar.",
    attributes: { "Made with": "Dates, figs, almond, cashew, pistachio", "Best before": "20 days", Eggless: "Yes" },
    ...byWeight([280, 310], [540, 600], [1050, 1160], [20, 15, 10]),
  },
  {
    name: "Kaju pista roll",
    category: SWEETS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-KPR",
    photo: 18488305,
    tags: ["festive"],
    description: "Cashew paste rolled around a pistachio filling, in white and rose. Sliced to show the swirl; looks lovely in a gift box.",
    attributes: { "Made with": "Cashew, pistachio, sugar", "Best before": "15 days", Eggless: "Yes" },
    ...byWeight([330, 360], [640, 700], [1250, 1380], [15, 12, 8]),
  },
  {
    name: "Pori urundai (pack of 10)",
    category: SWEETS,
    hsn: "1904",
    gstRate: 5,
    unit: "pack",
    sku: "PS-PORI",
    photo: 40000455,
    tags: ["festive"],
    description: "Crisp puffed-rice balls bound with palm jaggery and a pinch of dry ginger, the Karthigai Deepam sweet. Ten balls in a pack.",
    attributes: { "Made with": "Puffed rice, palm jaggery, dry ginger", Pieces: "10", Eggless: "Yes" },
    ...single(60, 70, 80),
  },

  // ---- savouries (namkeen HSN 2106 90 sold loose by the kg on the scale, packs, puffs)
  {
    name: "Madras mixture (loose)",
    category: SAVOURIES,
    hsn: "21069019",
    gstRate: 5,
    unit: "kg",
    sku: "PS-MIX",
    photo: 9557672,
    tags: ["bestseller", "loose"],
    description: "Our house mixture: kara boondi, omapodi, fried gram, peanuts, cashews and curry leaves, spiced with chilli and asafoetida. Weighed at the counter on the scale and sold by the kilo (the price is per kg; ask for any weight in the shop).",
    attributes: { Sold: "By weight, price per kg", "Best before": "30 days", Spice: "Medium" },
    ...single(360, 400, 40),
  },
  {
    name: "Ribbon pakoda (loose)",
    category: SAVOURIES,
    hsn: "21069019",
    gstRate: 5,
    unit: "kg",
    sku: "PS-RIB",
    photo: 9569707,
    tags: ["loose"],
    description: "Flat, crunchy ribbons of rice and gram flour with chilli, sesame and butter. Sold loose by weight (price per kg).",
    attributes: { Sold: "By weight, price per kg", "Best before": "30 days", Spice: "Medium" },
    ...single(340, 380, 30),
  },
  {
    name: "Kara sev (loose)",
    category: SAVOURIES,
    hsn: "21069019",
    gstRate: 5,
    unit: "kg",
    sku: "PS-SEV",
    photo: 30575178,
    tags: ["loose"],
    description: "Thick, peppery gram flour sev from Tirunelveli's street stalls, broken into short sticks. Sold loose by weight (price per kg).",
    attributes: { Sold: "By weight, price per kg", "Best before": "30 days", Spice: "Pepper hot" },
    ...single(320, 360, 30),
  },
  {
    name: "Kai murukku",
    category: SAVOURIES,
    hsn: "21069019",
    gstRate: 5,
    unit: "pack",
    sku: "PS-KM",
    photo: 5992263,
    tags: ["festive"],
    description: "Hand-twisted rice and urad dal murukku with cumin and sesame, made by our women's team the old way, fried in groundnut oil.",
    attributes: { "Made with": "Rice flour, urad dal, cumin, sesame", "Best before": "30 days" },
    ...one("Pack", [
      ["200 g", 90, 100, 60],
      ["500 g", 210, 240, 30],
    ]),
  },
  {
    name: "Thenkuzhal",
    category: SAVOURIES,
    hsn: "21069019",
    gstRate: 5,
    unit: "pack",
    sku: "PS-TK",
    photo: 12865863,
    description: "Light, crisp pressed murukku of rice and urad dal with butter and cumin. A Deepavali tin is not complete without it.",
    attributes: { "Made with": "Rice flour, urad dal, butter, cumin", "Best before": "30 days" },
    ...one("Pack", [
      ["200 g", 80, 90, 60],
      ["500 g", 190, 210, 30],
    ]),
  },
  {
    name: "Kerala banana chips",
    category: SAVOURIES,
    hsn: "20089999",
    gstRate: 5,
    unit: "pack",
    sku: "PS-BC",
    photo: 9191924,
    description: "Thin slices of raw nendran banana fried in pure coconut oil with salt and turmeric. Crisp, golden and very hard to stop eating.",
    attributes: { "Made with": "Nendran banana, coconut oil, salt", "Best before": "45 days" },
    ...one("Pack", [
      ["250 g", 110, 125, 50],
      ["500 g", 210, 240, 30],
    ]),
  },
  {
    name: "Veg puff",
    category: SAVOURIES,
    hsn: "19059090",
    gstRate: 5,
    unit: "pcs",
    sku: "PS-PUFF",
    photo: 6915503,
    tags: ["fresh"],
    description: "Flaky puff pastry filled with spiced potato, peas and onion masala. Out of the oven at 11 am and 4 pm; order 20 or more a day ahead for meetings.",
    attributes: { Filling: "Potato, peas, onion masala", Eggless: "Yes", "Best before": "Same day" },
    ...single(25, 25, 80),
  },

  // ---- breads (plain bread and pav 1905 90 10: nil; buns and rusk 5%)
  {
    name: "Milk bread (400 g)",
    category: BREADS,
    hsn: "19059010",
    gstRate: 0,
    unit: "pcs",
    sku: "PS-MB",
    photo: 5657400,
    tags: ["fresh", "daily"],
    description: "Soft, sliced sandwich loaf made with milk, baked at 5 am every day. No preservatives, so enjoy it within 3 days.",
    attributes: { Weight: "400 g", "Best before": "3 days", Eggless: "Yes" },
    ...single(45, 48, 60),
  },
  {
    name: "Brown wheat bread (400 g)",
    category: BREADS,
    hsn: "19059010",
    gstRate: 0,
    unit: "pcs",
    sku: "PS-WB",
    photo: 4203052,
    tags: ["fresh", "daily"],
    description: "Sliced loaf of whole wheat flour with a little jaggery and oats on top. Firmer crumb, good for toast.",
    attributes: { Weight: "400 g", Flour: "Whole wheat", "Best before": "3 days", Eggless: "Yes" },
    ...single(55, 60, 40),
  },
  {
    name: "Soft pav (pack of 6)",
    category: BREADS,
    hsn: "19059010",
    gstRate: 0,
    unit: "pack",
    sku: "PS-PAV",
    photo: 6411488,
    tags: ["fresh", "daily"],
    description: "Six soft pull-apart dinner rolls for pav bhaji, vada pav or a quick sandwich.",
    attributes: { Pieces: "6", "Best before": "2 days", Eggless: "Yes" },
    ...single(40, 45, 50),
  },
  {
    name: "Sesame sweet bun (pack of 4)",
    category: BREADS,
    hsn: "19059090",
    gstRate: 5,
    unit: "pack",
    sku: "PS-BUN",
    photo: 38433901,
    tags: ["fresh", "daily"],
    description: "Glazed sweet buns with tutti-frutti inside and sesame on top, the tea-shop classic. Four in a pack.",
    attributes: { Pieces: "4", "Best before": "2 days", Eggless: "Yes" },
    ...single(60, 65, 50),
  },
  {
    name: "Milk rusk (300 g)",
    category: BREADS,
    hsn: "19054000",
    gstRate: 5,
    unit: "pack",
    sku: "PS-RUSK",
    photo: 5767185,
    description: "Twice-baked milk rusk with cardamom, crisp all the way through. Made for dunking in evening tea.",
    attributes: { Weight: "300 g", "Best before": "60 days", Eggless: "Yes" },
    ...single(70, 80, 60),
  },

  // ---- cookies (HSN 1905 31 00 / 1905 90, 5%)
  {
    name: "Butter cookies",
    category: COOKIES,
    hsn: "19053100",
    gstRate: 5,
    unit: "pack",
    sku: "PS-BUT",
    photo: 9620131,
    tags: ["eggless"],
    description: "Piped butter swirls with a chocolate chip in the middle, baked golden. Eggless.",
    attributes: { "Made with": "Butter, flour, sugar", "Best before": "45 days", Eggless: "Yes" },
    ...one("Pack", [
      ["250 g", 140, 160, 50],
      ["500 g", 270, 300, 30],
    ]),
  },
  {
    name: "Assorted tea-time cookies",
    category: COOKIES,
    hsn: "19053100",
    gstRate: 5,
    unit: "pack",
    sku: "PS-TEA",
    photo: 5665691,
    tags: ["eggless"],
    description: "A mix of coconut cookies, cashew biscuits, salt biscuits and jeera cookies from our oven, the way bakeries in Tamil Nadu sell them by the box.",
    attributes: { Mix: "Coconut, cashew, salt, jeera", "Best before": "45 days", Eggless: "Yes" },
    ...one("Pack", [
      ["250 g", 110, 125, 50],
      ["500 g", 210, 240, 30],
    ]),
  },
  {
    name: "Chocolate chip cookies",
    category: COOKIES,
    hsn: "19053100",
    gstRate: 5,
    unit: "pack",
    sku: "PS-CCC",
    photo: 16450180,
    description: "Crisp-edged, chewy-centred cookies with dark chocolate chips and brown sugar.",
    attributes: { Contains: "Egg, butter", "Best before": "30 days" },
    ...one("Pack", [
      ["200 g", 150, 170, 40],
      ["400 g", 290, 320, 20],
    ]),
  },
  {
    name: "Osmania biscuits",
    category: COOKIES,
    hsn: "19053100",
    gstRate: 5,
    unit: "pack",
    sku: "PS-OSM",
    photo: 13143701,
    tags: ["eggless"],
    description: "Sweet-and-salty butter biscuits with a sugar sparkle on top, short and crumbly. Eggless.",
    attributes: { "Best before": "45 days", Eggless: "Yes" },
    ...one("Pack", [
      ["250 g", 100, 110, 50],
      ["500 g", 190, 210, 30],
    ]),
  },
  {
    name: "Ghee nankhatai",
    category: COOKIES,
    hsn: "19059090",
    gstRate: 5,
    unit: "pack",
    sku: "PS-NAN",
    photo: 10881471,
    tags: ["eggless", "festive"],
    description: "Melt-in-the-mouth shortbread of flour, gram flour and pure ghee with cardamom. Eggless.",
    attributes: { "Made with": "Flour, gram flour, ghee, cardamom", "Best before": "30 days", Eggless: "Yes" },
    ...one("Pack", [
      ["250 g", 130, 150, 40],
      ["500 g", 250, 280, 25],
    ]),
  },

  // ---- festival gift boxes (mixed 5% goods: 5%)
  {
    name: "Deepavali assorted sweets box",
    category: GIFTS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-DAB",
    photo: 11484120,
    tags: ["festive", "gift", "bestseller"],
    description: "Eight of our sweets in one gift box: halwa, Mysore pak, kaju katli, milk peda, laddu, kalakand, dry fruit burfi and kaju roll. Ribbon and greeting card free; corporate orders of 25+ boxes with your logo sticker.",
    attributes: { Sweets: "8 kinds", "Best before": "7 days", Eggless: "Yes" },
    ...one("Size", [
      ["500 g", 380, 420, 60],
      ["1 kg", 740, 820, 40],
    ]),
  },
  {
    name: "Boondi laddu gift box (9 pcs)",
    category: GIFTS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-LGB",
    photo: 19151506,
    tags: ["festive", "gift"],
    description: "Nine large ghee boondi laddus, each in its own paper cup, in a rigid gift box. Weddings, housewarmings and return gifts.",
    attributes: { Pieces: "9", Weight: "About 600 g", "Best before": "7 days", Eggless: "Yes" },
    ...single(260, 290, 50),
  },
  {
    name: "Premium dry-fruit sweets box",
    category: GIFTS,
    hsn: "21069099",
    gstRate: 5,
    unit: "box",
    sku: "PS-PDB",
    photo: 9951856,
    tags: ["festive", "gift"],
    description: "Our richest sweets in a velvet-lined box: kaju katli, badam burfi, pista roll, anjeer barfi and dry fruit laddu. The corporate Deepavali favourite.",
    attributes: { Sweets: "5 kinds", "Best before": "15 days", Eggless: "Yes" },
    ...one("Size", [
      ["500 g", 650, 720, 30],
      ["1 kg", 1250, 1390, 20],
    ]),
  },
  {
    name: "Sweets & savouries Deepavali hamper",
    category: GIFTS,
    hsn: "21069099",
    gstRate: 5,
    unit: "set",
    sku: "PS-HAMP",
    photo: 39524790,
    tags: ["festive", "gift"],
    description: "The whole Deepavali plate in one hamper: 500 g gulab jamun, 250 g each of halwa, Mysore pak and kaju katli, 200 g each of kai murukku and thenkuzhal, and 250 g Madras mixture, in a reusable steel box.",
    attributes: { Contents: "4 sweets, 3 savouries", "Best before": "7 days", Eggless: "Yes" },
    ...single(999, 1150, 40),
  },
];

/** Occasions of the home's cake finder, as product tags (existing shops get them from the relayout tag step). */
const OCCASIONS: Record<string, string[]> = {
  "Black forest cake": ["birthday", "kids-party"],
  "Chocolate truffle cake": ["birthday", "anniversary"],
  "Red velvet cake": ["anniversary", "birthday"],
  "Strawberry fresh cream cake": ["kids-party", "birthday"],
  "Butterscotch cake": ["office-party", "birthday"],
  "Rich plum cake": ["christmas", "office-party"],
  "Cupcakes (box of 6)": ["kids-party", "office-party"],
};
for (const p of PRODUCTS) if (OCCASIONS[p.name]) p.tags = [...(p.tags ?? []), ...OCCASIONS[p.name]!];


/** Pexels photos used by the store (credited on /pages/photo-credits). */
const PHOTOS: DemoStore["photos"] = {
  19202782: { by: "Nano Erdozain", alt: "Black forest cake with cherries and whipped cream" },
  30873820: { by: "Konstantin Klimov", alt: "Chocolate cake with ganache drip and truffles" },
  5112676: { by: "Shameel mukkath", alt: "Slice of red velvet cake with berries" },
  16134542: { by: "Doğu Tuncer", alt: "Fresh cream cake topped with strawberries" },
  19036040: { by: "Patricio Ledeill", alt: "Caramel drip celebration cakes" },
  7354613: { by: "SpotwizardLee", alt: "Slices of plum cake on a plate" },
  9045540: { by: "Candice Pickering", alt: "Vanilla and chocolate cupcakes" },
  8820715: { by: "Saveurs Secretes", alt: "Dark wheat halwa pieces with cashews" },
  35065605: { by: "hiven zhu", alt: "Pieces of soft ghee Mysore pak" },
  5350676: { by: "Debasish Saha", alt: "Boondi laddus with pistachio" },
  10514163: { by: "Neeta", alt: "Kaju katli arranged in a star" },
  38883078: { by: "Mangalam Bhargava", alt: "Kalakand with silver leaf in a tray" },
  9672994: { by: "Sohani Kamat", alt: "Milk pedas on a metal plate" },
  36672621: { by: "aksinfo7 universe", alt: "Jangiri with almond slivers" },
  15014919: { by: "Nishess Shakya", alt: "Gulab jamun in a bowl with cashews" },
  5453716: { by: "Saveurs Secretes", alt: "Carrot halwa in black and copper bowls" },
  18488301: { by: "Gaurav Kumar", alt: "Dry fruit burfi with almonds and pistachios" },
  18488305: { by: "Gaurav Kumar", alt: "Kaju pista rolls on a brass tray" },
  40000455: { by: "Jahra Tasfia Reza", alt: "Puffed rice and jaggery balls in a basket" },
  9557672: { by: "Saveurs Secretes", alt: "Madras mixture in a basket with tea" },
  9569707: { by: "Meggy Kadam Aryanto", alt: "Spicy ribbon pakoda in a wooden bowl" },
  30575178: { by: "Nunun Dy", alt: "Kara sev on a white plate" },
  5992263: { by: "Saveurs Secretes", alt: "Kai murukku with tea" },
  12865863: { by: "krishna prasad", alt: "Thenkuzhal murukku on a wooden board" },
  9191924: { by: "Saveurs Secretes", alt: "Banana chips in a woven basket" },
  6915503: { by: "yunus alex", alt: "Veg puffs on a glass plate" },
  5657400: { by: "Cats Coming", alt: "Milk bread loaf on a board" },
  4203052: { by: "Kaboompics", alt: "Brown wheat loaf" },
  38433901: { by: "zahara", alt: "Glazed sesame buns on a tray" },
  6411488: { by: "César Guel", alt: "Soft pav rolls in a basket" },
  5767185: { by: "Magda Ehlers", alt: "Rusk with a mug of tea" },
  9620131: { by: "Meggy Kadam Aryanto", alt: "Piped butter cookies" },
  5665691: { by: "Dima Valkov", alt: "Rows of assorted cookies" },
  16450180: { by: "Agustina R Street", alt: "Chocolate chip cookies in a bowl" },
  13143701: { by: "Terrance Barksdale", alt: "Sugar-topped Osmania biscuits" },
  10881471: { by: "Micaela Alejandro", alt: "Nankhatai on a cooling rack with coffee" },
  11484120: { by: "Towfiqu barbhuiya", alt: "Box of assorted Indian sweets" },
  19151506: { by: "Sharath G.", alt: "Laddus in a gift box" },
  9951856: { by: "Rajan Gaur", alt: "Plate of assorted dry-fruit sweets" },
  39524790: { by: "Yogendra Banjare", alt: "Deepavali platter of sweets and savouries" },
  // categories, home and pages
  8887196: { by: "Lara Jameson", alt: "Laddus in a brass bowl among oil lamps" },
  8818590: { by: "Yan Krukau", alt: "Deepavali sweets with candles and marigolds" },
  28983225: { by: "Beyza", alt: "Heart-shaped celebration cake with cherries" },
  38524183: { by: "Bilal's Here", alt: "Sweet shop display of laddus and burfis" },
  9832636: { by: "Saveurs Secretes", alt: "Murukku in a wooden bowl" },
  14363849: { by: "Zhengdong Hu", alt: "Bakery display case of breads and buns" },
  5607399: { by: "Terrance Barksdale", alt: "Tin of assorted butter cookies" },
  8819577: { by: "Yan Krukau", alt: "Gift boxes with marigolds and lights" },
  3983578: { by: "Gustavo Fring", alt: "Baker finishing a drip cake" },
  12178037: { by: "Markus Winkler", alt: "Trays of sweets in a display case" },
};

const HOURS = [
  { label: "Every day", value: "7:00 am – 10:00 pm" },
  { label: "Hot halwa", value: "From 4:00 pm" },
];

const FAQ = [
  {
    q: "Do you make eggless cakes?",
    a: "Yes. Every cake on our menu comes eggless at a small extra charge (₹50 per ½ kg), made on a separate bench. All our sweets, savouries, breads and most cookies are eggless anyway; the product page says so.",
  },
  {
    q: "How early should I order a cake?",
    a: "½ kg and 1 kg cakes: 4 hours ahead during shop hours. Order by 6 pm for next-morning delivery. 2 kg, tiered, photo and theme cakes need 24 hours; wedding cakes 3 days.",
  },
  {
    q: "How fast do you deliver in Tirunelveli?",
    a: "Within Tirunelveli and Palayamkottai (pincodes 627xxx) in 2–3 hours, or at the time you pick for cakes. ₹40 per order, free above ₹500.",
  },
  { q: "Do you ship sweets outside Tirunelveli?", a: "Yes, sweets, savouries and cookies (not cakes or fresh breads) go anywhere in Tamil Nadu by courier in 2–3 days, packed airtight. ₹80, free above ₹1,500." },
  { q: "Is your halwa made in pure ghee?", a: "Yes. The halwa, Mysore pak, laddu and nankhatai use only pure cow ghee; savouries are fried in groundnut oil and banana chips in coconut oil." },
  { q: "Can I order sweet boxes for a wedding or office?", a: "Yes. Send the count and the date on WhatsApp; for 25+ boxes we add your name or logo sticker and deliver on the day. Order a week ahead for Deepavali." },
];

const FAQ_TA = [
  {
    q: "முட்டையில்லா கேக் செய்வீர்களா?",
    a: "ஆம். எங்கள் மெனுவில் உள்ள எல்லா கேக்கும் சிறிய கூடுதல் கட்டணத்தில் (½ கிலோவுக்கு ₹50) முட்டையில்லாமல், தனி மேஜையில் செய்யப்படும். எங்கள் இனிப்பு, காரம், பிரெட், பெரும்பாலான குக்கீஸ் எல்லாமே முட்டையில்லாதவை; பொருள் பக்கத்தில் குறிப்பிட்டிருக்கும்.",
  },
  {
    q: "கேக்கை எவ்வளவு முன்னதாக ஆர்டர் செய்ய வேண்டும்?",
    a: "½ கிலோ, 1 கிலோ கேக்: கடை நேரத்தில் 4 மணி நேரம் முன்பு. மறுநாள் காலை டெலிவரிக்கு மாலை 6 மணிக்குள் ஆர்டர் செய்யுங்கள். 2 கிலோ, அடுக்கு, புகைப்பட, தீம் கேக்குகளுக்கு 24 மணி நேரம்; திருமண கேக்குக்கு 3 நாள்.",
  },
  {
    q: "திருநெல்வேலியில் எவ்வளவு விரைவில் டெலிவரி?",
    a: "திருநெல்வேலி, பாளையங்கோட்டை (627xxx பின்கோடு) பகுதிகளில் 2–3 மணி நேரத்தில், கேக்குகளுக்கு நீங்கள் தேர்வு செய்யும் நேரத்தில். ஒரு ஆர்டருக்கு ₹40, ₹500-க்கு மேல் இலவசம்.",
  },
  { q: "திருநெல்வேலிக்கு வெளியே இனிப்பு அனுப்புவீர்களா?", a: "ஆம், இனிப்பு, காரம், குக்கீஸ் (கேக், புதிய பிரெட் தவிர) தமிழ்நாடு முழுவதும் 2–3 நாளில் கூரியரில், காற்றுப்புகாத பேக்கிங்கில். ₹80, ₹1,500-க்கு மேல் இலவசம்." },
  { q: "உங்கள் அல்வா சுத்தமான நெய்யில் செய்யப்படுகிறதா?", a: "ஆம். அல்வா, மைசூர் பாக், லட்டு, நான்கட்டாய் சுத்தமான பசு நெய்யில் மட்டுமே; காரங்கள் கடலை எண்ணெயிலும் வாழைக்காய் சிப்ஸ் தேங்காய் எண்ணெயிலும் பொரிக்கப்படுகின்றன." },
  { q: "திருமணம், அலுவலகத்துக்கு இனிப்புப் பெட்டிகள் ஆர்டர் செய்யலாமா?", a: "ஆம். எண்ணிக்கையையும் தேதியையும் வாட்ஸ்அப்பில் அனுப்புங்கள்; 25-க்கு மேற்பட்ட பெட்டிகளுக்கு உங்கள் பெயர் அல்லது லோகோ ஸ்டிக்கர் ஒட்டி அன்றே டெலிவரி செய்வோம். தீபாவளிக்கு ஒரு வாரம் முன்பே ஆர்டர் செய்யுங்கள்." },
];

/** A menu-board dish's words in Tamil (typed as plain words: a mixed literal array would infer `description?: undefined`). */
const dish = (name: string, description?: string): Record<string, string> => (description ? { name, description } : { name });

const CAKE_ORDER_TEXT = "Hello Porunai Sweets, I'd like to order a cake. Date & time: … Weight: … Flavour: … Eggless: yes/no. Message on the cake: …";

export const PORUNAI: DemoStore = {
  shop: {
    slug: "porunai",
    appId: "EC",
    businessType: "bakery",
    planId: "pro",
    name: "Porunai Sweets & Bakery",
    primary: "#7a1f2b",
    billing: {
      legalName: "Porunai Sweets & Bakery",
      gstin: "33AAPFP1357K1ZY",
      address: "14, East Car Street, near Nellaiappar Temple",
      city: "Tirunelveli",
      pincode: "627006",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "PS",
      upiId: "porunaisweets@okicici",
    },
    items: [{ name: "Photo print on cake (edible)", hsn: "19059090", unit: "pcs", rate: 14_300, gstRate: 5 }],
  },
  preset: "mithai",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 500_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "orders@porunaisweets.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/porunaisweets" },
    policies: {
      shipping:
        "**Tirunelveli & Palayamkottai (627xxx):** delivered in 2–3 hours by our own riders, cakes at the time you choose. ₹40 per order, free above ₹500.\n\n**Rest of Tamil Nadu:** sweets, savouries and cookies by courier in 2–3 days, packed airtight. ₹80 per order, free above ₹1,500. Cakes, breads, puffs and milk sweets (kalakand, carrot halwa) are not shipped.",
      returns:
        "Food can't be returned once delivered. If anything reaches you damaged, stale or wrong, send a photo on WhatsApp within 24 hours (cakes: within 2 hours) and we replace it or refund you in full.",
      privacy: "We use your details only to make and deliver your order and send your GST bill.",
      terms: "Prices include GST. Cake designs are made to look like the picture; flowers and toppers may differ with the season. Sweets sold by weight are weighed at packing.",
    },
    businessType: "bakery",
  },
  zones: [
    {
      name: "Tirunelveli & Palayamkottai",
      pincodePrefixes: ["627"],
      rate: { name: "Same-day delivery (2–3 hours)", type: "free_above", amount: 4_000, freeAbove: 50_000, etaMinDays: 0, etaMaxDays: 0, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–3 days)", type: "free_above", amount: 8_000, freeAbove: 150_000, etaMinDays: 2, etaMaxDays: 3, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: CAKES, description: "Celebration cakes baked to order, every one available eggless, plus plum cake and cupcakes.", photo: 28983225 },
    { name: SWEETS, description: "Tirunelveli halwa, ghee Mysore pak, laddu, kaju katli and milk sweets, made fresh in pure ghee.", photo: 38524183 },
    { name: SAVOURIES, description: "Mixture, ribbon pakoda and kara sev by the kilo, murukku, banana chips and hot puffs.", photo: 9832636 },
    { name: BREADS, description: "Milk and wheat bread, pav, buns and rusk, baked at 5 am every day.", photo: 14363849 },
    { name: COOKIES, description: "Butter cookies, Osmania biscuits, nankhatai and tea-time cookies from our own oven.", photo: 5607399 },
    { name: GIFTS, description: "Deepavali sweet boxes, laddu boxes, dry-fruit boxes and hampers. Corporate orders welcome.", photo: 8819577 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "Fresh today", slug: "fresh-today", description: "Out of our kitchen and oven this morning.", rule: { sort: "new" } },
    { name: "On offer", slug: "on-offer", description: "Sweets, cakes and boxes below MRP right now.", rule: { onSale: true, sort: "price-asc" } },
    { name: "Festival gift boxes", slug: "festival-gift-boxes", description: "Sweet boxes and hampers for Deepavali, Pongal, weddings and offices.", rule: { category: GIFTS, sort: "price-asc" } },
    { name: "Celebration cakes", slug: "celebration-cakes", description: "Birthday and anniversary cakes, all available eggless.", rule: { category: CAKES, sort: "name" } },
    { name: "Eggless", slug: "eggless", description: "Cakes, cookies and bakes made without eggs.", rule: { tag: "eggless", sort: "name" } },
  ],
  coupons: [
    {
      code: "DEEPAVALI10",
      description: "10% off orders above ₹1,500 (up to ₹300)",
      type: "percent",
      value: 10,
      minOrder: 150_000,
      maxDiscount: 30_000,
      channels: ["store", "manual"],
    },
  ],
  home: ({ photo, category }) => {
    const cats = [SWEETS, CAKES, SAVOURIES, GIFTS, BREADS, COOKIES].map(category);
    const cakes = category(CAKES);
    const size = (label: string, value: string) => ({ label, categoryId: cakes, filterName: "Weight", filterValue: value });
    return {
      seo: {
        title: "Porunai Sweets & Bakery, Tirunelveli — halwa, sweets, cakes",
        description: "Tirunelveli halwa, ghee sweets, savouries, fresh bread and celebration cakes (eggless too). Festival gift boxes, same-day delivery in Tirunelveli.",
        imageUrl: photo(8887196),
      },
      // Sidebar layout + phone tabs (the look's page layout): the counters and the cart sit in the left menu on desktop,
      // so the home reads like the shop's own board: today's counter, the festival boxes, then a cake order in three taps.
      sections: [
        {
          type: "hero",
          id: "pr-hero",
          slides: [
            {
              imageUrl: photo(8887196),
              heading: "Sweets made in pure ghee, the Tirunelveli way",
              subheading: "Hot wheat halwa from 4 pm, ghee Mysore pak and laddus made fresh every morning near the Nellaiappar temple.",
              cta: { label: "Shop Deepavali boxes", href: "/collections/festival-gift-boxes" },
            },
            {
              imageUrl: photo(19036040),
              heading: "Celebration cakes, eggless on request",
              subheading: "Order 4 hours ahead. Your message on the cake, delivered at the time you choose.",
              cta: { label: "Order a cake", href: "/pages/custom-cakes" },
            },
            {
              imageUrl: photo(8818590),
              heading: "Gift boxes for every festival",
              subheading: "Assorted sweets, dry-fruit boxes and hampers. Your name on 25+ boxes.",
              cta: { label: "See gift boxes", href: "/collections/festival-gift-boxes" },
            },
          ],
        },
        {
          type: "menu-board",
          id: "pr-today",
          title: "On the counter today",
          style: { background: "muted" },
          groups: [
            {
              name: "Hot from the oven",
              items: [
                { name: "Veg puff", description: "11 am & 4 pm", price: 2_500, diet: "veg" },
                { name: "Egg puff", description: "11 am & 4 pm", price: 3_000, diet: "egg" },
                { name: "Honey cake slice", description: "With coconut & jam", price: 3_000, diet: "egg" },
                { name: "Sesame sweet bun", price: 1_500, diet: "veg" },
              ],
            },
            {
              name: "Sweets by the kilo",
              items: [
                { name: "Tirunelveli wheat halwa", description: "Hot from 4 pm", price: 45_000, diet: "veg" },
                { name: "Ghee Mysore pak", price: 68_000, diet: "veg" },
                { name: "Boondi laddu", price: 37_000, diet: "veg" },
                { name: "Jangiri", price: 36_000, diet: "veg" },
              ],
            },
            {
              name: "Savouries by the kilo",
              items: [
                { name: "Madras mixture", price: 36_000, diet: "veg" },
                { name: "Ribbon pakoda", price: 34_000, diet: "veg" },
                { name: "Kara sev", price: 32_000, diet: "veg" },
              ],
            },
          ],
          cta: { label: "Order today's fresh bakes", href: "/collections/fresh-today" },
        },
        {
          type: "flash-sale",
          id: "pr-festival",
          title: "Deepavali box counter",
          text: "Sweet boxes and hampers at festival prices until Deepavali night. Order by 5 November for delivery on the day; your name on 25+ boxes.",
          endsAt: "2026-11-08T23:59:00+05:30",
          source: "collection",
          collectionSlug: "festival-gift-boxes",
          layout: "grid",
          limit: 4,
          cta: { label: "All gift boxes", href: "/collections/festival-gift-boxes" },
        },
        {
          type: "finder",
          id: "pr-cake-finder",
          title: "Order a cake in three taps",
          text: "The occasion, the size, egg or eggless: we show the cakes that fit. ½ kg and 1 kg are ready in 4 hours.",
          layout: "wizard",
          results: "inline",
          limit: 6,
          imageUrl: photo(3983578, "tile"),
          cta: { label: "A photo or theme cake? WhatsApp us", href: waLink(CAKE_ORDER_TEXT) },
          questions: [
            {
              label: "What's the occasion?",
              options: [
                { label: "Birthday", tag: "birthday" },
                { label: "Anniversary", tag: "anniversary" },
                { label: "Kids' party", tag: "kids-party" },
                { label: "Office party", tag: "office-party" },
                { label: "Christmas & New Year", tag: "christmas" },
              ],
            },
            {
              label: "How many people?",
              options: [size("6–8 people (½ kg)", "½ kg"), size("12–15 people (1 kg)", "1 kg"), size("25–30 people (2 kg)", "2 kg")],
            },
            {
              label: "Egg or eggless?",
              options: [
                { label: "Eggless", categoryId: cakes, filterName: "Type", filterValue: "Eggless" },
                { label: "With egg", categoryId: cakes, filterName: "Type", filterValue: "With egg" },
              ],
            },
          ],
        },
        { type: "categories", id: "pr-counters", title: "Our counters", categoryIds: cats, layout: "banner-row", showCounts: false },
        {
          type: "product-tabs",
          id: "pr-best",
          title: "Tirunelveli's favourites",
          layout: "carousel",
          limit: 8,
          tabs: [
            { label: "Best sellers", source: "bestsellers" },
            { label: "Eggless", source: "collection", collectionSlug: "eggless" },
            { label: "On offer", source: "sale" },
          ],
        },
        {
          type: "testimonials",
          id: "pr-testimonials",
          title: "Sweet words from Nellai",
          layout: "single",
          style: { span: "half" },
          items: [
            { quote: "The halwa is exactly how my grandmother bought it near the temple: hot, glossy and dripping ghee. We send boxes to our son in Chennai every month.", name: "Lakshmi Narayanan", role: "Palayamkottai", rating: 5 },
            { quote: "Ordered an eggless red velvet at 1 pm for a surprise at 6. It came at 5:45 with the message spelt right. The children finished it in ten minutes.", name: "Fathima", role: "Mother of two, Melapalayam", rating: 5 },
            { quote: "120 Deepavali boxes with our company sticker, delivered to the office on the day. Every box was neat and the kaju katli was fresh.", name: "Ramesh Kumar", role: "Office manager, Vannarpettai", rating: 5 },
          ],
        },
        {
          type: "offer",
          id: "pr-offer",
          eyebrow: "Deepavali offer",
          heading: "10% off orders above ₹1,500",
          text: "Sweet boxes, hampers, savouries and cakes. Use the code at checkout; up to ₹300 off.",
          code: "DEEPAVALI10",
          cta: { label: "Shop gift boxes", href: "/collections/festival-gift-boxes" },
          style: { span: "half" },
        },
        { type: "faq", id: "pr-faq", title: "Before you order", items: FAQ },
        {
          type: "location",
          id: "pr-location",
          title: "Visit the sweet stall",
          address: "14, East Car Street, near Nellaiappar Temple, Tirunelveli Town 627006",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "8.7286, 77.6866",
          style: { span: "half" },
        },
        {
          type: "newsletter",
          id: "pr-newsletter",
          layout: "card",
          imageUrl: photo(12178037),
          heading: "Festival sweets, first",
          text: "A short message before every festival with the new sweets, gift boxes and the last day to order. No spam.",
          style: { span: "half" },
        },
      ],
      translations: {
        ta: {
          "pr-hero": {
            slides: [
              {
                heading: "சுத்தமான நெய்யில், திருநெல்வேலி பாணியில் இனிப்புகள்",
                subheading: "மாலை 4 மணி முதல் சூடான கோதுமை அல்வா; நெல்லையப்பர் கோயில் அருகில் தினமும் காலையில் செய்யும் நெய் மைசூர் பாக், லட்டு.",
                cta: { label: "தீபாவளி பெட்டிகள்" },
              },
              {
                heading: "கொண்டாட்ட கேக்குகள், முட்டையில்லாமலும்",
                subheading: "4 மணி நேரம் முன்பு ஆர்டர் செய்யுங்கள். கேக்கில் உங்கள் வாழ்த்து, நீங்கள் சொல்லும் நேரத்தில் டெலிவரி.",
                cta: { label: "கேக் ஆர்டர் செய்" },
              },
              {
                heading: "ஒவ்வொரு பண்டிகைக்கும் பரிசுப் பெட்டிகள்",
                subheading: "கலவை இனிப்புகள், உலர் பழப் பெட்டிகள், ஹேம்பர்கள். 25+ பெட்டிகளில் உங்கள் பெயர்.",
                cta: { label: "பரிசுப் பெட்டிகளைப் பாருங்கள்" },
              },
            ],
          },
          "pr-today": {
            title: "இன்று கவுண்டரில்",
            groups: [
              {
                name: "அடுப்பிலிருந்து சூடாக",
                items: [
                  dish("வெஜ் பஃப்", "காலை 11, மாலை 4 மணி"),
                  dish("முட்டை பஃப்", "காலை 11, மாலை 4 மணி"),
                  dish("ஹனி கேக் துண்டு", "தேங்காய், ஜாமுடன்"),
                  dish("எள் இனிப்பு பன்"),
                ],
              },
              {
                name: "கிலோ கணக்கில் இனிப்புகள்",
                items: [dish("திருநெல்வேலி கோதுமை அல்வா", "மாலை 4 மணி முதல் சூடாக"), dish("நெய் மைசூர் பாக்"), dish("பூந்தி லட்டு"), dish("ஜாங்கிரி")],
              },
              { name: "கிலோ கணக்கில் காரங்கள்", items: [{ name: "மெட்ராஸ் மிக்சர்" }, { name: "ரிப்பன் பக்கோடா" }, { name: "கார சேவ்" }] },
            ],
            cta: { label: "இன்றைய புதியவற்றை ஆர்டர் செய்" },
          },
          "pr-festival": {
            title: "தீபாவளிப் பெட்டிக் கவுண்டர்",
            text: "இனிப்புப் பெட்டிகள், ஹேம்பர்கள் தீபாவளி இரவு வரை பண்டிகை விலையில். அன்றே டெலிவரிக்கு நவம்பர் 5-க்குள் ஆர்டர் செய்யுங்கள்; 25+ பெட்டிகளில் உங்கள் பெயர்.",
            cta: { label: "எல்லா பரிசுப் பெட்டிகளும்" },
          },
          "pr-cake-finder": {
            title: "மூன்று தட்டலில் கேக் ஆர்டர்",
            text: "நிகழ்ச்சி, அளவு, முட்டையா இல்லையா: பொருந்தும் கேக்குகளைக் காட்டுகிறோம். ½ கிலோ, 1 கிலோ 4 மணி நேரத்தில் தயார்.",
            cta: { label: "புகைப்பட / தீம் கேக்? வாட்ஸ்அப் செய்யுங்கள்" },
            questions: [
              {
                label: "என்ன நிகழ்ச்சி?",
                options: [{ label: "பிறந்தநாள்" }, { label: "திருமண நாள்" }, { label: "குழந்தைகள் விழா" }, { label: "அலுவலக விழா" }, { label: "கிறிஸ்துமஸ், புத்தாண்டு" }],
              },
              { label: "எத்தனை பேர்?", options: [{ label: "6–8 பேர் (½ கிலோ)" }, { label: "12–15 பேர் (1 கிலோ)" }, { label: "25–30 பேர் (2 கிலோ)" }] },
              { label: "முட்டையா, முட்டையில்லாமலா?", options: [{ label: "முட்டையில்லாமல்" }, { label: "முட்டையுடன்" }] },
            ],
          },
          "pr-counters": { title: "எங்கள் கவுண்டர்கள்" },
          "pr-best": { title: "நெல்லையின் விருப்பங்கள்", tabs: [{ label: "அதிகம் விற்பவை" }, { label: "முட்டையில்லாதவை" }, { label: "சலுகையில்" }] },
          "pr-testimonials": {
            title: "நெல்லையிலிருந்து இனிய வார்த்தைகள்",
            items: [
              { quote: "என் பாட்டி கோயில் அருகில் வாங்கிய அதே அல்வா: சூடாக, பளபளப்பாக, நெய் சொட்ட. சென்னையில் இருக்கும் மகனுக்கு மாதம் தோறும் பெட்டிகள் அனுப்புகிறோம்.", role: "பாளையங்கோட்டை" },
              { quote: "மாலை 6 மணி சர்ப்ரைஸுக்கு மதியம் 1 மணிக்கு முட்டையில்லா ரெட் வெல்வெட் ஆர்டர் செய்தேன். 5:45-க்கு சரியான வாழ்த்து எழுத்துடன் வந்தது. குழந்தைகள் பத்து நிமிடத்தில் முடித்துவிட்டார்கள்.", role: "இரண்டு குழந்தைகளின் தாய், மேலப்பாளையம்" },
              { quote: "எங்கள் நிறுவன ஸ்டிக்கருடன் 120 தீபாவளிப் பெட்டிகள், அன்றே அலுவலகத்துக்கு வந்தன. ஒவ்வொரு பெட்டியும் நேர்த்தி, காஜு கத்லி புதிது.", role: "அலுவலக மேலாளர், வண்ணார்பேட்டை" },
            ],
          },
          "pr-offer": {
            eyebrow: "தீபாவளி சலுகை",
            heading: "₹1,500-க்கு மேல் ஆர்டர்களுக்கு 10% தள்ளுபடி",
            text: "இனிப்புப் பெட்டிகள், ஹேம்பர்கள், காரங்கள், கேக்குகள். செக்அவுட்டில் கோடைப் பயன்படுத்துங்கள்; ₹300 வரை.",
            cta: { label: "பரிசுப் பெட்டிகள்" },
          },
          "pr-faq": { title: "ஆர்டர் செய்யும் முன்", items: FAQ_TA },
          "pr-location": {
            title: "இனிப்புக் கடைக்கு வாருங்கள்",
            address: "14, கீழ ரத வீதி, நெல்லையப்பர் கோயில் அருகில், திருநெல்வேலி டவுன் 627006",
            hours: [
              { label: "தினமும்", value: "காலை 7:00 – இரவு 10:00" },
              { label: "சூடான அல்வா", value: "மாலை 4:00 முதல்" },
            ],
          },
          "pr-newsletter": {
            heading: "பண்டிகை இனிப்புகள், முதலில் உங்களுக்கு",
            text: "ஒவ்வொரு பண்டிகைக்கும் முன்பு புதிய இனிப்புகள், பரிசுப் பெட்டிகள், ஆர்டர் செய்ய கடைசி நாள் பற்றி ஒரு சிறு செய்தி. ஸ்பேம் இல்லை.",
          },
        },
      },
    };
  },
  pages: [
    {
      slug: "custom-cakes",
      title: "Custom cakes",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Order a custom cake" },
        {
          type: "paragraph",
          markdown:
            "1. **Tell us the day and time**, the weight (½ kg serves 6–8) and the flavour: black forest, chocolate truffle, red velvet, strawberry, butterscotch or ask us.\n2. **Egg or eggless?** Every cake can be eggless (₹50 more per ½ kg), made on a separate bench.\n3. **The message and the look:** send a picture if you have one. Photo prints on the cake cost ₹150.\n4. **Pay an advance** by UPI and we confirm. Pick it up or we deliver at your time in Tirunelveli.\n\n| Cake | Order ahead |\n|---|---|\n| ½ kg and 1 kg | 4 hours (in shop hours) |\n| 2 kg, photo and theme cakes | 24 hours |\n| Tiered and wedding cakes | 3 days |",
        },
        { type: "button", label: "Order on WhatsApp", href: waLink(CAKE_ORDER_TEXT), style: "primary" },
        { type: "image", url: photo(28983225, "tile"), alt: "Heart-shaped celebration cake with cherries" },
        { type: "faq", items: FAQ.slice(0, 3) },
      ],
    },
    {
      slug: "about",
      title: "About us",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Porunai Sweets & Bakery, since 1979" },
        {
          type: "paragraph",
          markdown:
            "We started as a halwa counter on **East Car Street, Tirunelveli**, a few steps from the Nellaiappar temple, stirring wheat halwa over a wood fire every afternoon. The halwa still comes off the same kind of fire at 4 pm.\n\nToday the family runs a full sweet stall and bakery: ghee sweets, savouries by the kilo, bread baked at 5 am, cookies and celebration cakes, eggless whenever you want. Named after the Porunai, the old name of our Thamirabarani river.",
        },
        { type: "image", url: photo(38524183, "tile"), alt: "Sweet shop display of laddus and burfis" },
        { type: "paragraph", markdown: "Open every day, 7:00 am – 10:00 pm. Call or WhatsApp **+91 98765 00014**." },
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
      { label: "Custom cakes", type: "page", ref: "custom-cakes" },
      { label: "Gift boxes", type: "collection", ref: "festival-gift-boxes" },
      { label: "Eggless", type: "collection", ref: "eggless" },
      { label: "Offers", type: "collection", ref: "on-offer" },
      { label: "About", type: "page", ref: "about" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Track your order", type: "url", href: "/track" },
          { label: "Call the shop", type: "url", href: `tel:${PHONE}` },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "Custom cakes", type: "page", ref: "custom-cakes" },
          { label: "Festival gift boxes", type: "collection", ref: "festival-gift-boxes" },
          { label: "About us", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
