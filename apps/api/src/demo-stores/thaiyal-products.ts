import type { DemoProduct } from "./types";

/**
 * Thaiyal Tailors & Boutique: the catalogue (stitching by garment and style, embroidery, uniforms in bulk, alterations,
 * falls and finishing, a little fabric, measurement visits). Prices are GST-inclusive rupees; see thaiyal.ts for the
 * SAC / HSN notes (services 5%, fabric 5%).
 */
const rs = (rupees: number) => Math.round(rupees * 100);

type Rows = [string, number, number?][]; // [option value, price ₹, mrp ₹]
/** One option, priced per value. */
function one(option: string, rows: Rows, stock = 99): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([v, price, mrp]) => ({ values: { [option]: v }, price: rs(price), mrp: rs(mrp ?? price), stock })),
  };
}
const single = (price: number, mrp = price, stock = 99): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

export const BLOUSES = "Blouses";
export const SALWAR = "Salwar & churidar";
export const SHIRTS = "Shirts & pants";
export const KIDS = "Kids";
export const ALTER = "Alterations";
export const EMB = "Embroidery & aari work";
export const UNI = "School uniforms";
export const FALLS = "Falls, pico & finishing";
export const FABRIC = "Fabric & materials";
export const VISITS = "Measurements & pickup";

const NOTE = "\n\nBring your fabric (or buy it from our fabric shelf). Measurements are taken at the shop or at your home; the trial is free and a first alteration within 7 days is free. Price is for stitching only, GST included.";

type S = Omit<DemoProduct, "unit" | "gstRate" | "hsn">;
/** A stitching service: unit "service", 5% (SAC 998821, textile job work). */
const svc = (p: S): DemoProduct => ({ ...p, hsn: "998821", unit: "service", gstRate: 5 });
/** Fabric and materials (goods), 5%, by HSN. */
const goods = (hsn: string, unit: string, p: S): DemoProduct => ({ ...p, hsn, unit, gstRate: 5 });

