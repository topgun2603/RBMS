import type { Messages } from "@rbms/i18n/client";

/** billing.* strings for the serial number / IMEI field on a bill line. Keep the en and ta key sets identical. */
export const en: Messages = {
  "billing.form.serials.label": "Serial numbers / IMEI",
  "billing.form.serials.hint": "One per line, one for each unit sold. They are marked sold and printed on the bill.",
  "billing.form.serials.count": "{n} of {units} entered",
  "billing.form.serials.tooMany": "More serial numbers than units on this line",
};

export const ta: Messages = {
  "billing.form.serials.label": "வரிசை எண்கள் / IMEI",
  "billing.form.serials.hint": "ஒவ்வொரு விற்பனை அலகுக்கும் ஒன்று, ஒரு வரிக்கு ஒன்று. அவை விற்கப்பட்டதாகக் குறிக்கப்பட்டு பில்லில் அச்சிடப்படும்.",
  "billing.form.serials.count": "{units}-இல் {n} உள்ளிடப்பட்டது",
  "billing.form.serials.tooMany": "இந்த வரியில் அலகுகளை விட அதிக வரிசை எண்கள் உள்ளன",
};
