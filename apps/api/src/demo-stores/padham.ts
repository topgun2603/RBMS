import { withPriceBandGst } from "./gst-band";
import type { DemoProduct, DemoStore } from "./types";

/**
 * Store #7 of the series: Padham Footwear, Vellore (padham.localhost:3003). A family footwear store on Long Bazaar,
 * opposite the fort, on the online store app (EC) with the `footwear` trade (the storefront's shoe size chart next to
 * the Size option) and the "stride" look (electric cobalt and volt lime on chalk white, a wide uppercase grotesk).
 * Padham (பாதம்) is Tamil for the foot. Vellore district (Ambur, Pernambut, Ranipet) is India's leather-footwear belt,
 * so the shop sells handmade leather from Ambur workshops next to running shoes, school shoes, women's sandals and
 * juttis, kids' shoes, chappals and care. Names are generic (no brands); prices are typical Vellore shop prices in
 * 2026, GST included. Address, phone and GSTIN are placeholders like the other demo shops.
 *
 * GST (CGST notification 9/2025-Central Tax (Rate) of 17 Sept 2025, in force from 22 Sept 2025, which replaced
 * 1/2017; the Council for Leather Exports' circular on it, leatherindia.org/gst-rate-reduction-for-certain-products):
 * - Footwear (chapter 64: 6402 rubber / plastics uppers, 6403 leather uppers, 6404 textile uppers) of a sale value up
 *   to ₹2,500 a pair: 5% (it was 12% up to ₹1,000); above ₹2,500 a pair: 18%. The test is the value on the invoice per
 *   pair, so prices here (GST included) are at most ₹2,625 for a 5% pair and more than ₹2,950 for an 18% pair, and
 *   every variant of a product sits on the same side of the line: the welted wingtip, the commando-sole Derby, the
 *   hand-stitched loafer, the woven mule and the cushioned knit runner are the 18% pairs.
 * - Shoe polish and creams (3405): 18%. Brushes (9603 29, not toothbrushes): 18%.
 * - Socks (6115, knitted hosiery, apparel): 5% up to ₹2,500 a piece.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500077";
const WHATSAPP = "919876500077";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

/** Every combination of two options at one price: `stock(a, b)` per combination. */
function grid(a: [string, string[]], b: [string, string[]], price: number, mrp: number, stock: (x: string, y: string) => number): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [
      { name: a[0], values: a[1] },
      { name: b[0], values: b[1] },
    ],
    variants: a[1].flatMap((x) => b[1].map((y) => ({ values: { [a[0]]: x, [b[0]]: y }, price: rs(price), mrp: rs(mrp), stock: stock(x, y) }))),
  };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

/** One size row at one price; the middle sizes get the most stock. */
const sized = (sizes: string[], price: number, mrp: number) => {
  const mid = (sizes.length - 1) / 2;
  return one(
    "Size",
    sizes.map((s, i) => [s, price, mrp, Math.max(2, 8 - Math.round(Math.abs(i - mid) * 2))]),
  );
};

const uk = (...n: (number | string)[]) => n.map((x) => `UK ${x}`);
const MEN = uk(6, 7, 8, 9, 10, 11);
const WOMEN = uk(3, 4, 5, 6, 7, 8);
const UNISEX = uk(4, 5, 6, 7, 8, 9, 10);
const KIDS = uk("8C", "9C", "10C", "11C", "12C", "13C");
const SCHOOL = uk("11C", "12C", "13C", 1, 2, 3, 4, 5);
const WIDTHS: [string, string[]] = ["Width", ["Regular", "Wide (E)"]];
/** Wide fittings are stocked thinner, mostly in the middle sizes. */
const widthStock = (size: string, width: string) => (width === "Regular" ? (size === "UK 8" || size === "UK 9" ? 6 : 4) : size === "UK 8" || size === "UK 9" ? 3 : 1);

const MEN_CAT = "Men";
const WOMEN_CAT = "Women";
const KIDS_CAT = "Kids";
const SCHOOL_CAT = "School shoes";
const SPORTS_CAT = "Sports shoes";
const SANDALS_CAT = "Sandals & chappals";
const FORMAL_CAT = "Formal shoes";
const CARE_CAT = "Shoe care & socks";

const AMBUR = "\n\nCut and stitched in an Ambur workshop from full-grain cow leather tanned in Ranipet; leather lining and a cushioned leather sock. Polish with a neutral cream every two weeks and keep a shoe tree in it.";
const FIT = "\n\nUK / IND sizes; see the size guide on this page. Wrong size? Exchange it within 7 days, unworn.";

