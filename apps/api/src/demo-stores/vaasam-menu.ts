import type { DemoProduct } from "./types";

/**
 * The menu of store #18, Vaasam Biryani Kitchen (vaasam.ts), as plain data shared by the demo store and by the history
 * simulator's `cloud_kitchen` profile (demo-history/profile-cloud-kitchen.ts), so the shop's sales use its real dishes.
 * Prices are rupees, GST included (restaurant service, SAC 996331, 5% without input tax credit).
 */

export type Station = "kitchen" | "biryani" | "beverages";
/** [portion, price, MRP]; a dish with one row has no portion option. */
type Row = [string, number, number];

export interface Dish {
  name: string;
  category: string;
  veg: boolean;
  /** Egg dishes are marked "egg" on the menu board (vegetarian-with-egg). */
  egg?: boolean;
  station: Station;
  photo: number;
  description: string;
  rows: Row[];
  sku: string;
  tags?: string[];
  spice?: string;
}

export const CAT = {
  combos: "Combos",
  biryani: "Biryani",
  meals: "Meals",
  gravies: "Parotta & Gravies",
  snacks: "Snacks",
  desserts: "Desserts",
  beverages: "Beverages",
  party: "Party Orders",
  addons: "Add-ons",
} as const;

export const DISHES: Dish[] = [
  // ---- Biryani: single (1 person), combo (with a side and raita) and family (serves 4)
  { name: "Dindigul Chicken Biryani", category: CAT.biryani, veg: false, station: "biryani", photo: 12392831, sku: "DCB", spice: "Medium", tags: ["bestseller", "biryani", "lunch-rush"], description: "Seeraga samba rice dum-cooked with country chicken pieces, whole pepper, mint and a squeeze of lemon, Dindigul style. Single serves 1; Combo adds chicken 65 and raita; Family serves 4.", rows: [["Single", 199, 219], ["Combo", 259, 289], ["Family", 749, 829]] },
  { name: "Ambur Mutton Biryani", category: CAT.biryani, veg: false, station: "biryani", photo: 9609863, sku: "AMB", spice: "Medium", tags: ["bestseller", "biryani", "lunch-rush"], description: "Short-grain rice cooked with tender mutton on the bone, Ambur style: a light red-chilli masala, curd and dried lime. Served with brinjal gravy and onion raita.", rows: [["Single", 299, 329], ["Combo", 369, 399], ["Family", 1149, 1249]] },
  { name: "Chicken Leg Piece Biryani", category: CAT.biryani, veg: false, station: "biryani", photo: 14731639, sku: "CLB", spice: "Medium", tags: ["biryani"], description: "Our seeraga samba biryani topped with a whole fried chicken leg piece. Single has one leg; Family has four.", rows: [["Single", 239, 259], ["Combo", 289, 319], ["Family", 899, 979]] },
  { name: "Chicken 65 Biryani", category: CAT.biryani, veg: false, station: "biryani", photo: 39536491, sku: "C65B", spice: "Hot", tags: ["biryani", "spicy"], description: "Biryani rice layered with crisp curry-leaf chicken 65 and finished with lemon and fried onions. The spicy one.", rows: [["Single", 229, 249], ["Combo", 279, 309], ["Family", 849, 929]] },
  { name: "Egg Biryani", category: CAT.biryani, veg: true, egg: true, station: "biryani", photo: 9609854, sku: "EGB", spice: "Mild", tags: ["biryani", "lunch-rush"], description: "Fragrant biryani rice with masala-coated boiled eggs, mint and fried onions. Single has two eggs; Family has eight.", rows: [["Single", 149, 169], ["Combo", 199, 219], ["Family", 569, 629]] },
  { name: "Veg Dum Biryani", category: CAT.biryani, veg: true, station: "biryani", photo: 9609848, sku: "VDB", spice: "Mild", tags: ["biryani", "lunch-rush"], description: "Carrot, beans, peas and cauliflower dum-cooked with seeraga samba rice, mint and saffron milk. Served with onion raita.", rows: [["Single", 139, 159], ["Combo", 179, 199], ["Family", 519, 569]] },
  { name: "Paneer Biryani", category: CAT.biryani, veg: true, station: "biryani", photo: 9609859, sku: "PNB", spice: "Medium", tags: ["biryani"], description: "Golden paneer cubes marinated in curd and spices, layered with long-grain rice and fried onions.", rows: [["Single", 169, 189], ["Combo", 219, 239], ["Family", 639, 699]] },

  // ---- Combos (boxes)
  { name: "Biryani & Chicken 65 Box", category: CAT.combos, veg: false, station: "biryani", photo: 35267280, sku: "BC65", spice: "Medium", tags: ["combo", "lunch-rush", "bestseller"], description: "A compartment box with Dindigul chicken biryani, five pieces of chicken 65, onion raita, brinjal gravy and a boiled egg. Serves 1, hungry.", rows: [["Box", 249, 279]] },
  { name: "Parotta Salna Combo", category: CAT.combos, veg: false, station: "kitchen", photo: 10810650, sku: "PSC", spice: "Medium", tags: ["combo", "lunch-rush"], description: "Two layered parottas with a bowl of chicken salna, a masala omelette and sliced onion with lemon.", rows: [["Box", 179, 199]] },
  { name: "Couple Combo", category: CAT.combos, veg: false, station: "biryani", photo: 37883423, sku: "CPL", spice: "Medium", tags: ["combo", "dinner"], description: "Two chicken biryanis, a plate of chicken 65, two gulab jamun and two buttermilks. Dinner for two without the dishes.", rows: [["Box", 599, 669]] },
  { name: "Family Feast Box (serves 4)", category: CAT.combos, veg: false, station: "biryani", photo: 12737817, sku: "FFB", spice: "Medium", tags: ["combo", "family", "bestseller"], description: "Family chicken biryani, chicken 65, brinjal gravy, raita, four boiled eggs and a tin of gulab jamun. Packed hot, serves 4 comfortably.", rows: [["Box", 1299, 1449]] },

  // ---- Meals boxes
  { name: "Veg Meals Box", category: CAT.meals, veg: true, station: "kitchen", photo: 36125185, sku: "VMB", spice: "Mild", tags: ["meals", "lunch-rush"], description: "Rice, sambar, rasam, two poriyals, kootu, curd and appalam in a four-compartment box with pickle.", rows: [["Box", 139, 159]] },
  { name: "Chicken Curry Meals Box", category: CAT.meals, veg: false, station: "kitchen", photo: 9557675, sku: "CMB", spice: "Medium", tags: ["meals", "lunch-rush"], description: "Rice with Chettinad chicken curry, rasam, a poriyal, curd and appalam.", rows: [["Box", 189, 209]] },
  { name: "Fish Curry Meals Box", category: CAT.meals, veg: false, station: "kitchen", photo: 10810652, sku: "FMB", spice: "Hot", tags: ["meals", "lunch-rush"], description: "Rice with a tamarind fish kuzhambu, a fried fish piece, rasam, a poriyal and curd.", rows: [["Box", 219, 239]] },
  { name: "Mutton Kuzhambu Meals Box", category: CAT.meals, veg: false, station: "kitchen", photo: 10078270, sku: "MMB", spice: "Medium", tags: ["meals", "weekend"], description: "Rice with a slow-cooked mutton kuzhambu, rasam, a poriyal, curd and appalam.", rows: [["Box", 249, 279]] },

  // ---- Parotta and Chettinad gravies
  { name: "Parotta", category: CAT.gravies, veg: true, station: "kitchen", photo: 30323513, sku: "PRT", spice: "None", tags: ["parotta"], description: "Soft, flaky layered parotta made fresh on the tawa. Single is two pieces; Combo is four pieces with veg salna; Family is eight with salna.", rows: [["Single", 40, 45], ["Combo", 119, 129], ["Family", 229, 249]] },
  { name: "Chettinad Chicken Curry", category: CAT.gravies, veg: false, station: "kitchen", photo: 36264075, sku: "CCC", spice: "Hot", tags: ["gravy", "bestseller"], description: "Chicken in a freshly ground Chettinad masala of pepper, fennel, star anise and dry red chilli. Single is 250 ml, Family is 750 ml.", rows: [["Single", 189, 209], ["Family", 499, 549]] },
  { name: "Pepper Chicken Gravy", category: CAT.gravies, veg: false, station: "kitchen", photo: 35532821, sku: "PCG", spice: "Hot", tags: ["gravy"], description: "Boneless chicken cooked thick with coarse black pepper, shallots and curry leaves. Pairs with parotta.", rows: [["Single", 199, 219], ["Family", 529, 579]] },
  { name: "Mutton Chukka", category: CAT.gravies, veg: false, station: "kitchen", photo: 37180955, sku: "MCK", spice: "Hot", tags: ["gravy", "weekend"], description: "Mutton pieces pressure-cooked then tossed dry in pepper, fennel and coconut slivers, the Madurai way.", rows: [["Single", 289, 319], ["Family", 749, 829]] },
  { name: "Egg Masala", category: CAT.gravies, veg: true, egg: true, station: "kitchen", photo: 6113813, sku: "EMS", spice: "Medium", tags: ["gravy"], description: "Boiled eggs in an onion-tomato masala with a hint of fennel. A friendly side for parotta and rice.", rows: [["Single", 109, 119], ["Family", 289, 319]] },
  { name: "Veg Kurma", category: CAT.gravies, veg: true, station: "kitchen", photo: 9609857, sku: "VKM", spice: "Mild", tags: ["gravy"], description: "Mixed vegetables in a coconut and cashew kurma, the standard partner of parotta and idiyappam.", rows: [["Single", 99, 109], ["Family", 259, 289]] },

  // ---- Snacks
  { name: "Chicken 65", category: CAT.snacks, veg: false, station: "kitchen", photo: 17050759, sku: "C65", spice: "Hot", tags: ["snack", "bestseller", "spicy"], description: "Boneless chicken marinated overnight in ginger, garlic and red chilli, fried crisp with curry leaves. Single is 8 pieces.", rows: [["Single", 169, 189], ["Family", 449, 489]] },
  { name: "Masala Fish Fry", category: CAT.snacks, veg: false, station: "kitchen", photo: 35267272, sku: "MFF", spice: "Hot", tags: ["snack", "spicy"], description: "Fish steaks coated in a red masala and shallow-fried on the tawa. Squeeze of lemon, sliced onion.", rows: [["Plate", 229, 249]] },
  { name: "Vanjaram Fish Fry (2 slices)", category: CAT.snacks, veg: false, station: "kitchen", photo: 21926675, sku: "VFF", spice: "Medium", tags: ["snack", "weekend"], description: "Two thick slices of seer fish with a light pepper-garlic marinade, shallow-fried.", rows: [["Plate", 349, 379]] },
  { name: "Tandoori Chicken (half)", category: CAT.snacks, veg: false, station: "kitchen", photo: 9792458, sku: "TCH", spice: "Medium", tags: ["snack", "dinner"], description: "Half a chicken marinated in curd and Kashmiri chilli and roasted. Served with mint chutney and onion.", rows: [["Half", 199, 219]] },

  // ---- Desserts
  { name: "Gulab Jamun", category: CAT.desserts, veg: true, station: "kitchen", photo: 15014918, sku: "GJM", spice: "None", tags: ["dessert"], description: "Soft khoya dumplings in cardamom syrup, served warm. Single is 2 pieces, Combo is 6, Family is a tin of 12.", rows: [["Single", 49, 55], ["Combo", 129, 139], ["Family", 239, 259]] },
  { name: "Gulab Jamun with Ice Cream", category: CAT.desserts, veg: true, station: "kitchen", photo: 35017895, sku: "GJI", spice: "None", tags: ["dessert"], description: "Two warm gulab jamun with a scoop of vanilla ice cream, packed so the ice cream arrives set.", rows: [["Cup", 89, 99]] },

  // ---- Beverages
  { name: "Butter Milk", category: CAT.beverages, veg: true, station: "beverages", photo: 4324320, sku: "BTM", spice: "None", tags: ["drink"], description: "Spiced buttermilk with curry leaf, ginger and green chilli, the cooler for a hot biryani. 300 ml.", rows: [["Glass", 29, 35]] },
  { name: "Sweet Lassi", category: CAT.beverages, veg: true, station: "beverages", photo: 8917283, sku: "LSI", spice: "None", tags: ["drink"], description: "Thick curd lassi sweetened with sugar and finished with dried rose petals. 300 ml.", rows: [["Glass", 69, 79]] },
  { name: "Mango Milkshake", category: CAT.beverages, veg: true, station: "beverages", photo: 14930475, sku: "MMS", spice: "None", tags: ["drink"], description: "Ripe mango pulp blended with chilled milk. 350 ml.", rows: [["Glass", 89, 99]] },
  { name: "Mango Vanilla Shake (jar)", category: CAT.beverages, veg: true, station: "beverages", photo: 31490093, sku: "MVJ", spice: "None", tags: ["drink"], description: "Mango and vanilla shakes in a sealed jar. 400 ml.", rows: [["Jar", 99, 109]] },

  // ---- Party orders: trays, with a day's notice
  { name: "Chicken Biryani Party Tray", category: CAT.party, veg: false, station: "biryani", photo: 9609869, sku: "PCB", spice: "Medium", tags: ["party", "bulk"], description: "Dindigul chicken biryani in a sealed aluminium tray with raita and brinjal gravy. Serves 10 or 20; order a day ahead for delivery at noon or in the evening.", rows: [["Serves 10", 2499, 2799], ["Serves 20", 4799, 5399]] },
  { name: "Mutton Biryani Party Tray", category: CAT.party, veg: false, station: "biryani", photo: 14731625, sku: "PMB", spice: "Medium", tags: ["party", "bulk"], description: "Ambur mutton biryani in a sealed tray with raita and brinjal gravy. Serves 10 or 20; order a day ahead.", rows: [["Serves 10", 3999, 4399], ["Serves 20", 7699, 8499]] },
  { name: "Veg Biryani Party Tray", category: CAT.party, veg: true, station: "biryani", photo: 7593267, sku: "PVB", spice: "Mild", tags: ["party", "bulk"], description: "Veg dum biryani with raita and veg kurma, in a sealed tray. Serves 10 or 20.", rows: [["Serves 10", 1799, 1999], ["Serves 20", 3399, 3799]] },
  { name: "Chicken 65 Party Tray", category: CAT.party, veg: false, station: "kitchen", photo: 17050759, sku: "P65", spice: "Hot", tags: ["party", "bulk"], description: "Crisp chicken 65 with onion and lemon, packed in a vented tray so it stays crisp. Serves 10 or 20.", rows: [["Serves 10", 1699, 1899], ["Serves 20", 3199, 3599]] },

  // ---- Add-ons
  { name: "Boiled Egg", category: CAT.addons, veg: true, egg: true, station: "kitchen", photo: 9609854, sku: "ADE", spice: "None", tags: ["addon"], description: "One masala-dusted boiled egg to add to any biryani.", rows: [["Each", 15, 15]] },
  { name: "Onion Raita", category: CAT.addons, veg: true, station: "kitchen", photo: 12737817, sku: "ADR", spice: "None", tags: ["addon"], description: "A 100 ml tub of curd with onion, cucumber and green chilli.", rows: [["Tub", 20, 20]] },
  { name: "Brinjal Gravy (extra)", category: CAT.addons, veg: true, station: "kitchen", photo: 9609868, sku: "ADG", spice: "Medium", tags: ["addon"], description: "An extra 100 ml tub of the smoky brinjal gravy we serve with biryani.", rows: [["Tub", 35, 35]] },
];