// Tags for the finder: garment (g-blouse / g-salwar / g-kids / g-men / g-uniform / g-alter), style (s-simple /
// s-designer / s-handwork), occasion (o-daily / o-festive / o-wedding / o-school); plus bestseller, rush, under-500, bridal.
export const PRODUCTS: DemoProduct[] = [
  // ---- blouses
  svc({
    name: "Simple blouse stitching",
    category: BLOUSES,
    sku: "TH-BS",
    photo: 36994691,
    tags: ["g-blouse", "s-simple", "o-daily", "o-festive", "bestseller", "rush", "under-500"],
    description: `A plain, well-fitted blouse for daily wear: round or V neck, cut to your measurements with 1-inch margins so it can be let out later. Elbow sleeve as standard. Delivery in 3 days (next day with the rush fee).${NOTE}`,
    attributes: { Delivery: "3 days (rush: next day)", Trial: "Optional", Neck: "Round or V", Lining: "As chosen" },
    ...one("Lining", [["Unlined", 300], ["With cotton lining", 380], ["Lined and padded", 480]]),
  }),
  svc({
    name: "Princess-cut blouse stitching",
    category: BLOUSES,
    sku: "TH-BP",
    photo: 9496723,
    tags: ["g-blouse", "s-simple", "s-designer", "o-festive", "o-wedding", "bestseller"],
    description: `Six-panel princess cut with darts that follow the body: no puckering, no pulling at the arm. Lined, with hooks in front or a zip at the back, your choice. One trial, then the finish. Delivery in 5 days.${NOTE}`,
    attributes: { Delivery: "5 days", Trial: "1 trial", Cut: "Six-panel princess", Closure: "Front hooks or back zip" },
    ...one("Sleeve", [["Sleeveless", 520], ["Elbow sleeve", 560], ["Full sleeve", 640]]),
  }),
  svc({
    name: "Designer blouse stitching",
    category: BLOUSES,
    sku: "TH-BD",
    photo: 38995453,
    tags: ["g-blouse", "s-designer", "o-festive", "o-wedding"],
    description: `A back-neck you choose from our design book or a photo you bring: boat neck, keyhole, deep U with dori, lace-up, or a cut-out. Lined and padded, with piping or latkans on request. Delivery in 6 days, with a fitting on day 4.${NOTE}`,
    attributes: { Delivery: "6 days", Trial: "1 fitting", Lining: "Lined and padded", Extras: "Piping, latkans, dori" },
    ...one("Back neck", [["Boat neck", 750], ["Keyhole", 850], ["Deep U with dori", 900], ["Lace-up back", 980], ["Cut-out back", 1150]]),
  }),
  svc({
    name: "Bridal blouse with aari work",
    category: BLOUSES,
    sku: "TH-BB",
    photo: 37439026,
    tags: ["g-blouse", "s-handwork", "s-designer", "o-wedding", "bridal"],
    description: `The blouse for the muhurtham saree: cut and lined by our master tailor, then worked by hand on the aari frame in zari thread, beads and stones, in the pattern you pick. Three fittings. Book 3 weeks ahead; heavy work needs 4. Price covers stitching and thread work; stones and zardosi kits are extra at cost.${NOTE}`,
    attributes: { Delivery: "3 to 4 weeks", Trial: "3 fittings", Work: "Hand aari, zari thread, beads", Booking: "Advance of 30%" },
    ...one("Work", [["Light aari, neck and sleeve edge", 3500], ["Heavy aari, front and back", 5500], ["Heavy aari with stones and beads", 8500]]),
  }),
  svc({
    name: "Blouse for a silk saree, with fall and pico",
    category: BLOUSES,
    sku: "TH-BF",
    photo: 31945332,
    tags: ["g-blouse", "s-designer", "o-festive", "o-wedding"],
    description: `Bring the saree: we match the blouse lining, stitch the blouse with a contrast piping, and finish the saree with a fall and pico so it is ready to wear on the day. One trial. Delivery in 5 days.${NOTE}`,
    attributes: { Delivery: "5 days", Trial: "1 trial", Includes: "Blouse, lining, piping, saree fall and pico" },
    ...one("Saree border", [["Light border", 760], ["Heavy zari border", 860]]),
  }),

  // ---- salwar & churidar
  svc({
    name: "Churidar set stitching",
    category: SALWAR,
    sku: "TH-CH",
    photo: 20690511,
    tags: ["g-salwar", "s-simple", "o-daily", "o-festive", "bestseller", "rush"],
    description: `Top and churidar bottom to your measurements: slit sides, round or boat neck, three-quarter sleeve as standard, with the bottom cut on the bias so it gathers neatly at the ankle. Delivery in 4 days.${NOTE}`,
    attributes: { Delivery: "4 days", Trial: "Optional", Set: "Top and bottom (dupatta hem included)" },
    ...one("Style", [["Straight cut", 650], ["A-line", 720], ["Princess cut", 790]]),
  }),
  svc({
    name: "Salwar kameez, three piece",
    category: SALWAR,
    sku: "TH-SK",
    photo: 20382095,
    tags: ["g-salwar", "s-simple", "o-daily", "o-festive"],
    description: `Top, bottom and the dupatta hemmed with its edge. Choose a straight salwar, a palazzo or a Patiala bottom. Lining for the top is extra (see the add-ons). Delivery in 4 days.${NOTE}`,
    attributes: { Delivery: "4 days", Trial: "Optional", Set: "Top, bottom, dupatta hem" },
    ...one("Bottom", [["Straight salwar", 700], ["Palazzo", 760], ["Patiala", 840]]),
  }),
  svc({
    name: "Anarkali dress stitching",
    category: SALWAR,
    sku: "TH-AN",
    photo: 20777176,
    tags: ["g-salwar", "s-designer", "o-festive", "o-wedding"],
    description: `A flared Anarkali with a fitted yoke: lined, with a can-can for the floor-length one so it stands out. Neck and sleeve pattern from our book. Delivery in 6 days with one fitting.${NOTE}`,
    attributes: { Delivery: "6 days", Trial: "1 fitting", Lining: "Cotton lining (can-can for floor length)" },
    ...one("Length", [["Knee length", 1100], ["Calf length", 1300], ["Floor length with can-can", 1900]]),
  }),
  svc({
    name: "Kurti stitching",
    category: SALWAR,
    sku: "TH-KU",
    photo: 20407198,
    tags: ["g-salwar", "s-simple", "o-daily", "rush", "under-500"],
    description: `An everyday kurti, straight, A-line or long, with side slits, pockets on request and a simple neck. Ready in 2 days; same day on a weekday before noon with the rush fee.${NOTE}`,
    attributes: { Delivery: "2 days (rush: same day)", Trial: "Optional", Pockets: "On request" },
    ...one("Style", [["Straight", 400], ["A-line", 450], ["Long, below the knee", 550]]),
  }),
  svc({
    name: "Bottoms only: churidar, palazzo, Patiala",
    category: SALWAR,
    sku: "TH-BO",
    photo: 9850069,
    tags: ["g-salwar", "s-simple", "o-daily", "rush", "under-500"],
    description: `Bottoms stitched to match a top you already have, with a drawstring or an elastic waist. Ready in 2 days.${NOTE}`,
    attributes: { Delivery: "2 days", Trial: "Not needed", Waist: "Drawstring or elastic" },
    ...one("Bottom", [["Churidar", 250], ["Palazzo", 280], ["Patiala", 330]]),
  }),
  svc({
    name: "Langa voni and half saree stitching",
    category: SALWAR,
    sku: "TH-LV",
    photo: 29172765,
    tags: ["g-salwar", "s-designer", "o-festive", "o-wedding", "bridal"],
    description: `A pattu langa with its blouse and voni for a girl's ritual-day function: flared skirt with can-can, a matching blouse with the neck you choose, and the voni hemmed with its border. Two fittings. Delivery in 8 days.${NOTE}`,
    attributes: { Delivery: "8 days", Trial: "2 fittings", Set: "Langa, blouse, voni hem" },
    ...one("Set", [["Langa and blouse", 1800], ["Half saree with can-can", 2800]]),
  }),

  // ---- kids
  svc({
    name: "Pattu pavadai for girls",
    category: KIDS,
    sku: "TH-PP",
    photo: 36893900,
    tags: ["g-kids", "s-designer", "s-simple", "o-festive", "o-wedding", "bestseller"],
    description: `A silk pavadai with a blouse and a jari-lace hem for festivals and functions, cut with two inches of let-out margin so it fits next year as well. Delivery in 6 days.${NOTE}`,
    attributes: { Delivery: "6 days", Trial: "1 fitting", Margin: "2 inches to let out", Set: "Pavadai and blouse" },
    ...one("Age", [["1 to 3 years", 750], ["4 to 7 years", 950], ["8 to 12 years", 1250]]),
  }),
  svc({
    name: "Party frock stitching",
    category: KIDS,
    sku: "TH-FR",
    photo: 36045982,
    tags: ["g-kids", "s-designer", "o-festive", "o-wedding"],
    description: `A tiered frock with net, satin lining and a bow at the waist, to a photo or a design you like. Zip at the back, soft finish inside. Delivery in 5 days.${NOTE}`,
    attributes: { Delivery: "5 days", Trial: "1 fitting", Lining: "Satin lining" },
    ...one("Age", [["1 to 3 years", 650], ["4 to 7 years", 800], ["8 to 12 years", 1000]]),
  }),
  svc({
    name: "Boys shirt and shorts set",
    category: KIDS,
    sku: "TH-BS2",
    photo: 35107586,
    tags: ["g-kids", "s-simple", "o-daily", "o-festive", "under-500"],
    description: `A shirt and elastic-waist shorts in your fabric, with reinforced seams for play. Delivery in 4 days.${NOTE}`,
    attributes: { Delivery: "4 days", Trial: "Optional", Seams: "Double-stitched" },
    ...one("Age", [["2 to 5 years", 420], ["6 to 9 years", 500], ["10 to 14 years", 600]]),
  }),
  svc({
    name: "Boys kurta pyjama set",
    category: KIDS,
    sku: "TH-BK",
    photo: 6765649,
    tags: ["g-kids", "s-simple", "o-festive", "o-wedding"],
    description: `A kurta with a mandarin collar and a pyjama with a drawstring waist for festivals, weddings and temple days. Delivery in 5 days.${NOTE}`,
    attributes: { Delivery: "5 days", Trial: "Optional", Collar: "Mandarin" },
    ...one("Age", [["2 to 5 years", 500], ["6 to 9 years", 620], ["10 to 14 years", 760]]),
  }),

  // ---- shirts & pants (men)
  svc({
    name: "Men's shirt stitching",
    category: SHIRTS,
    sku: "TH-MS",
    photo: 6766241,
    tags: ["g-men", "s-simple", "o-daily", "o-school", "bestseller", "under-500"],
    description: `A shirt cut to your measurements: collar, cuff and shoulder checked on the stand, a chest pocket on request and a stitched placket. Delivery in 4 days.${NOTE}`,
    attributes: { Delivery: "4 days", Trial: "Optional", Finish: "Stitched placket, side-seam finish" },
    ...one("Style", [["Half sleeve", 380], ["Full sleeve", 450], ["Full sleeve, lined collar and cuff", 520]]),
  }),
  svc({
    name: "Men's pant stitching",
    category: SHIRTS,
    sku: "TH-MP",
    photo: 4622406,
    tags: ["g-men", "s-simple", "o-daily", "o-school"],
    description: `A trouser with a trial fitting: waist, seat and break checked while you stand, hem done after the trial. Delivery in 5 days.${NOTE}`,
    attributes: { Delivery: "5 days", Trial: "1 trial", Pockets: "Slant, with a watch pocket on request" },
    ...one("Style", [["Plain front", 550], ["Single pleat", 600], ["Jeans-style cotton", 650]]),
  }),
  svc({
    name: "Kurta and pyjama set, men",
    category: SHIRTS,
    sku: "TH-MK",
    photo: 6765649,
    tags: ["g-men", "s-simple", "o-festive", "o-wedding"],
    description: `A straight kurta with a side slit and a pyjama with a drawstring or a churidar bottom, for pooja days, weddings and festivals. Delivery in 5 days.${NOTE}`,
    attributes: { Delivery: "5 days", Trial: "Optional", Set: "Kurta and pyjama" },
    ...one("Set", [["Cotton kurta", 480], ["Kurta and pyjama", 650], ["Silk kurta, lined", 900]]),
  }),
  svc({
    name: "Waistcoat and two-piece suit",
    category: SHIRTS,
    sku: "TH-SU",
    photo: 6766241,
    tags: ["g-men", "s-designer", "o-wedding", "o-festive"],
    description: `A waistcoat or a blazer-and-trouser suit canvassed and lined by hand, with two fittings. Delivery in 12 days.${NOTE}`,
    attributes: { Delivery: "12 days", Trial: "2 fittings", Lining: "Full lining" },
    ...one("Piece", [["Waistcoat", 1400], ["Blazer", 2900], ["Blazer and trouser", 4900]]),
  }),

  // ---- school uniforms (bulk, priced per set by order size)
  svc({
    name: "School uniform set, shirt and pant or skirt",
    category: UNI,
    sku: "TH-UN",
    photo: 35745597,
    tags: ["g-uniform", "s-simple", "o-school", "bulk", "bestseller"],
    description: `A shirt with a pant (boys) or a skirt (girls) in the school's cloth, cut by size slab, stitched in the school's colours and delivered in bundles with a size list. Price per set by order size; ask for a quote for 500 sets and above. Delivery in 10 to 18 days. Cloth is stitched as supplied; cloth can also be bought from our fabric shelf.`,
    attributes: { Delivery: "10 to 18 days", Fit: "Size slabs, with a free alteration round", Billing: "GST bill, part-payment and credit for schools" },
    ...one("Order size", [["10 to 24 sets", 460], ["25 to 99 sets", 410], ["100 sets and above", 370]]),
  }),
  svc({
    name: "Pinafore and blouse set, girls",
    category: UNI,
    sku: "TH-PF",
    photo: 35107586,
    tags: ["g-uniform", "s-simple", "o-school", "bulk"],
    description: `The pinafore with box pleats and a plain blouse for primary classes, in the school's cloth. Price per set by order size. Delivery in 10 to 18 days.`,
    attributes: { Delivery: "10 to 18 days", Pleats: "Box pleats, stitched down", Billing: "GST bill, part-payment and credit for schools" },
    ...one("Order size", [["10 to 24 sets", 440], ["25 to 99 sets", 390], ["100 sets and above", 350]]),
  }),
  svc({
    name: "House-colour T-shirt and sports shorts",
    category: UNI,
    sku: "TH-HT",
    photo: 35107586,
    tags: ["g-uniform", "s-simple", "o-school", "bulk"],
    description: `Sports-day and house T-shirts with piping in the house colour, with matching shorts. Price per set by order size; a name or number can be added at the Machine embroidery counter. Delivery in 8 to 14 days.`,
    attributes: { Delivery: "8 to 14 days", Piping: "House colour", Billing: "GST bill, part-payment and credit for schools" },
    ...one("Order size", [["10 to 24 sets", 380], ["25 to 99 sets", 340], ["100 sets and above", 300]]),
  }),
  svc({
    name: "Uniform cloth cutting and marking, per set",
    category: UNI,
    sku: "TH-UC",
    photo: 6461121,
    tags: ["g-uniform", "s-simple", "o-school", "bulk", "under-500"],
    description: `Only the cutting, marking and bundling of cloth the school or the parents already have, per set, for tailors in the school's lane or the school's own machines. Delivery in 5 to 8 days.`,
    attributes: { Delivery: "5 to 8 days", Includes: "Cutting, size marking, bundling" },
    ...single(120),
  }),

  // ---- alterations
  svc({
    name: "Pant hemming and length alteration",
    category: ALTER,
    sku: "TH-AH",
    photo: 9983579,
    tags: ["g-alter", "s-simple", "o-daily", "o-school", "rush", "bestseller", "under-500"],
    description: `Hemming to your length while you wait: pinned on you, stitched on the machine. A jeans' original hem is kept with the factory chain-stitch look. Same day before 4 pm.`,
    attributes: { Delivery: "Same day before 4 pm", Trial: "Pinned on you" },
    ...one("Type", [["Plain hem", 80], ["Hem with cuff", 120], ["Jeans, original hem kept", 150]]),
  }),
  svc({
    name: "Pant and shirt fit alteration",
    category: ALTER,
    sku: "TH-AF",
    photo: 7776107,
    tags: ["g-alter", "s-simple", "o-daily", "o-school", "rush", "under-500"],
    description: `Waist taken in or let out, legs tapered, shirt sides taken in, sleeves shortened. We tell you honestly if the cloth cannot be let out further. Ready in 2 days.`,
    attributes: { Delivery: "2 days", Trial: "Try-on before we finish" },
    ...one("Work", [["Waist in or out, up to 2 inches", 150], ["Taper both legs", 250], ["Shirt: take in the sides", 200], ["Shirt: shorten the sleeves", 150]]),
  }),
  svc({
    name: "Blouse alteration",
    category: ALTER,
    sku: "TH-AB",
    photo: 27893063,
    tags: ["g-alter", "g-blouse", "s-simple", "o-daily", "o-festive", "rush", "bestseller", "under-500"],
    description: `Loose, tight, short in the sleeve or too high in the neck: we open the seams, re-cut and re-stitch, and add inside margin where there is none. Ready in 2 days; same day for simple fits.`,
    attributes: { Delivery: "2 days (simple fits same day)", Trial: "Try-on before we finish" },
    ...one("Work", [["Take in or let out, up to 1.5 inches", 120], ["Shorten or lengthen the sleeve", 100], ["Deepen the front or back neck", 180], ["Add a lining or padding to a ready blouse", 220]]),
  }),
  svc({
    name: "Salwar and churidar alteration",
    category: ALTER,
    sku: "TH-AS",
    photo: 9850069,
    tags: ["g-alter", "g-salwar", "s-simple", "o-daily", "rush", "under-500"],
    description: `Bottom length, elastic or drawstring waist, taking in the top at the sides, adding sleeves or removing them. Ready in 2 days.`,
    attributes: { Delivery: "2 days", Trial: "Try-on before we finish" },
    ...one("Work", [["Bottom length", 80], ["New elastic or drawstring", 60], ["Take in the top at the sides", 150], ["Add or remove sleeves", 200]]),
  }),

  // ---- falls, pico, finishing
  svc({
    name: "Saree fall and pico",
    category: FALLS,
    sku: "TH-FP",
    photo: 2564890,
    tags: ["g-alter", "s-simple", "o-daily", "o-festive", "rush", "bestseller", "under-500"],
    description: `A fall stitched along the saree's bottom so it hangs straight and the edge never frays, and a pico (a narrow rolled stitch) along the border. Same day if you come before noon, otherwise next day. The fall cloth is included in the price.`,
    attributes: { Delivery: "Same day before noon, else next day", Fall: "Cloth included, colour matched" },
    ...one("Service", [["Pico only", 60], ["Fall only", 80], ["Fall and pico", 120], ["Fall, pico and tassels", 250]]),
  }),
  svc({
    name: "Saree kuchu and tassels",
    category: FALLS,
    sku: "TH-KC",
    photo: 3984876,
    tags: ["g-alter", "s-handwork", "o-festive", "o-wedding", "under-500"],
    description: `Hand-knotted tassels (kuchu) for the pallu end, in silk thread in the saree's colours or with beads. Ready in 3 days.`,
    attributes: { Delivery: "3 days", Work: "Hand-knotted" },
    ...one("Type", [["Plain silk thread kuchu", 150], ["Beaded kuchu", 280], ["Zari thread kuchu", 350]]),
  }),
  svc({
    name: "Dupatta hem and lace",
    category: FALLS,
    sku: "TH-DH",
    photo: 3984876,
    tags: ["g-alter", "g-salwar", "s-simple", "o-daily", "o-festive", "rush", "under-500"],
    description: `A rolled hem for a chiffon or georgette dupatta, a lace attached along the edges, or gota-patti applied by hand. Ready in 2 days.`,
    attributes: { Delivery: "2 days", Hem: "Rolled" },
    ...one("Finish", [["Rolled hem", 40], ["Lace attached, both ends", 90], ["Gota-patti by hand", 200]]),
  }),

  // ---- embroidery & aari work
  svc({
    name: "Aari work on a blouse, by hand",
    category: EMB,
    sku: "TH-AW",
    photo: 9339396,
    tags: ["g-blouse", "s-handwork", "s-designer", "o-festive", "o-wedding", "bestseller"],
    description: `Hand embroidery on the aari frame by our karigar: a chain-stitch hook in zari thread, silk thread, sequins and beads, drawn on your blouse cloth from our pattern book or your photo. Delivery by coverage: 6 to 14 days. Thread, beads and stones are at cost.`,
    attributes: { Delivery: "6 to 14 days", Frame: "Aari frame, hand hook", Booking: "Advance of 30%" },
    ...one("Coverage", [["Neckline only", 1500], ["Neck and sleeve edge", 2800], ["Full back and sleeves", 4500]]),
  }),
  svc({
    name: "Maggam work with thread and stones",
    category: EMB,
    sku: "TH-MW",
    photo: 31935139,
    tags: ["g-blouse", "s-handwork", "s-designer", "o-wedding", "bridal"],
    description: `Maggam work (thread, zardosi, cut-dana, stones) in a dense pattern for bridal blouses, lehengas and half sarees. A drawing is made first and approved by you. Delivery in 2 to 3 weeks.`,
    attributes: { Delivery: "2 to 3 weeks", Work: "Zardosi, cut-dana, stones", Booking: "Advance of 30%" },
    ...one("Density", [["Simple, one motif", 2200], ["Medium, neck and sleeves", 3800], ["Heavy bridal", 6500]]),
  }),
  svc({
    name: "Machine embroidery: name, logo or border",
    category: EMB,
    sku: "TH-ME",
    photo: 13206031,
    tags: ["g-uniform", "s-simple", "o-school", "bulk", "under-500"],
    description: `Computerised embroidery on shirts, T-shirts, bags and caps: a name, a school logo or a house number, or a border for a dupatta. Price per piece; the digitising of a new logo is a one-time ₹250. Ready in 2 to 6 days.`,
    attributes: { Delivery: "2 to 6 days", Digitising: "₹250 once per logo" },
    ...one("Work", [["Name or number, per piece", 40], ["Logo up to 3 inches, per piece", 60], ["Border for a dupatta, per metre", 90]]),
  }),

  // ---- fabric & materials (goods)
  goods("5208", "m", {
    name: "Cotton blouse cloth, 1 metre",
    category: FABRIC,
    sku: "TH-FB",
    photo: 5504775,
    tags: ["fabric", "g-blouse", "s-simple", "o-daily", "under-500"],
    description: `Soft handloom-weave cotton blouse cloth in 30 colours, 44 inches wide: one metre is enough for a blouse. Sold by the metre at the shop and online. GST 5%.`,
    attributes: { Width: "44 inches", Fibre: "Cotton", Care: "Cold wash, first wash separately" },
    ...one("Colour", [["Maroon", 180], ["Bottle green", 180], ["Mustard", 180], ["Navy", 180], ["Off white", 180]]),
  }),
  goods("5007", "m", {
    name: "Silk-cotton blouse cloth, 1 metre",
    category: FABRIC,
    sku: "TH-FS",
    photo: 18359545,
    tags: ["fabric", "g-blouse", "s-designer", "o-festive", "o-wedding", "under-500"],
    description: `A silk-cotton weave with a small zari border for festival blouses: a rich look, a cool feel. One metre for a blouse, 1.25 metres for a full-sleeve one. GST 5%.`,
    attributes: { Width: "42 inches", Fibre: "Silk-cotton" },
    ...one("Colour", [["Peacock blue", 420], ["Rani pink", 420], ["Gold", 420]]),
  }),
  goods("5209", "m", {
    name: "Cotton lining cloth, per metre",
    category: FABRIC,
    sku: "TH-FL",
    photo: 5504775,
    tags: ["fabric", "g-blouse", "s-simple", "o-daily", "under-500"],
    description: `Soft cotton lining in skin, white and black for blouses, kurtis and anarkalis; pre-shrunk. GST 5%.`,
    attributes: { Width: "36 inches", Fibre: "Cotton" },
    ...one("Colour", [["Skin", 60], ["White", 55], ["Black", 60]]),
  }),
  goods("5209", "m", {
    name: "School uniform shirting and trouser cloth, per metre",
    category: FABRIC,
    sku: "TH-FU",
    photo: 18359545,
    tags: ["fabric", "g-uniform", "o-school", "under-500"],
    description: `Poly-cotton shirting and trouser cloth for school uniforms, colour-fast, in 12 school colours. Bulk rates for schools on request. GST 5%.`,
    attributes: { Width: "44 inches", Fibre: "Polyester-cotton", Care: "Machine wash" },
    ...one("Colour", [["White shirting", 150], ["Navy trouser cloth", 220], ["Khaki trouser cloth", 220], ["Grey pinafore cloth", 200]]),
  }),
  goods("5401", "set", {
    name: "Aari thread and bead kit",
    category: FABRIC,
    sku: "TH-FK",
    photo: 3984876,
    tags: ["fabric", "g-blouse", "s-handwork", "o-wedding", "under-500"],
    description: `Zari and silk thread, sequins and glass beads for aari and maggam work, sold as a kit for one blouse neckline (or as the starting stock for a bigger design). GST 5% on the thread; beads and sequins billed with it at the same rate.`,
    attributes: { Includes: "Zari thread, silk thread, sequins, beads" },
    ...one("Colour theme", [["Gold and maroon", 480], ["Gold and green", 480], ["Silver and blue", 480]]),
  }),

  // ---- measurements and pickup
  svc({
    name: "Measurement and style consultation, at the shop",
    category: VISITS,
    sku: "TH-VM",
    photo: 3143082,
    tags: ["visit", "g-blouse", "g-salwar", "g-kids", "g-men", "s-simple", "o-daily", "o-festive", "o-wedding", "under-500"],
    description: `Fifteen to thirty minutes with our master tailor: measurements, a look at the design book, a decision on lining and piping. The fee is adjusted in your stitching bill when you place the order.`,
    attributes: { Duration: "15 to 30 minutes", Adjusted: "In the stitching bill" },
    ...single(99),
  }),
  svc({
    name: "Home measurement visit, Madurai city",
    category: VISITS,
    sku: "TH-VH",
    photo: 4614250,
    tags: ["visit", "g-blouse", "g-salwar", "g-kids", "g-men", "s-simple", "o-daily", "o-festive", "o-wedding", "under-500"],
    description: `A tailor comes to your house in Madurai city with the design book and a tape: for brides, the elderly, and families ordering for several people. Adjusted in the stitching bill when you place the order.`,
    attributes: { Area: "Madurai city, 8 km from Simmakkal", Adjusted: "In the stitching bill" },
    ...single(199),
  }),
  svc({
    name: "Fabric pickup and delivery",
    category: VISITS,
    sku: "TH-VP",
    photo: 13206031,
    tags: ["visit", "g-blouse", "g-salwar", "g-kids", "g-men", "s-simple", "o-daily", "o-festive", "o-wedding", "under-500"],
    description: `We collect your fabric from your door, return the stitched garment and take it back for any alteration. Madurai city, 9 am to 6 pm, Monday to Saturday.`,
    attributes: { Area: "Madurai city", Slots: "9 am to 6 pm, Mon to Sat" },
    ...single(80),
  }),
];

