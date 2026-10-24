import type { DemoProduct, DemoStore } from "./types";
import { withPriceBandGst } from "./gst-band";

/**
 * Store #16 of the series: Sellam Pet Store, Anna Nagar, Chennai (sellam.localhost:3003). A neighbourhood pet shop on
 * 2nd Avenue with a grooming room at the back, on the online store app (EC) with the `pet_shop` trade and the
 * "lagoon-paws" look (lagoon teal and soft coral on warm cream, rounded Quicksand headings). Sellam (செல்லம்) is what
 * Tamil families call their pet: "darling". Dog food by life stage and pack size, cat food, bird seed and fish food,
 * treats and chews (milk biscuits also loose by the kilo), toys, leashes, collars and harnesses in S–XL, beds and
 * carriers, grooming products (non-prescription only: shampoos, brushes, a neem tick-and-flea shampoo; no medicines,
 * no spot-ons), bowls and litter, bird cages and aquarium kits, and a grooming session voucher (bath, dry, trim) booked
 * on WhatsApp. **No live animals are sold** (no puppies, kittens, birds or fish): the shop says so on the home page and
 * in its policies. Names are generic, no makers' brands. Address, phone and GSTIN are demo placeholders.
 *
 * GST, from CGST notification 9/2025-Central Tax (Rate) of 17 Sept 2025, in force from 22 Sept 2025 (Schedule I = 2.5%
 * CGST, i.e. 5% GST; Schedule II = 9% CGST, i.e. 18% GST), as amended up to 2026:
 * - dog and cat food put up for retail sale, treats and chews, 2309 10 00: 18%. Heading 2309 appears in Schedule I only
 *   for "fish soluble paste" (S.No. 161) and the nil notification 10/2025-CT(R) covers aquatic, poultry and cattle feed
 *   only, so retail pet food stays at 18% (the same rate as under 1/2017; trade bodies were still asking for a cut in
 *   Sept 2025);
 * - bird seed mixes and aquarium fish food, 2309 90 90: 18% (uncertain: some sellers read the nil "aquatic feed" entry
 *   to cover aquarium fish food; it is meant for aquaculture feed, so we charge 18%);
 * - leashes, collars, harnesses, retractable leads, 4201 00 00 ("saddlery and harness for any animal … leads … dog
 *   coats and the like, of any material"): 18%, Schedule II S.No. 144;
 * - plastic (TPR) chew bones, fetch balls, feather wands, cooling mats and carriers, 3926 90 99: 18%, Schedule II
 *   S.No. 127; rubber bath brush 4016 99 90: 18%, Schedule II S.No. 142; plastic bowls 3924 10 90: 18%, Schedule II
 *   S.No. 125;
 * - cotton rope toys and plush toys 6307 90 90, microfibre towels 6302 93 00 (other made-up textile articles):
 *   price-band GST, 5% up to ₹2,500 per piece (Schedule I S.No. 390), all ours are well under (`withPriceBandGst`).
 *   Uncertain: a plush squeaky toy could also be read as a stuffed toy of 9503 (5% only for the listed toys, otherwise
 *   18%); pet toys are classified by material here, as customs rulings usually do;
 * - stuffed pet beds 9404 90 99: 18%, Schedule II S.No. 613 (5% only for quilted textile products and cotton quilts up
 *   to ₹2,500, S.No. 492 / 493, which a bolster bed is not);
 * - sling carrier bag 4202 92 90: 18%, Schedule II S.No. 145;
 * - pet shampoos 3307 90 90 ("other … cosmetic or toilet preparations"; the HS notes put animal shampoos here): 18%,
 *   Schedule II S.No. 64. Uncertain: if treated as hair shampoo of 3305 it would be 5% (Schedule I S.No. 245); the
 *   neem tick-and-flea shampoo is billed at 18% either way (3307, or 3808 91 insect repellent, Schedule II S.No. 95);
 * - grooming brushes 9603 90 00: 18%, Schedule II S.No. 623;
 * - stainless steel bowls 7323 93 90 ("table, kitchen or other household articles of iron & steel; utensils"): 5%,
 *   Schedule I S.No. 416;
 * - clumping bentonite cat litter 2508 10 90 ("other clays"): 5%, Schedule I S.No. 169. Uncertain: perfumed litter is
 *   sometimes classified as a preparation of 3824 99 (18%);
 * - cat scratching post on a wooden base, 4421 99 90 ("other articles of wood"): 5%, Schedule I S.No. 306. Uncertain:
 *   the sisal rope or the carpeted platform may decide the class instead (5609 / 5705);
 * - bird cages of steel wire 7326 20 90 ("other articles of iron or steel"): 18%, Schedule II S.No. 305;
 * - glass aquarium tanks 7020 00 90 ("other articles of glass"): 18%, Schedule II S.No. 259 (7013 glassware would also be
 *   18%, S.No. 252); aquarium air pumps 8414 80 (air pumps, Schedule II S.No. 401): 18%;
 * - pet grooming (service), SAC 999729 ("other miscellaneous services"): 18%. Uncertain: the 5% rate for beauty and
 *   wellness services (9997 21/22, without input tax credit) is for people; we charge 18%.
 * Sources: the schedule text of 9/2025-CT(R) as reproduced at taxcode.in ("CGST Notification No. 09/2025-Central Tax
 * (Rate) dated 17.09.2025"); Rödl & Partner's paper at World Food India (30 Sept 2025) on the 18% GST on pet food.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500061";
const WHATSAPP = "919876500061";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

/** Variants of two options (every combination), priced by the first option; stock per combination. */
function two(a: string, aRows: [string, number, number][], b: string, bValues: string[], stock: number): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [
      { name: a, values: aRows.map((r) => r[0]) },
      { name: b, values: bValues },
    ],
    variants: aRows.flatMap(([av, price, mrp]) => bValues.map((bv) => ({ values: { [a]: av, [b]: bv }, price: rs(price), mrp: rs(mrp), stock }))),
  };
}

/** Variants of two options, priced by the second one (flavour × pack). */
function byPack(a: string, aValues: string[], b: string, bRows: [string, number, number][], stock: number): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [
      { name: a, values: aValues },
      { name: b, values: bRows.map((r) => r[0]) },
    ],
    variants: aValues.flatMap((av) => bRows.map(([bv, price, mrp]) => ({ values: { [a]: av, [b]: bv }, price: rs(price), mrp: rs(mrp), stock }))),
  };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({
  variants: [{ price: rs(price), mrp: rs(mrp), stock }],
});

// Categories: food by pet under one "Pet food" parent (so the finder's "Food" answer covers all of it), then by need.
const FOOD = "Pet food";
const DOG_FOOD = "Food for dogs";
const CAT_FOOD = "Food for cats";
const BIRD_FISH_FOOD = "Food for birds & fish";
const TREATS = "Treats & chews";
const TOYS = "Toys & leashes";
const BEDS = "Beds & carriers";
const GROOMING = "Pet grooming";
const BOWLS = "Bowls & litter";
const BIRDS_FISH = "Birds & fish";

// Finder and tile tags: the pet (dog / cat / bird / fish) and the pet with its life stage.
const DOG = ["dog", "puppy", "dog-adult", "dog-senior"];
const CAT = ["cat", "kitten", "cat-adult"];
const PET_DOG_CAT = [...DOG, ...CAT];

const FOOD_NOTE =
  "\n\n**Unopened packs** can be returned within 7 days of delivery. Change foods over 7 days (a quarter new, then half, then three quarters) so the tummy keeps up. The feeding amounts are a starting point: ask your vet if your pet has a health condition.";
const FIT_NOTE =
  "\n\nNot sure of the size? Measure the neck (two fingers' room) and the chest behind the front legs, or bring your dog to the shop: we fit it on the spot. Unused leashes, collars and harnesses are exchanged within 7 days.";
const GROOM_NOTE = "\n\nFor external use on pets only. Not a medicine: for skin problems, wounds or heavy tick infestations, see your vet first.";

