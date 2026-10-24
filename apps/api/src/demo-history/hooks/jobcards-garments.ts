import type { Rng } from "../rng";
import type { Recipe } from "./jobcards";

/**
 * The tailoring side of the job-card hook (profile `tailoring`, Thaiyal Tailors & Boutique): garment recipes, the people
 * of the workroom and measurements in inches. Item names are the demo store's own ("<service> – <option>").
 */

export const GARMENT_STAFF = [
  { role: "Manager", name: "Rajeswari Sundaram" },
  { role: "Technician", name: "Selvi Murugesan" },
  { role: "Technician", name: "Ganesan Pandian" },
  { role: "Technician", name: "Thenmozhi Velu" },
  { role: "Cashier", name: "Pushpa Karthikeyan" },
];

const SELVI = "Selvi Murugesan";
const GANESAN = "Ganesan Pandian";
const THENMOZHI = "Thenmozhi Velu";
const RAJESWARI = "Rajeswari Sundaram";

const g = (type: "blouse" | "salwar" | "shirt" | "pant" | "other", styles: string[], name?: string) => ({ type, styles, ...(name ? { name } : {}) });

export const GARMENT_RECIPES: Recipe[] = [
  { id: "blouse-simple", weight: 4.2, device: "garment", garment: g("blouse", ["Round neck, elbow sleeve, plain back", "V neck, short sleeve, hooks in front", "Boat neck, 3/4 sleeve", "Round neck, back zip, cotton lining"]), labour: [["Simple blouse stitching – Unlined", "Simple blouse stitching – With cotton lining", "Simple blouse stitching – Lined and padded"]], issues: [], days: [2, 4], trial: false, tailor: SELVI },
  { id: "blouse-princess", weight: 3.2, device: "garment", garment: g("blouse", ["Princess cut, elbow sleeve, front hooks", "Princess cut, sleeveless, back zip", "Six-panel princess, full sleeve, piping on the neck"]), labour: [["Princess-cut blouse stitching – Sleeveless", "Princess-cut blouse stitching – Elbow sleeve", "Princess-cut blouse stitching – Full sleeve"]], issues: [], days: [3, 6], trial: true, tailor: SELVI },
  { id: "blouse-designer", weight: 2.2, device: "garment", garment: g("blouse", ["Boat neck back, latkans on the dori", "Keyhole back with piping", "Deep U back with dori", "Lace-up back, padded"]), labour: [["Designer blouse stitching – Boat neck", "Designer blouse stitching – Keyhole", "Designer blouse stitching – Deep U with dori", "Designer blouse stitching – Lace-up back", "Designer blouse stitching – Cut-out back"]], addons: ["Add-on: piping and latkans – Piping, neck and sleeves", "Add-on: piping and latkans – Piping and latkans", "Add-on: padding and cups"], issues: [], days: [4, 8], trial: true, tailor: SELVI },
  { id: "blouse-bridal", weight: 0.55, device: "garment", garment: g("blouse", ["Bridal back with zari aari flowers, lined and padded", "Heavy aari bridal blouse, stonework on the sleeves", "Elbow sleeve bridal blouse, peacock motif on the back"]), labour: [["Bridal blouse with aari work – Light aari, neck and sleeve edge", "Bridal blouse with aari work – Heavy aari, front and back", "Bridal blouse with aari work – Heavy aari with stones and beads"]], issues: [], days: [12, 21], approval: true, trial: true, tailor: THENMOZHI },
  { id: "aari-work", weight: 0.75, device: "garment", garment: g("blouse", ["Aari work on the neckline, gold thread", "Zari peacock on the back, sequins on the sleeve edge", "Mango motif in silk thread, full back"]), labour: [["Aari work on a blouse, by hand – Neckline only", "Aari work on a blouse, by hand – Neck and sleeve edge", "Aari work on a blouse, by hand – Full back and sleeves"]], issues: [], days: [6, 14], approval: true, trial: false, tailor: THENMOZHI },
  { id: "blouse-saree", weight: 0.7, device: "garment", garment: g("blouse", ["Silk saree blouse, contrast piping, fall and pico on the saree"]), labour: [["Blouse for a silk saree, with fall and pico – Light border", "Blouse for a silk saree, with fall and pico – Heavy zari border"]], issues: [], days: [4, 7], trial: true, tailor: SELVI },
  { id: "churidar", weight: 2.6, device: "garment", garment: g("salwar", ["Straight cut top, churidar bottom, three-quarter sleeve", "A-line top, side slits, churidar bottom", "Princess cut top, boat neck"]), labour: [["Churidar set stitching – Straight cut", "Churidar set stitching – A-line", "Churidar set stitching – Princess cut"]], issues: [], days: [3, 5], trial: false, tailor: SELVI },
  { id: "salwar-kameez", weight: 1.3, device: "garment", garment: g("salwar", ["Straight salwar, round neck", "Palazzo, kameez with side slits", "Patiala bottom, short kameez"]), labour: [["Salwar kameez, three piece – Straight salwar", "Salwar kameez, three piece – Palazzo", "Salwar kameez, three piece – Patiala"]], addons: ["Add-on: cotton lining"], issues: [], days: [3, 5], trial: false, tailor: SELVI },
  { id: "anarkali", weight: 0.9, device: "garment", garment: g("salwar", ["Floor length Anarkali, can-can, lace-up back", "Calf length Anarkali, 3/4 sleeve, boat neck"]), labour: [["Anarkali dress stitching – Knee length", "Anarkali dress stitching – Calf length", "Anarkali dress stitching – Floor length with can-can"]], issues: [], days: [5, 9], trial: true, tailor: SELVI },
  { id: "kurti", weight: 2.2, device: "garment", garment: g("salwar", ["Straight kurti, side slits, no pockets", "A-line kurti, pockets", "Long kurti below the knee"]), labour: [["Kurti stitching – Straight", "Kurti stitching – A-line", "Kurti stitching – Long, below the knee"]], issues: [], days: [1, 3], trial: false, tailor: SELVI },
  { id: "bottoms", weight: 1.1, device: "garment", garment: g("salwar", ["Churidar bottom, drawstring waist", "Palazzo, elastic waist", "Patiala, elastic waist"]), labour: [["Bottoms only: churidar, palazzo, Patiala – Churidar", "Bottoms only: churidar, palazzo, Patiala – Palazzo", "Bottoms only: churidar, palazzo, Patiala – Patiala"]], issues: [], days: [1, 2], trial: false, tailor: SELVI },
  { id: "langa-voni", weight: 0.6, device: "garment", garment: g("other", ["Pattu langa with blouse and voni hem", "Half saree with can-can, zari border"], "Langa voni"), labour: [["Langa voni and half saree stitching – Langa and blouse", "Langa voni and half saree stitching – Half saree with can-can"]], issues: [], days: [6, 9], trial: true, tailor: SELVI },
  { id: "pavadai", weight: 1.7, device: "garment", garment: g("other", ["Silk pavadai with blouse, two-inch margin", "Pavadai with jari lace hem and blouse"], "Pattu pavadai"), labour: [["Pattu pavadai for girls – 1 to 3 years", "Pattu pavadai for girls – 4 to 7 years", "Pattu pavadai for girls – 8 to 12 years"]], issues: [], days: [4, 8], trial: true, tailor: SELVI },
  { id: "frock", weight: 0.9, device: "garment", garment: g("other", ["Tiered net frock, satin lining, bow at the waist", "Party frock, back zip"], "Party frock"), labour: [["Party frock stitching – 1 to 3 years", "Party frock stitching – 4 to 7 years", "Party frock stitching – 8 to 12 years"]], issues: [], days: [4, 7], trial: true, tailor: SELVI },
  { id: "boys-set", weight: 0.9, device: "garment", garment: g("other", ["Shirt and elastic shorts, double stitched"], "Boys shirt and shorts"), labour: [["Boys shirt and shorts set – 2 to 5 years", "Boys shirt and shorts set – 6 to 9 years", "Boys shirt and shorts set – 10 to 14 years"]], issues: [], days: [3, 5], trial: false, tailor: GANESAN },
  { id: "boys-kurta", weight: 0.6, device: "garment", garment: g("other", ["Mandarin collar kurta with drawstring pyjama"], "Boys kurta pyjama"), labour: [["Boys kurta pyjama set – 2 to 5 years", "Boys kurta pyjama set – 6 to 9 years", "Boys kurta pyjama set – 10 to 14 years"]], issues: [], days: [4, 6], trial: false, tailor: GANESAN },
  { id: "shirt", weight: 2.3, device: "garment", garment: g("shirt", ["Full sleeve, one chest pocket, stitched placket", "Half sleeve, no pocket", "Full sleeve, lined collar and cuff"]), labour: [["Men's shirt stitching – Half sleeve", "Men's shirt stitching – Full sleeve", "Men's shirt stitching – Full sleeve, lined collar and cuff"]], issues: [], days: [3, 5], trial: false, tailor: GANESAN },
  { id: "pant", weight: 1.6, device: "garment", garment: g("pant", ["Plain front, slant pockets", "Single pleat, watch pocket", "Cotton, jeans style"]), labour: [["Men's pant stitching – Plain front", "Men's pant stitching – Single pleat", "Men's pant stitching – Jeans-style cotton"]], issues: [], days: [4, 6], trial: true, tailor: GANESAN },
  { id: "men-kurta", weight: 0.7, device: "garment", garment: g("shirt", ["Straight kurta with side slit and pyjama", "Cotton kurta, full sleeve"]), labour: [["Kurta and pyjama set, men – Cotton kurta", "Kurta and pyjama set, men – Kurta and pyjama", "Kurta and pyjama set, men – Silk kurta, lined"]], issues: [], days: [4, 6], trial: false, tailor: GANESAN },
  { id: "suit", weight: 0.3, device: "garment", garment: g("other", ["Two-piece suit, notch lapel, full lining", "Waistcoat, five buttons, back belt"], "Suit"), labour: [["Waistcoat and two-piece suit – Waistcoat", "Waistcoat and two-piece suit – Blazer and trouser"]], issues: [], days: [9, 14], approval: true, trial: true, tailor: GANESAN },
  { id: "alter-hem", weight: 3.4, device: "garment", garment: g("pant", ["Shorten by 2 inches, plain hem", "Hem with cuff, 1.5 inch", "Jeans, original hem kept"]), labour: [["Pant hemming and length alteration – Plain hem", "Pant hemming and length alteration – Hem with cuff", "Pant hemming and length alteration – Jeans, original hem kept"]], issues: [], days: [0, 0], trial: false, tailor: GANESAN, alteration: true },
  { id: "alter-fit", weight: 1.8, device: "garment", garment: g("pant", ["Waist in by 2 inches", "Taper both legs", "Shirt sides taken in", "Shirt sleeves shortened"]), labour: [["Pant and shirt fit alteration – Waist in or out, up to 2 inches", "Pant and shirt fit alteration – Taper both legs", "Pant and shirt fit alteration – Shirt: take in the sides", "Pant and shirt fit alteration – Shirt: shorten the sleeves"]], issues: [], days: [0, 2], trial: false, tailor: GANESAN, alteration: true },
  { id: "alter-blouse", weight: 3, device: "garment", garment: g("blouse", ["Loose at the waist, take in 1 inch", "Tight at the arm, let out", "Sleeve shortened to elbow", "Back neck deepened"]), labour: [["Blouse alteration – Take in or let out, up to 1.5 inches", "Blouse alteration – Shorten or lengthen the sleeve", "Blouse alteration – Deepen the front or back neck", "Blouse alteration – Add a lining or padding to a ready blouse"]], issues: [], days: [0, 2], trial: false, tailor: SELVI, alteration: true },
  { id: "alter-salwar", weight: 1.2, device: "garment", garment: g("salwar", ["Bottom shortened by 2 inches", "New elastic in the waist", "Top taken in at the sides"]), labour: [["Salwar and churidar alteration – Bottom length", "Salwar and churidar alteration – New elastic or drawstring", "Salwar and churidar alteration – Take in the top at the sides"]], issues: [], days: [0, 2], trial: false, tailor: SELVI, alteration: true },
  { id: "fall-pico", weight: 3.6, device: "garment", garment: g("other", ["Fall and pico, colour matched", "Pico only, soft silk", "Fall, pico and tassels"], "Saree"), labour: [["Saree fall and pico – Fall and pico", "Saree fall and pico – Pico only", "Saree fall and pico – Fall only", "Saree fall and pico – Fall, pico and tassels"]], issues: [], days: [0, 1], trial: false, tailor: SELVI, alteration: true },
  { id: "kuchu", weight: 0.5, device: "garment", garment: g("other", ["Hand-knotted silk thread tassels"], "Saree"), labour: [["Saree kuchu and tassels – Plain silk thread kuchu", "Saree kuchu and tassels – Beaded kuchu", "Saree kuchu and tassels – Zari thread kuchu"]], issues: [], days: [1, 3], trial: false, tailor: THENMOZHI },
  { id: "dupatta", weight: 0.8, device: "garment", garment: g("other", ["Rolled hem, chiffon", "Lace attached both ends"], "Dupatta"), labour: [["Dupatta hem and lace – Rolled hem", "Dupatta hem and lace – Lace attached, both ends"]], issues: [], days: [0, 2], trial: false, tailor: SELVI, alteration: true },
  { id: "uniform-set", weight: 0.9, device: "garment", garment: g("other", ["Shirt with pant (boys) and skirt (girls) in the school cloth, size list attached", "Class-wise bundles with a size list"], "School uniform"), labour: [["School uniform set, shirt and pant or skirt – 10 to 24 sets", "School uniform set, shirt and pant or skirt – 25 to 99 sets", "School uniform set, shirt and pant or skirt – 100 sets and above"]], issues: [], days: [10, 18], approval: true, trial: true, tailor: GANESAN, bulk: true },
  { id: "uniform-pinafore", weight: 0.45, device: "garment", garment: g("other", ["Pinafore with box pleats and plain blouse, size list attached"], "Pinafore and blouse"), labour: [["Pinafore and blouse set, girls – 10 to 24 sets", "Pinafore and blouse set, girls – 25 to 99 sets", "Pinafore and blouse set, girls – 100 sets and above"]], issues: [], days: [10, 18], approval: true, trial: true, tailor: GANESAN, bulk: true },
  { id: "uniform-house", weight: 0.3, device: "garment", garment: g("other", ["House-colour T-shirts with piping and matching shorts"], "House T-shirt and shorts"), labour: [["House-colour T-shirt and sports shorts – 10 to 24 sets", "House-colour T-shirt and sports shorts – 25 to 99 sets", "House-colour T-shirt and sports shorts – 100 sets and above"]], issues: [], days: [8, 14], approval: true, trial: false, tailor: GANESAN, bulk: true },
];

