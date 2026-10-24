import type { DemoProduct, DemoStore, DemoVariant } from "./types";

/**
 * Store #3 of the series: Cauvery Fresh Market, Trichy (cauvery.localhost:3003). A daily-fresh shop for vegetables,
 * fruits, chicken, mutton, fish and eggs on the online store app (EC) with the `fresh` trade (scales feature) and the
 * "crisp-greens" look (leaf green on a near-white page). Names are generic (no brands); prices are typical Trichy
 * counter prices in late 2026, per pack weight, GST included. Address, phone and GSTIN are placeholders like the other
 * demo shops.
 *
 * GST: fresh / chilled vegetables, fruits, meat, poultry, fish, crustaceans and eggs in shell (HSN 0701–0714,
 * 0801–0810, 0201–0208, 0302, 0306–0307, 0407) are nil-rated when not pre-packaged and labelled; the one prepared
 * item (marinated, ready-to-cook chicken, HSN 1602) is 5% (rates after the 22 Sep 2025 rationalisation).
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500033";
const WHATSAPP = "919876500033";
const orderLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

/** Variants of two options with their own prices: rows are [price ₹, MRP ₹, stock] for every (a, b) pair, a first. */
function grid(a: string, as: string[], b: string, bs: string[], rows: [number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  if (rows.length !== as.length * bs.length) throw new Error(`grid ${a} × ${b}: ${rows.length} rows`);
  const variants: DemoVariant[] = [];
  as.forEach((x, i) =>
    bs.forEach((y, j) => {
      const [price, mrp, stock] = rows[i * bs.length + j]!;
      variants.push({ values: { [a]: x, [b]: y }, price: rs(price), mrp: rs(mrp), stock });
    }),
  );
  return { options: [{ name: a, values: as }, { name: b, values: bs }], variants };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

const VEG = "Vegetables";
const FRUITS = "Fruits";
const CHICKEN = "Chicken";
const MUTTON = "Mutton";
const FISH = "Fish & seafood";
const EGGS = "Eggs";

const WEIGHED = "Weighed on a stamped scale; you pay for the exact weight.";
const GROSS = "Priced on the weight before cleaning; cleaning and cutting are free.";

const PRODUCTS: DemoProduct[] = [
  // ---- vegetables (nil GST: fresh vegetables, HSN 0701–0709)
  {
    name: "Tomato (country)",
    category: VEG,
    hsn: "0702",
    gstRate: 0,
    unit: "kg",
    sku: "CF-TOM",
    photo: 29479888,
    tags: ["fast-mover"],
    description: `Firm, tangy country tomatoes from Manapparai and Thuraiyur farms, picked half-ripe so they last the week. Right for rasam, chutney and thokku. ${WEIGHED}`,
    attributes: { Origin: "Manapparai, Thuraiyur", Variety: "Country (nattu)" },
    ...one("Weight", [
      ["500 g", 22, 26, 180],
      ["1 kg", 40, 48, 220],
      ["2 kg", 78, 92, 90],
    ]),
  },
  {
    name: "Big onion",
    category: VEG,
    hsn: "0703",
    gstRate: 0,
    unit: "kg",
    sku: "CF-ONI",
    photo: 38088072,
    tags: ["fast-mover"],
    description: `Dry, tight-skinned big onions with a good bite, sorted by hand so there are no soft ones in your bag. Keeps for two weeks in a cool, airy basket. ${WEIGHED}`,
    attributes: { Origin: "Perambalur, Nashik", Variety: "Red big onion" },
    ...one("Weight", [
      ["500 g", 22, 25, 200],
      ["1 kg", 42, 48, 260],
      ["2 kg", 82, 94, 120],
    ]),
  },
  {
    name: "Small onion (sambar onion)",
    category: VEG,
    hsn: "0703",
    gstRate: 0,
    unit: "kg",
    sku: "CF-SHL",
    photo: 20234942,
    tags: ["fast-mover"],
    description: `Perambalur small onions for sambar, vatha kuzhambu and chutney. Cleaned of dry tops and roots; ask for "peeled" in the order note and we peel them for ₹20 a kg. ${WEIGHED}`,
    attributes: { Origin: "Perambalur", Variety: "Shallot (chinna vengayam)" },
    ...one("Weight", [
      ["250 g", 22, 26, 150],
      ["500 g", 42, 50, 140],
      ["1 kg", 80, 95, 80],
    ]),
  },
  {
    name: "Potato",
    category: VEG,
    hsn: "0701",
    gstRate: 0,
    unit: "kg",
    sku: "CF-POT",
    photo: 10899606,
    description: `Medium, even-sized potatoes that cook through evenly for fry, kurma and masala. No green or sprouted ones. ${WEIGHED}`,
    attributes: { Origin: "Ooty, Agra", Variety: "Jyoti" },
    ...one("Weight", [
      ["500 g", 20, 24, 200],
      ["1 kg", 38, 45, 240],
      ["2 kg", 74, 88, 100],
    ]),
  },
  {
    name: "Ooty carrot",
    category: VEG,
    hsn: "0706",
    gstRate: 0,
    unit: "kg",
    sku: "CF-CAR",
    photo: 16812115,
    description: `Sweet, crunchy hill carrots from the Nilgiris, washed and trimmed. Good raw in salads and for poriyal, halwa and juice. ${WEIGHED}`,
    attributes: { Origin: "Ooty (Nilgiris)" },
    ...one("Weight", [
      ["250 g", 18, 22, 120],
      ["500 g", 34, 40, 110],
      ["1 kg", 66, 78, 60],
    ]),
  },
  {
    name: "French beans",
    category: VEG,
    hsn: "0708",
    gstRate: 0,
    unit: "kg",
    sku: "CF-BNS",
    photo: 34387471,
    description: `Tender, stringless beans that snap clean. For poriyal, kootu and fried rice. Ask in the order note and we cut them fine for poriyal. ${WEIGHED}`,
    attributes: { Origin: "Kodaikanal hills" },
    ...one("Weight", [
      ["250 g", 20, 25, 100],
      ["500 g", 38, 46, 90],
      ["1 kg", 74, 90, 40],
    ]),
  },
  {
    name: "Brinjal (violet)",
    category: VEG,
    hsn: "0709",
    gstRate: 0,
    unit: "kg",
    sku: "CF-BRN",
    photo: 6316542,
    description: `Glossy violet brinjals with green caps, picked young so they have few seeds. Right for ennai kathirikai, kootu and sambar. ${WEIGHED}`,
    attributes: { Origin: "Lalgudi" },
    ...one("Weight", [
      ["250 g", 12, 15, 120],
      ["500 g", 22, 28, 110],
      ["1 kg", 42, 52, 60],
    ]),
  },
  {
    name: "Ladies finger (okra)",
    category: VEG,
    hsn: "0709",
    gstRate: 0,
    unit: "kg",
    sku: "CF-OKR",
    photo: 38272573,
    description: `Tender ladies finger that snaps at the tip, picked every morning. For vendakkai poriyal, mor kuzhambu and fry. ${WEIGHED}`,
    attributes: { Origin: "Srirangam, Lalgudi" },
    ...one("Weight", [
      ["250 g", 14, 18, 120],
      ["500 g", 26, 32, 100],
      ["1 kg", 50, 60, 50],
    ]),
  },
  {
    name: "Beetroot",
    category: VEG,
    hsn: "0706",
    gstRate: 0,
    unit: "kg",
    sku: "CF-BET",
    photo: 20517382,
    description: `Deep red, firm beetroot with the leaves trimmed. Sweet enough for poriyal and halwa, and good for juice. ${WEIGHED}`,
    attributes: { Origin: "Ooty (Nilgiris)" },
    ...one("Weight", [
      ["500 g", 24, 28, 90],
      ["1 kg", 46, 54, 50],
    ]),
  },
  {
    name: "Green chilli",
    category: VEG,
    hsn: "0709",
    gstRate: 0,
    unit: "kg",
    sku: "CF-CHL",
    photo: 10899475,
    description: `Medium-hot green chillies with fresh stalks, sorted so there are no red or soft ones. A 100 g pack lasts a family about a week. ${WEIGHED}`,
    attributes: { Origin: "Thuraiyur", Variety: "Medium hot" },
    ...one("Weight", [
      ["100 g", 8, 10, 200],
      ["250 g", 18, 22, 120],
    ]),
  },
  {
    name: "Coriander leaves (bunch)",
    category: VEG,
    hsn: "0709",
    gstRate: 0,
    unit: "bunch",
    sku: "CF-COR",
    photo: 3866618,
    tags: ["fast-mover"],
    description: "A fresh bunch of fragrant country coriander with the roots on, about 100 g. Wrap it in a damp cloth or paper in the fridge and it stays green for 4–5 days.",
    attributes: { Origin: "Srirangam", Weight: "About 100 g" },
    ...single(10, 12, 300),
  },
  {
    name: "Cauliflower",
    category: VEG,
    hsn: "0704",
    gstRate: 0,
    unit: "pcs",
    sku: "CF-CAU",
    photo: 6631953,
    description: "Tight, creamy-white cauliflower heads with fresh green leaves, sold by the piece. For gobi 65, kurma and poriyal. Soak the florets in warm salt water before cooking.",
    attributes: { Origin: "Ooty, Hosur" },
    ...one("Size", [
      ["Medium (about 600 g)", 35, 40, 60],
      ["Large (about 900 g)", 50, 58, 40],
    ]),
  },
  {
    name: "Cabbage",
    category: VEG,
    hsn: "0704",
    gstRate: 0,
    unit: "kg",
    sku: "CF-CAB",
    photo: 6316537,
    description: `Firm, heavy green cabbage with the loose outer leaves removed. For poriyal, kootu and coleslaw; we halve a big head on request. ${WEIGHED}`,
    attributes: { Origin: "Ooty, Hosur" },
    ...one("Weight", [
      ["500 g", 16, 20, 80],
      ["1 kg", 30, 36, 60],
    ]),
  },

  // ---- fruits (nil GST: fresh fruit, HSN 0801–0810)
  {
    name: "Banana",
    category: FRUITS,
    hsn: "0803",
    gstRate: 0,
    unit: "dozen",
    sku: "CF-BAN",
    photo: 30543146,
    tags: ["fast-mover"],
    description: "Ripe bananas by the dozen from the Cauvery delta: small, sweet poovan for every day, robusta for milkshakes and red bananas for the evening snack. Ripened naturally, no carbide.",
    attributes: { Origin: "Thottiyam, Musiri" },
    ...one("Variety", [
      ["Poovan", 60, 70, 80],
      ["Robusta", 55, 65, 60],
      ["Red banana", 120, 140, 30],
    ]),
  },
  {
    name: "Apple (Shimla)",
    category: FRUITS,
    hsn: "0808",
    gstRate: 0,
    unit: "kg",
    sku: "CF-APL",
    photo: 3903599,
    description: `Crisp, juicy red apples from Himachal, new season. Unwaxed: wash and eat with the skin. ${WEIGHED}`,
    attributes: { Origin: "Shimla, Himachal Pradesh", Variety: "Royal Delicious" },
    ...one("Weight", [
      ["500 g", 95, 110, 70],
      ["1 kg", 180, 210, 50],
    ]),
  },
  {
    name: "Pomegranate",
    category: FRUITS,
    hsn: "0810",
    gstRate: 0,
    unit: "kg",
    sku: "CF-POM",
    photo: 20349779,
    description: `Bhagwa pomegranates with deep red, sweet arils and thin skin. Heavy for their size, which means juicy. ${WEIGHED}`,
    attributes: { Origin: "Solapur, Maharashtra", Variety: "Bhagwa" },
    ...one("Weight", [
      ["500 g", 90, 105, 60],
      ["1 kg", 170, 200, 40],
    ]),
  },
  {
    name: "Papaya",
    category: FRUITS,
    hsn: "0807",
    gstRate: 0,
    unit: "pcs",
    sku: "CF-PAP",
    photo: 28613331,
    description: "Red lady papaya, ripe in a day or two. Tell us in the order note if you want it ready to eat today, or green for kootu, and we pick it that way.",
    attributes: { Origin: "Thottiyam", Variety: "Red Lady" },
    ...one("Size", [
      ["About 1 kg", 45, 55, 40],
      ["About 1.5 kg", 65, 75, 30],
    ]),
  },
  {
    name: "Watermelon (kiran)",
    category: FRUITS,
    hsn: "0807",
    gstRate: 0,
    unit: "pcs",
    sku: "CF-WAT",
    photo: 3429784,
    description: "Small, dark-striped kiran watermelons with sweet, crisp red flesh. Whole, or cut in half and wrapped so you can see what you get.",
    attributes: { Origin: "Tindivanam", Variety: "Kiran" },
    ...one("Pack", [
      ["Whole (about 2 kg)", 60, 70, 40],
      ["Half, wrapped (about 1 kg)", 32, 38, 30],
    ]),
  },
  {
    name: "Orange (Nagpur)",
    category: FRUITS,
    hsn: "0805",
    gstRate: 0,
    unit: "kg",
    sku: "CF-ORG",
    photo: 34742202,
    description: `New-season Nagpur oranges: loose skin, easy to peel, sweet with a little tang. Good for juice too. ${WEIGHED}`,
    attributes: { Origin: "Nagpur, Maharashtra" },
    ...one("Weight", [
      ["500 g", 55, 65, 60],
      ["1 kg", 105, 120, 50],
    ]),
  },
  {
    name: "Green grapes (seedless)",
    category: FRUITS,
    hsn: "0806",
    gstRate: 0,
    unit: "kg",
    sku: "CF-GRP",
    photo: 6489360,
    description: `Seedless green grapes in tight bunches, kept cold till they leave the shop. Wash just before eating. ${WEIGHED}`,
    attributes: { Origin: "Theni, Cumbum", Variety: "Thompson seedless" },
    ...one("Weight", [
      ["500 g", 60, 70, 50],
      ["1 kg", 115, 135, 30],
    ]),
  },
  {
    name: "Guava",
    category: FRUITS,
    hsn: "0804",
    gstRate: 0,
    unit: "kg",
    sku: "CF-GUA",
    photo: 38542293,
    description: `Crunchy white guavas from the Lalgudi orchards, just turning yellow. Eat with salt and chilli powder. ${WEIGHED}`,
    attributes: { Origin: "Lalgudi" },
    ...one("Weight", [
      ["500 g", 40, 48, 60],
      ["1 kg", 75, 90, 40],
    ]),
  },
  {
    name: "Tender coconut",
    category: FRUITS,
    hsn: "0801",
    gstRate: 0,
    unit: "pcs",
    sku: "CF-TCN",
    photo: 35296318,
    description: "Green tender coconuts from Pollachi with plenty of sweet water and soft malai. Cut and sealed with a straw hole on request (tell us in the order note).",
    attributes: { Origin: "Pollachi" },
    ...one("Pack", [
      ["1 nut", 45, 50, 120],
      ["4 nuts", 170, 200, 30],
    ]),
  },

  // ---- chicken (nil GST: fresh poultry and offal, HSN 0207; marinated is prepared meat, HSN 1602, 5%)
  {
    name: "Chicken curry cut (broiler)",
    category: CHICKEN,
    hsn: "0207",
    gstRate: 0,
    unit: "kg",
    sku: "CF-CCC",
    photo: 8251004,
    tags: ["fast-mover", "ready-to-cook"],
    description: "Fresh broiler chicken cut after you order into 12–14 even curry pieces with bone, washed and drained. Never frozen. Weight is the cleaned, cut weight you get.",
    attributes: { "Prepared as": "Curry cut, 12–14 pieces per kg", Origin: "Farms around Namakkal" },
    ...grid("Skin", ["Skinless", "With skin"], "Weight", ["500 g", "1 kg"], [
      [135, 150, 60],
      [260, 290, 80],
      [120, 135, 40],
      [230, 260, 50],
    ]),
  },
  {
    name: "Chicken boneless (breast)",
    category: CHICKEN,
    hsn: "0207",
    gstRate: 0,
    unit: "kg",
    sku: "CF-CBL",
    photo: 6107735,
    tags: ["ready-to-cook"],
    description: "Skinless, boneless breast fillets, trimmed of fat. Cubed for chilli chicken and biryani or left whole for grilling; tell us in the order note.",
    attributes: { "Prepared as": "Boneless breast" },
    ...one("Weight", [
      ["250 g", 95, 110, 50],
      ["500 g", 185, 210, 50],
      ["1 kg", 360, 400, 30],
    ]),
  },
  {
    name: "Chicken leg pieces",
    category: CHICKEN,
    hsn: "0207",
    gstRate: 0,
    unit: "kg",
    sku: "CF-CLG",
    photo: 7140318,
    description: "Whole legs (thigh with drumstick), skinless, scored for marinade. Juicier than breast: right for tandoori, fry and biryani.",
    attributes: { "Prepared as": "Whole leg, skinless" },
    ...one("Weight", [
      ["500 g", 150, 170, 40],
      ["1 kg", 290, 330, 30],
    ]),
  },
  {
    name: "Country chicken (nattu kozhi)",
    category: CHICKEN,
    hsn: "0207",
    gstRate: 0,
    unit: "kg",
    sku: "CF-NKZ",
    photo: 10842246,
    tags: ["deal"],
    description: "Free-range country chicken from villages around Musiri, dressed fresh in the morning: firmer meat and a deeper taste for nattu kozhi kuzhambu and soup. About 1–1.2 kg a bird.",
    attributes: { "Prepared as": "Whole cleaned or curry cut", Origin: "Musiri, Thottiyam" },
    ...one("Cut", [
      ["Curry cut (per kg)", 520, 580, 25],
      ["Whole, cleaned (per kg)", 500, 560, 15],
    ]),
  },
  {
    name: "Chicken liver & gizzard",
    category: CHICKEN,
    hsn: "0207",
    gstRate: 0,
    unit: "kg",
    sku: "CF-CLV",
    photo: 6281495,
    description: "Fresh liver and gizzard, cleaned and washed, in about equal parts. For pepper fry and kuzhambu. Limited stock each morning.",
    attributes: { "Prepared as": "Liver and gizzard, cleaned" },
    ...one("Weight", [
      ["250 g", 45, 55, 30],
      ["500 g", 85, 100, 20],
    ]),
  },
  {
    name: "Chicken 65, marinated (ready to cook)",
    category: CHICKEN,
    hsn: "1602",
    gstRate: 5,
    unit: "pack",
    sku: "CF-C65",
    photo: 13422436,
    tags: ["ready-to-cook"],
    description: "Boneless chicken in our own chicken 65 marinade (ginger, garlic, Kashmiri chilli, curry leaves; no colour), packed and labelled the same morning. Deep-fry for 6–7 minutes. Keep chilled and cook within 24 hours.",
    attributes: { "Prepared as": "Boneless, marinated", "Best before": "24 hours, chilled" },
    ...one("Pack", [
      ["250 g", 99, 120, 30],
      ["500 g", 189, 220, 25],
    ]),
  },

  // ---- mutton (nil GST: fresh goat meat and offal, HSN 0204 / 0206)
  {
    name: "Mutton curry cut (goat, with bone)",
    category: MUTTON,
    hsn: "0204",
    gstRate: 0,
    unit: "kg",
    sku: "CF-MCC",
    photo: 6281507,
    tags: ["fast-mover", "ready-to-cook"],
    description: "Tender goat meat from young local goats, cut to order into curry pieces with bone and a little fat for flavour. Washed and drained; the weight is what you get.",
    attributes: { "Prepared as": "Curry cut, with bone", Origin: "Local goats, Trichy district" },
    ...one("Weight", [
      ["500 g", 420, 460, 40],
      ["1 kg", 820, 900, 30],
    ]),
  },
  {
    name: "Mutton boneless",
    category: MUTTON,
    hsn: "0204",
    gstRate: 0,
    unit: "kg",
    sku: "CF-MBL",
    photo: 6281509,
    description: "Lean boneless goat meat from the leg, cut into even cubes for biryani, sukka and kebabs.",
    attributes: { "Prepared as": "Boneless cubes (leg)" },
    ...one("Weight", [
      ["500 g", 520, 570, 25],
      ["1 kg", 1020, 1120, 15],
    ]),
  },
  {
    name: "Mutton keema",
    category: MUTTON,
    hsn: "0204",
    gstRate: 0,
    unit: "kg",
    sku: "CF-MKM",
    photo: 7225581,
    tags: ["ready-to-cook"],
    description: "Goat meat minced fresh after you order, from lean shoulder with a little fat. For keema, cutlets and kola urundai.",
    attributes: { "Prepared as": "Minced" },
    ...one("Weight", [
      ["250 g", 230, 260, 30],
      ["500 g", 450, 500, 20],
    ]),
  },
  {
    name: "Mutton chops (ribs)",
    category: MUTTON,
    hsn: "0204",
    gstRate: 0,
    unit: "kg",
    sku: "CF-MCH",
    photo: 6281506,
    description: "Rib chops from young goats, cut 1 inch thick. For chops fry, pepper chops and the grill.",
    attributes: { "Prepared as": "Rib chops, 1 inch" },
    ...one("Weight", [
      ["500 g", 440, 480, 20],
      ["1 kg", 860, 940, 10],
    ]),
  },
  {
    name: "Mutton liver (eeral)",
    category: MUTTON,
    hsn: "0206",
    gstRate: 0,
    unit: "kg",
    sku: "CF-MLV",
    photo: 18606624,
    description: "Fresh goat liver, cleaned and cut into pieces for eeral varuval and pepper fry. Only a few kilos a day: order early.",
    attributes: { "Prepared as": "Cleaned, pieces" },
    ...one("Weight", [
      ["250 g", 180, 200, 15],
      ["500 g", 350, 390, 10],
    ]),
  },

  // ---- fish & seafood (nil GST: fresh / chilled fish, crustaceans and molluscs, HSN 0302, 0306, 0307)
  {
    name: "Seer fish (vanjaram)",
    category: FISH,
    hsn: "0302",
    gstRate: 0,
    unit: "kg",
    sku: "CF-SEER",
    photo: 38220999,
    tags: ["fast-mover", "deal"],
    description: `King of the catch for fry and kuzhambu: firm, boneless vanjaram from the Nagapattinam boats, iced at the harbour and on our counter by 6 am. Steaks are cut ½ inch thick. ${GROSS}`,
    attributes: { "Prepared as": "Steaks or whole cleaned", Origin: "Nagapattinam harbour" },
    ...grid("Cut", ["Steaks", "Whole, cleaned"], "Weight", ["500 g", "1 kg"], [
      [620, 700, 20],
      [1200, 1350, 15],
      [560, 640, 10],
      [1080, 1220, 8],
    ]),
  },
  {
    name: "White pomfret (vavval)",
    category: FISH,
    hsn: "0302",
    gstRate: 0,
    unit: "kg",
    sku: "CF-POMF",
    photo: 31534520,
    description: `Silver-white pomfret, 3–4 fish a kilo, fresh on ice. Whole for tawa fry, or cleaned and scored ready for masala. ${GROSS}`,
    attributes: { "Prepared as": "Whole or cleaned & scored", Origin: "Nagapattinam, Rameswaram" },
    ...grid("Cut", ["Whole", "Cleaned & scored"], "Weight", ["500 g", "1 kg"], [
      [450, 520, 15],
      [880, 1000, 10],
      [450, 520, 15],
      [880, 1000, 10],
    ]),
  },
  {
    name: "Sardine (mathi)",
    category: FISH,
    hsn: "0302",
    gstRate: 0,
    unit: "kg",
    sku: "CF-SAR",
    photo: 33202002,
    tags: ["fast-mover"],
    description: `Oily, fresh mathi for kuzhambu and fry: the best value on the counter and full of omega-3. Cleaned means head off, gutted and washed. ${GROSS}`,
    attributes: { "Prepared as": "Whole or cleaned", Origin: "Pamban, Tuticorin" },
    ...grid("Cut", ["Whole", "Cleaned"], "Weight", ["500 g", "1 kg"], [
      [80, 95, 40],
      [150, 180, 30],
      [80, 95, 40],
      [150, 180, 30],
    ]),
  },
  {
    name: "Mackerel (ayala)",
    category: FISH,
    hsn: "0302",
    gstRate: 0,
    unit: "kg",
    sku: "CF-MAC",
    photo: 39118581,
    description: `Bright-eyed Indian mackerel, 6–8 fish a kilo. Whole for kuzhambu, or cleaned and slit for fry. ${GROSS}`,
    attributes: { "Prepared as": "Whole or cleaned & slit", Origin: "Nagapattinam" },
    ...grid("Cut", ["Whole", "Cleaned & slit"], "Weight", ["500 g", "1 kg"], [
      [110, 130, 30],
      [210, 250, 25],
      [110, 130, 30],
      [210, 250, 25],
    ]),
  },
  {
    name: "Prawns (medium)",
    category: FISH,
    hsn: "0306",
    gstRate: 0,
    unit: "kg",
    sku: "CF-PRW",
    photo: 33202174,
    tags: ["ready-to-cook"],
    description: "Medium sea prawns (40–50 a kilo) from the morning catch. Buy them whole, or peeled and deveined, ready for thokku, fry and biryani; the peeled weight is what you get.",
    attributes: { "Prepared as": "Whole or peeled & deveined", Origin: "Nagapattinam" },
    ...grid("Cut", ["Whole", "Peeled & deveined"], "Weight", ["250 g", "500 g"], [
      [120, 140, 30],
      [230, 270, 25],
      [170, 195, 20],
      [330, 380, 15],
    ]),
  },
  {
    name: "Sea crab (nandu)",
    category: FISH,
    hsn: "0306",
    gstRate: 0,
    unit: "kg",
    sku: "CF-CRB",
    photo: 32987812,
    description: `Blue swimmer crabs, 4–6 a kilo, for nandu rasam and masala. Cleaned means shell lifted, gills removed and halved. ${GROSS}`,
    attributes: { "Prepared as": "Whole or cleaned & halved", Origin: "Pamban" },
    ...grid("Cut", ["Whole", "Cleaned & halved"], "Weight", ["500 g", "1 kg"], [
      [220, 260, 15],
      [420, 500, 10],
      [220, 260, 15],
      [420, 500, 10],
    ]),
  },
  {
    name: "Squid (kanava)",
    category: FISH,
    hsn: "0307",
    gstRate: 0,
    unit: "kg",
    sku: "CF-SQD",
    photo: 9995821,
    description: "Fresh squid for pepper fry and thokku. Whole, or cleaned and cut into rings; rings are the cleaned weight you get.",
    attributes: { "Prepared as": "Whole or cleaned rings", Origin: "Nagapattinam" },
    ...one("Cut", [
      ["Whole, 500 g", 190, 220, 15],
      ["Cleaned rings, 500 g", 240, 280, 10],
    ]),
  },
  {
    name: "Red snapper (sankara)",
    category: FISH,
    hsn: "0302",
    gstRate: 0,
    unit: "kg",
    sku: "CF-SNP",
    photo: 33201991,
    description: `Pink-red sankara with white, flaky meat: the everyday fish for kuzhambu. Whole cleaned, or steaks. ${GROSS}`,
    attributes: { "Prepared as": "Whole cleaned or steaks", Origin: "Chennai, Nagapattinam" },
    ...grid("Cut", ["Whole, cleaned", "Steaks"], "Weight", ["500 g", "1 kg"], [
      [230, 260, 20],
      [440, 500, 15],
      [250, 280, 15],
      [480, 540, 10],
    ]),
  },

  // ---- eggs (nil GST: birds' eggs in shell, HSN 0407)
  {
    name: "Farm eggs",
    category: EGGS,
    hsn: "0407",
    gstRate: 0,
    unit: "pack",
    sku: "CF-EGG",
    photo: 34851176,
    tags: ["fast-mover"],
    description: "Fresh hen eggs from Namakkal farms, never more than 3 days old, candled and packed in trays so none crack on the way. The NECC rate changes daily; this is today's.",
    attributes: { Origin: "Namakkal" },
    ...one("Pack", [
      ["6 eggs", 40, 42, 120],
      ["12 eggs", 78, 84, 100],
      ["Tray of 30", 190, 210, 40],
    ]),
  },
  {
    name: "Country eggs (nattu kozhi muttai)",
    category: EGGS,
    hsn: "0407",
    gstRate: 0,
    unit: "pack",
    sku: "CF-NEG",
    photo: 4184073,
    description: "Small brown eggs from free-range country hens in villages near Musiri: richer yolks, a favourite for children and for half-boil. Collected every two days.",
    attributes: { Origin: "Musiri villages" },
    ...one("Pack", [
      ["6 eggs", 90, 100, 40],
      ["12 eggs", 175, 195, 20],
    ]),
  },
  {
    name: "Quail eggs (kaadai muttai)",
    category: EGGS,
    hsn: "0407",
    gstRate: 0,
    unit: "pack",
    sku: "CF-QEG",
    photo: 6620059,
    description: "Speckled quail eggs, five times the yolk per gram of a hen's egg. Boil 3 minutes for a snack or add to kuzhambu.",
    attributes: { Origin: "Namakkal" },
    ...one("Pack", [
      ["12 eggs", 45, 50, 30],
      ["24 eggs", 85, 95, 15],
    ]),
  },
];

/** Pexels photos used by the store (credited on /pages/photo-credits). Photographers as their Pexels handles read. */
const PHOTOS: DemoStore["photos"] = {
  29479888: { by: "Vishnu Gopal", alt: "Ripe red tomatoes at a Coimbatore market" },
  38088072: { by: "Shaddam Hossain", alt: "Pile of fresh onions" },
  20234942: { by: "Ian Panelo", alt: "Bunches of small red onions at a stall" },
  10899606: { by: "Engin Akyurt", alt: "Fresh potatoes" },
  16812115: { by: "Rockwell Branding Agency", alt: "Pile of carrots" },
  34387471: { by: "Ram Kondisetti", alt: "Fresh green beans" },
  6316542: { by: "Arina Krasnikova", alt: "Violet brinjals" },
  38272573: { by: "Shaddam Hossain", alt: "Fresh ladies finger at a market" },
  20517382: { by: "Planka", alt: "Pile of beetroots" },
  10899475: { by: "Engin Akyurt", alt: "Green chillies" },
  3866618: { by: "Habib Sohan", alt: "Green coriander leaves" },
  6631953: { by: "Alesia Kozik", alt: "White cauliflower with leaves" },
  6316537: { by: "Arina Krasnikova", alt: "Fresh green cabbages" },
  30543146: { by: "Claudia Almeida", alt: "Bunches of yellow bananas" },
  3903599: { by: "Dmitry Demidov", alt: "Red apples" },
  20349779: { by: "Tanmay Tiwari", alt: "Pile of pomegranates" },
  28613331: { by: "Nishant Aneja", alt: "Papayas with orange flesh" },
  3429784: { by: "Frostroomhead", alt: "Watermelon slices" },
  34742202: { by: "Ram Kondisetti", alt: "Oranges piled at a market" },
  6489360: { by: "Lucas George Wendt", alt: "Green grapes" },
  38542293: { by: "Anandita Wagh", alt: "Green guavas at a market" },
  35296318: { by: "Ansh Maurya", alt: "Tender coconuts at an Indian market" },
  8251004: { by: "Filirovska", alt: "Raw chicken pieces" },
  6107735: { by: "Alleksana", alt: "Chicken breasts on a marble plate" },
  7140318: { by: "Filirovska", alt: "Raw chicken legs" },
  10842246: { by: "Karyna Panchenko", alt: "Whole dressed chicken" },
  6281495: { by: "Ragil Tagiyev", alt: "Chicken liver and gizzard on a board" },
  13422436: { by: "Mateusz Feliksik", alt: "Marinated chicken pieces" },
  6281507: { by: "Ragil Tagiyev", alt: "Mutton pieces on a chopping board" },
  6281509: { by: "Ragil Tagiyev", alt: "Boneless mutton on a board" },
  7225581: { by: "Eva Bronzini", alt: "Minced meat in a bowl" },
  6281506: { by: "Ragil Tagiyev", alt: "Mutton chops on a board" },
  18606624: { by: "Izafi", alt: "Fresh liver at a butcher's counter" },
  38220999: { by: "Masuma Rahaman", alt: "Fish steaks with herbs and lime" },
  31534520: { by: "Muddasir Mahmood", alt: "Pomfret on ice" },
  33202002: { by: "Manojmk Brucelee", alt: "Fresh sardines at a Chennai market" },
  39118581: { by: "Mugdha Peter", alt: "Two mackerels on a plate" },
  33202174: { by: "Manojmk Brucelee", alt: "Prawns in a basket at a Chennai market" },
  32987812: { by: "Manojmk Brucelee", alt: "Blue crabs at a market" },
  9995821: { by: "Ronny Siegel", alt: "Squid at a market" },
  33201991: { by: "Manojmk Brucelee", alt: "Red snappers at a Chennai market" },
  34851176: { by: "Jahratreza", alt: "Eggs stacked in trays" },
  4184073: { by: "Rio Lecatompessy", alt: "Brown eggs in a bowl" },
  6620059: { by: "Polina Kovaleva", alt: "Brown eggs and quail eggs" },
  // categories, home and pages
  5807481: { by: "Ravikant", alt: "Vegetable seller at a local bazaar" },
  37904043: { by: "Roman Saienko", alt: "Fruit stall in an Indian market" },
  10842249: { by: "Karyna Panchenko", alt: "Dressed chicken from above" },
  31647676: { by: "Darksight Image", alt: "Butcher cutting fresh meat" },
  28785535: { by: "Joerg Hartmann", alt: "Fresh fish at a Mangaluru market" },
  38912506: { by: "Joolsmagools", alt: "Trays of brown eggs" },
  37083829: { by: "Ram Kondisetti", alt: "Fresh vegetables in baskets" },
  39340133: { by: "Athul Karuva", alt: "Morning fish market in India" },
  26244103: { by: "Amjed Wani", alt: "Butchers cutting mutton to order" },
  16723207: { by: "Moh Adbelghaffar", alt: "Basket of fresh vegetables" },
  5418661: { by: "Olia Danilevich", alt: "Fresh vegetables on a green table" },
  35069422: { by: "Absoluteabhi", alt: "Street market with fresh vegetables" },
};

const HOURS = [
  { label: "Mon – Sat", value: "6:00 am – 9:30 pm" },
  { label: "Sunday", value: "5:30 am – 1:00 pm" },
];

const SLOTS = "- **7 – 9 am** and **9 – 11 am**: order by 10 pm the night before\n- **5 – 7 pm**: order by 2 pm the same day\n- Sundays: morning slots only (meat and fish sell out early)";
const SLOTS_TA = "- **காலை 7 – 9**, **9 – 11**: முந்தைய நாள் இரவு 10 மணிக்குள் ஆர்டர்\n- **மாலை 5 – 7**: அதே நாள் மதியம் 2 மணிக்குள் ஆர்டர்\n- ஞாயிறு: காலை நேரங்கள் மட்டும் (இறைச்சி, மீன் சீக்கிரம் தீர்ந்துவிடும்)";

const FAQ = [
  {
    q: "How fresh is it, really?",
    a: "Vegetables and fruits come from the Gandhi Market wholesale yard and nearby farms at 4 am; fish from the Nagapattinam boats is iced at the harbour and reaches us by 6 am; chicken and mutton are cut only after you order. What is left in the evening goes to our staff and a local home, never into tomorrow's orders.",
  },
  {
    q: "Do you cut and clean the meat and fish?",
    a: "Yes, free. Pick the cut on the product (curry cut, boneless, steaks, cleaned, peeled) and add anything else in the order note: small pieces, skin on, head kept for kuzhambu. Fish is priced on the weight before cleaning; chicken, mutton and peeled prawns on the weight you get.",
  },
  { q: "What are the delivery slots?", a: SLOTS },
  {
    q: "Is there a minimum order?",
    a: "₹199. Delivery is ₹30 in Trichy city and free above ₹499; ₹60 to Samayapuram, Lalgudi and Manachanallur, free above ₹999.",
  },
  { q: "What if something is not fresh?", a: "Tell the delivery person at the door or WhatsApp us a photo the same day: we replace it in the next slot or refund it, no questions." },
  { q: "Is it weighed correctly?", a: "Everything is weighed on a stamped electronic scale and the printed label goes on the pack. You pay for the exact weight; if a cut comes in under the pack weight we refund the difference." },
];

const FAQ_TA = [
  {
    q: "உண்மையிலேயே எவ்வளவு புதியது?",
    a: "காய்கறி, பழங்கள் காந்தி மார்க்கெட் மொத்த சந்தையிலிருந்தும் அருகிலுள்ள தோட்டங்களிலிருந்தும் அதிகாலை 4 மணிக்கு வருகின்றன; நாகப்பட்டினம் படகுகளின் மீன் துறைமுகத்திலேயே ஐஸ் போடப்பட்டு காலை 6 மணிக்குள் வருகிறது; கோழி, ஆட்டிறைச்சி நீங்கள் ஆர்டர் செய்த பிறகே வெட்டப்படுகின்றன. மாலையில் மீதமானது நாளைய ஆர்டருக்குப் போவதில்லை.",
  },
  {
    q: "இறைச்சி, மீனை வெட்டி சுத்தம் செய்து தருவீர்களா?",
    a: "ஆம், இலவசமாக. பொருளில் வெட்டு முறையைத் தேர்வு செய்யுங்கள் (கறி வெட்டு, எலும்பில்லாதது, துண்டுகள், சுத்தம் செய்தது, தோல் உரித்தது); மற்றவற்றை ஆர்டர் குறிப்பில் சொல்லுங்கள். மீன் சுத்தம் செய்வதற்கு முந்தைய எடையில்; கோழி, ஆட்டிறைச்சி, உரித்த இறால் நீங்கள் பெறும் எடையில்.",
  },
  { q: "டெலிவரி நேரங்கள் என்ன?", a: SLOTS_TA },
  {
    q: "குறைந்தபட்ச ஆர்டர் உண்டா?",
    a: "₹199. திருச்சி நகருக்குள் டெலிவரி ₹30, ₹499-க்கு மேல் இலவசம்; சமயபுரம், லால்குடி, மண்ணச்சநல்லூருக்கு ₹60, ₹999-க்கு மேல் இலவசம்.",
  },
  { q: "ஏதாவது புதிதாக இல்லையென்றால்?", a: "வாசலிலேயே டெலிவரி செய்பவரிடம் சொல்லுங்கள் அல்லது அதே நாள் வாட்ஸ்அப்பில் புகைப்படம் அனுப்புங்கள்: அடுத்த நேரத்தில் மாற்றித் தருவோம் அல்லது பணத்தைத் திருப்பித் தருவோம்." },
  { q: "சரியாக எடை போடுகிறீர்களா?", a: "எல்லாமே முத்திரையிட்ட மின்னணு தராசில் எடை போடப்பட்டு, அச்சிட்ட லேபிள் பேக்கில் ஒட்டப்படுகிறது. சரியான எடைக்கு மட்டுமே செலுத்துங்கள்; குறைந்தால் வித்தியாசத்தைத் திருப்பித் தருவோம்." },
];

export const CAUVERY: DemoStore = {
  shop: {
    slug: "cauvery",
    appId: "EC",
    businessType: "fresh",
    planId: "pro",
    name: "Cauvery Fresh Market",
    primary: "#1a7f37",
    billing: {
      legalName: "Cauvery Fresh Market",
      gstin: "33AAKFC5821M1ZB",
      address: "14, Sastri Road, Thillai Nagar",
      city: "Tiruchirappalli",
      pincode: "620018",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "CF",
      upiId: "cauveryfresh@okicici",
    },
    items: [],
  },
  preset: "crisp-greens",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 500_000,
    minOrderValue: 19_900,
    contactPhone: PHONE,
    contactEmail: "orders@cauveryfresh.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/cauveryfresh" },
    policies: {
      shipping: `**Delivery slots:**\n\n${SLOTS}\n\n**Trichy city, Srirangam and Thiruverumbur (620 xxx):** ₹30 per order, free above ₹499.\n\n**Samayapuram, Lalgudi, Manachanallur (621 xxx):** ₹60, free above ₹999.\n\nMeat and fish travel in insulated bags with ice packs. Minimum order ₹199.`,
      returns:
        "Fresh food can't be returned, but it must be right: if anything is not fresh, short on weight or cut the wrong way, tell the delivery person or WhatsApp us a photo the same day and we replace it in the next slot or refund it.",
      privacy: "We use your details only to deliver your order, send your bill and, if you ask for it, today's prices on WhatsApp.",
      terms: "Prices include GST (fresh produce, meat, fish and eggs are nil-rated). Prices change every morning with the market; the price on your bill is the price on the day of delivery. Weighed items are billed on the exact weight.",
    },
    businessType: "fresh",
  },
  zones: [
    {
      name: "Trichy city (morning slots)",
      pincodePrefixes: ["620"],
      rate: { name: "Slot delivery (same / next morning)", type: "free_above", amount: 3_000, freeAbove: 49_900, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Samayapuram, Lalgudi, Manachanallur",
      pincodePrefixes: ["621"],
      rate: { name: "Slot delivery (next morning)", type: "free_above", amount: 6_000, freeAbove: 99_900, etaMinDays: 1, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
  ],
  categories: [
    { name: VEG, description: "Tomatoes, onions, beans, greens and hill vegetables, bought at 4 am from Gandhi Market and the farms around Trichy.", photo: 5807481 },
    { name: FRUITS, description: "Bananas from the Cauvery delta, Lalgudi guavas, apples, pomegranates and seasonal fruit, ripened naturally.", photo: 37904043 },
    { name: CHICKEN, description: "Broiler and country chicken, cut after you order: curry cut, boneless, legs, liver and ready-to-cook.", photo: 10842249 },
    { name: MUTTON, description: "Tender goat meat from local goats: curry cut, boneless, keema, chops and liver, cut to order.", photo: 31647676 },
    { name: FISH, description: "The morning catch from Nagapattinam and Pamban: vanjaram, pomfret, mathi, ayala, prawns, crab and squid, cleaned free.", photo: 28785535 },
    { name: EGGS, description: "Namakkal farm eggs, country eggs and quail eggs, fresh every two days.", photo: 38912506 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "Today's fresh stock", slug: "new-arrivals", description: "What came in this morning.", rule: { sort: "new" } },
    { name: "Today's deals", slug: "on-offer", description: "Everything below MRP today, cheapest first.", rule: { onSale: true, sort: "price-asc" } },
    { name: "Sea catch", slug: "sea-catch", description: "This morning's fish and seafood from Nagapattinam and Pamban, cleaned free.", rule: { category: FISH, sort: "name" } },
    { name: "Ready to cook", slug: "ready-to-cook", description: "Cut, cleaned, peeled or marinated: straight into the pan.", rule: { tag: "ready-to-cook", sort: "name" } },
    { name: "Daily vegetables", slug: "daily-vegetables", description: "The everyday basket: tomatoes, onions, potatoes, beans and greens.", rule: { category: VEG, sort: "name" } },
  ],
  coupons: [
    {
      code: "FRESH75",
      description: "₹75 off your first order above ₹599",
      type: "flat",
      value: 7_500,
      minOrder: 59_900,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      channels: ["store"],
    },
    {
      code: "SUNDAY10",
      description: "10% off orders above ₹999 (up to ₹150)",
      type: "percent",
      value: 10,
      minOrder: 99_900,
      maxDiscount: 15_000,
      channels: ["store", "manual"],
    },
  ],
  home: ({ photo, category, product }) => {
    const cats = [VEG, FRUITS, CHICKEN, MUTTON, FISH, EGGS].map(category);
    const deepavali = [
      "Mutton curry cut (goat, with bone)",
      "Mutton boneless",
      "Mutton keema",
      "Chicken curry cut (broiler)",
      "Country chicken (nattu kozhi)",
      "Chicken 65, marinated (ready to cook)",
      "Prawns (medium)",
      "Seer fish (vanjaram)",
    ].map(product);
    const story = (title: string, text: string, id: number, href: string, ctaLabel: string) => ({ title, text, imageUrl: photo(id, "tile"), href, ctaLabel });
    return {
      seo: {
        title: "Cauvery Fresh Market, Trichy — vegetables, fruits, meat & fish",
        description: "Fresh vegetables, fruits, chicken, mutton, fish and eggs in Trichy. Cut and cleaned to order, weighed on a stamped scale, delivered in morning slots.",
        imageUrl: photo(37083829),
      },
      // Standard layout + phone tabs (the look's page layout): a daily-order shop used from the phone, so the home is
      // the morning market in order: what came in (stories), the week's pre-booking, then the market counter by counter.
      sections: [
        {
          type: "hero",
          id: "cv-hero",
          slides: [
            {
              imageUrl: photo(37083829),
              heading: "Picked at dawn. At your door by 9.",
              subheading: "Vegetables, fruits, chicken, mutton and fish for Trichy kitchens — weighed exactly, cut to order, in a morning slot.",
              cta: { label: "Shop today's stock", href: "/collections/new-arrivals" },
            },
            {
              imageUrl: photo(39340133),
              heading: "This morning's catch, cleaned free.",
              subheading: "Vanjaram, pomfret, mathi and prawns from the Nagapattinam boats. Pick whole, cleaned or steaks.",
              cta: { label: "See the sea catch", href: "/collections/sea-catch" },
            },
          ],
        },
        {
          type: "stories",
          id: "cv-market",
          title: "This morning at the market",
          layout: "rings",
          items: [
            story("4 am, Gandhi Market", "Tomatoes, onions and greens bought off the farmers' carts before sunrise.", 35069422, "/collections/daily-vegetables", "Today's vegetables"),
            story("The boats are in", "Vanjaram, pomfret and prawns off the Nagapattinam boats, on ice by 6.", 39340133, "/collections/sea-catch", "See the catch"),
            story("Cut after you order", "Curry cut, boneless or steaks: nothing is cut until you choose.", 26244103, "/pages/cutting-guide", "Cutting guide"),
            story("Delta fruit", "Poovan bananas from the Cauvery delta and Lalgudi guavas, ripened naturally.", 37904043, "/c/fruits", "Shop fruits"),
            story("Saturday's country chicken", "Nattu kozhi from farms near Musiri, dressed to order.", 10842249, "/c/chicken", "Shop chicken"),
            story("Namakkal eggs", "Farm, country and quail eggs, never older than two days.", 38912506, "/c/eggs", "Shop eggs"),
            story("Packed for your slot", "Weighed on a stamped scale, meat and fish on ice packs.", 16723207, "/pages/delivery-slots", "Delivery slots"),
          ],
        },
        {
          type: "flash-sale",
          id: "cv-deepavali",
          title: "Deepavali morning: book your mutton now",
          text: "Mutton, chicken and prawns at this week's rates for delivery on Deepavali morning (6–9 am). Pre-booking closes the night before.",
          endsAt: "2026-11-07T22:00:00+05:30",
          source: "pick",
          productIds: deepavali,
          layout: "carousel",
          limit: 8,
          cta: { label: "Delivery slots", href: "/pages/delivery-slots" },
        },
        { type: "category-shelf", id: "cv-shelf", title: "Walk the market, counter by counter", categoryIds: cats, showImages: true, limit: 8 },
        {
          type: "menu-board",
          id: "cv-rates",
          title: "Today's rates",
          style: { background: "muted" },
          groups: [
            {
              name: "Vegetables (per kg)",
              items: [
                { name: "Tomato (country)", price: rs(40), diet: "veg" },
                { name: "Big onion", price: rs(42), diet: "veg" },
                { name: "Small onion", price: rs(80), diet: "veg" },
                { name: "Potato", price: rs(38), diet: "veg" },
                { name: "Ooty carrot", price: rs(66), diet: "veg" },
              ],
            },
            {
              name: "Meat & fish (per kg)",
              items: [
                { name: "Chicken, skinless curry cut", price: rs(260), diet: "nonveg" },
                { name: "Mutton curry cut", price: rs(820), diet: "nonveg" },
                { name: "Seer fish steaks", price: rs(1200), diet: "nonveg" },
                { name: "Sardine", price: rs(150), diet: "nonveg" },
                { name: "Prawns, medium", price: rs(460), diet: "nonveg" },
              ],
            },
            {
              name: "Fruits & eggs",
              items: [
                { name: "Poovan banana", description: "per dozen", price: rs(60), diet: "veg" },
                { name: "Pomegranate", description: "per kg", price: rs(170), diet: "veg" },
                { name: "Guava", description: "per kg", price: rs(75), diet: "veg" },
                { name: "Farm eggs", description: "tray of 30", price: rs(190), diet: "egg" },
              ],
            },
          ],
          cta: { label: "Get rates on WhatsApp every morning", href: orderLink("Hello Cauvery Fresh, please send me today's rates every morning.") },
        },
        { type: "deal", id: "cv-deal", title: "Catch of the day", text: "Vanjaram steaks cut ½ inch thick, on our counter by 6 am. Only 20 kg today.", productId: product("Seer fish (vanjaram)") },
        {
          type: "image-text",
          id: "cv-cut",
          imageUrl: photo(26244103),
          imageSide: "left",
          heading: "Cut & cleaned to order",
          markdown:
            "Nothing is cut before you order. Pick the cut on the product and tell us the rest in the order note.\n\n- **Chicken:** curry cut, boneless, legs, small pieces for 65\n- **Mutton:** curry cut with bone, boneless, keema, chops\n- **Fish:** whole, cleaned, slit or ½-inch steaks\n\nCleaning and cutting are always free.",
          cta: { label: "See the cutting guide", href: "/pages/cutting-guide" },
          style: { span: "half", background: "muted" },
        },
        {
          type: "image-text",
          id: "cv-slots",
          imageUrl: photo(16723207),
          imageSide: "right",
          heading: "Morning delivery slots",
          markdown: `Pick a slot at checkout. Meat and fish travel in insulated bags with ice packs.\n\n${SLOTS}\n\nTrichy city ₹30, free above ₹499.`,
          cta: { label: "Delivery areas & slots", href: "/pages/delivery-slots" },
          style: { span: "half", background: "muted" },
        },
        { type: "bestsellers", id: "cv-best", title: "Bestsellers in Trichy", layout: "carousel", limit: 10 },
        {
          type: "testimonials",
          id: "cv-reviews",
          title: "What Trichy kitchens say",
          layout: "carousel",
          items: [
            { quote: "The vanjaram was cut exactly as I asked and reached before 8:30. My mother checked the eyes and gills and approved — that is the real test.", name: "Revathi S.", role: "Thillai Nagar", rating: 5 },
            { quote: "I order the weekly vegetables and Sunday mutton together. The weight on the label always matches, and the curry cut has no tiny bone chips.", name: "Karthik R.", role: "K.K. Nagar", rating: 5 },
            { quote: "Country chicken and country eggs I could not find near Srirangam. Now it comes every Saturday morning, cleaned.", name: "Lakshmi Narayanan", role: "Srirangam", rating: 5 },
          ],
        },
        { type: "faq", id: "cv-faq", title: "Freshness, cutting & delivery", items: FAQ },
        {
          type: "location",
          id: "cv-location",
          title: "Visit the market",
          address: "14, Sastri Road, Thillai Nagar, Tiruchirappalli 620018 (near the Thillai Nagar main road signal)",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "10.8262, 78.6844",
          style: { span: "half" },
        },
        {
          type: "newsletter",
          id: "cv-news",
          layout: "card",
          imageUrl: photo(5418661),
          heading: "Today's prices, every morning at 6",
          text: "One short WhatsApp or email with today's rates, the catch of the day and the deals. No spam.",
          style: { span: "half" },
        },
      ],
      translations: {
        ta: {
          "cv-hero": {
            slides: [
              {
                heading: "விடியலில் பறித்தது. 9-க்குள் வீட்டில்.",
                subheading: "திருச்சி சமையலறைகளுக்கு காய்கறி, பழம், கோழி, ஆட்டிறைச்சி, மீன் — சரியான எடை, ஆர்டருக்கு ஏற்ப வெட்டி, காலை நேரத்தில்.",
                cta: { label: "இன்றைய சரக்கை வாங்குங்கள்" },
              },
              {
                heading: "இன்று காலை பிடித்த மீன், இலவசமாக சுத்தம் செய்து.",
                subheading: "நாகப்பட்டினம் படகுகளின் வஞ்சிரம், வவ்வால், மத்தி, இறால். முழுதாக, சுத்தம் செய்து அல்லது துண்டுகளாக.",
                cta: { label: "கடல் மீன்களைப் பாருங்கள்" },
              },
            ],
          },
          "cv-market": {
            title: "இன்று காலை மார்க்கெட்டில்",
            items: [
              { title: "அதிகாலை 4, காந்தி மார்க்கெட்", text: "தக்காளி, வெங்காயம், கீரை சூரிய உதயத்துக்கு முன் விவசாயிகளின் வண்டிகளிலிருந்தே.", ctaLabel: "இன்றைய காய்கறி" },
              { title: "படகுகள் வந்துவிட்டன", text: "நாகப்பட்டினம் படகுகளின் வஞ்சிரம், வவ்வால், இறால், 6 மணிக்குள் ஐஸில்.", ctaLabel: "மீன்களைப் பாருங்கள்" },
              { title: "ஆர்டருக்குப் பிறகே வெட்டு", text: "கறி வெட்டு, எலும்பில்லாதது, துண்டுகள்: நீங்கள் தேர்வு செய்யும் வரை எதுவும் வெட்டப்படாது.", ctaLabel: "வெட்டு வழிகாட்டி" },
              { title: "டெல்டா பழங்கள்", text: "காவிரிப் படுகையின் பூவன் வாழை, லால்குடி கொய்யா, இயற்கையாகப் பழுத்தவை.", ctaLabel: "பழங்கள்" },
              { title: "சனிக்கிழமை நாட்டுக் கோழி", text: "முசிறி அருகே பண்ணைகளின் நாட்டுக் கோழி, ஆர்டருக்கு ஏற்ப சுத்தம் செய்து.", ctaLabel: "கோழி" },
              { title: "நாமக்கல் முட்டை", text: "பண்ணை, நாட்டு, காடை முட்டைகள், இரண்டு நாளுக்கு மேல் பழையது இல்லை.", ctaLabel: "முட்டை" },
              { title: "உங்கள் நேரத்துக்குப் பேக்கிங்", text: "முத்திரையிட்ட தராசில் எடை, இறைச்சியும் மீனும் ஐஸ் பேக்குடன்.", ctaLabel: "டெலிவரி நேரங்கள்" },
            ],
          },
          "cv-deepavali": {
            title: "தீபாவளி காலை: ஆட்டுக்கறியை இப்போதே புக் செய்யுங்கள்",
            text: "ஆட்டுக்கறி, கோழி, இறால் இந்த வார விலையில், தீபாவளி காலை (6–9) டெலிவரிக்கு. முன்பதிவு முந்தைய நாள் இரவு முடியும்.",
            cta: { label: "டெலிவரி நேரங்கள்" },
          },
          "cv-shelf": { title: "கவுண்டர் கவுண்டராக மார்க்கெட்டைப் பாருங்கள்" },
          "cv-rates": {
            title: "இன்றைய விலை",
            groups: [
              {
                name: "காய்கறி (கிலோ)",
                items: [{ name: "நாட்டுத் தக்காளி" }, { name: "பெரிய வெங்காயம்" }, { name: "சின்ன வெங்காயம்" }, { name: "உருளைக்கிழங்கு" }, { name: "ஊட்டி கேரட்" }],
              },
              {
                name: "இறைச்சி & மீன் (கிலோ)",
                items: [{ name: "கோழி, தோல் நீக்கிய கறி வெட்டு" }, { name: "ஆட்டுக்கறி கறி வெட்டு" }, { name: "வஞ்சிரம் துண்டுகள்" }, { name: "மத்தி" }, { name: "இறால், நடுத்தரம்" }],
              },
              {
                name: "பழம் & முட்டை",
                items: [
                  { name: "பூவன் வாழைப்பழம்", description: "டஜன்" },
                  { name: "மாதுளை", description: "கிலோ" },
                  { name: "கொய்யா", description: "கிலோ" },
                  { name: "பண்ணை முட்டை", description: "30 முட்டை தட்டு" },
                ],
              },
            ],
            cta: { label: "தினமும் காலை வாட்ஸ்அப்பில் விலை பெறுங்கள்" },
          },
          "cv-deal": { title: "இன்றைய மீன்", text: "அரை அங்குலத் துண்டுகளாக வெட்டிய வஞ்சிரம், காலை 6 மணிக்குள் எங்கள் கவுண்டரில். இன்று 20 கிலோ மட்டும்." },
          "cv-cut": {
            heading: "ஆர்டருக்கு ஏற்ப வெட்டி சுத்தம் செய்து",
            markdown:
              "நீங்கள் ஆர்டர் செய்யும் முன் எதுவும் வெட்டப்படுவதில்லை. பொருளில் வெட்டு முறையைத் தேர்வு செய்து, மற்றவற்றை ஆர்டர் குறிப்பில் சொல்லுங்கள்.\n\n- **கோழி:** கறி வெட்டு, எலும்பில்லாதது, லெக் பீஸ், 65-க்கு சிறிய துண்டுகள்\n- **ஆட்டிறைச்சி:** எலும்புடன் கறி வெட்டு, எலும்பில்லாதது, கீமா, சாப்ஸ்\n- **மீன்:** முழுதாக, சுத்தம் செய்து, கீறி அல்லது அரை அங்குலத் துண்டுகள்\n\nசுத்தம் செய்வதும் வெட்டுவதும் எப்போதும் இலவசம்.",
            cta: { label: "வெட்டு முறை வழிகாட்டி" },
          },
          "cv-slots": {
            heading: "காலை டெலிவரி நேரங்கள்",
            markdown: `செக்அவுட்டில் நேரத்தைத் தேர்வு செய்யுங்கள். இறைச்சி, மீன் ஐஸ் பேக்குடன் வெப்பம் தடுக்கும் பைகளில் வரும்.\n\n${SLOTS_TA}\n\nதிருச்சி நகருக்குள் ₹30, ₹499-க்கு மேல் இலவசம்.`,
            cta: { label: "டெலிவரி பகுதிகள் & நேரங்கள்" },
          },
          "cv-best": { title: "திருச்சியில் அதிகம் விற்பவை" },
          "cv-reviews": {
            title: "திருச்சி சமையலறைகள் சொல்வது",
            items: [
              { quote: "நான் கேட்டபடியே வஞ்சிரம் வெட்டப்பட்டு 8:30-க்கு முன் வந்தது. அம்மா கண்ணையும் செவுளையும் பார்த்து சரி என்றார் — அதுதான் உண்மையான சோதனை.", role: "தில்லை நகர்" },
              { quote: "வாரக் காய்கறியும் ஞாயிறு ஆட்டுக்கறியும் சேர்த்து ஆர்டர் செய்கிறேன். லேபிளில் உள்ள எடை எப்போதும் சரி, கறி வெட்டில் எலும்புத் துகள்கள் இல்லை.", role: "கே.கே. நகர்" },
              { quote: "ஸ்ரீரங்கம் அருகே நாட்டுக் கோழியும் நாட்டு முட்டையும் கிடைக்கவில்லை. இப்போது ஒவ்வொரு சனிக்கிழமை காலையும் சுத்தம் செய்து வருகிறது.", role: "ஸ்ரீரங்கம்" },
            ],
          },
          "cv-faq": { title: "புதுமை, வெட்டுதல் & டெலிவரி", items: FAQ_TA },
          "cv-location": {
            title: "மார்க்கெட்டுக்கு வாருங்கள்",
            address: "14, சாஸ்திரி சாலை, தில்லை நகர், திருச்சிராப்பள்ளி 620018 (தில்லை நகர் மெயின் ரோடு சிக்னல் அருகில்)",
            hours: [
              { label: "திங்கள் – சனி", value: "காலை 6:00 – இரவு 9:30" },
              { label: "ஞாயிறு", value: "காலை 5:30 – மதியம் 1:00" },
            ],
          },
          "cv-news": {
            heading: "தினமும் காலை 6 மணிக்கு இன்றைய விலை",
            text: "இன்றைய விலைகள், இன்றைய மீன், சலுகைகளுடன் ஒரு சிறு வாட்ஸ்அப் அல்லது மின்னஞ்சல். ஸ்பேம் இல்லை.",
          },
        },
      },
    };
  },
  pages: [
    {
      slug: "cutting-guide",
      title: "Cutting guide",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Cut & cleaned to order — free" },
        {
          type: "paragraph",
          markdown:
            "Every piece of chicken, mutton and fish is cut **after** you order, by the same three people who have run our counter for years. Pick the cut on the product page; anything else goes in the order note.\n\n| | Cuts you can pick | Ask in the note |\n|---|---|---|\n| **Chicken** | Curry cut (skinless / with skin), boneless, legs | Small pieces for 65, big pieces for biryani |\n| **Mutton** | Curry cut with bone, boneless, keema, chops | More fat, bone pieces for soup |\n| **Fish** | Whole, cleaned, slit, ½-inch steaks | Head and tail kept for kuzhambu |\n| **Prawns & squid** | Whole, peeled & deveined, cleaned rings | Tail on for fry |\n\n**Weights.** Fish is priced on the weight before cleaning (cleaning takes away 25–35%). Chicken, mutton, peeled prawns and squid rings are priced on the weight you get.",
        },
        { type: "image", url: photo(31647676), alt: "Butcher cutting fresh meat" },
        { type: "button", label: "Ask us on WhatsApp", href: orderLink("Hello Cauvery Fresh, a question about cutting:"), style: "primary" },
      ],
    },
    {
      slug: "delivery-slots",
      title: "Delivery slots & areas",
      blocks: () => [
        { type: "heading", level: 2, text: "Delivery slots & areas" },
        { type: "paragraph", markdown: `${SLOTS}\n\nMeat and fish travel in insulated bags with ice packs, so they reach you as cold as they left the counter.` },
        {
          type: "paragraph",
          markdown:
            "| Area | Pincodes | Delivery | Free above |\n|---|---|---|---|\n| Trichy city: Thillai Nagar, Cantonment, K.K. Nagar, Woraiyur, Srirangam, Thiruverumbur | 620 xxx | ₹30 | ₹499 |\n| Samayapuram, Lalgudi, Manachanallur | 621 xxx | ₹60 | ₹999 |\n\nMinimum order ₹199. Pay by UPI or cash at the door.",
        },
        { type: "faq", items: FAQ.slice(2, 4) },
      ],
    },
    {
      slug: "about",
      title: "About us",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Cauvery Fresh Market, Thillai Nagar" },
        {
          type: "paragraph",
          markdown:
            "We started as a vegetable cart outside Gandhi Market and opened the shop on **Sastri Road, Thillai Nagar** to bring the morning market to families who can't get there at 5 am.\n\nToday we buy vegetables and fruit at the wholesale yard and from farms around Lalgudi, Thottiyam and Manapparai, bring fish from the Nagapattinam boats and cut chicken and mutton only after you order. Everything is weighed on a stamped scale, and what is not fresh is not sold.",
        },
        { type: "image", url: photo(35069422), alt: "Street market with fresh vegetables" },
        { type: "paragraph", markdown: "Open Monday to Saturday 6:00 am – 9:30 pm, Sunday 5:30 am – 1:00 pm. Call or WhatsApp **+91 98765 00033**." },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' models or passers-by, not our customers or staff.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(
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
      { label: "Today's deals", type: "collection", ref: "on-offer" },
      { label: "Sea catch", type: "collection", ref: "sea-catch" },
      { label: "Ready to cook", type: "collection", ref: "ready-to-cook" },
      { label: "Delivery slots", type: "page", ref: "delivery-slots" },
      { label: "About", type: "page", ref: "about" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Track your order", type: "url", href: "/track" },
          { label: "Delivery slots & areas", type: "page", ref: "delivery-slots" },
          { label: "Call the shop", type: "url", href: `tel:${PHONE}` },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "Cutting guide", type: "page", ref: "cutting-guide" },
          { label: "About us", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
