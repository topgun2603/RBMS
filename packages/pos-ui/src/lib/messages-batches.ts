import type { Messages } from "@srirealtime/i18n/client";

/** pos.batch.* strings: the batch of a counter line (items with batches and expiry). Merged into posMessages. */
export const batchEn: Messages = {
  "pos.batch.line": "Batch {no} · Exp {exp}",
  "pos.batch.lineNoExp": "Batch {no}",
  "pos.batch.choose": "Choose batch",
  "pos.batch.change": "Change batch",
  "pos.batch.body": "Pick the batch this item is sold from. The oldest expiry is chosen for you.",
  "pos.batch.loading": "Loading batches…",
  "pos.batch.error": "Could not load the batches. Check the connection.",
  "pos.batch.none": "No stock in any batch here. The bill still goes through; stock is taken from the item's total.",
  "pos.batch.exp": "Exp",
  "pos.batch.days": "{days, plural, =0 {today} one {# day left} other {# days left}}",
  "pos.batch.suggest": "Expires soon: consider {pct}% off",
  "pos.batch.expired": "Expired",
  "pos.batch.expiredBlocked": "Expired, can't sell",
};

export const batchTa: Messages = {
  "pos.batch.line": "பேட்ச் {no} · காலாவதி {exp}",
  "pos.batch.lineNoExp": "பேட்ச் {no}",
  "pos.batch.choose": "பேட்சைத் தேர்ந்தெடு",
  "pos.batch.change": "பேட்சை மாற்று",
  "pos.batch.body": "இந்தப் பொருள் எந்த பேட்சிலிருந்து விற்கப்படும் என்பதைத் தேர்ந்தெடுங்கள். முதலில் காலாவதியாகும் பேட்ச் தானாகத் தேர்வாகும்.",
  "pos.batch.loading": "பேட்ச்கள் ஏற்றப்படுகின்றன…",
  "pos.batch.error": "பேட்ச்களை ஏற்ற முடியவில்லை. இணைப்பைச் சரிபாருங்கள்.",
  "pos.batch.none": "இங்கே எந்த பேட்சிலும் இருப்பு இல்லை. பில் போடலாம்; பொருளின் மொத்த இருப்பிலிருந்து எடுக்கப்படும்.",
  "pos.batch.exp": "காலாவதி",
  "pos.batch.days": "{days, plural, =0 {இன்று} other {# நாள் உள்ளது}}",
  "pos.batch.suggest": "விரைவில் காலாவதி: {pct}% தள்ளுபடி பரிசீலிக்கவும்",
  "pos.batch.expired": "காலாவதி",
  "pos.batch.expiredBlocked": "காலாவதி, விற்க முடியாது",
};
