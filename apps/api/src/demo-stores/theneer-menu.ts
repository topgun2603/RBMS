import type { DemoProduct } from "./types";

/**
 * The menu of store #19, Theneer Kadai (theneer.ts), as plain data shared by the demo store and by the history
 * simulator's `tea_stall` profile (demo-history/profile-tea-stall.ts), so the shop's sales use the items its online
 * store shows. Prices are rupees, GST included (served drinks and snacks: restaurant service, 5% without input tax
 * credit; the counter's packed bakery goods, heading 1905: 5%). Every sized item has two sizes, Small and Large (a cup
 * of 100 ml / 200 ml, a glass of 250 ml / 400 ml, one piece / a plate), so the home's finder can filter on the size.
 */

/** [size, price, MRP]; a dish with one row has no size option. */
type Row = [string, number, number];

export interface Dish {
  name: string;
  category: string;
  /** Tamil Nadu counters: veg unless marked. */
  egg?: boolean;
  photo: number;
  description: string;
  rows: Row[];
  sku: string;
  tags: string[];
  unit: "cup" | "glass" | "plate" | "pcs" | "pack" | "flask";
  /** Name of the option the rows are values of (default "Size"). */
  option?: string;
  /** Relative sales popularity at the counter (1 to 10), for the history simulator. */
  pop: number;
  /** Heading: restaurant service 996331 for served items, 1905 (bakery) for packed goods. */
  hsn?: string;
}

export const CAT = {
  tea: "Tea & coffee",
  milk: "Milk & malt",
  juice: "Fresh juices",
  shakes: "Milkshakes",
  cool: "Cool drinks & sarbath",
  snacks: "Snacks",
  bakery: "Bakery bites",
  combos: "Combos",
} as const;

export const GST_RATE = 5;
export const SERVICE_HSN = "996331";
export const BAKERY_HSN = "190590";

const S = "Small";
const L = "Large";

