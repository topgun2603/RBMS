import type { DemoProduct, DemoStore } from "./types";

/**
 * Store #4 of the series: Vayal Organics, Erode (vayal.localhost:3003). An organic and millets store on the online
 * store app (EC) with the `organic` trade and the "earthen" look (unbleached paper, forest green, turmeric).
 * Names are generic (no brands); prices are typical Tamil Nadu organic-store prices in 2026, GST included. Address,
 * phone and GSTIN are placeholders like the other demo shops.
 *
 * GST (after the 22 Sep 2025 rate rationalisation, CBIC notification 9/2025-Central Tax (Rate)): pre-packaged and
 * labelled millets, rice, pulses, flours, whole spices, tamarind, jaggery and country sugar 5% (loose, unlabelled sales
 * of the same would be nil); edible oils 5%; natural honey 5%; ghee 5% (was 12%); spice blends (HSN 2103) 5% (was
 * 12%); toilet soap, hair oil and tooth powder 5% (were 18%); salt nil.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500016";
const WHATSAPP = "919876500016";
const orderLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

/** 500 g and 1 kg packs: [price ₹, MRP ₹] each. */
const kilo = (half: [number, number], full: [number, number], stock = 60) =>
  one("Weight", [
    ["500 g", half[0], half[1], stock],
    ["1 kg", full[0], full[1], Math.round(stock * 0.7)],
  ]);

/** 500 ml and 1 litre bottles: [price ₹, MRP ₹] each. */
const litre = (half: [number, number], full: [number, number], stock = 40) =>
  one("Volume", [
    ["500 ml", half[0], half[1], stock],
    ["1 litre", full[0], full[1], Math.round(stock * 0.8)],
  ]);

const MILLETS = "Millets";
const RICE = "Traditional rice";
const OILS = "Cold-pressed oils";
const SUGAR = "Country sugar & jaggery";
const PULSES = "Pulses & dals";
const SPICES = "Spices & masalas";
const MIXES = "Health mixes";
const HONEY = "Honey & ghee";
const HERBAL = "Herbal care";

const MILLET_COOKING = "Rinse two or three times, soak for 30 minutes and cook like rice: 1 cup of millet to 2½–3 cups of water, 15–20 minutes on a low flame or 3 whistles.";