const PRODUCTS: DemoProduct[] = [
  // ---- food for dogs (2309 10 00: 18%)
  {
    name: "Puppy dry food, chicken & rice",
    category: DOG_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-PUP",
    photo: 7086030,
    tags: ["dog", "puppy", "bestseller", "refill", "starter-kit"],
    description: `Small, soft kibble for puppies from weaning to 12 months (to 18 months for large breeds): chicken as the first ingredient, rice for easy digestion, DHA from fish oil for the growing brain and calcium in the right balance for bones. Feed 3–4 small meals a day up to 6 months, then two.${FOOD_NOTE}`,
    attributes: { "Life stage": "Puppy (2–12 months)", "Breed size": "All breeds", "Main protein": "Chicken", "Protein": "30% min", "Fat": "16% min", Ingredients: "Chicken meal, rice, maize, chicken fat, fish oil, beet pulp, egg powder, vitamins and minerals", "Veg / non-veg": "Non-veg", "Made in": "India (Hosur, Tamil Nadu)", "Shelf life": "12 months from packing" },
    ...one("Pack size", [
      ["1 kg", 420, 480, 40],
      ["3 kg", 1150, 1320, 25],
      ["10 kg", 3450, 3900, 10],
    ]),
  },
  {
    name: "Adult dog dry food, chicken & rice",
    category: DOG_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-ADC",
    photo: 6568950,
    tags: ["dog", "dog-adult", "bestseller", "refill"],
    description: `Our best-selling everyday food for grown-up dogs of every size, from an Indie to a Labrador: chicken and rice with omega-3 and -6 for the coat, prebiotics for firm stools and a crunchy kibble that scrapes the teeth. A 15 kg dog eats about 230 g a day.${FOOD_NOTE}`,
    attributes: { "Life stage": "Adult (1–7 years)", "Breed size": "All breeds", "Main protein": "Chicken", "Protein": "24% min", "Fat": "12% min", Ingredients: "Chicken meal, rice, maize, wheat, chicken fat, beet pulp, fish oil, vitamins and minerals", "Veg / non-veg": "Non-veg", "Made in": "India (Hosur, Tamil Nadu)", "Shelf life": "12 months from packing" },
    ...one("Pack size", [
      ["1 kg", 340, 390, 50],
      ["3 kg", 950, 1090, 30],
      ["10 kg", 2850, 3250, 15],
    ]),
  },
  {
    name: "Adult dog dry food, lamb & rice (sensitive)",
    category: DOG_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-ADL",
    photo: 8434670,
    tags: ["dog", "dog-adult"],
    description: `For dogs that scratch or get loose stools on chicken: lamb as the single animal protein, rice, no wheat, no soya, no artificial colours. A good switch for many Shih Tzus, Pugs and Labradors with sensitive tummies.${FOOD_NOTE}`,
    attributes: { "Life stage": "Adult (1–7 years)", "Breed size": "All breeds", "Main protein": "Lamb", "Protein": "22% min", "Fat": "12% min", Ingredients: "Lamb meal, rice, barley, oats, sunflower oil, beet pulp, flaxseed, vitamins and minerals", "Veg / non-veg": "Non-veg", "Made in": "India (Pune)", "Shelf life": "12 months from packing" },
    ...one("Pack size", [
      ["1 kg", 460, 520, 30],
      ["3 kg", 1290, 1450, 20],
      ["10 kg", 3890, 4350, 8],
    ]),
  },
  {
    name: "Senior dog dry food, chicken with joint care",
    category: DOG_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-SEN",
    photo: 8434725,
    tags: ["dog", "dog-senior", "refill"],
    description: `For dogs over 7 (over 5 for giant breeds): fewer calories for a slower dog, glucosamine and chondroitin for stiff joints, a smaller, softer kibble for older teeth and L-carnitine to keep the weight off.${FOOD_NOTE}`,
    attributes: { "Life stage": "Senior (7+ years)", "Breed size": "Small and medium breeds", "Main protein": "Chicken", "Protein": "22% min", "Fat": "9% min", Ingredients: "Chicken meal, rice, oats, barley, chicken fat, glucosamine, chondroitin, L-carnitine, vitamins and minerals", "Veg / non-veg": "Non-veg", "Made in": "India (Hosur, Tamil Nadu)", "Shelf life": "12 months from packing" },
    ...one("Pack size", [
      ["1 kg", 480, 540, 25],
      ["3 kg", 1350, 1520, 15],
    ]),
  },
  {
    name: "Vegetarian dog dry food, soya & rice",
    category: DOG_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-VEG",
    photo: 30070529,
    tags: ["dog", "dog-adult", "refill"],
    description: `For vegetarian homes: soya, rice and pulses for protein, milk solids, and taurine and L-carnitine added (a dog makes some of its own, we add more to be safe). Complete and balanced for adult dogs. No egg, no meat, no fish.${FOOD_NOTE}`,
    attributes: { "Life stage": "Adult (1–7 years)", "Breed size": "All breeds", "Main protein": "Soya and pulses", "Protein": "22% min", "Fat": "8% min", Ingredients: "Rice, soya meal, maize, wheat, green gram, milk powder, sunflower oil, taurine, L-carnitine, vitamins and minerals", "Veg / non-veg": "Veg", "Made in": "India (Coimbatore)", "Shelf life": "12 months from packing" },
    ...one("Pack size", [
      ["1 kg", 310, 350, 30],
      ["3 kg", 860, 980, 20],
      ["10 kg", 2650, 2990, 8],
    ]),
  },
  {
    name: "Large-breed adult dry food, chicken",
    category: DOG_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-LRG",
    photo: 19892502,
    tags: ["dog", "dog-adult", "refill"],
    description: `A bigger kibble for big mouths (Labradors, German Shepherds, Rottweilers, Rajapalayams), with glucosamine for heavy joints and controlled calcium. Feed in two meals and rest an hour after: big, deep-chested dogs shouldn't run on a full stomach.${FOOD_NOTE}`,
    attributes: { "Life stage": "Adult (1–7 years)", "Breed size": "Large and giant breeds (25 kg+)", "Main protein": "Chicken", "Protein": "25% min", "Fat": "12% min", Ingredients: "Chicken meal, rice, maize, chicken fat, beet pulp, fish oil, glucosamine, vitamins and minerals", "Veg / non-veg": "Non-veg", "Made in": "India (Hosur, Tamil Nadu)", "Shelf life": "12 months from packing" },
    ...one("Pack size", [
      ["3 kg", 1050, 1190, 15],
      ["10 kg", 3150, 3550, 10],
      ["20 kg", 5990, 6700, 6],
    ]),
  },
  {
    name: "Dog wet food in gravy, 70 g pouches",
    category: DOG_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-WTD",
    photo: 30070537,
    tags: ["dog", "puppy", "dog-adult", "dog-senior", "refill", "deal"],
    description: `Tender chunks in a thick gravy: tip one over the dry food and even a fussy eater clears the bowl. Complete for adult dogs, a topper for puppies and seniors. Once opened, keep it covered in the fridge and use it within 24 hours.${FOOD_NOTE}`,
    attributes: { "Life stage": "All life stages (topper)", "Breed size": "All breeds", "Protein": "8% min", Moisture: "82% max", Ingredients: "Meat and animal derivatives, cereals, gravy (water, starch), minerals, vitamins", "Veg / non-veg": "Non-veg", "Made in": "Thailand", "Shelf life": "18 months from packing" },
    ...byPack("Flavour", ["Chicken chunks", "Lamb", "Chicken & liver"], "Pack", [
      ["Single 70 g", 55, 60],
      ["Box of 12", 620, 720],
    ], 30),
  },
  {
    name: "Fresh-cooked dog meal, chilled (Chennai only)",
    category: DOG_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-FRS",
    photo: 19086863,
    tags: ["dog", "dog-adult", "dog-senior"],
    description: `Home-style dog food, cooked in our Anna Nagar kitchen every morning and sealed in trays: boneless chicken, rice, pumpkin and carrot, or a vegetarian egg, millet and greens recipe. No salt, no onion, no garlic. Delivered chilled in Chennai only; keeps 5 days in the fridge (2 days once opened). Warm to room temperature, don't microwave in the tray.\n\nChilled meals can't be returned once delivered unless they arrive warm or damaged.`,
    attributes: { "Life stage": "Adult and senior", "Breed size": "All breeds", "Main protein": "Chicken, or egg (veg + egg recipe)", "Protein": "11% min (as fed)", Moisture: "70% max", Ingredients: "Chicken, rice, pumpkin, carrot, coconut oil, calcium (chicken recipe); egg, kambu (pearl millet), spinach, carrot (egg recipe)", "Veg / non-veg": "Non-veg / egg", "Made in": "India (Anna Nagar, Chennai)", "Shelf life": "5 days chilled" },
    ...byPack("Recipe", ["Chicken & rice", "Egg & millet"], "Pack", [
      ["500 g tray", 180, 200],
      ["Week pack (7 × 500 g)", 1190, 1400],
    ], 20),
  },

  // ---- food for cats (2309 10 00: 18%)
  {
    name: "Kitten dry food, ocean fish",
    category: CAT_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-KIT",
    photo: 34719941,
    tags: ["cat", "kitten", "refill", "starter-kit", "bestseller"],
    description: `Tiny kibble for kittens from 2 to 12 months (and for mother cats while they nurse): fish protein, DHA, taurine for the eyes and heart, and extra calories for a body that grows every day. Keep fresh water next to the bowl at all times.${FOOD_NOTE}`,
    attributes: { "Life stage": "Kitten (2–12 months)", "Main protein": "Fish", "Protein": "34% min", "Fat": "14% min", Ingredients: "Fish meal, chicken meal, rice, maize gluten, chicken fat, fish oil, taurine, vitamins and minerals", "Veg / non-veg": "Non-veg", "Made in": "India (Hosur, Tamil Nadu)", "Shelf life": "12 months from packing" },
    ...one("Pack size", [
      ["400 g", 290, 330, 30],
      ["1.2 kg", 799, 899, 20],
      ["3 kg", 1890, 2150, 8],
    ]),
  },
  {
    name: "Adult cat dry food, tuna & salmon",
    category: CAT_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-CAD",
    photo: 16618557,
    tags: ["cat", "cat-adult", "refill", "bestseller"],
    description: `A fish-lover's crunchy kibble for adult cats: tuna and salmon, taurine, and controlled minerals that keep the urine slightly acidic, which helps prevent stones. A 4 kg cat eats about 55 g a day.${FOOD_NOTE}`,
    attributes: { "Life stage": "Adult (1–7 years)", "Main protein": "Tuna and salmon", "Protein": "32% min", "Fat": "11% min", Ingredients: "Fish meal (tuna, salmon), rice, maize gluten, chicken fat, taurine, vitamins and minerals", "Veg / non-veg": "Non-veg", "Made in": "India (Hosur, Tamil Nadu)", "Shelf life": "12 months from packing" },
    ...one("Pack size", [
      ["400 g", 260, 299, 30],
      ["1.2 kg", 720, 820, 20],
      ["3 kg", 1690, 1920, 10],
    ]),
  },
  {
    name: "Indoor cat dry food, chicken with hairball care",
    category: CAT_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-CIN",
    photo: 16618549,
    tags: ["cat", "cat-adult"],
    description: `For flat cats who don't climb many trees: fewer calories, and plant fibre (psyllium and beet pulp) that moves swallowed fur through instead of up. Persians and other long-haired cats do well on it.${FOOD_NOTE}`,
    attributes: { "Life stage": "Adult (1–7 years)", "Main protein": "Chicken", "Protein": "30% min", "Fat": "10% min", Ingredients: "Chicken meal, rice, maize gluten, beet pulp, psyllium husk, chicken fat, taurine, vitamins and minerals", "Veg / non-veg": "Non-veg", "Made in": "India (Pune)", "Shelf life": "12 months from packing" },
    ...one("Pack size", [
      ["400 g", 310, 350, 25],
      ["1.2 kg", 860, 960, 15],
    ]),
  },
  {
    name: "Cat wet food in gravy, 85 g pouches",
    category: CAT_FOOD,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-WTC",
    photo: 13317322,
    tags: ["cat", "kitten", "cat-adult", "refill", "deal"],
    description: `Fine flakes in gravy, the meal most cats beg for: more water in the diet is good for cat kidneys, so many vets suggest one pouch a day alongside dry food. Once opened, cover and refrigerate; use within 24 hours.${FOOD_NOTE}`,
    attributes: { "Life stage": "Kitten to senior", "Protein": "9% min", Moisture: "82% max", Ingredients: "Fish or chicken, gravy (water, starch), taurine, vitamins and minerals", "Veg / non-veg": "Non-veg", "Made in": "Thailand", "Shelf life": "24 months from packing" },
    ...byPack("Flavour", ["Tuna", "Chicken", "Mackerel"], "Pack", [
      ["Single 85 g", 50, 55],
      ["Box of 12", 560, 660],
    ], 30),
  },

  // ---- food for birds & fish (2309 90 90: 18%)
  {
    name: "Budgie & lovebird seed mix",
    category: BIRD_FISH_FOOD,
    hsn: "23099090",
    gstRate: 18,
    unit: "pack",
    sku: "SP-BSD",
    photo: 18275951,
    tags: ["bird", "refill"],
    description: `Our own mix, cleaned and packed in the shop: thinai (foxtail millet), white and red millet, canary seed and a little niger and oats. Fill the cup daily and blow off the husks; add a slice of cucumber or a few greens on the side.\n\nUnopened packs can be returned within 7 days.`,
    attributes: { "For": "Budgies, lovebirds, finches", Ingredients: "Foxtail millet, white millet, red millet, canary seed, niger seed, hulled oats", "Made in": "India (Chennai)", "Shelf life": "6 months from packing" },
    ...one("Pack size", [
      ["500 g", 149, 170, 40],
      ["1 kg", 269, 310, 30],
    ]),
  },
  {
    name: "Cockatiel & parrot seed mix with sunflower",
    category: BIRD_FISH_FOOD,
    hsn: "23099090",
    gstRate: 18,
    unit: "pack",
    sku: "SP-PSD",
    photo: 19904796,
    tags: ["bird"],
    description: `A bigger seed for bigger beaks: striped sunflower, safflower, kambu, millet, dried chilli and groundnut kernels. Sunflower is fatty, so mix in fresh fruit and greens every day.\n\nUnopened packs can be returned within 7 days.`,
    attributes: { "For": "Cockatiels, conures, Indian ringnecks", Ingredients: "Sunflower, safflower, pearl millet, white millet, groundnut kernels, dried red chilli", "Made in": "India (Chennai)", "Shelf life": "6 months from packing" },
    ...single(349, 399, 25),
  },
  {
    name: "Tropical fish flakes",
    category: BIRD_FISH_FOOD,
    hsn: "23099090",
    gstRate: 18,
    unit: "pack",
    sku: "SP-FFL",
    photo: 33867664,
    tags: ["fish"],
    description: `Colour-rich flakes for guppies, mollies, tetras, platies and angels: feed a pinch they finish in two minutes, once or twice a day. Leftover food is what clouds a tank. Close the tin after use; damp flakes go mouldy.\n\nUnopened tins can be returned within 7 days.`,
    attributes: { "For": "Tropical community fish", "Protein": "45% min", Ingredients: "Fish meal, shrimp meal, wheat flour, spirulina, yeast, vitamins", "Made in": "India (Kolkata)", "Shelf life": "18 months (use within 3 months of opening)" },
    ...one("Pack size", [
      ["50 g", 149, 170, 30],
      ["100 g", 249, 290, 20],
    ]),
  },
  {
    name: "Goldfish floating pellets",
    category: BIRD_FISH_FOOD,
    hsn: "23099090",
    gstRate: 18,
    unit: "pack",
    sku: "SP-GFP",
    photo: 19680232,
    tags: ["fish"],
    description: `Small floating pellets for goldfish and koi in bowls, tanks and ponds, with spirulina for colour. Soak them for a few seconds before feeding fancy goldfish, which gulp air at the surface.\n\nUnopened tins can be returned within 7 days.`,
    attributes: { "For": "Goldfish and koi", "Protein": "32% min", Ingredients: "Fish meal, wheat flour, soya meal, spirulina, vitamins", "Made in": "India (Kolkata)", "Shelf life": "18 months (use within 3 months of opening)" },
    ...one("Pack size", [
      ["100 g", 129, 150, 30],
      ["250 g", 249, 290, 20],
    ]),
  },

  // ---- treats & chews (2309 10 00: 18%)
  {
    name: "Chicken jerky strips",
    category: TREATS,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-JRK",
    photo: 8121148,
    tags: ["dog", "dog-adult", "dog-senior", "bestseller"],
    description: `Slow-dried strips of chicken breast, nothing added: break them into small pieces for training, or give one as a reward. Treats should be no more than a tenth of the day's food. Not for puppies under 4 months.\n\nUnopened packs can be returned within 7 days.`,
    attributes: { "Life stage": "Adult and senior", "Main protein": "Chicken", "Protein": "60% min", Ingredients: "Chicken breast", "Veg / non-veg": "Non-veg", "Made in": "India (Namakkal)", "Shelf life": "9 months from packing" },
    ...one("Pack size", [
      ["100 g", 249, 280, 40],
      ["250 g", 549, 620, 20],
    ]),
  },
  {
    name: "Milk biscuits for dogs, bone-shaped",
    category: TREATS,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-MBS",
    photo: 8434641,
    tags: [...DOG, "refill", "starter-kit"],
    description: `The crunchy milk-and-wheat biscuit every Chennai dog knows, baked hard to help clean the teeth, in a resealable pack. Small bones for puppies and small dogs, two or three a day for a medium dog.\n\nUnopened packs can be returned within 7 days.`,
    attributes: { "Life stage": "All life stages (from 3 months)", Ingredients: "Wheat flour, milk powder, vegetable fat, calcium, vitamins", "Veg / non-veg": "Veg", "Made in": "India (Chennai)", "Shelf life": "9 months from packing" },
    ...one("Pack size", [
      ["500 g", 199, 230, 40],
      ["1 kg", 369, 420, 30],
    ]),
  },
  {
    name: "Loose milk biscuits (by weight)",
    category: TREATS,
    hsn: "23091000",
    gstRate: 18,
    unit: "kg",
    sku: "SP-LMB",
    photo: 8121154,
    tags: [...DOG, "deal"],
    description: `The same baked milk biscuits, mixed shapes and colours, weighed out from our counter jar: order 250 g (0.25 kg) for a try or 2 kg for a big dog's month. Price per kg; packed in a paper bag, so tip them into an airtight tin at home.\n\nLoose biscuits can't be returned once weighed out.`,
    attributes: { "Life stage": "All life stages (from 3 months)", Ingredients: "Wheat flour, milk powder, vegetable fat, natural colours (beetroot, spinach, carrot), calcium", "Veg / non-veg": "Veg", "Made in": "India (Chennai)", "Shelf life": "3 months in an airtight tin" },
    ...single(320, 360, 40),
  },
  {
    name: "Dental chew sticks, pack of 7",
    category: TREATS,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-DNT",
    photo: 28293539,
    tags: ["dog", "dog-adult", "dog-senior", "refill"],
    description: `A star-shaped chew a day, a week in a pack: the ridges scrub plaque off the back teeth while your dog chews. Pick the size by your dog's weight and always give it under supervision; take away the last small piece.\n\nUnopened packs can be returned within 7 days.`,
    attributes: { "Life stage": "Adult and senior", Ingredients: "Rice flour, glycerine, chicken, cellulose, sodium tripolyphosphate, green tea extract", "Veg / non-veg": "Non-veg", "Made in": "India (Bengaluru)", "Shelf life": "18 months from packing" },
    ...one("Breed size", [
      ["Small (up to 10 kg)", 249, 280, 30],
      ["Medium (10–25 kg)", 299, 340, 30],
      ["Large (25 kg+)", 349, 399, 20],
    ]),
  },
  {
    name: "Creamy lickable cat treat, tuna",
    category: TREATS,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-LCK",
    photo: 39269451,
    tags: ["cat", "kitten", "cat-adult", "deal"],
    description: `A soft tuna purée in a squeeze tube that cats lick straight from your hand: the best trick for nail trims, carrier training and hiding a pill (ask your vet first). One or two tubes a day.\n\nUnopened packs can be returned within 7 days.`,
    attributes: { "Life stage": "Kitten (from 3 months) to senior", Ingredients: "Tuna, water, tapioca starch, fish oil, taurine", "Veg / non-veg": "Non-veg", "Made in": "Thailand", "Shelf life": "24 months from packing" },
    ...one("Pack", [
      ["4 × 15 g", 149, 170, 40],
      ["20 × 15 g", 599, 680, 15],
    ]),
  },
  {
    name: "Puppy training treats, chicken liver",
    category: TREATS,
    hsn: "23091000",
    gstRate: 18,
    unit: "pack",
    sku: "SP-TRN",
    photo: 12866880,
    tags: ["dog", "puppy", "starter-kit"],
    description: `Pea-sized soft treats that puppies swallow in a second, so the lesson keeps going: "sit", "come", "wait". About 3 calories each; take them out of the day's food on training days. 150 g pouch with a zip.\n\nUnopened packs can be returned within 7 days.`,
    attributes: { "Life stage": "Puppy (from 3 months) and adult", Ingredients: "Chicken liver, chicken, rice flour, glycerine, vegetable oil", "Veg / non-veg": "Non-veg", "Made in": "India (Bengaluru)", "Shelf life": "12 months from packing" },
    ...single(229, 260, 35),
  },

  // ---- toys (by material: textiles 6307 price band, plastics 3926 18%, wood 4421 5%)
  {
    name: "Cotton rope tug toy",
    category: TOYS,
    hsn: "63079090",
    gstRate: 5,
    unit: "pcs",
    sku: "SP-RPE",
    photo: 15356245,
    tags: [...DOG, "starter-kit", "bestseller"],
    description: `Thick knotted cotton rope for tug, fetch and teething: the fibres floss between the teeth as they chew. Wash it in warm water and dry it in the sun once a week. Replace it once it frays into loose threads.`,
    attributes: { Material: "Cotton rope", "Breed size": "S up to 10 kg, M 10–25 kg, L 25 kg+", "Made in": "India (Karur)" },
    ...one("Size", [
      ["S (25 cm)", 179, 220, 25],
      ["M (35 cm)", 249, 299, 25],
      ["L (45 cm)", 349, 420, 15],
    ]),
  },
  {
    name: "Chew bone, tough TPR",
    category: TOYS,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-BNE",
    photo: 33742356,
    tags: [...DOG, "starter-kit"],
    description: `A non-toxic thermoplastic rubber bone with nubs that massage the gums, for puppies cutting teeth and dogs who chew the sofa. Bright orange, so you find it in the grass. Pick a size bigger rather than smaller.`,
    attributes: { Material: "TPR (thermoplastic rubber), BPA-free", "Breed size": "S up to 10 kg, M 10–25 kg, L 25 kg+", "Made in": "India (Chennai)" },
    ...one("Size", [
      ["S", 199, 240, 25],
      ["M", 249, 299, 25],
      ["L", 329, 390, 15],
    ]),
  },
  {
    name: "Squeaky plush toy with rope legs",
    category: TOYS,
    hsn: "63079090",
    gstRate: 5,
    unit: "pcs",
    sku: "SP-PLS",
    photo: 14331261,
    tags: ["dog", "puppy", "dog-adult"],
    description: `A soft cuddle-and-shake toy with a squeaker inside and rope legs to chew. For gentle players: take it away if your dog starts pulling out the stuffing.`,
    attributes: { Material: "Polyester plush, cotton rope, squeaker", "Made in": "India (Tiruppur)" },
    ...one("Design", [
      ["Pig", 299, 350, 15],
      ["Frog", 299, 350, 15],
      ["Sheep", 299, 350, 15],
    ]),
  },
  {
    name: "Bouncy fetch balls, pack of 3",
    category: TOYS,
    hsn: "39269099",
    gstRate: 18,
    unit: "pack",
    sku: "SP-BAL",
    photo: 15013953,
    tags: [...DOG],
    description: `Tennis-ball sized but made of solid, felt-free TPR that doesn't wear down teeth like a tennis ball's felt does. They float, so they're good for the beach at Besant Nagar too.`,
    attributes: { Material: "TPR, solid", "Ball size": "6.5 cm", "Made in": "India (Chennai)" },
    ...single(199, 240, 30),
  },
  {
    name: "Cat feather wand teaser",
    category: TOYS,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-WND",
    photo: 10914514,
    tags: [...CAT, "starter-kit"],
    description: `A springy wand with feathers and a bell on a string: ten minutes of chasing twice a day keeps an indoor cat fit and calm at night. Put it away after play so the string isn't chewed.`,
    attributes: { Material: "Plastic wand, feathers, bell", Length: "90 cm", "Made in": "India (Chennai)" },
    ...single(149, 180, 30),
  },
  {
    name: "Cat scratching post with sisal rope",
    category: TOYS,
    hsn: "44219990",
    gstRate: 5,
    unit: "pcs",
    sku: "SP-SCR",
    photo: 7725977,
    tags: [...CAT],
    description: `A tall post wrapped in natural sisal on a heavy wooden base that doesn't tip: put it next to the sofa your cat scratches now and rub a little catnip on it. Stand-up scratching stretches the back and files the claws.`,
    attributes: { Material: "Sisal rope, engineered wood, carpet", "Made in": "India (Chennai)" },
    ...one("Height", [
      ["45 cm", 899, 1050, 10],
      ["70 cm", 1499, 1750, 6],
    ]),
  },

  // ---- leashes, collars and harnesses (4201 00 00: 18%)
  {
    name: "Nylon leash, 1.5 m",
    category: TOYS,
    hsn: "42010000",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-LSH",
    photo: 14979534,
    tags: [...DOG, "starter-kit", "bestseller"],
    description: `A strong, soft-handled 1.5 m nylon leash with a rust-proof swivel hook and a reflective stitch for the evening walk. S for puppies and small dogs, XL for a Rajapalayam or a German Shepherd.${FIT_NOTE}`,
    attributes: { Material: "Nylon webbing, zinc-alloy hook", Width: "S 1 cm, M 1.5 cm, L 2 cm, XL 2.5 cm", "Made in": "India (Chennai)" },
    ...two("Size", [
      ["S", 249, 299],
      ["M", 279, 329],
      ["L", 299, 360],
      ["XL", 349, 420],
    ], "Colour", ["Red", "Teal", "Black"], 10),
  },
  {
    name: "Padded nylon collar",
    category: TOYS,
    hsn: "42010000",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-COL",
    photo: 3067506,
    tags: [...DOG, "starter-kit"],
    description: `A soft neoprene-padded collar with a quick-release buckle and a D-ring for the leash and the name tag. Two fingers should slip under it; check the fit every week while a puppy grows.${FIT_NOTE}`,
    attributes: { Material: "Nylon, neoprene padding, plastic buckle", "Neck size": "S 25–35 cm, M 32–45 cm, L 40–55 cm, XL 50–65 cm", "Made in": "India (Chennai)" },
    ...two("Size", [
      ["S", 199, 240],
      ["M", 229, 270],
      ["L", 259, 310],
      ["XL", 299, 360],
    ], "Colour", ["Red", "Teal", "Coral"], 10),
  },
  {
    name: "No-pull chest harness",
    category: TOYS,
    hsn: "42010000",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-HRN",
    photo: 30558513,
    tags: [...DOG, "bestseller"],
    description: `A padded, breathable chest harness with a front ring that turns a puller sideways instead of choking the neck, and a back ring for calm walks. Four adjustment points; reflective trim. Best for pugs, Shih Tzus and any dog with a short nose.${FIT_NOTE}`,
    attributes: { Material: "Air-mesh, nylon webbing, steel rings", "Chest size": "S 35–45 cm, M 45–60 cm, L 60–75 cm, XL 75–95 cm", "Made in": "India (Chennai)" },
    ...two("Size", [
      ["S", 549, 650],
      ["M", 649, 760],
      ["L", 749, 880],
      ["XL", 899, 1050],
    ], "Colour", ["Red", "Teal", "Black"], 6),
  },
  {
    name: "Retractable leash",
    category: TOYS,
    hsn: "42010000",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-RTL",
    photo: 4192830,
    tags: ["dog", "dog-adult", "dog-senior"],
    description: `More room to sniff in the park, with a one-thumb brake and lock. For parks and beaches, not for busy roads: lock it short near traffic. Not for dogs that pull hard.${FIT_NOTE}`,
    attributes: { Material: "ABS case, nylon tape, steel spring", "Made in": "India (Chennai)" },
    ...one("Size", [
      ["S (3 m, up to 12 kg)", 699, 850, 10],
      ["M (5 m, up to 25 kg)", 899, 1090, 10],
      ["L (5 m, up to 50 kg)", 1199, 1450, 6],
    ]),
  },

  // ---- beds & carriers
  {
    name: "Round bolster bed, washable cover",
    category: BEDS,
    hsn: "94049099",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-BED",
    photo: 11060021,
    tags: [...PET_DOG_CAT, "starter-kit", "bestseller"],
    description: `A round bed with a raised rim to rest the chin on and a soft fibre cushion. The cover zips off and goes in the washing machine; a waterproof liner keeps the inside dry. S fits a cat or a toy dog, XL a Labrador.`,
    attributes: { Material: "Cotton-poly cover, hollow-fibre filling, waterproof liner", Sizes: "S 50 cm, M 65 cm, L 80 cm, XL 95 cm", "Made in": "India (Karur)" },
    ...two("Size", [
      ["S", 899, 1090],
      ["M", 1299, 1550],
      ["L", 1899, 2250],
      ["XL", 2499, 2950],
    ], "Colour", ["Lime", "Grey"], 4),
  },
  {
    name: "Orthopaedic foam bed for senior dogs",
    category: BEDS,
    hsn: "94049099",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-ORT",
    photo: 30205968,
    tags: ["dog", "dog-senior", "dog-adult"],
    description: `A 10 cm slab of high-density memory foam that spreads an old dog's weight off the hips and elbows, with a low side to step on. Cool, washable cover; non-slip base for tiled floors.`,
    attributes: { Material: "Memory foam, washable cover, non-slip base", Sizes: "M 75 × 55 cm, L 90 × 65 cm, XL 110 × 75 cm", "Made in": "India (Coimbatore)" },
    ...one("Size", [
      ["M", 2199, 2600, 6],
      ["L", 2899, 3400, 5],
      ["XL", 3699, 4300, 3],
    ]),
  },
  {
    name: "Cat donut bed",
    category: BEDS,
    hsn: "94049099",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-DNB",
    photo: 29796605,
    tags: [...CAT],
    description: `A deep, fluffy donut that cats curl into and disappear: the high rim makes them feel safe. Machine-washable on a gentle cycle; fluff it up by hand when dry. 50 cm across.`,
    attributes: { Material: "Faux fur, hollow-fibre filling, non-slip base", Size: "50 cm", "Made in": "India (Karur)" },
    ...one("Colour", [
      ["Cream", 999, 1199, 10],
      ["Grey", 999, 1199, 10],
    ]),
  },
  {
    name: "Cooling gel mat for summer",
    category: BEDS,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-COO",
    photo: 16478245,
    tags: [...PET_DOG_CAT, "deal"],
    description: `For the Chennai May: a pressure-activated gel mat that stays a few degrees cooler than the room without a fridge or power. Wipe clean; keep claws trimmed so it isn't punctured. Thick-coated breeds love it.`,
    attributes: { Material: "Non-toxic gel, nylon cover", Sizes: "M 50 × 65 cm, L 60 × 90 cm", "Made in": "India (Chennai)" },
    ...one("Size", [
      ["M", 899, 1050, 12],
      ["L", 1299, 1500, 8],
    ]),
  },
  {
    name: "Ventilated travel carrier",
    category: BEDS,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-CAR",
    photo: 31871494,
    tags: [...PET_DOG_CAT, "starter-kit"],
    description: `A hard plastic carrier with a steel-wire door and vents on three sides, for vet visits and car trips. The top half lifts off, so a nervous cat can be examined in the bottom half. S fits a cat or a dog up to 6 kg, M up to 12 kg.`,
    attributes: { Material: "Polypropylene, steel-wire door", Sizes: "S 48 × 32 × 30 cm, M 60 × 40 × 38 cm", "Made in": "India (Chennai)" },
    ...one("Size", [
      ["S", 1299, 1500, 8],
      ["M", 1899, 2200, 6],
    ]),
  },
  {
    name: "Shoulder sling carrier bag",
    category: BEDS,
    hsn: "42029290",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-SLG",
    photo: 8473657,
    tags: ["dog", "puppy", "dog-adult", "cat", "kitten", "cat-adult"],
    description: `A padded shoulder bag with a short safety leash inside and mesh windows, for small dogs and cats up to 6 kg: to the vet, the mall or the beach. Wipe-clean lining.`,
    attributes: { Material: "Canvas, foam padding, mesh", "Carries up to": "6 kg", "Made in": "India (Chennai)" },
    ...one("Colour", [
      ["Brown", 1199, 1450, 6],
      ["Navy", 1199, 1450, 6],
    ]),
  },

  // ---- pet grooming
  {
    name: "Oatmeal & aloe dog shampoo",
    category: GROOMING,
    hsn: "33079090",
    gstRate: 18,
    unit: "bottle",
    sku: "SP-SHP",
    photo: 17802173,
    tags: [...PET_DOG_CAT, "starter-kit"],
    description: `A gentle, soap-free shampoo for dogs and cats (and puppies from 8 weeks): colloidal oatmeal and aloe vera calm itchy skin, pH balanced for pets, not people. Wet the coat, lather, leave two minutes, rinse well. Bath once in 2–4 weeks; more often dries the skin.${GROOM_NOTE}`,
    attributes: { Ingredients: "Water, mild surfactants, colloidal oatmeal, aloe vera, glycerine, mild fragrance", "Suitable for": "Dogs, cats, puppies from 8 weeks", "Made in": "India (Chennai)", "Shelf life": "24 months" },
    ...one("Size", [
      ["200 ml", 299, 350, 30],
      ["500 ml", 599, 690, 15],
    ]),
  },
  {
    name: "Neem & citronella tick-and-flea shampoo",
    category: GROOMING,
    hsn: "33079090",
    gstRate: 18,
    unit: "bottle",
    sku: "SP-NEM",
    photo: 13062569,
    tags: ["dog", "dog-adult", "dog-senior"],
    description: `A herbal wash for the monsoon months when ticks are everywhere: neem oil, citronella and karanja help keep ticks and fleas off between your vet's treatments. Leave the lather on for five minutes, rinse, then comb with a fine-toothed comb. For dogs only, not cats or puppies under 12 weeks. It doesn't replace the tick treatment your vet prescribes.${GROOM_NOTE}`,
    attributes: { Ingredients: "Water, mild surfactants, neem oil, citronella oil, karanja oil, aloe vera", "Suitable for": "Dogs over 12 weeks (not cats)", "Made in": "India (Coimbatore)", "Shelf life": "24 months" },
    ...single(349, 399, 25),
  },
  {
    name: "Slicker brush",
    category: GROOMING,
    hsn: "96039000",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-SLK",
    photo: 9632122,
    tags: [...PET_DOG_CAT, "starter-kit"],
    description: `Fine bent pins that pull out loose undercoat and tease out knots before they turn into mats: a few minutes a day for Shih Tzus, Lhasas, Pomeranians and long-haired cats. Press the button and the hair drops off the pins.`,
    attributes: { Material: "Stainless steel pins, ABS handle", "Made in": "India (Chennai)" },
    ...one("Size", [
      ["S (cats, toy dogs)", 299, 350, 20],
      ["M (dogs)", 399, 460, 20],
    ]),
  },
  {
    name: "Deshedding brush",
    category: GROOMING,
    hsn: "96039000",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-DSH",
    photo: 8498547,
    tags: ["dog", "dog-adult", "dog-senior", "cat", "cat-adult"],
    description: `A short stainless edge that reaches through the top coat and lifts out the dead undercoat: Labradors, Huskies and Golden Retrievers drop half as much hair on the floor with a weekly session. Not for puppies or thin-coated breeds.`,
    attributes: { Material: "Stainless steel edge, rubber grip", "Blade width": "7 cm", "Made in": "India (Chennai)" },
    ...single(549, 650, 15),
  },
  {
    name: "Rubber bath & massage brush",
    category: GROOMING,
    hsn: "40169990",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-RBB",
    photo: 4432261,
    tags: [...PET_DOG_CAT],
    description: `A soft rubber palm brush that works the shampoo down to the skin in the bath and lifts loose hair from short coats (Indies, Beagles, Labradors) when dry. Dogs treat it as a massage.`,
    attributes: { Material: "Natural rubber", "Made in": "India (Kottayam)" },
    ...single(149, 180, 30),
  },
  {
    name: "Microfibre drying towel",
    category: GROOMING,
    hsn: "63029300",
    gstRate: 5,
    unit: "pcs",
    sku: "SP-TWL",
    photo: 6131158,
    tags: [...PET_DOG_CAT, "starter-kit"],
    description: `Soaks up several times its weight, so a wet dog is half dry before the hair dryer: with hand pockets at both ends. Wash before first use, no fabric softener.`,
    attributes: { Material: "Microfibre (polyester, polyamide)", Sizes: "M 50 × 90 cm, L 70 × 140 cm", "Made in": "India (Tiruppur)" },
    ...one("Size", [
      ["M", 299, 350, 20],
      ["L", 449, 520, 15],
    ]),
  },
  {
    name: "Grooming session voucher",
    category: GROOMING,
    hsn: "999729",
    gstRate: 18,
    unit: "session",
    sku: "SP-GRM",
    photo: 19145877,
    tags: [...PET_DOG_CAT],
    description: `A session in our grooming room at the back of the shop, by appointment (we confirm the slot on WhatsApp after you order). **Bath & dry:** warm-water bath with our oatmeal shampoo, blow-dry, brush-out, ear cleaning, nail trim. **Full groom & trim:** all of that plus a breed or summer trim and paw and hygiene trims. Takes 1–2 hours.\n\nVaccinations must be up to date (bring the card). We don't sedate; anxious pets get breaks or a second short visit. Valid 3 months; reschedule free up to 3 hours before.`,
    attributes: { "Where": "Sellam grooming room, 2nd Avenue, Anna Nagar", "Takes": "1–2 hours", "Valid for": "3 months from purchase" },
    options: [
      { name: "Pet", values: ["Small dog (up to 10 kg)", "Medium dog (10–25 kg)", "Large dog (25 kg+)", "Cat"] },
      { name: "Package", values: ["Bath & dry", "Full groom & trim"] },
    ],
    variants: (
      [
        ["Small dog (up to 10 kg)", 599, 999],
        ["Medium dog (10–25 kg)", 799, 1299],
        ["Large dog (25 kg+)", 999, 1599],
        ["Cat", 699, 1099],
      ] as [string, number, number][]
    ).flatMap(([pet, bath, full]) => [
      { values: { Pet: pet, Package: "Bath & dry" }, price: rs(bath), mrp: rs(bath), stock: 99 },
      { values: { Pet: pet, Package: "Full groom & trim" }, price: rs(full), mrp: rs(full), stock: 99 },
    ]),
  },

  // ---- bowls & litter
  {
    name: "Stainless steel anti-skid bowl",
    category: BOWLS,
    hsn: "73239390",
    gstRate: 5,
    unit: "pcs",
    sku: "SP-BWL",
    photo: 8434633,
    tags: [...PET_DOG_CAT, "starter-kit", "bestseller"],
    description: `Food-grade stainless steel that doesn't hold smells or scratch like plastic, with a rubber ring underneath so it doesn't skate across the floor. Dishwasher-safe. Buy two: one for food, one for water.`,
    attributes: { Material: "Stainless steel 304, rubber base", Capacity: "S 400 ml, M 900 ml, L 1.8 litre", "Made in": "India (Chennai)" },
    ...one("Size", [
      ["S", 179, 210, 30],
      ["M", 249, 290, 30],
      ["L", 349, 399, 20],
    ]),
  },
  {
    name: "Non-slip plastic bowl",
    category: BOWLS,
    hsn: "39241090",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-PBW",
    photo: 12928244,
    tags: [...PET_DOG_CAT],
    description: `A light, BPA-free bowl in soft pastels with a rubber rim underneath: 700 ml, for small dogs and cats. Wash it daily in hot water and replace it once it's scratched (bacteria hide in scratches).`,
    attributes: { Material: "BPA-free polypropylene, rubber base", Capacity: "700 ml", "Made in": "India (Chennai)" },
    ...one("Colour", [
      ["Sky", 149, 180, 20],
      ["Mint", 149, 180, 20],
      ["Coral", 149, 180, 20],
    ]),
  },
  {
    name: "Shallow steel cat bowls, pair",
    category: BOWLS,
    hsn: "73239390",
    gstRate: 5,
    unit: "set",
    sku: "SP-CBW",
    photo: 14553201,
    tags: [...CAT, "starter-kit"],
    description: `Wide, shallow steel bowls so whiskers don't brush the sides (some cats won't eat from deep bowls), on a non-slip base. One for food, one for water; set the water bowl away from the litter tray.`,
    attributes: { Material: "Stainless steel 304, rubber base", Capacity: "250 ml each", "Made in": "India (Chennai)" },
    ...single(249, 290, 25),
  },
  {
    name: "Clumping cat litter, bentonite",
    category: BOWLS,
    hsn: "25081090",
    gstRate: 5,
    unit: "pack",
    sku: "SP-LIT",
    photo: 13705497,
    tags: [...CAT, "refill", "starter-kit"],
    description: `Fine bentonite clay that clumps hard around wet spots, so you scoop the clumps and the rest stays clean: a 5 kg pack lasts one cat about three weeks. Keep 5–7 cm in the tray; never flush it.\n\nUnopened packs can be returned within 7 days.`,
    attributes: { Material: "Bentonite clay", "Dust": "Low dust", "Made in": "India (Gujarat)", "Shelf life": "No expiry; keep dry" },
    ...two("Pack size", [
      ["5 kg", 399, 450],
      ["10 kg", 749, 850],
    ], "Scent", ["Unscented", "Lavender"], 15),
  },

  // ---- birds & fish (accessories; no live birds or fish are sold)
  {
    name: "Powder-coated bird cage",
    category: BIRDS_FISH,
    hsn: "73262090",
    gstRate: 18,
    unit: "pcs",
    sku: "SP-CGE",
    photo: 36842655,
    tags: ["bird"],
    description: `A rust-free powder-coated wire cage with a pull-out tray, two feeders, perches and a swing. S suits a pair of budgies or finches, M a pair of lovebirds or one cockatiel, L a pair of cockatiels. Bar spacing is safe for small heads.\n\nWe sell cages and food only: **no live birds**.`,
    attributes: { Material: "Powder-coated steel wire, plastic tray", Sizes: "S 40 × 30 × 50 cm, M 50 × 36 × 65 cm, L 60 × 40 × 80 cm", "Made in": "India (Chennai)" },
    ...one("Size", [
      ["S", 1199, 1450, 6],
      ["M", 1899, 2250, 5],
      ["L", 2999, 3500, 3],
    ]),
  },
  {
    name: "Glass aquarium starter kit",
    category: BIRDS_FISH,
    hsn: "70200090",
    gstRate: 18,
    unit: "set",
    sku: "SP-AQK",
    photo: 26611976,
    tags: ["fish"],
    description: `A clear float-glass tank with a hood and LED light, a hang-on filter, gravel and a water conditioner: set it up, run it a week before the first fish and add a few at a time. Delivered in Chennai by our van; heavy, so not couriered outside.\n\nWe sell tanks, food and gear only: **no live fish**. Ask us for the aquarium shops near Kolathur we trust.`,
    attributes: { Material: "6 mm float glass, silicone joints", Sizes: "1.5 ft 45 × 25 × 30 cm (34 litre), 2 ft 60 × 30 × 36 cm (65 litre)", "In the box": "Tank, hood with LED, hang-on filter, 2 kg gravel, conditioner", "Made in": "India (Chennai)" },
    ...one("Size", [
      ["1.5 ft", 2499, 2900, 4],
      ["2 ft", 3499, 4100, 3],
    ]),
  },
  {
    name: "Aquarium air pump with sponge filter",
    category: BIRDS_FISH,
    hsn: "84148090",
    gstRate: 18,
    unit: "set",
    sku: "SP-AQP",
    photo: 16060331,
    tags: ["fish"],
    description: `A quiet air pump with tubing, a non-return valve and a double sponge filter: oxygen for the fish and a home for the good bacteria. Rinse the sponge in old tank water (never tap water) once a month. 6-month warranty on the pump.`,
    attributes: { Power: "3 W (single), 4 W (double)", "For tanks up to": "60 litre (single), 120 litre (double)", Warranty: "6 months", "Made in": "India (Chennai)" },
    ...one("Outlet", [
      ["Single", 449, 520, 10],
      ["Double", 599, 690, 8],
    ]),
  },
];

