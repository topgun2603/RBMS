import type { Messages } from "@srirealtime/i18n/client";

/** Price lists and alternate units at the counter (docs/price-lists-units.md). Merged into posMessages. */
export const pricingEn: Messages = {
  "pos.priceList.label": "Price list",
  "pos.priceList.auto": "Customer's (item price)",
  "pos.priceList.autoNamed": "Customer's ({name})",
  "pos.priceList.none": "Item price",
  "pos.edit.unit": "Unit",
  "pos.edit.unitOption": "{unit} (= {factor} {base})",
};

export const pricingTa: Messages = {
  "pos.priceList.label": "விலைப் பட்டியல்",
  "pos.priceList.auto": "வாடிக்கையாளருடையது (பொருள் விலை)",
  "pos.priceList.autoNamed": "வாடிக்கையாளருடையது ({name})",
  "pos.priceList.none": "பொருள் விலை",
  "pos.edit.unit": "அலகு",
  "pos.edit.unitOption": "{unit} ({factor} {base} கொண்டது)",
};
