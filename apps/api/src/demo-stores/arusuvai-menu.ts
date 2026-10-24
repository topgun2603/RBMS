import type { DemoProduct } from "./types";

/**
 * The menu of Arusuvai Unavagam (arusuvai.ts), as plain data shared by the demo store and by the history simulator's
 * `dine_in` profile (demo-history/profile-dine-in.ts), so the shop's bills sell the dishes its online store shows.
 * Prices are rupees per portion, GST included (restaurant service, SAC 996331, 5% without input tax credit). A dish with
 * several rows has one option (`optName`, default "Portion") whose values are the first column.
 */

export type Station = "kitchen" | "tandoor" | "beverages";
/** [option value, price]; a dish with one row has no option. */
type Row = [string, number];

export interface Dish {
  name: string;
  category: string;
  /** veg / egg / non-veg: egg dishes count as vegetarian-with-egg (a brown mark), not as veg for the KOT screen. */
  diet: "veg" | "egg" | "non-veg";
  station: Station;
  photo: number;
  description: string;
  rows: Row[];
  sku: string;
  optName?: string;
  tags?: string[];
  spice?: string;
}

export const CAT = {
  tiffin: "Tiffin",
  meals: "Meals",
  biryani: "Biryani & Rice",
  chettinad: "Parotta & Chettinad",
  tandoor: "Tandoor",
  starters: "Starters & Chaat",
  beverages: "Beverages",
  desserts: "Desserts",
  family: "Family & Party",
} as const;

/** Pexels ids of the menu pictures (credited in arusuvai.ts). */
const P = {
  idli: 4331488, vada: 20422132, pongal: 9148225, masalaDosa: 12392915, dosa: 20422121, gheeRoast: 5560763, uthappam: 17869140,
  kalDosa: 14831547, kariDosa: 8000025, miniTiffin: 14831540,
  vegMeals: 5410418, miniMeals: 14132112, thali: 35539324, chickenMeals: 9557675, muttonMeals: 10078274, fishMeals: 13243817,
  chickenBiryani: 9609840, muttonBiryani: 14731625, eggBiryani: 9609854, vegBiryani: 9609848, friedRice: 35539329,
  parotta: 9609857, kothu: 10810650, chilliParotta: 40262787, chettinadChicken: 36264075, pepperChicken: 35532821, kozhi: 37180955,
  chukka: 8408994, fishCurry: 8684075, eggMasala: 6113813,
  tandooriChicken: 9792458, tikka: 958545, paneerTikka: 8414670, fishTikka: 38220999, naan: 10337726, roti: 12737660,
  chicken65: 17050759, paneer65: 7166541, fishFry: 35267272, paniPuri: 13063304, papdiChaat: 34270742, dahiVada: 9213253,
  coffee: 16128085, tea: 31141291, jigarthanda: 2835351, roseMilk: 6705482, lime: 35020135, buttermilk: 4324320, lassi: 8917283, juice: 11009208,
  payasam: 31109623, jamun: 15014918, kesari: 33430555, halwa: 5453716, falooda: 5041474,
  familyVeg: 9266190, familyNonVeg: 12737817, tandoorPlatter: 9792458, chickenTray: 9609869, vegTray: 7593267,
};
export const MENU_PHOTO = P;