const PRODUCTS_BASE: DemoProduct[] = [
  // ---- formal shoes (leather uppers 6403)
  {
    name: "Men's leather Oxford, black",
    category: FORMAL_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-OXB",
    photo: 15557045,
    tags: ["office", "leather", "handmade", "bestseller"],
    description: `The office classic: a closed-lacing Oxford with a plain toe and a subtle punched cap, on a stitched leather-look rubber sole that grips on wet marble floors.${AMBUR}${FIT} Also in a wide (E) fitting.`,
    attributes: { Upper: "Full-grain leather", Lining: "Leather", Sole: "Stitched rubber", Closure: "Lace-up", Occasion: "Office, weddings" },
    ...grid(["Size", MEN], WIDTHS, 2_450, 2_599, widthStock),
  },
  {
    name: "Men's brogue Oxford, tan",
    category: FORMAL_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-OXT",
    photo: 6261862,
    tags: ["office", "leather", "handmade"],
    description: `A full brogue in burnished tan: wingtip toe, punched edges and a hand-antiqued finish that darkens with every polish. Smart with navy and grey trousers.${AMBUR}${FIT}`,
    attributes: { Upper: "Full-grain leather, burnished", Lining: "Leather", Sole: "Rubber", Closure: "Lace-up", Occasion: "Office" },
    ...sized(MEN, 2_390, 2_490),
  },
  {
    name: "Men's Goodyear-welted wingtip, dark brown",
    category: FORMAL_CAT,
    hsn: "6403",
    gstRate: 18,
    unit: "pair",
    sku: "PF-GWW",
    photo: 15059775,
    tags: ["office", "leather", "handmade"],
    description: `Our best pair: a Goodyear-welted wingtip with a leather-and-rubber sole that a cobbler can resole for years. 210 steps over three days in an Ambur workshop, in a dark chocolate calf that polishes to a deep shine.${AMBUR}${FIT} Also in a wide (E) fitting.`,
    attributes: { Upper: "Calf leather", Construction: "Goodyear welted", Sole: "Leather with rubber insert", Closure: "Lace-up", Occasion: "Office, weddings" },
    ...grid(["Size", MEN], WIDTHS, 5_450, 5_950, (s, w) => Math.max(1, widthStock(s, w) - 2)),
  },
  {
    name: "Men's leather Derby, brown",
    category: FORMAL_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-DRB",
    photo: 15059774,
    tags: ["office", "leather"],
    description: `An open-laced Derby that suits a higher instep and a long day on your feet: soft milled leather, a padded collar and a light, flexible sole. The pair we fit most for bank and college staff.${FIT}`,
    attributes: { Upper: "Milled leather", Lining: "Fabric and leather", Sole: "Flexible TPR", Closure: "Lace-up", Occasion: "Office, daily" },
    ...sized(MEN, 1_990, 2_190),
  },
  {
    name: "Men's lightweight formal slip-on, black",
    category: FORMAL_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-SLB",
    photo: 37465528,
    tags: ["office", "bestseller"],
    description: `A polished synthetic slip-on for everyday office wear: water-resistant, wipe-clean, 280 g a shoe, with elastic gussets so it slips on without laces. Good for rainy Vellore Julys.${FIT}`,
    attributes: { Upper: "Synthetic leather", Lining: "Fabric", Sole: "PU", Closure: "Slip-on", Occasion: "Office, daily" },
    ...sized(MEN, 999, 1_199),
  },
  {
    name: "Men's wingtip Derby on a commando sole, cognac",
    category: FORMAL_CAT,
    hsn: "6403",
    gstRate: 18,
    unit: "pair",
    sku: "PF-WCD",
    photo: 6764994,
    tags: ["office", "leather", "handmade"],
    description: `A chunky wingtip Derby in cognac leather on a lug (commando) sole: formal at the top, all-weather underneath. Wear it to the office in the monsoon and to dinner after.${AMBUR}${FIT}`,
    attributes: { Upper: "Full-grain leather", Lining: "Leather", Sole: "Commando rubber", Closure: "Lace-up", Occasion: "Office, smart casual" },
    ...sized(MEN, 3_950, 3_950),
  },

  // ---- men's casual
  {
    name: "Men's penny loafer, brown",
    category: MEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-PLB",
    photo: 8394709,
    tags: ["office", "leather", "bestseller"],
    description: `Soft moccasin-construction penny loafer in embossed brown leather, with a flexible bead sole for driving and long walks. Slips on, goes with chinos and kurtas alike.${FIT}`,
    attributes: { Upper: "Embossed leather", Lining: "Leather", Sole: "Rubber beads", Closure: "Slip-on", Occasion: "Smart casual" },
    ...sized(MEN, 2_290, 2_490),
  },
  {
    name: "Men's hand-stitched loafer, tan with white sole",
    category: MEN_CAT,
    hsn: "6403",
    gstRate: 18,
    unit: "pair",
    sku: "PF-HSL",
    photo: 25381178,
    tags: ["leather", "handmade"],
    description: `Hand-stitched apron toe, a saddle strap and a white cupsole: a loafer that walks like a sneaker. The tan leather is hand-finished, so every pair shades a little differently.${AMBUR}${FIT}`,
    attributes: { Upper: "Full-grain leather", Lining: "Leather", Sole: "Rubber cupsole", Closure: "Slip-on", Occasion: "Smart casual" },
    ...sized(MEN, 3_290, 3_490),
  },
  {
    name: "Men's boat shoes, rust",
    category: MEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-BTR",
    photo: 7887198,
    tags: ["leather"],
    description: `Rust-orange leather boat shoes with 360° rawhide laces and a white siped sole that doesn't slip on wet decks or tiles. Barefoot-comfortable for weekends and beach trips to Mahabalipuram.${FIT}`,
    attributes: { Upper: "Oiled leather", Lining: "Leather", Sole: "Siped rubber", Closure: "Rawhide laces", Occasion: "Casual" },
    ...sized(MEN, 1_890, 2_090),
  },
  {
    name: "Men's leather sneakers, brown",
    category: MEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-LSB",
    photo: 6961151,
    tags: ["leather", "casual", "new"],
    description: `Minimal low-top sneakers in burnished brown leather on a stitched white cupsole: smart enough for a casual Friday, easy enough for the weekend.${FIT}`,
    attributes: { Upper: "Burnished leather", Lining: "Leather", Sole: "Stitched rubber cupsole", Closure: "Lace-up", Occasion: "Smart casual" },
    ...sized(MEN, 2_190, 2_390),
  },
  {
    name: "Men's perforated leather Derby, dark brown",
    category: MEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-PDD",
    photo: 9992898,
    tags: ["leather", "office"],
    description: `A soft, perforated leather Derby on a light, cushioned sole: airy in the Vellore heat, comfortable from the first day.${FIT}`,
    attributes: { Upper: "Perforated leather", Lining: "Leather", Sole: "Lightweight TPR", Closure: "Lace-up", Occasion: "Office, smart casual" },
    ...sized(MEN, 1_790, 1_990),
  },
  {
    name: "Canvas sneakers, black",
    category: MEN_CAT,
    hsn: "6404",
    gstRate: 5,
    unit: "pair",
    sku: "PF-CVB",
    photo: 19845610,
    tags: ["casual", "bestseller"],
    description: `Black canvas low-tops with a white vulcanised sole and toe cap: the pair every college bag needs. Unisex sizes UK 4–10; machine-washable on a gentle cycle.${FIT}`,
    attributes: { Upper: "Cotton canvas", Lining: "Cotton", Sole: "Vulcanised rubber", Closure: "Lace-up", Occasion: "Casual, college" },
    ...sized(UNISEX, 799, 899),
  },
  {
    name: "Retro court sneakers",
    category: MEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-RCS",
    photo: 31451018,
    tags: ["casual", "new"],
    description: `A 70s-style court sneaker in suede and leather with a gum sole, in three colours. Light, flat and easy to wear all day.${FIT}`,
    attributes: { Upper: "Suede and leather", Lining: "Fabric", Sole: "Gum rubber", Closure: "Lace-up", Occasion: "Casual" },
    ...grid(["Colour", ["Maroon", "Olive", "White & grey"]], ["Size", MEN], 1_690, 1_890, (c, s) => (s === "UK 8" || s === "UK 9" ? 4 : c === "Maroon" ? 3 : 2)),
  },

  // ---- women
  {
    name: "Women's block-heel mule, white",
    category: WOMEN_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WBM",
    photo: 27046150,
    tags: ["women", "new", "bestseller"],
    description: `A broad white strap with a croc-texture panel on a 6 cm stacked block heel: steady enough for a whole wedding reception. Padded footbed.${FIT}`,
    attributes: { Upper: "Synthetic leather", Heel: "6 cm block", Sole: "TPR", Closure: "Slip-on", Occasion: "Party, office" },
    ...sized(WOMEN, 1_790, 1_990),
  },
  {
    name: "Women's wedge sandal, black",
    category: WOMEN_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WWS",
    photo: 26925263,
    tags: ["women", "office"],
    description: `A 7 cm wedge with an ankle strap and a cushioned, non-slip sole: height without the wobble. Goes with sarees and trousers.${FIT}`,
    attributes: { Upper: "Synthetic leather", Heel: "7 cm wedge", Sole: "EVA", Closure: "Buckled ankle strap", Occasion: "Office, party" },
    ...sized(WOMEN, 1_590, 1_790),
  },
  {
    name: "Women's leather flat sandal, tan",
    category: WOMEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WFS",
    photo: 26965808,
    tags: ["women", "leather", "bestseller"],
    description: `Vegetable-tanned tan leather with a T-strap and an adjustable buckle on a thin, flexible sole. Softens and moulds to your foot within a week.${FIT}`,
    attributes: { Upper: "Vegetable-tanned leather", Sole: "Rubber", Closure: "Buckle", Occasion: "Daily" },
    ...sized(WOMEN, 990, 1_190),
  },
  {
    name: "Women's suede slide",
    category: WOMEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WSS",
    photo: 27204307,
    tags: ["women"],
    description: `A clean single-band slide in soft suede on a low stacked heel. Pop of colour for plain kurtas.${FIT}`,
    attributes: { Upper: "Suede", Heel: "1.5 cm", Sole: "TPR", Closure: "Slip-on", Occasion: "Daily, casual" },
    ...grid(["Colour", ["Magenta", "Black"]], ["Size", WOMEN], 790, 899, (c, s) => (s === "UK 5" || s === "UK 6" ? 5 : c === "Black" ? 3 : 2)),
  },
  {
    name: "Women's cut-work heeled mule, rose",
    category: WOMEN_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WCM",
    photo: 21555668,
    tags: ["women", "festive"],
    description: `Laser cut-work in a rose shimmer on a 5 cm block heel with a padded footbed. Made for festival evenings and family functions.${FIT}`,
    attributes: { Upper: "Synthetic, laser cut", Heel: "5 cm block", Sole: "TPR", Closure: "Slip-on", Occasion: "Festive" },
    ...sized(WOMEN, 1_190, 1_390),
  },
  {
    name: "Women's leather Mary-Jane flats, tan",
    category: WOMEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WMJ",
    photo: 36589770,
    tags: ["women", "leather", "office"],
    description: `Square-toe Mary-Janes in smooth tan leather with a buckled strap and a 2 cm heel: office-smart, walk-all-day comfortable.${FIT}`,
    attributes: { Upper: "Leather", Heel: "2 cm", Sole: "Rubber", Closure: "Buckled strap", Occasion: "Office" },
    ...sized(WOMEN, 1_390, 1_590),
  },
  {
    name: "Women's criss-cross ballet flats, camel",
    category: WOMEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WBF",
    photo: 37853534,
    tags: ["women", "office", "new"],
    description: `Soft camel leather ballet flats with criss-cross elastic straps that keep them on when you hurry for the bus. Fold-flat sole.${FIT}`,
    attributes: { Upper: "Leather", Sole: "Flexible rubber", Closure: "Elastic straps", Occasion: "Office, daily" },
    ...sized(WOMEN, 1_290, 1_390),
  },
  {
    name: "Women's embroidered juttis",
    category: WOMEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WJT",
    photo: 31464539,
    tags: ["women", "festive", "handmade"],
    description: `Hand-embroidered leather juttis with thread and bead work, padded inside so they don't bite. Run snug for the first few wears: take your usual size and they stretch.${FIT}`,
    attributes: { Upper: "Leather with embroidery", Sole: "Leather", Closure: "Slip-on", Occasion: "Festive, weddings" },
    ...grid(["Colour", ["Gold", "Pink", "Blue"]], ["Size", WOMEN], 1_190, 1_290, (c, s) => (s === "UK 5" || s === "UK 6" ? 4 : c === "Gold" ? 3 : 2)),
  },
  {
    name: "Women's ankle-wrap stiletto, chestnut",
    category: WOMEN_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WAS",
    photo: 31450733,
    tags: ["women", "festive", "new"],
    description: `A 9 cm stiletto with a wrap-around ankle strap and a toe loop in chestnut leather: the reception pair.${FIT}`,
    attributes: { Upper: "Leather", Heel: "9 cm stiletto", Sole: "Leather-look", Closure: "Ankle wrap with buckle", Occasion: "Party" },
    ...sized(WOMEN, 2_350, 2_590),
  },
  {
    name: "Women's woven leather mule, handmade",
    category: WOMEN_CAT,
    hsn: "6403",
    gstRate: 18,
    unit: "pair",
    sku: "PF-WWM",
    photo: 27100549,
    tags: ["women", "leather", "handmade"],
    description: `Strips of hand-woven brown leather over a 5 cm stacked heel, made by one craftsman in Pernambut from start to finish. Leather insole that breathes in May.${FIT}`,
    attributes: { Upper: "Hand-woven leather", Heel: "5 cm stacked", Sole: "Leather and rubber", Closure: "Slip-on", Occasion: "Office, festive" },
    ...sized(WOMEN, 3_250, 3_450),
  },
  {
    name: "Women's platform sneakers, cream",
    category: WOMEN_CAT,
    hsn: "6404",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WPS",
    photo: 27516985,
    tags: ["women", "casual", "new"],
    description: `Cream perforated sneakers on a 3.5 cm gum platform with mustard laces: everyday height, sneaker comfort.${FIT}`,
    attributes: { Upper: "Synthetic, perforated", Sole: "Gum-coloured rubber platform", Closure: "Lace-up", Occasion: "Casual, college" },
    ...sized(WOMEN, 1_590, 1_790),
  },

  // ---- sandals & chappals
  {
    name: "Women's embroidered kolhapuri flats",
    category: SANDALS_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-WKF",
    photo: 38150374,
    tags: ["women", "festive", "handmade"],
    description: `Kolhapuri-style flats with a toe ring and colourful thread embroidery on the strap, on a soft vegetable-tanned sole.${FIT}`,
    attributes: { Upper: "Leather with embroidery", Sole: "Vegetable-tanned leather", Closure: "Toe ring, slip-on", Occasion: "Festive, daily" },
    ...sized(WOMEN, 890, 990),
  },
  {
    name: "Men's kolhapuri chappal, handmade",
    category: SANDALS_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-MKC",
    photo: 37644394,
    tags: ["leather", "handmade", "bestseller"],
    description: `The traditional open chappal with a toe loop and cut-work straps, stitched by hand in vegetable-tanned leather. Stiff for a week, then yours for years; for veshtis, kurtas and temple visits.${FIT}`,
    attributes: { Upper: "Vegetable-tanned leather", Sole: "Leather", Closure: "Toe loop, slip-on", Occasion: "Ethnic, daily" },
    ...sized(MEN, 1_150, 1_290),
  },
  {
    name: "Men's strappy leather sandal, black",
    category: SANDALS_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-MSS",
    photo: 31129840,
    tags: ["leather"],
    description: `Three straps and a back strap with velcro adjust, in black leather on a cushioned rubber sole. The sandal to wear to the office on Fridays.${FIT}`,
    attributes: { Upper: "Leather", Sole: "Cushioned rubber", Closure: "Velcro back strap", Occasion: "Daily, office" },
    ...sized(MEN, 1_490, 1_690),
  },
  {
    name: "Double-buckle cork slide, tan",
    category: SANDALS_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-DBS",
    photo: 30979788,
    tags: ["leather", "casual", "new"],
    description: `Two adjustable buckled straps over a contoured cork-and-latex footbed that shapes to your foot. Unisex sizes UK 4–10.${FIT}`,
    attributes: { Upper: "Oiled leather", Footbed: "Cork and latex", Sole: "EVA", Closure: "Buckles", Occasion: "Casual" },
    ...sized(UNISEX, 1_290, 1_490),
  },
  {
    name: "Men's toe-post leather chappal, olive",
    category: SANDALS_CAT,
    hsn: "6403",
    gstRate: 5,
    unit: "pair",
    sku: "PF-MTC",
    photo: 26925256,
    tags: ["leather"],
    description: `Wide olive and cream leather straps with a toe post on a stitched leather footbed. Cool and simple for every day.${FIT}`,
    attributes: { Upper: "Leather", Sole: "Rubber", Closure: "Toe post", Occasion: "Daily" },
    ...sized(MEN, 1_090, 1_190),
  },
  {
    name: "Rubber flip-flops",
    category: SANDALS_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-RFF",
    photo: 1756086,
    tags: ["casual", "bestseller"],
    description: "Soft natural-rubber flip-flops with a contrast strap: for the bathroom, the beach and the walk to the shop. Unisex sizes; won't smell after the rains.",
    attributes: { Upper: "Rubber strap", Sole: "Natural rubber", Closure: "Toe post", Occasion: "Home, beach" },
    ...grid(["Colour", ["Blue", "Black", "Red"]], ["Size", UNISEX], 249, 299, () => 10),
  },
  {
    name: "Soft home slippers, mustard",
    category: SANDALS_CAT,
    hsn: "6404",
    gstRate: 5,
    unit: "pair",
    sku: "PF-HSM",
    photo: 6862854,
    tags: ["casual"],
    description: "Criss-cross padded fabric slippers with a memory-foam footbed and a quiet rubber sole for marble and tiled floors at home.",
    attributes: { Upper: "Padded fabric", Footbed: "Memory foam", Sole: "Rubber", Closure: "Slip-on", Occasion: "Home" },
    ...one("Size", [
      ["UK 4–5", 399, 449, 10],
      ["UK 6–7", 399, 449, 14],
      ["UK 8–9", 399, 449, 12],
      ["UK 10–11", 399, 449, 6],
    ]),
  },

  // ---- sports (textile uppers 6404)
  {
    name: "Running shoes, red",
    category: SPORTS_CAT,
    hsn: "6404",
    gstRate: 5,
    unit: "pair",
    sku: "PF-RRD",
    photo: 12932260,
    tags: ["running", "new", "bestseller"],
    description: `A daily trainer with an engineered-mesh upper, a firm heel counter and a thick EVA midsole for 5–10 km runs on Vellore's roads and the Fort moat path. Unisex sizes UK 4–10.${FIT}`,
    attributes: { Upper: "Engineered mesh", Midsole: "EVA", Sole: "Rubber", Drop: "10 mm", Weight: "270 g (UK 8)", Occasion: "Running, gym" },
    ...sized(UNISEX, 2_190, 2_490),
  },
  {
    name: "Mesh walking shoes, grey",
    category: SPORTS_CAT,
    hsn: "6404",
    gstRate: 5,
    unit: "pair",
    sku: "PF-MWG",
    photo: 5526492,
    tags: ["running", "bestseller"],
    description: `Breathable grey mesh with a soft collar and a wide, stable sole for morning walks, doctor-advised daily steps and long standing hours. Our most-asked-for pair for parents.${FIT}`,
    attributes: { Upper: "Mesh", Midsole: "Phylon", Sole: "Rubber", Closure: "Lace-up", Occasion: "Walking, daily" },
    ...sized(MEN, 1_490, 1_690),
  },
  {
    name: "Knit slip-on trainers, aqua",
    category: SPORTS_CAT,
    hsn: "6404",
    gstRate: 5,
    unit: "pair",
    sku: "PF-KTA",
    photo: 38154572,
    tags: ["running", "women", "new"],
    description: `A sock-like knit upper with a pull tab and laces you can leave tied, on a light foam sole. Gym, yoga class and errands.${FIT}`,
    attributes: { Upper: "Knit", Midsole: "EVA foam", Sole: "Rubber pods", Closure: "Slip-on with laces", Occasion: "Gym, walking" },
    ...sized(WOMEN, 1_790, 1_990),
  },
  {
    name: "Badminton court shoes, non-marking",
    category: SPORTS_CAT,
    hsn: "6404",
    gstRate: 5,
    unit: "pair",
    sku: "PF-BCS",
    photo: 29699313,
    tags: ["running"],
    description: `Low-profile court shoes with a gum non-marking sole, lateral support for quick side steps and a reinforced toe drag. For badminton, table tennis and indoor courts.${FIT}`,
    attributes: { Upper: "Mesh with TPU overlays", Sole: "Non-marking gum rubber", Closure: "Lace-up", Occasion: "Badminton, indoor courts" },
    ...sized(UNISEX, 2_450, 2_590),
  },
  {
    name: "Cushioned knit running shoes, mint",
    category: SPORTS_CAT,
    hsn: "6404",
    gstRate: 18,
    unit: "pair",
    sku: "PF-CKR",
    photo: 9207813,
    tags: ["running"],
    description: `Our long-run shoe: a breathable knit upper over a thick, bouncy foam midsole with a rocker toe, for half-marathon training and runners with heavy heel strikes.${FIT}`,
    attributes: { Upper: "Engineered knit", Midsole: "Supercritical foam", Sole: "Rubber", Drop: "8 mm", Weight: "250 g (UK 8)", Occasion: "Running" },
    ...sized(UNISEX, 2_990, 3_290),
  },

  // ---- kids
  {
    name: "Kids' velcro sneakers, navy",
    category: KIDS_CAT,
    hsn: "6404",
    gstRate: 5,
    unit: "pair",
    sku: "PF-KVS",
    photo: 37117672,
    tags: ["kids", "bestseller"],
    description: `Two velcro straps so little ones can put them on themselves, a padded collar, a toe bumper for football in the yard and a flexible sole.${FIT}`,
    attributes: { Upper: "Mesh and synthetic", Sole: "Flexible rubber", Closure: "Velcro", Occasion: "Play, school days" },
    ...sized(KIDS, 790, 899),
  },
  {
    name: "Girls' strap sandals, white",
    category: KIDS_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-GSS",
    photo: 8084238,
    tags: ["kids"],
    description: `Wide soft straps with a velcro ankle strap on a lightweight EVA sole: comfortable for summer holidays and splashing about.${FIT}`,
    attributes: { Upper: "Soft PU", Sole: "EVA", Closure: "Velcro", Occasion: "Play, holidays" },
    ...sized(KIDS, 549, 599),
  },
  {
    name: "Kids' clogs, pink",
    category: KIDS_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-KCP",
    photo: 37305529,
    tags: ["kids"],
    description: "Light foam clogs with a heel strap and fun charms, washable under the tap. For the park, the beach and rainy days.",
    attributes: { Upper: "EVA foam", Sole: "EVA", Closure: "Heel strap", Occasion: "Play, rain" },
    ...sized(KIDS, 449, 499),
  },
  {
    name: "Baby first-walker shoes, yellow",
    category: KIDS_CAT,
    hsn: "6404",
    gstRate: 5,
    unit: "pair",
    sku: "PF-BFW",
    photo: 35753260,
    tags: ["kids", "new"],
    description: "Soft-soled first walkers with a bunny face, a wide toe box and a non-slip suede-feel sole that lets tiny feet feel the floor. Sized by age.",
    attributes: { Upper: "Soft fabric", Sole: "Non-slip suede-feel", Closure: "Laces and elastic", Occasion: "First steps" },
    ...one("Age", [
      ["6–12 months", 599, 649, 6],
      ["12–18 months", 599, 649, 8],
      ["18–24 months", 599, 649, 5],
    ]),
  },

  // ---- school shoes
  {
    name: "Boys' black school shoes, lace-up",
    category: SCHOOL_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-BSL",
    photo: 32228032,
    tags: ["kids", "school", "bestseller"],
    description: `Regulation black school shoes with a toe guard, a padded collar and a non-marking PU sole that lasts a full school year of football at break. Wipe clean; polish with black cream.${FIT}`,
    attributes: { Upper: "Synthetic leather", Sole: "Non-marking PU", Closure: "Lace-up", Occasion: "School" },
    ...sized(SCHOOL, 690, 749),
  },
  {
    name: "Girls' black school shoes, bow strap",
    category: SCHOOL_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-GSB",
    photo: 39256094,
    tags: ["kids", "school", "bestseller"],
    description: `Black school shoes with a velcro bar strap and a small bow, a cushioned insole and a grippy sole for wet corridors.${FIT}`,
    attributes: { Upper: "Synthetic leather", Sole: "TPR", Closure: "Velcro strap", Occasion: "School" },
    ...sized(SCHOOL, 650, 699),
  },
  {
    name: "Girls' patent Mary-Jane school shoes",
    category: SCHOOL_CAT,
    hsn: "6402",
    gstRate: 5,
    unit: "pair",
    sku: "PF-GPM",
    photo: 10485371,
    tags: ["kids", "school"],
    description: `Glossy patent black Mary-Janes with a buckled strap for uniforms with skirts and pinafores. Shine comes back with a damp cloth.${FIT}`,
    attributes: { Upper: "Patent synthetic", Sole: "TPR", Closure: "Buckled strap", Occasion: "School, functions" },
    ...sized(SCHOOL, 590, 649),
  },

  // ---- care and socks
  {
    name: "Shoe cream polish with applicator",
    category: CARE_CAT,
    hsn: "3405",
    gstRate: 18,
    unit: "pcs",
    sku: "PF-SCP",
    photo: 8899943,
    tags: ["care", "office", "bestseller"],
    description: "A wax-and-cream polish that feeds the leather and buffs to a shine, with a sponge applicator in the cap. 50 ml does about 40 polishes.",
    attributes: { Volume: "50 ml", Use: "Smooth leather" },
    ...one("Colour", [
      ["Black", 249, 249, 30],
      ["Brown", 249, 249, 20],
      ["Neutral", 249, 249, 15],
    ]),
  },
  {
    name: "Horsehair shoe brush set",
    category: CARE_CAT,
    hsn: "9603",
    gstRate: 18,
    unit: "set",
    sku: "PF-HBS",
    photo: 27243721,
    tags: ["care"],
    description: "Two wooden-backed horsehair brushes: a dauber to work the cream in and a buffer for the shine. Use one per colour so black never ends up on tan.",
    attributes: { Material: "Beech wood, horsehair", Pieces: "2" },
    ...single(299, 349, 18),
  },
  {
    name: "Striped cotton ankle socks, pack of 3",
    category: CARE_CAT,
    hsn: "6115",
    gstRate: 5,
    unit: "pack",
    sku: "PF-SAS",
    photo: 10563910,
    tags: ["care", "casual"],
    description: "Combed-cotton ankle socks in bright stripes with a cushioned sole and a stay-up cuff. Free size (UK 5–10).",
    attributes: { Material: "80% combed cotton, 18% nylon, 2% elastane", Size: "Free size (UK 5–10)", Pieces: "3 pairs" },
    ...single(299, 349, 30),
  },
  {
    name: "Office socks, pack of 3",
    category: CARE_CAT,
    hsn: "6115",
    gstRate: 5,
    unit: "pack",
    sku: "PF-OSP",
    photo: 19882187,
    tags: ["care", "office"],
    description: "Mid-calf cotton socks in black, brown and navy that stay up through the day and don't slip into the shoe. Free size (UK 6–11).",
    attributes: { Material: "Mercerised cotton with elastane", Size: "Free size (UK 6–11)", Pieces: "3 pairs" },
    ...single(349, 399, 25),
  },
];