const PRODUCTS: DemoProduct[] = [
  // ---- millets (HSN 1008, 5% pre-packaged and labelled)
  {
    name: "Finger millet (ragi / kezhvaragu)",
    category: MILLETS,
    hsn: "1008",
    gstRate: 5,
    unit: "pack",
    sku: "VY-RAGI",
    photo: 18275951,
    tags: ["kit", "fast-mover"],
    description: "Whole red ragi from rain-fed fields near Krishnagiri, cleaned twice and stone-free. The richest millet in calcium: grind it for kali, koozh, dosa and puttu, or sprout it for malt.\n\nPacked in our Erode store every week; the packed date is on the label.",
    attributes: { Variety: "Red finger millet", Origin: "Krishnagiri, Tamil Nadu", Processing: "Machine cleaned, hand sorted", "Shelf life": "6 months" },
    ...kilo([55, 60], [98, 110], 80),
  },
  {
    name: "Pearl millet (kambu)",
    category: MILLETS,
    hsn: "1008",
    gstRate: 5,
    unit: "pack",
    sku: "VY-KAMBU",
    photo: 10817550,
    tags: ["kit"],
    description: "Grey pearl millet from Virudhunagar farms, for kambu koozh on hot afternoons, kambu dosa and adai. High in iron and keeps you full for long.",
    attributes: { Variety: "Native grey kambu", Origin: "Virudhunagar, Tamil Nadu", Processing: "Cleaned, unpolished", "Shelf life": "4 months" },
    ...kilo([50, 55], [92, 100], 70),
  },
  {
    name: "Foxtail millet (thinai)",
    category: MILLETS,
    hsn: "1008",
    gstRate: 5,
    unit: "pack",
    sku: "VY-THINAI",
    photo: 6103120,
    tags: ["kit", "fast-mover"],
    description: `Dehusked, unpolished foxtail millet: the easiest swap for rice in pongal, biryani and upma, and a low-glycaemic grain for diabetics.\n\n${MILLET_COOKING}`,
    attributes: { Variety: "Foxtail millet", Origin: "Dharmapuri, Tamil Nadu", Processing: "Dehusked, unpolished", "Shelf life": "6 months" },
    ...kilo([70, 80], [135, 150]),
  },
  {
    name: "Little millet (samai)",
    category: MILLETS,
    hsn: "1008",
    gstRate: 5,
    unit: "pack",
    sku: "VY-SAMAI",
    photo: 7421203,
    tags: ["kit"],
    description: `Tiny, quick-cooking grains from the Javadhu hills, for samai sadham, curd rice and kheer. Rich in fibre and gentle on the stomach.\n\n${MILLET_COOKING}`,
    attributes: { Variety: "Little millet", Origin: "Javadhu hills, Tiruvannamalai", Processing: "Dehusked, unpolished", "Shelf life": "6 months" },
    ...kilo([75, 85], [145, 160]),
  },
  {
    name: "Kodo millet (varagu)",
    category: MILLETS,
    hsn: "1008",
    gstRate: 5,
    unit: "pack",
    sku: "VY-VARAGU",
    photo: 7421202,
    description: `Kodo millet with a nutty bite, for varagu sambar sadham, khichdi and lemon rice. A traditional choice for weight watchers.\n\n${MILLET_COOKING}`,
    attributes: { Variety: "Kodo millet", Origin: "Dharmapuri, Tamil Nadu", Processing: "Dehusked, unpolished", "Shelf life": "6 months" },
    ...kilo([72, 80], [138, 150]),
  },
  {
    name: "Barnyard millet (kuthiraivali)",
    category: MILLETS,
    hsn: "1008",
    gstRate: 5,
    unit: "pack",
    sku: "VY-KV",
    photo: 11519186,
    description: `Soft, white barnyard millet that cooks up fluffy: perfect for fasting days, idli, dosa and payasam. The lowest in carbohydrates of all millets.\n\n${MILLET_COOKING}`,
    attributes: { Variety: "Barnyard millet", Origin: "Salem, Tamil Nadu", Processing: "Dehusked, unpolished", "Shelf life": "6 months" },
    ...kilo([80, 90], [155, 170]),
  },

  // ---- traditional rice (HSN 1006, 5%)
  {
    name: "Mappillai samba rice",
    category: RICE,
    hsn: "1006",
    gstRate: 5,
    unit: "pack",
    sku: "VY-MAP",
    photo: 6086557,
    tags: ["kit", "fast-mover"],
    description: "The 'bridegroom's rice' of Tamil Nadu: a red heirloom paddy grown without chemical sprays near Thanjavur, hand-pounded so the bran stays on. Cook for kanji, idli and with sambar.\n\nSoak for 2 hours; 1 cup of rice to 4 cups of water.",
    attributes: { Variety: "Mappillai samba (heirloom)", Origin: "Thanjavur delta", Processing: "Hand-pounded, unpolished", "Shelf life": "8 months" },
    ...one("Weight", [
      ["1 kg", 120, 135, 50],
      ["5 kg", 580, 650, 20],
    ]),
  },
  {
    name: "Karuppu kavuni black rice",
    category: RICE,
    hsn: "1006",
    gstRate: 5,
    unit: "pack",
    sku: "VY-KAV",
    photo: 8108049,
    tags: ["deal"],
    description: "The black 'emperor's rice' of Chettinad, deep purple when cooked and rich in antioxidants. Makes the traditional kavuni arisi sweet with coconut and jaggery.",
    attributes: { Variety: "Karuppu kavuni", Origin: "Karaikudi, Sivaganga", Processing: "Unpolished", "Shelf life": "8 months" },
    ...one("Weight", [
      ["500 g", 140, 160, 40],
      ["1 kg", 270, 300, 25],
    ]),
  },
  {
    name: "Seeraga samba rice",
    category: RICE,
    hsn: "1006",
    gstRate: 5,
    unit: "pack",
    sku: "VY-SEER",
    photo: 7421207,
    description: "Small, fragrant grains the size of cumin seeds: the rice for Dindigul and Ambur biryani. Aged one year so it cooks separate and fluffy.",
    attributes: { Variety: "Seeraga samba", Origin: "Thanjavur delta", Processing: "Aged 1 year, single polished", "Shelf life": "12 months" },
    ...one("Weight", [
      ["1 kg", 150, 165, 50],
      ["5 kg", 730, 800, 18],
    ]),
  },
  {
    name: "Hand-pounded ponni rice",
    category: RICE,
    hsn: "1006",
    gstRate: 5,
    unit: "pack",
    sku: "VY-PONNI",
    photo: 7232901,
    tags: ["kit"],
    description: "Everyday ponni from naturally farmed fields along the Bhavani, hand-pounded to keep the germ and some bran. Tastes like rice used to.",
    attributes: { Variety: "Ponni", Origin: "Bhavani, Erode", Processing: "Hand-pounded", "Shelf life": "8 months" },
    ...one("Weight", [
      ["1 kg", 85, 95, 80],
      ["5 kg", 410, 450, 30],
    ]),
  },
  {
    name: "Poongar red rice",
    category: RICE,
    hsn: "1006",
    gstRate: 5,
    unit: "pack",
    sku: "VY-POON",
    photo: 4110263,
    description: "A short-duration red heirloom rice long given to women after childbirth. Soft when cooked; good for kanji, dosa and puttu.",
    attributes: { Variety: "Poongar", Origin: "Tiruvarur", Processing: "Unpolished", "Shelf life": "8 months" },
    ...one("Weight", [
      ["1 kg", 115, 130, 40],
      ["5 kg", 560, 620, 12],
    ]),
  },

  // ---- cold-pressed oils (5%)
  {
    name: "Wood-pressed gingelly (sesame) oil",
    category: OILS,
    hsn: "1515",
    gstRate: 5,
    unit: "bottle",
    sku: "VY-GINGELLY",
    photo: 5755517,
    tags: ["kit", "fast-mover"],
    description: "Black and white sesame pressed slow in a vaagai-wood chekku with palm jaggery, the old Tamil way. Unrefined and unfiltered except through cloth, so it smells of roasted sesame.\n\nFor kuzhambu, idli podi, oil baths and pickles.",
    attributes: { Processing: "Wood-pressed (marachekku), cloth filtered", Seeds: "Sesame from Erode farms", "Shelf life": "6 months" },
    ...litre([260, 290], [500, 550]),
  },
  {
    name: "Wood-pressed groundnut oil",
    category: OILS,
    hsn: "1508",
    gstRate: 5,
    unit: "bottle",
    sku: "VY-GROUND",
    photo: 30107827,
    tags: ["kit", "fast-mover"],
    description: "Groundnuts from Tiruvannamalai pressed cold in a wooden chekku; nothing added, nothing taken out. Golden, with the nutty taste of fresh peanuts. Good for deep frying.",
    attributes: { Processing: "Wood-pressed (marachekku)", Seeds: "Groundnuts from Tiruvannamalai", "Shelf life": "6 months" },
    ...litre([175, 195], [340, 370], 60),
  },
  {
    name: "Wood-pressed coconut oil",
    category: OILS,
    hsn: "1513",
    gstRate: 5,
    unit: "bottle",
    sku: "VY-COCO",
    photo: 11809347,
    description: "Sun-dried copra from Pollachi pressed in a wooden chekku. For cooking avial and poriyal, for oiling hair and for babies' massage. Turns solid below 24 °C; warm the bottle in the sun.",
    attributes: { Processing: "Wood-pressed (marachekku)", Copra: "Pollachi, sun-dried", "Shelf life": "9 months" },
    ...litre([210, 235], [400, 440]),
  },
  {
    name: "Virgin coconut oil (cold-pressed)",
    category: OILS,
    hsn: "1513",
    gstRate: 5,
    unit: "bottle",
    sku: "VY-VCO",
    photo: 9131994,
    description: "Pressed from fresh coconut milk, not dried copra, so it is water-clear with a light coconut aroma. A spoon a day, or on skin and hair.",
    attributes: { Processing: "Cold-pressed from fresh coconut milk", Origin: "Pollachi", "Shelf life": "12 months" },
    ...one("Volume", [
      ["250 ml", 230, 260, 40],
      ["500 ml", 440, 490, 25],
    ]),
  },

  // ---- country sugar & jaggery (HSN 1701, 5%)
  {
    name: "Nattu sakkarai (country sugar)",
    category: SUGAR,
    hsn: "1701",
    gstRate: 5,
    unit: "pack",
    sku: "VY-NATTU",
    photo: 6086210,
    tags: ["kit", "fast-mover"],
    description: "Unbleached cane sugar made in open pans near Erode, without sulphur or chemicals. Dissolves easily: use it in coffee, tea, payasam and baking in place of white sugar.",
    attributes: { Processing: "Open-pan, sulphur-free", Origin: "Erode", "Shelf life": "6 months" },
    ...kilo([65, 75], [125, 140], 90),
  },
  {
    name: "Karupatti (palm jaggery)",
    category: SUGAR,
    hsn: "1701",
    gstRate: 5,
    unit: "pack",
    sku: "VY-KARU",
    photo: 3525741,
    tags: ["kit"],
    description: "Pure palmyra jaggery from Thoothukudi climbers, made from padaneer boiled in clay pots. No cane sugar mixed in: it melts slowly, tastes of smoke and caramel, and is the base of karupatti coffee.",
    attributes: { Source: "Palmyra sap (padaneer)", Origin: "Udangudi, Thoothukudi", Purity: "No cane sugar added", "Shelf life": "12 months" },
    ...kilo([220, 250], [430, 480], 50),
  },
  {
    name: "Achu vellam (cane jaggery)",
    category: SUGAR,
    hsn: "1701",
    gstRate: 5,
    unit: "pack",
    sku: "VY-ACHU",
    photo: 13746824,
    description: "Moulded cane jaggery from Kolli hills crushers, golden and chemical-free (no hydros or soda). For pongal, adhirasam and sweet kozhukattai.",
    attributes: { Processing: "No hydros or soda", Origin: "Kolli hills", "Shelf life": "6 months" },
    ...kilo([50, 58], [95, 110], 70),
  },
  {
    name: "Palm sugar powder (panai sakkarai)",
    category: SUGAR,
    hsn: "1701",
    gstRate: 5,
    unit: "pack",
    sku: "VY-PANAI",
    photo: 5740647,
    description: "Karupatti ground to a fine powder that dissolves in seconds: for filter coffee, milk and sweets without lumps.",
    attributes: { Source: "Palmyra jaggery", Origin: "Thoothukudi", "Shelf life": "9 months" },
    ...one("Weight", [
      ["250 g", 160, 180, 40],
      ["500 g", 310, 350, 25],
    ]),
  },

  // ---- pulses & dals (HSN 0713, 5%)
  {
    name: "Unpolished toor dal",
    category: PULSES,
    hsn: "0713",
    gstRate: 5,
    unit: "pack",
    sku: "VY-TOOR",
    photo: 28110938,
    tags: ["kit", "fast-mover"],
    description: "Naturally grown toor split without oil or colour polish, so it looks dull and cooks faster and tastier. For sambar, paruppu and kootu.",
    attributes: { Processing: "Unpolished, no oil coating", Origin: "Perambalur", "Shelf life": "8 months" },
    ...kilo([95, 105], [185, 205], 80),
  },
  {
    name: "Whole green gram (pachai payaru)",
    category: PULSES,
    hsn: "0713",
    gstRate: 5,
    unit: "pack",
    sku: "VY-GG",
    photo: 6805060,
    description: "Plump green gram for sundal, kuzhambu and sprouts. Sprouts in 12 hours.",
    attributes: { Origin: "Pudukkottai", "Shelf life": "8 months" },
    ...kilo([80, 90], [155, 170]),
  },
  {
    name: "Split moong dal (paasi paruppu)",
    category: PULSES,
    hsn: "0713",
    gstRate: 5,
    unit: "pack",
    sku: "VY-MOONG",
    photo: 7420816,
    tags: ["kit"],
    description: "Split green gram with the skin on, for pongal, payasam and light dal on fasting days. Unpolished.",
    attributes: { Processing: "Split, skin on, unpolished", Origin: "Pudukkottai", "Shelf life": "8 months" },
    ...kilo([90, 100], [175, 190]),
  },
  {
    name: "Whole black urad (karuppu ulundhu)",
    category: PULSES,
    hsn: "0713",
    gstRate: 5,
    unit: "pack",
    sku: "VY-URAD",
    photo: 7772002,
    description: "Whole black gram with the skin, for ulundhu kali, soft idli batter and ulundhu sadham. Grind with the skin for more fibre and iron.",
    attributes: { Origin: "Villupuram", "Shelf life": "8 months" },
    ...kilo([85, 95], [165, 180]),
  },
  {
    name: "Horse gram (kollu)",
    category: PULSES,
    hsn: "0713",
    gstRate: 5,
    unit: "pack",
    sku: "VY-KOLLU",
    photo: 368689,
    description: "Dry-land horse gram for kollu rasam, kollu thuvaiyal and sundal. A winter favourite, and a traditional aid for weight loss.",
    attributes: { Origin: "Dharmapuri", "Shelf life": "10 months" },
    ...kilo([65, 75], [125, 140]),
  },
  {
    name: "White chickpeas (vellai kondakadalai)",
    category: PULSES,
    hsn: "0713",
    gstRate: 5,
    unit: "pack",
    sku: "VY-CHANA",
    photo: 6805059,
    description: "Large white chickpeas that soak up overnight and cook soft, for chana masala, sundal and salads.",
    attributes: { Origin: "Madhya Pradesh", "Shelf life": "10 months" },
    ...kilo([75, 85], [145, 160]),
  },

  // ---- spices & masalas
  {
    name: "Erode turmeric powder",
    category: SPICES,
    hsn: "0910",
    gstRate: 5,
    unit: "pack",
    sku: "VY-TURM",
    photo: 6220708,
    tags: ["kit", "fast-mover"],
    description: "Finger turmeric from Erode, the turmeric capital, boiled, sun-dried and stone-ground in our own mill. Bright, earthy and free of colour or starch.",
    attributes: { Origin: "Erode", Curcumin: "3–4%", Processing: "Sun-dried, stone-ground", "Shelf life": "12 months" },
    ...one("Weight", [
      ["100 g", 45, 50, 120],
      ["250 g", 105, 120, 80],
    ]),
  },
  {
    name: "Black pepper (whole)",
    category: SPICES,
    hsn: "0904",
    gstRate: 5,
    unit: "pack",
    sku: "VY-PEPPER",
    photo: 5988689,
    description: "Bold, sun-dried pepper from Kolli hills estates where it climbs silver oak. Grind fresh for rasam, milagu kuzhambu and pongal.",
    attributes: { Origin: "Kolli hills", Grade: "Bold (4.75 mm)", "Shelf life": "18 months" },
    ...one("Weight", [
      ["100 g", 95, 110, 60],
      ["250 g", 230, 260, 30],
    ]),
  },
  {
    name: "Gundu milagai (round red chilli)",
    category: SPICES,
    hsn: "0904",
    gstRate: 5,
    unit: "pack",
    sku: "VY-CHILLI",
    photo: 6902055,
    description: "Ramanathapuram mundu chillies: round, glossy and medium-hot, the chilli of Tamil sambar and kara kuzhambu. Stems removed.",
    attributes: { Origin: "Ramanathapuram", Heat: "Medium", "Shelf life": "12 months" },
    ...one("Weight", [
      ["250 g", 110, 125, 50],
      ["500 g", 210, 240, 30],
    ]),
  },
  {
    name: "Coriander seeds (malli)",
    category: SPICES,
    hsn: "0909",
    gstRate: 5,
    unit: "pack",
    sku: "VY-MALLI",
    photo: 5988179,
    description: "Greenish, aromatic coriander from Virudhunagar, cleaned and sorted. Dry-roast and grind for sambar and rasam powder at home.",
    attributes: { Origin: "Virudhunagar", "Shelf life": "12 months" },
    ...one("Weight", [
      ["250 g", 60, 70, 60],
      ["500 g", 115, 130, 40],
    ]),
  },
  {
    name: "Stone-ground sambar powder",
    category: SPICES,
    hsn: "2103",
    gstRate: 5,
    unit: "pack",
    sku: "VY-SAMBAR",
    photo: 7208238,
    tags: ["kit"],
    description: "Our kitchen's own sambar podi: coriander, gundu chilli, toor dal, fenugreek, pepper and Erode turmeric, roasted in small batches and stone-ground. No colour, no salt, no preservatives.",
    attributes: { Ingredients: "Coriander, chilli, toor dal, chana dal, fenugreek, pepper, cumin, turmeric", "Shelf life": "4 months" },
    ...one("Weight", [
      ["200 g", 85, 95, 50],
      ["500 g", 200, 225, 30],
    ]),
  },
  {
    name: "Pepper rasam powder",
    category: SPICES,
    hsn: "2103",
    gstRate: 5,
    unit: "pack",
    sku: "VY-RASAM",
    photo: 5056631,
    description: "Pepper-forward rasam podi with cumin, coriander, toor dal and curry leaves, roasted and ground in small batches. One spoon for four.",
    attributes: { Ingredients: "Pepper, cumin, coriander, toor dal, curry leaves, chilli", "Shelf life": "4 months" },
    ...single(80, 90, 50),
  },
  {
    name: "Sun-dried sea salt (kal uppu)",
    category: SPICES,
    hsn: "2501",
    gstRate: 0,
    unit: "pack",
    sku: "VY-SALT",
    photo: 4475232,
    description: "Coarse crystal salt from the Vedaranyam salt pans, dried in the sun and not refined, so it keeps its trace minerals. For pickles, brining and the kitchen salt jar. Salt carries no GST.",
    attributes: { Origin: "Vedaranyam", Processing: "Sun-dried, unrefined", "Shelf life": "No expiry" },
    ...single(40, 45, 100),
  },
  {
    name: "Seedless tamarind (puli)",
    category: SPICES,
    hsn: "0813",
    gstRate: 5,
    unit: "pack",
    sku: "VY-PULI",
    photo: 18495829,
    tags: ["kit"],
    description: "This season's dark tamarind from Dharmapuri, deseeded by hand. Thick and sour: a lemon-sized ball is enough for a pot of kuzhambu.",
    attributes: { Origin: "Dharmapuri", Season: "2026 crop", "Shelf life": "12 months" },
    ...kilo([120, 135], [230, 260], 50),
  },
  {
    name: "Green cardamom (elakkai)",
    category: SPICES,
    hsn: "0908",
    gstRate: 5,
    unit: "pack",
    sku: "VY-ELAK",
    photo: 9142634,
    description: "Bold 8 mm green cardamom from Bodinayakanur auctions, for payasam, tea and biryani.",
    attributes: { Origin: "Bodinayakanur", Grade: "8 mm bold", "Shelf life": "12 months" },
    ...one("Weight", [
      ["50 g", 165, 185, 40],
      ["100 g", 320, 360, 25],
    ]),
  },
  {
    name: "Fenugreek seeds (vendhayam)",
    category: SPICES,
    hsn: "0910",
    gstRate: 5,
    unit: "pack",
    sku: "VY-VENDH",
    photo: 5987968,
    description: "Clean fenugreek for idli batter, kuzhambu and vendhaya kali. Soak a spoon overnight for a cooling morning drink.",
    attributes: { Origin: "Rajasthan", "Shelf life": "12 months" },
    ...single(55, 62, 60),
  },

  // ---- health mixes
  {
    name: "Sathu maavu (multigrain health mix)",
    category: MIXES,
    hsn: "1102",
    gstRate: 5,
    unit: "pack",
    sku: "VY-SATHU",
    photo: 5652188,
    tags: ["kit", "fast-mover", "deal"],
    description: "Our 18-grain health mix: ragi, kambu, cholam, thinai, samai, red rice, green gram, roasted gram, almonds, cashew and cardamom, each roasted on its own and ground together.\n\nMix 2 spoons in a cup of water, boil for 5 minutes and add milk with nattu sakkarai, or salt and buttermilk. Good for children from one year.",
    attributes: { Ingredients: "18 millets, grains, pulses and nuts", Sugar: "None added", "Shelf life": "4 months" },
    ...kilo([210, 240], [400, 450], 60),
  },
  {
    name: "Moringa leaf powder",
    category: MIXES,
    hsn: "1211",
    gstRate: 5,
    unit: "pack",
    sku: "VY-MORINGA",
    photo: 7149595,
    description: "Young drumstick leaves dried in the shade so they stay green, then finely powdered. A spoon in dosa batter, soup or buttermilk adds iron and calcium.",
    attributes: { Processing: "Shade-dried", Origin: "Oddanchatram, Dindigul", "Shelf life": "8 months" },
    ...single(120, 140, 50),
  },

  // ---- honey & ghee
  {
    name: "Wild forest honey",
    category: HONEY,
    hsn: "0409",
    gstRate: 5,
    unit: "jar",
    sku: "VY-HONEY",
    photo: 5634207,
    tags: ["fast-mover"],
    description: "Raw honey collected by tribal gatherers in the Sathyamangalam forests, filtered through cloth and never heated. Dark, with a flowery tang. Raw honey may crystallise in the cold; that is a sign it is real.",
    attributes: { Source: "Wild rock bee, Sathyamangalam", Processing: "Raw, unheated, cloth filtered", "Shelf life": "24 months" },
    ...one("Weight", [
      ["250 g", 220, 250, 40],
      ["500 g", 420, 480, 25],
    ]),
  },
  {
    name: "Moringa flower honey",
    category: HONEY,
    hsn: "0409",
    gstRate: 5,
    unit: "jar",
    sku: "VY-MHONEY",
    photo: 9105957,
    description: "Single-flower honey from bee boxes kept in drumstick farms near Dindigul. Light, with a mild bitter-sweet finish.",
    attributes: { Source: "Bee boxes in moringa farms", Processing: "Raw, unheated", "Shelf life": "24 months" },
    ...single(260, 290, 30),
  },
  {
    name: "Bilona cow ghee",
    category: HONEY,
    hsn: "0405",
    gstRate: 5,
    unit: "jar",
    sku: "VY-GHEE",
    photo: 5471921,
    tags: ["kit"],
    description: "Made the slow way: curd set from cows' milk, churned to butter and simmered on a low flame till it smells of toasted milk. Grainy and golden.",
    attributes: { Method: "Curd-churned (bilona)", Milk: "Cows' milk from Erode dairies", "Shelf life": "9 months" },
    ...one("Volume", [
      ["200 ml", 290, 320, 40],
      ["500 ml", 690, 760, 25],
    ]),
  },
  {
    name: "Native cow ghee (nattu maadu)",
    category: HONEY,
    hsn: "0405",
    gstRate: 5,
    unit: "jar",
    sku: "VY-NGHEE",
    photo: 9105958,
    description: "Ghee from the milk of Kangeyam cows grazing near Erode, churned in small batches. Pale and aromatic.",
    attributes: { Method: "Curd-churned (bilona)", Milk: "Kangeyam native cows", "Shelf life": "9 months" },
    ...one("Volume", [
      ["250 ml", 450, 500, 20],
      ["500 ml", 880, 960, 12],
    ]),
  },

  // ---- herbal care (5% since Sep 2025)
  {
    name: "Neem & turmeric bath soap",
    category: HERBAL,
    hsn: "3401",
    gstRate: 5,
    unit: "pcs",
    sku: "VY-SOAP",
    photo: 4889029,
    description: "Cold-process soap made with wood-pressed coconut and gingelly oils, neem leaf and Erode turmeric. No synthetic colour or fragrance. Each bar weighs 100 g and is cured for six weeks.",
    attributes: { Oils: "Coconut, gingelly, castor", Herbs: "Neem, turmeric", Weight: "100 g per bar" },
    ...one("Pack", [
      ["1 bar", 75, 85, 80],
      ["3 bars", 210, 255, 30],
    ]),
  },
  {
    name: "Herbal hair oil (karisalankanni & hibiscus)",
    category: HERBAL,
    hsn: "3305",
    gstRate: 5,
    unit: "bottle",
    sku: "VY-HAIR",
    photo: 6694147,
    description: "Wood-pressed coconut and gingelly oil slow-boiled with karisalankanni, hibiscus, curry leaves, amla and vetiver, as grandmothers made it. Massage into the scalp an hour before a bath.",
    attributes: { Base: "Coconut and gingelly oil", Herbs: "Karisalankanni, hibiscus, curry leaf, amla, vetiver" },
    ...one("Volume", [
      ["100 ml", 180, 200, 40],
      ["200 ml", 340, 380, 25],
    ]),
  },
  {
    name: "Neem & clove tooth powder",
    category: HERBAL,
    hsn: "3306",
    gstRate: 5,
    unit: "pack",
    sku: "VY-TOOTH",
    photo: 6033417,
    description: "Neem bark, babul, clove, pepper and rock salt, powdered fine. Massage gums with a wet finger or a soft brush. 100 g lasts about two months.",
    attributes: { Ingredients: "Neem, babul, clove, pepper, rock salt", Weight: "100 g" },
    ...single(70, 80, 60),
  },
];