// Add-ons are billed with a stitching order: tagged `addon`.
PRODUCTS.push(
  svc({
    name: "Add-on: cotton lining",
    category: BLOUSES,
    sku: "TH-AL",
    photo: 3984876,
    tags: ["addon", "g-blouse", "g-salwar", "s-simple", "o-daily", "o-festive", "under-500"],
    description: `A cotton lining sewn inside a blouse or kurti for a smooth, cool wear. Add this to your stitching order. Ready with the order.`,
    attributes: { Delivery: "With the order" },
    ...single(80),
  }),
  svc({
    name: "Add-on: padding and cups",
    category: BLOUSES,
    sku: "TH-AP",
    photo: 39204039,
    tags: ["addon", "g-blouse", "s-simple", "s-designer", "o-festive", "o-wedding", "under-500"],
    description: `Fitted cups or padding stitched into the blouse. Add this to your stitching order. Ready with the order.`,
    attributes: { Delivery: "With the order" },
    ...single(100),
  }),
  svc({
    name: "Add-on: piping and latkans",
    category: BLOUSES,
    sku: "TH-AI",
    photo: 3984876,
    tags: ["addon", "g-blouse", "s-designer", "o-festive", "o-wedding", "under-500"],
    description: `Contrast piping along the neck and sleeves, and latkans (tassels) on the dori. Add this to your stitching order. Ready with the order.`,
    attributes: { Delivery: "With the order" },
    ...one("Finish", [["Piping, neck and sleeves", 60], ["Latkans on the dori", 120], ["Piping and latkans", 160]]),
  }),
);
