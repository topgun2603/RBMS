import type { Messages } from "@rbms/web";

/** orders.reviewRequest.* strings ("Ask for a review" on a delivered order). Merged into ordersMessages. */
export const reviewRequestEn: Messages = {
  "orders.reviewRequest.title": "Customer review",
  "orders.reviewRequest.body": "Ask the customer to review what they bought. They get one message with a link; reviews from signed-in buyers show “Verified purchase”.",
  "orders.reviewRequest.action": "Ask for a review",
  "orders.reviewRequest.sent": "Review request sent",
  "orders.reviewRequest.sentNote": "Review request sent to the customer.",
  "orders.reviewRequest.skipped.duplicate": "Already asked for this order.",
  "orders.reviewRequest.skipped.off": "Review requests are switched off in Settings → Customer messages.",
  "orders.reviewRequest.skipped.opted_out": "The customer has opted out of messages.",
  "orders.reviewRequest.skipped.no_contact": "No mobile number or email on this order.",
  "orders.reviewRequest.skipped.other": "The message couldn't be sent. Try again later.",
};

export const reviewRequestTa: Messages = {
  "orders.reviewRequest.title": "வாடிக்கையாளர் விமர்சனம்",
  "orders.reviewRequest.body": "வாங்கிய பொருளுக்கு விமர்சனம் எழுதும்படி வாடிக்கையாளரிடம் கேளுங்கள். இணைப்புடன் ஒரே ஒரு செய்தி செல்லும்; உள்நுழைந்த வாங்குபவர்களின் விமர்சனங்களில் “சரிபார்க்கப்பட்ட வாங்குதல்” தெரியும்.",
  "orders.reviewRequest.action": "விமர்சனம் கேள்",
  "orders.reviewRequest.sent": "விமர்சனக் கோரிக்கை அனுப்பப்பட்டது",
  "orders.reviewRequest.sentNote": "வாடிக்கையாளருக்கு விமர்சனக் கோரிக்கை அனுப்பப்பட்டது.",
  "orders.reviewRequest.skipped.duplicate": "இந்த ஆர்டருக்கு ஏற்கனவே கேட்கப்பட்டது.",
  "orders.reviewRequest.skipped.off": "விமர்சனக் கோரிக்கைகள் அமைப்புகள் → வாடிக்கையாளர் செய்திகளில் அணைக்கப்பட்டுள்ளன.",
  "orders.reviewRequest.skipped.opted_out": "வாடிக்கையாளர் செய்திகளிலிருந்து விலகியுள்ளார்.",
  "orders.reviewRequest.skipped.no_contact": "இந்த ஆர்டரில் மொபைல் எண் அல்லது மின்னஞ்சல் இல்லை.",
  "orders.reviewRequest.skipped.other": "செய்தியை அனுப்ப முடியவில்லை. பிறகு முயற்சிக்கவும்.",
};
