import type { Messages } from "@rbms/i18n/client";

/** pos.rules.* strings: Settings, Counter rules (cash difference limit, customer display messages). Merged into posMessages. */
export const rulesEn: Messages = {
  "pos.nav.rules": "Counter rules",
  "pos.rules.title": "Counter rules",
  "pos.rules.subtitle": "When closing the day needs a manager, and what the customer display says when nobody is buying.",
  "pos.rules.till.title": "Cash difference at close",
  "pos.rules.till.hint": "A count that differs from the cash the till expects needs a reason. Beyond the limit below it also needs a manager's POS PIN (owners and admins do not need one).",
  "pos.rules.till.limit": "Limit (₹)",
  "pos.rules.till.limitHint": "0 asks a manager for every difference. The same applies when the drawer is handed to the next cashier.",
  "pos.rules.display.title": "Customer display: idle screen",
  "pos.rules.display.hint": "Shown on the second screen between customers, with photos of your items (offers first). Leave empty to show a plain “Welcome”.",
  "pos.rules.display.welcomeEn": "Welcome line (English)",
  "pos.rules.display.welcomeTa": "Welcome line (Tamil)",
  "pos.rules.display.offerEn": "Offer line (English)",
  "pos.rules.display.offerTa": "Offer line (Tamil)",
  "pos.rules.save": "Save",
  "pos.rules.saved": "Saved",
};

export const rulesTa: Messages = {
  "pos.nav.rules": "கவுண்டர் விதிகள்",
  "pos.rules.title": "கவுண்டர் விதிகள்",
  "pos.rules.subtitle": "நாள் முடிக்க எப்போது மேலாளர் தேவை, யாரும் வாங்காதபோது வாடிக்கையாளர் திரை என்ன காட்டும்.",
  "pos.rules.till.title": "மூடும்போது ரொக்க வித்தியாசம்",
  "pos.rules.till.hint": "கல்லா எதிர்பார்க்கும் ரொக்கத்துடன் எண்ணிக்கை வேறுபட்டால் காரணம் தேவை. கீழுள்ள வரம்புக்கு மேல் மேலாளரின் POS PIN-ம் தேவை (உரிமையாளர், நிர்வாகிகளுக்குத் தேவையில்லை).",
  "pos.rules.till.limit": "வரம்பு (₹)",
  "pos.rules.till.limitHint": "0 என்றால் ஒவ்வொரு வித்தியாசத்துக்கும் மேலாளர் வேண்டும். டிராயரை அடுத்த காசாளரிடம் ஒப்படைக்கும்போதும் இதே விதி.",
  "pos.rules.display.title": "வாடிக்கையாளர் திரை: காத்திருப்புத் திரை",
  "pos.rules.display.hint": "வாடிக்கையாளர்களுக்கு இடையே இரண்டாம் திரையில் காட்டப்படும்; பொருட்களின் படங்களுடன் (சலுகைகள் முதலில்). காலியாக விட்டால் “வரவேற்கிறோம்” மட்டும் காட்டும்.",
  "pos.rules.display.welcomeEn": "வரவேற்பு வரி (ஆங்கிலம்)",
  "pos.rules.display.welcomeTa": "வரவேற்பு வரி (தமிழ்)",
  "pos.rules.display.offerEn": "சலுகை வரி (ஆங்கிலம்)",
  "pos.rules.display.offerTa": "சலுகை வரி (தமிழ்)",
  "pos.rules.save": "சேமி",
  "pos.rules.saved": "சேமிக்கப்பட்டது",
};
