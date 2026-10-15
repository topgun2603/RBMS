import type { Messages } from "@srirealtime/web";
import * as branches from "./branches";
import * as common from "./common";
import * as developer from "./developer";
import * as einvoice from "./einvoice";
import * as kyc from "./kyc";
import * as loyalty from "./loyalty";
import * as reports from "./reports";

/**
 * growth.* strings (English + Tamil). One file per area; every file exports `en` and `ta` with the same keys
 * (module.test.ts checks it). Tamil is plain Tamil for Tamil Nadu shops: no Hindi/Urdu trade words.
 */
const areas = [common, loyalty, kyc, einvoice, branches, developer, reports];

export const growthMessages: { en: Messages; ta: Messages } = {
  en: Object.assign({}, ...areas.map((a) => a.en)) as Messages,
  ta: Object.assign({}, ...areas.map((a) => a.ta)) as Messages,
};

/** Per-area bundles, for tests. */
export const growthMessageAreas = { common, loyalty, kyc, einvoice, branches, developer, reports };