/** Everything at ₹999 or less (every variant) also goes on the "Under ₹999" shelf. */
const PRODUCTS: DemoProduct[] = PRODUCTS_BASE.map((p) => (p.variants.every((v) => v.price <= rs(999)) ? { ...p, tags: [...(p.tags ?? []), "under-999"] } : p));

/** Pexels photos used by the store (credited on /pages/photo-credits). */
const PHOTOS: DemoStore["photos"] = {
  15557045: { by: "Ali Pli", alt: "Black leather Oxford shoes" },
  6261862: { by: "Mike Tyler", alt: "Tan brogue Oxford shoes" },
  15059775: { by: "Collab Media", alt: "Dark brown wingtip shoes" },
  15059774: { by: "Collab Media", alt: "Brown leather Derby shoes" },
  37465528: { by: "Lee Hanson", alt: "Black formal slip-on shoes" },
  6764994: { by: "Tima Miroshnichenko", alt: "Cognac wingtip Derby on a stand" },
  8394709: { by: "Jovie Pujadas Ladura", alt: "Brown leather penny loafers" },
  25381178: { by: "Márcio Carvalho", alt: "Tan loafers with white soles" },
  7887198: { by: "RENDAN CATIPAY", alt: "Rust leather boat shoes" },
  6961151: { by: "Efrem Efre", alt: "Brown leather sneakers with white soles" },
  9992898: { by: "Elnur Memmednebiyev", alt: "Dark brown perforated leather Derby shoes" },
  19845610: { by: "ALOK DAS", alt: "Black canvas sneakers held in a hand" },
  31451018: { by: "pedro furtado", alt: "Maroon, white and olive retro sneakers" },
  27046150: { by: "José Martin Segura Benites", alt: "White block-heel mule" },
  26925263: { by: "José Martin Segura Benites", alt: "Black wedge sandals" },
  26965808: { by: "José Martin Segura Benites", alt: "Tan leather flat sandals" },
  27204307: { by: "José Martin Segura Benites", alt: "Magenta suede slides" },
  21555668: { by: "Sabir Khan Shourov", alt: "Rose cut-work heeled mules on grass" },
  36589770: { by: "Valentin Ivantsov", alt: "Tan leather Mary-Jane flats" },
  37853534: { by: "Muhammad Khawar Nazir", alt: "Camel ballet flats with criss-cross straps" },
  31464539: { by: "Walid Ahmad", alt: "Rows of embroidered juttis" },
  31450733: { by: "pedro furtado", alt: "Chestnut ankle-wrap stiletto" },
  27100549: { by: "José Martin Segura Benites", alt: "Woven brown leather mule" },
  27516985: { by: "José Martin Segura Benites", alt: "Cream platform sneakers with mustard laces" },
  38150374: { by: "Portraits By PB", alt: "Embroidered kolhapuri flats" },
  37644394: { by: "Rubenstein Rebello", alt: "Brown kolhapuri chappals" },
  31129840: { by: "Eugenia Remark", alt: "Black strappy leather sandals" },
  30979788: { by: "Karen Laårk Boshoff", alt: "Tan double-buckle cork slides" },
  26925256: { by: "José Martin Segura Benites", alt: "Olive and cream toe-post chappals" },
  1756086: { by: "João Vítor Heinrichs", alt: "Blue flip-flops on sand" },
  6862854: { by: "cottonbro studio", alt: "Mustard criss-cross home slippers" },
  12932260: { by: "Atlantic Ambience", alt: "Tying red running shoes on a pathway" },
  8455978: { by: "Mikhail Nilov", alt: "Runner in black shoes crouched on a red track" },
  5526492: { by: "Akanksha Jain", alt: "Grey mesh walking shoes" },
  38154572: { by: "Makrufin Muhammad", alt: "Aqua knit trainers being laced" },
  29699313: { by: "ALOK DAS", alt: "Court shoes with a badminton racket" },
  9207813: { by: "Minh Tri", alt: "Mint knit running shoes" },
  37117672: { by: "Gizem Gökce", alt: "Child in navy velcro sneakers" },
  8084238: { by: "Anastasia Shuraeva", alt: "White children's strap sandals" },
  37305529: { by: "ALOK DAS", alt: "Pink children's clogs" },
  35753260: { by: "Shailendra Dhakal", alt: "Yellow baby first-walker shoes" },
  32228032: { by: "hung chou", alt: "Black lace-up school shoes" },
  39256094: { by: "Lee Hanson", alt: "Black girls' school shoes with a bow" },
  10485371: { by: "cottonbro studio", alt: "Black patent Mary-Jane school shoes" },
  8899943: { by: "SHVETS production", alt: "Polishing a black leather loafer" },
  27243721: { by: "GoGoNano Official", alt: "Wooden shoe brushes with black shoes" },
  10563910: { by: "Jan van der Wolf", alt: "Striped cotton ankle socks" },
  19882187: { by: "Jonathan Borba", alt: "Putting on brown socks next to formal shoes" },
  // categories, home and pages
  28719728: { by: "Sekav Werna", alt: "Black brogues with a belt, watch and cufflinks" },
  27063075: { by: "José Martin Segura Benites", alt: "Women's heels and sandals on white blocks" },
  18745880: { by: "Mehmet Turgut Kirkgoz", alt: "Boy holding red shoes in a shoe shop" },
  10638087: { by: "Ron Lach", alt: "Schoolchildren in uniform and black school shoes" },
  8454901: { by: "Mikhail Nilov", alt: "Running shoe on a red track" },
  37387735: { by: "Miguel Cuenca", alt: "Rows of handmade kolhapuri chappals" },
  34279970: { by: "Tahir Xəlfəquliyev", alt: "Shelves of black formal shoes" },
  10895045: { by: "Ann H", alt: "Yellow measuring tape on blue" },
  34003822: { by: "Dmitry Alexandrovich", alt: "Stacked white sneakers" },
  7880203: { by: "MART PRODUCTION", alt: "Sneakers on a yoga mat with a water bottle" },
  14853534: { by: "Mehmet Turgut Kirkgoz", alt: "Wall of women's flats in many colours" },
  24374679: { by: "Tarun Kumar", alt: "Craftsman hammering a kolhapuri sole" },
  267177: { by: "Pixabay", alt: "Bare feet beside red lace-up shoes" },
  4427645: { by: "cottonbro studio", alt: "Cobbler at work at his bench" },
};