/** Goals of the home's "Shop by health goal" tiles, as product tags (existing shops get them from the relayout tag step). */
const GOALS: Record<string, string[]> = {
  "Finger millet (ragi / kezhvaragu)": ["strong-bones", "kids"],
  "Pearl millet (kambu)": ["iron"],
  "Foxtail millet (thinai)": ["steady-sugar"],
  "Little millet (samai)": ["steady-sugar", "weight"],
  "Kodo millet (varagu)": ["steady-sugar", "weight", "digestion"],
  "Barnyard millet (kuthiraivali)": ["steady-sugar", "weight"],
  "Karuppu kavuni black rice": ["steady-sugar", "iron"],
  "Poongar red rice": ["iron", "digestion"],
  "Wood-pressed gingelly (sesame) oil": ["strong-bones"],
  "Karupatti (palm jaggery)": ["iron"],
  "Palm sugar powder (panai sakkarai)": ["kids"],
  "Nattu sakkarai (country sugar)": ["kids"],
  "Whole green gram (pachai payaru)": ["steady-sugar", "weight"],
  "Split moong dal (paasi paruppu)": ["digestion"],
  "Horse gram (kollu)": ["weight", "iron"],
  "Black pepper (whole)": ["digestion"],
  "Pepper rasam powder": ["digestion"],
  "Fenugreek seeds (vendhayam)": ["steady-sugar", "digestion"],
  "Sathu maavu (multigrain health mix)": ["kids", "strong-bones"],
  "Moringa leaf powder": ["strong-bones", "iron"],
  "Wild forest honey": ["kids"],
  "Bilona cow ghee": ["kids"],
};
for (const p of PRODUCTS) if (GOALS[p.name]) p.tags = [...(p.tags ?? []), ...GOALS[p.name]!];