const PHOTOS: DemoStore["photos"] = {
  7086030: { by: "cottonbro studio", alt: "Puppy eating from a steel bowl on patterned tiles" },
  6568950: { by: "cottonbro studio", alt: "Brown dog eating kibble from a white bowl" },
  8434670: { by: "MART PRODUCTION", alt: "Dog with a pink collar eating from a steel bowl" },
  8434725: { by: "MART PRODUCTION", alt: "Small brown dog eating from its bowl in a living room" },
  30070529: { by: "Amar Preciado", alt: "Black dog in a scarf licking its lips beside a bowl of vegetables" },
  19892502: { by: "Katia Miasoed", alt: "Rottweiler sitting beside raised steel food bowls" },
  30070537: { by: "Amar Preciado", alt: "Dog waiting for a bowl of wet food in gravy" },
  19086863: { by: "Amar Preciado", alt: "Dog waiting in a kitchen while its meal is served" },
  34719941: { by: "Primitive Spaces", alt: "Tabby kitten on a carpet beside a toy ball" },
  16618557: { by: "Eduardo López", alt: "Grey cat eating dry food from a green bowl" },
  16618549: { by: "Eduardo López", alt: "Black cat looking into a blue bowl of dry food" },
  13317322: { by: "Claudia Schmalz", alt: "Fluffy cat eating from a white cat bowl" },
  18275951: { by: "Petr Ganaj", alt: "Close-up of mixed millet seeds" },
  19904796: { by: "Frank Grün", alt: "Cockatiel in a cage with a millet spray" },
  33867664: { by: "Florian O.", alt: "Aquarium fish among green plants" },
  19680232: { by: "Stacey Koenitz", alt: "Goldfish swimming in a clear aquarium" },
  8121148: { by: "Rubenstein Rebello", alt: "Bone-shaped treats and chew sticks spilling from a paper bag" },
  8434641: { by: "MART PRODUCTION", alt: "Bone-shaped dog biscuits in a steel bowl" },
  8121154: { by: "Rubenstein Rebello", alt: "Colourful bone-shaped biscuits on brown paper" },
  28293539: { by: "Sean Brannon", alt: "Puppy chewing a bone-shaped chew with its eyes closed" },
  39269451: { by: "大 董", alt: "Fluffy cat licking a treat from a hand" },
  12866880: { by: "Alexas Fotos", alt: "Shih Tzu puppy looking up at a treat" },
  15356245: { by: "Laura Alessia", alt: "Golden puppy chewing a colourful rope toy on the grass" },
  33742356: { by: "Maikol Herrera", alt: "Dachshund puppy biting an orange chew bone" },
  14331261: { by: "K", alt: "Black dog holding a plush toy" },
  15013953: { by: "Richard Issa Bockari", alt: "Dog holding a ball in its mouth on a wooden floor" },
  10914514: { by: "David Yu", alt: "Kitten playing with a feather wand" },
  7725977: { by: "Arina Krasnikova", alt: "Cat standing beside a sisal-rope scratching post" },
  14979534: { by: "Imad Djaout", alt: "Pomeranian on a red leash on the pavement" },
  3067506: { by: "Felipe Cespedes", alt: "Mixed-breed dog wearing a blue collar" },
  30558513: { by: "Jolene Engelbrecht", alt: "Terrier puppy in a green padded harness on the grass" },
  4192830: { by: "Furknsaglam", alt: "White puppy on a pink leash in a park" },
  11060021: { by: "Albina White", alt: "Beagle lying in a soft round bed, seen from above" },
  30205968: { by: "Harris Rigorad", alt: "Old dog resting its chin on a cushioned bed" },
  29796605: { by: "Michał Robak", alt: "Ginger cat curled up in a soft cat bed" },
  16478245: { by: "Giovana Spiller", alt: "Dog lying on a cool teal mat" },
  31871494: { by: "Fabian Bock", alt: "Dog in a harness looking out of a red pet carrier" },
  8473657: { by: "Cup of Couple", alt: "Pomeranian sitting in a brown shoulder carrier bag" },
  17802173: { by: "Pet foto", alt: "Two poodles in a bubble bath" },
  13062569: { by: "Makiko Fujimoto", alt: "Smiling Shiba Inu at bath time" },
  9632122: { by: "Yaroslav Shuraev", alt: "Husky being brushed with a pink slicker brush" },
  8498547: { by: "Yaroslav Shuraev", alt: "Fluffy white dog being brushed on a wooden floor" },
  4432261: { by: "Mathew Coulton", alt: "Rubber bath brush and a towel on a parquet floor" },
  6131158: { by: "Tima Miroshnichenko", alt: "Wet puppy wrapped in a towel" },
  19145877: { by: "Goochie Poochie Grooming", alt: "Yorkshire Terrier being trimmed on a grooming table" },
  8434633: { by: "MART PRODUCTION", alt: "Steel dog bowl filled with dry food on a wooden floor" },
  12928244: { by: "Barking Royalty", alt: "Pastel blue bowl of kibble seen from above" },
  14553201: { by: "Linny (Frosty)", alt: "Tabby cat drinking from a steel bowl" },
  13705497: { by: "Nadiye Odabaşı", alt: "Cat stepping out of a litter tray" },
  36842655: { by: "Henry Acevedo", alt: "Two budgies on a perch in a wire cage" },
  26611976: { by: "27 1", alt: "Small planted aquarium with a light on a table" },
  16060331: { by: "Shamsuri Azmi", alt: "Fish among tall plants in a freshwater tank" },
  8434635: { by: "MART PRODUCTION", alt: "Bowl of dog food on a wooden floor" },
  8434744: { by: "MART PRODUCTION", alt: "Hand pouring dog food into a bowl" },
  6782551: { by: ".M.Q Huang", alt: "Two cats eating from bowls on a wooden stand" },
  34951080: { by: "Magda Ehlers", alt: "Budgie eating greens and seeds from a bamboo tray" },
  8121146: { by: "Rubenstein Rebello", alt: "Colourful dog treats spilling from a paper bag" },
  4445461: { by: "Mathew Coulton", alt: "Black dog playing among colourful toys on a parquet floor" },
  11059991: { by: "Albina White", alt: "Beagle resting on a grey dog bed" },
  6816850: { by: "Gustavo Fring", alt: "Yorkshire Terrier being combed by a gloved hand" },
  12928245: { by: "Barking Royalty", alt: "Blue bowl of pet food on a cream background" },
  9348934: { by: "Magda Ehlers", alt: "Two green budgies in a cage" },
  39052700: { by: "Phenomenal Clicks", alt: "Indian Pariah dog standing on a green path" },
  16846707: { by: "Debendra Das", alt: "Indian puppy on a brick pavement" },
  34990726: { by: "Hami Durgut", alt: "Ginger and white cats cuddled together" },
  38456256: { by: "SUMANJIT", alt: "Two kittens peeking out together" },
  34595529: { by: "Regan Dsouza", alt: "Green budgie close-up" },
  5966770: { by: "kabita Darlami", alt: "Orange goldfish in an aquarium" },
  3860309: { by: "Tanya Gorelova", alt: "White puppy playing with a ball indoors" },
  4445456: { by: "Mathew Coulton", alt: "Puppy asleep in a round bed with a leash, collar, harness, toys, shampoo, brush and bowls around it" },
  28802858: { by: "Crina Doltu", alt: "Freshly groomed Yorkshire Terrier on a red cushion with toys" },
  6131161: { by: "Tima Miroshnichenko", alt: "Yorkshire Terrier being showered at a grooming table" },
  6131571: { by: "Tima Miroshnichenko", alt: "Yorkshire Terrier after grooming, against a blue wall" },
  14629493: { by: "Dora Nagy", alt: "Senior dog in a knitted sweater" },
  29923764: { by: "Jenna Hamra", alt: "Labrador puppy chewing a stick on a sofa" },
  7725617: { by: "Arina Krasnikova", alt: "Three cats on a cat tree" },
  30630826: { by: "Suhas Hanjar", alt: "Indian Pariah dog portrait" },
  21847410: { by: "Nguyễn Khánh", alt: "Goldfish among green aquarium plants" },
};