export const DISHES: Dish[] = [
  // ---- Tea & coffee (hot)
  { name: "Tea", category: CAT.tea, unit: "cup", pop: 10, sku: "TEA", photo: 13377433, tags: ["hot", "sweet", "morning", "bestseller", "veg"], description: "The kadai's everyday tea: strong dust tea boiled with fresh milk and sugar, strained into a glass. Small is a 100 ml cup, Large is 200 ml. Say 'sugar kammi' for less sugar.", rows: [[S, 12, 12], [L, 20, 20]] },
  { name: "Masala tea", category: CAT.tea, unit: "cup", pop: 8, sku: "MST", photo: 18030044, tags: ["hot", "spicy", "morning", "bestseller", "veg"], description: "Tea boiled with crushed cardamom, a little clove and dry ginger. The one the morning queue asks for. Small is 100 ml, Large is 200 ml.", rows: [[S, 15, 15], [L, 25, 25]] },
  { name: "Ginger tea", category: CAT.tea, unit: "cup", pop: 5, sku: "GNT", photo: 20270270, tags: ["hot", "spicy", "monsoon", "veg"], description: "Fresh ginger crushed into the boil, sharp and warming. A favourite when it rains on Sannidhi Street. Small is 100 ml, Large is 200 ml.", rows: [[S, 15, 15], [L, 25, 25]] },
  { name: "Lemon tea", category: CAT.tea, unit: "cup", pop: 3, sku: "LMT", photo: 31141291, tags: ["hot", "sweet", "veg"], description: "Black tea with sugar and a squeeze of lemon, no milk. Light on a heavy stomach. Small is 100 ml, Large is 200 ml.", rows: [[S, 15, 15], [L, 25, 25]] },
  { name: "Filter coffee", category: CAT.tea, unit: "cup", pop: 9, sku: "FLC", photo: 18336646, tags: ["hot", "sweet", "morning", "bestseller", "veg"], description: "Degree coffee: fresh decoction dripped through a brass filter, mixed with thick boiled milk and served in a steel tumbler and davara. Small is 100 ml, Large is 200 ml.", rows: [[S, 20, 20], [L, 30, 30]] },
  { name: "Sukku malli coffee", category: CAT.tea, unit: "cup", pop: 3, sku: "SMC", photo: 16128085, tags: ["hot", "spicy", "monsoon", "veg"], description: "The cold-weather cup: dry ginger (sukku) and coriander seed (malli) boiled with palm jaggery and a little coffee, no milk. Small is 100 ml, Large is 200 ml.", rows: [[S, 20, 20], [L, 30, 30]] },
  { name: "Karupatti coffee", category: CAT.tea, unit: "cup", pop: 3, sku: "KPC", photo: 6307233, tags: ["hot", "sweet", "veg"], description: "Filter decoction sweetened with karupatti (palm jaggery) instead of sugar, with a little milk. Deep and not too sweet. Small is 100 ml, Large is 200 ml.", rows: [[S, 25, 25], [L, 35, 35]] },

  // ---- Milk & malt
  { name: "Malt drink, hot", category: CAT.milk, unit: "cup", pop: 4, sku: "MLH", photo: 26755317, tags: ["hot", "sweet", "kids", "veg"], description: "Hot milk stirred with a spoon of chocolate malt powder, a school-day favourite. Small is 150 ml, Large is 250 ml.", rows: [[S, 25, 25], [L, 40, 40]] },
  { name: "Malt drink, cold", category: CAT.milk, unit: "glass", pop: 3, sku: "MLC", photo: 18142621, tags: ["cold", "sweet", "kids", "veg"], description: "Chilled milk blended with chocolate malt and a few ice cubes. Small is 250 ml, Large is 400 ml.", rows: [[S, 30, 30], [L, 50, 50]] },
  { name: "Hot milk", category: CAT.milk, unit: "cup", pop: 2, sku: "HML", photo: 11588452, tags: ["hot", "sweet", "veg"], description: "Plain boiled milk, lightly sweet, with a pinch of cardamom on request. Small is 150 ml, Large is 250 ml.", rows: [[S, 15, 15], [L, 25, 25]] },
  { name: "Badam milk", category: CAT.milk, unit: "glass", pop: 3, sku: "BDM", photo: 17272971, tags: ["hot", "cold", "sweet", "veg"], description: "Milk simmered with ground almonds, saffron and sugar, served hot or chilled. Small is 150 ml, Large is 250 ml.", rows: [[S, 25, 25], [L, 40, 40]] },
  { name: "Turmeric milk", category: CAT.milk, unit: "cup", pop: 2, sku: "TUM", photo: 15082978, tags: ["hot", "spicy", "monsoon", "veg"], description: "Manjal paal: hot milk with turmeric, pepper and a little palm jaggery. A cold-night cup. Small is 150 ml, Large is 250 ml.", rows: [[S, 25, 25], [L, 35, 35]] },

  // ---- Fresh juices (cut and pressed when you order)
  { name: "Orange juice", category: CAT.juice, unit: "glass", pop: 5, sku: "ORJ", photo: 5511227, tags: ["cold", "sweet", "juice", "todays-juice", "bestseller", "veg"], description: "Oranges peeled and pressed to order, no water, no added sugar. Small is 250 ml, Large is 400 ml.", rows: [[S, 40, 40], [L, 70, 70]] },
  { name: "Mosambi juice", category: CAT.juice, unit: "glass", pop: 5, sku: "MSJ", photo: 30900665, tags: ["cold", "sweet", "juice", "todays-juice", "veg"], description: "Sweet lime pressed fresh with a pinch of salt on request. The Mylapore afternoon glass. Small is 250 ml, Large is 400 ml.", rows: [[S, 40, 40], [L, 70, 70]] },
  { name: "Watermelon juice", category: CAT.juice, unit: "glass", pop: 6, sku: "WMJ", photo: 11009208, tags: ["cold", "sweet", "juice", "todays-juice", "summer", "veg"], description: "Chilled watermelon blended with ice and a squeeze of lime; no sugar needed. Small is 250 ml, Large is 400 ml.", rows: [[S, 30, 30], [L, 50, 50]] },
  { name: "Sugarcane juice", category: CAT.juice, unit: "glass", pop: 4, sku: "SCJ", photo: 35020135, tags: ["cold", "sweet", "juice", "summer", "veg"], description: "Cane pressed in front of you with ginger and a slice of lemon. Small is 250 ml, Large is 400 ml.", rows: [[S, 25, 25], [L, 40, 40]] },
  { name: "Pomegranate juice", category: CAT.juice, unit: "glass", pop: 2, sku: "PGJ", photo: 18142601, tags: ["cold", "sweet", "juice", "veg"], description: "Ruby pomegranate seeds pressed and strained, no sugar. Small is 250 ml, Large is 400 ml.", rows: [[S, 60, 60], [L, 100, 100]] },
  { name: "Pineapple juice", category: CAT.juice, unit: "glass", pop: 3, sku: "PAJ", photo: 8215113, tags: ["cold", "sweet", "juice", "todays-juice", "veg"], description: "Ripe pineapple blended and strained, with a pinch of rock salt. Small is 250 ml, Large is 400 ml.", rows: [[S, 40, 40], [L, 70, 70]] },
  { name: "Mixed fruit juice", category: CAT.juice, unit: "glass", pop: 3, sku: "MFJ", photo: 11009205, tags: ["cold", "sweet", "juice", "veg"], description: "Whatever is ripest on the counter that day, usually apple, papaya, grapes and banana, blended with a little milk. Small is 250 ml, Large is 400 ml.", rows: [[S, 50, 50], [L, 80, 80]] },
  { name: "Mango juice (seasonal)", category: CAT.juice, unit: "glass", pop: 3, sku: "MGJ", photo: 5817621, tags: ["cold", "sweet", "juice", "seasonal", "summer", "veg"], description: "Only in the mango season (April to June): ripe Banganapalli pulp, milk-free, with a little sugar. Small is 250 ml, Large is 400 ml.", rows: [[S, 50, 50], [L, 90, 90]] },

  // ---- Milkshakes
  { name: "Banana milkshake", category: CAT.shakes, unit: "glass", pop: 3, sku: "BMS", photo: 31490093, tags: ["cold", "sweet", "kids", "veg"], description: "Ripe poovan banana blended with chilled milk and a spoon of honey. Small is 250 ml, Large is 400 ml.", rows: [[S, 40, 40], [L, 70, 70]] },
  { name: "Chocolate milkshake", category: CAT.shakes, unit: "glass", pop: 3, sku: "CMS", photo: 17429505, tags: ["cold", "sweet", "kids", "veg"], description: "Chilled milk, chocolate syrup and a scoop of ice cream, blended thick. Small is 250 ml, Large is 400 ml.", rows: [[S, 50, 50], [L, 80, 80]] },
  { name: "Dates milkshake", category: CAT.shakes, unit: "glass", pop: 2, sku: "DMS", photo: 28162736, tags: ["cold", "sweet", "veg"], description: "Soaked dates and cashew blended with cold milk, naturally sweet. Small is 250 ml, Large is 400 ml.", rows: [[S, 50, 50], [L, 80, 80]] },
  { name: "Mango milkshake", category: CAT.shakes, unit: "glass", pop: 3, sku: "MMS", photo: 8211179, tags: ["cold", "sweet", "summer", "veg"], description: "Mango pulp, chilled milk and ice cream. Small is 250 ml, Large is 400 ml.", rows: [[S, 50, 50], [L, 90, 90]] },

  // ---- Cool drinks and sarbath
  { name: "Jigarthanda", category: CAT.cool, unit: "glass", pop: 5, sku: "JGT", photo: 18646641, tags: ["cold", "sweet", "bestseller", "veg"], description: "Madurai's cooler: milk reduced thick, almond gum (badam pisin), nannari syrup and a scoop of ice cream. Small is 250 ml, Large is 400 ml.", rows: [[S, 50, 50], [L, 80, 80]] },
  { name: "Rose milk", category: CAT.cool, unit: "glass", pop: 4, sku: "RSM", photo: 31540470, tags: ["cold", "sweet", "kids", "veg"], description: "Chilled milk with rose syrup and sabja seeds. Small is 250 ml, Large is 400 ml.", rows: [[S, 30, 30], [L, 50, 50]] },
  { name: "Nannari sarbath", category: CAT.cool, unit: "glass", pop: 4, sku: "NNS", photo: 10323614, tags: ["cold", "sweet", "summer", "veg"], description: "Nannari (Indian sarsaparilla) root syrup with lemon, sabja seeds and crushed ice, the Tamil summer drink. Small is 250 ml, Large is 400 ml.", rows: [[S, 20, 20], [L, 35, 35]] },
  { name: "Sweet lassi", category: CAT.cool, unit: "glass", pop: 3, sku: "SLS", photo: 18142603, tags: ["cold", "sweet", "veg"], description: "Thick curd whisked with sugar and cardamom, finished with a few nuts. Small is 250 ml, Large is 400 ml.", rows: [[S, 30, 30], [L, 50, 50]] },
  { name: "Buttermilk", category: CAT.cool, unit: "glass", pop: 5, sku: "BTM", photo: 4324320, tags: ["cold", "spicy", "veg"], description: "Neer mor: curd thinned with water, ginger, green chilli, curry leaf and salt. Small is 250 ml, Large is 400 ml.", rows: [[S, 15, 15], [L, 25, 25]] },
  { name: "Fresh lime soda", category: CAT.cool, unit: "glass", pop: 4, sku: "FLS", photo: 4045205, tags: ["cold", "sweet", "summer", "veg"], description: "Lime, soda and ice, sweet or salt: tell us when you order. Small is 250 ml, Large is 400 ml.", rows: [[S, 25, 25], [L, 40, 40]] },

  // ---- Snacks (fried fresh through the day)
  { name: "Medu vada", category: CAT.snacks, unit: "pcs", pop: 8, sku: "MVD", photo: 21751212, tags: ["hot", "spicy", "morning", "bestseller", "veg"], description: "Crisp outside, soft inside, with onion, curry leaf and pepper. Small is one vada, Large is two with coconut chutney.", rows: [[S, 10, 10], [L, 18, 18]] },
  { name: "Onion bajji", category: CAT.snacks, unit: "plate", pop: 6, sku: "ONB", photo: 29547418, tags: ["hot", "spicy", "evening", "veg"], description: "Onion rings in spiced gram-flour batter, fried to order. Small is 3 pieces, Large is 6 with chutney.", rows: [[S, 20, 20], [L, 35, 35]] },
  { name: "Banana bajji", category: CAT.snacks, unit: "plate", pop: 4, sku: "BNB", photo: 20220705, tags: ["hot", "spicy", "evening", "veg"], description: "Raw banana (vazhakkai) slices in a chilli-gram-flour batter. Small is 3 pieces, Large is 6 with chutney.", rows: [[S, 20, 20], [L, 35, 35]] },
  { name: "Potato bonda", category: CAT.snacks, unit: "pcs", pop: 5, sku: "PTB", photo: 36739323, tags: ["hot", "spicy", "evening", "veg"], description: "Spiced mashed potato in a gram-flour coat, fried golden. Small is one bonda, Large is two.", rows: [[S, 12, 12], [L, 22, 22]] },
  { name: "Samosa", category: CAT.snacks, unit: "pcs", pop: 6, sku: "SMS", photo: 9027521, tags: ["hot", "spicy", "evening", "veg"], description: "Crisp pastry triangles with spiced potato and peas, with mint chutney. Small is one samosa, Large is two.", rows: [[S, 12, 12], [L, 22, 22]] },
  { name: "Sundal", category: CAT.snacks, unit: "plate", pop: 3, sku: "SDL", photo: 23384616, tags: ["hot", "spicy", "evening", "veg"], description: "Boiled chickpeas tempered with mustard, curry leaf, green chilli and fresh coconut. Small is a cup, Large is a plate.", rows: [[S, 20, 20], [L, 35, 35]] },
  { name: "Bread omelette", category: CAT.snacks, unit: "plate", pop: 3, sku: "BRO", photo: 27396343, tags: ["hot", "spicy", "morning", "egg"], egg: true, description: "A masala omelette (onion, chilli, coriander) folded over toasted bread. Small is one egg, Large is two.", rows: [[S, 30, 30], [L, 50, 50]] },

  // ---- Bakery bites (packed, bought at the counter)
  { name: "Butter bun", category: CAT.bakery, unit: "pcs", pop: 5, sku: "BTB", photo: 28219383, tags: ["veg", "morning", "bakery"], hsn: BAKERY_HSN, description: "Soft bakery bun with a butter slit, best dunked in tea.", rows: [["Single", 15, 15]] },
  { name: "Cream roll", category: CAT.bakery, unit: "pcs", pop: 3, sku: "CRR", photo: 10298082, tags: ["veg", "bakery", "kids"], hsn: BAKERY_HSN, description: "A crisp roll with sweet vanilla cream inside.", rows: [["Single", 20, 20]] },
  { name: "Veg puff", category: CAT.bakery, unit: "pcs", pop: 4, sku: "VPF", photo: 1346216, tags: ["veg", "bakery", "evening"], hsn: BAKERY_HSN, description: "Flaky puff pastry with a spiced vegetable filling, warmed on order.", rows: [["Single", 20, 20]] },
  { name: "Egg puff", category: CAT.bakery, unit: "pcs", pop: 3, sku: "EPF", photo: 14886371, tags: ["egg", "bakery", "evening"], egg: true, hsn: BAKERY_HSN, description: "Flaky puff pastry with half a boiled egg in onion masala, warmed on order.", rows: [["Single", 25, 25]] },
  { name: "Rusk (10 pcs)", category: CAT.bakery, unit: "pack", pop: 3, sku: "RSK", photo: 18724102, tags: ["veg", "bakery", "morning"], hsn: BAKERY_HSN, description: "Crunchy tea rusk, a pack of ten, for dunking.", rows: [["Pack", 30, 35]] },
  { name: "Marie biscuits", category: CAT.bakery, unit: "pack", pop: 3, sku: "MBS", photo: 31909870, tags: ["veg", "bakery", "morning"], hsn: BAKERY_HSN, description: "A small pack of plain Marie biscuits, the classic tea partner.", rows: [["Pack", 10, 10]] },
  { name: "Butter biscuits", category: CAT.bakery, unit: "pack", pop: 2, sku: "BBS", photo: 15290322, tags: ["veg", "bakery", "kids"], hsn: BAKERY_HSN, description: "A small pack of buttery square biscuits, crisp and not too sweet.", rows: [["Pack", 20, 20]] },

  // ---- Combos (the 4 to 6 pm window and office supply)
  { name: "Tea and vada", category: CAT.combos, unit: "plate", pop: 6, sku: "TVD", photo: 19664357, tags: ["combo", "evening", "morning", "bestseller", "veg"], description: "A small tea (100 ml) with a hot medu vada and chutney. The kadai's oldest pairing, for a few rupees less than buying each.", rows: [["Combo", 22, 25]] },
  { name: "Evening snack combo", category: CAT.combos, unit: "plate", pop: 5, sku: "ESC", photo: 13220364, tags: ["combo", "evening", "veg"], description: "A large masala tea (200 ml) with a plate of three onion bajji and chutney, served 4 to 6 pm.", rows: [["Combo", 45, 55]] },
  { name: "Coffee and bonda", category: CAT.combos, unit: "plate", pop: 3, sku: "CBD", photo: 16128085, tags: ["combo", "evening", "veg"], description: "A small filter coffee (100 ml) with a hot potato bonda and chutney.", rows: [["Combo", 28, 32]] },
  { name: "Tea flask for the office", category: CAT.combos, unit: "flask", pop: 3, sku: "TFL", photo: 12865880, tags: ["combo", "office", "veg"], option: "Flask", description: "Hot tea or filter coffee in a steel flask with paper cups, delivered within 1 km of Sannidhi Street. 1 litre pours about 8 cups, 2 litres about 16. Monthly office tea cards: see the home page.", rows: [["1 litre", 110, 110], ["2 litre", 200, 200]] },
];

export function menuProducts(): DemoProduct[] {
  return DISHES.map((d): DemoProduct => {
    const optionName = d.option ?? "Size";
    const options = d.rows.length > 1 ? [{ name: optionName, values: d.rows.map((r) => r[0]) }] : undefined;
    return {
      name: d.name,
      category: d.category,
      hsn: d.hsn ?? SERVICE_HSN,
      gstRate: GST_RATE,
      unit: d.unit,
      description: d.description,
      attributes: { Diet: d.egg ? "Egg" : "Veg", "Hot / cold": d.tags.includes("hot") && d.tags.includes("cold") ? "Hot or cold" : d.tags.includes("hot") ? "Hot" : d.tags.includes("cold") ? "Cold" : "Counter" },
      tags: d.tags,
      sku: d.sku,
      photo: d.photo,
      ...(options ? { options } : {}),
      variants: d.rows.map(([size, price, mrp]) => ({ ...(options ? { values: { [optionName]: size } } : {}), price: Math.round(price * 100), mrp: Math.round(mrp * 100), stock: 500 })),
      costShare: 0.45,
    };
  });
}