const HOURS = [
  { label: "Mon – Sat", value: "9:30 am – 9:30 pm" },
  { label: "Sunday", value: "10:00 am – 2:00 pm" },
];

const FAQ = [
  {
    q: "How do I find my size?",
    a: "Stand on a sheet of paper, mark your heel and longest toe, and measure the gap in **centimetres**; measure both feet in the evening and use the longer one. Then match the length on the size chart on every product page (Men / Women / Kids tabs). UK and Indian (IND) sizes are the same. Between two sizes? Take the bigger one in closed shoes and the smaller one in sandals with adjustable straps.",
  },
  {
    q: "What if the size is wrong?",
    a: "Exchange it within **7 days** for another size or colour, free: unworn, in the box, with the tag. At the shop we swap it on the spot; online we pick it up when we deliver the new pair. If the new pair costs less we refund the difference.",
  },
  {
    q: "How do I care for leather shoes?",
    a: "Wipe off dust after each wear, let them rest a day between wears, and keep a cedar shoe tree or newspaper inside. Cream-polish every two weeks with a matching colour, and never dry wet leather in the sun or near a heater: stuff it with newspaper and let it dry in the shade. In the monsoon, a coat of neutral wax keeps water out.",
  },
  { q: "Can I pay cash on delivery?", a: "Yes, anywhere in Tamil Nadu for orders up to ₹10,000 (₹40 COD fee outside Vellore district). UPI on delivery works too. Outside Tamil Nadu please pay online." },
  { q: "Do you have wide fittings?", a: "Our leather Oxford and the welted wingtip come in a **Wide (E)** fitting; sandals with buckles adjust. For other closed shoes with a wide foot, take half a size up or ask us on WhatsApp: we stretch leather shoes at the shop for free." },
  { q: "How fast is school-shoe delivery in June?", a: "Vellore, Katpadi and Ranipet: next day. Rest of Tamil Nadu: 2–3 days. Order two sizes if your child is between sizes: we take back the one that doesn't fit when we deliver." },
];