const HOURS = [
  { label: "Mon – Sat", value: "9:30 am – 9:00 pm" },
  { label: "Sunday", value: "10:00 am – 2:00 pm" },
  { label: "Grooming room", value: "By appointment, Tue – Sun" },
];

const FAQ = [
  {
    q: "Do you sell puppies, kittens, birds or fish?",
    a: "**No. We don't sell live animals of any kind.** We sell food, care products and gear, and we groom. If you're ready for a pet, please adopt: the Blue Cross of India and other Chennai shelters have dogs and cats looking for homes, and we'll give you a 10% starter-kit discount (code **ADOPTED10**) when you show us the adoption papers.",
  },
  {
    q: "Which food should I buy for my dog?",
    a: "Go by **age first, then size**: puppy food to 12 months (18 for large breeds), adult food to about 7 years, senior food after. Large dogs (25 kg+) do better on a large-breed food. If your dog itches or has loose stools on chicken, try the lamb & rice. Change foods over 7 days. Our [feeding guide](/pages/feeding-guide) has amounts by weight; for a dog with a health condition, ask your vet.",
  },
  {
    q: "Can I return food?",
    a: "**Unopened packs** of food, treats and litter can be returned within **7 days of delivery** for a refund or an exchange (a different flavour or size is fine). Opened packs can't be returned unless the food is spoiled, damaged or past its date: send us a photo on WhatsApp and we replace it. Chilled fresh meals and loose biscuits can't be returned once delivered.",
  },
  {
    q: "How does the monthly food box work?",
    a: "Pick a box, tell us the food (flavour, puppy / adult / senior) and a delivery day on WhatsApp. We deliver every month on that day in Chennai, free; you pay on delivery or by UPI. Change the food, skip or pause a month with one message, at least 2 days before.",
  },
  {
    q: "How do I book grooming?",
    a: "Buy a **grooming session voucher** for your pet's size here (or at the counter), then send us the order number on WhatsApp with two dates: we confirm a slot the same day. Bring the vaccination card. Sessions take 1–2 hours; you can wait in the shop or we call you.",
  },
  {
    q: "My pet is unwell. Can you suggest a medicine?",
    a: "No: we're a pet shop, not a vet, and we don't sell prescription medicines. Our tips on food and grooming are general advice, not a diagnosis. For vomiting, not eating, limping, skin wounds or ticks that don't go, **please see a veterinarian**.",
  },
  {
    q: "How fast is delivery?",
    a: "Anna Nagar, Kilpauk, Mogappair, Aminjikarai and the rest of Chennai (600xxx): same day if you order by 2 pm, otherwise next day, by our own riders; free above ₹999. Rest of Tamil Nadu: 2–4 days by courier. Rest of India: 3–7 days. Fresh chilled meals and aquarium tanks go only within Chennai.",
  },
];