/** Pexels photos used by the store (credited on /pages/photo-credits). */
const PHOTOS: DemoStore["photos"] = {
  18275951: { by: "Petr Ganaj", alt: "Reddish millet grains" },
  10817550: { by: "Rajesh S Balouria", alt: "Grey pearl millet grains" },
  6103120: { by: "Eva Bronzini", alt: "Foxtail millet grains" },
  7421203: { by: "Vie Studio", alt: "Little millet in a white spoon on brown paper" },
  7421202: { by: "Vie Studio", alt: "Millet grains scattered on brown paper" },
  11519186: { by: "nnitatong", alt: "Millet ears in a bamboo winnowing basket" },
  6086557: { by: "Eva Bronzini", alt: "Red heirloom rice grains" },
  8108049: { by: "MART PRODUCTION", alt: "Red and black rice in white bowls" },
  7421207: { by: "Vie Studio", alt: "Small-grain rice on brown paper" },
  7232901: { by: "Artem Podrez", alt: "White rice grains" },
  4110263: { by: "Polina Tankilevitch", alt: "Red rice in a wooden spoon" },
  5755517: { by: "Eva Bronzini", alt: "Sesame seeds, salt and oil in wooden bowls" },
  30107827: { by: "Gundula Vogel", alt: "Groundnuts in a bowl on burlap" },
  11809347: { by: "Towfiqu barbhuiya", alt: "Bottle of coconut oil beside a cracked coconut" },
  9131994: { by: "Towfiqu barbhuiya", alt: "Coconut oil on a spoon beside a fresh coconut" },
  6086210: { by: "Eva Bronzini", alt: "Country sugar crystals" },
  3525741: { by: "Asya Vlasova", alt: "Pieces of palm jaggery on paper" },
  13746824: { by: "Quang Nguyen Vinh", alt: "Fresh jaggery being packed at a farm" },
  5740647: { by: "Eva Bronzini", alt: "Palm sugar powder poured into a bowl" },
  28110938: { by: "Surenukash Chiranjev", alt: "Unpolished dal in bulk" },
  6805060: { by: "cottonbro studio", alt: "Whole green gram" },
  7420816: { by: "Vie Studio", alt: "Green gram in wooden spoons" },
  7772002: { by: "Anna Tarazevich", alt: "Whole black gram" },
  368689: { by: "Digital Buggu", alt: "Horse gram with a metal scoop" },
  6805059: { by: "cottonbro studio", alt: "Dry white chickpeas" },
  6220708: { by: "Karl Solano", alt: "Turmeric powder and turmeric root" },
  5988689: { by: "Eva Bronzini", alt: "Whole black peppercorns" },
  6902055: { by: "Mobile Photography®", alt: "Dried red chillies" },
  5988179: { by: "Eva Bronzini", alt: "Coriander seeds" },
  7208238: { by: "Pranjall Kumar", alt: "Spice powders in small metal bowls" },
  5056631: { by: "zachariah schrueder", alt: "Indian spices on a wooden tray" },
  4475232: { by: "Maria Petersson", alt: "Coarse sea salt on a wooden spoon" },
  18495829: { by: "aditya bhatia", alt: "Tamarind pods in a wooden bowl" },
  9142634: { by: "Nidhin K S", alt: "Green cardamom spilling from a jute pouch" },
  5987968: { by: "Eva Bronzini", alt: "Fenugreek seeds" },
  5652188: { by: "Kai-Chieh Chan", alt: "Bowl of grain and green gram porridge" },
  7149595: { by: "William Greaves Brown", alt: "Moringa leaf powder with a scoop" },
  5634207: { by: "Adonyi Gábor", alt: "Jar of honey with a wooden dipper" },
  9105957: { by: "Nhà Mật", alt: "Small jar of honey on a wooden tray" },
  5471921: { by: "olia danilevich", alt: "Jar of golden ghee held in a hand" },
  9105958: { by: "Nhà Mật", alt: "Small jar of pale ghee" },
  4889029: { by: "Kaboompics", alt: "Green herbal soap bar on a wooden board" },
  6694147: { by: "Tara Winstead", alt: "Amber glass bottle of herbal oil" },
  6033417: { by: "Deeana Arts 🇵🇷", alt: "Neem leaves" },
  // categories, home and pages
  16977456: { by: "Ranjeet Chauhan", alt: "Pearl millet ears in a green field" },
  40328787: { by: "Anuj Kumar", alt: "Rice drying on a bamboo tray in the sun" },
  4294734: { by: "Tijana Drndarski", alt: "Coconut oil, grated coconut and coconuts on a wooden table" },
  13746814: { by: "Quang Nguyen Vinh", alt: "Trays of fresh jaggery at a farm" },
  3735181: { by: "Polina Tankilevitch", alt: "Cotton sack of chickpeas" },
  15741144: { by: "Samar Mourya", alt: "Sacks of spices and seeds at a market stall" },
  3737643: { by: "cottonbro studio", alt: "Jars of millet, chickpeas and vegetables" },
  9105966: { by: "Nhà Mật", alt: "Jars of honey and ghee on a wooden tray" },
  13666672: { by: "Mohammad Ibrahim", alt: "Neem leaves held in a hand" },
  7415330: { by: "Sajal's Gallery", alt: "Farmer with a hoe in a green paddy field" },
  16977457: { by: "Ranjeet Chauhan", alt: "Pearl millet crop in the sun" },
  36215713: { by: "Dibakar Roy", alt: "Child running across rows of grain drying in the sun" },
  20238486: { by: "EqualStock IN", alt: "Woman farmer holding freshly harvested crops" },
  3737645: { by: "cottonbro studio", alt: "Glass jars of grains, beans and millet" },
  1092195: { by: "ClickerHappy", alt: "Turmeric on a grinding stone beside a copper pot" },
  11165467: { by: "Jeffry Surianto", alt: "Paddy fields with a thatched hut" },
  3663404: { by: "Deepak Sharma", alt: "Sugarcane juice being boiled into jaggery" },
};

