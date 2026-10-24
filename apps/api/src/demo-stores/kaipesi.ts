import type { DemoProduct, DemoStore } from "./types";

/**
 * Store #13 of the series: Kaipesi Mobile Accessories, Ritchie Street, Chennai (kaipesi.localhost:3003). An
 * accessories counter in the Ritchie Street electronics market off Anna Salai (Mount Road), on the online store app
 * (EC) with the `mobile_accessories` trade and the "carbon-spec" look (acid lime on matte carbon, monospaced spec
 * headings). Kaipesi (கைப்பேசி) is Tamil for mobile phone. Cases and screen guards by phone model, chargers by wattage,
 * cables by connector and length, earphones and TWS earbuds, power banks by capacity, smartwatches and straps, car and
 * bike mounts, selfie sticks and tripods, memory cards and pen drives, and the counter's own services (screen guard
 * fitting, screen and battery replacement). No phones (IMEI handsets are the electronics trade). Names are generic, no
 * makers' brands; model families are described by screen size ("iPhone-style 6.1-inch", "Galaxy A-series 6.6-inch")
 * only to say what a case or guard fits. Address, phone, GSTIN and the BIS R-numbers are demo placeholders.
 *
 * GST, from CGST notification 9/2025-Central Tax (Rate) of 17 Sept 2025, in force from 22 Sept 2025 (the GST Council's
 * rate rationalisation; 12% and 28% folded into 5% and 18%). Everything here stays at 18% (Schedule III of 9/2025, the
 * residual 18% schedule, as under 1/2017 where these were 18% too):
 * - chargers / adapters 8504 40 30 (static converters, battery chargers), car chargers too;
 * - cables with connectors 8544 42 99;
 * - earphones, TWS earbuds 8518 30 20 (headphones and earphones 8518 30);
 * - power banks 8507 60 00 (lithium-ion accumulators; some rulings put power banks in 8504 40, also 18%);
 * - smartwatches and fitness bands 8517 62 90 (machines for the reception / transmission of data);
 * - memory cards and pen drives 8523 51 00 (solid-state non-volatile storage);
 * - plastic / silicone / TPU cases, car and bike holders 3926 90 99 (other articles of plastics);
 * - tempered-glass guards 7007 19 00 (toughened safety glass), hydrogel / film guards 3919 90 90;
 * - selfie sticks and tripods 9620 00 00 (monopods, bipods, tripods); ring lights 9405 49 00 (other electric lamps);
 * - card readers 8471 80 00; watch straps of silicone 9113 90 90;
 * - repairs: maintenance and repair of telecommunication equipment, SAC 9987 (the shop's labour), 18%.
 * Uncertain, check before invoicing for real: vegan-leather (PU) back cases (3926 90 99 here; 4202 32 / 4202 39 if
 * treated as a holder of the "pouch" kind, also 18%), hydrogel film (3919 vs 3920), the exact SAC sub-code for phone
 * repair (998713 is used by the repair demo shop; 998716 may fit telecom equipment better) and the 8517 62 line for
 * smartwatches (some classify fitness bands without SIM under 9102 / 8517 62 90; both 18%).
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500013";
const WHATSAPP = "919876500013";
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

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({
  variants: [{ price: rs(price), mrp: rs(mrp), stock }],
});

const CASES = "Cases & covers";
const GUARDS = "Screen guards";
const CHARGE = "Chargers & cables";
const AUDIO = "Earphones & neckbands";
const POWER = "Power banks";
const WATCH = "Smartwatches";
const MOUNTS = "Car & bike mounts";
const TRIPODS = "Selfie sticks & tripods";
const STORAGE = "Memory cards & pen drives";
const REPAIRS = "Repairs & fitting";

// Phone model families (the "Phone model" option of cases and guards): screen sizes, not makers' model names.
const IP61 = "iPhone-style 6.1-inch";
const IP67 = "iPhone-style 6.7-inch";
const GS62 = "Galaxy S-series 6.2-inch";
const GA66 = "Galaxy A-series 6.6-inch";
const RN67 = "Redmi Note-style 6.67-inch";
const MODELS = [IP61, IP67, GS62, GA66, RN67];
const MODELS_TEXT = "6.1-inch and 6.7-inch iPhone-style, 6.2-inch Galaxy S-series, 6.6-inch Galaxy A-series and 6.67-inch Redmi Note-style phones";

// Finder tags: phone family, screen size, need.
const FITS_ALL = ["fits-iphone", "fits-galaxy", "fits-redmi", "fits-other", "size-61", "size-67"];
const FITS_MODELS = ["fits-iphone", "fits-galaxy", "fits-redmi", "size-61", "size-67"];

const BIS = (n: string) => `IS 13252 (Part 1), BIS R-${n} (demo placeholder)`;

const CASE_NOTE =
  "\n\nPick your phone's family and size above; not sure? Send a photo of the back of your phone on WhatsApp and we'll tell you which one fits. Cases and guards that don't fit are exchanged within 7 days if unused.";
const ELECTRONICS_NOTE =
  "\n\n**7-day replacement** if it's faulty out of the box, then the warranty shown below at our counter (bring the bill or the order number). BIS-registered where the law requires it.";

const PRODUCTS: DemoProduct[] = [
  // ---- cases & covers (3926 90 99: 18%)
  {
    name: "Clear shockproof case with air-cushion corners",
    category: CASES,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-CLR",
    photo: 16195406,
    tags: ["deal", ...FITS_MODELS, "protect", "bestseller", "under-499"],
    description: `Crystal-clear TPU that shows your phone's colour, with thicker air-cushion corners that take the knock when it drops on the floor tiles. Raised 1 mm lip over the screen and 1.5 mm over the camera. Anti-yellowing coating (it still yellows slowly in the sun; that's TPU).${CASE_NOTE}`,
    attributes: { "Compatible models": MODELS_TEXT, Material: "TPU, anti-yellowing coat", "Drop rating": "1.2 m on corners", Thickness: "1.5 mm (2.2 mm corners)", Warranty: "No warranty (exchange if it doesn't fit)" },
    ...one("Phone model", MODELS.map((m) => [m, 249, 599, 40] as [string, number, number, number])),
  },
  {
    name: "Liquid silicone case with microfibre lining",
    category: CASES,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-SIL",
    photo: 9558788,
    tags: [...FITS_MODELS, "protect", "bestseller"],
    description: `Soft-touch liquid silicone outside, microfibre inside so the back glass doesn't scratch. Closed bottom on the 6.1 and 6.7-inch sizes keeps sand out of the port. Wipe it clean with a damp cloth.${CASE_NOTE}`,
    attributes: { "Compatible models": MODELS_TEXT, Material: "Liquid silicone, microfibre lining", Thickness: "1.2 mm", Warranty: "No warranty (exchange if it doesn't fit)" },
    ...two("Phone model", MODELS.map((m) => [m, 349, 899] as [string, number, number]), "Colour", ["Midnight black", "Navy", "Mint", "Lavender", "Sand", "Red"], 12),
  },
  {
    name: "Matte hybrid case with camera slider",
    category: CASES,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-HYB",
    photo: 4574587,
    tags: [...FITS_MODELS, "protect"],
    description: `Frosted hard back over a soft TPU frame, with a sliding cover for the camera lenses: it closes over the glass when the phone goes in a pocket with keys. Fingerprint-proof matte finish.${CASE_NOTE}`,
    attributes: { "Compatible models": MODELS_TEXT, Material: "Polycarbonate back, TPU frame", "Drop rating": "1.5 m", Warranty: "No warranty (exchange if it doesn't fit)" },
    ...two("Phone model", MODELS.map((m) => [m, 449, 1199] as [string, number, number]), "Colour", ["Black", "Sage", "Cobalt"], 10),
  },
  {
    name: "Rugged armour case with ring stand",
    category: CASES,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-ARM",
    photo: 19784109,
    tags: ["fits-iphone", "fits-galaxy", "fits-redmi", "size-61", "size-67", "protect", "ride"],
    description: `Two-layer armour for delivery riders and site work: a shock-absorbing inner shell, a hard outer shell and a metal ring on the back that turns into a stand (landscape for videos) and holds on magnetic car mounts.${CASE_NOTE}`,
    attributes: { "Compatible models": "6.1 and 6.7-inch iPhone-style, 6.6-inch Galaxy A-series, 6.67-inch Redmi Note-style", Material: "TPU + polycarbonate, metal ring", "Drop rating": "2 m", "Works with": "Magnetic car mounts (the ring is steel)", Warranty: "No warranty (exchange if it doesn't fit)" },
    ...two("Phone model", [IP61, IP67, GA66, RN67].map((m) => [m, 399, 999] as [string, number, number]), "Colour", ["Black", "Blue"], 10),
  },
  {
    name: "Slim matte hard case",
    category: CASES,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-SLM",
    photo: 32912373,
    tags: [...FITS_MODELS, "protect", "under-499"],
    description: `A 0.8 mm hard shell for people who hate bulky cases: adds almost nothing to the phone, keeps scratches off the back and the edges. Not for drops on concrete.${CASE_NOTE}`,
    attributes: { "Compatible models": MODELS_TEXT, Material: "Polycarbonate, soft-touch coat", Thickness: "0.8 mm", Warranty: "No warranty (exchange if it doesn't fit)" },
    ...two("Phone model", MODELS.map((m) => [m, 279, 699] as [string, number, number]), "Colour", ["Purple", "Cobalt", "White"], 10),
  },
  {
    name: "Vegan-leather back case",
    category: CASES,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-LTH",
    photo: 4206892,
    tags: ["fits-iphone", "fits-galaxy", "size-61", "size-67", "protect", "gift"],
    description: `PU (vegan) leather over a firm shell, with metal buttons and a suede-feel lining. Darkens and softens with use like real leather, without the price. A good gift that still fits in a shirt pocket.${CASE_NOTE}`,
    attributes: { "Compatible models": "6.1 and 6.7-inch iPhone-style, 6.2-inch Galaxy S-series, 6.6-inch Galaxy A-series", Material: "PU leather, polycarbonate shell, aluminium buttons", Warranty: "No warranty (exchange if it doesn't fit)" },
    ...two("Phone model", [IP61, IP67, GS62, GA66].map((m) => [m, 599, 1499] as [string, number, number]), "Colour", ["Sand", "Tan", "Black"], 8),
  },
  {
    name: "Wood-finish back case",
    category: CASES,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-WOD",
    photo: 5531123,
    tags: ["fits-iphone", "fits-galaxy", "size-61", "size-67", "protect", "gift"],
    description: `A walnut-finish veneer back set in a black TPU bumper: every piece has its own grain. Light, grippy and warm in the hand.${CASE_NOTE}`,
    attributes: { "Compatible models": "6.1 and 6.7-inch iPhone-style, 6.6-inch Galaxy A-series", Material: "Wood veneer on polycarbonate, TPU bumper", Warranty: "No warranty (exchange if it doesn't fit)" },
    ...one("Phone model", [IP61, IP67, GA66].map((m) => [m, 499, 1199, 15] as [string, number, number, number])),
  },
  {
    name: "Printed soft case, floral prints",
    category: CASES,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-PRT",
    photo: 374117,
    tags: [...FITS_MODELS, "protect", "under-499", "gift"],
    description: `Soft TPU with a glossy print that doesn't peel: three of our counter's best-selling designs. Thin, light, and easy to swap when you're bored of it.${CASE_NOTE}`,
    attributes: { "Compatible models": MODELS_TEXT, Material: "TPU, UV print", Warranty: "No warranty (exchange if it doesn't fit)" },
    ...two("Phone model", MODELS.map((m) => [m, 299, 699] as [string, number, number]), "Design", ["Blue blossom", "Pink garden", "Tropical"], 8),
  },

  // ---- screen guards (tempered glass 7007 19 00, film 3919 90 90: 18%)
  {
    name: "9H edge-to-edge tempered glass",
    category: GUARDS,
    hsn: "70071900",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-TG9",
    photo: 2825347,
    tags: ["deal", ...FITS_MODELS, "protect", "bestseller", "under-499"],
    description: `Full-cover 9H tempered glass with black edges and an oleophobic coat, 0.33 mm. Fitted free at our counter, bubble-free, in two minutes; online orders come with a fitting frame, wet and dry wipes and a dust sticker.${CASE_NOTE}`,
    attributes: { "Compatible models": MODELS_TEXT, Hardness: "9H", Thickness: "0.33 mm", Coverage: "Edge to edge, case-friendly", "Free fitting": "Yes, at the counter", Warranty: "No warranty (glass is a sacrifice: it breaks so the screen doesn't)" },
    ...one("Phone model", MODELS.map((m) => [m, 199, 699, 60] as [string, number, number, number])),
  },
  {
    name: "Privacy tempered glass, anti-spy",
    category: GUARDS,
    hsn: "70071900",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-PRV",
    photo: 13570135,
    tags: [...FITS_MODELS, "protect", "bestseller"],
    description: `The screen looks dark from the side (about 30° each way), clear straight on: for bus rides, office lifts and bank OTPs. 9H, 0.4 mm. Takes a little brightness; turn it up one step.${CASE_NOTE}`,
    attributes: { "Compatible models": MODELS_TEXT, Hardness: "9H", Thickness: "0.4 mm", "Viewing angle": "About 30° either side", "Free fitting": "Yes, at the counter", Warranty: "No warranty" },
    ...one("Phone model", MODELS.map((m) => [m, 349, 999, 40] as [string, number, number, number])),
  },
  {
    name: "Matte anti-glare glass for gaming",
    category: GUARDS,
    hsn: "70071900",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-MAT",
    photo: 6370361,
    tags: [...FITS_MODELS, "protect"],
    description: `Frosted tempered glass: no fingerprints, no glare under the tube light, smooth for long gaming sessions. Text looks slightly softer than on clear glass.${CASE_NOTE}`,
    attributes: { "Compatible models": MODELS_TEXT, Hardness: "9H", Finish: "Matte, anti-glare", "Free fitting": "Yes, at the counter", Warranty: "No warranty" },
    ...one("Phone model", MODELS.map((m) => [m, 299, 799, 30] as [string, number, number, number])),
  },
  {
    name: "Hydrogel screen film, cut to your model",
    category: GUARDS,
    hsn: "39199090",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-HYD",
    photo: 8533741,
    tags: [...FITS_ALL, "protect", "under-499"],
    description: `For curved screens and models no glass fits: our cutting machine cuts a self-healing hydrogel film to your exact model (front or back) while you wait, from a library of 5,000+ phones. Online, type the model at checkout or on WhatsApp.`,
    attributes: { "Compatible models": "Any phone (cut to model)", Material: "TPU hydrogel, self-healing", Thickness: "0.15 mm", "Free fitting": "Yes", Warranty: "No warranty" },
    ...one("Side", [
      ["Front", 249, 499, 200],
      ["Back", 199, 399, 200],
      ["Front + back", 399, 799, 200],
    ]),
  },

  // ---- chargers (8504 40 30) and cables (8544 42 99): 18%
  {
    name: "20 W USB-C fast charger",
    category: CHARGE,
    hsn: "85044030",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-C20",
    photo: 35921904,
    tags: ["deal", ...FITS_ALL, "charge", "bestseller"],
    description: `A single USB-C Power Delivery port, 20 W: takes an iPhone-style phone from 0 to 50% in about 30 minutes, and fast-charges most Android phones on PD. Compact, with a flat Indian 2-pin plug.${ELECTRONICS_NOTE}`,
    attributes: { Wattage: "20 W", Ports: "1 × USB-C", Standards: "USB PD 3.0, PPS", Input: "100–240 V AC", "BIS registration": BIS("41000201"), Warranty: "6 months", "In the box": "Charger only (cable sold separately)" },
    ...single(549, 1299, 60),
  },
  {
    name: "33 W dual-port charger, USB-C + USB-A",
    category: CHARGE,
    hsn: "85044030",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-C33",
    photo: 36012993,
    tags: [...FITS_ALL, "charge", "bestseller"],
    description: `33 W from the USB-C port alone, or shared between USB-C and USB-A (about 20 W + 12 W) when you charge a phone and earbuds together. 0–50% in about 25 minutes on most Android phones.${ELECTRONICS_NOTE}`,
    attributes: { Wattage: "33 W", Ports: "1 × USB-C, 1 × USB-A", Standards: "USB PD 3.0, PPS, QC 3.0", "BIS registration": BIS("41000233"), Warranty: "12 months", "In the box": "Charger, 1 m USB-C to USB-C cable" },
    ...single(799, 1799, 45),
  },
  {
    name: "65 W GaN charger, 3 ports",
    category: CHARGE,
    hsn: "85044030",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-C65",
    photo: 16886332,
    tags: [...FITS_ALL, "charge", "gift"],
    description: `Gallium-nitride (GaN) charger the size of a 20 W brick: 65 W from the top USB-C port charges a laptop, two USB-C and one USB-A share it for a phone, a tablet and a watch. One charger for the whole bag.${ELECTRONICS_NOTE}`,
    attributes: { Wattage: "65 W (shared across ports)", Ports: "2 × USB-C, 1 × USB-A", Standards: "USB PD 3.0, PPS, QC 4+", "Charges laptops": "Yes, USB-C laptops up to 65 W", "BIS registration": BIS("41000265"), Warranty: "18 months", "In the box": "Charger, 1.5 m 100 W USB-C cable" },
    ...single(1899, 3999, 25),
  },
  {
    name: "15 W wireless charging pad",
    category: CHARGE,
    hsn: "85044030",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-WLS",
    photo: 5083411,
    tags: ["fits-iphone", "fits-galaxy", "size-61", "size-67", "charge"],
    description: `Put the phone down, it charges: Qi wireless up to 15 W (7.5 W on iPhone-style phones), through cases up to 4 mm. A soft blue light shows it's charging; it switches off at night.${ELECTRONICS_NOTE}`,
    attributes: { Wattage: "15 W max (needs an 18 W+ adapter)", Standards: "Qi", "Works through": "Cases up to 4 mm (no metal rings or cards)", "BIS registration": BIS("41000315"), Warranty: "6 months", "In the box": "Pad, 1 m USB-C cable" },
    ...single(999, 2499, 20),
  },
  {
    name: "Dual-port car charger",
    category: CHARGE,
    hsn: "85044030",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-CAR",
    photo: 12671356,
    tags: [...FITS_ALL, "charge", "ride"],
    description: `Fits the 12 V / 24 V socket of cars, vans and lorries: fast-charges the phone on the dashboard mount while the second port feeds a passenger's phone. A metal body that doesn't melt in a hot car.${ELECTRONICS_NOTE}`,
    attributes: { Ports: "1 × USB-C, 1 × USB-A", Input: "12–24 V DC", Standards: "USB PD, QC 3.0", Warranty: "6 months" },
    ...one("Wattage", [
      ["18 W", 349, 799, 30],
      ["38 W", 549, 1199, 25],
    ]),
  },
  {
    name: "Braided USB-C to USB-C cable, 60 W",
    category: CHARGE,
    hsn: "85444299",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-CCB",
    photo: 1643753,
    tags: ["deal", ...FITS_ALL, "charge", "bestseller"],
    description: `Nylon-braided cable with aluminium ends, tested to 20,000 bends: carries 60 W for phones, tablets and small laptops and USB 2.0 data. Fits newer iPhone-style phones with USB-C too.${ELECTRONICS_NOTE}`,
    attributes: { Connector: "USB-C to USB-C", "Power rating": "60 W (20 V / 3 A)", Data: "USB 2.0, 480 Mbps", Warranty: "6 months" },
    ...one("Length", [
      ["1 m", 299, 699, 80],
      ["2 m", 399, 899, 50],
    ]),
  },
  {
    name: "USB-C to 8-pin cable for older iPhone-style phones",
    category: CHARGE,
    hsn: "85444299",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-C8P",
    photo: 4195332,
    tags: ["fits-iphone", "size-61", "size-67", "charge"],
    description: `For iPhone-style phones with the older 8-pin port (before the switch to USB-C): fast-charges at 20 W from a USB-C PD charger. Strain relief that doesn't split at the neck.${ELECTRONICS_NOTE}`,
    attributes: { Connector: "USB-C to 8-pin (Lightning-style)", "Power rating": "20 W fast charging", Warranty: "6 months" },
    ...one("Length", [
      ["1 m", 399, 899, 40],
      ["2 m", 499, 1099, 25],
    ]),
  },
  {
    name: "USB-A to USB-C cable, 3 A",
    category: CHARGE,
    hsn: "85444299",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-CAC",
    photo: 6081231,
    tags: ["fits-galaxy", "fits-redmi", "fits-other", "size-61", "size-67", "charge", "under-499"],
    description: `For the old USB-A brick or a car's USB port: 3 A charging and data for any USB-C phone. Flat, tangle-free red cable that's easy to find in a bag.${ELECTRONICS_NOTE}`,
    attributes: { Connector: "USB-A to USB-C", "Power rating": "3 A (15 W; up to 18 W QC)", Warranty: "6 months" },
    ...one("Length", [
      ["1 m", 199, 449, 60],
      ["2 m", 249, 549, 40],
    ]),
  },
  {
    name: "Micro USB cable, 2.4 A",
    category: CHARGE,
    hsn: "85444299",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-MCU",
    photo: 36100789,
    tags: ["fits-other", "size-61", "size-67", "charge", "under-499"],
    description: `For older and budget Android phones, Bluetooth speakers, neckbands and torches that still have a micro USB port. 2.4 A charging and data.${ELECTRONICS_NOTE}`,
    attributes: { Connector: "USB-A to micro USB", "Power rating": "2.4 A", Warranty: "3 months" },
    ...one("Length", [
      ["1 m", 149, 349, 60],
      ["1.5 m", 179, 399, 40],
    ]),
  },
  {
    name: "3-in-1 charging cable, USB-C / 8-pin / micro USB",
    category: CHARGE,
    hsn: "85444299",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-C31",
    photo: 34338614,
    tags: [...FITS_ALL, "charge", "under-499"],
    description: `One cable, three tips: charges any phone in the family (or three at once from a 3 A port). The one to keep in the car, the office drawer or the shop counter.${ELECTRONICS_NOTE}`,
    attributes: { Connector: "USB-A to USB-C + 8-pin + micro USB", "Power rating": "3.5 A total (charging only on 8-pin and micro)", Length: "1.2 m", Warranty: "3 months" },
    ...single(349, 799, 50),
  },

  // ---- earphones & earbuds (8518 30 20: 18%)
  {
    name: "TWS earbuds, 40 h playback with ENC mic",
    category: AUDIO,
    hsn: "85183020",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-TWS",
    photo: 3585797,
    tags: ["deal", ...FITS_ALL, "listen", "bestseller", "gift"],
    description: `Bluetooth 5.3 earbuds with 10 mm drivers, 8 hours per charge and 40 hours with the case, a USB-C case and quad-mic ENC that cuts traffic noise on calls. Touch controls, IPX4 sweat-resistant.${ELECTRONICS_NOTE}`,
    attributes: { Bluetooth: "5.3", Playback: "8 h (40 h with case)", Mic: "Quad mic with ENC", "Water resistance": "IPX4", Charging: "USB-C, 10 min = 2 h", Warranty: "12 months" },
    ...one("Colour", [
      ["Black", 1299, 3999, 40],
      ["White", 1299, 3999, 30],
    ]),
  },
  {
    name: "ANC earbuds with low-latency game mode",
    category: AUDIO,
    hsn: "85183020",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-ANC",
    photo: 33797659,
    tags: ["deal", ...FITS_ALL, "listen", "gift"],
    description: `Active noise cancelling up to 32 dB for bus and train rides, a transparency mode for the road, and a 50 ms game mode so footsteps match the screen. 7 h per charge (30 h with case).${ELECTRONICS_NOTE}`,
    attributes: { Bluetooth: "5.3", "Noise cancelling": "Hybrid ANC, up to 32 dB", Latency: "50 ms (game mode)", Playback: "7 h (30 h with case)", "Water resistance": "IPX5", Warranty: "12 months" },
    ...single(2499, 5999, 20),
  },
  {
    name: "Open-stem TWS earbuds",
    category: AUDIO,
    hsn: "85183020",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-STM",
    photo: 29128040,
    tags: [...FITS_ALL, "listen", "under-999"],
    description: `Half-in-ear stems that sit lightly without silicone tips: comfortable all day and you still hear the doorbell. 6 h per charge, 24 h with the case.${ELECTRONICS_NOTE}`,
    attributes: { Bluetooth: "5.3", Fit: "Half in-ear (no tips)", Playback: "6 h (24 h with case)", Warranty: "6 months" },
    ...single(999, 2999, 30),
  },
  {
    name: "Mini earbuds with battery-display case",
    category: AUDIO,
    hsn: "85183020",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-MIN",
    photo: 8858287,
    tags: [...FITS_ALL, "listen", "under-999"],
    description: `Small round buds for small ears, and a case with a digital battery read-out so you know when to charge it. 5 h per charge, 25 h with the case.${ELECTRONICS_NOTE}`,
    attributes: { Bluetooth: "5.3", Playback: "5 h (25 h with case)", Case: "LED battery display, USB-C", Warranty: "6 months" },
    ...single(899, 2499, 30),
  },
  {
    name: "Wired earphones with mic, 3.5 mm",
    category: AUDIO,
    hsn: "85183020",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-W35",
    photo: 11773870,
    tags: ["fits-other", "fits-galaxy", "fits-redmi", "size-61", "size-67", "listen", "under-499"],
    description: `Classic wired earphones with a one-button mic, in four colours: no charging, no pairing, no lag. For phones with a 3.5 mm jack (most budget Androids), laptops and school tablets.${ELECTRONICS_NOTE}`,
    attributes: { Connector: "3.5 mm jack", Mic: "Inline, one button", "Cable length": "1.2 m", Warranty: "3 months" },
    ...one("Colour", [
      ["Yellow", 199, 499, 40],
      ["Pink", 199, 499, 40],
      ["Orange", 199, 499, 40],
      ["White", 199, 499, 60],
    ]),
  },
  {
    name: "USB-C wired earphones with DAC",
    category: AUDIO,
    hsn: "85183020",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-WUC",
    photo: 8704040,
    tags: [...FITS_ALL, "listen", "under-499"],
    description: `For phones without a headphone jack: a built-in DAC chip, so they work on every USB-C phone (including newer iPhone-style phones), with volume buttons and a mic.${ELECTRONICS_NOTE}`,
    attributes: { Connector: "USB-C (digital, built-in DAC)", Mic: "Inline, 3 buttons", "Cable length": "1.2 m", Warranty: "6 months" },
    ...single(349, 799, 40),
  },
  {
    name: "Sports earphones with flat cable, IPX4",
    category: AUDIO,
    hsn: "85183020",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-SPT",
    photo: 7016908,
    tags: ["fits-other", "fits-galaxy", "fits-redmi", "size-61", "size-67", "listen", "under-499"],
    description: `Sweat-proof wired earphones with a flat, tangle-free cable and a shirt clip, for the morning walk on the beach road and the gym. 3.5 mm jack.${ELECTRONICS_NOTE}`,
    attributes: { Connector: "3.5 mm jack", "Water resistance": "IPX4", "Cable length": "1.2 m, flat", Warranty: "3 months" },
    ...single(299, 699, 30),
  },

  // ---- power banks (8507 60 00: 18%)
  {
    name: "Slim 10000 mAh power bank, 22.5 W",
    category: POWER,
    hsn: "85076000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-PB1",
    photo: 37475662,
    tags: ["deal", ...FITS_ALL, "charge", "bestseller"],
    description: `Pocket-thin lithium-polymer power bank: two full charges for most phones, 22.5 W fast charging out of USB-C and in through USB-C (fills up in about 3.5 hours). Allowed in cabin baggage (37 Wh), never in checked bags.${ELECTRONICS_NOTE}`,
    attributes: { Capacity: "10000 mAh (37 Wh)", Output: "22.5 W max, USB-C PD + USB-A QC", Input: "USB-C 18 W", Cells: "Lithium-polymer", "BIS registration": BIS("41000510"), Warranty: "6 months", Weight: "210 g" },
    ...one("Colour", [
      ["Black", 999, 2499, 30],
      ["White", 999, 2499, 20],
    ]),
  },
  {
    name: "Fast-charge power bank, 3 outputs",
    category: POWER,
    hsn: "85076000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-PB2",
    photo: 38354917,
    tags: [...FITS_ALL, "charge"],
    description: `Three outputs (USB-C and two USB-A) for the family trip or a long day of deliveries, with a digital percentage display. The 20000 mAh charges most phones four times. Both sizes are allowed in cabin baggage.${ELECTRONICS_NOTE}`,
    attributes: { Output: "22.5 W max, 3 ports", Input: "USB-C 18 W", Display: "Digital %", "BIS registration": BIS("41000520"), Warranty: "6 months" },
    ...one("Capacity", [
      ["10000 mAh (37 Wh)", 1099, 2799, 25],
      ["20000 mAh (74 Wh)", 1499, 3499, 25],
    ]),
  },
  {
    name: "Magnetic wireless power bank, 10000 mAh",
    category: POWER,
    hsn: "85076000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-PBM",
    photo: 14706040,
    tags: ["fits-iphone", "fits-galaxy", "size-61", "size-67", "charge", "gift"],
    description: `Snaps onto the back of magnetic-ring phones (or any phone with our magnetic ring sticker) and charges wirelessly at 15 W, or by cable at 20 W. A fold-out stand for videos.${ELECTRONICS_NOTE}`,
    attributes: { Capacity: "10000 mAh (37 Wh)", Output: "15 W wireless, 20 W USB-C", "BIS registration": BIS("41000530"), Warranty: "6 months", "In the box": "Power bank, magnetic ring sticker, USB-C cable" },
    ...single(1799, 3999, 15),
  },
  {
    name: "Solar power bank with torch, 20000 mAh",
    category: POWER,
    hsn: "85076000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-PBS",
    photo: 518530,
    tags: [...FITS_ALL, "charge", "ride"],
    description: `Rugged, splash-proof power bank with a solar panel and an LED torch, for fishermen, farm sheds and power cuts. The sun tops it up slowly (a day of sun ≈ one phone charge); charge it fully from the wall first.${ELECTRONICS_NOTE}`,
    attributes: { Capacity: "20000 mAh (74 Wh)", Output: "2 × USB-A, 2.1 A", Extras: "Solar panel, LED torch, compass", "Water resistance": "IPX4", "BIS registration": BIS("41000540"), Warranty: "6 months" },
    ...single(1299, 2999, 15),
  },

  // ---- smartwatches (8517 62 90) and straps (9113 90 90): 18%
  {
    name: "1.96-inch AMOLED calling smartwatch",
    category: WATCH,
    hsn: "85176290",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-SW1",
    photo: 11700618,
    tags: ["deal", ...FITS_ALL, "wear", "bestseller", "gift"],
    description: `Take calls on the wrist over Bluetooth (mic and speaker built in), with a bright always-on AMOLED screen, heart rate, SpO2, sleep and 100+ sport modes. 5 days a charge (2 with heavy calling). Works with Android and iPhone-style phones through the free app.${ELECTRONICS_NOTE}`,
    attributes: { Display: "1.96-inch AMOLED, always-on", Calling: "Bluetooth calling, dial pad, 10 favourites", Sensors: "Heart rate, SpO2, sleep", Battery: "Up to 5 days", "Water resistance": "IP68", Strap: "22 mm, quick release", Warranty: "12 months" },
    ...one("Colour", [
      ["Black", 2499, 7999, 25],
      ["Silver", 2499, 7999, 15],
      ["Pink", 2499, 7999, 15],
    ]),
  },
  {
    name: "1.85-inch smartwatch with SpO2",
    category: WATCH,
    hsn: "85176290",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-SW2",
    photo: 13007642,
    tags: ["deal", ...FITS_ALL, "wear", "under-1999"],
    description: `A big, simple screen for steps, heart rate, SpO2 and notifications from WhatsApp and calls (no calling). 7 days a charge on the magnetic charger.${ELECTRONICS_NOTE}`,
    attributes: { Display: "1.85-inch LCD", Sensors: "Heart rate, SpO2, sleep, steps", Battery: "Up to 7 days", "Water resistance": "IP67", Strap: "22 mm", Warranty: "12 months" },
    ...single(1499, 4999, 25),
  },
  {
    name: "Fitness band with 1.47-inch screen",
    category: WATCH,
    hsn: "85176290",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-FB1",
    photo: 18662969,
    tags: [...FITS_ALL, "wear", "under-999"],
    description: `A slim band for steps, sleep and heart rate, light enough to forget it's there. 12 days a charge, swim-proof (5 ATM).${ELECTRONICS_NOTE}`,
    attributes: { Display: "1.47-inch colour", Sensors: "Heart rate, sleep, steps", Battery: "Up to 12 days", "Water resistance": "5 ATM", Warranty: "6 months" },
    ...single(999, 2999, 30),
  },
  {
    name: "Silicone sport strap, 22 mm",
    category: WATCH,
    hsn: "91139090",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-STR",
    photo: 14691503,
    tags: [...FITS_ALL, "wear", "under-499"],
    description: `A soft silicone strap with quick-release pins (no tools) for any smartwatch with 22 mm lugs, including our 1.96-inch and 1.85-inch watches. Ask us to swap it at the counter.`,
    attributes: { Width: "22 mm, quick-release pins", Material: "Silicone", "Fits wrists": "14–21 cm", Warranty: "No warranty" },
    ...one("Colour", [
      ["Black", 199, 499, 40],
      ["Navy", 199, 499, 30],
      ["Sage", 199, 499, 25],
      ["Sand", 199, 499, 25],
      ["Red", 199, 499, 20],
    ]),
  },

  // ---- car & bike mounts (3926 90 99 plastic; 8302 50 00 metal brackets: 18%)
  {
    name: "Dashboard & windscreen suction car mount",
    category: MOUNTS,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-MCD",
    photo: 1412214,
    tags: [...FITS_ALL, "ride"],
    description: `A sticky-gel suction cup that holds on dashboards and windscreens in Chennai heat, a telescopic arm and one-touch clamps for phones from 4.7 to 6.9 inches. For cab drivers on navigation all day.`,
    attributes: { "Fits phones": "4.7–6.9 inch, 60–90 mm wide", Mount: "Gel suction cup, dashboard or windscreen", Rotation: "360°", Warranty: "3 months" },
    ...single(399, 999, 30),
  },
  {
    name: "Magnetic AC-vent car mount",
    category: MOUNTS,
    hsn: "83025000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-MCV",
    photo: 13536013,
    tags: [...FITS_ALL, "ride", "under-499"],
    description: `A small aluminium mount that clips to the AC vent; the phone sticks on with a thin metal plate (two included, one goes inside the case). N52 magnets hold through speed breakers.`,
    attributes: { Mount: "AC vent clip", Magnets: "N52, 6 pieces", "In the box": "Mount, 2 metal plates", Warranty: "3 months" },
    ...single(299, 799, 40),
  },
  {
    name: "Bike & scooter handlebar mount with quick lock",
    category: MOUNTS,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-MBK",
    photo: 35037256,
    tags: ["deal", ...FITS_ALL, "ride", "bestseller", "under-499"],
    description: `For delivery partners and daily riders: four corner grips and a quick-lock arm that won't let go on potholes, for handlebars 22–32 mm. Phone in or out with one hand.`,
    attributes: { "Fits phones": "4.7–7 inch", "Fits handlebars": "22–32 mm", Lock: "Quick-lock with 4 corner grips", Warranty: "3 months" },
    ...single(449, 999, 40),
  },
  {
    name: "Aluminium motorbike mirror mount, anti-vibration",
    category: MOUNTS,
    hsn: "83025000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-MMR",
    photo: 4513011,
    tags: [...FITS_ALL, "ride"],
    description: `CNC aluminium mount that bolts to the mirror stem, with a vibration damper that protects the phone's camera from engine shake (motorbike vibration can ruin a camera's stabiliser).`,
    attributes: { Mount: "Mirror stem, M8/M10 adapters", Damper: "Anti-vibration", "Fits phones": "4.7–6.8 inch", Warranty: "6 months" },
    ...single(899, 1999, 15),
  },
  {
    name: "Silicone cycle phone holder",
    category: MOUNTS,
    hsn: "39269099",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-MCY",
    photo: 12956046,
    tags: [...FITS_ALL, "ride", "under-499"],
    description: `A stretchy silicone holder that wraps round a cycle's handlebar and the phone's four corners in ten seconds, no tools. For the Marina morning ride.`,
    attributes: { "Fits phones": "4.5–6.8 inch", Material: "Silicone", Warranty: "No warranty" },
    ...single(199, 499, 40),
  },

  // ---- selfie sticks & tripods (9620 00 00), ring light (9405 49 00): 18%
  {
    name: "Bluetooth selfie stick with tripod legs",
    category: TRIPODS,
    hsn: "96200000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-SSK",
    photo: 4172460,
    tags: ["deal", ...FITS_ALL, "shoot", "gift"],
    description: `Extends to 100 cm, folds to 20 cm, opens into a tripod for group photos, with a detachable Bluetooth remote. The family-trip one.`,
    attributes: { Length: "20–100 cm", Remote: "Bluetooth, detachable, CR1632 cell", "Fits phones": "4.7–6.8 inch", Warranty: "3 months" },
    ...single(599, 1499, 25),
  },
  {
    name: "Flexible octopus tripod with phone clamp",
    category: TRIPODS,
    hsn: "96200000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-OCT",
    photo: 4792390,
    tags: [...FITS_ALL, "shoot", "under-499"],
    description: `Bendable legs that wrap round a railing, a tree branch or a chair back, a phone clamp and a 1/4-inch screw for small cameras. For cooking videos and reels.`,
    attributes: { Height: "26 cm", Load: "1 kg", "Fits phones": "5.5–9 cm wide", Warranty: "No warranty" },
    ...single(349, 799, 30),
  },
  {
    name: "Tall phone tripod with Bluetooth remote",
    category: TRIPODS,
    hsn: "96200000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-TTP",
    photo: 6266973,
    tags: [...FITS_ALL, "shoot"],
    description: `An aluminium tripod that goes from table height to standing height, with a pan-tilt head, a phone clamp and a remote: for online classes, video calls and shop catalogues.`,
    attributes: { Height: "35–152 cm", Head: "3-way pan-tilt", Remote: "Bluetooth", Load: "1.5 kg", Warranty: "3 months" },
    ...one("Height", [
      ["127 cm", 699, 1599, 20],
      ["152 cm", 899, 1999, 20],
    ]),
  },
  {
    name: "LED ring light with stand and phone holder",
    category: TRIPODS,
    hsn: "94054900",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-RNG",
    photo: 6347629,
    tags: [...FITS_ALL, "shoot", "gift"],
    description: `A USB-powered LED ring light with three colour temperatures and ten brightness steps, on a 2 m stand with a phone holder in the middle: for reels, makeup tutorials and product photos.`,
    attributes: { Light: "3 colour modes (3200–5600 K), 10 brightness steps", Power: "USB (5 V)", Stand: "Up to 2 m", Warranty: "6 months" },
    ...one("Size", [
      ["10-inch", 999, 1999, 15],
      ["12-inch", 1299, 2499, 10],
    ]),
  },
  {
    name: "Mini tripod with clip-on zoom lens",
    category: TRIPODS,
    hsn: "96200000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-ZML",
    photo: 16263134,
    tags: [...FITS_ALL, "shoot", "gift"],
    description: `A clip-on 12× telephoto lens and a pocket tripod to keep it steady: for birds at Vedanthangal, temple gopurams and the stage at school functions. Works best in daylight.`,
    attributes: { Lens: "12× telephoto, clip-on", Tripod: "Mini, 1/4-inch screw", Warranty: "No warranty" },
    ...single(699, 1499, 15),
  },

  // ---- memory cards & pen drives (8523 51 00), card reader (8471 80 00): 18%
  {
    name: "microSD card, U3 V30, with adapter",
    category: STORAGE,
    hsn: "85235100",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-MSD",
    photo: 30662603,
    tags: ["deal", ...FITS_ALL, "store", "bestseller"],
    description: `UHS-I U3 / V30 microSD for phones, dashcams and action cameras: records 4K video without dropping frames, reads up to 100 MB/s. SD adapter included. We test every card on the counter before handing it over.${ELECTRONICS_NOTE}`,
    attributes: { Class: "UHS-I U3, V30, A1", Speed: "Read up to 100 MB/s", "In the box": "Card, SD adapter", Warranty: "5 years" },
    ...one("Capacity", [
      ["32 GB", 349, 799, 40],
      ["64 GB", 549, 1199, 40],
      ["128 GB", 899, 1999, 30],
      ["256 GB", 1699, 3699, 15],
    ]),
  },
  {
    name: "Metal USB 3.2 pen drive",
    category: STORAGE,
    hsn: "85235100",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-PDM",
    photo: 4792747,
    tags: ["fits-other", "store"],
    description: `A small all-metal pen drive for the laptop and the TV: USB 3.2, up to 120 MB/s read, with a key-ring loop. Plays films on most smart TVs straight from the USB port.${ELECTRONICS_NOTE}`,
    attributes: { Interface: "USB 3.2 Gen 1 (USB-A)", Speed: "Read up to 120 MB/s", Body: "Zinc alloy, key-ring loop", Warranty: "5 years" },
    ...one("Capacity", [
      ["32 GB", 349, 699, 40],
      ["64 GB", 499, 999, 40],
      ["128 GB", 849, 1799, 25],
    ]),
  },
  {
    name: "Dual OTG pen drive, USB-C + USB-A",
    category: STORAGE,
    hsn: "85235100",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-OTG",
    photo: 10336136,
    tags: [...FITS_ALL, "store", "bestseller"],
    description: `USB-C on one end for the phone, USB-A on the other for the laptop: move photos off a full phone in a minute and free up space. Works on iPhone-style phones with USB-C (Files app) and on Android.${ELECTRONICS_NOTE}`,
    attributes: { Interface: "USB-C and USB-A, USB 3.2", Speed: "Read up to 150 MB/s", Warranty: "5 years" },
    ...one("Capacity", [
      ["64 GB", 649, 1399, 30],
      ["128 GB", 999, 2199, 25],
    ]),
  },
  {
    name: "Swivel pen drive, USB 2.0",
    category: STORAGE,
    hsn: "85235100",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-PDS",
    photo: 7054728,
    tags: ["fits-other", "store", "under-499"],
    description: `The everyday pen drive for school projects, printouts at the Xerox shop and songs in the car stereo. Swivel cap that can't get lost.${ELECTRONICS_NOTE}`,
    attributes: { Interface: "USB 2.0 (USB-A)", Warranty: "3 years" },
    ...one("Capacity", [
      ["16 GB", 199, 399, 50],
      ["32 GB", 249, 499, 50],
      ["64 GB", 399, 799, 30],
    ]),
  },
  {
    name: "USB-C card reader and OTG adapter",
    category: STORAGE,
    hsn: "84718000",
    gstRate: 18,
    unit: "pcs",
    sku: "KP-RDR",
    photo: 4195403,
    tags: [...FITS_ALL, "store", "under-499"],
    description: `Reads SD and microSD cards on a phone or laptop through USB-C, and has a USB-A socket for a pen drive or a keyboard (OTG). Copy wedding photos from the camera card to the phone on the spot.${ELECTRONICS_NOTE}`,
    attributes: { Slots: "SD, microSD, USB-A (OTG)", Interface: "USB-C, USB 3.0", Warranty: "6 months" },
    ...single(399, 899, 30),
  },

  // ---- repairs & fitting at the counter (services, SAC 9987: 18%)
  {
    name: "Screen replacement booking",
    category: REPAIRS,
    hsn: "998713",
    gstRate: 18,
    unit: "job",
    sku: "KP-RSC",
    photo: 6755053,
    tags: [...FITS_ALL, "repair"],
    description: `Book a slot at the counter and we replace a cracked or dead screen while you wait (about 45 minutes for most models). The price here is the **labour and booking**; the display is quoted for your model when we confirm (compatible LCD, compatible OLED or original pulled), and billed on the same GST bill. 90-day warranty on the screen against touch and display faults (not on new cracks).\n\nBring the phone with its passcode, and back up first. We confirm the slot and the screen price on WhatsApp within working hours.`,
    attributes: { "Time taken": "About 45 minutes (most models)", Warranty: "90 days on the screen (not new cracks or water)", Includes: "Labour, booking, a free tempered glass", "Pay for the part": "At the counter, after the quote" },
    ...one("Screen type", [
      ["Compatible LCD", 499, 499, 99],
      ["Compatible OLED", 699, 699, 99],
      ["Original pulled (when available)", 899, 899, 99],
    ]),
  },
  {
    name: "Battery replacement booking",
    category: REPAIRS,
    hsn: "998713",
    gstRate: 18,
    unit: "job",
    sku: "KP-RBT",
    photo: 11715243,
    tags: [...FITS_ALL, "repair"],
    description: `When the phone dies by evening or shows "service" under battery health: we fit a new battery in about 30 minutes, reseal the back and calibrate it. The price is the labour; the battery is quoted for your model (usually ₹900–₹2,500) and billed together. 6-month warranty on the battery.`,
    attributes: { "Time taken": "About 30 minutes", Warranty: "6 months on the battery", "Old battery": "Sent for recycling" },
    ...single(399, 399, 99),
  },
  {
    name: "Charging port cleaning & check",
    category: REPAIRS,
    hsn: "998713",
    gstRate: 18,
    unit: "service",
    sku: "KP-RPC",
    photo: 4705610,
    tags: [...FITS_ALL, "repair", "under-499"],
    description: `Half the "my phone won't charge" phones just have pocket lint packed into the port. We clean it under a microscope, test the port, the cable and the charger, and tell you honestly if it needs a port replacement. Free if we can't fix it.`,
    attributes: { "Time taken": "10–15 minutes", Includes: "Port cleaning, charging test, cable and adapter check" },
    ...single(149, 149, 99),
  },
  {
    name: "Screen guard fitting for a guard bought elsewhere",
    category: REPAIRS,
    hsn: "998713",
    gstRate: 18,
    unit: "service",
    sku: "KP-RFT",
    photo: 40012872,
    tags: [...FITS_ALL, "repair", "protect", "under-499"],
    description: `Bought a guard online and scared to stick it on? Bring it with the phone: we clean the screen in a dust-free box and fit it bubble-free. Free for guards bought from us.`,
    attributes: { "Time taken": "5 minutes", Note: "Free for guards bought at Kaipesi" },
    ...single(99, 99, 99),
  },
];

const PHOTOS: DemoStore["photos"] = {
  16195406: { by: "Erik Mclean", alt: "Phone in a slim case lying on a lichen-covered rock" },
  9558788: { by: "MART PRODUCTION", alt: "Hand holding a phone in a lavender silicone case" },
  4574587: { by: "Imthiyaz Syed", alt: "Close-up of a red case round a triple camera" },
  19784109: { by: "Fernando Arcos", alt: "Black rugged armour case with a ring stand" },
  32912373: { by: "Büşra Karabal", alt: "Purple, blue and white slim cases stacked on black" },
  4206892: { by: "Dastan Khdir", alt: "Beige leather-finish case on wooden slats" },
  5531123: { by: "仕旻 康", alt: "Wood-finish back case on a grey stone surface" },
  374117: { by: "Burst", alt: "Row of printed soft phone cases" },
  2825347: { by: "Athena Sandrini", alt: "Phone with a glossy screen guard on a white surface" },
  13570135: { by: "Luis Quintero", alt: "Hand holding a phone with a dark privacy glass" },
  6370361: { by: "Luis Quintero", alt: "Hand holding a phone with a matte screen" },
  8533741: { by: "Hanna Pad", alt: "Phone with a blank white screen on a white surface" },
  35921904: { by: "Arturo A", alt: "White USB-C wall charger with its cable on wood" },
  36012993: { by: "Arturo A", alt: "White dual-port charger and a USB cable on a grey table" },
  16886332: { by: "Саша Алалыкин", alt: "White chargers plugged into a power strip" },
  5083411: { by: "cottonbro studio", alt: "Phone lying on a white wireless charging pad" },
  12671356: { by: "Abdulvahap Demir", alt: "Charging cable plugged into a car's console port" },
  1643753: { by: "Diana", alt: "Coiled braided charging cable in rainbow colours" },
  4195332: { by: "Kaboompics.com", alt: "8-pin charging cable next to a phone on a wooden table" },
  6081231: { by: "Jess Bailey Designs", alt: "Red flat USB cable on white" },
  36100789: { by: "Arturo A", alt: "White USB cable plug on a wooden table" },
  34338614: { by: "Andrey Matveev", alt: "3-in-1 charging cable beside a white power bank" },
  3585797: { by: "Atahan Demir", alt: "Black wireless earbuds in their open charging case" },
  33797659: { by: "Andrey Matveev", alt: "Black wireless earbuds on a yellow background" },
  29128040: { by: "Swamy K", alt: "Black open-stem earbuds on white" },
  8858287: { by: "SpotwizardLee", alt: "Small round earbuds in a case on grey wood" },
  11773870: { by: "Towfiqu barbhuiya", alt: "Yellow, pink and orange wired earphones on light blue" },
  8704040: { by: "Smika", alt: "White wired earphones on a beige table" },
  7016908: { by: "Jason Deines", alt: "Sports earphones and blue dumbbells on concrete" },
  37475662: { by: "Eleonora Vokueva", alt: "Black power bank charging a phone with an orange cable" },
  38354917: { by: "RORRY_ Official", alt: "Black power bank charging two devices on a white sheet" },
  14706040: { by: "Towfiqu barbhuiya", alt: "Phone charging from a power bank on a wooden table" },
  518530: { by: "Lukas Blazek", alt: "Rugged solar power bank charging by cable" },
  11700618: { by: "pratik prasad", alt: "Black square smartwatch on a grey background" },
  13007642: { by: "pratik prasad", alt: "Smartwatch with a white strap" },
  18662969: { by: "indra projects", alt: "Black fitness band showing the time" },
  14691503: { by: "Douglas Mendes", alt: "Smartwatch with a navy silicone strap on a notebook" },
  1412214: { by: "Malte Luk", alt: "Phone in a car mount on the dashboard showing a map" },
  13536013: { by: "Abdulvahap Demir", alt: "Round magnetic mount clipped to a car's air vent" },
  35037256: { by: "H", alt: "Red and black phone holder on a handlebar" },
  4513011: { by: "Ivan Oboleninov", alt: "Phone mounted on a motorbike handlebar beside the speedometer" },
  12956046: { by: "Atlantic Ambience", alt: "Cyclist using a phone in a silicone holder on the handlebar" },
  4172460: { by: "Gilmer Diaz Estela", alt: "Phone on an extended selfie stick against white" },
  4792390: { by: "Anete Lusina", alt: "Hand setting a phone on a flexible octopus tripod" },
  6266973: { by: "Antoni Shkraba", alt: "Phone on a tall tripod filming in a room" },
  6347629: { by: "Liza Summer", alt: "Phone in a ring light on a stand" },
  16263134: { by: "Umang & Meet", alt: "Phone on a mini tripod with a clip-on zoom lens" },
  30662603: { by: "Patrick", alt: "Close-up of a memory card's gold contacts" },
  4792747: { by: "Anete Lusina", alt: "Hand holding a small metal pen drive" },
  10336136: { by: "Get Lost Mike", alt: "Dual USB-C and USB-A pen drive on a cutting mat" },
  7054728: { by: "Kindel Media", alt: "Blue swivel pen drive on a lime-green background" },
  4195403: { by: "Kaboompics.com", alt: "Memory card in a card reader beside a laptop" },
  6755053: { by: "Tima Miroshnichenko", alt: "Technician opening a phone on a repair mat" },
  11715243: { by: "Miguel Galaz", alt: "Gloved hands working on a small part on a blue repair mat" },
  4705610: { by: "cottonbro studio", alt: "Hands holding an opened device during repair" },
  40012872: { by: "Bulat843", alt: "Hands pressing a screen into place on a workbench" },
  // categories, home and pages
  9558940: { by: "MART PRODUCTION", alt: "Hand holding a phone in a sand-coloured case" },
  374140: { by: "Burst", alt: "Printed and glitter phone cases spread out" },
  4526431: { by: "I'm Zion", alt: "Compact charger with a phone charging on a notebook" },
  30707908: { by: "Anzor Dukaev", alt: "Square smartwatch on deep blue fabric" },
  30954662: { by: "William Hadley", alt: "Phone with a map in a windscreen car mount" },
  1629326: { by: "DSD", alt: "Phone on a tripod photographing a bamboo forest" },
  6755056: { by: "Tima Miroshnichenko", alt: "Technician at a microscope repairing a phone" },
  13570128: { by: "Luis Quintero", alt: "Open phone box with the cable inside, next to a phone" },
  9853463: { by: "Ron Lach", alt: "Hands unpacking a parcel" },
};

const HOURS = [
  { label: "Mon – Sat", value: "10:00 am – 9:00 pm" },
  { label: "Sunday", value: "11:00 am – 8:00 pm" },
];

const FAQ = [
  {
    q: "Will this case or guard fit my phone?",
    a: "Find your phone's exact model in **Settings → About phone**, then pick the family and screen size on the product (for example *Galaxy A-series 6.6-inch*). Still not sure? Send a photo of the back of the phone on [WhatsApp](https://wa.me/919876500013) and we'll tell you which one fits. An unused case or guard that doesn't fit is exchanged within 7 days.",
  },
  {
    q: "Are your chargers and power banks safe?",
    a: "Every charger, adapter and power bank we sell is registered with the Bureau of Indian Standards (BIS) under the Compulsory Registration Scheme: the R-number is printed on the product and listed on the product page, and you can check it on the BIS website. We don't stock no-name chargers without one. They are our own generic range, not phone makers' originals, at a fraction of the price.",
  },
  {
    q: "What if something stops working?",
    a: "**Within 7 days of delivery:** bring it to the counter or send a photo or video on WhatsApp; if it's faulty we replace it (or refund if we're out of stock). **After that:** the warranty on the product page (3 to 18 months; up to 5 years on memory cards) covers faults at our counter: keep the bill or the order number. Warranty doesn't cover drops, cut cables, water or burnt ports.",
  },
  {
    q: "Do you fit screen guards?",
    a: "Yes: free at the counter for every guard you buy from us, in a dust-free box, bubble-free, in about two minutes. Online orders come with a fitting frame and wipes. For a guard bought elsewhere, fitting is ₹99.",
  },
  {
    q: "Can I carry a power bank on a flight?",
    a: "Only in **cabin baggage, never in checked bags**. Up to 100 Wh needs no permission: our 10000 mAh (37 Wh) and 20000 mAh (74 Wh) power banks are both fine. Keep it switched off and don't charge from it during take-off and landing.",
  },
  {
    q: "How fast is delivery, and can I pay cash?",
    a: "Chennai (600xxx): same day if you order by 4 pm, otherwise next day. Rest of Tamil Nadu: 2–4 days. Rest of India: 3–6 days. Cash on delivery up to ₹5,000 in Tamil Nadu; UPI and cards everywhere.",
  },
  {
    q: "How long does a screen replacement take, and is my data safe?",
    a: "About 45 minutes for most models, while you wait at the counter. Your photos and chats stay on the phone (the screen doesn't hold data), but back up first and bring the passcode so we can test the touch and the sensors after fitting.",
  },
];

const FAQ_TA = [
  {
    q: "இந்தக் கேஸ் அல்லது கார்டு என் போனுக்குப் பொருந்துமா?",
    a: "**Settings → About phone**-இல் உங்கள் போனின் சரியான மாடலைப் பாருங்கள்; பின் பொருளில் குடும்பத்தையும் திரை அளவையும் தேர்ந்தெடுங்கள் (உதா. *Galaxy A-series 6.6-inch*). இன்னும் சந்தேகமா? போனின் பின்புறப் படத்தை [வாட்ஸ்அப்பில்](https://wa.me/919876500013) அனுப்புங்கள்; எது பொருந்தும் என்று சொல்வோம். பொருந்தாத, பயன்படுத்தாத கேஸ் அல்லது கார்டு 7 நாளுக்குள் மாற்றித் தரப்படும்.",
  },
  {
    q: "உங்கள் சார்ஜர்களும் பவர் பேங்க்குகளும் பாதுகாப்பானவையா?",
    a: "நாங்கள் விற்கும் ஒவ்வொரு சார்ஜர், அடாப்டர், பவர் பேங்க்கும் கட்டாயப் பதிவுத் திட்டத்தின் கீழ் இந்தியத் தர நிர்ணய அமைவனத்தில் (BIS) பதிவு செய்யப்பட்டவை: R-எண் பொருளிலும் பொருள் பக்கத்திலும் இருக்கும்; BIS இணையதளத்தில் சரிபார்க்கலாம். அது இல்லாத பெயரில்லாச் சார்ஜர்களை நாங்கள் வைப்பதில்லை. இவை எங்கள் சொந்த ஜெனரிக் ரேஞ்ச், போன் தயாரிப்பாளர்களின் ஒரிஜினல் அல்ல, விலை மிகக் குறைவு.",
  },
  {
    q: "ஏதாவது வேலை செய்யாமல் போனால்?",
    a: "**டெலிவரியிலிருந்து 7 நாளுக்குள்:** கடைக்குக் கொண்டு வாருங்கள் அல்லது வாட்ஸ்அப்பில் படம்/வீடியோ அனுப்புங்கள்; பழுது என்றால் மாற்றித் தருவோம் (ஸ்டாக் இல்லையெனில் பணம் திருப்பித் தருவோம்). **அதன் பிறகு:** பொருள் பக்கத்தில் உள்ள வாரண்டி (3 முதல் 18 மாதம்; மெமரி கார்டுக்கு 5 ஆண்டு வரை) எங்கள் கடையில் செல்லும்: பில் அல்லது ஆர்டர் எண்ணை வைத்திருங்கள். கீழே விழுந்தது, அறுந்த கேபிள், தண்ணீர், எரிந்த போர்ட் ஆகியவற்றுக்கு வாரண்டி இல்லை.",
  },
  {
    q: "ஸ்கிரீன் கார்டு ஒட்டித் தருவீர்களா?",
    a: "ஆம்: எங்களிடம் வாங்கும் ஒவ்வொரு கார்டையும் கடையில் இலவசமாக, தூசி இல்லாத பெட்டியில், குமிழ் இல்லாமல், சுமார் இரண்டு நிமிடத்தில் ஒட்டித் தருவோம். ஆன்லைன் ஆர்டருடன் ஒட்டும் ஃப்ரேமும் துடைப்பான்களும் வரும். வெளியில் வாங்கிய கார்டை ஒட்ட ₹99.",
  },
  {
    q: "விமானத்தில் பவர் பேங்க் கொண்டு செல்லலாமா?",
    a: "**கேபின் பையில் மட்டும், செக்-இன் பையில் ஒருபோதும் இல்லை.** 100 Wh வரை அனுமதி தேவையில்லை: எங்கள் 10000 mAh (37 Wh), 20000 mAh (74 Wh) பவர் பேங்க்குகள் இரண்டும் சரி. ஆஃப் செய்து வையுங்கள்; டேக்-ஆஃப், லேண்டிங்கின் போது அதிலிருந்து சார்ஜ் செய்ய வேண்டாம்.",
  },
  {
    q: "டெலிவரி எவ்வளவு வேகம், பணமாகச் செலுத்தலாமா?",
    a: "சென்னை (600xxx): மாலை 4 மணிக்குள் ஆர்டர் செய்தால் அதே நாள், இல்லையெனில் மறுநாள். தமிழ்நாட்டின் மற்ற இடங்கள்: 2–4 நாள். இந்தியாவின் மற்ற இடங்கள்: 3–6 நாள். தமிழ்நாட்டில் ₹5,000 வரை டெலிவரியில் பணம்; UPI, கார்டு எல்லா இடத்திலும்.",
  },
  {
    q: "ஸ்கிரீன் மாற்ற எவ்வளவு நேரம், என் டேட்டா பாதுகாப்பா?",
    a: "பெரும்பாலான மாடல்களுக்கு சுமார் 45 நிமிடம், நீங்கள் கடையில் காத்திருக்கும்போதே. உங்கள் படங்களும் சாட்களும் போனிலேயே இருக்கும் (ஸ்கிரீனில் டேட்டா இல்லை); ஆனாலும் முதலில் பேக்அப் எடுங்கள், பொருத்திய பின் டச், சென்சார்களைச் சோதிக்க பாஸ்கோடையும் கொண்டு வாருங்கள்.",
  },
];

/** Chargers compared on the home page: 20 W, 33 W, 65 W GaN, 15 W wireless (in that order). */
const CHARGER_ROWS = [
  { label: "Max output", values: ["20 W", "33 W", "65 W", "15 W wireless"] },
  { label: "Ports", values: ["1 × USB-C", "USB-C + USB-A", "2 × USB-C + USB-A", "Pad (USB-C in)"] },
  { label: "Phone 0 → 50%", values: ["≈ 30 min", "≈ 25 min", "≈ 20 min", "≈ 60 min"] },
  { label: "Charges a laptop", values: ["No", "No", "Yes, up to 65 W", "No"] },
  { label: "Cable in the box", values: ["No", "1 m C-to-C", "1.5 m 100 W C-to-C", "1 m USB-C"] },
  { label: "Warranty", values: ["6 months", "12 months", "18 months", "6 months"] },
  { label: "Best for", values: ["One phone, bedside", "Phone + earbuds", "Laptop bag, travel", "Desk, night stand"] },
];
const CHARGER_ROWS_TA = [
  { label: "அதிகபட்ச வெளியீடு", values: ["20 W", "33 W", "65 W", "15 W வயர்லெஸ்"] },
  { label: "போர்ட்கள்", values: ["1 × USB-C", "USB-C + USB-A", "2 × USB-C + USB-A", "பேட் (USB-C உள்ளீடு)"] },
  { label: "போன் 0 → 50%", values: ["≈ 30 நிமி", "≈ 25 நிமி", "≈ 20 நிமி", "≈ 60 நிமி"] },
  { label: "லேப்டாப் சார்ஜ்", values: ["இல்லை", "இல்லை", "ஆம், 65 W வரை", "இல்லை"] },
  { label: "பெட்டியில் கேபிள்", values: ["இல்லை", "1 மீ C-to-C", "1.5 மீ 100 W C-to-C", "1 மீ USB-C"] },
  { label: "வாரண்டி", values: ["6 மாதம்", "12 மாதம்", "18 மாதம்", "6 மாதம்"] },
  { label: "யாருக்கு ஏற்றது", values: ["ஒரு போன், படுக்கையருகே", "போன் + இயர்பட்ஸ்", "லேப்டாப் பை, பயணம்", "மேசை, இரவு மேசை"] },
];