const FAQ_TA = [
  {
    q: "என் அளவை எப்படிக் கண்டறிவது?",
    a: "ஒரு தாளின் மேல் நின்று, குதிகாலையும் நீளமான விரலையும் குறித்து, இடைவெளியை **சென்டிமீட்டரில்** அளவிடுங்கள்; மாலையில் இரண்டு பாதங்களையும் அளந்து நீளமானதை எடுத்துக்கொள்ளுங்கள். பிறகு ஒவ்வொரு பொருள் பக்கத்திலும் உள்ள அளவு அட்டவணையில் (ஆண்கள் / பெண்கள் / குழந்தைகள்) அந்த நீளத்தைப் பாருங்கள். UK, இந்திய (IND) அளவுகள் ஒன்றே. இரண்டு அளவுகளுக்கு இடையிலா? மூடிய ஷூக்களில் பெரியதையும், பட்டை சரிசெய்யக்கூடிய சாண்டல்களில் சிறியதையும் எடுங்கள்.",
  },
  {
    q: "அளவு தவறினால்?",
    a: "**7 நாட்களுக்குள்** வேறு அளவு அல்லது நிறத்துக்கு இலவசமாக மாற்றலாம்: அணியாமல், பெட்டியுடன், அடையாளச் சீட்டுடன். கடையில் உடனே மாற்றுவோம்; ஆன்லைனில், புதிய ஜோடியைக் கொண்டு வரும்போதே பழையதை எடுத்துச் செல்வோம். புதிய ஜோடி விலை குறைவென்றால் வித்தியாசத்தைத் திருப்பித் தருவோம்.",
  },
  {
    q: "லெதர் ஷூக்களை எப்படிப் பராமரிப்பது?",
    a: "ஒவ்வொரு முறை அணிந்த பின் தூசியைத் துடையுங்கள், இரண்டு நாள் தொடர்ந்து அணியாமல் ஒரு நாள் ஓய்வு கொடுங்கள், உள்ளே ஷூ ட்ரீ அல்லது செய்தித்தாள் வையுங்கள். இரண்டு வாரத்துக்கு ஒருமுறை அதே நிற கிரீம் பாலிஷ் போடுங்கள். நனைந்த லெதரை வெயிலிலோ ஹீட்டர் அருகிலோ காய வைக்காதீர்கள்: செய்தித்தாள் அடைத்து நிழலில் காய விடுங்கள். மழைக்காலத்தில் நியூட்ரல் வேக்ஸ் ஒரு பூச்சு தண்ணீரைத் தடுக்கும்.",
  },
  { q: "டெலிவரியில் பணம் செலுத்தலாமா?", a: "ஆம், தமிழ்நாடு முழுவதும் ₹10,000 வரையிலான ஆர்டர்களுக்கு (வேலூர் மாவட்டத்துக்கு வெளியே ₹40 COD கட்டணம்). டெலிவரியின்போது UPI-யும் செலுத்தலாம். தமிழ்நாட்டுக்கு வெளியே ஆன்லைனில் செலுத்துங்கள்." },
  { q: "அகலமான பொருத்தம் உண்டா?", a: "எங்கள் லெதர் ஆக்ஸ்ஃபோர்டு, வெல்டெட் விங்டிப் இரண்டும் **அகலம் (E)** பொருத்தத்திலும் வருகின்றன; பக்கிள் சாண்டல்கள் சரிசெய்யக்கூடியவை. மற்ற மூடிய ஷூக்களுக்கு அகலமான பாதமென்றால் அரை அளவு பெரியதை எடுங்கள், அல்லது வாட்ஸ்அப்பில் கேளுங்கள்: கடையில் லெதர் ஷூக்களை இலவசமாக விரிவாக்குவோம்." },
  { q: "ஜூனில் பள்ளி ஷூ டெலிவரி எவ்வளவு விரைவில்?", a: "வேலூர், காட்பாடி, ராணிப்பேட்டை: மறுநாள். தமிழ்நாட்டின் பிற பகுதிகள்: 2–3 நாள். குழந்தை இரண்டு அளவுகளுக்கு இடையில் இருந்தால் இரண்டையும் ஆர்டர் செய்யுங்கள்: டெலிவரியின்போதே பொருந்தாததைத் திரும்ப எடுத்துக்கொள்வோம்." },
];