export const rs = (rupees: number) => Math.round(rupees * 100);
/** Restaurant service (SAC 996331): 5% without input tax credit. */
export const GST_RATE = 5;

/** The catalogue products of the demo store: a dish with several portions has one "Portion" option. */
export function menuProducts(): DemoProduct[] {
  return DISHES.map((d): DemoProduct => {
    const options = d.rows.length > 1 ? [{ name: "Portion", values: d.rows.map((r) => r[0]) }] : undefined;
    return {
      name: d.name,
      category: d.category,
      hsn: "996331",
      gstRate: GST_RATE,
      unit: d.category === CAT.beverages ? "glass" : d.category === CAT.party ? "tray" : "plate",
      description: d.description,
      attributes: { Diet: d.egg ? "Egg" : d.veg ? "Veg" : "Non-veg", "Spice level": d.spice ?? "Medium" },
      tags: [d.egg ? "egg" : d.veg ? "veg" : "non-veg", ...(d.tags ?? [])],
      sku: d.sku,
      photo: d.photo,
      ...(options ? { options } : {}),
      variants: d.rows.map(([portion, price, mrp]) => ({ ...(options ? { values: { Portion: portion } } : {}), price: rs(price), mrp: rs(mrp), stock: 500 })),
      costShare: 0.38,
    };
  });
}