const FAQ_TA = [
  {
    q: "நாய்க்குட்டி, பூனைக்குட்டி, பறவை, மீன் விற்கிறீர்களா?",
    a: "**இல்லை. நாங்கள் எந்த உயிருள்ள விலங்கையும் விற்பதில்லை.** உணவு, பராமரிப்புப் பொருட்கள், உபகரணங்கள் மட்டுமே விற்கிறோம்; குளிப்பாட்டி அழகுபடுத்துகிறோம். செல்லப்பிராணி வளர்க்கத் தயாரா? தத்தெடுங்கள்: Blue Cross of India உள்ளிட்ட சென்னை காப்பகங்களில் வீடு தேடும் நாய்களும் பூனைகளும் உள்ளன. தத்தெடுப்பு ஆவணத்தைக் காட்டினால் ஸ்டார்ட்டர் கிட்டுக்கு 10% தள்ளுபடி (குறியீடு **ADOPTED10**).",
  },
  {
    q: "என் நாய்க்கு எந்த உணவு வாங்க வேண்டும்?",
    a: "**முதலில் வயது, பிறகு அளவு**: 12 மாதம் வரை (பெரிய இனங்களுக்கு 18) நாய்க்குட்டி உணவு, சுமார் 7 வயது வரை வளர்ந்த நாய் உணவு, அதன் பிறகு முதிய நாய் உணவு. 25 கிலோவுக்கு மேல் உள்ள நாய்களுக்கு பெரிய இன உணவு நல்லது. சிக்கன் உணவில் அரிப்பு அல்லது தளர்ந்த மலம் இருந்தால் லாம்ப் & ரைஸ் முயலுங்கள். உணவை 7 நாளில் மெல்ல மாற்றுங்கள். எடைக்கேற்ற அளவுகள் எங்கள் [உணவு வழிகாட்டியில்](/pages/feeding-guide); உடல்நலக் குறைவு உள்ள நாய்க்கு கால்நடை மருத்துவரிடம் கேளுங்கள்.",
  },
  {
    q: "உணவைத் திருப்பித் தரலாமா?",
    a: "உணவு, தின்பண்டம், லிட்டரின் **திறக்காத பேக்குகளை** **டெலிவரியிலிருந்து 7 நாளுக்குள்** திருப்பித் தந்து பணம் பெறலாம் அல்லது மாற்றலாம் (வேறு சுவை அல்லது அளவு சரி). திறந்த பேக்குகள் கெட்டுப்போனாலோ, சேதமடைந்தாலோ, தேதி முடிந்தாலோ மட்டும்: வாட்ஸ்அப்பில் படம் அனுப்புங்கள், மாற்றித் தருவோம். குளிர்ந்த ஃப்ரெஷ் உணவும் எடைக்கு வாங்கிய பிஸ்கட்டும் டெலிவரிக்குப் பின் திருப்ப முடியாது.",
  },
  {
    q: "மாதாந்திர உணவுப் பெட்டி எப்படி?",
    a: "ஒரு பெட்டியைத் தேர்ந்தெடுத்து, உணவு (சுவை, குட்டி / வளர்ந்த / முதிய) மற்றும் டெலிவரி நாளை வாட்ஸ்அப்பில் சொல்லுங்கள். சென்னையில் ஒவ்வொரு மாதமும் அதே நாளில் இலவசமாகக் கொண்டு வருவோம்; டெலிவரியில் பணம் அல்லது UPI. உணவை மாற்ற, ஒரு மாதம் தவிர்க்க அல்லது நிறுத்த 2 நாள் முன் ஒரு மெசேஜ் போதும்.",
  },
  {
    q: "குளியல் & அழகுபடுத்தலை எப்படி முன்பதிவு செய்வது?",
    a: "உங்கள் செல்லத்தின் அளவுக்கு ஏற்ற **குரூமிங் வவுச்சரை** இங்கே (அல்லது கடையில்) வாங்கி, ஆர்டர் எண்ணையும் இரண்டு தேதிகளையும் வாட்ஸ்அப்பில் அனுப்புங்கள்: அன்றே நேரத்தை உறுதி செய்வோம். தடுப்பூசி அட்டையைக் கொண்டு வாருங்கள். 1–2 மணி நேரம் ஆகும்; கடையில் காத்திருக்கலாம் அல்லது நாங்கள் அழைப்போம்.",
  },
  {
    q: "என் செல்லத்துக்கு உடல்நலம் சரியில்லை. மருந்து சொல்வீர்களா?",
    a: "இல்லை: நாங்கள் செல்லப்பிராணிக் கடை, கால்நடை மருத்துவர் அல்ல; மருந்துச் சீட்டு மருந்துகளை விற்பதில்லை. உணவு, பராமரிப்பு பற்றிய எங்கள் குறிப்புகள் பொதுவான ஆலோசனை மட்டுமே, நோய் கண்டறிதல் அல்ல. வாந்தி, சாப்பிடாமை, நொண்டுதல், தோல் காயம், போகாத உண்ணிகள் இருந்தால் **கால்நடை மருத்துவரைப் பாருங்கள்**.",
  },
  {
    q: "டெலிவரி எவ்வளவு வேகம்?",
    a: "அண்ணா நகர், கீழ்ப்பாக்கம், முகப்பேர், அமைந்தகரை உள்ளிட்ட சென்னை முழுவதும் (600xxx): மதியம் 2 மணிக்குள் ஆர்டர் செய்தால் அதே நாள், இல்லையெனில் மறுநாள், எங்கள் சொந்த டெலிவரியாளர்கள் மூலம்; ₹999-க்கு மேல் இலவசம். தமிழ்நாட்டின் மற்ற இடங்கள்: கூரியரில் 2–4 நாள். இந்தியாவின் மற்ற இடங்கள்: 3–7 நாள். குளிர்ந்த ஃப்ரெஷ் உணவும் மீன் தொட்டிகளும் சென்னைக்குள் மட்டும்.",
  },
];

/** Food types compared on the home page: dry kibble, wet pouches, fresh-cooked (in that order). */
const FOOD_ROWS = [
  { label: "What it is", values: ["Baked kibble", "Chunks in gravy", "Home-style cooked, chilled"] },
  { label: "Water in it", values: ["About 10%", "About 82%", "About 70%"] },
  { label: "Protein (as fed)", values: ["24%", "8%", "11%"] },
  { label: "A day for a 15 kg dog", values: ["≈ 230 g, about ₹65", "Topper: 1 pouch, ₹52", "≈ 750 g, about ₹270"] },
  { label: "Once opened", values: ["6 weeks in a closed tin", "24 hours in the fridge", "2 days in the fridge"] },
  { label: "Unopened", values: ["12 months", "18 months", "5 days chilled"] },
  { label: "Best for", values: ["Everyday meals, every dog", "Fussy eaters, older dogs", "Picky or senior dogs, Chennai only"] },
];
const FOOD_ROWS_TA = [
  { label: "இது என்ன", values: ["சுட்ட கிபிள்", "குழம்பில் துண்டுகள்", "வீட்டுப் பாணி சமையல், குளிர்ந்தது"] },
  { label: "நீர்ச்சத்து", values: ["சுமார் 10%", "சுமார் 82%", "சுமார் 70%"] },
  { label: "புரதம் (உணவில்)", values: ["24%", "8%", "11%"] },
  { label: "15 கிலோ நாய்க்கு ஒரு நாள்", values: ["≈ 230 கி, சுமார் ₹65", "மேலே: 1 பவுச், ₹52", "≈ 750 கி, சுமார் ₹270"] },
  { label: "திறந்த பின்", values: ["மூடிய டப்பாவில் 6 வாரம்", "ஃப்ரிட்ஜில் 24 மணி நேரம்", "ஃப்ரிட்ஜில் 2 நாள்"] },
  { label: "திறக்காமல்", values: ["12 மாதம்", "18 மாதம்", "குளிரில் 5 நாள்"] },
  { label: "யாருக்கு ஏற்றது", values: ["தினசரி உணவு, எல்லா நாய்களுக்கும்", "சாப்பிட அடம் பிடிப்பவை, முதிய நாய்கள்", "அடம் பிடிக்கும் / முதிய நாய்கள், சென்னை மட்டும்"] },
];