const HOURS = [
  { label: "Mon – Sat", value: "8:00 am – 9:00 pm" },
  { label: "Sunday", value: "8:00 am – 1:00 pm" },
];

const FAQ = [
  {
    q: "Is everything you sell certified organic?",
    a: "Our oils, rice, millets and pulses come from about 40 farmers we visit ourselves; 14 of them are certified under India Organic (NPOP) or PGS-India, and the rest farm without chemical sprays but are not certified yet. Every product page says which: look for **Certification** under the details.",
  },
  {
    q: "How long do millets, oils and powders keep?",
    a: "Whole millets and rice keep 6–8 months in an airtight jar, cold-pressed oils 6 months away from sunlight, and our ground masalas and health mix 4 months. We pack every week, so the packed date on your pack is never more than a few days old.",
  },
  {
    q: "How do I cook millets?",
    a: "Rinse two or three times and soak for 30 minutes. Cook like rice with 2½–3 cups of water per cup of millet: 15–20 minutes on a low flame, or 3 whistles in a cooker. Start by replacing one meal a day; our [millet guide](/pages/millet-guide) has recipes.",
  },
  {
    q: "Why does wood-pressed oil look cloudy?",
    a: "It is filtered only through cloth, so fine particles of the seed stay in it. They settle at the bottom of the bottle; that is normal and a sign it is not refined.",
  },
  { q: "Do you deliver outside Erode?", a: "Yes. Across Tamil Nadu in 2–4 days by courier, and to Kerala, Karnataka, Puducherry, Andhra Pradesh and Telangana in 4–7 days. Oils travel in sealed bottles packed in cartons." },
  { q: "Can I order a monthly kit every month?", a: "Yes. Pick a kit, tell us on WhatsApp which day of the month suits you, and we pack and send it every month. Change or skip a month with one message." },
];

const FAQ_TA = [
  {
    q: "நீங்கள் விற்பது எல்லாம் ஆர்கானிக் சான்றிதழ் பெற்றவையா?",
    a: "எங்கள் எண்ணெய், அரிசி, சிறுதானியம், பருப்பு எல்லாம் நாங்களே நேரில் பார்க்கும் சுமார் 40 விவசாயிகளிடமிருந்து வருகின்றன; அவர்களில் 14 பேர் India Organic (NPOP) அல்லது PGS-India சான்றிதழ் பெற்றவர்கள், மற்றவர்கள் ரசாயனத் தெளிப்பு இல்லாமல் விவசாயம் செய்கிறார்கள், ஆனால் இன்னும் சான்றிதழ் பெறவில்லை. ஒவ்வொரு பொருளின் பக்கத்திலும் விவரங்களில் **சான்றிதழ்** என்பதைப் பாருங்கள்.",
  },
  {
    q: "சிறுதானியம், எண்ணெய், பொடிகள் எவ்வளவு நாள் இருக்கும்?",
    a: "காற்றுப் புகாத டப்பாவில் முழு சிறுதானியமும் அரிசியும் 6–8 மாதம், வெயில் படாமல் செக்கு எண்ணெய் 6 மாதம், அரைத்த மசாலாவும் சத்து மாவும் 4 மாதம். வாரந்தோறும் பேக் செய்கிறோம், அதனால் உங்கள் பேக்கின் தேதி சில நாட்களுக்கு மேல் பழையதாக இருக்காது.",
  },
  {
    q: "சிறுதானியத்தை எப்படிச் சமைப்பது?",
    a: "இரண்டு மூன்று முறை கழுவி 30 நிமிடம் ஊறவையுங்கள். ஒரு கப் சிறுதானியத்துக்கு 2½–3 கப் தண்ணீர் விட்டு அரிசி போலச் சமையுங்கள்: குறைந்த தீயில் 15–20 நிமிடம், அல்லது குக்கரில் 3 விசில். முதலில் தினமும் ஒரு வேளை மாற்றிப் பாருங்கள்; எங்கள் [சிறுதானிய வழிகாட்டியில்](/pages/millet-guide) சமையல் குறிப்புகள் உள்ளன.",
  },
  {
    q: "செக்கு எண்ணெய் ஏன் கலங்கலாக இருக்கிறது?",
    a: "துணியில் மட்டுமே வடிகட்டுவதால் விதையின் நுண்ணிய துகள்கள் அதில் இருக்கும். அவை பாட்டிலின் அடியில் தங்கும்; அது இயல்பானது, சுத்திகரிக்கவில்லை என்பதற்கான அடையாளம்.",
  },
  { q: "ஈரோட்டுக்கு வெளியே டெலிவரி செய்வீர்களா?", a: "ஆம். தமிழ்நாடு முழுவதும் கூரியரில் 2–4 நாளில், கேரளா, கர்நாடகா, புதுச்சேரி, ஆந்திரா, தெலங்கானாவுக்கு 4–7 நாளில். எண்ணெய் சீல் செய்த பாட்டிலில், அட்டைப் பெட்டியில் பேக் செய்து அனுப்புகிறோம்." },
  { q: "ஒவ்வொரு மாதமும் மாதத் தொகுப்பு ஆர்டர் செய்யலாமா?", a: "ஆம். ஒரு தொகுப்பைத் தேர்ந்தெடுத்து, மாதத்தின் எந்த நாள் வசதி என்று வாட்ஸ்அப்பில் சொல்லுங்கள்; ஒவ்வொரு மாதமும் பேக் செய்து அனுப்புவோம். ஒரு செய்தியில் மாற்றலாம் அல்லது ஒரு மாதம் தவிர்க்கலாம்." },
];

const KITS = [
  {
    name: "Millet starter kit",
    price: rs(649),
    period: "one-time",
    description: "Six millets to try, with a recipe card for each.",
    features: ["500 g each: ragi, kambu, thinai, samai, varagu, kuthiraivali", "Recipe cards in Tamil and English", "Free cotton bag"],
  },
  {
    name: "Family monthly kit",
    price: rs(2490),
    period: "/ month",
    description: "A month's pantry for a family of four.",
    features: ["2 kg millets of your choice", "5 kg hand-pounded ponni rice", "1 litre each gingelly and groundnut oil", "1 kg toor dal, 1 kg nattu sakkarai", "Sambar powder, turmeric, tamarind", "Free delivery in Erode"],
    highlight: true,
    badge: "Most picked",
  },
  {
    name: "Wellness kit",
    price: rs(1290),
    period: "/ month",
    description: "For mornings with sathu maavu and honey.",
    features: ["1 kg sathu maavu", "500 g wild forest honey", "200 ml bilona cow ghee", "Moringa leaf powder", "250 g karupatti"],
  },
];

/** A kit's words in Tamil (typed as plain words: a mixed literal array would infer `badge?: undefined`). */
type KitWords = { name: string; period: string; description: string; features: string[]; badge?: string; cta: { label: string } };
const kitTa = (k: KitWords): KitWords => k;

/** A story chapter's words in Tamil (typed as plain words: chapters with and without a button differ in shape). */
type ChapterWords = { eyebrow: string; heading: string; markdown: string; alt: string; cta?: { label: string } };
const chapterTa = (c: ChapterWords): Record<string, string | { label: string }> => c;