export const KAIPESI: DemoStore = {
  shop: {
    slug: "kaipesi",
    appId: "EC",
    businessType: "mobile_accessories",
    planId: "pro",
    name: "Kaipesi Mobile Accessories",
    primary: "#b5f23d",
    billing: {
      legalName: "Kaipesi Mobile Accessories",
      gstin: "33AAKFK7319P1ZS",
      address: "Shop 14, Ritchie Street, Mount Road (Anna Salai), Chennai",
      city: "Chennai",
      pincode: "600002",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "KP",
      upiId: "kaipesi@okicici",
    },
    items: [
      { name: "Screen guard fitting (labour)", hsn: "998713", unit: "service", rate: 8_390, gstRate: 18 },
      { name: "Phone repair labour", hsn: "998713", unit: "job", rate: 42_288, gstRate: 18 },
    ],
  },
  preset: "carbon-spec",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 500_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "hello@kaipesi.in",
    social: {
      whatsapp: PHONE,
      instagram: "https://instagram.com/kaipesi.ritchiestreet",
      youtube: "https://youtube.com/@kaipesi",
    },
    policies: {
      shipping:
        "**Chennai (600xxx):** same day if you order by 4 pm, by our own riders; otherwise next day. ₹49, free above ₹499.\n\n**Rest of Tamil Nadu:** 2–4 days by courier, ₹79, free above ₹999. Cash on delivery up to ₹5,000 (₹30 fee).\n\n**Rest of India:** 3–6 days by courier, ₹99, free above ₹1,499. Prepaid only.\n\nPower banks travel by road (surface courier) because of their lithium cells, which can add a day. Every parcel is sealed with tamper tape; please record a short unboxing video for anything above ₹1,000.",
      returns:
        "**7-day replacement for defects.** If anything is faulty out of the box, tell us within 7 days of delivery (a photo or video on WhatsApp is enough) and we replace it, or refund it if it's out of stock. Bring it to the counter or we arrange a pick-up.\n\n**Warranty.** After 7 days, each product's warranty (on its page: 3 to 18 months on electronics, up to 5 years on memory cards and pen drives) is honoured at our Ritchie Street counter: bring the product and the bill or order number. Warranty doesn't cover physical damage, cut or bent cables, water, burnt ports or products opened elsewhere.\n\n**Fit exchange.** Cases and screen guards that don't fit your phone are exchanged within 7 days if unused and in the pack. Fitted screen guards, cut hydrogel films and opened earphones can't be returned (hygiene and fitting), unless faulty.\n\n**Repairs.** Screens carry a 90-day warranty against touch and display faults, batteries 6 months; not new cracks or water damage.",
      privacy:
        "We use your name, phone and address only to deliver your order, send your GST bill and honour your warranty. When you leave a phone for repair we don't open your photos, chats or apps; we ask for the passcode only to test the phone after the repair.",
      terms:
        "Prices include 18% GST; the MRP is the printed maximum retail price. Products are our own generic range, compatible with the phone families named; phone makers' names are used only to say what fits. Screen and battery prices on the booking pages are labour; the part is quoted for your model and billed on the same GST bill. Chargers, adapters and power banks are BIS-registered (R-number on each).",
    },
    businessType: "mobile_accessories",
  },
  zones: [
    {
      name: "Chennai",
      pincodePrefixes: ["600"],
      rate: { name: "Our riders (same / next day)", type: "free_above", amount: 4_900, freeAbove: 49_900, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–4 days)", type: "free_above", amount: 7_900, freeAbove: 99_900, etaMinDays: 2, etaMaxDays: 4, codAllowed: true, codFee: 3_000 },
    },
    {
      name: "Rest of India",
      states: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "26", "27", "29", "30", "31", "32", "34", "35", "36", "37", "38"],
      rate: { name: "Courier (3–6 days)", type: "free_above", amount: 9_900, freeAbove: 149_900, etaMinDays: 3, etaMaxDays: 6, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: CASES, description: "Clear, silicone, hybrid, rugged, leather-finish, wood and printed cases by phone model and colour.", photo: 9558940 },
    { name: GUARDS, description: "9H tempered glass, privacy and matte glass by model, and hydrogel film cut to any phone. Fitted free at the counter.", photo: 2825347 },
    { name: CHARGE, description: "BIS-registered 20 W, 33 W and 65 W GaN chargers, wireless pads, car chargers and cables by connector and length.", photo: 4526431 },
    { name: AUDIO, description: "TWS earbuds with ENC or ANC, open-stem buds, wired 3.5 mm and USB-C earphones and sports earphones.", photo: 11773870 },
    { name: POWER, description: "10000 and 20000 mAh power banks: slim, fast-charge, magnetic wireless and solar.", photo: 38354917 },
    { name: WATCH, description: "Calling smartwatches, fitness bands and 22 mm quick-release straps.", photo: 30707908 },
    { name: MOUNTS, description: "Dashboard, AC-vent, handlebar and mirror mounts for cars, bikes, scooters and cycles.", photo: 30954662 },
    { name: TRIPODS, description: "Selfie sticks, flexible and tall tripods, ring lights and clip-on lenses for reels and video calls.", photo: 1629326 },
    { name: STORAGE, description: "U3 microSD cards, metal and swivel pen drives, dual OTG drives and USB-C card readers.", photo: 4195403 },
    { name: REPAIRS, description: "Screen and battery replacement while you wait, charging-port cleaning and screen guard fitting at the counter.", photo: 6755056 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "Everything on the counter", slug: "all-accessories", description: "Every accessory we stock, A to Z.", rule: { sort: "name" } },
    { name: "Bestsellers", slug: "bestsellers", description: "What Ritchie Street buys every day.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "For iPhone-style phones", slug: "fits-iphone", description: "Cases, guards, cables and chargers for 6.1 and 6.7-inch iPhone-style phones.", rule: { tag: "fits-iphone", sort: "price-asc" } },
    { name: "For Galaxy-style phones", slug: "fits-galaxy", description: "For 6.2-inch Galaxy S-series and 6.6-inch Galaxy A-series phones.", rule: { tag: "fits-galaxy", sort: "price-asc" } },
    { name: "For Redmi Note-style phones", slug: "fits-redmi", description: "For 6.67-inch Redmi Note-style phones.", rule: { tag: "fits-redmi", sort: "price-asc" } },
    { name: "Under ₹499", slug: "under-499", description: "Cables, guards, cases and holders under ₹499.", rule: { tag: "under-499", sort: "price-asc" } },
    { name: "Gift ideas", slug: "gift-ideas", description: "Earbuds, smartwatches, GaN chargers and ring lights that make good gifts.", rule: { tag: "gift", sort: "price-asc" } },
    { name: "Ride & drive", slug: "ride-and-drive", description: "Mounts, car chargers and rugged cases for riders and drivers.", rule: { tag: "ride", sort: "price-asc" } },
    { name: "Evening deals", slug: "evening-deals", description: "The counter's biggest discounts on MRP right now.", rule: { tag: "deal", sort: "price-asc" } },
    { name: "Just landed", slug: "new-arrivals", description: "New stock as it reaches the counter.", rule: { sort: "new" } },
  ],
  coupons: [
    {
      code: "COMBO10",
      description: "10% off orders above ₹999 (up to ₹200): make it a case + guard + charger combo",
      type: "percent",
      value: 10,
      minOrder: 99_900,
      maxDiscount: 20_000,
      channels: ["store", "manual"],
    },
    {
      code: "FIRSTFIT",
      description: "₹50 off your first order above ₹499",
      type: "flat",
      value: 5_000,
      minOrder: 49_900,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      channels: ["store"],
    },
  ],
  home: ({ photo, category, product }) => ({
    seo: {
      title: "Kaipesi Mobile Accessories, Ritchie Street, Chennai",
      description:
        "Cases and screen guards by phone model, BIS-registered fast chargers, cables, TWS earbuds, power banks, smartwatches and mounts from a Ritchie Street counter. Free guard fitting, screen repair while you wait, same-day delivery in Chennai.",
      imageUrl: photo(32912373),
    },
    sections: [
      {
        type: "finder",
        id: "kp-finder",
        title: "Find accessories for your phone",
        text: "Three taps: your phone, its screen size and what you need. Everything listed fits that family; the case and guard pages ask for the exact model.",
        layout: "chips",
        results: "inline",
        limit: 8,
        imageUrl: photo(374140, "tile"),
        cta: { label: "Not sure? Send us a photo of your phone", href: waLink("Hello Kaipesi, which case / guard fits this phone? (photo attached)") },
        questions: [
          {
            label: "Your phone",
            options: [
              { label: "iPhone-style", tag: "fits-iphone" },
              { label: "Galaxy-style", tag: "fits-galaxy" },
              { label: "Redmi / Note-style", tag: "fits-redmi" },
              { label: "Other Android", tag: "fits-other" },
            ],
          },
          {
            label: "Screen size",
            options: [
              { label: "6.1 – 6.3 inch", tag: "size-61" },
              { label: "6.6 – 6.7 inch", tag: "size-67" },
            ],
          },
          {
            label: "What do you need?",
            options: [
              { label: "Protect it", tag: "protect" },
              { label: "Charge it", tag: "charge" },
              { label: "Listen", tag: "listen" },
              { label: "Wear", tag: "wear" },
              { label: "Ride & drive", tag: "ride" },
              { label: "Shoot reels", tag: "shoot" },
              { label: "Store files", tag: "store" },
              { label: "Repair it", tag: "repair" },
            ],
          },
        ],
      },
      {
        type: "categories",
        id: "kp-aisles",
        title: "The aisles",
        categoryIds: [CASES, GUARDS, CHARGE, AUDIO, POWER, WATCH, MOUNTS, TRIPODS, STORAGE, REPAIRS].map(category),
        layout: "tiles",
        showCounts: true,
        columns: "5",
      },
      {
        type: "comparison",
        id: "kp-chargers",
        title: "Chargers by wattage",
        text: "All four are BIS-registered and work with every USB-C phone. More watts charge faster only if the phone can take them: most phones top out between 20 W and 45 W.",
        productIds: [product("20 W USB-C fast charger"), product("33 W dual-port charger, USB-C + USB-A"), product("65 W GaN charger, 3 ports"), product("15 W wireless charging pad")],
        highlightId: product("33 W dual-port charger, USB-C + USB-A"),
        highlightLabel: "Most bought",
        showRating: false,
        rows: CHARGER_ROWS,
      },
      {
        type: "flash-sale",
        id: "kp-flash",
        title: "Ritchie Street evening deals",
        text: "The counter's sharpest prices on MRP, until the end of November. Same-day delivery in Chennai on orders before 4 pm.",
        endsAt: "2026-11-30T21:00:00+05:30",
        source: "collection",
        collectionSlug: "evening-deals",
        layout: "grid",
        limit: 10,
        cta: { label: "Everything on offer", href: "/collections/evening-deals" },
      },
      {
        type: "swatches",
        id: "kp-colours",
        title: "Pick a colour",
        text: "Earphones, earbuds, watches and straps in their real colours. Tap a colour to see its price and add that one.",
        optionName: "Colour",
        productIds: [
          product("Wired earphones with mic, 3.5 mm"),
          product("Silicone sport strap, 22 mm"),
          product("1.96-inch AMOLED calling smartwatch"),
          product("TWS earbuds, 40 h playback with ENC mic"),
          product("Slim 10000 mAh power bank, 22.5 W"),
        ],
        shades: [
          { value: "Yellow", hex: "#f2c230" },
          { value: "Pink", hex: "#f1a7c0" },
          { value: "Orange", hex: "#f08a24" },
          { value: "White", hex: "#f2f2ef" },
          { value: "Black", hex: "#1c1d1f" },
          { value: "Navy", hex: "#1f2f57" },
          { value: "Sage", hex: "#8fa68b" },
          { value: "Sand", hex: "#d8c3a0" },
          { value: "Red", hex: "#c4202b" },
          { value: "Silver", hex: "#c4c7cc" },
        ],
      },
      {
        type: "stories",
        id: "kp-howto",
        title: "Unboxed at the counter",
        layout: "rings",
        items: [
          { imageUrl: photo(16886332, "tile"), title: "65 W GaN", text: "One charger for the laptop, the phone and the watch: what's in the box.", href: "/c/chargers-and-cables", ctaLabel: "Shop chargers" },
          { imageUrl: photo(2825347, "tile"), title: "No-bubble guard", text: "Clean, dust sticker, hinge, press from the middle out: two minutes.", href: "/pages/fit-guide", ctaLabel: "Fitting guide" },
          { imageUrl: photo(35921904, "tile"), title: "Fake charger?", text: "Look for the BIS R-number on the body and check it online before you plug in.", href: "/pages/fit-guide", ctaLabel: "How to check" },
          { imageUrl: photo(1643753, "tile"), title: "Which cable?", text: "USB-C, 8-pin or micro USB: one look at the port tells you.", href: "/pages/fit-guide", ctaLabel: "Cable guide" },
          { imageUrl: photo(37475662, "tile"), title: "Flying?", text: "Power banks go in the cabin bag only; up to 100 Wh needs no permission.", href: "/c/power-banks", ctaLabel: "Power banks" },
          { imageUrl: photo(6755053, "tile"), title: "Screen in 45 min", text: "From cracked to new while you have a tea on Ritchie Street.", href: "/c/repairs-and-fitting", ctaLabel: "Book a repair" },
          { imageUrl: photo(9558940, "tile"), title: "New cases", text: "This week's colours for 6.1 and 6.7-inch phones.", href: "/c/cases-and-covers", ctaLabel: "Shop cases" },
        ],
      },
      {
        type: "category-shelf",
        id: "kp-shelf",
        title: "Shelf by shelf",
        categoryIds: [CHARGE, AUDIO, POWER, WATCH, MOUNTS, TRIPODS, STORAGE].map(category),
        showImages: false,
        limit: 8,
      },
      {
        type: "hero-split",
        id: "kp-counter",
        imageUrl: photo(6755056, "tile"),
        imageSide: "left",
        eyebrow: "Shop 14, Ritchie Street · since 2009",
        heading: "Guards fitted free, screens replaced while you wait",
        text: "Our counter in the Ritchie Street market fits every screen guard we sell for free, cuts hydrogel film for any model and replaces screens and batteries in under an hour, with a GST bill and a warranty.",
        cta: { label: "Book a screen repair", href: "/c/repairs-and-fitting" },
        cta2: { label: "Warranty & repairs", href: "/pages/warranty-and-repairs" },
      },
      {
        type: "offer",
        id: "kp-combo",
        eyebrow: "Combo",
        heading: "Case + guard + charger: 10% off",
        text: "Take 10% off any order above ₹999 (up to ₹200). The guard is fitted free if you pick it up at the counter.",
        code: "COMBO10",
        cta: { label: "Start with a case", href: "/c/cases-and-covers" },
      },
      {
        type: "testimonials",
        id: "kp-voices",
        title: "From the counter",
        layout: "single",
        style: { span: "half" },
        items: [
          { quote: "Cracked my screen on a Friday evening, they had a new one on by 7:30 and fitted a glass free. Bill on WhatsApp before I reached the bus stop.", name: "Arun P.", role: "Triplicane", rating: 5 },
          { quote: "I deliver food all day; the handlebar mount and the 20000 power bank have survived three monsoons. The 33 W charger fills my phone during lunch.", name: "Karthik R.", role: "Delivery partner, Royapettah", rating: 5 },
          { quote: "Sent a photo of my mother's phone on WhatsApp and they told me the exact case and guard. Delivered to Madurai in two days.", name: "Divya S.", role: "Madurai", rating: 5 },
        ],
      },
      { type: "faq", id: "kp-faq", title: "Before you buy", style: { span: "half" }, items: FAQ },
      {
        type: "location",
        id: "kp-visit",
        title: "Find us on Ritchie Street",
        address: "Shop 14, Ritchie Street, off Anna Salai (Mount Road), Chennai 600002",
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "13.0636, 80.2678",
      },
    ],
    translations: {
      ta: {
        "kp-finder": {
          title: "உங்கள் போனுக்கான ஆக்சசரீஸைக் கண்டுபிடியுங்கள்",
          text: "மூன்று தட்டல்கள்: உங்கள் போன், அதன் திரை அளவு, உங்களுக்கு என்ன தேவை. பட்டியலில் உள்ளவை அந்தக் குடும்பத்துக்குப் பொருந்தும்; கேஸ், கார்டு பக்கங்கள் சரியான மாடலைக் கேட்கும்.",
          cta: { label: "சந்தேகமா? உங்கள் போனின் படத்தை அனுப்புங்கள்" },
          questions: [
            { label: "உங்கள் போன்", options: [{ label: "iPhone வகை" }, { label: "Galaxy வகை" }, { label: "Redmi / Note வகை" }, { label: "மற்ற ஆண்ட்ராய்டு" }] },
            { label: "திரை அளவு", options: [{ label: "6.1 – 6.3 அங்குலம்" }, { label: "6.6 – 6.7 அங்குலம்" }] },
            {
              label: "உங்களுக்கு என்ன தேவை?",
              options: [{ label: "பாதுகாக்க" }, { label: "சார்ஜ் செய்ய" }, { label: "கேட்க" }, { label: "அணிய" }, { label: "பைக் & கார்" }, { label: "ரீல்ஸ் எடுக்க" }, { label: "ஃபைல் சேமிக்க" }, { label: "பழுது நீக்க" }],
            },
          ],
        },
        "kp-aisles": { title: "கடையின் வரிசைகள்" },
        "kp-chargers": {
          title: "வாட் வாரியாக சார்ஜர்கள்",
          text: "நான்கும் BIS பதிவு பெற்றவை, எல்லா USB-C போன்களுக்கும் வேலை செய்யும். போன் ஏற்றுக்கொண்டால் மட்டுமே அதிக வாட் வேகமாக சார்ஜ் செய்யும்: பெரும்பாலான போன்கள் 20 W முதல் 45 W வரை தான்.",
          highlightLabel: "அதிகம் வாங்கப்பட்டது",
          rows: CHARGER_ROWS_TA,
        },
        "kp-flash": {
          title: "ரிச்சி ஸ்ட்ரீட் மாலைச் சலுகைகள்",
          text: "நவம்பர் இறுதி வரை MRP-யில் கடையின் மிகக் குறைந்த விலைகள். மாலை 4 மணிக்குள் ஆர்டர் செய்தால் சென்னையில் அதே நாள் டெலிவரி.",
          cta: { label: "சலுகையில் உள்ள அனைத்தும்" },
        },
        "kp-colours": {
          title: "நிறத்தைத் தேர்ந்தெடுங்கள்",
          text: "இயர்போன், இயர்பட்ஸ், வாட்ச், ஸ்ட்ராப் அவற்றின் உண்மையான நிறங்களில். ஒரு நிறத்தைத் தட்டி விலையைப் பார்த்து அதையே சேருங்கள்.",
        },
        "kp-howto": {
          title: "கடையிலேயே அன்பாக்ஸ்",
          items: [
            { title: "65 W GaN", text: "லேப்டாப், போன், வாட்ச் மூன்றுக்கும் ஒரே சார்ஜர்: பெட்டியில் என்ன இருக்கிறது.", ctaLabel: "சார்ஜர்கள்" },
            { title: "குமிழ் இல்லா கார்டு", text: "துடை, தூசி ஸ்டிக்கர், கீல், நடுவிலிருந்து வெளியே அழுத்து: இரண்டு நிமிடம்.", ctaLabel: "ஒட்டும் வழிகாட்டி" },
            { title: "போலி சார்ஜரா?", text: "பிளக் செய்யும் முன் உடலில் BIS R-எண்ணைப் பார்த்து ஆன்லைனில் சரிபாருங்கள்.", ctaLabel: "சரிபார்ப்பது எப்படி" },
            { title: "எந்த கேபிள்?", text: "USB-C, 8-பின் அல்லது மைக்ரோ USB: போர்ட்டை ஒருமுறை பார்த்தாலே தெரியும்.", ctaLabel: "கேபிள் வழிகாட்டி" },
            { title: "விமானப் பயணமா?", text: "பவர் பேங்க் கேபின் பையில் மட்டும்; 100 Wh வரை அனுமதி தேவையில்லை.", ctaLabel: "பவர் பேங்க்குகள்" },
            { title: "45 நிமிடத்தில் ஸ்கிரீன்", text: "ரிச்சி ஸ்ட்ரீட்டில் ஒரு டீ குடிக்கும் நேரத்தில் உடைந்தது புதிதாகும்.", ctaLabel: "பழுது முன்பதிவு" },
            { title: "புதிய கேஸ்கள்", text: "6.1, 6.7 அங்குல போன்களுக்கு இந்த வாரத்தின் நிறங்கள்.", ctaLabel: "கேஸ்கள்" },
          ],
        },
        "kp-shelf": { title: "அலமாரி வாரியாக" },
        "kp-counter": {
          eyebrow: "கடை 14, ரிச்சி ஸ்ட்ரீட் · 2009 முதல்",
          heading: "கார்டு இலவசமாக ஒட்டுவோம், ஸ்கிரீன் உடனே மாற்றுவோம்",
          text: "ரிச்சி ஸ்ட்ரீட் சந்தையில் உள்ள எங்கள் கடையில், நாங்கள் விற்கும் ஒவ்வொரு ஸ்கிரீன் கார்டையும் இலவசமாக ஒட்டுகிறோம், எந்த மாடலுக்கும் ஹைட்ரோஜெல் ஃபிலிம் வெட்டுகிறோம், ஒரு மணி நேரத்துக்குள் ஸ்கிரீன், பேட்டரி மாற்றுகிறோம்; GST பில்லும் வாரண்டியும் உண்டு.",
          cta: { label: "ஸ்கிரீன் பழுது முன்பதிவு" },
          cta2: { label: "வாரண்டி & பழுது நீக்கம்" },
        },
        "kp-voices": {
          title: "கடையிலிருந்து",
          items: [
            { quote: "வெள்ளி மாலை ஸ்கிரீன் உடைந்தது; 7:30-க்குள் புதியதைப் பொருத்தி, கிளாஸையும் இலவசமாக ஒட்டினார்கள். பஸ் ஸ்டாப் சேரும் முன் வாட்ஸ்அப்பில் பில் வந்தது.", role: "திருவல்லிக்கேணி" },
            { quote: "நாள் முழுதும் உணவு டெலிவரி செய்கிறேன்; ஹேண்டில்பார் மவுண்டும் 20000 பவர் பேங்க்கும் மூன்று மழைக்காலம் தாங்கின. 33 W சார்ஜர் மதிய உணவு நேரத்திலேயே போனை நிரப்பிவிடுகிறது.", role: "டெலிவரி பார்ட்னர், ராயப்பேட்டை" },
            { quote: "அம்மாவின் போன் படத்தை வாட்ஸ்அப்பில் அனுப்பினேன்; சரியான கேஸையும் கார்டையும் சொன்னார்கள். இரண்டு நாளில் மதுரைக்கு வந்தது.", role: "மதுரை" },
          ],
        },
        "kp-combo": {
          eyebrow: "காம்போ",
          heading: "கேஸ் + கார்டு + சார்ஜர்: 10% தள்ளுபடி",
          text: "₹999-க்கு மேலான எந்த ஆர்டருக்கும் 10% தள்ளுபடி (₹200 வரை). கடையில் பெற்றுக்கொண்டால் கார்டு இலவசமாக ஒட்டித் தரப்படும்.",
          cta: { label: "கேஸிலிருந்து தொடங்குங்கள்" },
        },
        "kp-faq": { title: "வாங்கும் முன்", items: FAQ_TA },
        "kp-visit": {
          title: "ரிச்சி ஸ்ட்ரீட்டில் எங்களைக் காணுங்கள்",
          address: "கடை 14, ரிச்சி ஸ்ட்ரீட், அண்ணா சாலை (மவுண்ட் ரோடு) அருகில், சென்னை 600002",
          hours: [
            { label: "திங்கள் – சனி", value: "காலை 10:00 – இரவு 9:00" },
            { label: "ஞாயிறு", value: "காலை 11:00 – இரவு 8:00" },
          ],
        },
      },
    },
  }),
  pages: [
    {
      slug: "fit-guide",
      title: "Which one fits? Cables, chargers and guards",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Which cable fits your phone" },
        {
          type: "paragraph",
          markdown:
            "| Port on your phone | Looks like | Cable to buy |\n|---|---|---|\n| **USB-C** | Oval, the same both ways up | USB-C to USB-C (from a USB-C charger) or USB-A to USB-C (old charger, car) |\n| **8-pin (Lightning-style)** | Thin flat slot, older iPhone-style phones | USB-C to 8-pin |\n| **Micro USB** | Small trapezoid, one way up | USB-A to micro USB |\n\nNewer iPhone-style phones (from the 2023 models) use **USB-C**, like Android phones. Laptops need a cable rated for their wattage: a **100 W e-marked** cable for 65 W and above (it comes with our GaN charger).",
        },
        { type: "image", url: photo(1643753, "tile"), alt: "Coiled braided charging cable" },
        { type: "heading", level: 2, text: "How many watts do you need" },
        {
          type: "paragraph",
          markdown:
            "A phone takes only what it can: a 65 W charger is safe on a phone that charges at 20 W, it just won't go faster. Most iPhone-style phones charge at about 20–27 W, most Galaxy-style at 25 W (45 W on top models), most Redmi Note-style at 33–67 W with their own protocol (they still fast-charge on PD / PPS at a little less).\n\n- **One phone:** 20 W.\n- **Phone and earbuds together:** 33 W dual-port.\n- **Laptop, phone and watch from one plug:** 65 W GaN.",
        },
        { type: "heading", level: 2, text: "Is the charger safe? Check the BIS R-number" },
        {
          type: "paragraph",
          markdown:
            "Chargers, adapters and power banks sold in India must be registered with the **Bureau of Indian Standards** (Compulsory Registration Scheme). Look for the **R-number** (R-41xxxxxx) printed on the body under the BIS mark and check it on the BIS website or the BIS Care app: it should show the same product type. No R-number, a smudged one or one that belongs to another product means don't plug it in.",
        },
        { type: "image", url: photo(35921904, "tile"), alt: "White USB-C wall charger" },
        { type: "heading", level: 2, text: "Fitting a screen guard without bubbles" },
        {
          type: "paragraph",
          markdown:
            "1. Work in a bathroom after a hot shower (less dust in the air).\n2. Wipe the screen with the wet wipe, then the dry cloth; lift any dust with the dust sticker.\n3. Line the glass up with the earpiece and the camera hole, holding it by the edges.\n4. Lay it down and press **from the middle outwards**; it settles by itself.\n5. Push any small bubble to the edge with the card. Bubbles that stay overnight usually mean dust: bring it to us, we refit it free if you bought it here.",
        },
        { type: "button", label: "Ask us on WhatsApp", href: waLink("Hello Kaipesi, which cable / charger / guard fits my phone? Model: …"), style: "primary" },
      ],
    },
    {
      slug: "warranty-and-repairs",
      title: "Warranty, replacement and repairs",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "7-day replacement" },
        {
          type: "paragraph",
          markdown:
            "If anything is faulty out of the box, tell us within **7 days of delivery**: a photo or video on WhatsApp is enough. We replace it at the counter or arrange a pick-up; if we're out of stock, we refund it. Cases and guards that don't fit are exchanged in the same 7 days if unused.",
        },
        { type: "heading", level: 2, text: "Warranty after that" },
        {
          type: "paragraph",
          markdown:
            "| Product | Warranty |\n|---|---|\n| Chargers, cables | 3–18 months (on each product page) |\n| Earbuds, earphones | 3–12 months |\n| Power banks | 6 months |\n| Smartwatches, bands | 6–12 months |\n| Memory cards, pen drives | 3–5 years |\n| Screen replacement | 90 days (touch and display faults) |\n| Battery replacement | 6 months |\n\nBring the product and the bill (or the order number) to the counter. Not covered: drops and cracks, cut or bent cables, water, burnt ports, products opened elsewhere.",
        },
        { type: "image", url: photo(11715243, "tile"), alt: "Technician working on a repair mat" },
        { type: "heading", level: 2, text: "Repairs at the counter" },
        {
          type: "paragraph",
          markdown:
            "Screen replacement takes about 45 minutes, a battery about 30. The booking price is the labour; the part is quoted for your model on WhatsApp before we start, and billed on the same GST bill. Back up your phone first and bring the passcode so we can test it after the repair. We never open your photos or chats.",
        },
        { type: "button", label: "Book a repair on WhatsApp", href: waLink("Hello Kaipesi, I'd like to book a repair. Phone model: … Problem: …"), style: "primary" },
      ],
    },
    {
      slug: "about",
      title: "About us",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Kaipesi, Ritchie Street, since 2009" },
        {
          type: "paragraph",
          markdown:
            "Kaipesi (கைப்பேசி) is Tamil for mobile phone. We started as a glass-fitting counter in the **Ritchie Street** electronics market off Mount Road, Chennai's lane of phone parts, speakers and cables, and grew into an accessories shop with a repair bench at the back.\n\nWe stock our own generic range, tested on the counter: BIS-registered chargers and power banks, cases and guards for the phones Chennai actually carries, and earbuds we'd use ourselves. Every guard we sell is fitted free.",
        },
        { type: "image", url: photo(13570128, "tile"), alt: "Open phone box with the cable inside" },
        { type: "paragraph", markdown: "Open Monday to Saturday 10:00 am – 9:00 pm, Sunday 11:00 am – 8:00 pm. Call or WhatsApp **+91 98765 00013**." },
        { type: "image", url: photo(9853463, "tile"), alt: "Hands unpacking a parcel" },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' models, not our customers or staff, and the products shown are stand-ins for the generic products named.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Cases", type: "category", ref: "cases-and-covers" },
      { label: "Screen guards", type: "category", ref: "screen-guards" },
      { label: "Chargers & cables", type: "category", ref: "chargers-and-cables" },
      { label: "Earbuds", type: "category", ref: "earphones-and-neckbands" },
      { label: "Repairs", type: "category", ref: "repairs-and-fitting" },
      { label: "Which one fits?", type: "page", ref: "fit-guide" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Which one fits?", type: "page", ref: "fit-guide" },
          { label: "Warranty & repairs", type: "page", ref: "warranty-and-repairs" },
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "For iPhone-style phones", type: "collection", ref: "fits-iphone" },
          { label: "For Galaxy-style phones", type: "collection", ref: "fits-galaxy" },
          { label: "For Redmi Note-style phones", type: "collection", ref: "fits-redmi" },
          { label: "Under ₹499", type: "collection", ref: "under-499" },
          { label: "About us", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