/** A five-star testimonial with the pet's photo. */
const tail = (quote: string, name: string, role: string, photoUrl: string) => ({ quote, name, role, rating: 5, photoUrl });

/** Translation words (the shape `translations` accepts): the plans differ in shape (one has a badge), see docs' typing pitfall. */
type Words = string | Words[] | { [key: string]: Words };
const words = (o: { [key: string]: Words }) => o;

export const SELLAM: DemoStore = {
  shop: {
    slug: "sellam",
    appId: "EC",
    businessType: "pet_shop",
    planId: "pro",
    name: "Sellam Pet Store",
    primary: "#0b6b66",
    billing: {
      legalName: "Sellam Pet Store",
      gstin: "33AAKFS4127M1ZY",
      address: "AC-112, 2nd Avenue, Anna Nagar",
      city: "Chennai",
      pincode: "600040",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "SP",
      upiId: "sellampets@okaxis",
    },
    // Counter-only charges (GST-exclusive rates): nail trim and tick picking without a full session (SAC 999729: 18%).
    items: [
      { name: "Nail trim (walk-in)", hsn: "999729", unit: "service", rate: 12_712, gstRate: 18 },
      { name: "Tick removal by hand (walk-in)", hsn: "999729", unit: "service", rate: 25_339, gstRate: 18 },
    ],
  },
  preset: "lagoon-paws",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 800_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "hello@sellampets.in",
    social: {
      whatsapp: PHONE,
      instagram: "https://instagram.com/sellam.annanagar",
      youtube: "https://youtube.com/@sellampets",
    },
    policies: {
      shipping:
        "**Chennai (600xxx):** same day if you order by 2 pm, otherwise next day, by our own riders. ₹49, free above ₹999. Heavy bags (10 kg and 20 kg) are carried up to your door, lift or no lift.\n\n**Rest of Tamil Nadu:** 2–4 days by courier, ₹99, free above ₹1,999. Cash on delivery up to ₹8,000 (₹30 fee).\n\n**Rest of India:** 3–7 days by courier, ₹149, free above ₹2,999. Prepaid only.\n\n**Chennai only:** fresh chilled dog meals (in an insulated bag, morning slots) and glass aquarium tanks (by our van).",
      returns:
        "**Food, treats and litter:** unopened packs can be returned within **7 days of delivery** for a refund or an exchange. Opened packs can't be returned, unless spoiled, damaged or past the best-before date: send a photo on WhatsApp within 48 hours and we replace it. Chilled fresh meals and loose biscuits can't be returned once delivered.\n\n**Accessories** (leashes, collars, harnesses, beds, bowls, toys, cages): unused, with tags, exchanged or refunded within 7 days. Chewed toys and used grooming tools can't be returned.\n\n**Grooming vouchers:** valid 3 months; reschedule free up to 3 hours before your slot; unused vouchers are refunded within 30 days of purchase.\n\n**We don't sell live animals.**",
      privacy:
        "We use your name, phone and address to deliver your orders, send your GST bill and remind you about your food box or grooming slot (only if you asked). Your pet's name, breed and birthday stay with us to suggest the right food, and are never shared or sold.",
      terms:
        "Prices include GST (18% on most pet food and accessories, 5% on steel bowls, litter, textile toys and towels and wooden scratching posts). **Sellam does not sell live animals.** Feeding amounts, product descriptions and staff tips are general advice, not veterinary advice: for any health problem, see a registered veterinarian. Grooming needs up-to-date vaccinations; we don't sedate pets and may stop a session if a pet is too stressed.",
    },
    businessType: "pet_shop",
  },
  zones: [
    {
      name: "Chennai",
      pincodePrefixes: ["600"],
      rate: { name: "Our riders (same / next day)", type: "free_above", amount: 4_900, freeAbove: 99_900, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–4 days)", type: "free_above", amount: 9_900, freeAbove: 199_900, etaMinDays: 2, etaMaxDays: 4, codAllowed: true, codFee: 3_000 },
    },
    {
      name: "Rest of India",
      states: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "26", "27", "29", "30", "31", "32", "34", "35", "36", "37", "38"],
      rate: { name: "Courier (3–7 days)", type: "free_above", amount: 14_900, freeAbove: 299_900, etaMinDays: 3, etaMaxDays: 7, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: FOOD, description: "Dry, wet and fresh food for dogs and cats by life stage, and seed and flakes for birds and fish.", photo: 8434635 },
    { name: DOG_FOOD, parent: FOOD, description: "Puppy, adult, senior, large-breed and vegetarian dry food in 1, 3 and 10 kg packs, wet pouches and fresh-cooked meals.", photo: 8434744 },
    { name: CAT_FOOD, parent: FOOD, description: "Kitten, adult and indoor dry food and wet pouches in gravy.", photo: 6782551 },
    { name: BIRD_FISH_FOOD, parent: FOOD, description: "Budgie, lovebird and cockatiel seed mixes, tropical flakes and goldfish pellets.", photo: 34951080 },
    { name: TREATS, description: "Chicken jerky, milk biscuits (packed or loose by weight), dental chews, training treats and lickable cat treats.", photo: 8121146 },
    { name: TOYS, description: "Rope, chew and plush toys, cat wands and scratching posts, and leashes, collars and harnesses in S to XL.", photo: 4445461 },
    { name: BEDS, description: "Bolster, orthopaedic and donut beds, a cooling mat for summer, travel carriers and sling bags.", photo: 11059991 },
    { name: GROOMING, description: "Gentle and neem shampoos, brushes, drying towels and grooming sessions in our grooming room.", photo: 6816850 },
    { name: BOWLS, description: "Steel and plastic bowls and clumping cat litter.", photo: 12928245 },
    { name: BIRDS_FISH, description: "Bird cages, aquarium kits, air pumps and filters. No live birds or fish are sold.", photo: 9348934 },
  ],
  products: withPriceBandGst(PRODUCTS),
  collections: [
    { name: "Everything in the shop", slug: "all-products", description: "Every food, treat and accessory we stock, A to Z.", rule: { sort: "name" } },
    { name: "Bestsellers", slug: "bestsellers", description: "What Anna Nagar's dogs and cats go through fastest.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "For dogs", slug: "for-dogs", description: "Food, treats, toys, walking gear, beds and grooming for dogs.", rule: { tag: "dog", sort: "price-asc" } },
    { name: "For cats", slug: "for-cats", description: "Food, litter, toys, beds and grooming for cats.", rule: { tag: "cat", sort: "price-asc" } },
    { name: "New puppy & kitten starter kit", slug: "starter-kit", description: "Everything a new puppy or kitten needs in the first week home.", rule: { tag: "starter-kit", sort: "price-asc" } },
    { name: "Monthly refills", slug: "monthly-refills", description: "Food, biscuits, chews and litter that go into the monthly food box.", rule: { tag: "refill", sort: "price-asc" } },
    { name: "Price drops", slug: "price-drops", description: "The shop's sharpest prices on MRP right now.", rule: { tag: "deal", sort: "price-asc" } },
    { name: "Just in", slug: "new-arrivals", description: "New stock on the shelves.", rule: { sort: "new" } },
  ],
  coupons: [
    {
      code: "FIRSTPAW",
      description: "₹100 off your first order above ₹999",
      type: "flat",
      value: 10_000,
      minOrder: 99_900,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      channels: ["store"],
    },
    {
      code: "ADOPTED10",
      description: "10% off (up to ₹500) for families who adopted a dog or cat: show the adoption papers",
      type: "percent",
      value: 10,
      minOrder: 99_900,
      maxDiscount: 50_000,
      perCustomerLimit: 1,
      channels: ["store", "manual"],
    },
    {
      code: "BIGBAG5",
      description: "5% off orders above ₹3,000 (up to ₹300): stock up on the big bags",
      type: "percent",
      value: 5,
      minOrder: 300_000,
      maxDiscount: 30_000,
      channels: ["store", "manual"],
    },
  ],
  home: ({ photo, category, product }) => ({
    seo: {
      title: "Sellam Pet Store, Anna Nagar, Chennai: food, care and grooming",
      description:
        "Dog and cat food by life stage, treats, toys, leashes, beds, bird and fish supplies and a grooming room in Anna Nagar, Chennai. Monthly food boxes, same-day delivery. We don't sell animals: adopt, don't shop.",
      imageUrl: photo(4445456),
    },
    sections: [
      {
        type: "tiles",
        id: "sp-pets",
        title: "Who's waiting at home?",
        text: "Start with your pet: everything for them on one shelf.",
        layout: "grid",
        showCounts: true,
        items: [
          { label: "Dogs", note: "Food by age and size, walks, beds", imageUrl: photo(39052700, "tile"), tag: "dog" },
          { label: "Puppies", note: "Soft kibble, chews, a first collar", imageUrl: photo(16846707, "tile"), tag: "puppy" },
          { label: "Cats", note: "Food, litter, scratching, naps", imageUrl: photo(34990726, "tile"), tag: "cat" },
          { label: "Kittens", note: "Kitten food, wands, a cosy bed", imageUrl: photo(38456256, "tile"), tag: "kitten" },
          { label: "Birds", note: "Seed mixes and cages", imageUrl: photo(34595529, "tile"), tag: "bird" },
          { label: "Fish", note: "Flakes, pellets, tanks, pumps", imageUrl: photo(5966770, "tile"), tag: "fish" },
        ],
      },
      {
        type: "finder",
        id: "sp-finder",
        title: "What does your pet need?",
        text: "Three taps: who it's for, what you're after and your budget. We show only what fits.",
        layout: "wizard",
        results: "button",
        buttonLabel: "Show what fits",
        imageUrl: photo(3860309, "tile"),
        cta: { label: "Ask us on WhatsApp instead", href: waLink("Hello Sellam, I need help choosing for my pet: ") },
        questions: [
          {
            label: "Who is it for?",
            options: [
              { label: "Puppy (under 1 year)", tag: "puppy" },
              { label: "Grown-up dog", tag: "dog-adult" },
              { label: "Senior dog (7+)", tag: "dog-senior" },
              { label: "Kitten", tag: "kitten" },
              { label: "Grown-up cat", tag: "cat-adult" },
              { label: "Bird", tag: "bird" },
              { label: "Fish", tag: "fish" },
            ],
          },
          {
            label: "What do you need?",
            options: [
              { label: "Food", categoryId: category(FOOD) },
              { label: "Treats & chews", categoryId: category(TREATS) },
              { label: "Toys & walks", categoryId: category(TOYS) },
              { label: "Bed or carrier", categoryId: category(BEDS) },
              { label: "Bath & brushing", categoryId: category(GROOMING) },
              { label: "Bowls & litter", categoryId: category(BOWLS) },
              { label: "Cage or tank", categoryId: category(BIRDS_FISH) },
            ],
          },
          {
            label: "Your budget",
            options: [
              { label: "Under ₹300", priceMax: rs(300) },
              { label: "₹300 – ₹1,000", priceMin: rs(300), priceMax: rs(1000) },
              { label: "Above ₹1,000", priceMin: rs(1000) },
            ],
          },
        ],
      },
      {
        type: "comparison",
        id: "sp-foodtypes",
        title: "Dry, wet or fresh?",
        text: "Most dogs do best on a good dry food, with wet or fresh food as a treat or a topper. Here's how the three compare for a 15 kg dog.",
        productIds: [product("Adult dog dry food, chicken & rice"), product("Dog wet food in gravy, 70 g pouches"), product("Fresh-cooked dog meal, chilled (Chennai only)")],
        highlightId: product("Adult dog dry food, chicken & rice"),
        highlightLabel: "Most dogs",
        showRating: false,
        rows: FOOD_ROWS,
      },
      {
        type: "pricing-table",
        id: "sp-foodbox",
        title: "The monthly food box",
        text: "The same food, on the same day every month, delivered free in Chennai and cheaper than buying it bag by bag. Skip or pause with one WhatsApp message.",
        plans: [
          {
            name: "Small dog",
            price: rs(1249),
            period: "/ month",
            description: "For dogs up to 10 kg: Indies' puppies, Shih Tzus, Pugs, Dachshunds.",
            features: ["3 kg dry food (puppy, adult or senior)", "500 g milk biscuits", "7 dental chew sticks", "Free delivery on your day", "Skip or pause any month"],
            cta: { label: "Start this box", href: waLink("Hello Sellam, I'd like the Small dog food box. Food: … Delivery day: …") },
          },
          {
            name: "Medium dog",
            price: rs(3699),
            period: "/ month",
            description: "For dogs of 10–25 kg: Indies, Beagles, Kombais, Chippiparais.",
            features: ["10 kg dry food (chicken, lamb or veg)", "12 wet food pouches", "250 g chicken jerky", "7 dental chew sticks", "Free delivery on your day", "Skip or pause any month"],
            highlight: true,
            badge: "Most picked",
            cta: { label: "Start this box", href: waLink("Hello Sellam, I'd like the Medium dog food box. Food: … Delivery day: …") },
          },
          {
            name: "Big dog",
            price: rs(6499),
            period: "/ month",
            description: "For dogs over 25 kg: Labradors, Shepherds, Rajapalayams.",
            features: ["20 kg large-breed dry food", "1 kg milk biscuits", "Two packs of large dental chews", "Carried up to your door", "Skip or pause any month"],
            cta: { label: "Start this box", href: waLink("Hello Sellam, I'd like the Big dog food box. Delivery day: …") },
          },
          {
            name: "Cat",
            price: rs(1599),
            period: "/ month",
            description: "For one cat or a kitten.",
            features: ["1.2 kg dry food (kitten, adult or indoor)", "12 wet food pouches", "4 lickable treats", "5 kg clumping litter", "Free delivery on your day"],
            cta: { label: "Start this box", href: waLink("Hello Sellam, I'd like the Cat food box. Food: … Delivery day: …") },
          },
        ],
      },
      {
        type: "shop-the-look",
        id: "sp-starter",
        title: "Bringing a puppy home?",
        text: "The first-week kit we pack for new families: a bed with sides, a collar and a leash, a harness for later, a rope toy, a gentle shampoo, a bath brush, a towel and puppy food. Tap a dot to add it.",
        imageUrl: photo(4445456),
        alt: "Puppy asleep in a round bed surrounded by a leash, collar, harness, toys, shampoo, brush, towel and food bowls",
        hotspots: [
          { x: 55, y: 40, productId: product("Round bolster bed, washable cover") },
          { x: 87, y: 18, productId: product("Puppy dry food, chicken & rice") },
          { x: 16, y: 50, productId: product("Cotton rope tug toy") },
          { x: 26, y: 65, productId: product("Oatmeal & aloe dog shampoo") },
          { x: 9, y: 65, productId: product("Rubber bath & massage brush") },
          { x: 86, y: 68, productId: product("Microfibre drying towel") },
          { x: 30, y: 88, productId: product("Padded nylon collar") },
          { x: 85, y: 88, productId: product("No-pull chest harness") },
        ],
      },
      {
        type: "hero-split",
        id: "sp-groomroom",
        imageUrl: photo(28802858, "tile"),
        imageSide: "right",
        eyebrow: "The grooming room · behind the shop",
        heading: "Bath day, without the bathroom flood",
        text: "Warm-water baths, a proper blow-dry, ears, nails and a summer trim, by two groomers who've handled everything from a nervous Indie to a Persian who hates water. No sedation, breaks when needed, and you get a photo on WhatsApp when it's done.",
        cta: { label: "Book a session", href: "/pages/grooming" },
        cta2: { label: "Buy a voucher", href: "/c/pet-grooming" },
      },
      {
        type: "before-after",
        id: "sp-bathday",
        title: "Before and after",
        text: "Drag the line: a Yorkshire Terrier in the shower and an hour later, dried, brushed and trimmed.",
        beforeUrl: photo(6131161, "tile"),
        afterUrl: photo(6131571, "tile"),
        beforeLabel: "Bath",
        afterLabel: "An hour later",
      },
      {
        type: "testimonials",
        id: "sp-tails",
        title: "Happy tails from the neighbourhood",
        layout: "cards",
        items: [
          tail("Bruno is twelve and stiff in the mornings. Sellam moved him to the senior food and the foam bed; he climbs the stairs to the terrace again.", "Bruno's family", "Anna Nagar West", photo(14629493, "square")),
          tail("We adopted Laddu from a shelter with nothing. They packed a starter kit in ten minutes and told us how much to feed him by the week.", "Laddu's family", "Mogappair", photo(29923764, "square")),
          tail("Three cats, one flat. The cat food box arrives on the 5th with the litter, carried up to the fourth floor. I haven't run out once this year.", "Mittai, Biscuit & Pepper's human", "Kilpauk", photo(7725617, "square")),
        ],
      },
      {
        type: "team",
        id: "sp-regulars",
        title: "Who you'll meet at the shop",
        text: "No animals for sale here, but a few who live with us.",
        members: [
          { name: "Raja", role: "Shop dog, adopted 2019", photoUrl: photo(39052700, "square"), bio: "An Indie off 2nd Avenue who walked in during the 2019 rains and stayed. Greets everyone, checks every delivery." },
          { name: "Thangam & co.", role: "The counter tank", photoUrl: photo(21847410, "square"), bio: "Four goldfish in the 2 ft starter tank by the till: proof that our flakes and pumps work." },
          { name: "Pachai & Manjal", role: "Budgies, the owner's own", photoUrl: photo(9348934, "square"), bio: "Taste-testers for every new seed mix. Pachai likes thinai; Manjal likes the millet spray." },
          { name: "Revathi", role: "Head groomer", photoUrl: photo(6816850, "square"), bio: "Twelve years of baths and trims. Calm hands, warm water, and treats in the apron pocket." },
        ],
      },
      {
        type: "offer",
        id: "sp-welcome",
        style: { span: "half" },
        eyebrow: "First order",
        heading: "₹100 off your first order above ₹999",
        text: "Use the code at checkout. Same-day delivery in Chennai if you order by 2 pm.",
        code: "FIRSTPAW",
        cta: { label: "Shop pet food", href: "/c/pet-food" },
      },
      {
        type: "text",
        id: "sp-adopt",
        style: { span: "half" },
        heading: "We don't sell animals",
        markdown:
          "No puppies, kittens, birds or fish are sold at Sellam, in the shop or online. If you're ready for a pet, **adopt**: Chennai's shelters have dogs and cats waiting, many of them hardy Indies. Show us the adoption papers for 10% off your starter kit (code **ADOPTED10**).\n\nOur food and care tips are general advice, not veterinary advice: for anything that worries you, see your vet.",
      },
      { type: "faq", id: "sp-faq", title: "Pet parents ask", items: FAQ },
      {
        type: "location",
        id: "sp-visit",
        title: "Come say hello to Raja",
        address: "AC-112, 2nd Avenue, Anna Nagar, Chennai 600040 (near the Anna Nagar Tower park)",
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "13.0868, 80.2101",
      },
    ],
    translations: {
      ta: {
        "sp-pets": {
          title: "வீட்டில் யார் காத்திருக்கிறார்கள்?",
          text: "உங்கள் செல்லத்திலிருந்து தொடங்குங்கள்: அவர்களுக்கு வேண்டியதெல்லாம் ஒரே அலமாரியில்.",
          items: [
            { label: "நாய்கள்", note: "வயது, அளவுக்கேற்ற உணவு, நடை, படுக்கை" },
            { label: "நாய்க்குட்டிகள்", note: "மென்மையான கிபிள், மெல்லும் பொருள், முதல் காலர்" },
            { label: "பூனைகள்", note: "உணவு, லிட்டர், கீறல், தூக்கம்" },
            { label: "பூனைக்குட்டிகள்", note: "குட்டி உணவு, விளையாட்டுக் குச்சி, கதகதப்பான படுக்கை" },
            { label: "பறவைகள்", note: "தானியக் கலவைகள், கூண்டுகள்" },
            { label: "மீன்கள்", note: "ஃப்ளேக்ஸ், பெல்லட்ஸ், தொட்டி, பம்ப்" },
          ],
        },
        "sp-finder": {
          title: "உங்கள் செல்லத்துக்கு என்ன தேவை?",
          text: "மூன்று தட்டல்கள்: யாருக்கு, என்ன வேண்டும், உங்கள் பட்ஜெட். பொருந்துபவற்றை மட்டும் காட்டுவோம்.",
          buttonLabel: "பொருந்துவதைக் காட்டு",
          cta: { label: "வாட்ஸ்அப்பில் கேளுங்கள்" },
          questions: [
            {
              label: "யாருக்காக?",
              options: [{ label: "நாய்க்குட்டி (1 வயதுக்குள்)" }, { label: "வளர்ந்த நாய்" }, { label: "முதிய நாய் (7+)" }, { label: "பூனைக்குட்டி" }, { label: "வளர்ந்த பூனை" }, { label: "பறவை" }, { label: "மீன்" }],
            },
            {
              label: "என்ன தேவை?",
              options: [{ label: "உணவு" }, { label: "தின்பண்டம் & மெல்லும் பொருள்" }, { label: "விளையாட்டு & நடை" }, { label: "படுக்கை / கேரியர்" }, { label: "குளியல் & பிரஷ்" }, { label: "கிண்ணம் & லிட்டர்" }, { label: "கூண்டு / தொட்டி" }],
            },
            { label: "உங்கள் பட்ஜெட்", options: [{ label: "₹300-க்குள்" }, { label: "₹300 – ₹1,000" }, { label: "₹1,000-க்கு மேல்" }] },
          ],
        },
        "sp-foodtypes": {
          title: "உலர், ஈரம், அல்லது ஃப்ரெஷ்?",
          text: "பெரும்பாலான நாய்களுக்கு நல்ல உலர் உணவே சிறந்தது; ஈர அல்லது ஃப்ரெஷ் உணவை விருந்தாக அல்லது மேலே தூவலாகக் கொடுங்கள். 15 கிலோ நாய்க்கு மூன்றும் எப்படி என்று பாருங்கள்.",
          highlightLabel: "பெரும்பாலான நாய்கள்",
          rows: FOOD_ROWS_TA,
        },
        "sp-foodbox": {
          title: "மாதாந்திர உணவுப் பெட்டி",
          text: "அதே உணவு, ஒவ்வொரு மாதமும் அதே நாளில், சென்னையில் இலவச டெலிவரி, பை பையாக வாங்குவதை விடக் குறைந்த விலையில். ஒரு வாட்ஸ்அப் மெசேஜில் தவிர்க்கலாம் அல்லது நிறுத்தலாம்.",
          plans: [
            words({
              name: "சிறிய நாய்",
              period: "/ மாதம்",
              description: "10 கிலோ வரையிலான நாய்களுக்கு: நாட்டு நாய்க்குட்டிகள், ஷிட்சு, பக், டாக்ஸ்ஹண்ட்.",
              features: ["3 கிலோ உலர் உணவு (குட்டி, வளர்ந்த அல்லது முதிய)", "500 கி பால் பிஸ்கட்", "7 பல் சுத்த மெல்லும் குச்சிகள்", "நீங்கள் சொல்லும் நாளில் இலவச டெலிவரி", "எந்த மாதமும் தவிர்க்கலாம், நிறுத்தலாம்"],
              cta: { label: "இந்தப் பெட்டியைத் தொடங்கு" },
            }),
            words({
              name: "நடுத்தர நாய்",
              period: "/ மாதம்",
              description: "10–25 கிலோ நாய்களுக்கு: நாட்டு நாய், பீகிள், கோம்பை, சிப்பிப்பாறை.",
              features: ["10 கிலோ உலர் உணவு (சிக்கன், லாம்ப் அல்லது சைவம்)", "12 ஈர உணவு பவுச்கள்", "250 கி சிக்கன் ஜெர்க்கி", "7 பல் சுத்த மெல்லும் குச்சிகள்", "நீங்கள் சொல்லும் நாளில் இலவச டெலிவரி", "எந்த மாதமும் தவிர்க்கலாம், நிறுத்தலாம்"],
              badge: "அதிகம் தேர்ந்தது",
              cta: { label: "இந்தப் பெட்டியைத் தொடங்கு" },
            }),
            words({
              name: "பெரிய நாய்",
              period: "/ மாதம்",
              description: "25 கிலோவுக்கு மேல்: லாப்ரடார், ஷெப்பர்ட், ராஜபாளையம்.",
              features: ["20 கிலோ பெரிய இன உலர் உணவு", "1 கிலோ பால் பிஸ்கட்", "பெரிய பல் சுத்தக் குச்சிகள் இரண்டு பேக்", "வாசல் வரை தூக்கி வருவோம்", "எந்த மாதமும் தவிர்க்கலாம், நிறுத்தலாம்"],
              cta: { label: "இந்தப் பெட்டியைத் தொடங்கு" },
            }),
            words({
              name: "பூனை",
              period: "/ மாதம்",
              description: "ஒரு பூனை அல்லது பூனைக்குட்டிக்கு.",
              features: ["1.2 கிலோ உலர் உணவு (குட்டி, வளர்ந்த அல்லது வீட்டுப் பூனை)", "12 ஈர உணவு பவுச்கள்", "4 நக்கும் தின்பண்டங்கள்", "5 கிலோ கட்டியாகும் லிட்டர்", "நீங்கள் சொல்லும் நாளில் இலவச டெலிவரி"],
              cta: { label: "இந்தப் பெட்டியைத் தொடங்கு" },
            }),
          ],
        },
        "sp-starter": {
          title: "நாய்க்குட்டியை வீட்டுக்குக் கொண்டு வருகிறீர்களா?",
          text: "புதிய குடும்பங்களுக்கு நாங்கள் கட்டித் தரும் முதல் வாரக் கிட்: ஓரம் உள்ள படுக்கை, காலர், லீஷ், பின்னால் வேண்டிய ஹார்னஸ், கயிறு விளையாட்டுப் பொருள், மென்மையான ஷாம்பு, குளியல் பிரஷ், டவல், நாய்க்குட்டி உணவு. சேர்க்க ஒரு புள்ளியைத் தட்டுங்கள்.",
          alt: "லீஷ், காலர், ஹார்னஸ், விளையாட்டுப் பொருட்கள், ஷாம்பு, பிரஷ், டவல், உணவுக் கிண்ணங்கள் சூழ வட்டப் படுக்கையில் தூங்கும் நாய்க்குட்டி",
        },
        "sp-groomroom": {
          eyebrow: "குரூமிங் அறை · கடையின் பின்புறம்",
          heading: "குளியல் நாள், குளியலறை வெள்ளம் இல்லாமல்",
          text: "வெதுவெதுப்பான நீரில் குளியல், முறையான ப்ளோ-டிரை, காது, நகம், கோடை டிரிம்: பயந்த நாட்டு நாய் முதல் தண்ணீரை வெறுக்கும் பெர்ஷியன் பூனை வரை எல்லோரையும் கையாண்ட இரண்டு குரூமர்கள். மயக்க மருந்து இல்லை, தேவைப்பட்டால் இடைவேளை, முடிந்ததும் வாட்ஸ்அப்பில் படம்.",
          cta: { label: "முன்பதிவு செய்" },
          cta2: { label: "வவுச்சர் வாங்கு" },
        },
        "sp-bathday": {
          title: "முன்பும் பின்பும்",
          text: "கோட்டை இழுங்கள்: ஷவரில் ஒரு யார்க்ஷயர் டெரியர், ஒரு மணி நேரம் கழித்து உலர்ந்து, பிரஷ் செய்து, டிரிம் செய்யப்பட்டு.",
          beforeLabel: "குளியல்",
          afterLabel: "ஒரு மணி நேரம் கழித்து",
        },
        "sp-tails": {
          title: "அக்கம்பக்கத்தின் மகிழ்ச்சியான வால்கள்",
          items: [
            { quote: "புரூனோவுக்குப் பன்னிரண்டு வயது, காலையில் உடம்பு விறைப்பாக இருக்கும். செல்லத்தில் முதிய நாய் உணவுக்கும் ஃபோம் படுக்கைக்கும் மாற்றினார்கள்; இப்போது மீண்டும் மொட்டை மாடிப் படிகளில் ஏறுகிறான்.", name: "புரூனோவின் குடும்பம்", role: "அண்ணா நகர் மேற்கு" },
            { quote: "லட்டுவை ஒரு காப்பகத்திலிருந்து ஒன்றுமில்லாமல் தத்தெடுத்தோம். பத்து நிமிடத்தில் ஸ்டார்ட்டர் கிட் கட்டி, வாரவாரியாக எவ்வளவு உணவு கொடுக்க வேண்டும் என்று சொன்னார்கள்.", name: "லட்டுவின் குடும்பம்", role: "முகப்பேர்" },
            { quote: "மூன்று பூனைகள், ஒரு ஃபிளாட். பூனை உணவுப் பெட்டி ஒவ்வொரு 5-ஆம் தேதியும் லிட்டருடன் நான்காம் மாடி வரை வருகிறது. இந்த ஆண்டு ஒருமுறை கூடத் தீர்ந்து போகவில்லை.", name: "மிட்டாய், பிஸ்கட், பெப்பரின் மனிதர்", role: "கீழ்ப்பாக்கம்" },
          ],
        },
        "sp-regulars": {
          title: "கடையில் நீங்கள் சந்திப்பவர்கள்",
          text: "இங்கே விற்பனைக்கு விலங்குகள் இல்லை, ஆனால் எங்களுடன் வாழும் சிலர் உண்டு.",
          members: [
            { name: "ராஜா", role: "கடை நாய், 2019-இல் தத்தெடுத்தது", bio: "2019 மழையில் 2-வது அவென்யூவிலிருந்து உள்ளே வந்து தங்கிவிட்ட நாட்டு நாய். எல்லோரையும் வரவேற்கும், ஒவ்வொரு டெலிவரியையும் சோதிக்கும்." },
            { name: "தங்கம் & கோ.", role: "கவுண்டர் தொட்டி", bio: "பில் போடும் இடத்தருகே 2 அடி ஸ்டார்ட்டர் தொட்டியில் நான்கு தங்க மீன்கள்: எங்கள் ஃப்ளேக்ஸும் பம்ப்களும் வேலை செய்வதற்கான சான்று." },
            { name: "பச்சை & மஞ்சள்", role: "உரிமையாளரின் சொந்த பட்ஜிகள்", bio: "ஒவ்வொரு புதிய தானியக் கலவையையும் முதலில் சுவைப்பவர்கள். பச்சைக்குத் தினை பிடிக்கும்; மஞ்சளுக்கு கம்பு கதிர்." },
            { name: "ரேவதி", role: "தலைமை குரூமர்", bio: "பன்னிரண்டு ஆண்டுகள் குளியலும் டிரிம்மும். நிதானமான கைகள், வெதுவெதுப்பான நீர், ஏப்ரன் பையில் தின்பண்டங்கள்." },
          ],
        },
        "sp-welcome": {
          eyebrow: "முதல் ஆர்டர்",
          heading: "₹999-க்கு மேலான முதல் ஆர்டருக்கு ₹100 தள்ளுபடி",
          text: "செக்அவுட்டில் குறியீட்டைப் பயன்படுத்துங்கள். மதியம் 2 மணிக்குள் ஆர்டர் செய்தால் சென்னையில் அதே நாள் டெலிவரி.",
          cta: { label: "செல்லப்பிராணி உணவு" },
        },
        "sp-adopt": {
          heading: "நாங்கள் விலங்குகளை விற்பதில்லை",
          markdown:
            "செல்லத்தில் நாய்க்குட்டி, பூனைக்குட்டி, பறவை, மீன் எதுவும் விற்கப்படுவதில்லை, கடையிலும் ஆன்லைனிலும். செல்லப்பிராணி வளர்க்கத் தயாரா? **தத்தெடுங்கள்**: சென்னைக் காப்பகங்களில் நாய்களும் பூனைகளும் காத்திருக்கின்றன, அவற்றில் பல உறுதியான நாட்டு நாய்கள். தத்தெடுப்பு ஆவணத்தைக் காட்டினால் ஸ்டார்ட்டர் கிட்டுக்கு 10% தள்ளுபடி (குறியீடு **ADOPTED10**).\n\nஉணவு, பராமரிப்பு பற்றிய எங்கள் குறிப்புகள் பொதுவான ஆலோசனை, கால்நடை மருத்துவ ஆலோசனை அல்ல: கவலை தரும் எதற்கும் உங்கள் கால்நடை மருத்துவரைப் பாருங்கள்.",
        },
        "sp-faq": { title: "செல்லப்பிராணி வளர்ப்போர் கேட்பவை", items: FAQ_TA },
        "sp-visit": {
          title: "ராஜாவுக்கு ஒரு ஹலோ சொல்ல வாருங்கள்",
          address: "AC-112, 2-வது அவென்யூ, அண்ணா நகர், சென்னை 600040 (அண்ணா நகர் டவர் பூங்கா அருகில்)",
          hours: [
            { label: "திங்கள் – சனி", value: "காலை 9:30 – இரவு 9:00" },
            { label: "ஞாயிறு", value: "காலை 10:00 – மதியம் 2:00" },
            { label: "குரூமிங் அறை", value: "முன்பதிவில், செவ்வாய் – ஞாயிறு" },
          ],
        },
      },
    },
  }),
  pages: [
    {
      slug: "feeding-guide",
      title: "Feeding guide by life stage",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "How much to feed, by age and weight" },
        {
          type: "paragraph",
          markdown:
            "These are **daily amounts of our dry food**, split into meals. They're a starting point: an active Indie that runs on the beach needs more than a flat dog that sleeps all afternoon. Weigh your dog once a month and adjust by 10%. You should feel the ribs under a thin layer, not see them.\n\n| Dog's adult weight | Puppy 3–6 months | Puppy 6–12 months | Adult | Senior (7+) |\n|---|---|---|---|---|\n| 5 kg | 110 g | 90 g | 85 g | 75 g |\n| 10 kg | 190 g | 160 g | 145 g | 125 g |\n| 15 kg | 260 g | 220 g | 230 g | 200 g |\n| 25 kg | 380 g | 330 g | 330 g | 290 g |\n| 40 kg | 520 g | 470 g | 480 g | 420 g |\n\n**Meals:** puppies 3–4 a day up to 6 months, then 2. Adults 2. Large, deep-chested dogs (Labradors, Shepherds, Rajapalayams) should rest an hour after eating.",
        },
        { type: "image", url: photo(7086030, "tile"), alt: "Puppy eating from a steel bowl" },
        { type: "heading", level: 2, text: "Our own breeds" },
        {
          type: "paragraph",
          markdown:
            "Tamil Nadu's native dogs are lean, athletic hunters and guards. **Chippiparai** and **Rajapalayam** sighthounds carry little fat and burn a lot when they run: a high-protein adult food (24% or more), split into two meals, keeps them in shape without getting heavy. The muscular **Kombai** does well on the same food in slightly bigger portions. Rajapalayams can have sensitive skin: if a white coat turns pink and itchy, ask your vet about trying the lamb & rice. And the **Indie** (our street dog) is the toughest of them all: any good adult food suits them.",
        },
        { type: "heading", level: 2, text: "Cats" },
        {
          type: "paragraph",
          markdown:
            "| Cat | Dry food a day | Or mixed |\n|---|---|---|\n| Kitten 2–6 months | 50–70 g in 3–4 meals | 40 g dry + 1 pouch |\n| Kitten 6–12 months | 55–75 g | 45 g dry + 1 pouch |\n| Adult 4 kg | 55 g | 40 g dry + 1 pouch |\n| Adult 6 kg | 75 g | 55 g dry + 1 pouch |\n\nCats drink little, so a wet pouch a day and a wide water bowl away from the litter help their kidneys.",
        },
        { type: "heading", level: 2, text: "Never feed" },
        {
          type: "paragraph",
          markdown:
            "Chocolate, grapes and raisins, onion and garlic (also in leftover sambar and biryani), xylitol (sugar-free gum and sweets), cooked bones, and milk for adult cats. If your pet eats any of these, call your vet straight away.\n\n*This guide is general advice from a pet shop, not veterinary advice. For a puppy that isn't growing, a pet that is overweight or unwell, or a special diet, ask a registered veterinarian.*",
        },
        { type: "button", label: "Ask us on WhatsApp", href: waLink("Hello Sellam, how much should I feed my pet? Age: … Weight: …"), style: "primary" },
      ],
    },
    {
      slug: "grooming",
      title: "Grooming room: booking",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "How to book" },
        {
          type: "paragraph",
          markdown:
            "1. Buy a **grooming session voucher** for your pet's size and package (online or at the counter).\n2. Send us the order number on WhatsApp with two dates and times that suit you.\n3. We confirm the slot the same day. Tuesday to Sunday, 10 am to 6 pm.\n\nBring the **vaccination card** (rabies and DHPPi for dogs, tricat for cats, up to date). Walk the dog before you come.",
        },
        { type: "image", url: photo(6131161, "tile"), alt: "Yorkshire Terrier being showered at a grooming table" },
        { type: "heading", level: 2, text: "Prices" },
        {
          type: "paragraph",
          markdown:
            "| Pet | Bath & dry | Full groom & trim |\n|---|---|---|\n| Small dog (up to 10 kg) | ₹599 | ₹999 |\n| Medium dog (10–25 kg) | ₹799 | ₹1,299 |\n| Large dog (25 kg+) | ₹999 | ₹1,599 |\n| Cat | ₹699 | ₹1,099 |\n\n**Bath & dry:** warm-water bath with oatmeal shampoo, blow-dry, brush-out, ear cleaning, nail trim. **Full groom & trim:** the same plus a breed or summer trim, paw and hygiene trims. Badly matted coats may need a shave-down, which we discuss with you first. Prices include 18% GST.",
        },
        { type: "heading", level: 2, text: "How we groom" },
        {
          type: "paragraph",
          markdown:
            "We never sedate. Nervous pets get breaks, treats and a quiet corner; if one is too stressed we stop and book a short second visit at no extra cost. We'll tell you if we see ticks, skin problems or lumps, but we don't treat them: for those, please see your vet.",
        },
        { type: "button", label: "Book on WhatsApp", href: waLink("Hello Sellam, I'd like to book grooming. Pet: … Size: … Dates: …"), style: "primary" },
      ],
    },
    {
      slug: "our-promise",
      title: "No animals for sale, returns and vet advice",
      blocks: () => [
        { type: "heading", level: 2, text: "We don't sell live animals" },
        {
          type: "paragraph",
          markdown:
            "Sellam sells food, care products and gear, and grooms. We don't sell puppies, kittens, birds, fish or any other animal, in the shop or online, and we don't take orders for them. Please adopt: Chennai's shelters and rescue groups have dogs and cats waiting. Families who adopt get 10% off their starter kit (code **ADOPTED10**, up to ₹500) when they show the papers.",
        },
        { type: "heading", level: 2, text: "Returns" },
        {
          type: "paragraph",
          markdown:
            "- **Unopened food, treats and litter:** returned within 7 days of delivery, refund or exchange.\n- **Opened food:** only if spoiled, damaged or past the date; send a photo within 48 hours.\n- **Fresh chilled meals and loose biscuits:** not returnable once delivered.\n- **Accessories:** unused, with tags, within 7 days.\n- **Grooming vouchers:** valid 3 months; unused ones refunded within 30 days.",
        },
        { type: "heading", level: 2, text: "Not veterinary advice" },
        {
          type: "paragraph",
          markdown:
            "Our staff know food and grooming, not medicine. Anything we suggest, in the shop, on WhatsApp or on this site, is general advice. We don't sell prescription medicines, vaccines or spot-on treatments. For vomiting, diarrhoea for more than a day, not eating, limping, wounds, heavy ticks or anything that worries you, see a registered veterinarian.",
        },
      ],
    },
    {
      slug: "about",
      title: "About us",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Sellam, Anna Nagar, since 2014" },
        {
          type: "paragraph",
          markdown:
            "Sellam (செல்லம்) is what Tamil families call the one they spoil: darling. We opened on 2nd Avenue in 2014 as a pet food counter for the neighbourhood's dogs and grew into a full pet shop with a grooming room at the back.\n\nWe stock food we'd feed our own animals, explain the labels, carry the big bags up to your door and keep the shop free of animals for sale. Raja, the shop dog, will check your bag on the way out.",
        },
        { type: "image", url: photo(30630826, "tile"), alt: "Indian Pariah dog portrait" },
        { type: "paragraph", markdown: "Open Monday to Saturday 9:30 am – 9:00 pm, Sunday 10:00 am – 2:00 pm. Call or WhatsApp **+91 98765 00061**." },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). The animals shown are photographers' models, not animals for sale (we don't sell animals) and not our customers' pets; the products shown are stand-ins for the generic products named.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Dogs", type: "collection", ref: "for-dogs" },
      { label: "Cats", type: "collection", ref: "for-cats" },
      { label: "Pet food", type: "category", ref: "pet-food" },
      { label: "Birds & fish", type: "category", ref: "birds-and-fish" },
      { label: "Grooming", type: "page", ref: "grooming" },
      { label: "Feeding guide", type: "page", ref: "feeding-guide" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Feeding guide", type: "page", ref: "feeding-guide" },
          { label: "Book grooming", type: "page", ref: "grooming" },
          { label: "No animals for sale, returns", type: "page", ref: "our-promise" },
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "Puppy & kitten starter kit", type: "collection", ref: "starter-kit" },
          { label: "Monthly refills", type: "collection", ref: "monthly-refills" },
          { label: "Price drops", type: "collection", ref: "price-drops" },
          { label: "About us", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