const SCHOOL_TEXT = "Hello Padham Footwear, I need school shoes. Child's age: … Foot length (cm): … School / colour: …";
const pic = (alt: string): Record<string, string> => ({ alt });
/** A stats item's words in Tamil (typed as plain words: items differ in shape, see docs/verticals.md step 4). */
const stat = (label: string, suffix?: string): Record<string, string> => (suffix ? { label, suffix } : { label });

/** A markdown size table: UK / IND · EU · US · foot (cm). Same numbers as the storefront's shoe chart. */
const table = (rows: [string, string, string, string][]) =>
  `| UK / IND | EU | US | Foot length (cm) |\n|---|---|---|---|\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`;
const MEN_TABLE = table([
  ["5", "38", "6", "23.7"],
  ["6", "39", "7", "24.6"],
  ["7", "40.5", "8", "25.4"],
  ["8", "42", "9", "26.2"],
  ["9", "43", "10", "27.1"],
  ["10", "44.5", "11", "27.9"],
  ["11", "46", "12", "28.8"],
  ["12", "47", "13", "29.6"],
]);
const WOMEN_TABLE = table([
  ["3", "35.5", "5", "22.0"],
  ["4", "37", "6", "22.9"],
  ["5", "38", "7", "23.7"],
  ["6", "39", "8", "24.6"],
  ["7", "40.5", "9", "25.4"],
  ["8", "42", "10", "26.2"],
  ["9", "43", "11", "27.1"],
]);
const KIDS_TABLE = table([
  ["8C", "25", "9C", "15.2"],
  ["9C", "27", "10C", "16.1"],
  ["10C", "28", "11C", "16.9"],
  ["11C", "29", "12C", "17.8"],
  ["12C", "30", "13C", "18.6"],
  ["13C", "32", "1Y", "19.5"],
  ["1", "33", "2Y", "20.3"],
  ["2", "34", "3Y", "21.2"],
  ["3", "35.5", "4Y", "22.0"],
]);