export const VAYAL: DemoStore = {
  shop: {
    slug: "vayal",
    appId: "EC",
    businessType: "organic",
    planId: "pro",
    name: "Vayal Organics",
    primary: "#355e3b",
    billing: {
      legalName: "Vayal Organic Foods",
      gstin: "33AAKFV3579M1ZH",
      address: "14, Brough Road, near Panneerselvam Park",
      city: "Erode",
      pincode: "638001",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "VO",
      upiId: "vayalorganics@okicici",
    },
    items: [{ name: "Cotton carry bag", hsn: "6305", unit: "pcs", rate: 2_000, gstRate: 5 }],
  },
  preset: "earthen",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 500_000,
    minOrderValue: 30_000,
    contactPhone: PHONE,
    contactEmail: "hello@vayalorganics.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/vayalorganics" },
    policies: {
      shipping:
        "**Erode (pincodes 638xxx):** next-day delivery for orders placed before 6 pm, by our own van. ₹40 per order, free above ₹999.\n\n**Rest of Tamil Nadu:** by courier in 2–4 days, ₹90 per order, free above ₹1,999.\n\n**Kerala, Karnataka, Puducherry, Andhra Pradesh, Telangana:** by courier in 4–7 days, ₹150 per order, free above ₹2,999. Prepaid only.\n\nOils and ghee travel in sealed bottles packed in cartons.",
      returns:
        "Food can't be returned once delivered, but if anything reaches you damaged, leaking, stale or not as described, send us a photo on WhatsApp within 3 days and we replace it or refund you, no questions asked. Unopened soaps and hair oil can be returned within 7 days.",
      privacy: "We use your details only to deliver your order, send your GST bill and, if you ask for them, our harvest updates.",
      terms: "Prices include GST. Crops vary with the season: if an item runs out we call you before replacing it. Monthly kits can be changed or skipped any month.",
    },
    businessType: "organic",
  },
  zones: [
    {
      name: "Erode town",
      pincodePrefixes: ["638"],
      rate: { name: "Our van (next day)", type: "free_above", amount: 4_000, freeAbove: 99_900, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–4 days)", type: "free_above", amount: 9_000, freeAbove: 199_900, etaMinDays: 2, etaMaxDays: 4, codAllowed: true, codFee: 3_000 },
    },
    {
      name: "South India",
      states: ["32", "29", "34", "37", "36"],
      rate: { name: "Courier (4–7 days)", type: "free_above", amount: 15_000, freeAbove: 299_900, etaMinDays: 4, etaMaxDays: 7, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: MILLETS, description: "Ragi, kambu, thinai, samai, varagu and kuthiraivali: dehusked, unpolished and packed every week.", photo: 16977456 },
    { name: RICE, description: "Mappillai samba, karuppu kavuni, seeraga samba, poongar and hand-pounded ponni from the delta and the Bhavani.", photo: 40328787 },
    { name: OILS, description: "Gingelly, groundnut and coconut oils pressed slow in a wooden chekku. Unrefined, cloth filtered.", photo: 4294734 },
    { name: SUGAR, description: "Nattu sakkarai, karupatti and achu vellam: sulphur-free sweeteners made in open pans and clay pots.", photo: 13746814 },
    { name: PULSES, description: "Unpolished toor, moong, urad, horse gram and chickpeas from Tamil Nadu farms.", photo: 3735181 },
    { name: SPICES, description: "Erode turmeric, Kolli hills pepper, gundu chilli and our own stone-ground sambar and rasam powders.", photo: 15741144 },
    { name: MIXES, description: "Sathu maavu and moringa powder for children's breakfasts and grown-ups' mornings.", photo: 3737643 },
    { name: HONEY, description: "Raw forest honey from Sathyamangalam and curd-churned bilona ghee.", photo: 9105966 },
    { name: HERBAL, description: "Cold-process soaps, herbal hair oil and tooth powder made with our own oils and herbs.", photo: 13666672 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "New from the farms", slug: "new-arrivals", description: "This week's harvest arrivals and fresh packs.", rule: { sort: "new" } },
    { name: "On offer", slug: "on-offer", description: "Everything selling below MRP right now.", rule: { onSale: true, sort: "price-asc" } },
    { name: "Millets", slug: "millets", description: "All six millets, dehusked and unpolished.", rule: { category: MILLETS, sort: "name" } },
    { name: "Cold-pressed oils", slug: "cold-pressed-oils", description: "Wood-pressed gingelly, groundnut and coconut oils.", rule: { category: OILS, sort: "name" } },
    { name: "Monthly kit picks", slug: "monthly-kit", description: "What goes into our monthly kits, to buy one by one.", rule: { tag: "kit", sort: "name" } },
  ],
  coupons: [
    {
      code: "MILLET10",
      description: "10% off orders above ₹999 (up to ₹200)",
      type: "percent",
      value: 10,
      minOrder: 99_900,
      maxDiscount: 20_000,
      channels: ["store", "manual"],
    },
    {
      code: "FIRSTHARVEST",
      description: "₹100 off your first order above ₹1,499",
      type: "flat",
      value: 10_000,
      minOrder: 149_900,
      channels: ["store"],
    },
  ],
  home: ({ photo, category, product }) => {
    const pantry = [MILLETS, RICE, OILS, SUGAR, PULSES, SPICES, MIXES, HONEY, HERBAL].map(category);
    const millets = ["Foxtail millet (thinai)", "Little millet (samai)", "Kodo millet (varagu)", "Barnyard millet (kuthiraivali)"].map(product);
    const goal = (label: string, note: string, tag: string, id: number) => ({ label, note, tag, imageUrl: photo(id, "square") });
    return {
      seo: {
        title: "Vayal Organics, Erode — millets, chekku oils, country sugar",
        description: "Millets, traditional rice, wood-pressed oils, palm jaggery, unpolished dals, stone-ground masalas, honey and ghee from farmers we know. Delivered across Tamil Nadu.",
        imageUrl: photo(7415330),
      },
      // Sidebar layout (the look's page layout): the pantry, search and cart live in the left menu on desktop, so the
      // home opens straight on the farm-to-pack story and then helps choose: by health goal, millet against millet.
      sections: [
        {
          type: "sticky-story",
          id: "vy-story",
          title: "From our farms to your kitchen",
          imageSide: "left",
          chapters: [
            {
              eyebrow: "The soil",
              heading: "Grown without chemicals",
              markdown: "Our farmers in the Cauvery delta and the dry hills of Dharmapuri grow traditional rice and millets with cow manure and green leaf mulch, and **no chemical sprays**.",
              imageUrl: photo(7415330),
              alt: "Farmer with a hoe in a green paddy field",
            },
            {
              eyebrow: "The farmers",
              heading: "Forty farmers we know by name",
              markdown: "Selvi akka grows our kambu and horse gram on rain-fed land; the Ramasamy brothers send mappillai samba from the delta. We visit each farm once a season and **pay on the day of delivery**.",
              imageUrl: photo(20238486),
              alt: "Woman farmer holding freshly harvested crops",
              cta: { label: "Meet our farmers", href: "/pages/our-farmers" },
            },
            {
              eyebrow: "The harvest",
              heading: "Hand-picked, sun-dried",
              markdown: "Grain is harvested by hand, dried in the sun on the farm and dehusked in small batches, **never polished**, so it keeps its taste and fibre.",
              imageUrl: photo(36215713),
              alt: "Child running across rows of grain drying in the sun",
            },
            {
              eyebrow: "The chekku",
              heading: "Oils pressed behind the shop",
              markdown: "Sesame, groundnut and copra go through our own wooden chekku, turning slowly so the oil stays cool, then settle for a week and are **cloth filtered**. Nothing refined, nothing added.",
              imageUrl: photo(5755517),
              alt: "Wood-pressed gingelly oil",
              cta: { label: "Chekku oils", href: "/collections/cold-pressed-oils" },
            },
            {
              eyebrow: "The pack",
              heading: "Packed every week, in cloth and paper",
              markdown: "No plastic: cloth bags for rice, paper for flours and glass for oils, with the **packed date** on every pack. Bring them back for a refill discount.",
              imageUrl: photo(1092195),
              alt: "Turmeric on a grinding stone beside a copper pot",
              cta: { label: "Shop the pantry", href: "/products" },
            },
          ],
        },
        {
          type: "hero-split",
          id: "vy-hero",
          imageUrl: photo(16977457, "tile"),
          imageSide: "right",
          eyebrow: "Six millets, one swap a day",
          heading: "Start with thinai pongal or ragi dosa.",
          text: "Millets grow on rain alone and cook like rice. A recipe card comes free with every millet order, in Tamil and English.",
          cta: { label: "Shop millets", href: "/collections/millets" },
          cta2: { label: "Our millet guide", href: "/pages/millet-guide" },
          style: { background: "muted" },
        },
        {
          type: "tiles",
          id: "vy-goals",
          title: "Shop by health goal",
          text: "What our customers come in for, and what their grandmothers would have handed them. Food, not medicine: ask your doctor about your diet.",
          layout: "grid",
          showCounts: true,
          items: [
            goal("Steady sugar", "Low-GI millets, unpolished rice, fenugreek", "steady-sugar", 6103120),
            goal("Strong bones", "Ragi, gingelly, moringa leaf", "strong-bones", 18275951),
            goal("Iron & energy", "Kambu, karupatti, black rice", "iron", 10817550),
            goal("Light on the waist", "Horse gram, kuthiraivali, green gram", "weight", 368689),
            goal("Easy digestion", "Varagu, red rice, pepper rasam", "digestion", 4110263),
            goal("Kids' tiffin", "Sathu maavu, honey, ghee, palm sugar", "kids", 5652188),
          ],
        },
        {
          type: "comparison",
          id: "vy-millets",
          title: "Four rice-swap millets, side by side",
          text: "All four cook like rice in 15–20 minutes. Values per 100 g raw grain, approximate (ICMR-NIN food tables).",
          productIds: millets,
          highlightId: product("Foxtail millet (thinai)"),
          highlightLabel: "Easiest first swap",
          showRating: false,
          rows: [
            { label: "Tastes like", values: ["Nutty, a little sweet", "Mild, soft", "Earthy, chewy", "Light, fluffy"] },
            { label: "Protein", values: ["≈ 12 g", "≈ 8 g", "≈ 8 g", "≈ 11 g"] },
            { label: "Fibre", values: ["≈ 8 g", "≈ 8 g", "≈ 9 g", "≈ 10 g"] },
            { label: "Water : millet", values: ["2½ : 1", "2½ : 1", "3 : 1", "2½ : 1"] },
            { label: "Try it as", values: ["Pongal, payasam", "Curd rice, upma", "Lemon rice, kichadi", "Fasting days, biryani"] },
            { label: "Grown in", values: ["Dharmapuri", "Javadhu hills", "Dharmapuri", "Salem"] },
          ],
        },
        { type: "categories", id: "vy-pantry", title: "Shop the pantry", categoryIds: pantry, layout: "bento", showCounts: true },
        {
          type: "pricing-table",
          id: "vy-kits",
          title: "Monthly kits & combos",
          text: "Packed fresh, delivered on the day of the month you choose. Change or skip any month with one WhatsApp message.",
          plans: KITS.map((k) => ({ ...k, cta: { label: "Order on WhatsApp", href: orderLink(`Hello Vayal Organics, I'd like the ${k.name}.`) } })),
          style: { background: "muted" },
        },
        {
          type: "deal",
          id: "vy-deal",
          title: "Deal of the week",
          text: "Our 18-grain sathu maavu, roasted and ground this week. Free recipe card with every pack.",
          productId: product("Sathu maavu (multigrain health mix)"),
          style: { span: "half" },
        },
        {
          type: "newsletter",
          id: "vy-letter",
          layout: "card",
          heading: "Harvest notes, once a month",
          text: "What's just come in from the farms, a millet recipe and this month's kit offer. No spam.",
          style: { span: "half" },
        },
        {
          type: "testimonials",
          id: "vy-words",
          title: "Kitchens that switched",
          layout: "cards",
          items: [
            { quote: "My father's sugar readings came down after three months of thinai and samai at dinner. The recipe cards made it easy for my mother to start.", name: "Karthika R.", role: "Perundurai", rating: 5 },
            { quote: "The gingelly oil smells exactly like the chekku oil from my grandmother's village. I won't go back to packet oil.", name: "Saravanan P.", role: "Coimbatore", rating: 5 },
            { quote: "The family monthly kit comes on the 2nd of every month without me asking. Fresh, well packed, and the karupatti is real.", name: "Deepa M.", role: "Chennai", rating: 5 },
          ],
        },
        { type: "faq", id: "vy-faq", title: "Questions we're asked", items: FAQ },
        {
          type: "location",
          id: "vy-visit",
          title: "Visit the store",
          address: "14, Brough Road, near Panneerselvam Park, Erode 638001",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "11.3410, 77.7172",
        },
      ],
      translations: {
        ta: {
          "vy-story": {
            title: "எங்கள் வயல்களிலிருந்து உங்கள் சமையலறைக்கு",
            chapters: [
              chapterTa({
                eyebrow: "மண்",
                heading: "இரசாயனமின்றி விளைந்தவை",
                markdown: "காவிரிப் படுகையிலும் தருமபுரியின் வறண்ட மலைகளிலும் எங்கள் விவசாயிகள் மாட்டுச் சாணமும் பசுந்தாள் உரமும் இட்டு, **இரசாயனத் தெளிப்பின்றி** பாரம்பரிய அரிசியும் சிறுதானியங்களும் விளைவிக்கிறார்கள்.",
                alt: "பசுமையான நெல் வயலில் மண்வெட்டியுடன் விவசாயி",
              }),
              chapterTa({
                eyebrow: "விவசாயிகள்",
                heading: "பெயர் சொல்லித் தெரிந்த நாற்பது விவசாயிகள்",
                markdown: "செல்வி அக்கா மானாவாரி நிலத்தில் எங்களுக்குக் கம்பும் கொள்ளும் விளைவிக்கிறார்; ராமசாமி சகோதரர்கள் டெல்டாவிலிருந்து மாப்பிள்ளை சம்பா அனுப்புகிறார்கள். ஒவ்வொரு பண்ணைக்கும் பருவத்துக்கு ஒருமுறை செல்கிறோம், **சரக்கு வந்த அன்றே பணம்**.",
                alt: "அறுவடை செய்த பயிருடன் பெண் விவசாயி",
                cta: { label: "எங்கள் விவசாயிகள்" },
              }),
              chapterTa({
                eyebrow: "அறுவடை",
                heading: "கையால் அறுத்து, வெயிலில் உலர்த்தியது",
                markdown: "தானியம் கையால் அறுவடை செய்யப்பட்டு, வயலிலேயே வெயிலில் உலர்த்தி, சிறு அளவில் உமி நீக்கப்படுகிறது; **பாலிஷ் இல்லை**, சுவையும் நார்ச்சத்தும் மாறாது.",
                alt: "வெயிலில் உலரும் தானிய வரிசைகளின் நடுவே ஓடும் குழந்தை",
              }),
              chapterTa({
                eyebrow: "செக்கு",
                heading: "கடையின் பின்னால் ஆட்டிய எண்ணெய்",
                markdown: "எள், கடலை, கொப்பரை எங்கள் சொந்த மரச்செக்கில் மெதுவாகச் சுற்றி ஆட்டப்படுகின்றன, எண்ணெய் சூடாவதில்லை; ஒரு வாரம் தெளிய வைத்து **துணியில் வடிகட்டுகிறோம்**. சுத்திகரிப்பு இல்லை, எதுவும் சேர்ப்பதில்லை.",
                alt: "மரச்செக்கு நல்லெண்ணெய்",
                cta: { label: "செக்கு எண்ணெய்கள்" },
              }),
              chapterTa({
                eyebrow: "பொதி",
                heading: "வாரந்தோறும், துணியிலும் காகிதத்திலும் பொதி",
                markdown: "பிளாஸ்டிக் இல்லை: அரிசிக்குத் துணிப் பை, மாவுக்குக் காகிதம், எண்ணெய்க்குக் கண்ணாடி; ஒவ்வொரு பொதியிலும் **பேக் தேதி**. திரும்பக் கொண்டு வந்தால் மறுநிரப்புத் தள்ளுபடி.",
                alt: "செப்புப் பாத்திரம் அருகே அம்மிக்கல்லில் மஞ்சள்",
                cta: { label: "சரக்கறையில் வாங்க" },
              }),
            ],
          },
          "vy-hero": {
            eyebrow: "ஆறு சிறுதானியங்கள், தினம் ஒரு மாற்றம்",
            heading: "தினைப் பொங்கல் அல்லது கேழ்வரகு தோசையுடன் தொடங்குங்கள்.",
            text: "சிறுதானியங்கள் மழையில் மட்டுமே விளைகின்றன, அரிசி போலவே சமைக்கலாம். ஒவ்வொரு சிறுதானிய ஆர்டருக்கும் தமிழ், ஆங்கிலத்தில் சமையல் குறிப்பு அட்டை இலவசம்.",
            cta: { label: "சிறுதானியம் வாங்கு" },
            cta2: { label: "சிறுதானிய வழிகாட்டி" },
          },
          "vy-goals": {
            title: "உடல்நல இலக்கு வாரியாக",
            text: "எங்கள் வாடிக்கையாளர்கள் தேடி வருவதும், அவர்கள் பாட்டிகள் கொடுத்திருப்பதும். இது உணவு, மருந்து அல்ல: உங்கள் உணவு பற்றி மருத்துவரிடம் கேளுங்கள்.",
            items: [
              { label: "சீரான சர்க்கரை", note: "குறைந்த GI சிறுதானியம், பாலிஷ் இல்லா அரிசி, வெந்தயம்" },
              { label: "வலுவான எலும்பு", note: "கேழ்வரகு, நல்லெண்ணெய், முருங்கை இலை" },
              { label: "இரும்புச்சத்து, ஆற்றல்", note: "கம்பு, கருப்பட்டி, கருப்பு அரிசி" },
              { label: "இடுப்புக்கு லேசு", note: "கொள்ளு, குதிரைவாலி, பச்சைப் பயறு" },
              { label: "எளிய செரிமானம்", note: "வரகு, சிவப்பு அரிசி, மிளகு ரசம்" },
              { label: "குழந்தைகள் டிஃபின்", note: "சத்து மாவு, தேன், நெய், பனைச் சர்க்கரை" },
            ],
          },
          "vy-millets": {
            title: "அரிசிக்கு மாற்றான நான்கு சிறுதானியங்கள், அருகருகே",
            text: "நான்கும் அரிசி போல 15–20 நிமிடத்தில் வேகும். 100 கி பச்சைத் தானியத்துக்கான தோராய அளவுகள் (ICMR-NIN உணவு அட்டவணை).",
            highlightLabel: "முதல் மாற்றத்துக்கு எளியது",
            rows: [
              { label: "சுவை", values: ["கொட்டை மணம், லேசான இனிப்பு", "மிதமான, மென்மை", "மண் மணம், மெல்லும் தன்மை", "லேசான, பஞ்சு போல"] },
              { label: "புரதம்", values: ["≈ 12 கி", "≈ 8 கி", "≈ 8 கி", "≈ 11 கி"] },
              { label: "நார்ச்சத்து", values: ["≈ 8 கி", "≈ 8 கி", "≈ 9 கி", "≈ 10 கி"] },
              { label: "தண்ணீர் : தானியம்", values: ["2½ : 1", "2½ : 1", "3 : 1", "2½ : 1"] },
              { label: "இப்படிச் செய்யுங்கள்", values: ["பொங்கல், பாயசம்", "தயிர் சாதம், உப்புமா", "எலுமிச்சை சாதம், கிச்சடி", "விரத நாட்கள், பிரியாணி"] },
              { label: "விளையும் இடம்", values: ["தருமபுரி", "ஜவ்வாது மலை", "தருமபுரி", "சேலம்"] },
            ],
          },
          "vy-pantry": { title: "எங்கள் சரக்கறை" },
          "vy-kits": {
            title: "மாதத் தொகுப்புகள் & காம்போக்கள்",
            text: "புதிதாக பேக் செய்து, நீங்கள் தேர்ந்தெடுக்கும் தேதியில் டெலிவரி. ஒரு வாட்ஸ்அப் செய்தியில் எந்த மாதமும் மாற்றலாம் அல்லது தவிர்க்கலாம்.",
            plans: [
              kitTa({
                name: "சிறுதானிய அறிமுகத் தொகுப்பு",
                period: "ஒருமுறை",
                description: "சுவைத்துப் பார்க்க ஆறு சிறுதானியங்கள், ஒவ்வொன்றுக்கும் சமையல் குறிப்பு அட்டையுடன்.",
                features: ["தலா 500 கி: கேழ்வரகு, கம்பு, தினை, சாமை, வரகு, குதிரைவாலி", "தமிழ், ஆங்கிலத்தில் சமையல் குறிப்பு அட்டைகள்", "இலவச பருத்திப் பை"],
                cta: { label: "வாட்ஸ்அப்பில் ஆர்டர்" },
              }),
              kitTa({
                name: "குடும்ப மாதத் தொகுப்பு",
                period: "/ மாதம்",
                description: "நான்கு பேர் கொண்ட குடும்பத்துக்கு ஒரு மாதச் சரக்கு.",
                features: ["நீங்கள் விரும்பும் 2 கிலோ சிறுதானியம்", "5 கிலோ கைக்குத்தல் பொன்னி அரிசி", "தலா 1 லிட்டர் நல்லெண்ணெய், கடலை எண்ணெய்", "1 கிலோ துவரம் பருப்பு, 1 கிலோ நாட்டுச் சர்க்கரை", "சாம்பார் பொடி, மஞ்சள், புளி", "ஈரோட்டில் இலவச டெலிவரி"],
                badge: "அதிகம் தேர்ந்தது",
                cta: { label: "வாட்ஸ்அப்பில் ஆர்டர்" },
              }),
              kitTa({
                name: "நலவாழ்வுத் தொகுப்பு",
                period: "/ மாதம்",
                description: "சத்து மாவும் தேனும் கொண்ட காலைகளுக்கு.",
                features: ["1 கிலோ சத்து மாவு", "500 கி காட்டுத் தேன்", "200 மி.லி. பிலோனா பசு நெய்", "முருங்கை இலைப் பொடி", "250 கி கருப்பட்டி"],
                cta: { label: "வாட்ஸ்அப்பில் ஆர்டர்" },
              }),
            ],
          },
          "vy-deal": { title: "இந்த வார டீல்", text: "இந்த வாரம் வறுத்து அரைத்த எங்கள் 18 தானிய சத்து மாவு. ஒவ்வொரு பேக்குடனும் சமையல் குறிப்பு அட்டை இலவசம்." },
          "vy-letter": {
            heading: "மாதம் ஒருமுறை அறுவடைக் குறிப்புகள்",
            text: "பண்ணைகளிலிருந்து புதிதாக வந்தவை, ஒரு சிறுதானிய சமையல் குறிப்பு, இந்த மாதத் தொகுப்புச் சலுகை. ஸ்பேம் இல்லை.",
          },
          "vy-words": {
            title: "மாறிய சமையலறைகள்",
            items: [
              { quote: "இரவு உணவில் மூன்று மாதம் தினையும் சாமையும் சாப்பிட்ட பிறகு அப்பாவின் சர்க்கரை அளவு குறைந்தது. சமையல் குறிப்பு அட்டைகளால் அம்மாவுக்குத் தொடங்குவது எளிதாக இருந்தது.", role: "பெருந்துறை" },
              { quote: "நல்லெண்ணெய் என் பாட்டியின் கிராமத்துச் செக்கு எண்ணெய் போலவே மணக்கிறது. இனி பாக்கெட் எண்ணெய்க்குத் திரும்ப மாட்டேன்.", role: "கோயம்புத்தூர்" },
              { quote: "குடும்ப மாதத் தொகுப்பு கேட்காமலேயே ஒவ்வொரு மாதமும் 2-ஆம் தேதி வந்துவிடுகிறது. புதியது, நன்றாக பேக் செய்தது, கருப்பட்டி அசல்.", role: "சென்னை" },
            ],
          },
          "vy-faq": { title: "எங்களிடம் கேட்கப்படும் கேள்விகள்", items: FAQ_TA },
          "vy-visit": {
            title: "கடைக்கு வாருங்கள்",
            address: "14, பிரப் ரோடு, பன்னீர்செல்வம் பூங்கா அருகில், ஈரோடு 638001",
            hours: [
              { label: "திங்கள் – சனி", value: "காலை 8:00 – இரவு 9:00" },
              { label: "ஞாயிறு", value: "காலை 8:00 – மதியம் 1:00" },
            ],
          },
        },
      },
    };
  },
  pages: [
    {
      slug: "our-farmers",
      title: "Our farmers",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Forty farms, one store" },
        {
          type: "paragraph",
          markdown:
            "Vayal (வயல்) means *field*. We started in 2014 as a Saturday stall outside Panneerselvam Park selling one farmer's mappillai samba. Today about **40 farming families** across Tamil Nadu grow for us:\n\n- **Millets and horse gram** from rain-fed land in Dharmapuri and the Javadhu hills\n- **Heirloom rice** from the Thanjavur and Tiruvarur delta and along the Bhavani\n- **Sesame and groundnuts** from Erode and Tiruvannamalai, pressed in our own wooden chekku\n- **Karupatti** from palmyra climbers in Udangudi; **honey** from tribal gatherers in Sathyamangalam\n\nWe visit every farm once a season, agree a fair price before sowing and pay on the day the harvest arrives. Fourteen farms are certified organic (India Organic or PGS-India); we are helping the others through the three-year conversion.",
        },
        { type: "image", url: photo(11165467), alt: "Paddy fields with a thatched hut" },
        { type: "heading", level: 3, text: "Pressed behind the shop" },
        {
          type: "paragraph",
          markdown:
            "Our vaagai-wood chekku turns slowly, about 14 rounds a minute, so the seed never heats up. A batch of 12 kg of sesame gives about 5 litres of oil and takes four hours. We press three days a week and bottle the same day.",
        },
        { type: "image", url: photo(3663404), alt: "Sugarcane juice being boiled into jaggery" },
      ],
    },
    {
      slug: "millet-guide",
      title: "Millet guide",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Cooking millets: a quick guide" },
        { type: "image", url: photo(3737645), alt: "Glass jars of grains, beans and millet" },
        {
          type: "paragraph",
          markdown:
            "| Millet | Tamil | Water per cup | Best for |\n|---|---|---|---|\n| Foxtail | தினை (thinai) | 2½ cups | Pongal, upma, biryani |\n| Little | சாமை (samai) | 2½ cups | Curd rice, lemon rice |\n| Kodo | வரகு (varagu) | 3 cups | Sambar sadham, khichdi |\n| Barnyard | குதிரைவாலி (kuthiraivali) | 2½ cups | Idli, dosa, payasam |\n| Pearl | கம்பு (kambu) | 4 cups | Koozh, dosa, adai |\n| Finger | கேழ்வரகு (ragi) | — (as flour) | Kali, dosa, puttu, malt |\n\n1. **Rinse** two or three times until the water runs clear.\n2. **Soak** 30 minutes (kambu: 2 hours).\n3. **Cook** like rice on a low flame for 15–20 minutes, or 3 whistles in a cooker. Rest 5 minutes and fluff with a fork.\n\nStart with one meal a day and drink more water: millets have more fibre than rice.",
        },
        { type: "heading", level: 3, text: "Thinai pongal (serves 3)" },
        {
          type: "paragraph",
          markdown:
            "Dry-roast ½ cup moong dal. Pressure-cook it with 1 cup foxtail millet and 4 cups water for 4 whistles. Temper pepper, cumin, ginger, curry leaves and cashews in 2 spoons of ghee, pour over, add salt and mash. Serve hot with coconut chutney.",
        },
        { type: "button", label: "Shop millets", href: "/collections/millets", style: "primary" },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' subjects, not our farmers, customers or staff.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(
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
      { label: "Millets", type: "collection", ref: "millets" },
      { label: "Chekku oils", type: "collection", ref: "cold-pressed-oils" },
      { label: "Monthly kits", type: "collection", ref: "monthly-kit" },
      { label: "Offers", type: "collection", ref: "on-offer" },
      { label: "Our farmers", type: "page", ref: "our-farmers" },
      { label: "Millet guide", type: "page", ref: "millet-guide" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Track your order", type: "url", href: "/track" },
          { label: "Call the store", type: "url", href: `tel:${PHONE}` },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "About",
        type: "url",
        children: [
          { label: "Our farmers", type: "page", ref: "our-farmers" },
          { label: "Millet guide", type: "page", ref: "millet-guide" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
