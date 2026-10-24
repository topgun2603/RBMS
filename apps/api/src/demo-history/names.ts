import type { Rng } from "./rng";

/**
 * Tamil Nadu names, phone numbers and localities for demo customers and staff. Phones sit in the repo's fake test range
 * (+91 90000 0xxxx: 9000000000 to 9000009999). Not the e2e shops' +91 9999 0… block: `cleanup:e2e-data` deletes customers
 * with those numbers. Providers are also switched off while seeding, so nothing real is messaged.
 */

const MALE = [
  "Murugan", "Saravanan", "Karthik", "Senthil", "Arul", "Ganesh", "Vignesh", "Prakash", "Ramesh", "Suresh", "Mani", "Rajesh",
  "Kumar", "Selvam", "Anbu", "Bala", "Dinesh", "Gopal", "Harish", "Jegan", "Kannan", "Logesh", "Manikandan", "Natarajan",
  "Palani", "Rajkumar", "Sathish", "Thirumal", "Velu", "Venkatesh", "Elango", "Ilango", "Paranthaman", "Sundar", "Ravi",
];
const FEMALE = [
  "Selvi", "Meena", "Kavitha", "Lakshmi", "Vijaya", "Priya", "Revathi", "Saranya", "Anitha", "Deepa", "Geetha", "Hema",
  "Indira", "Jothi", "Kala", "Malathi", "Nithya", "Pushpa", "Radha", "Sudha", "Tamilselvi", "Uma", "Valli", "Yamuna",
  "Amudha", "Bhuvana", "Chitra", "Devi", "Eswari", "Kalpana", "Mythili", "Pavithra", "Sangeetha", "Thenmozhi",
];
const SUFFIX_M = ["Kumar", "Raj", "Murugan", "Sekar", "Pandian", "Mani", "Nathan", "Vel", "Babu", "Krishnan"];
const SUFFIX_F = ["Devi", "Priya", "Rani", "Selvi", "Mani", "Kumari", "Lakshmi"];
const INITIALS = ["R", "K", "S", "M", "A", "P", "V", "T", "N", "G", "B", "C", "D", "E", "J", "L"];

export interface PersonName {
  /** Display name, e.g. "R. Senthil Kumar" or "Meena Devi". */
  name: string;
  female: boolean;
}

export function personName(rng: Rng, opts: { female?: boolean } = {}): PersonName {
  const female = opts.female ?? rng.chance(0.48);
  const given = rng.pick(female ? FEMALE : MALE);
  const style = rng.int(0, 5);
  const initial = rng.pick(INITIALS);
  const suffix = rng.pick(female ? SUFFIX_F : SUFFIX_M);
  let name: string;
  if (style <= 1) name = `${initial}. ${given}`;
  else if (style === 2) name = `${initial}. ${given} ${suffix}`;
  else if (style === 3) name = `${given} ${suffix}`;
  else if (style === 4) name = given;
  else name = `${rng.pick(INITIALS)}. ${initial}. ${given}`;
  return { name, female };
}

/** `count` distinct names (a repeated draw is re-drawn; after many tries a number is appended). */
export function uniqueNames(rng: Rng, count: number): PersonName[] {
  const seen = new Set<string>();
  const out: PersonName[] = [];
  let guard = 0;
  while (out.length < count) {
    let p = personName(rng);
    if (seen.has(p.name) && ++guard > count * 20) p = { ...p, name: `${p.name} ${out.length + 1}` };
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }
  return out;
}

/** Fake mobile in the test range: +91 90000 0 + four digits. `n` is 0 to 9999 (the same n always gives the same number). */
export function testPhone(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error("test phone index must be 0…9999");
  return `+91900000${String(n).padStart(4, "0")}`;
}

export const isTestPhone = (phone: string) => /^\+91900000\d{4}$/.test(phone);

/** Localities per city (a generic Tamil Nadu list for any other city). */
const LOCALITIES: Record<string, string[]> = {
  Madurai: ["Anna Nagar", "KK Nagar", "Tallakulam", "Simmakkal", "Goripalayam", "Thirunagar", "Sellur", "Villapuram", "Pasumalai", "Mattuthavani"],
  Coimbatore: ["RS Puram", "Gandhipuram", "Peelamedu", "Saibaba Colony", "Singanallur", "Ganapathy", "Race Course", "Podanur", "Saravanampatti", "Vadavalli"],
  Salem: ["Fairlands", "Hasthampatti", "Suramangalam", "Alagapuram", "Ammapet", "Kitchipalayam", "Shevapet"],
  Tiruchirappalli: ["Srirangam", "Thillai Nagar", "Woraiyur", "Cantonment", "Ariyamangalam", "Thennur"],
};
const GENERIC = ["Gandhi Nagar", "Nehru Street", "Periyar Nagar", "Anna Salai", "Kamarajar Road", "Bharathi Nagar", "Vinayagar Koil Street", "Mettu Street", "Agraharam", "New Colony"];

export function localityFor(rng: Rng, city: string | undefined): string {
  return rng.pick((city && LOCALITIES[city]) || GENERIC);
}

export function addressFor(rng: Rng, city: string | undefined): string {
  const street = rng.pick(["Pillayar Koil Street", "Main Road", "Mill Road", "Temple Street", "Cross Street", "Bazaar Street", "East Car Street"]);
  return `${rng.int(1, 240)}, ${street}, ${localityFor(rng, city)}${city ? `, ${city}` : ""}`;
}
