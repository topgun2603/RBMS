import type { Messages } from "@srirealtime/i18n/client";

/**
 * Review source labels and the extra review controls. Every review that the shop entered (not written here by a
 * signed-in shopper) says where it came from. Merged into lib/messages (same keys in en and ta).
 */
export const reviewsEn: Messages = {
  "reviews.source.in_store": "Shared in store",
  "reviews.source.in_storeHint": "The customer gave this review at the shop, and the shop added it here.",
  "reviews.source.invited": "Sent on the shop's request",
  "reviews.source.invitedHint": "The shop asked this customer for a review and added their reply here.",
  "reviews.source.imported": "From {platform}",
  "reviews.source.importedHint": "First posted on {platform}; the shop copied it here.",
  "reviews.platform.google": "Google",
  "reviews.platform.amazon": "Amazon",
  "reviews.platform.flipkart": "Flipkart",
  "reviews.platform.meesho": "Meesho",
  "reviews.platform.instagram": "Instagram",
  "reviews.platform.other": "another site",
  "reviews.verifiedHint": "Bought this product from the shop (delivered order).",
  "reviews.sort.photos": "With photos",
  "reviews.photo": "Photo {n} from {name}",
  "reviews.from": "{name}, {city}",
};

export const reviewsTa: Messages = {
  "reviews.source.in_store": "கடையில் பகிரப்பட்டது",
  "reviews.source.in_storeHint": "வாடிக்கையாளர் இந்த விமர்சனத்தைக் கடையில் கொடுத்தார்; கடை இங்கே சேர்த்தது.",
  "reviews.source.invited": "கடையின் கோரிக்கையின் பேரில்",
  "reviews.source.invitedHint": "கடை இந்த வாடிக்கையாளரிடம் விமர்சனம் கேட்டு, அவர் பதிலை இங்கே சேர்த்தது.",
  "reviews.source.imported": "{platform} இலிருந்து",
  "reviews.source.importedHint": "முதலில் {platform} இல் பதிவிடப்பட்டது; கடை இங்கே நகலெடுத்தது.",
  "reviews.platform.google": "Google",
  "reviews.platform.amazon": "Amazon",
  "reviews.platform.flipkart": "Flipkart",
  "reviews.platform.meesho": "Meesho",
  "reviews.platform.instagram": "Instagram",
  "reviews.platform.other": "வேறு தளம்",
  "reviews.verifiedHint": "இந்தப் பொருளைக் கடையிலிருந்து வாங்கியவர் (டெலிவரி செய்யப்பட்ட ஆர்டர்).",
  "reviews.sort.photos": "படங்களுடன்",
  "reviews.photo": "{name} பகிர்ந்த படம் {n}",
  "reviews.from": "{name}, {city}",
};