export const PADHAM: DemoStore = {
  shop: {
    slug: "padham",
    appId: "EC",
    businessType: "footwear",
    planId: "pro",
    name: "Padham Footwear",
    primary: "#2a3bd6",
    billing: {
      legalName: "Padham Footwear",
      gstin: "33AAQFP7531R1ZF",
      address: "22, Long Bazaar, opposite the Fort main gate",
      city: "Vellore",
      pincode: "632004",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "PF",
      upiId: "padhamfootwear@okicici",
    },
    // Repairs at the counter (repair of other goods, SAC 998729: 18%); rates are GST-exclusive.
    items: [
      { name: "Sole stitching / heel tip replacement", hsn: "998729", unit: "pair", rate: 16_949, gstRate: 18 },
      { name: "Leather shoe stretching", hsn: "998729", unit: "pair", rate: 8_475, gstRate: 18 },
    ],
  },
  preset: "stride",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 1_000_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "hello@padhamfootwear.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/padhamfootwear" },
    policies: {
      shipping:
        "**Vellore, Katpadi, Ranipet & Arcot (632xxx):** next day by our own delivery, free above ₹999, else ₹49.\n\n**Chennai and the rest of Tamil Nadu:** 2–3 days by courier, ₹79, free above ₹1,499.\n\n**Rest of India:** 3–6 days by courier, ₹129, free above ₹2,499. Every pair ships in its box inside a padded mailer.",
      returns:
        "Size or colour exchange within 7 days of delivery, free, for unworn pairs in the original box with the tag (we pick the old pair up when we deliver the new one). If a pair arrives damaged or not as described, send a photo on WhatsApp within 48 hours and we replace it or refund in full. Worn footwear, socks and polish can't be returned; manufacturing defects in leather shoes are covered for 3 months (sole separation, stitching).",
      privacy: "We use your details only to deliver your order, send your GST bill and, if you ask, keep your family's shoe sizes on file for next time.",
      terms:
        "Prices include GST: 5% on footwear up to ₹2,500 a pair, 18% above, and 18% on polish and brushes. Handmade leather varies a little in shade and grain from the pictures. School-shoe offers run 15 May – 30 June.",
    },
    businessType: "footwear",
  },
  zones: [
    {
      name: "Vellore district",
      pincodePrefixes: ["632"],
      rate: { name: "Next-day delivery", type: "free_above", amount: 4_900, freeAbove: 99_900, etaMinDays: 1, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–3 days)", type: "free_above", amount: 7_900, freeAbove: 149_900, etaMinDays: 2, etaMaxDays: 3, codAllowed: true, codFee: 4_000 },
    },
    {
      name: "Rest of India",
      states: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "26", "27", "29", "30", "31", "32", "34", "35", "36", "37", "38"],
      rate: { name: "Courier (3–6 days)", type: "free_above", amount: 12_900, freeAbove: 249_900, etaMinDays: 3, etaMaxDays: 6, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: MEN_CAT, description: "Loafers, boat shoes, chukkas and sneakers for men, in UK 6–11.", photo: 28719728 },
    { name: WOMEN_CAT, description: "Block heels, wedges, flats, juttis, stilettos and sneakers in UK 3–8.", photo: 27063075 },
    { name: KIDS_CAT, description: "Velcro sneakers, sandals, clogs and first walkers for little feet.", photo: 18745880 },
    { name: SCHOOL_CAT, description: "Regulation black school shoes for boys and girls, UK 11C to UK 5.", photo: 10638087 },
    { name: SPORTS_CAT, description: "Running, walking, gym and badminton court shoes.", photo: 8454901 },
    { name: SANDALS_CAT, description: "Kolhapuris, leather sandals, slides, flip-flops and home slippers.", photo: 37387735 },
    { name: FORMAL_CAT, description: "Ambur-made leather Oxfords, Derbies and wingtips, some in a wide fitting.", photo: 34279970 },
    { name: CARE_CAT, description: "Polish, brushes and socks to go with your shoes.", photo: 27243721 },
  ],
  // Apparel / footwear: GST by price band (5% up to ₹2,500 a piece, 18% above).
  products: withPriceBandGst(PRODUCTS),
  collections: [
    { name: "New arrivals", slug: "new-arrivals", description: "Fresh on the shelves this month.", rule: { sort: "new" } },
    { name: "Just landed", slug: "just-landed", description: "This season's new styles: runners, sneakers, heels and flats.", rule: { tag: "new", sort: "price-asc" } },
    { name: "Under ₹999", slug: "under-999", description: "Good shoes, sandals and essentials at ₹999 or less.", rule: { tag: "under-999", sort: "price-asc" } },
    { name: "The office edit", slug: "office-edit", description: "Oxfords, Derbies, loafers, flats and the socks and polish that go with them.", rule: { tag: "office", sort: "price-desc" } },
    { name: "School-shoe season", slug: "school-season", description: "Black school shoes for boys and girls, UK 11C to UK 5.", rule: { category: SCHOOL_CAT, sort: "price-asc" } },
    { name: "Run & train", slug: "running", description: "Running, walking, gym and court shoes.", rule: { tag: "running", sort: "price-asc" } },
    { name: "Handmade in Vellore district", slug: "handmade", description: "Leather shoes, mules, juttis and kolhapuris made by hand in Ambur and Pernambut workshops.", rule: { tag: "handmade", sort: "price-desc" } },
    { name: "Bestsellers", slug: "bestsellers", description: "The pairs Vellore keeps coming back for.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "Sandals & chappals", slug: "sandals", description: "Kolhapuris, leather sandals, slides and flip-flops.", rule: { category: SANDALS_CAT, sort: "price-asc" } },
    { name: "For kids", slug: "kids", description: "Sneakers, sandals, clogs and first walkers.", rule: { tag: "kids", sort: "price-asc" } },
    { name: "On offer", slug: "on-offer", description: "Pairs below their MRP right now.", rule: { onSale: true, sort: "price-asc" } },
  ],
  coupons: [
    {
      code: "SCHOOL10",
      description: "School season: 10% off orders above ₹1,199 (up to ₹300)",
      type: "percent",
      value: 10,
      minOrder: 119_900,
      maxDiscount: 30_000,
      channels: ["store", "manual"],
    },
    {
      code: "FIRSTSTEP",
      description: "₹100 off your first order above ₹999",
      type: "flat",
      value: 10_000,
      minOrder: 99_900,
      channels: ["store"],
    },
  ],
  home: ({ photo, category, product }) => {
    const shopBy = [MEN_CAT, WOMEN_CAT, KIDS_CAT, SPORTS_CAT, SCHOOL_CAT].map(category);
    return {
      seo: {
        title: "Padham Footwear, Vellore — shoes, sandals and school shoes",
        description: "Ambur-made leather shoes, running shoes, women's sandals and juttis, kids' and school shoes, chappals and care, with a shoe size chart, 7-day size exchange and COD across Tamil Nadu.",
        imageUrl: photo(8455978),
      },
      sections: [
        {
          type: "hero-split",
          id: "pd-hero",
          imageUrl: photo(8455978, "tile"),
          imageSide: "right",
          eyebrow: "Long Bazaar, Vellore · since 1979",
          heading: "Find your fit. Then run with it.",
          text: "Running shoes, Ambur-made leather, school shoes and sandals for the whole family, measured to the centimetre. Wrong size? Swap it within 7 days.",
          cta: { label: "Shop new arrivals", href: "/collections/just-landed" },
          cta2: { label: "Size guide", href: "/pages/size-guide" },
        },
        { type: "categories", id: "pd-shopby", title: "Shop by", categoryIds: shopBy, layout: "big-grid", columns: "5", showCounts: true },
        { type: "collection", id: "pd-new", title: "Just landed", collectionSlug: "just-landed", layout: "carousel", limit: 12 },
        {
          type: "offer",
          id: "pd-school",
          eyebrow: "School-shoe season · June",
          heading: "Back to school on the right foot",
          text: "Black school shoes from ₹590, UK 11C to UK 5, delivered next day in Vellore. 10% off orders above ₹1,199 (up to ₹300).",
          code: "SCHOOL10",
          cta: { label: "Shop school shoes", href: "/collections/school-season" },
          style: { background: "image", imageUrl: photo(10638087), overlay: 60, padding: "spacious" },
        },
        // Hidden until the school range has a full row (an owner shows it in the home editor in May).
        { type: "collection", id: "pd-school-shelf", hidden: true, title: "School shoes", collectionSlug: "school-season", layout: "grid", limit: 4 },
        {
          type: "shop-the-look",
          id: "pd-office",
          title: "The office edit",
          text: "Leather that works as hard as you do. Tap a pair to see it.",
          imageUrl: photo(34279970, "wide"),
          alt: "Shelves of black formal shoes",
          hotspots: [
            { x: 22, y: 26, productId: product("Men's leather Oxford, black") },
            { x: 52, y: 55, productId: product("Men's lightweight formal slip-on, black") },
            { x: 80, y: 86, productId: product("Men's Goodyear-welted wingtip, dark brown") },
          ],
        },
        { type: "collection", id: "pd-under999", title: "Under ₹999", collectionSlug: "under-999", layout: "grid", limit: 8 },
        {
          type: "size-finder",
          id: "pd-size",
          title: "Find your size",
          text: "Pick whose shoes and tap a size, or type your foot length in centimetres (heel to longest toe, measured in the evening) and we pick the size for you. UK and Indian sizes are the same.",
          imageUrl: photo(10895045, "tile"),
          optionName: "Size",
          footLength: true,
          groups: [
            { label: "Men", sizes: MEN },
            { label: "Women", sizes: WOMEN },
            { label: "Kids", sizes: [...KIDS, ...uk(1, 2, 3)] },
          ],
          style: { background: "muted" },
        },
        {
          type: "product-tabs",
          id: "pd-best",
          title: "Bestsellers",
          layout: "carousel",
          limit: 10,
          tabs: [
            { label: "Most bought", source: "collection", collectionSlug: "bestsellers" },
            { label: "Run & train", source: "collection", collectionSlug: "running" },
            { label: "Office", source: "collection", collectionSlug: "office-edit" },
            { label: "Sandals", source: "collection", collectionSlug: "sandals" },
            { label: "Kids", source: "collection", collectionSlug: "kids" },
          ],
        },
        {
          type: "stats",
          id: "pd-stats",
          title: "Fitting Vellore since 1979",
          items: [
            { value: 45, suffix: "+", label: "Years on Long Bazaar" },
            { value: 12, label: "Ambur & Pernambut workshops" },
            { value: 2400, suffix: "+", label: "School pairs fitted every June" },
            { value: 7, label: "Days to swap a size, free" },
          ],
          style: { background: "dark" },
        },
        {
          type: "testimonials",
          id: "pd-reviews",
          title: "On their feet",
          layout: "cards",
          items: [
            { quote: "Measured my son's feet on paper as they said, ordered UK 2, and the shoes came the next morning. He's on his second term and the toe guard is still there.", name: "Kavitha R.", role: "Parent, Katpadi", rating: 5 },
            { quote: "I have wide feet and never find formal shoes. The wide Oxford fit on the first try, and they stretched the left one a little for free.", name: "Senthil Kumar", role: "Bank officer, Vellore", rating: 5 },
            { quote: "Bought the red runners for my first 10 km in Chennai. Light, steady and no blisters. Exchanged a half size up without any fuss.", name: "Aishwarya M.", role: "Runner, Chennai", rating: 5 },
          ],
        },
        { type: "faq", id: "pd-faq", title: "Sizing, exchange, care and COD", items: FAQ },
        {
          type: "instagram",
          id: "pd-insta",
          title: "On the shelves this week",
          handle: "padhamfootwear",
          images: [
            { url: photo(34003822, "square"), alt: "Stacked white sneakers" },
            { url: photo(7880203, "square"), alt: "Sneakers on a yoga mat" },
            { url: photo(14853534, "square"), alt: "Wall of women's flats" },
            { url: photo(24374679, "square"), alt: "Craftsman hammering a kolhapuri sole" },
            { url: photo(267177, "square"), alt: "Bare feet beside red lace-up shoes" },
            { url: photo(4427645, "square"), alt: "Cobbler at work" },
          ],
        },
        {
          type: "newsletter",
          id: "pd-newsletter",
          layout: "inline",
          heading: "New drops and school-season offers",
          text: "One short note when new pairs land or the June school offers open. No spam.",
        },
        {
          type: "location",
          id: "pd-location",
          title: "Come and try them on",
          address: "22, Long Bazaar, opposite the Fort main gate, Vellore 632004",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "12.9209, 79.1316",
        },
      ],
      translations: {
        ta: {
          "pd-hero": {
            eyebrow: "லாங் பஜார், வேலூர் · 1979 முதல்",
            heading: "சரியான அளவு. பிறகு ஓடுங்கள்.",
            text: "ஓட்டக் காலணிகள், ஆம்பூர் லெதர், பள்ளி ஷூக்கள், சாண்டல்கள்: குடும்பம் முழுவதற்கும், சென்டிமீட்டர் வரை அளந்து. அளவு தவறா? 7 நாட்களுக்குள் மாற்றுங்கள்.",
            cta: { label: "புதிய வரவுகள்" },
            cta2: { label: "அளவு வழிகாட்டி" },
          },
          "pd-shopby": { title: "வகை வாரியாக" },
          "pd-new": { title: "புதிதாக வந்தவை" },
          "pd-school": {
            eyebrow: "பள்ளி ஷூ சீசன் · ஜூன்",
            heading: "சரியான காலணியுடன் பள்ளிக்கு",
            text: "₹590 முதல் கருப்புப் பள்ளி ஷூக்கள், UK 11C முதல் UK 5 வரை, வேலூரில் மறுநாள் டெலிவரி. ₹1,199-க்கு மேல் 10% தள்ளுபடி (₹300 வரை).",
            cta: { label: "பள்ளி ஷூக்கள்" },
          },
          "pd-school-shelf": { title: "பள்ளி ஷூக்கள்" },
          "pd-office": { title: "அலுவலகத் தேர்வு", text: "உங்களைப் போலவே உழைக்கும் லெதர். ஒரு ஜோடியைத் தொட்டுப் பாருங்கள்.", alt: "கருப்பு ஃபார்மல் ஷூக்கள் உள்ள அலமாரிகள்" },
          "pd-under999": { title: "₹999-க்குள்" },
          "pd-size": {
            title: "உங்கள் அளவைக் கண்டறியுங்கள்",
            text: "யாருக்கான ஷூ என்று தேர்ந்து ஒரு அளவைத் தொடுங்கள், அல்லது பாத நீளத்தைச் சென்டிமீட்டரில் (குதிகால் முதல் நீளமான விரல் வரை, மாலையில் அளந்தது) இடுங்கள்; அளவை நாங்கள் தேர்ந்தெடுப்போம். UK, இந்திய அளவுகள் ஒன்றே.",
            groups: [{ label: "ஆண்கள்" }, { label: "பெண்கள்" }, { label: "குழந்தைகள்" }],
          },
          "pd-best": { title: "அதிகம் விற்பவை", tabs: [{ label: "அதிகம் வாங்கியவை" }, { label: "ஓட்டம் & பயிற்சி" }, { label: "அலுவலகம்" }, { label: "சாண்டல்கள்" }, { label: "குழந்தைகள்" }] },
          "pd-stats": {
            title: "1979 முதல் வேலூருக்குப் பொருத்துகிறோம்",
            items: [stat("ஆண்டுகளாக லாங் பஜாரில்", "+"), stat("ஆம்பூர், பேர்ணாம்பட்டு பட்டறைகள்"), stat("ஒவ்வொரு ஜூனிலும் பள்ளி ஜோடிகள்", "+"), stat("நாட்களில் இலவச அளவு மாற்றம்")],
          },
          "pd-reviews": {
            title: "அவர்கள் கால்களில்",
            items: [
              { quote: "சொன்னபடி தாளில் மகனின் பாதத்தை அளந்து UK 2 ஆர்டர் செய்தேன்; மறுநாள் காலையே ஷூ வந்தது. இரண்டாம் பருவம் ஆகியும் டோ கார்டு அப்படியே இருக்கிறது.", role: "பெற்றோர், காட்பாடி" },
              { quote: "என் பாதம் அகலம், ஃபார்மல் ஷூ கிடைப்பதே இல்லை. அகல ஆக்ஸ்ஃபோர்டு முதல் முறையே பொருந்தியது; இடது ஷூவைச் சிறிது இலவசமாக விரிவாக்கியும் தந்தார்கள்.", role: "வங்கி அலுவலர், வேலூர்" },
              { quote: "சென்னையில் என் முதல் 10 கி.மீ ஓட்டத்துக்கு சிவப்பு ஷூ வாங்கினேன். லேசானது, உறுதியானது, கொப்புளம் இல்லை. அரை அளவு பெரியதற்குச் சிரமமின்றி மாற்றித் தந்தார்கள்.", role: "ஓட்டக்காரர், சென்னை" },
            ],
          },
          "pd-faq": { title: "அளவு, மாற்றம், பராமரிப்பு, COD", items: FAQ_TA },
          "pd-insta": {
            title: "இந்த வார அலமாரிகளில்",
            images: [pic("அடுக்கிய வெள்ளை ஸ்னீக்கர்கள்"), pic("யோகா விரிப்பின் மேல் ஸ்னீக்கர்கள்"), pic("பெண்களின் பல நிற ஃபிளாட்கள்"), pic("கோலாப்புரி அடிப்பகுதியைச் சுத்தியால் அடிக்கும் கைவினைஞர்"), pic("சிவப்பு ஷூக்களின் அருகே வெறும் பாதங்கள்"), pic("பணியில் செருப்புத் தைப்பவர்")],
          },
          "pd-newsletter": { heading: "புதிய வரவுகளும் பள்ளிச் சலுகைகளும்", text: "புதிய ஜோடிகள் வந்ததும் அல்லது ஜூன் பள்ளிச் சலுகைகள் தொடங்கியதும் ஒரு சிறு செய்தி. ஸ்பேம் இல்லை." },
          "pd-location": {
            title: "வந்து அணிந்து பாருங்கள்",
            address: "22, லாங் பஜார், கோட்டை முதன்மை வாயில் எதிரில், வேலூர் 632004",
            hours: [
              { label: "திங்கள் – சனி", value: "காலை 9:30 – இரவு 9:30" },
              { label: "ஞாயிறு", value: "காலை 10:00 – மதியம் 2:00" },
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
        { type: "heading", level: 2, text: "Padham Footwear, Long Bazaar, since 1979" },
        {
          type: "paragraph",
          markdown:
            "Padham (பாதம்) means the foot. Our grandfather started with a cobbler's bench and a glass case of Ambur chappals opposite the Fort main gate in **1979**. Vellore district makes more of India's leather shoes than anywhere else (Ambur, Pernambut, Vaniyambadi, Ranipet), so we have always bought straight from the workshops, and today **12 workshops** make our leather shoes, mules, juttis and kolhapuris.\n\nThe third generation added running shoes, school shoes and a foot-measuring board, and still fits every pair by hand. Repairs, resoling and stretching happen at the back of the shop.",
        },
        { type: "image", url: photo(4427645, "tile"), alt: "Cobbler at work at his bench" },
        { type: "paragraph", markdown: "Open Monday to Saturday 9:30 am – 9:30 pm, Sunday 10:00 am – 2:00 pm. Call or WhatsApp **+91 98765 00077**." },
      ],
    },
    {
      slug: "size-guide",
      title: "Shoe size guide",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Measure your foot" },
        {
          type: "paragraph",
          markdown:
            "1. Put a sheet of paper against a wall and stand on it, heel touching the wall.\n2. Mark the tip of your **longest toe** (not always the big toe).\n3. Measure from the wall to the mark in **centimetres**. Do both feet, in the evening when feet are largest, and use the longer one.\n4. Find that length below. UK and Indian (IND) sizes are the same scale.\n\nLeave about **1 cm** in front of the toes in closed shoes, **1.5 cm** for children who are still growing.",
        },
        { type: "image", url: photo(10895045, "tile"), alt: "Yellow measuring tape on blue" },
        { type: "heading", level: 2, text: "Men" },
        { type: "paragraph", markdown: MEN_TABLE },
        { type: "heading", level: 2, text: "Women" },
        { type: "paragraph", markdown: WOMEN_TABLE },
        { type: "heading", level: 2, text: "Kids" },
        { type: "paragraph", markdown: `${KIDS_TABLE}\n\n8C–10C fit about 3–5 years, 11C–13C about 5–8 years, 1–3 about 8–11 years. From UK 4 use the women's or men's chart.` },
        { type: "heading", level: 2, text: "Width and fit" },
        {
          type: "paragraph",
          markdown:
            "- **Wide feet:** the leather Oxford and the welted wingtip come in a **Wide (E)** fitting. In other closed shoes take half a size up; we stretch leather shoes at the shop for free.\n- **Juttis and kolhapuris** run snug and stretch with wear: take your usual size.\n- **Sandals with buckles** adjust: between sizes, take the smaller one.\n- **Running shoes:** a thumb's width in front of the toes; feet swell on long runs.\n- Wrong size? **Exchange within 7 days**, unworn, in the box.",
        },
        { type: "button", label: "Ask us on WhatsApp", href: waLink(SCHOOL_TEXT), style: "primary" },
      ],
    },
    {
      slug: "shoe-care",
      title: "Leather care",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Make your leather shoes last" },
        {
          type: "paragraph",
          markdown:
            "- **Rest them:** don't wear the same pair two days running; leather needs a day to dry out.\n- **Shoe trees:** cedar trees (or rolled newspaper) keep the shape and pull out moisture.\n- **Clean, then cream:** brush off dust, wipe with a damp cloth, then a thin coat of matching cream polish every two weeks. Buff with a horsehair brush.\n- **Monsoon:** a coat of neutral wax before the rains. If they get soaked, stuff with newspaper and dry in the shade, never in the sun or near a heater, then cream them.\n- **Suede:** a suede brush and a rubber eraser only, no cream.\n- **Resole, don't replace:** our welted shoes can be resoled at the shop.",
        },
        { type: "image", url: photo(8899943, "tile"), alt: "Polishing a black leather loafer" },
        { type: "faq", items: FAQ.slice(1, 3) },
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
      { label: "Men", type: "category", ref: "men", children: [{ label: "Formal shoes", type: "category", ref: "formal-shoes" }, { label: "Sandals & chappals", type: "category", ref: "sandals-and-chappals" }] },
      { label: "Women", type: "category", ref: "women" },
      { label: "Kids", type: "category", ref: "kids", children: [{ label: "School shoes", type: "category", ref: "school-shoes" }] },
      { label: "Sports", type: "collection", ref: "running" },
      { label: "Under ₹999", type: "collection", ref: "under-999" },
      { label: "Size guide", type: "page", ref: "size-guide" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Size guide", type: "page", ref: "size-guide" },
          { label: "Leather care", type: "page", ref: "shoe-care" },
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "School-shoe season", type: "collection", ref: "school-season" },
          { label: "Handmade in Vellore district", type: "collection", ref: "handmade" },
          { label: "Our story", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
