/**
 * What a trade can honestly promise shoppers in the storefront's trust badges and announcement ribbon: how returns
 * work, how shoppers pay, and one trade promise ("Fresh every morning"). Defaults per business pack; the shop's own
 * returns policy and store settings (`store.trust`) refine or override them (storefront-ui `lib/trust.ts`).
 *
 * Kept apart from `packs.ts` so the packs file stays data about the trade's catalogue and words.
 */
import type { BusinessType, UspIcon } from "./packs";

/**
 * - `easy`: returns accepted ("Easy returns").
 * - `replace`: nothing is taken back (perishable, explosive, hygiene), but damaged / wrong items are replaced or refunded.
 * - `exchange`: only sealed, unused items can be exchanged (cosmetics, innerwear).
 * - `none`: returns don't apply (services, appointments): no returns badge at all.
 */
export const TRUST_RETURNS = ["easy", "replace", "exchange", "none"] as const;
export type TrustReturns = (typeof TRUST_RETURNS)[number];

/**
 * - `online`: pay at checkout (UPI, cards, net banking).
 * - `confirm`: the shop confirms the order (stock, freight, licence) first, then the shopper pays (crackers).
 * - `visit`: booked online, paid at the shop (salons, gyms, repairs).
 */
export const TRUST_PAYMENT = ["online", "confirm", "visit"] as const;
export type TrustPayment = (typeof TRUST_PAYMENT)[number];

export interface TrustPromise {
  icon: UspIcon;
  title: { en: string; ta: string };
  text: { en: string; ta: string };
}

export interface PackTrust {
  /** Default `easy` (when the shop has a returns policy). */
  returns?: TrustReturns;
  /** Default `online`. */
  payment?: TrustPayment;
  /** The trade's own promise, shown first. */
  promise?: TrustPromise;
}

const promise = (icon: UspIcon, en: [string, string], ta: [string, string]): TrustPromise => ({ icon, title: { en: en[0], ta: ta[0] }, text: { en: en[1], ta: ta[1] } });

const FRESH_DAILY = promise("leaf", ["Fresh every morning", "Brought in at dawn, sent out the same day"], ["தினமும் காலையில் புதிதாக", "விடியலில் வாங்கி, அன்றே அனுப்புகிறோம்"]);
const COOKED = promise("clock", ["Cooked to order", "Made fresh when you order"], ["ஆர்டருக்குச் சமைத்தது", "நீங்கள் ஆர்டர் செய்ததும் புதிதாக"]);

/** Per-trade defaults; trades not listed take returns `easy` and payment `online` with no promise. */
export const PACK_TRUST: Partial<Record<BusinessType, PackTrust>> = {
  crackers: {
    returns: "replace",
    payment: "confirm",
    promise: promise("shield", ["Licensed & packed safe", "From a licensed maker, packed to transport rules"], ["உரிமம் பெற்று, பாதுகாப்பாக", "உரிமம் பெற்ற தயாரிப்பு, விதிப்படி பேக்கிங்"]),
  },
  florist_pooja: { returns: "replace", promise: FRESH_DAILY },
  fresh: { returns: "replace", promise: FRESH_DAILY },
  bakery: { returns: "replace", promise: promise("star", ["Baked fresh daily", "Small batches from our own kitchen"], ["தினமும் புதிதாகச் சுட்டது", "எங்கள் சமையலறையில் சிறு அளவில்"]) },
  restaurant: { returns: "replace", promise: COOKED },
  cloud_kitchen: { returns: "replace", promise: COOKED },
  tea_stall: { returns: "replace", promise: COOKED },
  pharmacy: { returns: "replace", promise: promise("shield", ["Genuine medicines", "From licensed distributors, checked for expiry"], ["அசல் மருந்துகள்", "உரிமம் பெற்ற விநியோகஸ்தரிடமிருந்து, காலாவதி சரிபார்த்து"]) },
  organic: { promise: promise("leaf", ["Straight from farmers", "Chemical-free, from farms we know"], ["உழவரிடமிருந்து நேரடியாக", "நாங்கள் அறிந்த பண்ணைகளிலிருந்து, ரசாயனமின்றி"]) },
  cosmetics: { returns: "exchange", promise: promise("shield", ["100% genuine", "Sealed, from authorised suppliers"], ["100% அசல்", "சீல் உடையாமல், அங்கீகரிக்கப்பட்ட விநியோகஸ்தரிடமிருந்து"]) },
  jewellery: { returns: "exchange", promise: promise("check", ["Hallmarked gold", "BIS hallmark and HUID on every piece"], ["ஹால்மார்க் தங்கம்", "ஒவ்வொரு நகைக்கும் BIS ஹால்மார்க், HUID"]) },
  salon: { returns: "none", payment: "visit" },
  spa: { returns: "none", payment: "visit" },
  gym: { returns: "none", payment: "visit" },
  repair: { returns: "none", payment: "visit", promise: promise("check", ["Repair warranty", "Parts and work guaranteed"], ["பழுது நீக்க உத்தரவாதம்", "உதிரிபாகங்களுக்கும் வேலைக்கும் உத்தரவாதம்"]) },
  tailoring: { returns: "none", payment: "visit" },
  school: { returns: "none", payment: "visit" },
};

/** The trade's trust defaults (empty for unknown trades). */
export function packTrust(type: string | null | undefined): PackTrust {
  return (type && PACK_TRUST[type as BusinessType]) || {};
}