const half = (v: number) => Math.round(v * 2) / 2;

/** Measurements of one customer for a garment, in inches, keyed like the garment template (docs: jobcards templates). */
export function measurementsFor(type: "blouse" | "salwar" | "shirt" | "pant" | "other", r: Rng, name = ""): Record<string, number> {
  if (type === "other") {
    // Free-form garments (the template has no list for them): the few numbers a tailor notes. Uniforms go by a size list.
    const h = (a: number, b: number) => half(r.float(a, b));
    if (/pavadai|langa/i.test(name)) return { length: h(20, 38), waist: h(18, 28), hip: h(22, 34) };
    if (/frock|boys/i.test(name)) return { length: h(16, 30), chest: h(20, 30), waist: h(18, 26), shoulder: h(9, 13) };
    if (/suit/i.test(name)) return { chest: h(36, 44), waist: h(32, 40), shoulder: h(17, 19), length: h(28, 31), sleeveLength: h(24, 26) };
    return {};
  }
  const f = (a: number, b: number) => half(r.float(a, b));
  // One body size drives the circumferences so a customer's numbers agree with each other.
  const size = r.float(0, 1);
  const bust = f(32 + size * 12, 33 + size * 12);
  const waist = f(bust - r.float(3, 6), bust - r.float(3, 6));
  const hip = f(bust + r.float(2, 5), bust + r.float(2, 5));
  switch (type) {
    case "blouse":
      return { length: f(14, 16), bust, waist, shoulder: f(13.5, 15.5), armhole: f(15, 18), sleeveLength: f(5, 12), sleeveRound: f(11, 14.5), frontNeck: f(5, 8), backNeck: f(6, 11) };
    case "salwar":
      return { length: f(34, 42), bust, waist, hip, shoulder: f(13.5, 15.5), armhole: f(15, 18), sleeveLength: f(10, 18), sleeveRound: f(11, 14.5), frontNeck: f(5, 8), backNeck: f(6, 10), bottomLength: f(36, 40), bottomWaist: waist, ankle: f(8, 10.5) };
    case "shirt":
      return { length: f(28, 32), chest: f(36 + size * 10, 37 + size * 10), waist: f(32 + size * 10, 33 + size * 10), shoulder: f(16.5, 19), sleeveLength: f(22, 25), cuff: f(9, 10.5), collar: f(14.5, 17) };
    case "pant":
      return { length: f(38, 43), waist: f(30 + size * 10, 31 + size * 10), hip: f(38 + size * 8, 39 + size * 8), thigh: f(22, 26), knee: f(16, 19), bottom: f(14, 17), seat: f(26, 30) };
  }
}

/** Sets on a bulk order from its size slab ("… – 25 to 99 sets"). */
export function bulkQty(name: string, r: Rng): number {
  if (/100 sets and above/.test(name)) return r.int(100, 260);
  if (/25 to 99/.test(name)) return r.int(25, 90);
  return r.int(10, 24);
}
