import type { DemoProduct, DemoStore } from "./types";

/**
 * Store #15 of the series: Kalaiyagam Décor & Gifts, Big Street, Kumbakonam (kalaiyagam.localhost:3003). A home décor
 * and gift shop in the brass country of the Cauvery delta, on the online store app (EC) with the `home_decor` trade
 * and the "polished-brass" look (brass on a teal-black wall). Kalaiyagam (கலையகம்) is Tamil for "house of art". It sells
 * brass lamps and vessels, Thanjavur-style paintings and dancing dolls, lost-wax bronzes, wood and terracotta crafts,
 * wall art, lighting, vases and planters, festive décor (golu dolls, diyas, Christmas stars), return gifts in bulk and
 * gift hampers. Names are generic (no brands); prices are typical Kumbakonam / Thanjavur prices in October 2026, GST
 * included. Address, phone and GSTIN are placeholders like the other demo shops.
 *
 * Geographical indications: Nachiarkoil kuthuvilakku, Thanjavur paintings, Thanjavur dolls (thalaiyatti bommai) and
 * Swamimalai bronze icons are registered GIs. Pieces here are sold as "-style" / "in the tradition", without claiming
 * a GI tag or an authorised user's certificate, which this demo shop can't show.
 *
 * GST: rates from 22 Sept 2025. Handicrafts: Notification 13/2025-Central Tax (Rate) of 17 Sept 2025, which substituted
 * the table of 21/2018-Central Tax (Rate) (concessional rates on handicraft goods) — CGST 2.5% (= 5% GST) on, among
 * others: S. No. 1 3406 handcrafted candles; 2 4202 22 … handbags incl. pouches; 4 4414 wooden frames for paintings,
 * photographs, mirrors; 5 4420 statuettes and ornaments of wood, wood lathe and lacquer work; 7 4601/4602 basketwork
 * and articles of plaiting material (incl. naturally dried flowers); 20 6912 00 tableware and kitchenware of clay and
 * terracotta, other clay articles; 21 6913 90 00 statuettes and other ornamental ceramic articles; 29 7419 80 artware of
 * brass, copper / copper alloys; 31 8306 bells, statuettes and other ornaments of base metal, photograph frames and
 * mirrors of base metal ("including … Panchloga artware, idol, Swamimalai bronze icons"); 32 9405 10 handcrafted lamps
 * (including Panchloga lamp); 34 9503 dolls … ("including … Thanjavur doll"); 38 9701 hand paintings ("including …
 * Tanjore painting"). Text read from the West Bengal gazette copy (1634-F.T., 19.09.2025, "Corresponding Central
 * Notification No. 13/2025-Central Tax (Rate)"). Other goods:
 * - Pooja thali sets (table / household articles of brass, 7418): 5%, 9/2025-Central Tax (Rate) Schedule I (as store
 *   #12 read it). UNCERTAIN: sold as artware they are 7419 80 at 5% anyway.
 * - Oil lamps (kuthu vilakku, deepams) as handcrafted lamps: entry 32 names 9405 10 while non-electric lamps fall in
 *   9405 50 — UNCERTAIN sub-heading; brass lamps are 5% also as 7419 80 artware (entry 29), so the rate holds.
 * - Non-electric metal lantern: 5% as a handcrafted lamp — UNCERTAIN (a factory-made lantern is 18%).
 * - Painted clay diyas (agal): nil as "earthen pot and clay lamps", 10/2025-Central Tax (Rate) S. No. 151 (store #12
 *   reads the same). UNCERTAIN: decorated diyas could be argued as ornamental ceramics (6913, 5%).
 * - Jute gift totes: 5% as handmade handbags / pouches of textile (entry 2, 4202 22) — UNCERTAIN for machine-stitched
 *   totes (6305 / 4202 22 at the general rate).
 * - Artificial flowers (6702): 18% — UNCERTAIN: secondary sources agree on 18% after 22 Sept 2025 but we did not read
 *   the schedule entry itself.
 * - Paper star lanterns (9505 90, festive articles): 18% — UNCERTAIN, sources conflict (5% / 18%); we charge 18%.
 * - Gift hampers are mixed supplies (CGST Act s. 8(b)): taxed at the highest rate of any item in them, with that item's
 *   HSN: the Deepavali and housewarming hampers hold only 5% goods; the wedding basket holds artificial roses, so 18%.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500015";
const WHATSAPP = "919876500015";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

/** Return gifts by the piece and in bulk packs: [one piece, per piece in 25s, per piece in 50s] and the MRP per piece. */
const bulk = (piece: number, in25: number, in50: number, mrp: number) =>
  one("Pack", [
    ["1 piece", piece, mrp, 120],
    ["Pack of 25", in25 * 25, mrp * 25, 30],
    ["Pack of 50", in50 * 50, mrp * 50, 16],
  ]);

const BRASS = "Brass & lamps";
const WALL = "Wall art & frames";
const CRAFTS = "Handicrafts";
const VASES = "Vases & planters";
const LIGHT = "Lighting";
const FESTIVE = "Festive décor";
const GOLU = "Golu dolls";
const RETURN = "Return gifts";
const HAMPERS = "Gift hampers";

/** Who a piece suits (the gift finder searches these words). */
const NEWLY = "Newlyweds";
const ELDERS = "Parents and elders";
const HOSTS = "Hosts of a housewarming";
const COLLEAGUES = "Colleagues and teachers";
const GUESTS = "Wedding and function guests";
const giftFor = (...who: string[]) => who.join(", ");

const BRASS_CARE = "Wipe with a soft dry cloth. To bring back the shine, rub with tamarind pulp or half a lemon dipped in salt, rinse and dry at once (our brass care guide has the details).";
const HANDMADE = "\n\nMade by hand, so no two pieces are identical: small variations in colour, casting marks and size (±5%) are part of the craft, not defects.";
const PACKED = " Packed in a double-walled box with paper padding; open it on video (see our breakage policy).";
const NO_GI = " Sold as";