export const DISHES: Dish[] = [
  // ---- Tiffin (7 am to 11 am and 4:30 pm to 10 pm)
  { name: "Idli", category: CAT.tiffin, diet: "veg", station: "kitchen", photo: P.idli, sku: "IDL", spice: "Mild", tags: ["tiffin", "breakfast", "bestseller"], description: "Soft steamed idlis from stone-ground rice and urad, served hot with sambar and three chutneys. Ask for ghee podi on top.", rows: [["2 pcs", 45], ["4 pcs", 85]] },
  { name: "Medu Vada", category: CAT.tiffin, diet: "veg", station: "kitchen", photo: P.vada, sku: "MVD", spice: "Mild", tags: ["tiffin", "breakfast"], description: "Crisp-outside, fluffy-inside urad vadas with pepper and curry leaf, served with sambar and coconut chutney.", rows: [["2 pcs", 55], ["4 pcs", 105]] },
  { name: "Ven Pongal", category: CAT.tiffin, diet: "veg", station: "kitchen", photo: P.pongal, sku: "VPG", spice: "Mild", tags: ["tiffin", "breakfast"], description: "Rice and moong dal cooked soft with ghee, pepper, cumin and cashew, with sambar and chutney.", rows: [["Plate", 80]] },
  { name: "Masala Dosa", category: CAT.tiffin, diet: "veg", station: "kitchen", photo: P.masalaDosa, sku: "MDS", spice: "Mild", tags: ["tiffin", "bestseller", "dosa"], description: "A paper-thin golden dosa folded over a spiced potato and onion masala, served with sambar and chutneys.", rows: [["Plate", 95]] },
  { name: "Dosa", category: CAT.tiffin, diet: "veg", station: "kitchen", photo: P.dosa, sku: "DOS", optName: "Type", spice: "Mild", tags: ["tiffin", "dosa"], description: "Plain, crisp rava or egg dosa straight off the tawa with sambar and chutneys. Egg dosa is made with a whole egg spread on the batter.", rows: [["Plain", 65], ["Rava", 95], ["Egg", 100]] },
  { name: "Ghee Roast", category: CAT.tiffin, diet: "veg", station: "kitchen", photo: P.gheeRoast, sku: "GRT", spice: "Mild", tags: ["tiffin", "dosa", "bestseller"], description: "A long, crisp, ghee-brushed dosa roasted deep gold, rolled and served with podi, sambar and chutneys.", rows: [["Plate", 110]] },
  { name: "Onion Uthappam", category: CAT.tiffin, diet: "veg", station: "kitchen", photo: P.uthappam, sku: "UTH", spice: "Mild", tags: ["tiffin"], description: "A thick, soft uthappam topped with chopped onion, green chilli and coriander, cooked in ghee.", rows: [["Plate", 90]] },
  { name: "Kal Dosa", category: CAT.tiffin, diet: "veg", station: "kitchen", photo: P.kalDosa, sku: "KAL", spice: "Mild", tags: ["tiffin", "madurai"], description: "Madurai's soft, spongy kal dosa, three to a plate, with kara chutney and a bowl of sambar.", rows: [["3 pcs", 80]] },
  { name: "Madurai Kari Dosa", category: CAT.tiffin, diet: "non-veg", station: "kitchen", photo: P.kariDosa, sku: "KRD", spice: "Hot", tags: ["tiffin", "madurai", "dinner", "spicy"], description: "A thick dosa topped with spiced minced mutton and a beaten egg, the way the Madurai night shops serve it, with salna.", rows: [["Plate", 190]] },
  { name: "Mini Tiffin Combo", category: CAT.tiffin, diet: "veg", station: "kitchen", photo: P.miniTiffin, sku: "MTC", spice: "Mild", tags: ["tiffin", "breakfast", "combo"], description: "Two idlis, a vada, a spoon of ven pongal and kesari with sambar and chutneys: a little of everything for one.", rows: [["Plate", 140]] },

  // ---- Meals (11:30 am to 3:30 pm)
  { name: "Unlimited Veg Meals", category: CAT.meals, diet: "veg", station: "kitchen", photo: P.vegMeals, sku: "UVM", spice: "Medium", tags: ["meals", "lunch", "bestseller"], description: "A banana-leaf meal: rice, sambar, kuzhambu, rasam, kootu, two poriyals, appalam, curd, payasam and pickle, with refills until you say stop.", rows: [["Meal", 190]] },
  { name: "Mini Meals", category: CAT.meals, diet: "veg", station: "kitchen", photo: P.miniMeals, sku: "MNM", spice: "Medium", tags: ["meals", "lunch"], description: "One round of rice with sambar, rasam, poriyal, kootu, curd and appalam, for a lighter lunch.", rows: [["Meal", 130]] },
  { name: "Arusuvai Special Thali", category: CAT.meals, diet: "veg", station: "kitchen", photo: P.thali, sku: "AST", spice: "Medium", tags: ["meals", "lunch", "dinner", "special"], description: "Six tastes on one steel plate: two kinds of rice, three curries, parotta or chapati, raita, appalam and a sweet.", rows: [["Thali", 280]] },
  { name: "Chicken Meals", category: CAT.meals, diet: "non-veg", station: "kitchen", photo: P.chickenMeals, sku: "CKM", spice: "Medium", tags: ["meals", "lunch", "bestseller"], description: "Rice with Chettinad chicken curry, rasam, a poriyal, kootu, curd and appalam on a banana leaf.", rows: [["Meal", 260]] },
  { name: "Mutton Meals", category: CAT.meals, diet: "non-veg", station: "kitchen", photo: P.muttonMeals, sku: "MUM", spice: "Medium", tags: ["meals", "lunch", "weekend"], description: "Rice with Madurai mutton kuzhambu and chukka, rasam, poriyal and curd, cooked slow on the bone.", rows: [["Meal", 340]] },
  { name: "Fish Meals", category: CAT.meals, diet: "non-veg", station: "kitchen", photo: P.fishMeals, sku: "FSM", spice: "Hot", tags: ["meals", "lunch"], description: "Rice with a tamarind fish kuzhambu and a fried fish slice, rasam, poriyal and curd.", rows: [["Meal", 300]] },

  // ---- Biryani and rice
  { name: "Chicken Biryani", category: CAT.biryani, diet: "non-veg", station: "kitchen", photo: P.chickenBiryani, sku: "CBY", spice: "Medium", tags: ["biryani", "bestseller", "dinner"], description: "Seeraga samba rice dum-cooked with country chicken, mint and whole spices, served with raita and brinjal gravy.", rows: [["Regular", 210], ["Large", 360]] },
  { name: "Mutton Biryani", category: CAT.biryani, diet: "non-veg", station: "kitchen", photo: P.muttonBiryani, sku: "MBY", spice: "Medium", tags: ["biryani", "weekend", "dinner"], description: "Tender mutton on the bone layered with seeraga samba rice and sealed to dum for an hour. Raita and gravy on the side.", rows: [["Regular", 290], ["Large", 520]] },
  { name: "Egg Biryani", category: CAT.biryani, diet: "egg", station: "kitchen", photo: P.eggBiryani, sku: "EBY", spice: "Mild", tags: ["biryani"], description: "Masala-coated boiled eggs in fragrant biryani rice with mint and fried onion. Regular has two eggs, Large has four.", rows: [["Regular", 160], ["Large", 280]] },
  { name: "Veg Biryani", category: CAT.biryani, diet: "veg", station: "kitchen", photo: P.vegBiryani, sku: "VBY", spice: "Mild", tags: ["biryani"], description: "Carrot, beans, peas and cauliflower dum-cooked with seeraga samba rice and served with onion raita.", rows: [["Regular", 150], ["Large", 260]] },
  { name: "Fried Rice", category: CAT.biryani, diet: "veg", station: "kitchen", photo: P.friedRice, sku: "FRC", optName: "Type", spice: "Medium", tags: ["rice"], description: "Wok-tossed rice with spring onion, pepper and soy. The egg and chicken versions have shredded egg or chicken through the rice.", rows: [["Veg", 140], ["Egg", 160], ["Chicken", 180]] },

  // ---- Parotta and Chettinad
  { name: "Parotta", category: CAT.chettinad, diet: "veg", station: "kitchen", photo: P.parotta, sku: "PRT", spice: "None", tags: ["parotta", "dinner", "bestseller"], description: "Layered, flaky parotta made fresh on the tawa, crushed hot at the table. Order it with salna or any Chettinad gravy.", rows: [["2 pcs", 50], ["4 pcs", 95]] },
  { name: "Kothu Parotta", category: CAT.chettinad, diet: "non-veg", station: "kitchen", photo: P.kothu, sku: "KTP", optName: "Filling", spice: "Hot", tags: ["parotta", "dinner", "bestseller", "spicy"], description: "Parotta shredded on the tawa with egg, onion, curry leaf and salna to the rhythm of two steel blades. Egg, chicken or mutton.", rows: [["Egg", 150], ["Chicken", 180], ["Mutton", 230]] },
  { name: "Chilli Parotta", category: CAT.chettinad, diet: "veg", station: "kitchen", photo: P.chilliParotta, sku: "CHP", spice: "Hot", tags: ["parotta", "spicy"], description: "Parotta pieces tossed with onion, capsicum, green chilli and a tangy sauce. The vegetarian favourite.", rows: [["Plate", 140]] },
  { name: "Chettinad Chicken Curry", category: CAT.chettinad, diet: "non-veg", station: "kitchen", photo: P.chettinadChicken, sku: "CCC", spice: "Hot", tags: ["chettinad", "gravy", "bestseller", "spicy"], description: "Chicken in a freshly ground Chettinad masala of kalpasi, marathi mokku, pepper and fennel. Thick, dark and hot.", rows: [["Half", 180], ["Full", 330]] },
  { name: "Pepper Chicken", category: CAT.chettinad, diet: "non-veg", station: "kitchen", photo: P.pepperChicken, sku: "PPC", spice: "Hot", tags: ["chettinad", "gravy", "spicy"], description: "Boneless chicken cooked dry with crushed black pepper, shallots and curry leaf, finished in sesame oil.", rows: [["Half", 190], ["Full", 350]] },
  { name: "Nattu Kozhi Varuval", category: CAT.chettinad, diet: "non-veg", station: "kitchen", photo: P.kozhi, sku: "NKV", spice: "Hot", tags: ["chettinad", "weekend", "spicy"], description: "Country chicken on the bone slow-fried in a roasted masala until dry and dark. Best with rasam rice.", rows: [["Plate", 290]] },
  { name: "Mutton Chukka", category: CAT.chettinad, diet: "non-veg", station: "kitchen", photo: P.chukka, sku: "MCK", spice: "Hot", tags: ["chettinad", "weekend", "spicy"], description: "Mutton pieces pressure-cooked with shallots and ground spices, then stir-fried dry with curry leaf and pepper.", rows: [["Plate", 320]] },
  { name: "Chettinad Fish Curry", category: CAT.chettinad, diet: "non-veg", station: "kitchen", photo: P.fishCurry, sku: "CFC", spice: "Hot", tags: ["chettinad", "gravy", "spicy"], description: "Seer fish steaks in a tamarind-and-coconut Chettinad gravy, sharp, hot and slightly sour.", rows: [["Plate", 280]] },
  { name: "Egg Masala", category: CAT.chettinad, diet: "egg", station: "kitchen", photo: P.eggMasala, sku: "EMS", spice: "Medium", tags: ["gravy"], description: "Boiled eggs simmered in an onion-tomato masala with a hint of fennel. Pairs with parotta or chapati.", rows: [["Plate", 120]] },

  // ---- Tandoor
  { name: "Tandoori Chicken", category: CAT.tandoor, diet: "non-veg", station: "tandoor", photo: P.tandooriChicken, sku: "TDC", spice: "Medium", tags: ["tandoor", "dinner", "bestseller"], description: "Chicken marinated overnight in curd, Kashmiri chilli and ginger-garlic, roasted in the clay tandoor, with mint chutney and onion.", rows: [["Half", 260], ["Full", 480]] },
  { name: "Chicken Tikka", category: CAT.tandoor, diet: "non-veg", station: "tandoor", photo: P.tikka, sku: "CTK", spice: "Medium", tags: ["tandoor", "dinner"], description: "Boneless chicken cubes in a curd and spice marinade, charred on skewers. Eight pieces.", rows: [["8 pcs", 240]] },
  { name: "Paneer Tikka", category: CAT.tandoor, diet: "veg", station: "tandoor", photo: P.paneerTikka, sku: "PTK", spice: "Medium", tags: ["tandoor", "dinner"], description: "Paneer, capsicum and onion marinated in hung curd and ajwain and grilled until the edges blister.", rows: [["8 pcs", 220]] },
  { name: "Fish Tikka", category: CAT.tandoor, diet: "non-veg", station: "tandoor", photo: P.fishTikka, sku: "FTK", spice: "Medium", tags: ["tandoor", "weekend"], description: "Seer fish chunks in a carom and lemon marinade, grilled in the tandoor.", rows: [["8 pcs", 290]] },
  { name: "Naan", category: CAT.tandoor, diet: "veg", station: "tandoor", photo: P.naan, sku: "NAN", optName: "Type", spice: "None", tags: ["tandoor", "bread"], description: "Soft naan stretched by hand and stuck to the tandoor wall. Plain, brushed with butter, or topped with garlic and coriander.", rows: [["Plain", 45], ["Butter", 55], ["Garlic", 65]] },
  { name: "Tandoori Roti", category: CAT.tandoor, diet: "veg", station: "tandoor", photo: P.roti, sku: "TRT", spice: "None", tags: ["tandoor", "bread"], description: "Whole-wheat roti baked on the tandoor wall: crisp at the edge, soft in the middle.", rows: [["1 pc", 30]] },

  // ---- Starters and chaat
  { name: "Chicken 65", category: CAT.starters, diet: "non-veg", station: "kitchen", photo: P.chicken65, sku: "C65", spice: "Hot", tags: ["starter", "bestseller", "spicy"], description: "Boneless chicken marinated in ginger, garlic and red chilli, deep-fried with curry leaf and green chilli until crisp.", rows: [["Half", 190], ["Full", 340]] },
  { name: "Paneer 65", category: CAT.starters, diet: "veg", station: "kitchen", photo: P.paneer65, sku: "P65", spice: "Hot", tags: ["starter", "spicy"], description: "Paneer cubes in a crisp spiced batter, tossed with curry leaf, green chilli and onion.", rows: [["Plate", 170]] },
  { name: "Masala Fish Fry", category: CAT.starters, diet: "non-veg", station: "kitchen", photo: P.fishFry, sku: "MFF", spice: "Hot", tags: ["starter", "spicy"], description: "Seer fish steaks coated in a red masala and shallow-fried on the tawa. Served with onion and lemon.", rows: [["2 slices", 270]] },
  { name: "Pani Puri", category: CAT.starters, diet: "veg", station: "kitchen", photo: P.paniPuri, sku: "PNP", spice: "Medium", tags: ["chaat", "evening"], description: "Six crisp puris filled with potato, sprouts and tamarind, served with a jug of spiced mint water.", rows: [["6 pcs", 60]] },
  { name: "Papdi Chaat", category: CAT.starters, diet: "veg", station: "kitchen", photo: P.papdiChaat, sku: "PDC", spice: "Medium", tags: ["chaat", "evening"], description: "Crisp papdi under potato, channa, whisked curd, tamarind and mint chutneys, sev and pomegranate.", rows: [["Plate", 70]] },
  { name: "Dahi Vada", category: CAT.starters, diet: "veg", station: "kitchen", photo: P.dahiVada, sku: "DHV", spice: "Mild", tags: ["chaat", "evening"], description: "Soft urad vadas soaked in whisked curd, topped with tamarind and mint chutneys and a dusting of chaat masala.", rows: [["2 pcs", 75]] },

  // ---- Beverages
  { name: "Filter Coffee", category: CAT.beverages, diet: "veg", station: "beverages", photo: P.coffee, sku: "FLC", spice: "None", tags: ["drink", "bestseller", "breakfast"], description: "Strong decoction from freshly roasted peaberry and chicory, with boiled milk, served in a steel tumbler and davara.", rows: [["Cup", 35]] },
  { name: "Tea", category: CAT.beverages, diet: "veg", station: "beverages", photo: P.tea, sku: "TEA", optName: "Type", spice: "None", tags: ["drink", "breakfast"], description: "Boiled tea with milk, or masala tea with ginger and cardamom.", rows: [["Plain", 25], ["Masala", 35]] },
  { name: "Jigarthanda", category: CAT.beverages, diet: "veg", station: "beverages", photo: P.jigarthanda, sku: "JGT", spice: "None", tags: ["drink", "madurai", "bestseller"], description: "Madurai's cold drink: reduced milk, almond gum, sarsaparilla syrup and ice cream. Special adds a second scoop and badam pisin.", rows: [["Regular", 90], ["Special", 140]] },
  { name: "Rose Milk", category: CAT.beverages, diet: "veg", station: "beverages", photo: P.roseMilk, sku: "RSM", spice: "None", tags: ["drink"], description: "Chilled milk with rose syrup and basil seeds.", rows: [["Glass", 60]] },
  { name: "Fresh Lime Soda", category: CAT.beverages, diet: "veg", station: "beverages", photo: P.lime, sku: "FLS", optName: "Type", spice: "None", tags: ["drink"], description: "Fresh lime squeezed over ice and topped with soda, sweet or salted.", rows: [["Sweet", 50], ["Salt", 50]] },
  { name: "Butter Milk", category: CAT.beverages, diet: "veg", station: "beverages", photo: P.buttermilk, sku: "BTM", spice: "None", tags: ["drink", "lunch"], description: "Spiced buttermilk with curry leaf, ginger and green chilli. Cools down a Chettinad lunch.", rows: [["Glass", 40]] },
  { name: "Sweet Lassi", category: CAT.beverages, diet: "veg", station: "beverages", photo: P.lassi, sku: "LSI", spice: "None", tags: ["drink"], description: "Thick curd lassi sweetened with sugar and finished with a spoon of malai.", rows: [["Glass", 70]] },
  { name: "Fresh Juice", category: CAT.beverages, diet: "veg", station: "beverages", photo: P.juice, sku: "FJC", optName: "Fruit", spice: "None", tags: ["drink"], description: "Pressed to order, no added water: watermelon, orange or pomegranate.", rows: [["Watermelon", 70], ["Orange", 80], ["Pomegranate", 100]] },

  // ---- Desserts
  { name: "Semiya Payasam", category: CAT.desserts, diet: "veg", station: "kitchen", photo: P.payasam, sku: "SPY", spice: "None", tags: ["dessert", "lunch"], description: "Vermicelli simmered in milk with cardamom, ghee-fried cashew and raisin. Served warm.", rows: [["Cup", 70]] },
  { name: "Gulab Jamun", category: CAT.desserts, diet: "veg", station: "kitchen", photo: P.jamun, sku: "GJM", spice: "None", tags: ["dessert"], description: "Soft khoya dumplings in cardamom syrup, served warm. Two pieces.", rows: [["2 pcs", 70]] },
  { name: "Rava Kesari", category: CAT.desserts, diet: "veg", station: "kitchen", photo: P.kesari, sku: "RKS", spice: "None", tags: ["dessert", "breakfast"], description: "Semolina roasted in ghee and cooked with sugar, saffron and cashew until it just holds its shape.", rows: [["Plate", 60]] },
  { name: "Carrot Halwa", category: CAT.desserts, diet: "veg", station: "kitchen", photo: P.halwa, sku: "CHW", spice: "None", tags: ["dessert"], description: "Slow-cooked grated carrot, milk and ghee, finished with cardamom and almonds.", rows: [["Plate", 90]] },
  { name: "Falooda", category: CAT.desserts, diet: "veg", station: "beverages", photo: P.falooda, sku: "FLD", spice: "None", tags: ["dessert", "drink", "family"], description: "Rose milk, vermicelli, basil seeds and jelly under a scoop of ice cream, in a tall glass.", rows: [["Glass", 130]] },

  // ---- Family and party (family hall)
  { name: "Family Veg Feast (serves 4)", category: CAT.family, diet: "veg", station: "kitchen", photo: P.familyVeg, sku: "FVF", spice: "Medium", tags: ["family", "special"], description: "Four banana-leaf meals served together with a vegetable biryani, two starters and a plate of payasam for the table.", rows: [["Feast", 999]] },
  { name: "Family Non-veg Feast (serves 4)", category: CAT.family, diet: "non-veg", station: "kitchen", photo: P.familyNonVeg, sku: "FNF", spice: "Medium", tags: ["family", "special", "weekend"], description: "Large chicken biryani, Chettinad chicken curry, chicken 65, four parottas, raita and four gulab jamun.", rows: [["Feast", 1499]] },
  { name: "Tandoor Platter for Two", category: CAT.family, diet: "non-veg", station: "tandoor", photo: P.tandoorPlatter, sku: "TPL", spice: "Medium", tags: ["family", "tandoor", "dinner"], description: "Half tandoori chicken, four chicken tikka, two paneer tikka and two butter naan with mint chutney.", rows: [["Platter", 749]] },
  { name: "Chicken Biryani Party Tray", category: CAT.family, diet: "non-veg", station: "kitchen", photo: P.chickenTray, sku: "PCB", optName: "Serves", spice: "Medium", tags: ["party", "bulk"], description: "Seeraga samba chicken biryani in a sealed tray with raita and brinjal gravy. For the family hall or to carry home; a day's notice please.", rows: [["10 people", 2699], ["20 people", 5199]] },
  { name: "Veg Biryani Party Tray", category: CAT.family, diet: "veg", station: "kitchen", photo: P.vegTray, sku: "PVB", optName: "Serves", spice: "Mild", tags: ["party", "bulk"], description: "Vegetable dum biryani in a sealed tray with onion raita and kurma. Serves 10 or 20; a day's notice please.", rows: [["10 people", 1799], ["20 people", 3399]] },
];

