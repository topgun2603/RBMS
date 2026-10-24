import type { Messages } from "@srirealtime/web";

/** site.reviews.ai.* strings: AI reply drafts and review themes (docs/ai.md Phase 2 part B). Keep en and ta identical. */
export const reviewsAiEn: Messages = {
  "site.reviews.ai.draft": "Draft reply with AI",
  "site.reviews.ai.drafting": "Writing…",
  "site.reviews.ai.note": "Anything you decide to offer (optional)",
  "site.reviews.ai.noteHint": "AI makes no promises on its own. If you want to offer a replacement, refund or discount, write it here in your own words.",
  "site.reviews.ai.removed": "{n, plural, one {# sentence was} other {# sentences were}} left out because it promised something you did not write.",
  "site.reviews.ai.templated": "AI could not give a usable reply, so a simple thank-you is shown. Edit it as you like.",
  "site.reviews.ai.themes": "Review themes",
  "site.reviews.ai.themesTitle": "What customers say",
  "site.reviews.ai.themesHint": "Counts from the last {days} days of reviews, worded by AI.",
  "site.reviews.ai.themesLoad": "Summarise",
  "site.reviews.ai.praised": "Most praised",
  "site.reviews.ai.complained": "Most complained about",
  "site.reviews.ai.mentions": "{n, plural, one {# review} other {# reviews}}",
  "site.reviews.ai.none": "No reviews in this period.",
  "site.reviews.ai.avg": "{n} reviews, average {avg} out of 5",
};

export const reviewsAiTa: Messages = {
  "site.reviews.ai.draft": "AI மூலம் பதில் வரைவு",
  "site.reviews.ai.drafting": "எழுதுகிறது…",
  "site.reviews.ai.note": "நீங்கள் வழங்க முடிவு செய்தது (விருப்பம்)",
  "site.reviews.ai.noteHint": "AI தானாக எந்த வாக்குறுதியும் தராது. மாற்றுப் பொருள், பணம் திருப்பம் அல்லது தள்ளுபடி வழங்க விரும்பினால் உங்கள் சொற்களில் இங்கே எழுதுங்கள்.",
  "site.reviews.ai.removed": "நீங்கள் எழுதாத வாக்குறுதி இருந்ததால் {n} வாக்கியம் நீக்கப்பட்டது.",
  "site.reviews.ai.templated": "AI பயன்படுத்தக்கூடிய பதிலைத் தரவில்லை, எனவே எளிய நன்றி காட்டப்படுகிறது. விரும்பியபடி திருத்துங்கள்.",
  "site.reviews.ai.themes": "விமர்சனத் தலைப்புகள்",
  "site.reviews.ai.themesTitle": "வாடிக்கையாளர்கள் என்ன சொல்கிறார்கள்",
  "site.reviews.ai.themesHint": "கடந்த {days} நாள் விமர்சனங்களின் எண்ணிக்கை; சொற்களை AI எழுதியது.",
  "site.reviews.ai.themesLoad": "சுருக்கு",
  "site.reviews.ai.praised": "அதிகம் பாராட்டியது",
  "site.reviews.ai.complained": "அதிகம் குறை சொன்னது",
  "site.reviews.ai.mentions": "{n} விமர்சனம்",
  "site.reviews.ai.none": "இந்த காலத்தில் விமர்சனங்கள் இல்லை.",
  "site.reviews.ai.avg": "{n} விமர்சனங்கள், சராசரி 5-இல் {avg}",
};