const PRODUCTS: DemoProduct[] = [
  // ---- brass & lamps
  {
    name: "Nachiarkoil-style kuthu vilakku, peacock top",
    category: BRASS,
    hsn: "9405",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-KVL",
    photo: 8819140,
    tags: ["pooja-room", "housewarming", "wedding", "deepavali", "bestseller", "tn-craft"],
    description: `The five-faced standing lamp of every Tamil pooja room: base, stem, bowl and peacock top sand-cast separately in a family workshop near Kumbakonam, then screwed together, so it comes apart for cleaning. Five wick spouts, a heavy stepped base that doesn't tip.${NO_GI} Nachiarkoil-style: the Nachiarkoil kuthuvilakku is a registered GI, and this lamp carries no GI tag.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass, sand-cast, hand-finished", Weight: "0.9 kg (9 inch) to 3.2 kg (18 inch)", Finish: "Polished, unlacquered", "Craft / origin": "Nachiarkoil style, cast near Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(NEWLY, ELDERS, HOSTS) },
    ...one("Height", [
      ["9 inch", 1_450, 1_650, 24],
      ["12 inch", 2_350, 2_600, 18],
      ["15 inch", 3_600, 3_950, 10],
      ["18 inch", 5_400, 5_900, 6],
    ]),
  },
  {
    name: "Brass mayil deepam, pair",
    category: BRASS,
    hsn: "9405",
    gstRate: 5,
    unit: "pair",
    sku: "KG-MAY",
    photo: 34056592,
    tags: ["pooja-room", "wedding", "deepavali", "tn-craft"],
    description: `A pair of single-bowl lamps with a peacock (mayil) on the stem, for either side of the deity or the threshold kolam. The wide bowl holds enough oil for a whole evening.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass, sand-cast", Weight: "0.6 kg the pair (6 inch)", Finish: "Polished", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(NEWLY, ELDERS) },
    ...one("Height", [
      ["6 inch", 1_250, 1_400, 20],
      ["8 inch", 1_950, 2_200, 12],
    ]),
  },
  {
    name: "Brass Vinayagar deepam, five wicks",
    category: BRASS,
    hsn: "9405",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-VDP",
    photo: 39160036,
    tags: ["pooja-room", "housewarming", "deepavali"],
    description: `A standing lamp crowned by a seated Vinayagar, with a five-petal bowl: the lamp people light first in a new house. Cast in three parts that screw together.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass, sand-cast", Weight: "1.1 kg (10 inch)", Finish: "Polished", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(HOSTS, ELDERS) },
    ...one("Height", [
      ["10 inch", 2_150, 2_400, 14],
      ["14 inch", 3_450, 3_800, 8],
    ]),
  },
  {
    name: "Brass uruli",
    category: BRASS,
    hsn: "741980",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-URU",
    photo: 8819252,
    tags: ["living-room", "entrance", "housewarming", "deepavali", "bestseller"],
    description: `The wide, shallow bell-metal-style bowl of Kerala and Tamil homes, here in brass: float marigolds, rose petals and tea lights in it at the entrance, or fill it with water and a lotus for a festival morning. Thick rim, flat base, two small handles.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass, hand-beaten and turned", Weight: "0.8 kg (8 inch) to 3.1 kg (15 inch)", Finish: "Polished outside, tinned-look inside", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(HOSTS, NEWLY) },
    ...one("Diameter", [
      ["8 inch", 1_150, 1_300, 26],
      ["10 inch", 1_650, 1_850, 20],
      ["12 inch", 2_450, 2_700, 12],
      ["15 inch", 3_900, 4_300, 6],
    ]),
  },
  {
    name: "Brass pooja thali set, 7 pieces",
    category: BRASS,
    hsn: "7418",
    gstRate: 5,
    unit: "set",
    sku: "KG-THA",
    photo: 36950762,
    tags: ["pooja-room", "housewarming", "wedding"],
    description: `A complete pooja plate: engraved thali, small deepam, kumkum and turmeric cups, a panchapatra with uddharani (water cup and spoon), a bell and an agarbathi stand, all in brass and packed in a gift box.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass", "In the set": "Thali, deepam, 2 cups, panchapatra, uddharani, bell", Finish: "Polished, engraved rim", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(NEWLY, HOSTS, ELDERS) },
    ...one("Plate", [
      ["10 inch", 1_850, 2_050, 16],
      ["12 inch", 2_650, 2_950, 10],
    ]),
  },
  {
    name: "Brass pooja mani (hand bell)",
    category: BRASS,
    hsn: "8306",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-MAN",
    photo: 9921535,
    tags: ["pooja-room", "housewarming"],
    description: `A cast brass hand bell with a turned handle, rung during the aarti. The bell metal is thick, so it rings long and clear, not tinny.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass, cast", Weight: "250 g (5 inch)", Finish: "Polished", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(ELDERS, HOSTS) },
    ...one("Height", [
      ["5 inch", 450, 520, 40],
      ["7 inch", 750, 850, 24],
    ]),
  },
  {
    name: "Brass door bells with sun face",
    category: BRASS,
    hsn: "8306",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-DBL",
    photo: 26598244,
    tags: ["entrance", "housewarming", "balcony"],
    description: `A hanging of seven small brass bells under a sun-face medallion, on a 60 cm chain: for the front door, so it chimes every time it opens, or for a balcony that catches the breeze.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass, cast and chain-linked", Dimensions: "Sun face 4 inch; 60 cm drop", Finish: "Antique", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(HOSTS) },
    ...single(1_350, 1_500, 18),
  },

  // ---- wall art & frames
  {
    name: "Thanjavur-style painting, Balaji",
    category: WALL,
    hsn: "9701",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-TPB",
    photo: 27919913,
    tags: ["pooja-room", "living-room", "housewarming", "wedding", "thanjavur", "tn-craft"],
    description: `Lord Venkateswara (Balaji) painted by hand in the Thanjavur manner: a chalk-and-gum relief built up on cloth over plywood, gold foil pressed on the raised work, colours laid in by brush, set in a carved teak frame. Each painting takes a family of painters in Thanjavur three to six weeks.${NO_GI} Thanjavur-style: Thanjavur paintings are a registered GI, and this piece carries no GI tag.${HANDMADE}${PACKED}`,
    attributes: { Material: "Cloth on plywood, chalk relief, gold foil, colours", Frame: "Carved teak, glass front", "Craft / origin": "Painted in Thanjavur", Care: "Keep away from damp walls and direct sun; dust the glass only, never wipe the gold.", "Good gift for": giftFor(NEWLY, ELDERS, HOSTS) },
    ...one("Size", [
      ["12 × 15 inch", 7_800, 8_500, 4],
      ["15 × 18 inch", 11_500, 12_500, 3],
      ["18 × 24 inch", 17_500, 19_000, 2],
    ]),
  },
  {
    name: "Thanjavur-style painting, Gajalakshmi",
    category: WALL,
    hsn: "9701",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-TPL",
    photo: 39650030,
    tags: ["pooja-room", "living-room", "housewarming", "deepavali", "thanjavur", "tn-craft"],
    description: `Lakshmi seated on a lotus, elephants at her side, in raised gold foil and deep reds and greens: the painting for a new home's pooja room or the wall facing the entrance. Hand-painted in Thanjavur, framed in carved teak.${NO_GI} Thanjavur-style, without a GI tag.${HANDMADE}${PACKED}`,
    attributes: { Material: "Cloth on plywood, chalk relief, gold foil, colours", Frame: "Carved teak, glass front", "Craft / origin": "Painted in Thanjavur", Care: "Keep away from damp walls and direct sun; dust the glass only.", "Good gift for": giftFor(HOSTS, NEWLY) },
    ...one("Size", [
      ["12 × 15 inch", 7_800, 8_500, 4],
      ["15 × 18 inch", 11_500, 12_500, 3],
    ]),
  },
  {
    name: "Copper relief panel, Vinayagar",
    category: WALL,
    hsn: "741980",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-CRP",
    photo: 12896770,
    tags: ["entrance", "living-room", "housewarming"],
    description: `Vinayagar beaten up from the back of a copper sheet (repoussé), given an antique wash and set in a teak frame: for above the front door or a hall niche. It has the look of a Thanjavur art plate, at wall size.${HANDMADE}${PACKED}`,
    attributes: { Material: "Copper sheet, repoussé, on teak", "Craft / origin": "Thanjavur", Finish: "Antique copper", Care: "Dust with a soft brush; no polish or water.", "Good gift for": giftFor(HOSTS, COLLEAGUES) },
    ...one("Size", [
      ["12 × 18 inch", 3_200, 3_600, 6],
      ["18 × 24 inch", 5_200, 5_800, 3],
    ]),
  },
  {
    name: "Hand-painted ceramic wall plates, set of 3",
    category: WALL,
    hsn: "69139000",
    gstRate: 5,
    unit: "set",
    sku: "KG-WPL",
    photo: 8758352,
    tags: ["living-room", "thank-you"],
    description: `Three stoneware plates thrown and painted by hand in Puducherry in white, sand and charcoal glazes, with hanging hooks on the back: a quiet cluster for a dining wall.${HANDMADE}${PACKED}`,
    attributes: { Material: "Stoneware, hand-painted glaze", "Craft / origin": "Puducherry", Care: "Wipe with a damp cloth. Decorative only, not for food.", "Good gift for": giftFor(COLLEAGUES, HOSTS) },
    ...one("Size", [
      ["8 inch plates", 1_650, 1_850, 10],
      ["10 inch plates", 2_250, 2_500, 8],
    ]),
  },
  {
    name: "Terracotta sun face wall plaque",
    category: WALL,
    hsn: "691200",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-SUN",
    photo: 26974942,
    tags: ["balcony", "entrance", "housewarming"],
    description: `A smiling sun in fired red clay, made in a potter's yard near Manamadurai: for a garden wall, a balcony or the porch, where it weathers to a lovely patina. Two holes at the back for a nail.${HANDMADE}${PACKED}`,
    attributes: { Material: "Terracotta, fired", "Craft / origin": "Manamadurai", Care: "Outdoors is fine; brush off dust, no detergent.", "Good gift for": giftFor(HOSTS) },
    ...one("Size", [
      ["10 inch", 690, 790, 20],
      ["14 inch", 1_150, 1_300, 12],
    ]),
  },
  {
    name: "Brass sunburst mirrors, set of 3",
    category: WALL,
    hsn: "8306",
    gstRate: 5,
    unit: "set",
    sku: "KG-MIR",
    photo: 29149067,
    tags: ["living-room", "entrance", "pooja-room"],
    description: `Three small round mirrors in hand-cut brass sunburst frames (8, 10 and 12 inch), to hang in a loose cluster by the door or above the pooja shelf.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass sheet frames, glass mirror", Dimensions: "8, 10 and 12 inch", "Craft / origin": "Kumbakonam", Care: "Clean the glass with a dry cloth; keep cleaners off the brass.", "Good gift for": giftFor(NEWLY, HOSTS) },
    ...single(2_450, 2_800, 9),
  },
  {
    name: "Teak shadow-box frames, set of 4",
    category: WALL,
    hsn: "4414",
    gstRate: 5,
    unit: "set",
    sku: "KG-FRM",
    photo: 37486400,
    tags: ["living-room", "thank-you"],
    description: `Four deep teak frames with a glass front and a linen back board, for pressed leaves, a child's drawings, wedding invitations or temple prasadam covers. Hang them as a grid or a staircase line.${HANDMADE}${PACKED}`,
    attributes: { Material: "Teak, glass, linen board", "Craft / origin": "Kumbakonam", Care: "Dust only; keep away from damp walls.", "Good gift for": giftFor(COLLEAGUES, NEWLY) },
    ...one("Size", [
      ["8 × 10 inch", 1_450, 1_650, 12],
      ["10 × 12 inch", 1_850, 2_100, 8],
    ]),
  },

  // ---- handicrafts
  {
    name: "Bronze Vinayagar with consorts, lost-wax",
    category: CRAFTS,
    hsn: "8306",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-BVG",
    photo: 33289447,
    tags: ["pooja-room", "housewarming", "tn-craft"],
    description: `Vinayagar with Siddhi and Buddhi, modelled in wax, invested in Cauvery clay and cast in bronze by the lost-wax method in the Swamimalai tradition: every piece is a new mould, so every piece is one of a kind. Finished with chisels and a dark patina.${NO_GI} Swamimalai bronze icons are a registered GI, and this icon carries no GI tag.${HANDMADE}${PACKED}`,
    attributes: { Material: "Bronze (panchaloha-style alloy), lost-wax cast", Weight: "0.7 kg (4 inch) to 4.5 kg (9 inch)", Finish: "Antique patina", "Craft / origin": "Swamimalai tradition", Care: "Dust with a soft brush; for abhishekam, dry it at once.", "Good gift for": giftFor(HOSTS, ELDERS) },
    ...one("Height", [
      ["4 inch", 4_800, 5_200, 5],
      ["6 inch", 8_900, 9_600, 3],
      ["9 inch", 18_500, 19_900, 2],
    ]),
  },
  {
    name: "Bronze Lakshmi, seated, lost-wax",
    category: CRAFTS,
    hsn: "8306",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-BLK",
    photo: 33550177,
    tags: ["pooja-room", "deepavali", "wedding", "tn-craft"],
    description: `Four-armed Lakshmi seated on a lotus pedestal, cast by the lost-wax method in the Swamimalai tradition and finished by hand: lotus buds in the upper hands, the lower in blessing.${NO_GI} Without a GI tag.${HANDMADE}${PACKED}`,
    attributes: { Material: "Bronze, lost-wax cast", Weight: "0.6 kg (4 inch)", Finish: "Antique patina", "Craft / origin": "Swamimalai tradition", Care: "Dust with a soft brush; dry at once after abhishekam.", "Good gift for": giftFor(NEWLY, ELDERS) },
    ...one("Height", [
      ["4 inch", 4_600, 5_000, 5],
      ["6 inch", 8_500, 9_200, 3],
    ]),
  },
  {
    name: "Brass Nataraja with flame ring",
    category: CRAFTS,
    hsn: "8306",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-NAT",
    photo: 6926632,
    tags: ["living-room", "housewarming", "bestseller"],
    description: `Nataraja dancing inside the ring of fire (prabha), cast in brass and hand-chased: the piece for a living-room console or a dance teacher's studio.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass, sand-cast, hand-chased", Weight: "1.2 kg (8 inch) to 6 kg (18 inch)", Finish: "Antique gold", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(HOSTS, COLLEAGUES) },
    ...one("Height", [
      ["8 inch", 3_600, 3_950, 8],
      ["12 inch", 6_400, 6_950, 5],
      ["18 inch", 13_500, 14_800, 2],
    ]),
  },
  {
    name: "Carved wood Vinayagar",
    category: CRAFTS,
    hsn: "4420",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-WVG",
    photo: 15285440,
    tags: ["pooja-room", "living-room", "housewarming", "tn-craft"],
    description: `Vinayagar carved by hand from a single block of seasoned vaagai wood, with a crown, a broken tusk and a modak in hand, oiled to a warm brown. The kind of carving temple-car carvers make between commissions.${HANDMADE}${PACKED}`,
    attributes: { Material: "Vaagai (Albizia) wood, hand-carved, oiled", "Craft / origin": "Thanjavur district", Care: "Dust; a drop of coconut oil once a year keeps the wood from drying.", "Good gift for": giftFor(HOSTS, ELDERS, COLLEAGUES) },
    ...one("Height", [
      ["8 inch", 2_900, 3_200, 8],
      ["12 inch", 5_400, 5_900, 4],
    ]),
  },
  {
    name: "Carved wood elephant pair",
    category: CRAFTS,
    hsn: "4420",
    gstRate: 5,
    unit: "pair",
    sku: "KG-WEL",
    photo: 11450666,
    tags: ["living-room", "thank-you", "housewarming"],
    description: `A mother and calf elephant carved in wood with raised trunks and resin tusks, for a console or a bookshelf; a lucky pair to give a new home.${HANDMADE}${PACKED}`,
    attributes: { Material: "Hand-carved wood, resin tusks", "Craft / origin": "Thanjavur district", Care: "Dust only.", "Good gift for": giftFor(HOSTS, COLLEAGUES) },
    ...one("Height", [
      ["6 inch", 1_250, 1_400, 14],
      ["9 inch", 2_250, 2_500, 8],
    ]),
  },
  {
    name: "Thanjavur-style thalaiyatti bommai, pair",
    category: CRAFTS,
    hsn: "9503",
    gstRate: 5,
    unit: "pair",
    sku: "KG-TTB",
    photo: 19443148,
    tags: ["golu", "navaratri", "thank-you", "return-gift", "thanjavur", "bestseller"],
    description: `The nodding Thanjavur dolls: a clay-and-papier-mâché couple whose heads sit on a balance point, so they bob at the slightest touch, painted bright by hand. A golu favourite and a much-loved return gift.${NO_GI} Thanjavur-style: Thanjavur dolls are a registered GI, and these carry no GI tag.${HANDMADE}${PACKED}`,
    attributes: { Material: "Clay, papier-mâché, hand-painted", "Craft / origin": "Thanjavur", Care: "Keep dry; dust with a soft brush.", "Good gift for": giftFor(GUESTS, COLLEAGUES, ELDERS) },
    ...one("Height", [
      ["6 inch", 590, 650, 40],
      ["9 inch", 950, 1_050, 24],
    ]),
  },
  {
    name: "Painted terracotta horse",
    category: CRAFTS,
    hsn: "69139000",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-THS",
    photo: 4721977,
    tags: ["balcony", "entrance", "living-room", "golu", "tn-craft"],
    description: `A village guardian horse in fired terracotta, painted in white, red and black like the great horses at the Ayyanar shrines of the delta, at a size for a garden corner or a golu's top step.${HANDMADE}${PACKED}`,
    attributes: { Material: "Terracotta, fired, hand-painted", "Craft / origin": "Pudukkottai district", Care: "Indoors or under a roof; brush off dust.", "Good gift for": giftFor(HOSTS, COLLEAGUES) },
    ...one("Height", [
      ["12 inch", 1_450, 1_600, 10],
      ["18 inch", 2_650, 2_900, 5],
    ]),
  },

  // ---- vases & planters
  {
    name: "Brass kindi vase",
    category: VASES,
    hsn: "741980",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-KIN",
    photo: 9420380,
    tags: ["living-room", "pooja-room", "thank-you"],
    description: `A spouted brass kindi (the temple water vessel) with an engraved belly and a handle, made for flowers: three stems of rose or a sprig of jasmine is all it needs.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass, engraved", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(COLLEAGUES, ELDERS) },
    ...one("Height", [
      ["8 inch", 1_150, 1_300, 16],
      ["11 inch", 1_750, 1_950, 10],
    ]),
  },
  {
    name: "Terracotta floor vases, set of 3",
    category: VASES,
    hsn: "691200",
    gstRate: 5,
    unit: "set",
    sku: "KG-TFV",
    photo: 18449692,
    tags: ["living-room", "balcony", "housewarming"],
    description: `Three thrown terracotta vases (24, 16 and 10 inch) with flared lips, unglazed so the clay breathes: for dried pampas, palm fronds or simply a bare corner.${HANDMADE}${PACKED}`,
    attributes: { Material: "Terracotta, wheel-thrown", Dimensions: "24, 16 and 10 inch tall", "Craft / origin": "Manamadurai", Care: "For dried stems; seal the inside before using water.", "Good gift for": giftFor(HOSTS) },
    ...single(2_350, 2_600, 6),
  },
  {
    name: "Hand-painted ceramic vase, lotus",
    category: VASES,
    hsn: "69139000",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-CVL",
    photo: 15037675,
    tags: ["living-room", "thank-you", "wedding"],
    description: `A round-bellied stoneware vase in a cream glaze, with a lotus painted by hand in soft brown: for a single stem on a desk or a side table.${HANDMADE}${PACKED}`,
    attributes: { Material: "Stoneware, glazed, hand-painted", "Craft / origin": "Puducherry", Care: "Hand-wash; watertight.", "Good gift for": giftFor(COLLEAGUES, NEWLY) },
    ...one("Height", [
      ["6 inch", 1_250, 1_400, 14],
      ["9 inch", 1_850, 2_050, 8],
    ]),
  },
  {
    name: "Painted ceramic vases, pair",
    category: VASES,
    hsn: "69139000",
    gstRate: 5,
    unit: "pair",
    sku: "KG-CVP",
    photo: 37283574,
    tags: ["living-room", "wedding", "housewarming"],
    description: `Two tall vases covered in a hand-painted floral pattern in saffron, rust and gold: a showpiece pair for both ends of a console.${HANDMADE}${PACKED}`,
    attributes: { Material: "Ceramic, hand-painted", Dimensions: "14 and 11 inch tall", "Craft / origin": "Puducherry", Care: "Wipe with a damp cloth.", "Good gift for": giftFor(NEWLY, HOSTS) },
    ...single(2_850, 3_100, 6),
  },
  {
    name: "Terracotta planters, set of 3",
    category: VASES,
    hsn: "691200",
    gstRate: 5,
    unit: "set",
    sku: "KG-TPT",
    photo: 10722286,
    tags: ["balcony", "pooja-room", "housewarming"],
    description: `Three plain terracotta pots with drainage holes and saucers, the colour of wet earth: for tulsi, money plant or succulents on a sunny ledge.${HANDMADE}${PACKED}`,
    attributes: { Material: "Terracotta, fired", "Craft / origin": "Manamadurai", Care: "Soak before the first planting; outdoors is fine.", "Good gift for": giftFor(HOSTS, COLLEAGUES) },
    ...one("Size", [
      ["6 inch pots", 650, 750, 20],
      ["8 inch pots", 990, 1_100, 14],
    ]),
  },
  {
    name: "Artificial peonies in a brass pot",
    category: VASES,
    hsn: "6702",
    gstRate: 18,
    unit: "pcs",
    sku: "KG-APB",
    photo: 10838714,
    tags: ["living-room", "wedding"],
    description: `Blush silk-finish peonies and eucalyptus arranged in an old-style hammered brass pot: flowers that stay fresh for an air-conditioned living room or a clinic reception. Taxed as artificial flowers at 18%.${PACKED}`,
    attributes: { Material: "Polyester flowers, wire stems, brass pot", Dimensions: "14 inch tall, pot 5 inch", "Craft / origin": "Arranged in our shop", Care: "Dust with a hair-dryer on cool.", "Good gift for": giftFor(NEWLY, COLLEAGUES) },
    ...single(2_650, 2_950, 8),
  },

  // ---- lighting
  {
    name: "Brass cut-work hanging lamp",
    category: LIGHT,
    hsn: "9405",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-HLB",
    photo: 8515709,
    tags: ["living-room", "entrance"],
    description: `A hand-pierced brass ceiling lamp that throws a pattern of stars across the room: an E27 holder, a 1 m chain and a ceiling cup. Bulb not included (a warm 7 W LED is best).${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass sheet, hand-pierced", Fitting: "E27 holder, 1 m chain, ceiling cup", "Craft / origin": "Kumbakonam", Care: "Switch off and dust with a soft brush.", "Good gift for": giftFor(HOSTS) },
    ...one("Diameter", [
      ["10 inch", 3_450, 3_800, 6],
      ["14 inch", 5_200, 5_700, 4],
    ]),
  },
  {
    name: "Cane gourd pendant lamp",
    category: LIGHT,
    hsn: "9405",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-CPL",
    photo: 29966400,
    tags: ["living-room", "balcony"],
    description: `A gourd-shaped pendant hand-woven in split cane, with a 1.5 m fabric cord and E27 holder: a soft, dappled light over a dining table or a sit-out.${HANDMADE}${PACKED}`,
    attributes: { Material: "Split cane, hand-woven", Fitting: "E27, 1.5 m fabric cord", "Craft / origin": "Woven in Puducherry", Care: "Dust with a soft brush.", "Good gift for": giftFor(HOSTS, NEWLY) },
    ...one("Size", [
      ["Small, 10 inch", 1_850, 2_050, 10],
      ["Large, 14 inch", 2_450, 2_700, 6],
    ]),
  },
  {
    name: "Metal lantern with green glass",
    category: LIGHT,
    hsn: "9405",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-LNT",
    photo: 11263713,
    tags: ["balcony", "deepavali", "christmas"],
    description: `A pierced black-metal lantern with green glass panes and a hanging ring, for a candle or a tea light: on a balcony ledge, a garden path or the Deepavali step.${HANDMADE}${PACKED}`,
    attributes: { Material: "Iron, painted; glass", Dimensions: "11 inch tall", "Craft / origin": "Puducherry", Care: "Keep under a roof; wipe the glass.", "Good gift for": giftFor(HOSTS, COLLEAGUES) },
    ...single(1_150, 1_300, 14),
  },
  {
    name: "Hanging thooku vilakku, nickel-finish brass",
    category: LIGHT,
    hsn: "9405",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-THK",
    photo: 40242712,
    tags: ["pooja-room", "entrance", "housewarming"],
    description: `The hanging oil lamp of temple corridors, in brass with a bright nickel finish: a lidded oil bowl with five spouts on a 90 cm chain, for a pooja-room ceiling hook or the front verandah.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass, nickel-plated", Dimensions: "7 inch bowl, 90 cm chain", "Craft / origin": "Kumbakonam", Care: "Wipe the oil off after use; no tamarind on the nickel finish.", "Good gift for": giftFor(HOSTS, ELDERS) },
    ...single(2_950, 3_250, 8),
  },
  {
    name: "Soy wax jar candles, set of 3",
    category: LIGHT,
    hsn: "3406",
    gstRate: 5,
    unit: "set",
    sku: "KG-JCN",
    photo: 39277493,
    tags: ["thank-you", "deepavali", "christmas", "return-gift"],
    description: `Three hand-poured soy wax candles in reusable glass jars, cotton wicks, about 20 hours each. Scented lightly with jasmine, sandalwood or vetiver.${HANDMADE}${PACKED}`,
    attributes: { Material: "Soy wax, cotton wick, glass jar", "Burn time": "About 20 hours each", "Craft / origin": "Poured in Puducherry", Care: "Trim the wick to 5 mm; never leave burning unattended.", "Good gift for": giftFor(COLLEAGUES, GUESTS) },
    ...one("Scent", [
      ["Jasmine", 650, 720, 24],
      ["Sandalwood", 650, 720, 24],
      ["Vetiver", 650, 720, 18],
    ]),
  },
  {
    name: "Hand-poured pillar candles, set of 4",
    category: LIGHT,
    hsn: "3406",
    gstRate: 5,
    unit: "set",
    sku: "KG-PCN",
    photo: 8617327,
    tags: ["christmas", "deepavali", "living-room"],
    description: `Four unscented ivory pillar candles (3, 4, 5 and 6 inch), hand-poured, slow-burning and drip-free: for an uruli, a mantel or a Christmas table.${HANDMADE}${PACKED}`,
    attributes: { Material: "Paraffin-soy blend, cotton wick", "Burn time": "25–50 hours", "Craft / origin": "Poured in Puducherry", Care: "Burn on a plate; keep away from fans.", "Good gift for": giftFor(COLLEAGUES, HOSTS) },
    ...single(790, 890, 20),
  },

  // ---- festive décor and golu dolls
  {
    name: "Kalyanam golu set, 5 dolls",
    category: GOLU,
    hsn: "9503",
    gstRate: 5,
    unit: "set",
    sku: "KG-GKS",
    photo: 34056610,
    tags: ["golu", "navaratri", "wedding"],
    description: `A wedding scene for the golu steps: bride and groom on the oonjal, the couple's parents and the nadaswaram player, dressed by hand in silk-look cloth over clay bodies. After-Navaratri price till 15 November: pack it away for next year.${HANDMADE}${PACKED}`,
    attributes: { Material: "Clay, cloth, hand-painted", Dimensions: "8–10 inch dolls", "Craft / origin": "Kumbakonam", Care: "Store wrapped in cloth in a dry trunk.", "Good gift for": giftFor(ELDERS, NEWLY) },
    ...single(2_450, 3_200, 6),
  },
  {
    name: "Village life golu set, 7 dolls",
    category: GOLU,
    hsn: "9503",
    gstRate: 5,
    unit: "set",
    sku: "KG-GVL",
    photo: 352901,
    tags: ["golu", "navaratri", "thank-you"],
    description: `Seven turned and hand-painted wooden figures of village life: women carrying water pots, the vegetable seller, the farmer and his bullock: the bright, cheerful set children love to arrange on the lowest step. After-Navaratri price till 15 November.${HANDMADE}${PACKED}`,
    attributes: { Material: "Wood, turned and hand-painted", Dimensions: "5–7 inch figures", "Craft / origin": "Wood-turners near Kumbakonam", Care: "Store wrapped in paper in a dry box.", "Good gift for": giftFor(ELDERS, COLLEAGUES) },
    ...single(1_650, 2_200, 10),
  },
  {
    name: "Painted terracotta diyas",
    category: FESTIVE,
    hsn: "69120040",
    gstRate: 0,
    unit: "set",
    sku: "KG-PDY",
    photo: 3135229,
    tags: ["deepavali", "pooja-room", "return-gift", "bestseller"],
    description: `Fired clay agal from Manamadurai potters, painted by hand in peacock blue, red and gold, ready for a cotton wick and oil. Clay lamps are GST-free.${HANDMADE} Packed in paper-pulp trays.`,
    attributes: { Material: "Terracotta, fired, hand-painted", "Craft / origin": "Manamadurai", Care: "Soak unpainted lamps; wipe painted ones with a dry cloth.", "Good gift for": giftFor(GUESTS, COLLEAGUES) },
    ...one("Set", [
      ["12 diyas", 240, 280, 60],
      ["24 diyas", 450, 520, 40],
      ["51 diyas", 899, 1_050, 20],
    ]),
  },
  {
    name: "Brass diya plates with clay agal, set of 6",
    category: FESTIVE,
    hsn: "741980",
    gstRate: 5,
    unit: "set",
    sku: "KG-BDP",
    photo: 13689170,
    tags: ["deepavali", "entrance", "housewarming"],
    description: `Six small brass saucers with a clay agal in each: the brass catches the oil and lights up with the flame. For the threshold and steps on Deepavali and Karthigai Deepam. A mixed set, taxed at the brass's 5%.${HANDMADE}${PACKED}`,
    attributes: { Material: "Brass saucers, clay agal", "Craft / origin": "Kumbakonam and Manamadurai", Care: BRASS_CARE, "Good gift for": giftFor(HOSTS, ELDERS) },
    ...single(720, 800, 24),
  },
  {
    name: "Paper star lantern",
    category: FESTIVE,
    hsn: "9505",
    gstRate: 18,
    unit: "pcs",
    sku: "KG-PSL",
    photo: 29614743,
    tags: ["christmas"],
    description: `The Christmas star of Tamil homes and churches: a folding paper star with cut-work patterns and a hanging cord, with a bulb holder inside (2 m wire). Folds flat for storing.${PACKED}`,
    attributes: { Material: "Card paper, cut-work; wire and holder", "Craft / origin": "Made in Puducherry", Care: "Keep dry; fold flat after Christmas.", "Good gift for": giftFor(COLLEAGUES) },
    options: [
      { name: "Size", values: ["18 inch", "24 inch"] },
      { name: "Colour", values: ["Red", "Orange"] },
    ],
    variants: [
      { values: { Size: "18 inch", Colour: "Red" }, price: rs(450), mrp: rs(520), stock: 24 },
      { values: { Size: "18 inch", Colour: "Orange" }, price: rs(450), mrp: rs(520), stock: 20 },
      { values: { Size: "24 inch", Colour: "Red" }, price: rs(650), mrp: rs(750), stock: 12 },
      { values: { Size: "24 inch", Colour: "Orange" }, price: rs(650), mrp: rs(750), stock: 10 },
    ],
  },
  {
    name: "Straw Christmas star ornaments, set of 6",
    category: FESTIVE,
    hsn: "4602",
    gstRate: 5,
    unit: "set",
    sku: "KG-STS",
    photo: 29917466,
    tags: ["christmas", "return-gift", "thank-you"],
    description: `Six eight-point stars woven from natural straw and tied with gold thread, for the tree, a window or tied to a gift box.${HANDMADE} Packed flat in a card sleeve.`,
    attributes: { Material: "Natural straw, cotton thread", Dimensions: "4 inch stars", "Craft / origin": "Woven in Puducherry", Care: "Keep dry.", "Good gift for": giftFor(COLLEAGUES, GUESTS) },
    ...single(350, 400, 30),
  },

  // ---- return gifts (by the piece and in packs of 25 / 50)
  {
    name: "Brass kumkum box (chimizh)",
    category: RETURN,
    hsn: "741980",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-RKB",
    photo: 39078425,
    tags: ["return-gift", "wedding", "golu", "bestseller"],
    description: `The classic return gift for a wedding or a golu evening: a lidded brass box with a repoussé lotus, sized for kumkum or turmeric. Packed in a cloth potli with a thank-you card.${HANDMADE}`,
    attributes: { Material: "Brass, repoussé lid", Dimensions: "2.5 inch across", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(GUESTS, COLLEAGUES) },
    ...bulk(189, 175, 165, 220),
  },
  {
    name: "German-silver kumkum box",
    category: RETURN,
    hsn: "741980",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-RGS",
    photo: 36355530,
    tags: ["return-gift", "wedding", "golu"],
    description: `A round German-silver (nickel silver, a copper alloy, no real silver) box with an embossed lid, bright as silver and does not tarnish easily. A wedding return gift that looks far dearer than it is.${HANDMADE}`,
    attributes: { Material: "German silver (copper-nickel-zinc alloy)", Dimensions: "2.5 inch across", "Craft / origin": "Kumbakonam", Care: "Wipe with a dry cloth.", "Good gift for": giftFor(GUESTS, COLLEAGUES) },
    ...bulk(229, 215, 205, 260),
  },
  {
    name: "Lacquered wooden kumkum box",
    category: RETURN,
    hsn: "4420",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-RLB",
    photo: 10424885,
    tags: ["return-gift", "golu", "navaratri"],
    description: `A lathe-turned wooden kumkum box finished in bright lac colours, with a temple-tower lid. Light enough to send home with every golu visitor.${HANDMADE}`,
    attributes: { Material: "Turned wood, lac colours", Dimensions: "3 inch tall", "Craft / origin": "Lathe and lacquer work", Care: "Keep dry.", "Good gift for": giftFor(GUESTS, COLLEAGUES) },
    ...bulk(119, 110, 105, 140),
  },
  {
    name: "Jute gift tote",
    category: RETURN,
    hsn: "420222",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-RJT",
    photo: 12025443,
    tags: ["return-gift", "wedding", "thank-you"],
    description: `A sturdy natural jute tote with rope handles and a cotton lining, stitched by a women's self-help group near Kumbakonam: a return gift guests actually use. We can print a name and date on it (50 or more).${HANDMADE}`,
    attributes: { Material: "Jute, cotton lining, rope handles", Dimensions: "12 × 12 × 4 inch", "Craft / origin": "Stitched near Kumbakonam", Care: "Spot-clean; don't soak.", "Good gift for": giftFor(GUESTS, COLLEAGUES) },
    ...bulk(129, 119, 109, 150),
  },
  {
    name: "Mini brass diya",
    category: RETURN,
    hsn: "9405",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-RMD",
    photo: 34431714,
    tags: ["return-gift", "deepavali", "housewarming", "golu"],
    description: `A palm-sized brass agal with a leaf-shaped spout, cast and polished: our lowest-priced return gift, and the one that gets lit again at home.${HANDMADE}`,
    attributes: { Material: "Brass, cast", Dimensions: "2.5 inch", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(GUESTS, COLLEAGUES, HOSTS) },
    ...bulk(99, 90, 85, 120),
  },
  {
    name: "Brass elephant incense holder",
    category: RETURN,
    hsn: "741980",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-RIE",
    photo: 29140977,
    tags: ["return-gift", "thank-you", "living-room"],
    description: `A little brass elephant with an enamelled saddle and a hole in its back for an agarbathi stick: a return gift for a housewarming or a thank-you for a teacher.${HANDMADE}`,
    attributes: { Material: "Brass, enamel inlay", Dimensions: "3 inch long", "Craft / origin": "Kumbakonam", Care: BRASS_CARE, "Good gift for": giftFor(COLLEAGUES, GUESTS) },
    ...bulk(349, 325, 310, 399),
  },

  // ---- gift hampers (mixed supplies: the highest rate inside)
  {
    name: "Deepavali brass and diya hamper",
    category: HAMPERS,
    hsn: "9405",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-HDP",
    photo: 8819577,
    tags: ["deepavali", "thank-you", "bestseller"],
    description: `Our Deepavali box, wrapped in red and gold: a pair of brass mayil deepams (6 inch), 12 painted clay diyas, a jasmine jar candle, a brass kumkum box and your message on a card. The Grand box adds an 8 inch brass uruli. A mixed supply: 5% (the brass lamps' rate).${PACKED}`,
    attributes: { "In the box": "Brass deepam pair, 12 painted diyas, jar candle, kumkum box, card", Packing: "Rigid gift box, wrapped", "Craft / origin": "Packed in our shop", Care: BRASS_CARE, "Good gift for": giftFor(COLLEAGUES, ELDERS, HOSTS) },
    ...one("Box", [
      ["Classic", 1_950, 2_200, 30],
      ["Grand", 3_450, 3_850, 15],
    ]),
  },
  {
    name: "Housewarming brass hamper",
    category: HAMPERS,
    hsn: "9405",
    gstRate: 5,
    unit: "pcs",
    sku: "KG-HHW",
    photo: 8819840,
    tags: ["housewarming", "pooja-room"],
    description: `For a griha pravesam: a 9 inch Nachiarkoil-style kuthu vilakku, an 8 inch brass uruli, the sun-face door bells and two jar candles on a gold wire tray, wrapped, with your card. A mixed supply: 5% (the lamp's rate).${PACKED}`,
    attributes: { "In the box": "Kuthu vilakku 9 inch, uruli 8 inch, door bells, 2 jar candles, tray", Packing: "Gold wire tray, cellophane wrap", "Craft / origin": "Packed in our shop", Care: BRASS_CARE, "Good gift for": giftFor(HOSTS, NEWLY) },
    ...single(3_950, 4_400, 10),
  },
  {
    name: "Wedding gift basket with artificial roses",
    category: HAMPERS,
    hsn: "6702",
    gstRate: 18,
    unit: "pcs",
    sku: "KG-HWD",
    photo: 30770345,
    tags: ["wedding"],
    description: `A cane basket for the couple: a pair of brass mayil deepams, two German-silver kumkum boxes, a jasmine jar candle and a bunch of everlasting artificial roses, wrapped in tulle. A mixed supply taxed at its highest rate, 18% (the artificial flowers).${PACKED}`,
    attributes: { "In the box": "Brass deepam pair, 2 kumkum boxes, jar candle, artificial roses, cane basket", Packing: "Cane basket, tulle wrap", "Craft / origin": "Packed in our shop", Care: BRASS_CARE, "Good gift for": giftFor(NEWLY) },
    ...single(2_950, 3_300, 10),
  },
];

/** Pexels photos used by the store (credited on /pages/photo-credits). */
const PHOTOS: DemoStore["photos"] = {
  8819140: { by: "Yan Krukau", alt: "Lit brass kuthu vilakku in front of a carved wooden panel" },
  34056592: { by: "ViAn Photography", alt: "Brass lamps with a peacock on top" },
  39160036: { by: "Nomadic Journey (VikramSingh Valera)", alt: "Lit brass lamp crowned by a Vinayagar" },
  8819252: { by: "Yan Krukau", alt: "Brass uruli filled with marigolds and a floating lamp" },
  36950762: { by: "Saravanan Narayanan", alt: "Brass pooja plate with lamps lit around it" },
  9921535: { by: "Ravi Roshan", alt: "Brass hand bell" },
  26598244: { by: "Kishan Kumar", alt: "Brass bells hanging under a sun face" },
  27919913: { by: "Sharath G.", alt: "Colourful gilded relief image of Lord Venkateswara" },
  39650030: { by: "Ram Kondisetti", alt: "Thanjavur-style painting of Lakshmi with gold relief" },
  12896770: { by: "Subhasish Baidya", alt: "Embossed Vinayagar panel in a frame" },
  8758352: { by: "Anna Tarazevich", alt: "Three decorative plates on a white wall" },
  26974942: { by: "Christina & Peter", alt: "Terracotta sun face on an ivy-covered wall" },
  29149067: { by: "AJ  Ahamad", alt: "Three round sunburst mirrors on a wall" },
  37486400: { by: "Pew Nguyen", alt: "Wall of wooden frames with pressed leaves" },
  33289447: { by: "Suhas Hanjar", alt: "Bronze Vinayagar with consorts" },
  33550177: { by: "Suhas Hanjar", alt: "Seated bronze Lakshmi" },
  6926632: { by: "Paranee Kumar V", alt: "Brass Nataraja inside a ring of flames" },
  15285440: { by: "Sharath G.", alt: "Carved wooden Vinayagar" },
  11450666: { by: "Atlantic Ambience", alt: "Carved wooden elephant and calf" },
  19443148: { by: "Vivek  Yadav", alt: "Painted clay doll in a green saree" },
  4721977: { by: "Marvel Prasanth", alt: "Painted terracotta horse head" },
  9420380: { by: "Skyler Ewing", alt: "Brass ewer with pink flowers" },
  18449692: { by: "Hatice Baran", alt: "Terracotta vases with tall plants" },
  15037675: { by: "Luke Y", alt: "Cream ceramic vases with white flowers" },
  37283574: { by: "Gốm sứ Cương Duyên", alt: "Hand-painted floral ceramic vases" },
  10722286: { by: "Nothing Ahead", alt: "Terracotta pots with succulents on a ledge" },
  10838714: { by: "Ta nya", alt: "Pale peonies in a hammered brass pot" },
  8515709: { by: "Cromwell Ken", alt: "Pierced brass ceiling lamp" },
  29966400: { by: "Pew Nguyen", alt: "Woven cane pendant lamps lit" },
  11263713: { by: "Ahmed Aqtai", alt: "Black metal lantern with green glass" },
  40242712: { by: "tommy picone", alt: "Hanging brass lamp on a chain" },
  39277493: { by: "Tamanna Rumee", alt: "Jar candles on pink satin" },
  8617327: { by: "Pedro Nollet-Sumida", alt: "Lit ivory pillar candles" },
  34056610: { by: "ViAn Photography", alt: "Wedding scene of dressed dolls" },
  352901: { by: "Digital Buggu", alt: "Hand-painted wooden figurines carrying pots" },
  3135229: { by: "Rahul Pandit", alt: "Painted clay diyas in blue, red and gold" },
  13689170: { by: "A Vasan", alt: "Clay diyas lit on brass saucers along a ledge" },
  29614743: { by: "Renato Dehnhardt", alt: "Red and orange paper star lanterns lit" },
  29917466: { by: "Christina & Peter", alt: "Straw star ornament on a fir branch" },
  39078425: { by: "Onur", alt: "Ornate lidded brass and copper boxes" },
  36355530: { by: "Naresh Babu", alt: "Embossed silver-coloured boxes stacked" },
  10424885: { by: "Rohan Dewangan", alt: "Hands holding a painted lacquer box" },
  12025443: { by: "Mr. Mockup", alt: "Plain jute tote bag" },
  34431714: { by: "Suhas Hanjar", alt: "Small brass diyas lit in the dark" },
  29140977: { by: "K", alt: "Brass elephant incense holder with a stick" },
  8819577: { by: "Yan Krukau", alt: "Stacked gift boxes with marigolds and lights" },
  39042286: { by: "Alfredo Dacosta", alt: "Gift tins in a basket with green tulle and gold ribbon" },
  30770345: { by: "Ravi Roshan", alt: "Gift basket wrapped in tulle with flowers" },
  // categories, home and pages
  8819218: { by: "Yan Krukau", alt: "Brass lamps and vessels being lit" },
  26582564: { by: "Valeria Boltneva", alt: "Painted plates on an orange wall" },
  15755947: { by: "Swastik Arora", alt: "Brass Nataraja, lamps and Krishna at a craft fair" },
  18449690: { by: "Hatice Baran", alt: "Terracotta vases among plants" },
  34941063: { by: "Ivett M", alt: "Cane lamps hanging in a shop" },
  815580: { by: "Gagan Deep", alt: "Tray of lit clay diyas" },
  194457: { by: "Digital Buggu", alt: "Painted clay dolls" },
  3014862: { by: "Jonathan Borba", alt: "Return-gift boxes arranged on a table" },
  8819840: { by: "Yan Krukau", alt: "Gift boxes with marigolds on a brass tray" },
  8819212: { by: "Yan Krukau", alt: "Pooja corner with a lit brass lamp, carved panel, brass vessels and painted diyas" },
  5779553: { by: "Fanusta Global", alt: "Reading corner with a painted panel, lanterns and a chair" },
  11255453: { by: "Sharath G.", alt: "Brass uruli with marigolds and flower petals" },
  37415406: { by: "Harsh  Kukadiya", alt: "Heritage sitting room with brass and mirrors" },
  33294116: { by: "Yeşim Çolak", alt: "Copper jug with dried wheat" },
  31738797: { by: "Luk Sauvage", alt: "Brass urn with dried flowers" },
  12573352: { by: "Vishwanth PindiBoina", alt: "Brass Vinayagar idol" },
  10386595: { by: "Kakhraman Nazarov", alt: "Hanging metal lamps under a wooden ceiling" },
  24206108: { by: "Markus Winkler", alt: "Brass elephants and painted figurines" },
  33846114: { by: "Abhishek  Navlakha", alt: "Carved wooden mandir with a Vinayagar" },
  37351741: { by: "Abhishek  Shekhawat", alt: "Heritage living room with arches and lamps" },
  16052116: { by: "Efnan Yılmaz", alt: "Potted plants against a pink wall" },
  33448055: { by: "Aysh 04", alt: "Heap of unfired clay moulds" },
  19781878: { by: "Panta Singha", alt: "Metal melting in a crucible under a flame" },
  11020230: { by: "Bulat Khamitov", alt: "Molten metal poured into small moulds" },
  2610378: { by: "grunge texture", alt: "Polished brass bells hanging" },
  3873488: { by: "Magda Ehlers", alt: "White gift boxes tied with red and orange ribbons" },
};

const HOURS = [
  { label: "Mon – Sat", value: "10:00 am – 9:00 pm" },
  { label: "Sunday", value: "11:00 am – 2:00 pm" },
];

const FAQ = [
  {
    q: "Is everything really handmade?",
    a: "Yes: cast, carved, painted, woven or thrown by hand in workshops around **Kumbakonam, Nachiarkoil, Swamimalai, Thanjavur, Manamadurai and Puducherry**. That is why two lamps of the same size can differ a little in colour, weight or casting marks (±5%). We don't treat these as defects; if a piece is chipped, cracked or not as described, it is replaced (see the breakage question).",
  },
  {
    q: "What if something arrives broken?",
    a: "Fragile pieces travel double-boxed with paper padding. **Record a video while you open the parcel** and send it on WhatsApp within **48 hours** of delivery: we replace the piece free, or refund it. Without an unboxing video we can still help, but we may need the courier's inspection first.",
  },
  {
    q: "How do I order return gifts in bulk?",
    a: "Pick a gift and the **Pack of 25** or **Pack of 50**, or send us the count and the date on **WhatsApp** for 100 or more. Bulk orders ship in 3–5 working days (7 for printed jute totes); each piece is packed in a potli or box with a thank-you card, and we can write your names and the date on the cards.",
  },
  {
    q: "Do you ship outside Tamil Nadu?",
    a: "Yes, across India by courier in 4–8 days (₹250, free above ₹7,999; prepaid only). Inside **Kumbakonam** our own van delivers the same or next day, and the rest of **Tamil Nadu and Puducherry** gets courier in 2–5 days with cash on delivery.",
  },
  {
    q: "Are these GI-tagged products?",
    a: "Nachiarkoil lamps, Thanjavur paintings, Thanjavur dolls and Swamimalai bronzes are registered geographical indications. We sell our pieces as **'-style' or 'in the tradition'** and don't claim a GI tag; if you need a GI-certified piece with the maker's authorised-user certificate, ask us and we'll quote one separately.",
  },
];

const FAQ_TA = [
  {
    q: "எல்லாமே உண்மையில் கையால் செய்தவையா?",
    a: "ஆம்: **கும்பகோணம், நாச்சியார்கோவில், சுவாமிமலை, தஞ்சாவூர், மானாமதுரை, புதுச்சேரி** பட்டறைகளில் கையால் வார்த்தவை, செதுக்கியவை, வரைந்தவை, நெய்தவை, சக்கரத்தில் செய்தவை. அதனால்தான் ஒரே அளவுள்ள இரண்டு விளக்குகளின் நிறம், எடை, வார்ப்புக் குறிகள் சற்று மாறலாம் (±5%). இவை குறைபாடுகள் அல்ல; பொருள் உடைந்தோ, விரிசலுடனோ, விவரிப்புக்கு மாறாகவோ வந்தால் மாற்றித் தருவோம்.",
  },
  {
    q: "பொருள் உடைந்து வந்தால் என்ன செய்வது?",
    a: "உடையக்கூடியவை இரட்டைப் பெட்டியில், காகித அடுக்குடன் வரும். **பார்சலைத் திறக்கும்போது வீடியோ எடுங்கள்**, டெலிவரியான **48 மணி நேரத்துக்குள்** வாட்ஸ்அப்பில் அனுப்புங்கள்: இலவசமாக மாற்றித் தருவோம் அல்லது பணத்தைத் திருப்புவோம். வீடியோ இல்லாவிட்டாலும் உதவுவோம், ஆனால் கூரியரின் ஆய்வு முதலில் தேவைப்படலாம்.",
  },
  {
    q: "தாம்பூலப் பரிசுகளை மொத்தமாக எப்படி ஆர்டர் செய்வது?",
    a: "ஒரு பரிசைத் தேர்ந்தெடுத்து **25 பேக்** அல்லது **50 பேக்** எடுங்கள்; 100-க்கு மேல் என்றால் எண்ணிக்கையையும் தேதியையும் **வாட்ஸ்அப்பில்** அனுப்புங்கள். மொத்த ஆர்டர்கள் 3–5 வேலை நாளில் அனுப்பப்படும் (பெயர் அச்சிட்ட சணல் பைகளுக்கு 7 நாள்); ஒவ்வொன்றும் பொட்டலம் அல்லது பெட்டியில், நன்றி அட்டையுடன்; அட்டைகளில் உங்கள் பெயர்களையும் தேதியையும் எழுதித் தருவோம்.",
  },
  {
    q: "தமிழ்நாட்டுக்கு வெளியே அனுப்புவீர்களா?",
    a: "ஆம், இந்தியா முழுவதும் கூரியரில் 4–8 நாளில் (₹250, ₹7,999-க்கு மேல் இலவசம்; முன்பணம் மட்டும்). **கும்பகோணத்துக்குள்** எங்கள் வண்டி அன்றோ மறுநாளோ கொண்டு வரும்; **தமிழ்நாடு, புதுச்சேரியின்** பிற பகுதிகளுக்கு 2–5 நாளில் கூரியர், டெலிவரியில் பணம் செலுத்தலாம்.",
  },
  {
    q: "இவை புவிசார் குறியீடு பெற்ற பொருட்களா?",
    a: "நாச்சியார்கோவில் விளக்கு, தஞ்சாவூர் ஓவியம், தஞ்சாவூர் பொம்மை, சுவாமிமலை வெண்கலச் சிலைகள் பதிவு பெற்ற புவிசார் குறியீடுகள். எங்கள் பொருட்களை **'பாணி' அல்லது 'மரபில்'** என்றே விற்கிறோம், புவிசார் குறியீடு எனக் கூறுவதில்லை; அங்கீகாரச் சான்றுடன் கூடிய பொருள் வேண்டுமானால் கேளுங்கள், தனியாக விலை சொல்வோம்.",
  },
];

/** A translated item whose fields differ between items (some have a button): a plain record (docs/verticals.md step 4). */
const tr = (o: Record<string, string | { label: string }>) => o;

const BULK_TEXT = (gift: string) => `Hello Kalaiyagam, I'd like ${gift} as return gifts. Count: … Date of the function: … Names / message for the cards: … Delivery pincode: …`;
const ASK_TEXT = "Hello Kalaiyagam, I'm looking for a gift. Occasion: … For: … Budget: …";

export const KALAIYAGAM: DemoStore = {
  shop: {
    slug: "kalaiyagam",
    appId: "EC",
    businessType: "home_decor",
    planId: "pro",
    name: "Kalaiyagam Décor & Gifts",
    primary: "#e2b04a",
    billing: {
      legalName: "Kalaiyagam Décor & Gifts",
      gstin: "33AAEFK4815G1ZM",
      address: "41, Big Street (Periya Theru), near the Sarangapani temple",
      city: "Kumbakonam",
      pincode: "612001",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "KG",
      upiId: "kalaiyagam@okaxis",
    },
    // Counter work (SAC 998719, repair of other goods / 998599 other support services: 18%); rates are GST-exclusive.
    items: [
      { name: "Brass lamp polishing and re-lacquering", hsn: "998719", unit: "pcs", rate: 16_949, gstRate: 18 },
      { name: "Gift wrapping with a hand-written card", hsn: "998599", unit: "pcs", rate: 4_237, gstRate: 18 },
    ],
  },
  preset: "polished-brass",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 1_000_000,
    minOrderValue: 20_000,
    contactPhone: PHONE,
    contactEmail: "hello@kalaiyagam.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/kalaiyagam" },
    policies: {
      shipping:
        "**Kumbakonam town (6120xx):** our own van, hand-carried, same or next day, ₹60, free above ₹1,999.\n\n**Tamil Nadu and Puducherry:** courier in 2–5 days, ₹120, free above ₹2,999, cash on delivery up to ₹10,000.\n\n**Rest of India:** courier in 4–8 days, ₹250, free above ₹7,999, prepaid only.\n\n**Fragile items** (terracotta, ceramics, glass, paintings, framed mirrors) are double-boxed with paper padding and corner guards; big pieces may go as two parcels. Bulk return-gift orders ship in 3–5 working days.",
      returns:
        "**Handmade variations** (colour, casting marks, brush strokes, size within ±5%) are part of the craft and are not defects.\n\n**Breakage:** record a video while opening the parcel and send it on WhatsApp within **48 hours** of delivery; we replace the piece free or refund it in full. Claims without an unboxing video may need the courier's inspection first.\n\n**Change of mind:** unused pieces in their packing can be returned within 7 days (you pay the return courier). Personalised items (printed totes, written cards), opened candles and bulk return-gift packs can't be returned unless damaged.",
      privacy: "We use your details only to deliver your order, send your GST bill and, if you ask, tell you about new pieces before festivals.",
      terms:
        "Prices include GST: 5% on handcrafted brass, bronze, wood, terracotta, ceramic, candles, paintings, dolls and lamps (Notification 13/2025-Central Tax (Rate)); nil on clay diyas; 18% on artificial flowers, paper star lanterns and hampers that contain them. Handmade pieces vary slightly from the photographs. Pieces sold as 'Nachiarkoil-style', 'Thanjavur-style' or 'in the Swamimalai tradition' are not GI-certified.",
    },
    businessType: "home_decor",
  },
  zones: [
    {
      name: "Kumbakonam town (our van)",
      pincodePrefixes: ["6120"],
      rate: { name: "Our van, hand-carried (same / next day)", type: "free_above", amount: 6_000, freeAbove: 199_900, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Tamil Nadu and Puducherry",
      states: ["33", "34"],
      rate: { name: "Courier, double-boxed for fragile items (2–5 days)", type: "free_above", amount: 12_000, freeAbove: 299_900, etaMinDays: 2, etaMaxDays: 5, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of India",
      rate: { name: "Courier, double-boxed (4–8 days, prepaid)", type: "free_above", amount: 25_000, freeAbove: 799_900, etaMinDays: 4, etaMaxDays: 8, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: BRASS, description: "Kuthu vilakku, deepams, urulis, pooja sets and bells, cast and polished around Kumbakonam.", photo: 8819218 },
    { name: WALL, description: "Thanjavur-style paintings, copper relief panels, wall plates, mirrors and teak frames.", photo: 26582564 },
    { name: CRAFTS, description: "Lost-wax bronzes, brass icons, wood carvings, Thanjavur dolls and terracotta horses.", photo: 15755947 },
    { name: VASES, description: "Brass kindis, terracotta floor vases and planters, hand-painted ceramics.", photo: 18449690 },
    { name: LIGHT, description: "Hand-pierced brass and woven cane lamps, lanterns, hanging oil lamps and hand-poured candles.", photo: 34941063 },
    { name: FESTIVE, description: "Diyas for Deepavali and Karthigai, golu dolls for Navaratri, stars for Christmas.", photo: 815580 },
    { name: GOLU, description: "Golu sets in clay, cloth and painted wood for the Navaratri steps.", photo: 194457, parent: FESTIVE },
    { name: RETURN, description: "Kumkum boxes, mini diyas, jute totes and more, by the piece or in packs of 25 and 50.", photo: 3014862 },
    { name: HAMPERS, description: "Deepavali, housewarming and wedding hampers, wrapped with your card.", photo: 39042286 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "Bestsellers", slug: "bestsellers", description: "What Kumbakonam and our WhatsApp regulars buy most.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "Return gifts", slug: "return-gifts", description: "Gifts to send home with every guest, ₹99 to ₹499 a piece, with bulk packs.", rule: { tag: "return-gift", sort: "price-asc" } },
    { name: "Navaratri golu", slug: "golu", description: "Golu sets, Thanjavur dolls and return gifts for golu visitors.", rule: { tag: "golu", sort: "price-asc" } },
    { name: "Deepavali", slug: "deepavali", description: "Lamps, diyas, urulis, candles and hampers for the festival of lights.", rule: { tag: "deepavali", sort: "price-asc" } },
    { name: "Christmas", slug: "christmas", description: "Paper star lanterns, straw stars, candles and lanterns.", rule: { tag: "christmas", sort: "price-asc" } },
    { name: "Housewarming", slug: "housewarming", description: "For a griha pravesam: lamps, urulis, icons and hampers.", rule: { tag: "housewarming", sort: "price-asc" } },
    { name: "Wedding gifts", slug: "wedding", description: "For the couple and for their guests.", rule: { tag: "wedding", sort: "price-desc" } },
    { name: "Pooja room", slug: "pooja-room", description: "Lamps, bells, thalis, icons and paintings for the pooja room.", rule: { tag: "pooja-room", sort: "price-asc" } },
    { name: "Living room", slug: "living-room", description: "Bronzes, paintings, vases and lamps for the hall.", rule: { tag: "living-room", sort: "price-asc" } },
    { name: "Entrance & doorway", slug: "entrance", description: "Door bells, urulis, relief panels and threshold lamps.", rule: { tag: "entrance", sort: "price-asc" } },
    { name: "Balcony & garden", slug: "balcony", description: "Terracotta, lanterns and cane for the sit-out.", rule: { tag: "balcony", sort: "price-asc" } },
    { name: "Thanjavur art", slug: "thanjavur", description: "Thanjavur-style paintings and dancing dolls.", rule: { tag: "thanjavur", sort: "price-desc" } },
    { name: "Gift hampers", slug: "gift-hampers", description: "Wrapped and ready, with your card.", rule: { category: HAMPERS, sort: "price-asc" } },
    { name: "On offer", slug: "on-offer", description: "Below MRP right now.", rule: { onSale: true, sort: "price-asc" } },
  ],
  coupons: [
    {
      code: "KALAI10",
      description: "10% off orders above ₹2,999 (up to ₹500)",
      type: "percent",
      value: 10,
      minOrder: 299_900,
      maxDiscount: 50_000,
      channels: ["store", "manual"],
    },
    {
      code: "FIRSTGIFT",
      description: "₹150 off your first order above ₹1,499",
      type: "flat",
      value: 15_000,
      minOrder: 149_900,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      channels: ["store"],
    },
  ],
  home: ({ photo, product }) => {
    const p = product;
    return {
      seo: {
        title: "Kalaiyagam Décor & Gifts, Kumbakonam: brass, Thanjavur art, gifts",
        description:
          "Nachiarkoil-style brass lamps, urulis, Thanjavur-style paintings and dolls, lost-wax bronzes, terracotta, lighting, golu dolls and return gifts in bulk, from Big Street, Kumbakonam. Shipped double-boxed across India.",
        imageUrl: photo(8819212),
      },
      sections: [
        {
          type: "gallery",
          id: "kl-wall",
          title: "The gallery wall",
          layout: "masonry",
          images: [
            { url: photo(5779553), alt: "Reading corner with a painted panel, lanterns and a chair", caption: "Lanterns for a quiet corner", href: "/c/lighting" },
            { url: photo(12896770), alt: "Embossed Vinayagar panel in a frame", caption: "Copper relief, beaten by hand", href: "/c/wall-art-and-frames" },
            { url: photo(11255453), alt: "Brass uruli with marigolds and flower petals", caption: "An uruli at the door", href: "/collections/entrance" },
            { url: photo(37415406), alt: "Heritage sitting room with brass and mirrors", caption: "A Chettinad-style hall", href: "/collections/living-room" },
            { url: photo(33294116), alt: "Copper jug with dried wheat", caption: "Copper for dried stems", href: "/c/vases-and-planters" },
            { url: photo(12573352), alt: "Brass Vinayagar idol", caption: "Icons in brass and bronze", href: "/c/handicrafts" },
            { url: photo(10386595), alt: "Hanging metal lamps under a wooden ceiling", caption: "Pierced lamps, star-lit rooms", href: "/c/lighting" },
            { url: photo(31738797), alt: "Brass urn with dried flowers", caption: "An old urn, new flowers", href: "/c/vases-and-planters" },
            { url: photo(24206108), alt: "Brass elephants and painted figurines", caption: "Elephants for luck", href: "/c/handicrafts" },
          ],
        },
        {
          type: "pricing-table",
          id: "kl-return-gifts",
          title: "Return gifts, priced per piece",
          text: "For weddings, seemantham, golu evenings and housewarmings. Prices include GST; each piece is packed in a potli or box with a thank-you card. Order 100 or more on WhatsApp.",
          style: { background: "muted" },
          plans: [
            {
              name: "Mini brass diya",
              price: rs(85),
              period: "per piece, in 50s",
              description: "₹90 in 25s, ₹99 for one",
              features: ["Cast brass, 2.5 inch", "Cloth potli and card", "Ships in 3 working days"],
              cta: { label: "Order on WhatsApp", href: waLink(BULK_TEXT("mini brass diyas")) },
            },
            {
              name: "Brass kumkum box",
              price: rs(165),
              period: "per piece, in 50s",
              description: "₹175 in 25s, ₹189 for one",
              features: ["Repoussé lotus lid", "Cloth potli and card", "Names and date on the cards"],
              highlight: true,
              badge: "Most ordered",
              cta: { label: "Order on WhatsApp", href: waLink(BULK_TEXT("brass kumkum boxes")) },
            },
            {
              name: "Jute gift tote",
              price: rs(109),
              period: "per piece, in 50s",
              description: "₹119 in 25s, ₹129 for one",
              features: ["Lined jute, rope handles", "Your names printed (50+)", "Ships in 7 working days"],
              cta: { label: "Order on WhatsApp", href: waLink(BULK_TEXT("jute gift totes")) },
            },
            {
              name: "Brass elephant incense holder",
              price: rs(310),
              period: "per piece, in 50s",
              description: "₹325 in 25s, ₹349 for one",
              features: ["Brass with enamel saddle", "Gift box and card", "Ships in 5 working days"],
              cta: { label: "Order on WhatsApp", href: waLink(BULK_TEXT("brass elephant incense holders")) },
            },
          ],
        },
        {
          type: "finder",
          id: "kl-gift-finder",
          title: "Gift finder",
          text: "Three taps: the occasion, who it's for, your budget. Skip any you're not sure of.",
          layout: "wizard",
          results: "inline",
          limit: 8,
          imageUrl: photo(8819840, "tile"),
          cta: { label: "Ask us on WhatsApp", href: waLink(ASK_TEXT) },
          questions: [
            {
              label: "What's the occasion?",
              options: [
                { label: "Housewarming", tag: "housewarming", imageUrl: photo(39160036, "square") },
                { label: "Wedding", tag: "wedding", imageUrl: photo(36950762, "square") },
                { label: "Deepavali", tag: "deepavali", imageUrl: photo(3135229, "square") },
                { label: "Navaratri golu", tag: "golu", imageUrl: photo(19443148, "square") },
                { label: "Christmas", tag: "christmas", imageUrl: photo(29614743, "square") },
                { label: "Just to say thank you", tag: "thank-you", imageUrl: photo(29140977, "square") },
              ],
            },
            {
              label: "Who is it for?",
              options: [
                { label: "The newlyweds", keywords: "newlyweds" },
                { label: "Parents and elders", keywords: "elders" },
                { label: "Hosts of a housewarming", keywords: "hosts" },
                { label: "Colleagues and teachers", keywords: "colleagues" },
                { label: "Every guest (return gifts)", keywords: "guests" },
              ],
            },
            {
              label: "Your budget?",
              options: [
                { label: "Under ₹500", priceMax: rs(500) },
                { label: "₹500 – ₹2,000", priceMin: rs(500), priceMax: rs(2_000) },
                { label: "₹2,000 – ₹5,000", priceMin: rs(2_000), priceMax: rs(5_000) },
                { label: "Above ₹5,000", priceMin: rs(5_000) },
              ],
            },
          ],
        },
        {
          type: "shop-the-look",
          id: "kl-pooja-room",
          title: "Shop the pooja corner",
          text: "A carved panel, a lit kuthu vilakku and a brass thali on an old blue chest. Tap a dot to see the piece.",
          imageUrl: photo(8819212),
          alt: "Pooja corner with a lit brass lamp, carved panel, brass vessels and painted diyas",
          hotspots: [
            { x: 25, y: 7, productId: p("Brass sunburst mirrors, set of 3") },
            { x: 40, y: 42, productId: p("Carved wood Vinayagar") },
            { x: 54, y: 66, productId: p("Nachiarkoil-style kuthu vilakku, peacock top") },
            { x: 80, y: 52, productId: p("Brass kindi vase") },
            { x: 63, y: 85, productId: p("Brass pooja thali set, 7 pieces") },
            { x: 12, y: 93, productId: p("Painted terracotta diyas") },
            { x: 9, y: 70, productId: p("Terracotta planters, set of 3") },
          ],
        },
        {
          type: "flash-sale",
          id: "kl-golu",
          title: "After-Navaratri golu sale",
          text: "Navaratri is over, next year's golu isn't: golu sets, Thanjavur dolls and terracotta at their lowest prices of the year, till 15 November.",
          startsAt: "2026-10-21T00:00:00+05:30",
          endsAt: "2026-11-15T21:00:00+05:30",
          source: "pick",
          productIds: [p("Kalyanam golu set, 5 dolls"), p("Village life golu set, 7 dolls"), p("Thanjavur-style thalaiyatti bommai, pair"), p("Painted terracotta horse"), p("Lacquered wooden kumkum box"), p("Brass kumkum box (chimizh)")],
          layout: "carousel",
          limit: 8,
          cta: { label: "All golu dolls", href: "/collections/golu" },
        },
        {
          type: "sticky-story",
          id: "kl-casting",
          title: "How a kuthu vilakku is made",
          imageSide: "left",
          chapters: [
            {
              eyebrow: "The mould",
              heading: "Four parts, four moulds",
              markdown:
                "A Nachiarkoil-style lamp isn't cast in one piece. The base, the stem, the bowl and the crown are each pressed into a mould of fine **Cauvery riverbed sand** and clay, packed in an iron frame. A family workshop near Kumbakonam keeps hundreds of patterns, some three generations old.",
              imageUrl: photo(33448055, "tile"),
              alt: "Heap of unfired clay moulds",
            },
            {
              eyebrow: "The melt",
              heading: "Brass at nine hundred degrees",
              markdown: "Old vessels and new brass ingots go into a clay crucible over a charcoal and blower fire until the metal runs like water, at about **900 °C**. The colour of the flame tells the caster when it's ready.",
              imageUrl: photo(19781878, "tile"),
              alt: "Metal melting in a crucible under a flame",
            },
            {
              eyebrow: "The pour",
              heading: "One steady pour",
              markdown: "The crucible is lifted with tongs and the metal poured in a single, unbroken stream so no air is trapped. The moulds cool for a few hours, then the sand is broken away: it can't be used twice.",
              imageUrl: photo(11020230, "tile"),
              alt: "Molten metal poured into small moulds",
            },
            {
              eyebrow: "Filing and polishing",
              heading: "Turned, threaded, buffed",
              markdown: "Each part is filed, turned on a lathe, threaded so it screws into the next, and buffed until it shines. A 12 inch lamp spends **two days** in the workshop; the screw joints are why you can take it apart to clean.",
              imageUrl: photo(2610378, "tile"),
              alt: "Polished brass bells hanging",
            },
            {
              eyebrow: "Lit at home",
              heading: "The first evening",
              markdown: "Oil, five cotton wicks, a match: the lamp's first light, in your pooja room. Polish it before festivals with tamarind or lemon and ash, as your grandmother did.",
              imageUrl: photo(8819140, "tile"),
              alt: "Lit brass kuthu vilakku in front of a carved wooden panel",
              cta: { label: "Shop kuthu vilakku", href: "/c/brass-and-lamps" },
            },
          ],
        },
        {
          type: "tiles",
          id: "kl-rooms",
          title: "Shop by room",
          layout: "grid",
          showCounts: true,
          items: [
            { label: "Pooja room", note: "Lamps, bells, thalis, icons", imageUrl: photo(33846114, "square"), collectionSlug: "pooja-room" },
            { label: "Living room", note: "Bronzes, paintings, vases", imageUrl: photo(37351741, "square"), collectionSlug: "living-room" },
            { label: "Entrance & doorway", note: "Door bells, urulis, relief panels", imageUrl: photo(26598244, "square"), collectionSlug: "entrance" },
            { label: "Balcony & garden", note: "Terracotta, lanterns, cane", imageUrl: photo(16052116, "square"), collectionSlug: "balcony" },
          ],
        },
        {
          type: "hero-split",
          id: "kl-gifting",
          imageUrl: photo(3873488, "tile"),
          imageSide: "right",
          eyebrow: "Gifting, done for you",
          heading: "Wrapped, written and sent, from Kumbakonam",
          text: "Tell us the occasion and the budget: we pick, wrap and write the card by hand, and send it double-boxed anywhere in India. Hampers from ₹1,950; return gifts from ₹85 a piece in bulk.",
          cta: { label: "Gift hampers", href: "/collections/gift-hampers" },
          cta2: { label: "Bulk gifting", href: "/pages/bulk-gifting" },
          style: { background: "brand" },
        },
        {
          type: "product-tabs",
          id: "kl-shelves",
          title: "On the shelves",
          layout: "grid",
          limit: 8,
          tabs: [
            { label: "New in", source: "new" },
            { label: "Bestsellers", source: "collection", collectionSlug: "bestsellers" },
            { label: "Hampers", source: "collection", collectionSlug: "gift-hampers" },
            { label: "On offer", source: "sale" },
          ],
        },
        {
          type: "logos",
          id: "kl-towns",
          title: "Where our pieces come from",
          items: [
            { name: "Nachiarkoil · brass lamps", href: "/search?q=Nachiarkoil" },
            { name: "Swamimalai · bronze", href: "/search?q=Swamimalai" },
            { name: "Thanjavur · paintings & dolls", href: "/collections/thanjavur" },
            { name: "Kumbakonam · brass vessels", href: "/c/brass-and-lamps" },
            { name: "Manamadurai · terracotta", href: "/search?q=Manamadurai" },
            { name: "Puducherry · candles & ceramics", href: "/search?q=Puducherry" },
          ],
        },
        {
          type: "testimonials",
          id: "kl-voices",
          title: "From our gifting customers",
          layout: "single",
          style: { span: "half" },
          items: [
            { quote: "Two hundred brass kumkum boxes for my daughter's wedding, every one in a potli with our names on the card, delivered to the mandapam in Thanjavur two days early.", name: "Meenakshi R.", role: "Bride's mother, Thanjavur", rating: 5 },
            { quote: "The Gajalakshmi painting reached Pune without a scratch: three boxes, corner guards, and they asked me to film the unboxing. It's the first thing guests see.", name: "Karthik S.", role: "Housewarming, Pune", rating: 5 },
            { quote: "I asked for a thank-you gift for twelve teachers under ₹500 each. They suggested the elephant incense holders and wrote every card by hand.", name: "Priya V.", role: "Parent, Chennai", rating: 5 },
          ],
        },
        { type: "faq", id: "kl-faq", title: "Handmade, breakage and bulk orders", items: FAQ, style: { span: "half" } },
        {
          type: "location",
          id: "kl-visit",
          title: "On Big Street, Kumbakonam",
          address: "41, Big Street (Periya Theru), near the Sarangapani temple, Kumbakonam 612001",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "10.9592, 79.3772",
        },
      ],
      translations: {
        ta: {
          "kl-wall": {
            title: "கலைச் சுவர்",
            images: [
              { alt: "ஓவியப் பலகை, லாந்தர்கள், நாற்காலியுடன் ஒரு வாசிப்பு மூலை", caption: "அமைதியான மூலைக்கு லாந்தர்கள்" },
              { alt: "சட்டமிட்ட புடைப்பு விநாயகர் பலகை", caption: "கையால் அடித்த செம்புப் புடைப்பு" },
              { alt: "சாமந்தி, பூ இதழ்களுடன் பித்தளை உருளி", caption: "வாசலில் ஒரு உருளி" },
              { alt: "பித்தளையும் கண்ணாடிகளும் உள்ள பாரம்பரிய வரவேற்பறை", caption: "செட்டிநாட்டுப் பாணிக் கூடம்" },
              { alt: "உலர்ந்த கோதுமைக் கதிர்களுடன் செம்புக் கூஜா", caption: "உலர் தண்டுகளுக்குச் செம்பு" },
              { alt: "பித்தளை விநாயகர் சிலை", caption: "பித்தளை, வெண்கலச் சிலைகள்" },
              { alt: "மரக்கூரையின் கீழ் தொங்கும் உலோக விளக்குகள்", caption: "துளையிட்ட விளக்குகள், நட்சத்திர ஒளி" },
              { alt: "உலர் பூக்களுடன் பித்தளைப் பாத்திரம்", caption: "பழைய பாத்திரம், புதிய பூக்கள்" },
              { alt: "பித்தளை யானைகளும் வர்ணச் சிலைகளும்", caption: "அதிர்ஷ்ட யானைகள்" },
            ],
          },
          "kl-return-gifts": {
            title: "தாம்பூலப் பரிசுகள், ஒன்றுக்கு விலை",
            text: "திருமணம், சீமந்தம், கொலு மாலைகள், கிரகப்பிரவேசத்துக்கு. விலைகள் GST உட்பட; ஒவ்வொன்றும் பொட்டலம் அல்லது பெட்டியில், நன்றி அட்டையுடன். 100-க்கு மேல் வாட்ஸ்அப்பில் ஆர்டர் செய்யுங்கள்.",
            plans: [
              { name: "சிறிய பித்தளை அகல்", period: "ஒன்றுக்கு, 50-களில்", description: "25-களில் ₹90, ஒன்று ₹99", features: ["வார்த்த பித்தளை, 2.5 அங்குலம்", "துணிப் பொட்டலம், அட்டை", "3 வேலை நாளில் அனுப்புவோம்"], badge: "", cta: { label: "வாட்ஸ்அப்பில் ஆர்டர்" } },
              { name: "பித்தளைக் குங்குமச் சிமிழ்", period: "ஒன்றுக்கு, 50-களில்", description: "25-களில் ₹175, ஒன்று ₹189", features: ["தாமரைப் புடைப்பு மூடி", "துணிப் பொட்டலம், அட்டை", "அட்டைகளில் பெயர், தேதி"], badge: "அதிகம் ஆர்டரானது", cta: { label: "வாட்ஸ்அப்பில் ஆர்டர்" } },
              { name: "சணல் பரிசுப் பை", period: "ஒன்றுக்கு, 50-களில்", description: "25-களில் ₹119, ஒன்று ₹129", features: ["உள்துணியுடன் சணல், கயிற்றுக் கைப்பிடி", "உங்கள் பெயர்கள் அச்சில் (50+)", "7 வேலை நாளில் அனுப்புவோம்"], badge: "", cta: { label: "வாட்ஸ்அப்பில் ஆர்டர்" } },
              { name: "பித்தளை யானை ஊதுபத்தி ஸ்டாண்ட்", period: "ஒன்றுக்கு, 50-களில்", description: "25-களில் ₹325, ஒன்று ₹349", features: ["எனாமல் சேணத்துடன் பித்தளை", "பரிசுப் பெட்டி, அட்டை", "5 வேலை நாளில் அனுப்புவோம்"], badge: "", cta: { label: "வாட்ஸ்அப்பில் ஆர்டர்" } },
            ],
          },
          "kl-gift-finder": {
            title: "பரிசு தேர்வி",
            text: "மூன்று தொடுதல்: நிகழ்ச்சி, யாருக்கு, உங்கள் பட்ஜெட். தெரியாததைத் தவிர்க்கலாம்.",
            cta: { label: "வாட்ஸ்அப்பில் கேளுங்கள்" },
            questions: [
              { label: "என்ன நிகழ்ச்சி?", options: [{ label: "கிரகப்பிரவேசம்" }, { label: "திருமணம்" }, { label: "தீபாவளி" }, { label: "நவராத்திரி கொலு" }, { label: "கிறிஸ்துமஸ்" }, { label: "நன்றி சொல்ல" }] },
              { label: "யாருக்கு?", options: [{ label: "புதுமணத் தம்பதி" }, { label: "பெற்றோர், பெரியோர்" }, { label: "புதுமனை புகுவோர்" }, { label: "சக ஊழியர், ஆசிரியர்" }, { label: "எல்லா விருந்தினருக்கும் (தாம்பூலம்)" }] },
              { label: "உங்கள் பட்ஜெட்?", options: [{ label: "₹500-க்குள்" }, { label: "₹500 – ₹2,000" }, { label: "₹2,000 – ₹5,000" }, { label: "₹5,000-க்கு மேல்" }] },
            ],
          },
          "kl-pooja-room": {
            title: "பூஜை மூலையை வாங்குங்கள்",
            text: "செதுக்கிய பலகை, ஏற்றிய குத்துவிளக்கு, பழைய நீலப் பெட்டியின் மேல் பித்தளைத் தட்டு. பொருளைப் பார்க்கப் புள்ளியைத் தொடுங்கள்.",
            alt: "ஏற்றிய பித்தளை விளக்கு, செதுக்கிய பலகை, பித்தளைப் பாத்திரங்கள், வர்ண அகல்களுடன் பூஜை மூலை",
          },
          "kl-golu": {
            title: "நவராத்திரிக்குப் பிந்தைய கொலு விற்பனை",
            text: "நவராத்திரி முடிந்தது, அடுத்த ஆண்டுக் கொலு இன்னும் வரவில்லை: கொலு செட்டுகள், தஞ்சாவூர் பொம்மைகள், சுடுமண் பொருட்கள் ஆண்டின் குறைந்த விலையில், நவம்பர் 15 வரை.",
            cta: { label: "எல்லா கொலு பொம்மைகளும்" },
          },
          "kl-casting": {
            title: "குத்துவிளக்கு எப்படி உருவாகிறது",
            chapters: [
              tr({ eyebrow: "அச்சு", heading: "நான்கு பாகம், நான்கு அச்சு", markdown: "நாச்சியார்கோவில் பாணி விளக்கு ஒரே துண்டாக வார்க்கப்படுவதில்லை. அடி, தண்டு, கிண்ணம், உச்சி ஒவ்வொன்றும் **காவிரி ஆற்று மணலும்** களிமண்ணும் கலந்த அச்சில், இரும்புச் சட்டத்துக்குள் அழுத்தப்படுகின்றன. கும்பகோணம் அருகே ஒரு குடும்பப் பட்டறையில் நூற்றுக்கணக்கான மாதிரிகள் உள்ளன, சில மூன்று தலைமுறை பழமையானவை.", alt: "சுடாத களிமண் அச்சுகளின் குவியல்" }),
              tr({ eyebrow: "உருக்குதல்", heading: "தொள்ளாயிரம் டிகிரியில் பித்தளை", markdown: "பழைய பாத்திரங்களும் புதிய பித்தளைக் கட்டிகளும் களிமண் குடுவையில், கரி, ஊதுலைத் தீயில், உலோகம் நீர்போல் ஓடும் வரை, சுமார் **900 °C**-இல் உருகுகின்றன. தயாரா என்பதைத் தீயின் நிறமே வார்ப்பவருக்குச் சொல்லும்.", alt: "தீயின் கீழ் குடுவையில் உருகும் உலோகம்" }),
              tr({ eyebrow: "வார்த்தல்", heading: "ஒரே சீரான வார்ப்பு", markdown: "குறடுகளால் குடுவையைத் தூக்கி, காற்று சிக்காதபடி இடைவிடாத ஒரே ஓட்டமாக உலோகம் ஊற்றப்படுகிறது. சில மணி நேரம் அச்சுகள் ஆறிய பின் மணல் உடைக்கப்படும்: அதை மீண்டும் பயன்படுத்த முடியாது.", alt: "சிறிய அச்சுகளில் ஊற்றப்படும் உருகிய உலோகம்" }),
              tr({ eyebrow: "அராவுதல், மெருகேற்றல்", heading: "கடைந்து, மரை வெட்டி, மின்னும் வரை", markdown: "ஒவ்வொரு பாகமும் அராவப்பட்டு, கடைசல் இயந்திரத்தில் கடைந்து, அடுத்ததில் திருகும்படி மரை வெட்டி, மின்னும் வரை மெருகேற்றப்படுகிறது. 12 அங்குல விளக்கு பட்டறையில் **இரண்டு நாள்** இருக்கும்; திருகு இணைப்புகளால்தான் சுத்தம் செய்யப் பிரிக்க முடிகிறது.", alt: "மெருகேற்றிய பித்தளை மணிகள் தொங்குகின்றன" }),
              tr({ eyebrow: "வீட்டில் ஏற்றுதல்", heading: "முதல் மாலை", markdown: "எண்ணெய், ஐந்து பருத்தித் திரிகள், ஒரு தீக்குச்சி: உங்கள் பூஜையறையில் விளக்கின் முதல் ஒளி. பண்டிகைக்கு முன் புளி அல்லது எலுமிச்சையும் சாம்பலும் கொண்டு, உங்கள் பாட்டி செய்தது போலவே, மெருகேற்றுங்கள்.", alt: "செதுக்கிய மரப்பலகை முன் ஏற்றிய பித்தளைக் குத்துவிளக்கு", cta: { label: "குத்துவிளக்குகள்" } }),
            ],
          },
          "kl-rooms": {
            title: "அறை வாரியாக",
            items: [
              { label: "பூஜையறை", note: "விளக்குகள், மணிகள், தட்டுகள், சிலைகள்" },
              { label: "வரவேற்பறை", note: "வெண்கலச் சிலைகள், ஓவியங்கள், பூச்சாடிகள்" },
              { label: "வாசல், நுழைவாயில்", note: "வாசல் மணிகள், உருளிகள், புடைப்புப் பலகைகள்" },
              { label: "பால்கனி, தோட்டம்", note: "சுடுமண், லாந்தர்கள், பிரம்பு" },
            ],
          },
          "kl-gifting": {
            eyebrow: "பரிசளிப்பு, உங்களுக்காக நாங்கள்",
            heading: "கட்டி, எழுதி, கும்பகோணத்திலிருந்து அனுப்புவோம்",
            text: "நிகழ்ச்சியையும் பட்ஜெட்டையும் சொல்லுங்கள்: நாங்கள் தேர்ந்தெடுத்து, பொதிந்து, அட்டையைக் கையால் எழுதி, இந்தியாவில் எங்கும் இரட்டைப் பெட்டியில் அனுப்புவோம். பரிசுக் கூடைகள் ₹1,950 முதல்; மொத்தத் தாம்பூலப் பரிசுகள் ஒன்றுக்கு ₹85 முதல்.",
            cta: { label: "பரிசுக் கூடைகள்" },
            cta2: { label: "மொத்தப் பரிசுகள்" },
          },
          "kl-shelves": { title: "அலமாரிகளில்", tabs: [{ label: "புதியவை" }, { label: "அதிகம் விற்பவை" }, { label: "பரிசுக் கூடைகள்" }, { label: "சலுகையில்" }] },
          "kl-towns": {
            title: "எங்கள் பொருட்கள் வரும் ஊர்கள்",
            items: [{ name: "நாச்சியார்கோவில்" }, { name: "சுவாமிமலை" }, { name: "தஞ்சாவூர்" }, { name: "கும்பகோணம்" }, { name: "மானாமதுரை" }, { name: "புதுச்சேரி" }],
          },
          "kl-voices": {
            title: "எங்கள் பரிசு வாடிக்கையாளர்களிடமிருந்து",
            items: [
              { quote: "என் மகளின் திருமணத்துக்கு இருநூறு பித்தளைக் குங்குமச் சிமிழ்கள், ஒவ்வொன்றும் எங்கள் பெயர் எழுதிய அட்டையுடன் பொட்டலத்தில், தஞ்சாவூர் மண்டபத்துக்கு இரண்டு நாள் முன்பே வந்து சேர்ந்தன.", role: "மணமகளின் அம்மா, தஞ்சாவூர்" },
              { quote: "கஜலட்சுமி ஓவியம் ஒரு கீறல் கூட இல்லாமல் புனே வந்தது: மூன்று பெட்டிகள், மூலைக் காப்புகள், திறக்கும்போது வீடியோ எடுக்கச் சொன்னார்கள். விருந்தினர் முதலில் பார்ப்பது அதைத்தான்.", role: "கிரகப்பிரவேசம், புனே" },
              { quote: "பன்னிரண்டு ஆசிரியர்களுக்கு, ஒவ்வொன்றும் ₹500-க்குள் நன்றிப் பரிசு கேட்டேன். யானை ஊதுபத்தி ஸ்டாண்டைப் பரிந்துரைத்து, ஒவ்வொரு அட்டையையும் கையால் எழுதினார்கள்.", role: "பெற்றோர், சென்னை" },
            ],
          },
          "kl-faq": { title: "கைவினை, உடைவு, மொத்த ஆர்டர்கள்", items: FAQ_TA },
          "kl-visit": {
            title: "கும்பகோணம் பெரிய தெருவில்",
            address: "41, பெரிய தெரு, சாரங்கபாணி கோயில் அருகில், கும்பகோணம் 612001",
            hours: [
              { label: "திங்கள் – சனி", value: "காலை 10:00 – இரவு 9:00" },
              { label: "ஞாயிறு", value: "காலை 11:00 – மதியம் 2:00" },
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
        { type: "heading", level: 2, text: "Kalaiyagam, Big Street, Kumbakonam, since 1988" },
        {
          type: "paragraph",
          markdown:
            "Kalaiyagam began in **1988** as a brass-vessel shop on Big Street, a few minutes' walk from the Sarangapani temple, selling the lamps and urulis cast in the villages around Kumbakonam. Over the years we added the crafts of the delta: Thanjavur-style paintings and nodding dolls, lost-wax bronzes in the Swamimalai tradition, wood carving, Manamadurai terracotta, and candles and ceramics from Puducherry and Auroville's makers.\n\nToday most of our orders are gifts: return gifts for weddings and golu evenings, housewarming hampers, and paintings sent double-boxed to Tamil families across India. We still know most of our makers by name, and we still polish every lamp before it leaves.",
        },
        { type: "image", url: photo(8819218, "tile"), alt: "Brass lamps and vessels being lit" },
        { type: "paragraph", markdown: "Open Monday – Saturday 10 am – 9 pm, Sunday 11 am – 2 pm. Call or WhatsApp **+91 98765 00015**." },
      ],
    },
    {
      slug: "brass-care",
      title: "Brass care guide",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Keeping brass bright" },
        {
          type: "paragraph",
          markdown:
            "Our brass is **polished and left unlacquered**, the traditional way, so it darkens slowly with air, oil and hands. That patina is natural; bring the shine back whenever you like.\n\n**Every week:** wipe with a soft, dry cotton cloth. Wipe oil off lamps after each use while still warm.\n\n**Before a festival:**\n1. Rub with **tamarind pulp** soaked in warm water, or **half a lemon dipped in salt**; for heavy tarnish, add a pinch of wood ash or besan.\n2. Use an old toothbrush for carvings and engraving.\n3. Rinse in warm water and **dry at once** with a towel; water spots turn green.\n4. Buff with a dry cloth for the shine.\n\n**Don't:** use steel wool or scouring powder (they scratch), leave brass wet, or use tamarind on **nickel-finish** or **German-silver** pieces (a dry cloth is enough).\n\n**Bronze icons** keep their dark patina: dust with a soft brush and dry at once after abhishekam. **Polishing service:** bring lamps to the shop and we polish and re-lacquer them in two days (₹200 a piece).",
        },
        { type: "image", url: photo(11255453, "tile"), alt: "Brass uruli with marigolds and flower petals" },
      ],
    },
    {
      slug: "bulk-gifting",
      title: "Bulk gifting",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Return gifts and hampers in bulk" },
        {
          type: "paragraph",
          markdown:
            "| Gift | 1 piece | 25s (each) | 50s (each) |\n|---|---|---|---|\n| Mini brass diya | ₹99 | ₹90 | ₹85 |\n| Lacquered wooden kumkum box | ₹119 | ₹110 | ₹105 |\n| Jute gift tote | ₹129 | ₹119 | ₹109 |\n| Brass kumkum box | ₹189 | ₹175 | ₹165 |\n| German-silver kumkum box | ₹229 | ₹215 | ₹205 |\n| Brass elephant incense holder | ₹349 | ₹325 | ₹310 |\n\nPrices include GST (5%). For **100 or more** of one gift, or a mix, message us: we quote within a day.\n\n- **Packing:** each piece in a cloth potli or gift box with a thank-you card; we write your names and the date on the cards.\n- **Printed jute totes:** your names and date printed, from 50 pieces, 7 working days.\n- **Lead time:** 3–5 working days for stock gifts; book 3 weeks ahead in the wedding months (Thai, Panguni, Vaikasi, Avani) and before Navaratri.\n- **Delivery:** to the mandapam or your home; in Kumbakonam by our van.\n- **Corporate Deepavali hampers:** GST bill with your GSTIN, delivered to each address on your list.",
        },
        { type: "image", url: photo(3014862, "tile"), alt: "Return-gift boxes arranged on a table" },
        { type: "button", label: "Send your list on WhatsApp", href: waLink(BULK_TEXT("return gifts")), style: "primary" },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). They illustrate the kind of piece we sell and are not photographs of our makers' workshops; no brand logos appear.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, ph]) => `| ${ph.alt} | ${ph.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Brass & lamps", type: "category", ref: "brass-and-lamps", children: [{ label: "Lighting", type: "category", ref: "lighting" }, { label: "Brass care guide", type: "page", ref: "brass-care" }] },
      { label: "Art & crafts", type: "category", ref: "handicrafts", children: [{ label: "Wall art & frames", type: "category", ref: "wall-art-and-frames" }, { label: "Thanjavur art", type: "collection", ref: "thanjavur" }, { label: "Vases & planters", type: "category", ref: "vases-and-planters" }] },
      { label: "Festive", type: "category", ref: "festive-decor", children: [{ label: "Golu dolls", type: "category", ref: "golu-dolls" }, { label: "Deepavali", type: "collection", ref: "deepavali" }, { label: "Christmas", type: "collection", ref: "christmas" }] },
      { label: "Gifts", type: "category", ref: "return-gifts", children: [{ label: "Gift hampers", type: "category", ref: "gift-hampers" }, { label: "Bulk gifting", type: "page", ref: "bulk-gifting" }] },
      { label: "Our story", type: "page", ref: "about" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Brass care guide", type: "page", ref: "brass-care" },
          { label: "Bulk gifting", type: "page", ref: "bulk-gifting" },
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "Housewarming", type: "collection", ref: "housewarming" },
          { label: "Wedding gifts", type: "collection", ref: "wedding" },
          { label: "Our story", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
