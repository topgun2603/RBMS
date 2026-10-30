/**
 * Trust badges, the announcement ribbon's fallback and the footer's payment marks, derived from what the shop can back
 * up: its returns policy, cash on delivery, its trade (`@rbms/verticals` PACK_TRUST) and the owner's
 * `store.trust` settings. A crackers shop says "Pay on confirmation", a florist "Fresh every morning", a salon "Pay at
 * the shop" — never "Easy returns" for goods that can't come back. Pure.
 */
import { packFor, packTrust, type TrustPayment, type TrustReturns, type UspIcon } from "@rbms/verticals";
import type { StoreConfig } from "../types";
type Translator = (key: string) => string;

export type TrustIcon = UspIcon | "pin";

export interface TrustItem {
  key: string;
  icon: TrustIcon;
  title: string;
  text: string;
  /** Where the item links in the announcement ribbon. */
  href?: string;
}

/** Policy wording that means "we don't take goods back" (English and Tamil). */
const NO_RETURNS =
  /\b(no returns?|non[- ]returnable|not returnable|can(?:'|’)?t be returned|cannot be returned|can(?:'|’)?t take back|cannot take back|can(?:'|’)?t accept returns?|not accepted back)\b|திருப்ப\S*(?:\s+\S+)?\s+(?:இயலாது|முடியாது)/i;
/** Wording that takes goods back (with exceptions like "cut pipes cannot be returned" it is still a returns policy). */
const RETURNS_OK = /\b(can be returned|may be returned|returns? (?:with)?in \d+|return (?:it |them )?within|returns? (?:are )?accepted|easy returns?|free returns?)\b/i;
/** "Only sealed / unopened items" wording. */
const SEALED_ONLY = /\b(sealed|unopened|unused)\b[^.]*\b(exchang|return)/i;

type Config = Pick<StoreConfig, "codEnabled" | "policies" | "trust"> & { shop: Pick<StoreConfig["shop"], "businessType"> };

/** How returns work: the owner's choice, else the trade's, else read from the returns policy ("" policy = none). */
export function returnsMode(config: Config): TrustReturns {
  const own = config.trust?.returns;
  if (own && own !== "auto") return own;
  const policy = config.policies.returns?.trim() ?? "";
  const pack = packTrust(config.shop.businessType).returns;
  if (pack === "none") return "none";
  if (!policy) return "none";
  if (pack) return pack;
  if (RETURNS_OK.test(policy)) return "easy";
  if (NO_RETURNS.test(policy)) return SEALED_ONLY.test(policy) ? "exchange" : "replace";
  return "easy";
}

/** How shoppers pay: the owner's choice, else the trade's, else online at checkout. */
export function paymentMode(config: Config): TrustPayment {
  const own = config.trust?.payment;
  if (own && own !== "auto") return own;
  return packTrust(config.shop.businessType).payment ?? "online";
}

function ownBadges(config: Config, locale: string): TrustItem[] {
  const ta = locale === "ta";
  return (config.trust?.badges ?? [])
    .filter((b) => b.title?.trim())
    .slice(0, 4)
    .map((b, i) => ({ key: `own-${i}`, icon: "check" as const, title: (ta && b.titleTa?.trim()) || b.title.trim(), text: (ta && b.textTa?.trim()) || b.text?.trim() || "" }));
}

/** The trust badges (at most four): the owner's own, or the trade promise · payment · COD · returns · made locally. */
export function trustItems(config: Config, t: Translator, locale: string): TrustItem[] {
  const own = ownBadges(config, locale);
  if (own.length) return own;
  const pack = packTrust(config.shop.businessType);
  const l = locale === "ta" ? "ta" : "en";
  const pay = paymentMode(config);
  const ret = returnsMode(config);
  const out: TrustItem[] = [];
  if (pack.promise) out.push({ key: "promise", icon: pack.promise.icon, title: pack.promise.title[l], text: pack.promise.text[l] });
  // A website-only trade (school) sells nothing online: no payment, COD or returns badges, just its own promise if any.
  if (packFor(config.shop.businessType)?.site) return out;
  out.push(pay === "online" ? { key: "pay", icon: "shield", title: t("trust.secure"), text: t("trust.secureText") } : { key: "pay", icon: pay === "confirm" ? "check" : "cash", title: t(`trust.pay.${pay}`), text: t(`trust.pay.${pay}Text`) });
  if (config.codEnabled && pay !== "visit") out.push({ key: "cod", icon: "cash", title: t("trust.cod"), text: t("trust.codText") });
  if (ret !== "none") out.push({ key: "returns", icon: "return", title: t(ret === "easy" ? "trust.returns" : `trust.returns.${ret}`), text: t(ret === "easy" ? "trust.returnsText" : `trust.returns.${ret}Text`), href: "/policies/returns" });
  if (packFor(config.shop.businessType)?.localMade) out.push({ key: "local", icon: "pin", title: t("trust.local"), text: t("trust.localText") });
  return out.slice(0, 4);
}

/** Announcement ribbon lines when the home has no "why shop with us" (usp) section: the same claims, one line each. */
export function trustAnnouncements(config: Config, t: Translator, locale: string): { text: string; href?: string }[] {
  const own = ownBadges(config, locale);
  if (own.length) return own.map((b) => ({ text: b.text ? `${b.title} · ${b.text}` : b.title }));
  const pack = packTrust(config.shop.businessType);
  const l = locale === "ta" ? "ta" : "en";
  const pay = paymentMode(config);
  const ret = returnsMode(config);
  const out: { text: string; href?: string }[] = [];
  if (pack.promise) out.push({ text: `${pack.promise.title[l]} · ${pack.promise.text[l]}` });
  if (packFor(config.shop.businessType)?.site) return out;
  if (pay !== "online") out.push({ text: t(`announce.pay.${pay}`) });
  if (config.codEnabled && pay !== "visit") out.push({ text: t("announce.cod") });
  if (ret !== "none") out.push({ text: t(ret === "easy" ? "announce.returns" : `announce.returns.${ret}`), href: "/policies/returns" });
  return out;
}

/** Payment marks for the footer / cart: UPI, cards, net banking (online) or cash (paid at the shop), COD when on. */
export function paymentMarks(config: Config): { upi: boolean; cards: boolean; netbanking: boolean; cash: boolean; cod: boolean } {
  const pay = paymentMode(config);
  return { upi: true, cards: true, netbanking: pay !== "visit", cash: pay === "visit", cod: config.codEnabled && pay !== "visit" };
}