export const rs = (rupees: number) => Math.round(rupees * 100);
/** Restaurant service (SAC 996331): 5% without input tax credit. */
export const GST_RATE = 5;
/**
 * A dine-in menu shows one price, so MRP = price, except the meals and sides tagged "lunch": their menu-card price is about
 * 12% above what is billed in the lunch window (the "Lunch offers" collection and the daily flash sale on the home page).
 */
export const mrpOf = (price: number, d: Dish) => (d.tags?.includes("lunch") && d.category === CAT.meals ? Math.ceil((price * 1.12) / 5) * 5 : price);

const unitOf = (d: Dish) => (d.category === CAT.beverages ? "glass" : d.name.includes("Tray") ? "tray" : "plate");

/** The catalogue products of the demo store: a dish with several portions has one option. */
export function menuProducts(): DemoProduct[] {
  return DISHES.map((d): DemoProduct => {
    const optName = d.optName ?? "Portion";
    const options = d.rows.length > 1 ? [{ name: optName, values: d.rows.map((r) => r[0]) }] : undefined;
    return {
      name: d.name,
      category: d.category,
      hsn: "996331",
      gstRate: GST_RATE,
      unit: unitOf(d),
      description: d.description,
      attributes: { Diet: d.diet === "egg" ? "Egg" : d.diet === "veg" ? "Veg" : "Non-veg", "Spice level": d.spice ?? "Medium" },
      tags: [d.diet === "egg" ? "egg" : d.diet === "veg" ? "veg" : "non-veg", ...(d.tags ?? [])],
      sku: d.sku,
      photo: d.photo,
      ...(options ? { options } : {}),
      variants: d.rows.map(([value, price]) => ({ ...(options ? { values: { [optName]: value } } : {}), price: rs(price), mrp: rs(mrpOf(price, d)), stock: 500 })),
      costShare: 0.38,
    };
  });
}
